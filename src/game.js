import {
  WORLD, STAGES, MAX_STAGE, KAIJU, CITIES, DIFFICULTIES, ENEMIES, ESCALATION, BOSS, GATE, GATE_BOSSES, LIMITS,
  UNIT_HEAL, LOSS_SCRAP_KEEP, CROWD, canDamage, isSnack, lootFor, EAT_TIME, xpToNext, xpFor, XP, THREAT, ENEMY_SCALING, ELITES, ELITE, HEALING, SWARM, DASH, MULTI,
} from './config.js';
import { AUGMENT_BY_ID, offerAugments, applyPick, completedSets } from './augments.js';
import { World, isWater, useCity, METRO } from './world.js';
import { createRng } from './rng.js';
import { norm, distToRect, distToSegment, closestPoint } from './geom.js';
import { MoveSystem } from './moves.js';
import { PERSON_VARIANTS } from './models.js';

// Aim time before a projectile leaves the barrel (seconds); shells, artillery and lasers
// already telegraph with ground markers.
const WINDUP = { bullet: 0.45, burst: 0.55, rocket: 0.7, missile: 0.6, net: 0.8, volley: 1 };
const GONE = new Set(['collapsing', 'rubble', 'removed', 'flung', 'eaten', 'gone']);

export { distToRect, distToSegment };

export class Game {
  constructor({ kaijuId = 'rex', cityId = 'harbor', difficulty = 'normal', seed = Date.now(), citySeed = seed, firstRun = false } = {}) {
    this.def = KAIJU[kaijuId];
    this.cityDef = CITIES[cityId];
    this.diff = DIFFICULTIES[difficulty];
    this.rng = createRng(seed);
    this.firstRun = firstRun;
    // Every run gets its own endless world, generated cell by cell around the kaiju; the
    // hatchling always starts in the home neighbourhood.
    this.city = new World(citySeed);
    useCity(this.city);
    this.grid = this.city.grid;
    // Cells dropped behind the kaiju take their in-flight collapses with them.
    this.city.listeners.add({
      unload: (chunk) => {
        for (const o of chunk.objects) {
          if (!this.active.has(o)) continue;
          if (o.state === 'collapsing') {
            o.state = 'rubble';
            this.collapsing--;
          }
          this.active.delete(o);
        }
      },
    });

    const s1 = STAGES[1];
    this.kaiju = {
      x: this.city.spawn.x, y: this.city.spawn.y, r: s1.radius, stage: 1,
      maxHp: s1.maxHp * this.def.hpMult, hp: s1.maxHp * this.def.hpMult, xp: 0, level: 1,
      biomass: 0, facing: { x: -1, y: 0 }, vx: 0, vy: 0, moving: false, stillTime: 0,
      attackCd: 0.5, attackCount: 0, shield: 0, hitFlash: 0, invuln: 0, trailT: 0, stompT: 0,
      walkPhase: 0, lastAttack: null, inWater: false, contactT: 0, hopT: 0, hopMax: 0.5, hopH: 0, z: 0,
      healRecent: 0, sedated: 0, netted: 0, dashT: 0, dashCd: 0, dashDir: null, dodging: 0, perfect: false,
    };
    this.multi = { n: 0, last: -9, tier: 0 };
    this.threat = 0; // 0-100, see THREAT
    this.threatIdle = 0;
    this.input = { x: 0, y: 0 };
    this.held = new Map();
    this.units = [];
    this.allies = []; // hatchlings from Brood Call
    this.people = [];
    this.traffic = [];
    this.trains = [];
    this.projectiles = [];
    this.hazards = [];
    this.scheduled = [];
    this.fires = [];
    this.fx = { orbs: [], floaters: [], rings: [], beams: [], bolts: [], slashes: [], swirls: [], cracks: [] };
    this.moves = new MoveSystem(this);
    this.vfx = [];
    this.boss = null;
    this.bossTimer = null;
    this.gateTimer = null; // countdown to the size-gate boss walking in
    this.gateCleared = []; // gateCleared[stage]: that size's boss is down, so the kaiju may grow
    this.collapsing = 0;
    this.active = new Set();
    this.shake = 0;
    this.hitstop = 0; // brief freeze on heavy impacts
    this.punch = 0; // camera zoom kick, read by the renderer
    this.clock = 0; // real time, for rationing freezes
    this.lastFreeze = -1;
    this.combo = { n: 0, t: 0, best: 0, tier: 0 };
    this.slowmo = 0;
    this.slowmoReadyAt = 0;
    this.time = 0;
    this.state = 'playing';
    this.pick = null;
    this.picksMade = 0;
    this.pendingPicks = 0; // level-ups waiting for their augment pick
    this.rerolls = 3; // per run, Vampire Survivors style
    this.reviveAvailable = true;
    this.adRerollAvailable = true;
    this.director = { spawnT: ESCALATION[1].firstDelay, jetT: 4, crowdT: 0, waveT: Infinity, eliteT: Infinity };
    this.events = [];
    this.results = null;
    this.stats = {
      scrap: 0, biomass: 0, buildings: 0, destroyed: 0, units: 0, people: 0,
      landmark: false, rareMaterials: 0, firstSkyscraperAt: null, stageTimes: { 1: 0 },
    };
    this.trainRespawn = 0;
    this.streamWorld(true);
    this.populate(true);
  }

  get objects() {
    return this.city.objects;
  }

  // Generate the world around the kaiju: everything near it now, the rest of the view a few
  // cells per frame, and forget what is far behind.
  streamWorld(initial = false) {
    const k = this.kaiju;
    const span = this.viewSpan();
    this.city.detail = k.stage >= 5 ? 1 : 0;
    this.city.update(k.x, k.y, span * 1.3 + 520, initial ? Infinity : 4, span * 0.6 + 150);
  }

  // ---------------------------------------------------------------- elevated metro
  // Metro lines run east-west along every ninth row; trains run on the line nearest the kaiju.
  newTrain(row, s, dir) {
    return { row, s, dir, speed: 55, stop: 0, lastStation: null, dead: false, cars: 3, x: s, y: row * WORLD.cell, heading: dir < 0 ? Math.PI : 0, isTrain: true };
  }

  // Position and heading along metro line `row` at distance s.
  metroAt(s, row) {
    return { x: s, y: row * WORLD.cell, heading: 0 };
  }

  updateTrains(dt) {
    const k = this.kaiju;
    const world = this.city;
    const span = this.viewSpan();
    const seg = METRO.segLen;
    for (const t of this.trains) {
      if (t.dead) continue;
      if (t.stop > 0) t.stop -= dt;
      else {
        t.s += t.dir * t.speed * dt;
        const i = Math.floor(t.s / seg);
        if ((((i % METRO.stationEvery) + METRO.stationEvery) % METRO.stationEvery) === METRO.stationOffset && t.lastStation !== i && Math.abs(t.s - (i + 0.5) * seg) < 3) {
          t.lastStation = i;
          t.stop = 3;
        }
      }
      t.x = t.s;
      t.y = t.row * WORLD.cell;
      t.heading = t.dir < 0 ? Math.PI : 0;
      // A broken span ahead derails the train; past the generated world it just leaves.
      const ahead = world.metroSeg(t.row, t.s + t.dir * seg * 0.6);
      if (!ahead) t.dead = true;
      else if (ahead.state !== 'intact') this.killTrain(t, true);
      else if (k.stage >= 4 && Math.hypot(t.x - k.x, t.y - k.y) < k.r + 20) this.killTrain(t, false);
    }
    this.trains = this.trains.filter((t) => !t.dead);
    this.trainRespawn -= dt;
    if (this.trains.length < 2 && this.trainRespawn <= 0) {
      this.trainRespawn = 10;
      const row = world.metroRowNear(k.y);
      if (row !== null && Math.abs(row * WORLD.cell - k.y) < span * 1.2 + 300) {
        const dir = this.rng.chance(0.5) ? 1 : -1;
        const s = k.x - dir * this.rng.range(span * 0.6, span * 1.1 + 150);
        const at = world.metroSeg(row, s);
        if (at && at.state === 'intact') this.trains.push(this.newTrain(row, s, dir));
      }
    }
  }

  killTrain(t, derailed) {
    if (t.dead) return;
    t.dead = true;
    const k = this.kaiju;
    const loot = lootFor(3, k.stage, 3);
    this.addBiomass(derailed ? 0 : loot.biomass);
    this.stats.scrap += loot.scrap * this.diff.loot;
    this.stats.destroyed++;
    this.fxEvent({ t: 'trainDie', train: t, dir: norm(t.x - k.x, t.y - k.y) });
    this.spawnExplosion(t.x, t.y, 30);
  }

  // ---------------------------------------------------------------- helpers
  get stage() {
    return STAGES[this.kaiju.stage];
  }

  // 0 = golden afternoon, 1 = neon night. Follows run progress so the boss fight is at night.
  kaijuSpeed() {
    return this.stage.speed * this.def.speedMult * (1 + 0.08 * this.level('longLegs'));
  }

  get dusk() {
    const k = this.kaiju;
    const prog = k.stage >= MAX_STAGE ? 1 : Math.min(1, k.biomass / this.stage.biomassToNext);
    return Math.min(1, (k.stage - 1 + prog) / (MAX_STAGE - 1.3));
  }

  has(id) {
    return this.held.has(id);
  }

  level(id) {
    return this.held.get(id) || 0;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Visual events for the renderer (hits, collapses, explosions).
  fxEvent(e) {
    this.vfx.push(e);
    if (this.vfx.length > LIMITS.vfx) this.vfx.splice(0, this.vfx.length - LIMITS.vfx);
  }

  drainVfx() {
    const out = this.vfx;
    this.vfx = [];
    return out;
  }

  schedule(delay, fn) {
    this.scheduled.push({ t: delay, fn });
  }

  // How much of the city the camera shows (shortest screen side, world units).
  viewSpan(radius = STAGES[this.kaiju.stage].radius) {
    return 40 + radius * 20;
  }

  baseDamage() {
    let m = this.stage.damage * (1 + 0.1 * this.level('might')) * (1 + 0.1 * this.level('glassCannon'));
    if (this.has('momentum')) m *= 1 + 0.08 * this.level('momentum') * (this.kaiju.momentum || 0);
    if (this.has('rageMode')) m *= 1 + (0.2 + 0.2 * this.level('rageMode')) * (1 - this.kaiju.hp / this.kaiju.maxHp);
    return m;
  }

  // ---- stats from passives
  maxHpFor(stage = this.kaiju.stage) {
    return STAGES[stage].maxHp * this.def.hpMult * (1 + 0.15 * this.level('toughness')) * (1 - 0.06 * this.level('glassCannon'));
  }

  scrapMult() {
    return 1 + 0.2 * this.level('scavenger');
  }

  setInput(x, y) {
    const l = Math.hypot(x, y);
    this.input = l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  objectsNear(x, y, radius) {
    const found = this.grid.query(x - radius, y - radius, x + radius, y + radius);
    return found.filter((o) => o.state === 'intact' && distToRect(x, y, o) <= radius);
  }

  cellAt(x, y) {
    return this.city.cellAt(x, y);
  }

  blockedAt(x, y, pad = 0, minTier = 0) {
    for (const o of this.grid.query(x - pad, y - pad, x + pad, y + pad)) {
      if (o.state === 'intact' && o.structure && !o.walkable && o.tier >= minTier && distToRect(x, y, o) <= pad) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- road driving for military vehicles
  nearestRoad(x, y) {
    return this.city.nearestRoad(x, y);
  }

  // Keep right: the lane offset slides across when a unit turns around, and the position
  // eases through corners, so road units never teleport.
  placeOnRoad(u, dt = 0) {
    const r = u.road;
    const n0 = norm(r.x1 - r.x0, r.y1 - r.y0);
    const lane = u.type === 'roadblock' ? 0 : Math.min(12 * (u.scale || 1), 26) * u.dir;
    u.lane = dt && u.lane !== undefined ? u.lane + (lane - u.lane) * Math.min(1, dt * 3) : lane;
    const tx = r.x0 + (r.x1 - r.x0) * u.t - n0.y * u.lane;
    const ty = r.y0 + (r.y1 - r.y0) * u.t + n0.x * u.lane;
    const heading = u.type === 'roadblock' ? Math.atan2(n0.x, -n0.y) : Math.atan2(n0.y * u.dir, n0.x * u.dir);
    if (!dt) {
      u.x = tx;
      u.y = ty;
      u.heading = heading;
      return;
    }
    const f = Math.min(1, dt * 10);
    u.x += (tx - u.x) * f;
    u.y += (ty - u.y) * f;
    let dh = heading - u.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    u.heading += dh * Math.min(1, dt * 8);
  }

  // Drive along the road network: toward the kaiju until in firing distance, away when scared.
  driveUnit(u, dt, dist, want, flee = false, speedMul = 1) {
    const k = this.kaiju;
    const r = u.road;
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) || 1;
    const away = flee || u.fear > 0 || dist < want * 0.75;
    let move = 0;
    if (away) {
      move = Math.hypot(r.x1 - k.x, r.y1 - k.y) > Math.hypot(r.x0 - k.x, r.y0 - k.y) ? 1 : -1;
    } else if (dist > want * 1.1) {
      const vx = r.x1 - r.x0;
      const vy = r.y1 - r.y0;
      const tp = Math.max(0, Math.min(1, ((k.x - r.x0) * vx + (k.y - r.y0) * vy) / (len * len)));
      if (Math.abs(tp - u.t) * len > 4) move = Math.sign(tp - u.t);
      else if (tp < 0.01 || tp > 0.99) move = tp < 0.5 ? -1 : 1;
    }
    // Commit to a direction for a moment before reversing (unless bolting in fear).
    u.dirHold = Math.max(0, (u.dirHold || 0) - dt);
    if (move && move !== u.dir && u.dirHold > 0 && !flee && !(u.fear > 0)) move = 0;
    if (move) {
      if (move !== u.dir) u.dirHold = 0.9;
      u.dir = move;
      u.t += (move * u.def.speed * (u.fear > 0 ? 1.3 : 1) * speedMul * dt) / len;
      if (u.t > 1 || u.t < 0) {
        const nx = u.t > 1 ? r.x1 : r.x0;
        const ny = u.t > 1 ? r.y1 : r.y0;
        const { graph, key } = this.city.roadGraph;
        const options = (graph.get(key(nx, ny)) || []).filter((o) => o !== r && !isWater((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2));
        if (!options.length) u.t = Math.max(0, Math.min(1, u.t));
        else {
          let pick = null;
          let score = Infinity;
          for (const o of options) {
            const atStart = Math.round(o.x0) === Math.round(nx) && Math.round(o.y0) === Math.round(ny);
            const fx = atStart ? o.x1 : o.x0;
            const fy = atStart ? o.y1 : o.y0;
            const sc = (away ? -1 : 1) * Math.hypot(fx - k.x, fy - k.y) + this.rng.range(0, 40);
            if (sc < score) {
              score = sc;
              pick = { o, atStart };
            }
          }
          u.road = pick.o;
          u.t = pick.atStart ? 0 : 1;
          u.dir = pick.atStart ? 1 : -1;
        }
      }
    }
    this.placeOnRoad(u, dt);
  }

  // The nearest thing worth eating at this size: guides the player when the area is cleared.
  findPrey(maxR = 6000) {
    const k = this.kaiju;
    for (let R = 250; R <= maxR; R *= 2) {
      let best = null;
      let bestD = Infinity;
      for (const o of this.grid.query(k.x - R, k.y - R, k.x + R, k.y + R)) {
        if (o.state !== 'intact' || o.tier < k.stage || !canDamage(o.tier, k.stage, o.landmark)) continue;
        const d = Math.hypot(o.x - k.x, o.y - k.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) return best;
    }
    return null;
  }

  // ---------------------------------------------------------------- main loop
  update(realDt) {
    if (this.state !== 'playing') return;
    this.clock += realDt;
    const dt = realDt * (this.hitstop > 0 ? 0.04 : this.slowmo > 0 ? 0.35 : 1);
    this.hitstop = Math.max(0, this.hitstop - realDt);
    this.slowmo = Math.max(0, this.slowmo - realDt);
    this.punch = Math.max(0, this.punch - realDt * 3);
    this.updateCombo(realDt);
    this.time += dt;

    this.checkGrowth();
    this.streamWorld();
    if (this.pendingPicks > 0) this.openPick();
    if (this.state !== 'playing') return;
    if (this.has('regen')) this.heal(0.003 * this.level('regen') * dt);
    this.updateThreat(dt);
    this.updateKaiju(dt);
    this.updateAugments(dt);
    this.updateDirector(dt);
    this.updateUnits(dt);
    this.updateAllies(dt);
    this.updatePeople(dt);
    this.updateTraffic(dt);
    this.updateTrains(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateScheduled(dt);
    this.updateObjects(dt);
    this.updateFires(dt);
    this.updateFx(dt);
    this.preyT = (this.preyT || 0) - dt;
    if (this.preyT <= 0) {
      this.preyT = 1;
      this.prey = this.findPrey();
      // Nothing your size left anywhere: you have outgrown the city, so grow anyway.
      const k = this.kaiju;
      this.starve = !this.prey && k.stage < MAX_STAGE ? (this.starve || 0) + 1 : 0;
      if (this.starve >= 15) {
        this.starve = 0;
        k.biomass = Math.max(k.biomass, this.stage.biomassToNext);
        this.emit('banner', { text: 'Outgrew the city!' });
      }
    }
    this.shake = Math.max(0, this.shake - realDt * 2.5);
  }

  // ---------------------------------------------------------------- game feel
  // A short freeze on heavy impacts (rationed so a rampage never stutters) plus a camera kick.
  impact(freeze, punch = 0) {
    if (this.clock - this.lastFreeze > 0.22) {
      this.hitstop = Math.max(this.hitstop, freeze);
      this.lastFreeze = this.clock;
    }
    this.punch = Math.max(this.punch, punch);
  }

  // Chain kills within a couple of seconds of each other; milestones get a callout and the
  // combo pays out a scrap bonus when it ends.
  bumpCombo() {
    const c = this.combo;
    c.n++;
    c.t = 2.2;
    c.best = Math.max(c.best, c.n);
    const tiers = [10, 25, 50, 100, 200];
    const tier = tiers.filter((n) => c.n >= n).length;
    if (tier > c.tier) {
      c.tier = tier;
      this.emit('comboTier', { tier, n: c.n });
    }
  }

  updateCombo(dt) {
    const c = this.combo;
    if (c.n === 0) return;
    c.t -= dt;
    if (c.t > 0) return;
    if (c.n >= 10) {
      const bonus = Math.round(c.n * (1 + c.n / 25) * this.kaiju.stage);
      this.stats.scrap += bonus;
      this.emit('comboEnd', { n: c.n, bonus });
      const k = this.kaiju;
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.4, text: `x${c.n} combo +${bonus}`, color: '#ffb13b', life: 1.6, max: 1.6 });
    }
    c.n = 0;
    c.tier = 0;
  }

  // ---------------------------------------------------------------- kaiju
  updateKaiju(dt) {
    const k = this.kaiju;
    k.r += (this.stage.radius - k.r) * Math.min(1, dt * 3);
    k.hitFlash = Math.max(0, k.hitFlash - dt);
    k.invuln = Math.max(0, k.invuln - dt);

    const mag = Math.hypot(this.input.x, this.input.y);
    k.moving = mag > 0.05;
    let speed = this.stage.speed * this.def.speedMult * (1 + 0.08 * this.level('longLegs'));
    if (k.netted > 0) speed *= 0.45;
    if (this.moves.cycloneUntil > this.time) speed *= 1.25; // Cyclone King: a moving tornado
    k.momentum = mag > 0.05 ? Math.min(1, (k.momentum || 0) + dt / 3) : Math.max(0, (k.momentum || 0) - dt * 1.5);
    k.inWater = isWater(k.x, k.y) && !this.onDeck(k);
    if (k.inWater) speed *= 0.6;
    k.vx = this.input.x * speed;
    k.vy = this.input.y * speed;
    k.dashCd = Math.max(0, k.dashCd - dt * (this.has('overclock') && k.hp < k.maxHp * 0.5 ? 1 + 0.15 * this.level('overclock') : 1));
    k.dodging = Math.max(0, k.dodging - dt);
    if (k.dashT > 0) {
      k.dashT -= dt;
      const sp = this.stage.speed * this.def.speedMult * DASH.speed;
      k.vx = k.dashDir.x * sp;
      k.vy = k.dashDir.y * sp;
      k.moving = true;
      // Trample: units in the way take a heavy hit and get thrown aside.
      for (const u of this.units) {
        if (u.dead || u.flying || k.dashHits.has(u) || Math.hypot(u.x - k.x, u.y - k.y) > k.r * 1.3 + u.r) continue;
        k.dashHits.add(u);
        const away = norm(u.x - k.x, u.y - k.y);
        const nx = u.x + away.x * k.r * 1.2;
        const ny = u.y + away.y * k.r * 1.2;
        if (!u.road && !isWater(nx, ny) && !this.blockedAt(nx, ny, u.r * 0.6, u.def.mob ? u.tier : 0)) {
          u.x = nx;
          u.y = ny;
        }
        this.damageUnit(u, this.baseDamage() * DASH.dmg);
      }
    }
    if (k.moving) {
      k.facing = k.dashT > 0 ? { ...k.dashDir } : norm(this.input.x, this.input.y);
      k.stillTime = 0;
      const before = Math.floor(k.walkPhase / Math.PI);
      k.walkPhase += (dt * speed) / Math.max(1, k.r) * 1.6;
      // A footfall every half stride: dust and, once big, a rumble.
      if (Math.floor(k.walkPhase / Math.PI) !== before && k.hopT <= 0 && !k.inWater) {
        const side = Math.floor(k.walkPhase / Math.PI) % 2 ? 1 : -1;
        this.fxEvent({ t: 'step', x: k.x - k.facing.y * k.r * 0.4 * side, y: k.y + k.facing.x * k.r * 0.4 * side, r: k.r, stage: k.stage });
        if (k.stage >= 4) this.shake = Math.max(this.shake, 0.06 + (k.stage - 4) * 0.04);
      }
    } else {
      k.stillTime += dt;
    }
    // Hop: a small kaiju vaults low obstacles (fences, hedges, parked cars) it can't break yet.
    if (k.hopT > 0) {
      k.hopT = Math.max(0, k.hopT - dt);
      const f = 1 - k.hopT / k.hopMax;
      k.z = Math.sin(f * Math.PI) * k.hopH;
      if (k.hopT === 0) {
        k.z = 0;
        this.fxEvent({ t: 'dust', x: k.x, y: k.y, r: k.r * 0.9 });
      }
    }
    k.x += k.vx * dt * (k.hopT > 0 ? 1.15 : 1);
    k.y += k.vy * dt * (k.hopT > 0 ? 1.15 : 1);

    // Crush what is smaller, bump into what is your size or bigger.
    let bumped = null;
    // Big Bones widens the crush, not the bump.
    const crushR = k.r * (1 + 0.12 * this.level('bigBones'));
    for (const o of this.grid.query(k.x - crushR, k.y - crushR, k.x + crushR, k.y + crushR)) {
      if (o.state !== 'intact') continue;
      const od = distToRect(k.x, k.y, o);
      if (od >= crushR) continue;
      const crushable = !o.landmark && (isSnack(o.tier, k.stage) || (!o.structure && o.tier <= k.stage));
      if (od >= k.r && !crushable) continue;
      const low = !o.structure && !o.landmark && !o.walkable && (o.height || 0) <= k.r * 2.2;
      if (low && k.hopT > 0) continue; // sailing over it
      if (crushable) this.destroyObject(o, norm(o.x - k.x, o.y - k.y), 'crush');
      else if (low && k.moving && (o.x - k.x) * k.facing.x + (o.y - k.y) * k.facing.y > -k.r * 0.2) {
        k.hopT = k.hopMax;
        k.hopH = Math.max((o.height || 3) * 1.5, k.r * 1.4);
        this.emit('hop');
      } else if (!o.walkable) {
        this.pushOut(k, o);
        bumped = o;
      }
    }
    // Shoving into a building chips it where you push.
    if (bumped && k.moving) {
      k.contactT += dt;
      if (k.contactT > 0.3) {
        k.contactT = 0;
        const hp = closestPoint(k.x, k.y, bumped);
        if (!this.damageObject(bumped, this.baseDamage() * 0.3, k.facing, 'hit', hp)) this.fxEvent({ t: 'dust', x: hp.x, y: hp.y, r: k.r * 0.8 });
        this.shake = Math.max(this.shake, 0.08);
      }
    } else k.contactT = 0.2;

    for (const u of this.units) {
      if (u.flying || u.dead) continue;
      if (u.tier < k.stage && Math.hypot(u.x - k.x, u.y - k.y) < k.r + u.r) this.killUnit(u);
    }
    for (const p of this.people) {
      if (!p.taken && k.stage > 1 && Math.hypot(p.x - k.x, p.y - k.y) < k.r + 1) {
        if (k.stage <= 2) this.eatPerson(p);
        else this.flingPerson(p, true);
      }
    }
    for (const c of this.traffic) {
      if (!c.dead && k.stage >= 2 && Math.hypot(c.x - k.x, c.y - k.y) < k.r + 4) this.killCar(c);
    }
    if (this.boss && !this.boss.dead) {
      const b = this.boss;
      const d = Math.hypot(k.x - b.x, k.y - b.y);
      const min = k.r + b.r * 0.8;
      if (d < min && d > 0) {
        k.x = b.x + ((k.x - b.x) / d) * min;
        k.y = b.y + ((k.y - b.y) / d) * min;
      }
    }

    k.attackCd -= dt;
    if (k.attackCd <= 0) {
      const target = this.findTarget();
      if (target) {
        this.performAttack(target);
        k.attackCd = this.def.attack.cooldown;
      } else k.attackCd = 0.1;
    }

    if (this.def.trail && k.moving) {
      k.trailT -= dt;
      if (k.trailT <= 0) {
        k.trailT = 0.22;
        this.fires.push({ x: k.x - k.facing.x * k.r * 0.8, y: k.y - k.facing.y * k.r * 0.8, r: k.r * 0.7, t: 3, max: 3, tick: 0 });
      }
    }
  }

  onDeck(k) {
    for (const o of this.grid.query(k.x - 1, k.y - 1, k.x + 1, k.y + 1)) {
      if (o.walkable && o.state === 'intact' && distToRect(k.x, k.y, o) < 1) return true;
    }
    return false;
  }

  pushOut(k, o) {
    const cp = closestPoint(k.x, k.y, o);
    const dx = k.x - cp.x;
    const dy = k.y - cp.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) {
      const px = o.w / 2 - Math.abs(k.x - o.x);
      const py = o.h / 2 - Math.abs(k.y - o.y);
      if (px < py) k.x += Math.sign(k.x - o.x || 1) * (px + k.r);
      else k.y += Math.sign(k.y - o.y || 1) * (py + k.r);
      return;
    }
    const push = k.r - d;
    k.x += (dx / d) * push;
    k.y += (dy / d) * push;
  }

  findTarget() {
    const k = this.kaiju;
    const reach = k.r * this.def.attack.range;
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - k.x, b.y - k.y) - b.r <= reach) return b;
    let best = null;
    let bestD = Infinity;
    const consider = (t, d) => {
      if (d <= reach && d < bestD) {
        best = t;
        bestD = d;
      }
    };
    for (const u of this.units) if (!u.dead && u.type !== 'jet') consider(u, Math.hypot(u.x - k.x, u.y - k.y) - u.r);
    if (best) return best;
    if (k.stage === 1) for (const p of this.people) if (!p.taken) consider(p, Math.hypot(p.x - k.x, p.y - k.y) - 0.8);
    if (best) return best;
    if (k.stage <= 2) for (const c of this.traffic) if (!c.dead) consider(c, Math.hypot(c.x - k.x, c.y - k.y) - 4);
    if (best) return best;
    for (const o of this.objectsNear(k.x, k.y, reach)) {
      if (!canDamage(o.tier, k.stage, o.landmark)) continue;
      consider(o, distToRect(k.x, k.y, o));
    }
    return best;
  }

  damageTarget(t, amount, dir, cause = 'hit') {
    if (t.isBoss) return this.damageBoss(amount);
    // Cops go down in one bite, whatever their toughness.
    if (t.isUnit && t.type === 'cop' && cause === 'bite') return this.eatCop(t);
    if (t.isUnit) return this.damageUnit(t, amount);
    if (t.isPerson) return this.kaiju.stage <= 2 && cause === 'bite' ? this.eatPerson(t) : this.flingPerson(t, false);
    if (t.isCar) return this.damageCar(t, amount);
    const k = this.kaiju;
    return this.damageObject(t, amount, dir, cause, closestPoint(k.x, k.y, t));
  }

  performAttack(target) {
    const k = this.kaiju;
    const atk = this.def.attack;
    const dmg = this.baseDamage() * atk.mult;
    const dir = norm(target.x - k.x, target.y - k.y);
    k.lastAttack = { kind: atk.kind, x: target.x, y: target.y, t: 0.25 };
    k.attackCount++;
    k.facing = k.moving ? k.facing : dir;
    if (atk.kind === 'bite') {
      this.damageTarget(target, dmg, dir, 'bite');
    } else if (atk.kind === 'pound') {
      const radius = k.r * atk.range;
      this.areaDamage(k.x, k.y, radius, dmg, 'hit', true);
      this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius, life: 0.35, max: 0.35, color: 0xf5e6c8, width: k.r * 0.18 });
      this.fxEvent({ t: 'dust', x: k.x, y: k.y, r: radius * 0.7 });
      this.shake = Math.max(this.shake, 0.15);
    } else if (atk.kind === 'zap') {
      const chain = [target];
      let cur = target;
      let amount = dmg;
      this.damageTarget(target, amount, dir, target.isPerson ? 'bite' : 'hit');
      for (let i = 0; i < atk.chains; i++) {
        const next = this.nearestChainTarget(cur, chain, k.r * 3);
        if (!next) break;
        amount *= 0.75;
        chain.push(next);
        this.damageTarget(next, amount, norm(next.x - cur.x, next.y - cur.y));
        cur = next;
      }
      this.fx.bolts.push({ points: [{ x: k.x, y: k.y }, ...chain.map((c) => ({ x: c.x, y: c.y }))], life: 0.22, max: 0.22, width: Math.max(0.4, k.r * 0.12) });
    }
  }

  nearestChainTarget(from, exclude, reach) {
    let best = null;
    let bestD = reach;
    for (const u of [...this.units, ...this.traffic]) {
      if (u.dead || exclude.includes(u) || u.type === 'jet') continue;
      const d = Math.hypot(u.x - from.x, u.y - from.y);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    if (best) return best;
    for (const o of this.objectsNear(from.x, from.y, reach)) {
      if (exclude.includes(o) || !canDamage(o.tier, this.kaiju.stage, o.landmark)) continue;
      const d = Math.hypot(o.x - from.x, o.y - from.y) * (o.vehicle ? 0.5 : 1);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  areaDamage(x, y, radius, amount, cause = 'hit', includeSnacks = true, hitsBoss = true) {
    const k = this.kaiju;
    for (const o of this.objectsNear(x, y, radius)) {
      if (!includeSnacks && isSnack(o.tier, k.stage)) continue;
      this.damageObject(o, amount, norm(o.x - x, o.y - y), cause, closestPoint(x, y, o));
    }
    for (const u of this.units) if (!u.dead && Math.hypot(u.x - x, u.y - y) < radius + u.r) this.damageUnit(u, amount);
    for (const p of this.people) if (!p.taken && Math.hypot(p.x - x, p.y - y) < radius) this.flingPerson(p, false, { x, y });
    for (const c of this.traffic) if (!c.dead && Math.hypot(c.x - x, c.y - y) < radius + 4) this.damageCar(c, amount);
    const b = this.boss;
    if (hitsBoss && b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - x, b.y - y) < radius + b.r) this.damageBoss(amount);
  }

  // Healing falls off the more you have healed lately, and sedative rounds stop it outright.
  heal(fraction) {
    const k = this.kaiju;
    if (k.sedated > 0 || k.hp >= k.maxHp) return;
    const f = fraction / (1 + k.healRecent * HEALING.falloff);
    k.healRecent += f;
    k.hp = Math.min(k.maxHp, k.hp + k.maxHp * f);
  }

  // ---------------------------------------------------------------- skill: charge and perfect dodges
  tryDash() {
    const k = this.kaiju;
    if (this.state !== 'playing' || k.dashCd > 0) return false;
    k.dashDir = k.moving ? norm(this.input.x, this.input.y) : { ...k.facing };
    k.facing = { ...k.dashDir };
    k.dashT = DASH.time;
    k.dashCd = DASH.cd;
    k.dodging = DASH.iframes;
    k.invuln = Math.max(k.invuln, DASH.iframes);
    k.perfect = false;
    k.dashHits = new Set();
    if (k.netted > 0) {
      k.netted = 0;
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.6, text: 'Tore free!', color: '#cfe3ff', life: 1, max: 1 });
    }
    this.fxEvent({ t: 'dash', x: k.x, y: k.y, dir: k.dashDir, r: k.r });
    this.emit('dash');
    return true;
  }

  // A hit that lands during the dash's i-frames.
  perfectDodge(x, y) {
    const k = this.kaiju;
    if (k.dodging <= 0 || k.perfect) return;
    k.perfect = true;
    k.dashCd *= 1 - DASH.refund;
    this.bumpCombo();
    this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.8, text: 'PERFECT DODGE', color: '#7ff0ff', life: 1.2, max: 1.2 });
    this.fxEvent({ t: 'perfect', x: x ?? k.x, y: y ?? k.y, r: k.r });
    this.emit('perfect');
    if (this.has('perfectRhythm')) {
      const R = k.r * 3 * (1 + 0.25 * (this.level('perfectRhythm') - 1));
      this.areaDamage(k.x, k.y, R, this.baseDamage() * 3, 'hit');
      this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: R, life: 0.45, max: 0.45, color: 0x7ff0ff, width: k.r * 0.4 });
      this.shake = Math.max(this.shake, 0.4);
    }
    if (this.time >= this.slowmoReadyAt) {
      this.slowmo = Math.max(this.slowmo, 0.3);
      this.slowmoReadyAt = this.time + 3;
    }
  }

  // ---------------------------------------------------------------- pressure
  addThreat(n) {
    this.threat = Math.min(100, this.threat + n);
    this.threatIdle = 0;
  }

  updateThreat(dt) {
    const k = this.kaiju;
    this.threatIdle += dt;
    const drain = THREAT.drain + this.threat * 0.03 + (this.threatIdle > THREAT.idle ? THREAT.decay : 0);
    this.threat = Math.max(0, this.threat - drain * dt);
    k.healRecent = Math.max(0, k.healRecent - HEALING.recover * dt);
    const steady = 1 + 0.25 * this.level('steadyFooting');
    k.sedated = Math.max(0, k.sedated - dt * steady);
    k.netted = Math.max(0, k.netted - dt * steady);
  }

  // How tough the military is right now: every level-up hardens new units.
  enemyScale() {
    // The very first session ramps up half as fast, so a new player gets to see the boss.
    const l = (this.kaiju.level - 1) * (this.firstRun ? 0.5 : 1);
    return { hp: 1 + ENEMY_SCALING.hpPerLevel * l, dmg: 1 + ENEMY_SCALING.dmgPerLevel * l };
  }

  addShield(fraction) {
    const k = this.kaiju;
    k.shield = Math.min(k.maxHp * 0.3, k.shield + k.maxHp * fraction);
  }

  takeDamage(amount, type = 'bullet') {
    const k = this.kaiju;
    if (this.state !== 'playing' || k.invuln > 0) return;
    // The first session is tuned so almost everyone sees the boss go down.
    let dmg = amount * this.diff.enemyDmg * (this.firstRun ? 0.8 : 1);
    if ((type === 'bullet' || type === 'shell') && this.has('thickHide')) dmg *= 1 - 0.08 * this.level('thickHide');
    if (k.shield > 0) {
      const absorbed = Math.min(k.shield, dmg);
      k.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) return;
    k.hp -= dmg;
    k.hitFlash = 0.12;
    this.fxEvent({ t: 'hurt', amount: dmg / k.maxHp });
    if (k.hp <= 0) {
      k.hp = 0;
      this.die();
    }
  }

  die() {
    if (this.reviveAvailable) {
      this.state = 'dead';
      this.emit('dead', { canRevive: true });
    } else this.end(false);
  }

  revive() {
    if (this.state !== 'dead' || !this.reviveAvailable) return false;
    const k = this.kaiju;
    this.reviveAvailable = false;
    k.hp = k.maxHp * 0.5;
    k.invuln = 2.5;
    this.projectiles = [];
    this.hazards = this.hazards.filter((h) => h.friendly);
    for (const u of this.units) {
      const d = norm(u.x - k.x, u.y - k.y);
      u.x += d.x * k.r * 3;
      u.y += d.y * k.r * 3;
    }
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: k.r * 5, life: 0.6, max: 0.6, color: 0xffffff, width: k.r * 0.3 });
    this.state = 'playing';
    this.emit('revived');
    return true;
  }

  giveUp() {
    if (this.state === 'dead') this.end(false);
  }

  // ---------------------------------------------------------------- growth & picks
  checkGrowth() {
    const k = this.kaiju;
    if (k.stage >= MAX_STAGE || k.biomass < this.stage.biomassToNext) return;
    // A full growth bar summons this size's boss; growing waits until it is beaten.
    if (!this.gateCleared[k.stage]) {
      k.biomass = this.stage.biomassToNext;
      if (!this.boss && this.gateTimer === null) {
        this.gateTimer = GATE.warn;
        const def = GATE_BOSSES[k.stage];
        this.emit('gateWarning', { name: def.name, title: def.title });
      }
      return;
    }
    if (this.boss && this.boss.gate) return; // grow once its death throes are over
    k.biomass -= this.stage.biomassToNext;
    this.grow();
  }

  grow() {
    const k = this.kaiju;
    const frac = k.hp / k.maxHp;
    k.stage++;
    const s = this.stage;
    k.maxHp = this.maxHpFor();
    k.hp = Math.min(k.maxHp, k.maxHp * frac + k.maxHp * 0.15);
    k.shield = Math.min(k.shield * 2, k.maxHp * 0.3);
    this.stats.stageTimes[k.stage] = this.time;
    this.director.spawnT = 2;
    if (THREAT.waveEvery[k.stage]) this.director.waveT = THREAT.firstWave;
    if (ELITES[k.stage]) this.director.eliteT = ELITE.first;
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: s.radius * 2.5, life: 0.8, max: 0.8, color: 0x9cff7a, width: s.radius * 0.25 });
    this.shake = Math.max(this.shake, 0.5);
    this.emit('grow', { stage: k.stage, name: s.name, size: s.size });
    if (k.stage === MAX_STAGE) this.bossTimer = BOSS.arriveDelay;
  }

  openPick() {
    if (this.state !== 'playing') return;
    let guarantee = null;
    // First session: Laser Eyes is guaranteed on the first pick so the player sees a big move early.
    if (this.firstRun && this.picksMade === 0) guarantee = 'laserEyes';
    const options = offerAugments({ held: this.held, rng: this.rng, guarantee });
    this.pick = { level: this.kaiju.level - this.pendingPicks + 1, options };
    this.state = 'picking';
    this.emit('pick', { pick: this.pick });
  }

  reroll(useAd = false) {
    const p = this.pick;
    if (!p || this.state !== 'picking') return false;
    if (this.rerolls > 0) this.rerolls--;
    else if (useAd && this.adRerollAvailable) this.adRerollAvailable = false;
    else return false;
    p.options = offerAugments({ held: this.held, rng: this.rng, exclude: p.options });
    this.emit('pick', { pick: p });
    return true;
  }

  choose(id) {
    if (this.state !== 'picking' || !this.pick.options.includes(id)) return false;
    const k = this.kaiju;
    const before = completedSets(this.held).map((s) => s.id);
    const level = applyPick(this.held, id);
    if (id === 'feast') this.heal(0.3);
    if (id === 'scrapPile') this.stats.scrap += 25 * k.stage * k.stage;
    if (id === 'toughness') {
      const frac = k.hp / k.maxHp;
      k.maxHp = this.maxHpFor();
      k.hp = k.maxHp * frac;
    }
    this.picksMade++;
    this.pendingPicks = Math.max(0, this.pendingPicks - 1);
    this.pick = null;
    this.state = 'playing';
    this.emit('picked', { id, level, name: AUGMENT_BY_ID[id].name });
    for (const set of completedSets(this.held)) if (!before.includes(set.id)) this.emit('synergy', { set });
    return true;
  }

  // Biomass grows the kaiju (slowly) and fills the XP bar (quickly); each level is a pick.
  addBiomass(amount) {
    const k = this.kaiju;
    k.biomass += amount;
    this.stats.biomass += amount;
    k.xp += xpFor(amount, k.stage) * (1 + 0.1 * this.level('appetite'));
    // One level per gain at most: a huge blast tops the bar up, it never chains picks.
    if (k.xp >= xpToNext(k.level)) {
      k.xp = Math.min(k.xp - xpToNext(k.level), xpToNext(k.level + 1) * XP.carry);
      k.level++;
      this.pendingPicks++;
      this.emit('levelUp', { level: k.level });
    }
  }

  debugLevel() {
    const k = this.kaiju;
    this.addBiomass(((xpToNext(k.level) - k.xp) / (1 + 0.1 * this.level('appetite'))) * Math.pow(4, k.stage - 1) + 1e-6);
  }

  // ---------------------------------------------------------------- destruction
  damageObject(o, amount, dir, cause = 'hit', at = null) {
    if (o.state !== 'intact' || !o.chunk.loaded) return false;
    const stage = this.kaiju.stage;
    if (!canDamage(o.tier, stage, o.landmark)) return false;
    if (isSnack(o.tier, stage) && !o.landmark) amount = o.hp;
    const frac = Math.min(1, amount / o.maxHp);
    o.hp -= amount;
    o.flash = 0.13;
    this.active.add(o);
    if (o.hp > 0) {
      if (o.structure) this.fxEvent({ t: 'hit', obj: o, x: at ? at.x : o.x, y: at ? at.y : o.y, dir: dir || { x: 0, y: 0 }, frac, h: Math.min(o.height, this.kaiju.r * 1.6) });
      else this.fxEvent({ t: 'chip', obj: o });
    } else this.destroyObject(o, dir, cause);
    return true;
  }

  destroyObject(o, dir, cause = 'hit') {
    if (o.state !== 'intact' || !o.chunk.loaded) return;
    const k = this.kaiju;
    o.hp = 0;
    o.fallDir = dir && (dir.x || dir.y) ? dir : norm(o.x - k.x, o.y - k.y);
    if (o.structure && this.collapsing < LIMITS.collapsing) {
      o.state = 'collapsing';
      o.collapseT = 0;
      this.collapsing++;
      this.active.add(o);
    } else o.state = 'rubble';
    this.fxEvent({ t: 'destroy', obj: o, dir: o.fallDir, cause, animated: o.state === 'collapsing' });

    if (cause !== 'boss') {
      const loot = lootFor(o.tier, k.stage, o.value);
      let biomass = loot.biomass;
      if (cause === 'chain' && !completedSets(this.held).some((s) => s.id === 'demolition')) biomass = 0;
      let scrap = loot.scrap * this.diff.loot * this.scrapMult();
      if (o.landmark) {
        scrap *= 4;
        this.stats.landmark = true;
        this.stats.rareMaterials += 1;
        this.emit('landmark', { name: this.cityDef.landmark });
      }
      this.addBiomass(biomass);
      this.stats.scrap += scrap;
      this.stats.destroyed++;
      if (o.structure) this.stats.buildings++;
      if (o.tier >= 5 && this.stats.firstSkyscraperAt === null) this.stats.firstSkyscraperAt = this.time;
      this.spawnOrbs(o.x, o.y, Math.min(10, 1 + o.tier * 2), biomass > 0);
      if (o.structure && o.tier >= k.stage) {
        this.fx.floaters.push({ x: o.x, y: o.y, h: o.height * 0.8, text: `+${Math.round(scrap)}`, color: '#ffd84a', life: 1.1, max: 1.1 });
      }
      if (o.vehicle && this.has('snackAttack')) this.heal(0.005 + 0.005 * this.level('snackAttack'));
      if (this.has('magneticHide') && (o.vehicle || o.structure)) this.addShield((o.vehicle ? 0.02 : 0.03) * (0.5 + 0.5 * this.level('magneticHide')));
      if (o.structure && o.tier >= k.stage && this.has('buildingEater')) this.heal(0.01 + 0.005 * this.level('buildingEater'));
    }

    // Every kill thumps the camera a little; the bigger it is next to you, the harder.
    const rel = o.tier - k.stage;
    if (cause !== 'boss') this.addThreat(o.landmark ? 40 : o.structure ? (rel >= 0 ? 4 : rel === -1 ? 1.5 : 0.3) : rel >= 0 ? 0.8 : 0.1);
    const thump = o.landmark ? 1 : o.structure ? (rel >= -1 ? 0.32 + (rel + 1) * 0.16 : 0.2) : rel >= 0 ? 0.16 : 0.1;
    this.shake = Math.max(this.shake, Math.min(1, thump));
    if (o.landmark) this.impact(0.2, 1);
    else if (o.structure && rel >= -1) this.impact(0.05 + 0.03 * (rel + 1), 0.35 + 0.2 * (rel + 1));
    else if (rel >= 0) this.impact(0.035, 0.15);
    if (cause !== 'crush' || rel >= -1) this.bumpCombo();
    // Slow-motion beat on a big collapse, rationed so a rampage at Apex stays full speed.
    if (o.landmark || (o.tier >= 4 && o.tier >= k.stage && cause !== 'crush' && cause !== 'boss' && this.time >= this.slowmoReadyAt)) {
      this.slowmo = Math.max(this.slowmo, o.landmark ? 0.6 : 0.25);
      this.slowmoReadyAt = this.time + 6;
    }
    if (cause !== 'boss' && (o.structure || o.tier >= k.stage - 1)) this.onKill();
    if (o.type === 'power_pole' && cause !== 'boss' && this.has('powerSurge')) this.powerSurge(o);
    if (o.structure && o.tier >= 3) {
      if (this.has('gasMain') && this.rng.chance(0.1 + 0.1 * this.level('gasMain'))) this.schedule(0.35, () => this.explode(o));
    }
  }

  explode(o) {
    const radius = Math.max(o.w, o.h) * 1.3;
    this.areaDamage(o.x, o.y, radius, o.maxHp * 0.8, 'chain');
    this.spawnExplosion(o.x, o.y, radius);
  }

  updateObjects(dt) {
    for (const o of this.active) {
      if (o.flash > 0) o.flash -= dt;
      if (o.state === 'collapsing') {
        o.collapseT += dt / (0.9 + o.tier * 0.15);
        if (o.collapseT >= 1) {
          o.state = 'rubble';
          this.collapsing--;
        }
      }
      if (o.flash <= 0 && o.state !== 'collapsing') this.active.delete(o);
    }
  }

  // ---------------------------------------------------------------- ambient life
  populate(initial = false) {
    const k = this.kaiju;
    const span = this.viewSpan();
    const want = k.stage <= 3 ? CROWD.people : Math.round(CROWD.people * 0.6);
    const maxR = Math.max(120, span * (initial ? 1.4 : 0.9));
    const minR = initial ? 10 : span * 0.5;
    let tries = 0;
    while (this.people.length < want && tries++ < want * 4) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(minR, maxR);
      const x = k.x + Math.cos(a) * d;
      const y = k.y + Math.sin(a) * d;
      if (isWater(x, y)) continue;
      const zc = this.cellAt(x, y);
      if (zc && zc.style === 'forest' && !this.rng.chance(0.15)) continue;
      if (this.blockedAt(x, y, 1)) continue;
      this.people.push({
        isPerson: true, x, y, heading: this.rng.range(0, Math.PI * 2), speed: this.rng.range(4, 7),
        state: 'walk', t: this.rng.range(1, 4), variant: this.rng.int(0, PERSON_VARIANTS - 1),
        tier: 1, z: 0, vz: 0, vx: 0, vy: 0, spin: 0, phase: this.rng.range(0, 6),
      });
    }
    if (k.stage <= 4) {
      const wantCars = CROWD.traffic;
      const roads = this.city.roads;
      tries = 0;
      while (this.traffic.length < wantCars && tries++ < wantCars * 6) {
        const r = roads[this.rng.int(0, roads.length - 1)];
        const t = this.rng.next();
        const x = r.x0 + (r.x1 - r.x0) * t;
        const y = r.y0 + (r.y1 - r.y0) * t;
        const d = Math.hypot(x - k.x, y - k.y);
        if (d > Math.max(400, span * 1.2) || (!initial && d < span * 0.4)) continue;
        this.traffic.push({
          isCar: true, road: r, t, dir: this.rng.chance(0.5) ? 1 : -1, x, y, heading: 0,
          speed: this.rng.range(28, 44), hp: CROWD.carHp, maxHp: CROWD.carHp, tier: 2, dead: false,
          model: this.rng.pick(['car', 'car', 'hatchback', 'taxi', 'van', 'pickup', 'bus']), variant: this.rng.int(0, 2), flash: 0,
        });
      }
    }
  }

  updatePeople(dt) {
    const k = this.kaiju;
    const span = this.viewSpan();
    const panicR = k.r * 10 + 25;
    for (const p of this.people) {
      if (p.state === 'eaten') {
        // The renderer animates the snatch-toss-gulp from p.t; the sim just keeps time.
        p.t += dt;
        if (!p.chomped && p.t >= EAT_TIME * 0.62) {
          p.chomped = true;
          this.fxEvent({ t: 'chomp', p });
        }
        if (p.t >= EAT_TIME) {
          p.state = 'gone';
          this.fxEvent({ t: 'swallow', p, burp: this.rng.chance(0.12) });
        }
        continue;
      }
      if (p.state === 'flung') {
        p.vz -= 60 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.spin += dt * 12;
        p.t -= dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.3;
          p.vx *= 0.5;
          p.vy *= 0.5;
        }
        continue;
      }
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const d = Math.hypot(dx, dy);
      if (d > span * 1.6) {
        p.t = -1;
        p.state = 'gone';
        continue;
      }
      if (d < panicR) {
        p.state = 'flee';
        p.heading = Math.atan2(dy, dx) + Math.sin(this.time * 3 + p.phase) * 0.5;
        p.speed = 13 + (p.variant % 3);
      } else if (p.state === 'flee' && d > panicR * 1.6) {
        p.state = 'walk';
        p.speed = this.rng.range(4, 7);
      }
      p.t -= dt;
      if (p.state === 'walk' && p.t <= 0) {
        p.t = this.rng.range(2, 6);
        p.heading = Math.round(this.rng.range(0, 4)) * (Math.PI / 2) + this.rng.range(-0.2, 0.2);
      }
      const nx = p.x + Math.cos(p.heading) * p.speed * dt;
      const ny = p.y + Math.sin(p.heading) * p.speed * dt;
      if (isWater(nx, ny) || this.blockedAt(nx, ny, 0.6)) {
        p.heading += Math.PI / 2 * (this.rng.chance(0.5) ? 1 : -1);
      } else {
        p.x = nx;
        p.y = ny;
      }
      p.phase += dt * p.speed * 1.5;
    }
    this.people = this.people.filter((p) => p.state !== 'gone' && !(p.state === 'flung' && p.t <= 0));
    this.director.crowdT -= dt;
    if (this.director.crowdT <= 0) {
      this.director.crowdT = 0.5;
      this.populate(false);
    }
  }

  eatCop(u) {
    if (u.dead) return false;
    const k = this.kaiju;
    if (!k.anim || k.anim.kind === 'eat') k.anim = { kind: 'eat', t: EAT_TIME, max: EAT_TIME };
    const toward = norm(u.x - k.x, u.y - k.y);
    if (!k.moving && (toward.x || toward.y)) k.facing = toward;
    this.fxEvent({ t: 'eat', x: u.x, y: u.y });
    this.fxEvent({ t: 'chomp', p: { variant: 0 } });
    u.hp = 0;
    u.eaten = true;
    if (this.has('ironStomach')) this.addBiomass(lootFor(u.tier, k.stage).biomass * 0.25 * this.level('ironStomach'));
    this.killUnit(u);
    return true;
  }

  // While the kaiju is small it eats people whole: a snatch, a toss, a chomp and a gulp.
  eatPerson(p) {
    if (p.taken) return true;
    const k = this.kaiju;
    p.taken = true;
    p.state = 'eaten';
    p.t = 0;
    p.x0 = p.x;
    p.y0 = p.y;
    p.chomped = false;
    this.stats.people++;
    this.addThreat(0.4);
    const loot = lootFor(1, k.stage, 1);
    this.addBiomass(loot.biomass * (1 + 0.25 * this.level('ironStomach')));
    this.onKill();
    this.stats.scrap += loot.scrap * this.diff.loot * 0.5;
    if (k.stage === 1) this.heal(0.01);
    if (!k.anim || k.anim.kind === 'eat') k.anim = { kind: 'eat', t: EAT_TIME, max: EAT_TIME };
    const toward = norm(p.x - k.x, p.y - k.y);
    if (!k.moving && (toward.x || toward.y)) k.facing = toward;
    this.fxEvent({ t: 'eat', x: p.x, y: p.y });
    this.bumpCombo();
    return true;
  }

  flingPerson(p, crushed, from = null) {
    if (p.taken) return true;
    p.taken = true;
    const k = this.kaiju;
    const src = from || k;
    const d = norm(p.x - src.x, p.y - src.y);
    p.state = 'flung';
    p.t = 1.6;
    const sp = 10 + k.r * 3;
    p.vx = d.x * sp + this.rng.range(-3, 3);
    p.vy = d.y * sp + this.rng.range(-3, 3);
    p.vz = 14 + k.r * 2;
    this.stats.people++;
    const loot = lootFor(1, k.stage, 1);
    this.addBiomass(loot.biomass);
    this.stats.scrap += loot.scrap * this.diff.loot * 0.5;
    if (k.stage === 1) this.heal(0.01);
    this.fxEvent({ t: 'poof', x: p.x, y: p.y, small: crushed });
    this.onKill();
    this.bumpCombo();
    return true;
  }

  updateTraffic(dt) {
    const k = this.kaiju;
    const span = this.viewSpan();
    const { graph, key } = this.city.roadGraph;
    for (const c of this.traffic) {
      if (c.dead) continue;
      const r = c.road;
      const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
      const dk = Math.hypot(c.x - k.x, c.y - k.y);
      const flee = dk < k.r * 8 + 30;
      c.t += (c.dir * c.speed * (flee ? 1.8 : 1) * dt) / len;
      if (c.t > 1 || c.t < 0) {
        const endX = c.t > 1 ? r.x1 : r.x0;
        const endY = c.t > 1 ? r.y1 : r.y0;
        const options = (graph.get(key(endX, endY)) || []).filter((o) => o !== r);
        if (!options.length) {
          c.dir *= -1;
          c.t = Math.max(0, Math.min(1, c.t));
        } else {
          const n = this.rng.pick(options);
          c.road = n;
          const atStart = Math.round(n.x0) === Math.round(endX) && Math.round(n.y0) === Math.round(endY);
          c.dir = atStart ? 1 : -1;
          c.t = atStart ? 0 : 1;
        }
      }
      const rr = c.road;
      const dirx = (rr.x1 - rr.x0) * c.dir;
      const diry = (rr.y1 - rr.y0) * c.dir;
      const n = norm(dirx, diry);
      // Drive on the right-hand lane.
      c.x = rr.x0 + (rr.x1 - rr.x0) * c.t - n.y * 12;
      c.y = rr.y0 + (rr.y1 - rr.y0) * c.t + n.x * 12;
      c.heading = Math.atan2(n.y, n.x);
      c.flash = Math.max(0, c.flash - dt);
      if (dk > Math.max(500, span * 1.8)) c.dead = true;
    }
    this.traffic = this.traffic.filter((c) => !c.dead);
  }

  damageCar(c, amount) {
    if (c.dead) return false;
    if (2 < this.kaiju.stage) amount = c.hp;
    c.hp -= amount;
    c.flash = 0.13;
    if (c.hp <= 0) this.killCar(c);
    return true;
  }

  killCar(c) {
    if (c.dead) return;
    c.dead = true;
    const k = this.kaiju;
    if (!c.silent) this.shake = Math.max(this.shake, k.stage <= 2 ? 0.2 : 0.1);
    if (k.stage <= 2) this.impact(0.04, 0.2);
    this.bumpCombo();
    this.onKill();
    this.addThreat(k.stage <= 2 ? 1 : 0.3);
    const loot = lootFor(2, k.stage, 1);
    this.addBiomass(loot.biomass);
    this.stats.scrap += loot.scrap * this.diff.loot;
    this.stats.destroyed++;
    if (this.has('snackAttack')) this.heal(0.005 + 0.005 * this.level('snackAttack'));
    if (this.has('magneticHide')) this.addShield(0.01 + 0.01 * this.level('magneticHide'));
    this.fxEvent({ t: 'carDie', car: c, dir: norm(c.x - k.x, c.y - k.y) });
    this.spawnOrbs(c.x, c.y, 3, true);
  }

  // ---------------------------------------------------------------- augments
  updateAugments(dt) {
    const k = this.kaiju;
    this.moves.update(dt);
    // Unkillable set bonus: the debris shield regenerates while standing still.
    if (k.stillTime > 0.5 && completedSets(this.held).some((s) => s.id === 'unkillable')) this.addShield(0.04 * dt);
  }

  nearestEnemy(reach) {
    const k = this.kaiju;
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - k.x, b.y - k.y) - b.r < reach) return b;
    let best = null;
    let bestD = reach;
    for (const u of this.units) {
      if (u.dead || u.type === 'jet') continue;
      const d = Math.hypot(u.x - k.x, u.y - k.y);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  // Damage everything along a segment (beams, lasers, fault lines).
  lineDamage(x1, y1, x2, y2, width, dmg) {
    const pad = width + 200;
    const dir = norm(x2 - x1, y2 - y1);
    for (const o of this.grid.query(Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad)) {
      if (o.state !== 'intact') continue;
      if (distToSegment(o.x, o.y, x1, y1, x2, y2) > width / 2 + Math.min(o.w, o.h) / 2) continue;
      this.damageObject(o, dmg, dir, 'hit', closestPoint(x1, y1, o));
    }
    for (const u of this.units) if (!u.dead && distToSegment(u.x, u.y, x1, y1, x2, y2) < width / 2 + u.r) this.damageUnit(u, dmg);
    for (const p of this.people) if (!p.taken && distToSegment(p.x, p.y, x1, y1, x2, y2) < width / 2) this.flingPerson(p, false);
    for (const c of this.traffic) if (!c.dead && distToSegment(c.x, c.y, x1, y1, x2, y2) < width / 2 + 4) this.damageCar(c, dmg);
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && distToSegment(b.x, b.y, x1, y1, x2, y2) < width / 2 + b.r) this.damageBoss(dmg);
  }

  callMeteor() {
    const k = this.kaiju;
    const half = this.viewSpan() * 0.6;
    let target = null;
    for (const o of this.grid.query(k.x - half, k.y - half, k.x + half, k.y + half)) {
      if (o.state !== 'intact' || !o.structure || !canDamage(o.tier, k.stage, o.landmark)) continue;
      if (!target || o.tier > target.tier || (o.tier === target.tier && o.maxHp * o.w * o.h > target.maxHp * target.w * target.h)) target = o;
    }
    const b = this.boss;
    const pos = target ? { x: target.x, y: target.y } : b && !b.dead ? { x: b.x, y: b.y } : null;
    if (!pos) return false;
    const radius = target ? Math.max(target.w, target.h) * 0.9 : b.r * 1.2;
    this.hazards.push({
      friendly: true, kind: 'circle', x: pos.x, y: pos.y, r: radius, t: 0, delay: 1.3, meteor: true,
      onHit: () => {
        if (target) this.damageObject(target, target.maxHp * 3, norm(target.x - k.x, target.y - k.y), 'hit', { x: target.x, y: target.y });
        this.areaDamage(pos.x, pos.y, radius * 1.5, this.baseDamage() * 6, 'hit');
        this.spawnExplosion(pos.x, pos.y, radius * 1.4);
        this.shake = Math.max(this.shake, 0.8);
      },
    });
    return true;
  }

  updateFires(dt) {
    for (const f of this.fires) {
      f.t -= dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.25;
        const dmg = this.baseDamage() * 0.5 * 0.25 * (f.dmgMul || 1);
        for (const o of this.objectsNear(f.x, f.y, f.r)) this.damageObject(o, dmg, null, 'hit', { x: f.x, y: f.y });
        for (const u of this.units) if (!u.dead && !u.flying && Math.hypot(u.x - f.x, u.y - f.y) < f.r + u.r) this.damageUnit(u, dmg);
        for (const p of this.people) if (!p.taken && Math.hypot(p.x - f.x, p.y - f.y) < f.r) this.flingPerson(p, false, f);
        const b = this.boss;
        if (b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - f.x, b.y - f.y) < f.r + b.r) this.damageBoss(dmg);
      }
    }
    this.fires = this.fires.filter((f) => f.t > 0);
  }

  // ---------------------------------------------------------------- military
  updateDirector(dt) {
    const k = this.kaiju;
    const esc = ESCALATION[k.stage];
    const dir = this.director;
    const th = this.threat / 100;
    // Threat speeds up reinforcements and lets more of them on the field at once.
    dir.spawnT -= dt * (1 + th * 1.2) * (this.boss && this.boss.gate ? 0.5 : 1);
    const alive = this.units.filter((u) => !u.dead && u.type !== 'jet').length;
    if (dir.spawnT <= 0) {
      dir.spawnT = esc.interval * this.rng.range(0.7, 1.3);
      if (alive < Math.round(SWARM.maxAlive[k.stage] * (1 + th * 0.8))) this.spawnGroup(this.rng.weighted(esc.weights));
    }
    if (esc.jetEvery) {
      dir.jetT -= dt * (1 + th);
      if (dir.jetT <= 0) {
        dir.jetT = esc.jetEvery * this.rng.range(0.8, 1.2);
        this.spawnJet();
      }
    }
    // Strike waves: announced, then a coordinated push from several sides.
    if (THREAT.waveEvery[k.stage] && !this.boss) {
      dir.waveT -= dt * (1 + th * 1.5);
      if (dir.waveT <= 0) {
        dir.waveT = THREAT.waveEvery[k.stage] * this.rng.range(0.85, 1.15);
        this.emit('wave', { stage: k.stage });
        this.schedule(2.5, () => this.spawnWave());
      }
    }
    if (ELITES[k.stage] && !this.boss) {
      dir.eliteT -= dt;
      if (dir.eliteT <= 0 && !this.units.some((u) => u.elite && !u.dead)) {
        dir.eliteT = ELITE.every;
        this.spawnElite();
      }
    }
  }

  // A squad: a few of the same unit in a loose cluster.
  spawnGroup(type, pos = this.spawnPoint(type), count = null) {
    const sd = this.scaledDef(type);
    if (count === null) count = SWARM.squad[type] || 1;
    const r = sd.r;
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = i * 2.4;
      const x = pos.x + Math.cos(a) * r * 2.6 * Math.sqrt(i);
      const y = pos.y + Math.sin(a) * r * 2.6 * Math.sqrt(i);
      const ok = !isWater(x, y) && !this.blockedAt(x, y, r);
      out.push(this.spawnUnit(type, ok ? x : pos.x, ok ? y : pos.y));
    }
    return out;
  }

  // A strike wave: units close in from three sides, with an artillery barrage onto the path
  // ahead once the kaiju is big and air strikes at the top sizes.
  spawnWave() {
    if (this.state !== 'playing' && this.state !== 'picking') return;
    const k = this.kaiju;
    const esc = ESCALATION[k.stage];
    const th = this.threat / 100;
    const n = 2 + k.stage + Math.round(th * 4);
    const span = this.viewSpan();
    const a0 = this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const type = this.rng.weighted(esc.weights);
      const a = a0 + (i % 3) * 2.1 + this.rng.range(-0.3, 0.3);
      const sd = this.scaledDef(type);
      const d = Math.max(span * 0.6, sd.standoff + k.r * 3);
      let pos = { x: k.x + Math.cos(a) * d, y: k.y + Math.sin(a) * d };
      if (!sd.flying && (isWater(pos.x, pos.y) || this.blockedAt(pos.x, pos.y, sd.r))) {
        const nr = this.nearestRoad(pos.x, pos.y);
        if (nr) pos = { x: nr.road.x0 + (nr.road.x1 - nr.road.x0) * nr.t, y: nr.road.y0 + (nr.road.y1 - nr.road.y0) * nr.t };
      }
      this.spawnGroup(type, pos);
    }
    if (k.stage >= 4) {
      const lead = k.moving ? 1.4 : 0.4;
      const dmg = (k.stage >= 5 ? 90 : 36) * this.enemyScale().dmg;
      for (let i = 0; i < 4 + k.stage; i++) {
        const t = i / (3 + k.stage);
        this.hazards.push({
          kind: 'circle', x: k.x + k.vx * lead * t + this.rng.range(-1, 1) * k.r * 2.5, y: k.y + k.vy * lead * t + this.rng.range(-1, 1) * k.r * 2.5,
          r: k.r * 1.1, t: 0, delay: 1.4 + t * 1.6, dmg, type: 'shell',
        });
      }
    }
    if (k.stage >= 5) for (let i = 0; i < 2; i++) this.schedule(0.6 + i * 1.2, () => this.spawnJet());
  }

  spawnElite() {
    const k = this.kaiju;
    const e = ELITES[k.stage];
    const u = this.spawnGroup(e.type, undefined, 1)[0];
    u.elite = true;
    u.name = e.name;
    u.hp *= ELITE.hp;
    u.maxHp = u.hp;
    u.dmgMul *= ELITE.dmg;
    u.r *= ELITE.size;
    u.tier = Math.max(u.tier, k.stage);
    this.emit('elite', { name: e.name });
    return u;
  }

  spawnPoint(type) {
    const k = this.kaiju;
    const def = this.scaledDef(type);
    const span = this.viewSpan();
    const dist = Math.max(span * this.rng.range(0.6, 0.8), def.standoff + k.r * 3);
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const x = k.x + Math.cos(a) * dist;
      const y = k.y + Math.sin(a) * dist;
      if (def.flying || (!isWater(x, y) && !this.blockedAt(x, y, def.r))) return { x, y };
    }
    const x = k.x + dist;
    const y = k.y;
    if (def.flying) return { x, y };
    // Fall back to the nearest street so ground units never appear inside a building.
    const nr = this.nearestRoad(x, y);
    return nr ? { x: nr.road.x0 + (nr.road.x1 - nr.road.x0) * nr.t, y: nr.road.y0 + (nr.road.y1 - nr.road.y0) * nr.t } : { x, y };
  }

  // A unit type's stats. (Units used to be scaled up from smaller sizes; now each size fields
  // units built to that size, so this is the plain definition.)
  scaledDef(type) {
    return { ...ENEMIES[type], scale: 1, lift: 0 };
  }

  spawnUnit(type, x, y) {
    const def = this.scaledDef(type);
    const sc = this.enemyScale();
    const u = {
      isUnit: true, type, def, x, y, r: def.r, tier: def.tier, scale: 1,
      hp: def.hp * this.diff.enemyHp * sc.hp, maxHp: def.hp * this.diff.enemyHp * sc.hp,
      dmgMul: sc.dmg * SWARM.dmg,
      flying: Boolean(def.flying), cd: this.rng.range(0.6, def.cd || 1), fear: 0, flash: 0,
      heading: 0, aim: 0, strafe: this.rng.chance(0.5) ? 1 : -1, dead: false, age: 0, id: Math.random(),
      stress: 0, windup: 0, windupMax: 0,
    };
    // Ground vehicles and roadblocks live on the road network.
    if ((def.vehicle && !def.flying) || type === 'roadblock') {
      const nr = this.nearestRoad(x, y);
      if (nr) {
        u.road = nr.road;
        u.t = nr.t;
        u.dir = 1;
        this.placeOnRoad(u);
      }
    }
    this.units.push(u);
    return u;
  }

  spawnJet() {
    const k = this.kaiju;
    const a = this.rng.range(0, Math.PI * 2);
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const L = this.viewSpan() * 0.9;
    // Aim at where the kaiju is heading, so standing still is not the only answer.
    const tx = k.x + k.vx * 0.6;
    const ty = k.y + k.vy * 0.6;
    const u = this.spawnUnit('jet', tx - d.x * L, ty - d.y * L);
    u.dir = d;
    u.line = { x1: tx - d.x * L, y1: ty - d.y * L, x2: tx + d.x * L, y2: ty + d.y * L };
    u.warn = 1.4;
    u.width = u.def.aoe;
    u.heading = a;
    u.struck = false;
    this.hazards.push({ kind: 'line', ...u.line, w: u.width, t: 0, delay: u.warn, visualOnly: true, jet: true });
  }

  updateUnits(dt) {
    const k = this.kaiju;
    const span = this.viewSpan();
    for (const u of this.units) {
      if (u.dead) continue;
      u.age += dt;
      u.flash = Math.max(0, u.flash - dt);
      if (u.type === 'jet') {
        this.updateJet(u, dt);
        continue;
      }
      // Frozen solid: no moving, no shooting.
      if (u.frozen > 0) {
        u.frozen -= dt;
        u.windup = 0;
        continue;
      }
      const def = u.def;
      const dx = k.x - u.x;
      const dy = k.y - u.y;
      const dist = Math.hypot(dx, dy) || 1;
      const to = { x: dx / dist, y: dy / dist };
      u.aim = Math.atan2(dy, dx);
      if (dist > span * 2.2) {
        u.dead = true; // left far behind; the director sends fresh units
        continue;
      }
      // Cops and patrol cars lose their nerve up close: they turn and run, and the closer the
      // kaiju gets the more panic slows them down, so a determined chase catches them.
      let flee = false;
      let speedMul = 1;
      if (def.skittish) {
        const want = k.r + def.standoff + u.r;
        const target = dist < want * 1.05 ? Math.min(1, (want * 1.05 - dist) / Math.max(1, want * 1.05 - k.r - u.r)) : 0;
        u.stress += (target - u.stress) * Math.min(1, dt * (target > u.stress ? 6 : 1.5));
        if (u.stress > 0.12) {
          flee = true;
          speedMul = 1.2 - 0.85 * u.stress;
          u.windup = 0;
        }
      }
      let mx = 0;
      let my = 0;
      if (u.road) {
        if (def.speed > 0) this.driveUnit(u, dt, dist, k.r + def.standoff + u.r, flee, speedMul);
        if (u.fear > 0) {
          u.fear -= dt;
          continue;
        }
      } else if (u.fear > 0) {
        u.fear -= dt;
        mx = -to.x;
        my = -to.y;
      } else if (flee) {
        mx = -to.x - to.y * u.strafe * 0.3;
        my = -to.y + to.x * u.strafe * 0.3;
      } else if (def.speed > 0) {
        const want = k.r + def.standoff + u.r;
        if (dist > want + want * 0.1) {
          mx = to.x;
          my = to.y;
        } else if (dist < want - want * 0.1) {
          mx = -to.x * 0.7;
          my = -to.y * 0.7;
        }
        const strafe = u.flying ? 0.9 : 0.35;
        mx += -to.y * u.strafe * strafe;
        my += to.x * u.strafe * strafe;
        if (u.age % 6 < dt) u.strafe *= this.rng.chance(0.3) ? -1 : 1;
      }
      const ml = Math.hypot(mx, my);
      if (ml > 0.01) {
        const sp = def.speed * (u.fear > 0 ? 1.3 : 1) * speedMul;
        const nx = u.x + (mx / ml) * sp * dt * Math.min(1, ml);
        const ny = u.y + (my / ml) * sp * dt * Math.min(1, ml);
        // Mechs trample anything up to house size; everything else walks around buildings.
        // Mobs stride over anything smaller than they are.
        const minTier = u.type === 'mech' ? 4 : def.mob ? u.tier : 0;
        if (u.type === 'mech') {
          for (const o of this.objectsNear(nx, ny, u.r * 0.8)) {
            if (o.structure && !o.walkable && !o.landmark && o.tier < 4) this.destroyObject(o, norm(o.x - u.x, o.y - u.y), 'boss');
          }
        }
        const pad = u.r * 0.6;
        const free = (x, y) => !isWater(x, y) && !this.blockedAt(x, y, pad, minTier);
        if (u.flying || free(nx, ny)) {
          u.x = nx;
          u.y = ny;
        } else if (free(nx, u.y)) u.x = nx;
        else if (free(u.x, ny)) u.y = ny;
        else if (!free(u.x, u.y)) {
          // Already stuck inside something (e.g. knocked back): let it walk out, but never
          // from grazing a wall to deeper inside it.
          const deep = (x, y) => this.blockedAt(x, y, pad * 0.4, minTier);
          if (!deep(nx, ny) || deep(u.x, u.y)) {
            u.x = nx;
            u.y = ny;
          }
        }
        u.heading = Math.atan2(my, mx);
      }
      if (u.fear > 0) continue;
      u.cd -= dt;
      if (def.attack === 'melee') {
        if (u.cd <= 0 && dist < k.r + u.r + k.r * 0.3) {
          this.takeDamage(def.dmg * u.dmgMul, 'bullet');
          u.cd = def.cd;
          // Spiked Hide: brawlers get hurt hitting you.
          if (this.has('spikedHide') && k.invuln <= 0) this.damageUnit(u, this.baseDamage() * 0.3 * this.level('spikedHide'));
        }
      } else if (u.windup > 0) {
        // Telegraphed shot: the shooter aims (shown as a sight line) before the round leaves.
        u.windup -= dt;
        if (u.windup <= 0) this.unitFire(u, dist);
      } else if (u.cd <= 0 && dist - k.r <= def.range && u.stress < 0.12) {
        u.cd = def.cd * this.rng.range(0.85, 1.15);
        const w = WINDUP[def.attack];
        if (w) {
          u.windup = w;
          u.windupMax = w;
        } else this.unitFire(u, dist);
      }
    }
    this.units = this.units.filter((u) => !u.dead);
  }

  updateJet(u, dt) {
    const k = this.kaiju;
    if (u.warn > 0) {
      u.warn -= dt;
      return;
    }
    const before = (k.x - u.x) * u.dir.x + (k.y - u.y) * u.dir.y;
    u.x += u.dir.x * u.def.speed * dt;
    u.y += u.dir.y * u.def.speed * dt;
    const after = (k.x - u.x) * u.dir.x + (k.y - u.y) * u.dir.y;
    if (!u.struck && before > 0 && after <= 0) {
      u.struck = true;
      const perp = Math.abs((k.x - u.x) * -u.dir.y + (k.y - u.y) * u.dir.x);
      if (perp < u.width / 2 + k.r) {
        this.takeDamage(u.def.dmg * u.dmgMul, 'bullet');
        this.spawnExplosion(k.x - u.dir.y * k.r * 0.3, k.y + u.dir.x * k.r * 0.3, k.r * 0.6);
      }
    }
    const past = (u.x - u.line.x2) * u.dir.x + (u.y - u.line.y2) * u.dir.y;
    if (past > 200) u.dead = true;
  }

  unitFire(u, dist) {
    this.fxEvent({ t: 'shot', kind: u.def.attack, x: u.x, y: u.y });
    const k = this.kaiju;
    const def = u.def;
    const lead = Math.min(0.6, dist / (def.proj || 600));
    const tx = k.x + k.vx * lead * 0.5;
    const ty = k.y + k.vy * lead * 0.5;
    const aim = norm(tx - u.x, ty - u.y);
    const dmg = def.dmg * u.dmgMul;
    const shoot = (angleOff, kind, type, extra = {}) => {
      const c = Math.cos(angleOff);
      const s = Math.sin(angleOff);
      const vx = aim.x * c - aim.y * s;
      const vy = aim.x * s + aim.y * c;
      // Never faster than the kaiju can sidestep, and drawn big enough to read at any zoom.
      const sp = Math.min(def.proj, this.kaijuSpeed() * (kind === 'net' ? 1.4 : 1.9));
      const r = kind === 'net' ? Math.max(1.5, k.r * 0.35) : Math.max(0.4, u.r * 0.1);
      this.projectiles.push({
        kind, x: u.x, y: u.y, vx: vx * sp, vy: vy * sp, r, size: Math.max(r, k.r * (kind === 'bullet' ? 0.2 : 0.26)),
        dmg, type, life: (def.range + k.r * 3) / sp + 0.4, age: 0, homing: kind === 'missile', h: u.flying ? u.r * 3 : u.r * 0.6,
        sedate: def.sedate || 0, ...extra,
      });
    };
    switch (def.attack) {
      case 'bullet':
        shoot(this.rng.range(-0.06, 0.06), 'bullet', 'bullet');
        break;
      case 'burst':
        for (const off of [-0.14, 0, 0.14]) shoot(off, 'bullet', 'bullet');
        break;
      case 'rocket':
        shoot(this.rng.range(-0.05, 0.05), 'rocket', 'explosive');
        break;
      case 'missile':
        shoot(-0.25, 'missile', 'explosive');
        shoot(0.25, 'missile', 'explosive');
        break;
      case 'net':
        shoot(0, 'net', 'bullet', { net: 2.6 });
        break;
      case 'volley':
        for (let i = 0; i < 6; i++) shoot(-0.5 + i * 0.2, 'missile', 'explosive');
        break;
      case 'shell':
        this.hazards.push({ kind: 'circle', x: tx + this.rng.range(-1, 1) * def.aoe * 0.4, y: ty + this.rng.range(-1, 1) * def.aoe * 0.4, r: def.aoe, t: 0, delay: 1.1, dmg, type: 'shell', from: { x: u.x, y: u.y } });
        break;
      case 'artillery':
        this.hazards.push({ kind: 'circle', x: k.x + this.rng.range(-k.r, k.r) * 0.4, y: k.y + this.rng.range(-k.r, k.r) * 0.4, r: def.aoe, t: 0, delay: 1.6, dmg, type: 'shell' });
        break;
      case 'laser': {
        const len = dist + k.r * 2;
        this.hazards.push({ kind: 'line', x1: u.x, y1: u.y, x2: u.x + aim.x * len, y2: u.y + aim.y * len, w: def.aoe, t: 0, delay: 0.7, dmg, type: 'laser', beam: 0xff5577 });
        break;
      }
      default:
        break;
    }
  }

  // Bloodlust: every kill takes a little off your cooldowns.
  onKill() {
    if (this.has('bloodlust')) this.moves.refund(0.08 * this.level('bloodlust'));
  }

  // Power Surge: a downed pole sends current down its line, shocking the street on both sides.
  powerSurge(pole) {
    const chain = pole.chunk.powerLines.find((c) => c.includes(pole));
    if (!chain) return;
    const i = chain.indexOf(pole);
    const segs = [chain[i - 1], chain[i + 1]].filter(Boolean).map((n) => [pole, n]);
    const k = this.kaiju;
    const dmg = this.baseDamage() * 1.2 * (1 + 0.5 * (this.level('powerSurge') - 1));
    let t = 0;
    let tick = 0;
    this.moves.active.push({
      update: (dt) => {
        t += dt;
        tick -= dt;
        if (tick <= 0) {
          tick = 0.3;
          for (const [a, b] of segs) {
            this.lineDamage(a.x, a.y, b.x, b.y, Math.max(8, k.r * 0.8), dmg);
            this.fx.bolts.push({ points: [{ x: a.x, y: a.y }, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: b.x, y: b.y }], life: 0.25, max: 0.25, width: 0.5, color: 0xffe36b });
          }
        }
        return t;
      },
      get done() {
        return t >= 2.5;
      },
    });
  }

  // Hatchlings from Brood Call: run at the nearest enemy, bite, and fade after a while.
  updateAllies(dt) {
    const k = this.kaiju;
    for (const a of this.allies) {
      a.life -= dt;
      a.cd -= dt;
      a.retarget -= dt;
      a.phase += dt * 10;
      if (a.retarget <= 0 || !a.target || a.target.dead || (a.target.state && a.target.state !== 'intact')) {
        a.retarget = 0.5;
        a.target = null;
        let best = k.r * 14;
        for (const u of this.units) {
          if (u.dead || u.flying) continue;
          const d = Math.hypot(u.x - a.x, u.y - a.y);
          if (d < best) {
            best = d;
            a.target = u;
          }
        }
        if (!a.target) {
          for (const o of this.objectsNear(a.x, a.y, k.r * 5)) {
            if (o.walkable || !canDamage(o.tier, k.stage, o.landmark) || o.tier < k.stage - 1) continue;
            a.target = o;
            break;
          }
        }
      }
      const t = a.target;
      if (t) {
        const tr = t.r || Math.min(t.w, t.h) / 2 || 2;
        const dx = t.x - a.x;
        const dy = t.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        a.heading = Math.atan2(dy, dx);
        if (d > tr + a.r) {
          a.x += (dx / d) * a.speed * dt;
          a.y += (dy / d) * a.speed * dt;
        } else if (a.cd <= 0) {
          a.cd = 0.5;
          this.damageTarget(t, a.dmg, norm(dx, dy), 'hit');
          this.fxEvent({ t: 'sparks', x: t.x, y: t.y, h: a.r, color: 0x9cff7a });
        }
      } else {
        // Nothing to fight: trot along beside the kaiju.
        const d = Math.hypot(k.x - a.x, k.y - a.y);
        if (d > k.r * 2) {
          a.x += ((k.x - a.x) / d) * a.speed * dt;
          a.y += ((k.y - a.y) / d) * a.speed * dt;
          a.heading = Math.atan2(k.y - a.y, k.x - a.x);
        }
      }
      if (a.life <= 0) {
        a.dead = true;
        this.fxEvent({ t: 'poof', x: a.x, y: a.y });
        if (a.boom) {
          this.areaDamage(a.x, a.y, k.r * 1.2, a.dmg * 3, 'hit');
          this.spawnExplosion(a.x, a.y, k.r);
        }
      }
    }
    this.allies = this.allies.filter((a) => !a.dead);
  }

  // Horde management pays: kills in quick succession build a multi-kill with a bonus.
  countMulti() {
    const m = this.multi;
    const k = this.kaiju;
    if (this.time - m.last > MULTI.window) {
      m.n = 0;
      m.tier = 0;
    }
    m.n++;
    m.last = this.time;
    const tier = MULTI.tiers.filter((n) => m.n >= n).length;
    if (tier > m.tier) {
      m.tier = tier;
      const bonus = Math.round(m.n * 4 * k.stage * this.diff.loot);
      this.stats.scrap += bonus;
      this.addBiomass(lootFor(k.stage, k.stage).biomass * 0.15 * tier);
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 3, text: `MULTI-KILL x${m.n}  +${bonus}`, color: '#ff8af0', life: 1.4, max: 1.4 });
      this.emit('multikill', { n: m.n, tier });
    }
  }

  // Counter-weapons: nets slow the kaiju down, sedative rounds stop it healing for a moment.
  statusHit(p) {
    const k = this.kaiju;
    if (p.net) {
      if (k.netted <= 0) this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.6, text: 'NETTED!', color: '#cfe3ff', life: 1.2, max: 1.2 });
      k.netted = Math.max(k.netted, p.net);
      this.emit('netted');
    }
    if (p.sedate) {
      if (k.sedated <= 0) this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.2, text: 'SEDATED', color: '#9dffb0', life: 1.1, max: 1.1 });
      k.sedated = Math.max(k.sedated, p.sedate);
    }
  }

  damageUnit(u, amount) {
    if (u.dead) return false;
    if (u.tier < this.kaiju.stage) amount = u.hp;
    // Frozen units shatter at the first hit.
    if (u.frozen > 0 && amount > 0) {
      amount = u.hp;
      this.fxEvent({ t: 'sparks', x: u.x, y: u.y, h: u.r, color: 0xdff8ff });
    }
    u.hp -= amount;
    u.flash = 0.13;
    if (u.hp <= 0) this.killUnit(u);
    return true;
  }

  killUnit(u) {
    if (u.dead) return;
    u.dead = true;
    const k = this.kaiju;
    this.shake = Math.max(this.shake, u.tier >= k.stage ? 0.3 : 0.14);
    if (u.tier >= k.stage) this.impact(0.06, 0.4);
    this.bumpCombo();
    const loot = lootFor(u.tier, k.stage, u.def.mob ? SWARM.loot * 0.5 : 1);
    this.addBiomass(loot.biomass);
    this.stats.scrap += loot.scrap * this.diff.loot * this.scrapMult();
    this.stats.units++;
    this.countMulti();
    this.onKill();
    this.addThreat(u.def.mob ? 0.6 : u.tier >= k.stage ? 2.5 : 1);
    if (u.elite) {
      // Elites pay out: a guaranteed level-up and a pile of scrap.
      k.xp = Math.max(k.xp, xpToNext(k.level));
      this.addBiomass(0);
      this.stats.scrap += loot.scrap * 6 * this.diff.loot;
      this.emit('eliteDown', { name: u.name });
      this.impact(0.12, 0.8);
      this.shake = Math.max(this.shake, 0.7);
    }
    if (!u.def.mob) this.heal(UNIT_HEAL);
    if (u.def.vehicle && this.has('snackAttack')) this.heal(0.005 + 0.005 * this.level('snackAttack'));
    if (u.def.vehicle && this.has('magneticHide')) this.addShield(0.01 + 0.01 * this.level('magneticHide'));
    this.fxEvent({ t: 'unitDie', u, dir: norm(u.x - k.x, u.y - k.y) });
    if (!u.def.human) this.spawnExplosion(u.x, u.y, u.r * 2.2);
    this.spawnOrbs(u.x, u.y, 2 + u.tier, true);
  }

  // ---------------------------------------------------------------- boss
  updateBoss(dt) {
    if (this.bossTimer !== null) {
      this.bossTimer -= dt;
      if (this.bossTimer <= 2 && !this._warned) {
        this._warned = true;
        this.emit('bossWarning', { name: BOSS.name });
      }
      if (this.bossTimer <= 0) {
        this.bossTimer = null;
        this.spawnBoss();
      }
    }
    if (this.gateTimer !== null) {
      this.gateTimer -= dt;
      if (this.gateTimer <= 0) {
        this.gateTimer = null;
        this.spawnGateBoss();
      }
    }
    const b = this.boss;
    if (!b || b.dead) return;
    const k = this.kaiju;
    const g = b.gate ? b.def : null;
    b.flash = Math.max(0, b.flash - dt);
    b.swingT = Math.max(0, (b.swingT || 0) - dt);
    const dx = k.x - b.x;
    const dy = k.y - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (b.state !== 'donut') b.aim = Math.atan2(dy, dx);
    const speed = g ? g.speed * this.stage.speed : BOSS.speed;
    const touch = () => {
      if (dist < b.r + k.r + (g ? b.unit * 0.3 : 10)) this.takeDamage((g ? g.contact * b.D : BOSS.contactDmg * b.dmgMul) * dt, 'melee');
    };

    if (b.state === 'enter') {
      b.walk += dt;
      b.y += (b.targetY - b.y) * Math.min(1, dt * 0.8);
      b.x += (b.targetX - b.x) * Math.min(1, dt * 0.8);
      if (Math.hypot(b.targetX - b.x, b.targetY - b.y) < (g ? b.r * 1.5 : 20)) {
        b.state = 'idle';
        b.next = 1.5;
        this.emit('bossFight', { name: b.name });
      }
      return;
    }
    if (b.state === 'charge') {
      b.walk += dt * 3;
      const step = (g ? (g.chargeSpeed || 3) * this.stage.speed : BOSS.chargeSpeed) * dt;
      b.x += b.chargeDir.x * step;
      b.y += b.chargeDir.y * step;
      b.chargeLeft -= step;
      if (!b.chargeHit && Math.hypot(k.x - b.x, k.y - b.y) < b.r + k.r) {
        b.chargeHit = true;
        if (k.dodging > 0) this.perfectDodge(b.x, b.y);
        this.takeDamage(g ? (g.chargeDmg || 0.2) * b.D : BOSS.chargeDmg * b.dmgMul, 'melee');
        this.shake = Math.max(this.shake, 0.9);
      }
      this.bossTrample(b);
      if (b.chargeLeft <= 0) {
        b.state = 'idle';
        b.next = b.phase === 2 ? 1.2 : 1.8;
      }
      return;
    }
    if (b.state === 'windup') return;
    if (b.state === 'donut') {
      // Mr. Whippy laps the kaiju in a tightening circle, leaving sticky sprinkles behind.
      b.donutT -= dt;
      b.donutR = Math.max(b.unit * 2.6, b.donutR - b.unit * 1.2 * dt);
      b.donutA += ((g.chargeSpeed || 3) * this.stage.speed * 0.8 * dt) / b.donutR;
      const nx = k.x + Math.cos(b.donutA) * b.donutR;
      const ny = k.y + Math.sin(b.donutA) * b.donutR;
      b.aim = Math.atan2(ny - b.y, nx - b.x);
      b.x = nx;
      b.y = ny;
      b.walk += dt * 3;
      b.dropT -= dt;
      b.shotT = (b.shotT || 0) - dt;
      if (b.shotT <= 0) {
        // Sprinkles fly out of the window as it laps you.
        b.shotT = 0.45;
        this.bossShot(b, Math.atan2(k.y - b.y, k.x - b.x), 'bullet', 0.04 * b.D);
      }
      if (b.dropT <= 0) {
        b.dropT = 0.28;
        this.hazards.push({ kind: 'circle', x: b.x, y: b.y, r: b.unit * 0.9, t: 0, delay: 0.75, dmg: 0.05 * b.D, type: 'explosive', slow: 0.9, boss: true });
      }
      touch();
      if (b.donutT <= 0) {
        b.state = 'idle';
        b.next = 1;
      }
      return;
    }
    if (b.state === 'break') {
      // Wrecking Bill sits down for his union break, and takes extra damage while he does.
      b.breakT -= dt;
      if (b.breakT <= 0) {
        b.state = 'idle';
        b.next = 0.8;
        this.bossQuip(b, 'Break is over. Back to work.');
      }
      return;
    }
    if (b.state === 'speech') {
      // The Mecha-Mayor's filibuster: immune while he talks, and his supporters arrive.
      b.speechT -= dt;
      b.quipT -= dt;
      if (b.quipT <= 0) {
        b.quipT = 1.5;
        this.bossQuip(b, 'speech');
        this.fx.rings.push({ x: b.x, y: b.y, r0: b.r, r1: b.r * 1.6, life: 0.6, max: 0.6, color: 0x7fc8ff, width: b.r * 0.12 });
      }
      if (b.speechT <= 0) {
        b.state = 'idle';
        b.shield = false;
        b.next = 1;
      }
      return;
    }
    const want = g ? b.r + k.r + g.keep * b.unit : b.r + k.r + 160;
    let mx = 0;
    let my = 0;
    if (dist > want) {
      mx = dx / dist;
      my = dy / dist;
    } else if (g && dist < want * 0.6) {
      mx = (-dx / dist) * 0.7;
      my = (-dy / dist) * 0.7;
    }
    if (g) {
      // Gate bosses sidestep while they line up the next attack.
      mx += (-dy / dist) * 0.4 * (b.strafe || 1);
      my += (dx / dist) * 0.4 * (b.strafe || 1);
      if (this.rng.chance(dt * 0.3)) b.strafe = -(b.strafe || 1);
    }
    const ml = Math.hypot(mx, my);
    if (ml > 0.05) {
      b.walk += dt;
      // Run away and a gate boss breaks into a sprint to keep up.
      const sp = g && dist > want * 2.5 ? speed * 1.7 : speed;
      const nx = b.x + (mx / ml) * sp * dt * Math.min(1, ml);
      const ny = b.y + (my / ml) * speed * dt * Math.min(1, ml);
      if (!g || !isWater(nx, ny)) {
        b.x = nx;
        b.y = ny;
      }
      this.bossTrample(b);
    }
    touch();
    if (b.phase === 1 && b.hp < b.maxHp * 0.5) {
      b.phase = 2;
      if (g) {
        this.emit('banner', { text: g.furious });
        this.shake = Math.max(this.shake, 0.5);
      } else {
        this.emit('banner', { text: `${BOSS.name} is enraged!` });
        for (let i = 0; i < 2; i++) {
          const p = this.spawnPoint('mech');
          this.spawnUnit('mech', p.x, p.y);
        }
      }
    }
    b.next -= dt;
    if (b.next <= 0) {
      const pattern = b.patterns[b.patternIndex % b.patterns.length];
      b.patternIndex++;
      b.next = (g ? GATE.interval : 3.3) * (b.phase === 2 ? 0.7 : 1);
      if (g) this.bossQuip(b, pattern);
      this.bossAttack(pattern);
    }
  }

  // A line of dialogue over the boss's head (and under its health bar).
  bossQuip(b, key) {
    const lines = b.def && b.def.quips[key];
    const text = lines ? lines[this.rng.int(0, lines.length - 1)] : key;
    if (!text) return;
    b.quip = text;
    b.quipUntil = this.time + 2.2;
    this.fx.floaters.push({ x: b.x, y: b.y, h: b.r * 2.4, text, color: '#fff3b0', life: 1.8, max: 1.8 });
  }

  spawnGateBoss() {
    const k = this.kaiju;
    const def = GATE_BOSSES[k.stage];
    const unit = this.stage.radius;
    const span = this.viewSpan();
    let x = k.x + span * 0.7;
    let y = k.y;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const tx = k.x + Math.cos(a) * span * 0.7;
      const ty = k.y + Math.sin(a) * span * 0.7;
      if (!isWater(tx, ty) && !isWater(k.x + (tx - k.x) * 0.4, k.y + (ty - k.y) * 0.4)) {
        x = tx;
        y = ty;
        break;
      }
    }
    // Health is counted in hits of the kaiju's own damage, so the fight lasts about as long
    // whatever was picked, and a little longer the higher the level.
    const hp = this.baseDamage() * (GATE.hits + GATE.hitsPerLevel * (k.level - 1)) * (def.hits || 1) * this.diff.enemyHp;
    const dmgMul = 1 + (this.enemyScale().dmg - 1) * 0.5;
    this.boss = {
      isBoss: true, gate: k.stage, def, model: def.id, name: def.name, title: def.title,
      x, y, r: def.r * unit, unit, hp, maxHp: hp, D: this.stage.maxHp * dmgMul * 0.6, dmgMul,
      state: 'enter', targetX: k.x + (x - k.x) * 0.45, targetY: k.y + (y - k.y) * 0.45,
      phase: 1, next: 1.5, patterns: def.patterns, patternIndex: 0, strafe: 1,
      aim: 0, flash: 0, walk: 0, dead: false, start: this.time, shield: false, quip: '', quipUntil: 0,
    };
    this.shake = Math.max(this.shake, 0.6);
    // Second wind: a boss fight never starts on your last legs.
    if (k.hp < k.maxHp * GATE.secondWind) {
      k.hp = k.maxHp * GATE.secondWind;
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.6, text: 'SECOND WIND', color: '#9cff7a', life: 1.4, max: 1.4 });
    }
    this.emit('gateBoss', { name: def.name, title: def.title });
  }

  spawnBoss() {
    const k = this.kaiju;
    const span = this.viewSpan();
    // The Coast Guard Mech wades in from the harbor side of the screen.
    const x = Math.max(BOSS.r, k.x - span * 0.95);
    const y = k.y;
    this.boss = {
      isBoss: true, name: BOSS.name, x, y, r: BOSS.r, hp: BOSS.hp, maxHp: BOSS.hp,
      state: 'enter', targetX: Math.max(BOSS.r, k.x - span * 0.45), targetY: y,
      phase: 1, next: 2, patterns: ['barrage', 'laser', 'charge'], patternIndex: 0,
      aim: 0, flash: 0, walk: 0, dead: false, start: this.time, dmgMul: 1 + (this.enemyScale().dmg - 1) * 0.5,
    };
    this.shake = 1;
    this.emit('bossSpawn', { name: BOSS.name });
  }

  bossTrample(b) {
    for (const o of this.objectsNear(b.x, b.y, b.r * 0.8)) {
      if (o.landmark || (b.gate && o.tier >= b.gate)) continue;
      this.destroyObject(o, norm(o.x - b.x, o.y - b.y), 'boss');
    }
  }

  bossAttack(pattern) {
    const b = this.boss;
    const k = this.kaiju;
    if (b.gate) return this.gateAttack(b, pattern);
    if (pattern === 'barrage') {
      const n = b.phase === 2 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : this.rng.range(k.r * 1.2, k.r * 3);
        this.hazards.push({ kind: 'circle', x: k.x + Math.cos(a) * d, y: k.y + Math.sin(a) * d, r: BOSS.barrageR, t: 0, delay: 1.3 + i * 0.07, dmg: BOSS.barrageDmg * b.dmgMul, type: 'explosive', from: { x: b.x, y: b.y } });
      }
    } else if (pattern === 'laser') {
      const d = norm(k.x - b.x, k.y - b.y);
      const len = k.r * 11;
      const line = { x1: b.x + d.x * b.r * 0.5, y1: b.y + d.y * b.r * 0.5, x2: b.x + d.x * len, y2: b.y + d.y * len };
      this.hazards.push({
        kind: 'line', ...line, w: BOSS.laserW, t: 0, delay: 1.0, dmg: BOSS.laserDmg * b.dmgMul, type: 'laser', beam: 0xff3b3b,
        onHit: () => {
          for (const o of this.grid.query(Math.min(line.x1, line.x2) - 100, Math.min(line.y1, line.y2) - 100, Math.max(line.x1, line.x2) + 100, Math.max(line.y1, line.y2) + 100)) {
            if (o.state === 'intact' && !o.landmark && distToSegment(o.x, o.y, line.x1, line.y1, line.x2, line.y2) < BOSS.laserW / 2 + Math.min(o.w, o.h) / 2) this.destroyObject(o, d, 'boss');
          }
        },
      });
    } else if (pattern === 'charge') {
      const d = norm(k.x - b.x, k.y - b.y);
      const len = Math.hypot(k.x - b.x, k.y - b.y) + k.r * 2;
      b.state = 'windup';
      this.hazards.push({
        kind: 'line', x1: b.x, y1: b.y, x2: b.x + d.x * len, y2: b.y + d.y * len, w: b.r * 1.2, t: 0, delay: 1.1, visualOnly: true,
        onHit: () => {
          if (!this.boss || this.boss.dead) return;
          b.state = 'charge';
          b.chargeDir = d;
          b.chargeLeft = len;
          b.chargeHit = false;
        },
      });
    }
  }

  // A boss projectile: slower than the kaiju can sidestep, like every other shot.
  bossShot(b, angle, kind, dmg) {
    const k = this.kaiju;
    const sp = this.kaijuSpeed() * (kind === 'missile' ? 1.25 : 1.8);
    const r = Math.max(0.4, b.unit * 0.18);
    this.projectiles.push({
      kind, x: b.x + Math.cos(angle) * b.r * 0.6, y: b.y + Math.sin(angle) * b.r * 0.6, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
      r, size: Math.max(r, k.r * 0.28), dmg, type: kind === 'bullet' ? 'bullet' : 'explosive', life: (b.unit * 18) / sp + 0.8, age: 0,
      homing: kind === 'missile', h: b.r * 1.2, sedate: 0,
    });
  }

  gateAttack(b, pattern) {
    const k = this.kaiju;
    const s = b.unit;
    const D = b.D;
    const p2 = b.phase === 2;
    const alive = () => this.boss === b && !b.dead;
    const aimAt = () => Math.atan2(k.y - b.y, k.x - b.x);
    // Ground attacks land where you are heading, so running in a straight line is not enough.
    const lead = (t) => ({ x: k.x + k.vx * t * 0.8, y: k.y + k.vy * t * 0.8 });
    const circles = (n, spread, r, dmg, delay, extra = {}) => {
      const c = lead(delay);
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : i === 1 ? s * 0.4 : this.rng.range(s * 1.2, s * spread);
        const from = i === 1 ? k : c;
        this.hazards.push({ kind: 'circle', x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d, r, t: 0, delay: delay + i * 0.08, dmg, type: 'explosive', from: { x: b.x, y: b.y }, boss: true, ...extra });
      }
    };
    const line = (x1, y1, x2, y2, w, dmg, delay, beam, extra = {}) => {
      this.hazards.push({ kind: 'line', x1, y1, x2, y2, w, t: 0, delay, dmg, type: 'laser', beam, boss: true, ...extra });
    };
    switch (pattern) {
      case 'pistol': {
        // Telegraphed burst: a laser sight, then three (five when furious) rounds.
        const a = aimAt();
        const len = Math.hypot(k.x - b.x, k.y - b.y) + s * 4;
        b.state = 'windup';
        line(b.x, b.y, b.x + Math.cos(a) * len, b.y + Math.sin(a) * len, s * 0.35, 0, 0.55, 0xff2a2a, {
          visualOnly: true,
          onHit: () => {
            if (!alive()) return;
            b.state = 'idle';
            const n = p2 ? 5 : 3;
            for (let i = 0; i < n; i++) {
              this.schedule(i * 0.13, () => {
                if (!alive()) return;
                this.bossShot(b, aimAt() + this.rng.range(-0.05, 0.05), 'bullet', 0.05 * D);
                this.fxEvent({ t: 'shot', kind: 'bullet', x: b.x, y: b.y });
              });
            }
          },
        });
        break;
      }
      case 'blink': {
        // Teleports to a new angle, then fans a spread of rounds.
        this.fx.rings.push({ x: b.x, y: b.y, r0: b.r * 0.3, r1: b.r * 2, life: 0.35, max: 0.35, color: 0x59c3ff, width: b.r * 0.3 });
        for (let i = 0; i < 8; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const d = this.rng.range(s * 3.5, s * 5.5);
          const x = k.x + Math.cos(a) * d;
          const y = k.y + Math.sin(a) * d;
          if (isWater(x, y)) continue;
          b.x = x;
          b.y = y;
          break;
        }
        this.fx.rings.push({ x: b.x, y: b.y, r0: b.r * 2, r1: b.r * 0.3, life: 0.35, max: 0.35, color: 0x59c3ff, width: b.r * 0.3 });
        b.state = 'windup';
        this.schedule(0.45, () => {
          if (!alive()) return;
          b.state = 'idle';
          const n = p2 ? 7 : 5;
          const a0 = aimAt();
          for (let i = 0; i < n; i++) this.bossShot(b, a0 + (i - (n - 1) / 2) * 0.16, 'bullet', 0.05 * D);
          this.fxEvent({ t: 'shot', kind: 'burst', x: b.x, y: b.y });
        });
        break;
      }
      case 'mines':
        // Exploding business cards scattered around the kaiju.
        circles(p2 ? 8 : 5, 4, s * 1.4, 0.1 * D, 1.5);
        break;
      case 'violation':
        // Homing violation notices.
        for (let i = 0, n = p2 ? 5 : 3; i < n; i++) this.bossShot(b, aimAt() + (i - (n - 1) / 2) * 0.45, 'missile', 0.05 * D);
        this.fxEvent({ t: 'shot', kind: 'missile', x: b.x, y: b.y });
        break;
      case 'manager': {
        // Calls in the local enforcement.
        const types = ESCALATION[b.gate].weights;
        for (let i = 0, n = p2 ? 2 : 1; i < n; i++) {
          const type = this.rng.weighted(types);
          const r = this.scaledDef(type).r;
          let pos = null;
          for (let t = 0; t < 8 && !pos; t++) {
            const a = this.rng.range(0, Math.PI * 2);
            const x = b.x + Math.cos(a) * b.r * 2;
            const y = b.y + Math.sin(a) * b.r * 2;
            if (!isWater(x, y) && !this.blockedAt(x, y, r)) pos = { x, y };
          }
          this.spawnGroup(type, pos || this.spawnPoint(type));
        }
        break;
      }
      case 'charge': {
        const d = norm(k.x - b.x, k.y - b.y);
        const len = Math.hypot(k.x - b.x, k.y - b.y) + k.r * 3;
        b.state = 'windup';
        line(b.x, b.y, b.x + d.x * len, b.y + d.y * len, b.r * 1.3, 0, p2 ? 0.8 : 1.05, 0xff5555, {
          visualOnly: true,
          onHit: () => {
            if (!alive()) return;
            b.state = 'charge';
            b.chargeDir = d;
            b.chargeLeft = len;
            b.chargeHit = false;
          },
        });
        break;
      }
      case 'scoops':
        // Lobbed scoops: each splat is a brain freeze that slows you down.
        circles(p2 ? 9 : 6, 4, s * 1.25, 0.07 * D, 1.2, { slow: 1.6 });
        break;
      case 'donut':
        b.state = 'donut';
        b.donutT = p2 ? 4 : 3;
        b.donutR = Math.max(s * 3, Math.hypot(b.x - k.x, b.y - k.y));
        b.donutA = Math.atan2(b.y - k.y, b.x - k.x);
        b.dropT = 0;
        break;
      case 'swing': {
        // Wrecking-ball spin: a ring of impacts sweeping round the crane at your distance,
        // chasing the way you are circling. Step in or out of the ring to dodge it.
        const a0 = aimAt();
        const R = Math.max(b.r + s, Math.min(s * 5, Math.hypot(k.x - b.x, k.y - b.y)));
        const n = Math.max(8, Math.ceil((Math.PI * 2 * R) / (s * 2.2)));
        const rel = { x: k.vx - 0, y: k.vy - 0 };
        const dirn = (Math.cos(a0) * rel.y - Math.sin(a0) * rel.x) >= 0 ? 1 : -1;
        const sweep = p2 ? Math.PI * 2 : Math.PI * 1.4;
        b.state = 'windup';
        b.swingT = 1.9;
        for (let i = 0; i < n; i++) {
          const a = a0 - dirn * 0.5 + dirn * ((sweep * i) / n);
          this.hazards.push({ kind: 'circle', x: b.x + Math.cos(a) * R, y: b.y + Math.sin(a) * R, r: s * 1.25, t: 0, delay: 0.85 + (i * 1.0) / n, dmg: 0.13 * D, type: 'explosive', boss: true });
        }
        this.schedule(1.9, () => {
          if (!alive()) return;
          if (b.state === 'windup') b.state = 'idle';
          // Loose rivets fly off the end of the swing.
          for (let i = 0; i < 5; i++) this.bossShot(b, aimAt() + (i - 2) * 0.18, 'bullet', 0.05 * D);
        });
        break;
      }
      case 'beams': {
        // Steel beams dropped across your path.
        const sp = Math.hypot(k.vx, k.vy);
        const a = sp > 1 ? Math.atan2(k.vy, k.vx) : aimAt();
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const n = p2 ? 6 : 4;
        const c = lead(1.3);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * s * 1.6 + this.rng.range(-0.3, 0.3) * s;
          const cx = c.x + ux * off;
          const cy = c.y + uy * off;
          const half = s * 3.2;
          line(cx - uy * half, cy + ux * half, cx + uy * half, cy - ux * half, s * 0.9, 0.12 * D, 1.1 + i * 0.18, 0x9aa3ad);
        }
        break;
      }
      case 'unionBreak':
        b.state = 'break';
        b.breakT = p2 ? 2.6 : 4;
        this.fx.floaters.push({ x: b.x, y: b.y, h: b.r * 1.6, text: 'ON BREAK: HIT HIM!', color: '#9cff7a', life: 2, max: 2 });
        break;
      case 'taxLaser': {
        const a0 = aimAt();
        const len = s * 12;
        for (const off of p2 ? [-0.35, 0, 0.35] : [0]) {
          const a = a0 + off;
          line(b.x + Math.cos(a) * b.r * 0.5, b.y + Math.sin(a) * b.r * 0.5, b.x + Math.cos(a) * len, b.y + Math.sin(a) * len, s, 0.22 * D, 1.0, 0xffd23f);
        }
        break;
      }
      case 'budgetCuts': {
        // A giant X slashed across where you stand (and a + after it when furious).
        const len = s * 4.5;
        const a0 = this.rng.range(0, Math.PI);
        const cut = (cx, cy, base, delay) => {
          for (const a of [base + Math.PI / 4, base - Math.PI / 4]) {
            line(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len, s * 0.8, 0.18 * D, delay, 0xff5a5a);
          }
        };
        const c = lead(1.1);
        cut(c.x, c.y, a0, 1.1);
        if (p2) cut(k.x + k.vx * 1.4, k.y + k.vy * 1.4, a0 + Math.PI / 4, 1.8);
        break;
      }
      case 'speech': {
        b.state = 'speech';
        b.shield = true;
        b.speechT = 3.5;
        b.quipT = 1.5;
        const types = ESCALATION[b.gate].weights;
        for (let i = 0; i < 2; i++) this.spawnGroup(this.rng.weighted(types));
        break;
      }
      case 'blimps':
        // Campaign blimps carpet-bomb the area, and a flurry of pamphlets comes your way.
        circles(p2 ? 12 : 8, 3.2, s * 1.3, 0.12 * D, 1.4);
        for (let i = 0; i < 6; i++) this.bossShot(b, aimAt() + (i - 2.5) * 0.16, 'bullet', 0.05 * D);
        break;
      default:
        break;
    }
  }

  defeatGateBoss(b) {
    const k = this.kaiju;
    b.hp = 0;
    b.dead = true;
    this.gateCleared[b.gate] = true;
    this.stats.gateBosses = (this.stats.gateBosses || 0) + 1;
    const scrap = 60 * b.gate * b.gate * this.diff.loot * this.scrapMult();
    this.stats.scrap += scrap;
    k.hp = Math.min(k.maxHp, k.hp + k.maxHp * GATE.heal);
    this.slowmo = 0.8;
    this.shake = Math.max(this.shake, 0.9);
    // Its leftover attacks fizzle out.
    this.hazards = this.hazards.filter((h) => !h.boss);
    this.projectiles = this.projectiles.filter((p) => p.friendly);
    for (let i = 0; i < 5; i++) this.schedule(i * 0.2, () => this.spawnExplosion(b.x + this.rng.range(-b.r, b.r), b.y + this.rng.range(-b.r, b.r), b.r * 0.9));
    this.fxEvent({ t: 'bossDie', b });
    this.fx.floaters.push({ x: b.x, y: b.y, h: b.r * 2, text: `+${Math.round(scrap)}`, color: '#ffd84a', life: 1.5, max: 1.5 });
    this.spawnOrbs(b.x, b.y, 14, true);
    for (const u of this.units) u.fear = Math.max(u.fear, 3);
    this.emit('gateBossDefeated', { name: b.name, text: b.def.defeat });
    // Clear the boss after the death throes; the full growth bar then grows the kaiju.
    this.schedule(1.4, () => {
      if (this.boss === b) this.boss = null;
    });
    return true;
  }

  damageBoss(amount) {
    const b = this.boss;
    if (!b || b.dead || b.state === 'enter') return false;
    if (b.shield) {
      if (this.time - (b.immuneAt || -9) > 0.7) {
        b.immuneAt = this.time;
        this.fx.floaters.push({ x: b.x, y: b.y, h: b.r * 1.8, text: 'IMMUNE', color: '#7fc8ff', life: 0.8, max: 0.8 });
      }
      return true;
    }
    if (b.state === 'break') amount *= 1.6;
    b.hp -= amount;
    b.flash = 0.08;
    if (b.hp <= 0 && b.gate) return this.defeatGateBoss(b);
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      this.stats.bossDefeated = true;
      this.stats.bossTime = this.time - b.start;
      this.stats.rareMaterials += 1;
      this.slowmo = 1.2;
      this.shake = 1.2;
      for (let i = 0; i < 6; i++) this.schedule(i * 0.25, () => this.spawnExplosion(b.x + this.rng.range(-b.r, b.r), b.y + this.rng.range(-b.r, b.r), b.r * 0.8));
      this.fxEvent({ t: 'bossDie', b });
      this.units.forEach((u) => (u.fear = 99));
      this.emit('bossDefeated', { name: b.name });
      this.schedule(2.2, () => this.end(true));
    }
    return true;
  }

  // ---------------------------------------------------------------- projectiles & hazards
  updateProjectiles(dt) {
    const k = this.kaiju;
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.friendly) {
        const t = p.target;
        const alive = t && !t.dead && !GONE.has(t.state);
        if (alive) {
          p.tx = t.x;
          p.ty = t.y;
        }
        if (p.tx !== undefined) {
          // Home in (spines and cars curve in from their launch spread), and land on the
          // target's last known spot if it is already gone.
          p.age = (p.age || 0) + dt;
          const d = norm(p.tx - p.x, p.ty - p.y);
          const turn = p.onHit ? Math.min(1, dt * (3 + p.age * 8)) : 1;
          p.vx += (d.x * p.speed - p.vx) * turn;
          p.vy += (d.y * p.speed - p.vy) * turn;
          const reach = (alive ? t.r || Math.min(t.w || 4, t.h || 4) / 2 || 2 : 2) + p.r;
          if (Math.hypot(p.tx - p.x, p.ty - p.y) < reach) {
            if (alive) this.damageTarget(t, p.dmg, d);
            if (p.onHit) p.onHit(p);
            else this.fxEvent({ t: 'dust', x: p.x, y: p.y, r: p.r * 3 });
            p.life = 0;
          }
        } else p.life = Math.min(p.life, 0.3);
      } else {
        p.age += dt;
        if (p.homing && p.age < 0.8) {
          const d = norm(k.x - p.x, k.y - p.y);
          const sp = Math.hypot(p.vx, p.vy);
          p.vx += (d.x * sp - p.vx) * Math.min(1, dt * 0.6);
          p.vy += (d.y * sp - p.vy) * Math.min(1, dt * 0.6);
        }
        if (Math.hypot(k.x - p.x, k.y - p.y) < k.r * 0.8 + p.r) {
          if (k.dodging > 0) this.perfectDodge(p.x, p.y);
          this.takeDamage(p.dmg, p.type);
          if (k.invuln <= 0) this.statusHit(p);
          if (p.kind !== 'bullet') this.spawnExplosion(p.x, p.y, k.r * 0.5);
          else this.fxEvent({ t: 'sparks', x: p.x, y: p.y, h: k.r, color: 0xffe16b });
          p.life = 0;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  updateHazards(dt) {
    const k = this.kaiju;
    for (const h of this.hazards) {
      h.t += dt;
      if (h.t < h.delay || h.done) continue;
      h.done = true;
      if (h.onHit) h.onHit();
      if (h.visualOnly || h.friendly) continue;
      let hit = false;
      if (h.kind === 'circle') {
        hit = Math.hypot(k.x - h.x, k.y - h.y) < h.r + k.r * 0.8;
        this.spawnExplosion(h.x, h.y, h.r);
      } else if (h.kind === 'line') {
        hit = distToSegment(k.x, k.y, h.x1, h.y1, h.x2, h.y2) < h.w / 2 + k.r * 0.8;
        this.fx.beams.push({ x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2, width: h.w, life: 0.3, max: 0.3, color: h.beam || 0xff5555, h: h.w * 0.6 });
      }
      if (hit && k.dodging > 0) this.perfectDodge(h.x, h.y);
      if (hit) this.takeDamage(h.dmg, h.type);
      if (hit && h.slow && k.invuln <= 0) {
        if (k.netted <= 0) this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.6, text: 'BRAIN FREEZE!', color: '#ffc0e0', life: 1.2, max: 1.2 });
        k.netted = Math.max(k.netted, h.slow);
      }
    }
    this.hazards = this.hazards.filter((h) => !h.done);
  }

  updateScheduled(dt) {
    if (!this.scheduled.length) return;
    const due = [];
    for (const s of this.scheduled) {
      s.t -= dt;
      if (s.t <= 0) due.push(s);
    }
    this.scheduled = this.scheduled.filter((s) => s.t > 0);
    for (const s of due) {
      if (this.state === 'won' || this.state === 'lost') break;
      s.fn();
    }
  }

  // ---------------------------------------------------------------- fx (data only; the renderer draws it)
  spawnExplosion(x, y, radius) {
    this.fxEvent({ t: 'explode', x, y, r: radius });
    this.fx.rings.push({ x, y, r0: radius * 0.2, r1: radius, life: 0.35, max: 0.35, color: 0xffb347, width: radius * 0.25 });
  }

  // Loot orbs burst out of kills and settle; walk close and they fly in for a small bonus
  // (green: XP, gold: scrap). Magnet Jaws widens the pickup range.
  spawnOrbs(x, y, n, biomass) {
    const os = this.fx.orbs;
    if (os.length > 140) os.splice(0, os.length - 140);
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = (0.6 + this.rng.range(0, 1)) * Math.max(4, this.kaiju.r * 4);
      os.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, color: biomass && i % 2 === 0 ? 0x7dff5a : 0xffd84a });
    }
  }

  updateFx(dt) {
    const k = this.kaiju;
    const { orbs, floaters, rings, beams, bolts } = this.fx;
    const scale = Math.max(4, k.r * 4);
    const pickR = k.r * 3 * (1 + 0.4 * this.level('magnetJaws')) + 6;
    for (const o of orbs) {
      o.t += dt;
      const dk = Math.hypot(k.x - o.x, k.y - o.y);
      if (dk < pickR || o.pulled) {
        o.pulled = true;
        const toK = norm(k.x - o.x, k.y - o.y);
        const pull = (o.t * 20 + 6) * scale;
        o.vx += toK.x * pull * dt;
        o.vy += toK.y * pull * dt;
      }
      o.vx *= 1 - dt * 3;
      o.vy *= 1 - dt * 3;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (dk < k.r * 0.7) {
        o.t = 99;
        if (o.color === 0x7dff5a) this.addBiomass(lootFor(k.stage, k.stage).biomass * 0.01);
        else this.stats.scrap += k.stage * 1.5 * this.diff.loot;
        this.fxEvent({ t: 'orb', combo: this.combo.n });
      } else if (o.t > 20) o.t = 99;
    }
    for (const f of floaters) f.life -= dt;
    for (const r of rings) r.life -= dt;
    for (const b of beams) b.life -= dt;
    for (const b of bolts) b.life -= dt;
    for (const list of [this.fx.slashes, this.fx.swirls, this.fx.cracks]) for (const e of list) e.life -= dt;
    this.fx.slashes = this.fx.slashes.filter((e) => e.life > 0);
    this.fx.swirls = this.fx.swirls.filter((e) => e.life > 0);
    this.fx.cracks = this.fx.cracks.filter((e) => e.life > 0);
    if (k.anim) {
      k.anim.t -= dt;
      if (k.anim.t <= 0) k.anim = null;
    }
    if (k.lastAttack) {
      k.lastAttack.t -= dt;
      if (k.lastAttack.t <= 0) k.lastAttack = null;
    }
    this.fx.orbs = orbs.filter((o) => o.t < 99);
    this.fx.floaters = floaters.filter((f) => f.life > 0);
    this.fx.rings = rings.filter((r) => r.life > 0);
    this.fx.beams = beams.filter((b) => b.life > 0);
    this.fx.bolts = bolts.filter((b) => b.life > 0);
  }

  // ---------------------------------------------------------------- results
  end(won) {
    if (this.state === 'won' || this.state === 'lost') return;
    this.state = won ? 'won' : 'lost';
    const s = this.stats;
    const scrapRaw = Math.round(s.scrap);
    const scrap = won ? scrapRaw : Math.round(scrapRaw * LOSS_SCRAP_KEEP);
    const sets = completedSets(this.held);
    const score = Math.round(
      s.buildings * 10 + s.units * 5 + s.people + scrapRaw * 0.5 + (won ? 5000 : 0) + (s.landmark ? 1000 : 0) + (won ? Math.max(0, 900 - this.time) * 5 : 0),
    );
    this.results = {
      won, time: this.time, kaiju: this.def.name, kaijuId: this.def.id, city: this.cityDef.name, cityId: this.cityDef.id,
      difficulty: this.diff.id, stage: this.kaiju.stage, scrap, scrapRaw, biomass: Math.round(s.biomass),
      buildings: s.buildings, destroyed: s.destroyed, units: s.units, people: s.people, landmark: s.landmark, rareMaterials: s.rareMaterials,
      augments: [...this.held.entries()].map(([id, level]) => ({ id, name: AUGMENT_BY_ID[id].name, level })),
      sets: sets.map((x) => x.name), title: sets.length ? sets.map((x) => x.name).join(' + ') : null,
      score, firstSkyscraperAt: s.firstSkyscraperAt, stageTimes: s.stageTimes,
    };
    this.emit('end', { results: this.results });
  }

  // Rewarded-ad placeholder: double the scrap from the finished run.
  doubleLoot() {
    if (!this.results || this.results.doubled) return false;
    this.results.scrap *= 2;
    this.results.doubled = true;
    return true;
  }

  debugGrow() {
    this.gateCleared[this.kaiju.stage] = true;
    if (this.kaiju.stage < MAX_STAGE) this.addBiomass(this.stage.biomassToNext - this.kaiju.biomass);
  }
}
