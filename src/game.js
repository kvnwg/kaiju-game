import {
  WORLD, STAGES, MAX_STAGE, KAIJU, CITIES, DIFFICULTIES, ENEMIES, ESCALATION, BOSS, GATE, GATE_BOSSES, LIMITS,
  UNIT_HEAL, HOSPITAL, DOCTOR_HEAL, LOSS_SCRAP_KEEP, CROWD, canDamage, isSnack, lootFor, EAT_TIME, xpToNext, xpFor, XP, THREAT, ENEMY_SCALING, ELITES, ELITE, HEALING, SWARM, DASH, MULTI,
} from './config.js';
import { AUGMENT_BY_ID, offerAugments, applyPick, completedSets, maxLevel } from './augments.js';
import { World, isWater, useCity, METRO } from './world.js';
import { createRng } from './rng.js';
import { norm, distToRect, distToSegment, closestPoint } from './geom.js';
import { MoveSystem } from './moves.js';
import { PERSON_VARIANTS, DOCTOR } from './models.js';
import { HOSPITAL_TYPES } from './buildings.js';
import { propDims } from './props.js';
import { objectPrice, vehiclePrice, unitPrice, bossPrice, shortMoney, TRAIN_PRICE, VAULT_PRICE } from './prices.js';
import { CHAPTER_MUL } from './meta.js';

// One bonus objective per run; finishing it pays a Supply Crate.
const OBJECTIVES = [
  { id: 'combo', text: 'Reach a x40 combo', goal: 40, stat: (g) => g.combo.best },
  { id: 'frenzy', text: 'Start 3 Feeding Frenzies', goal: 3, stat: (g) => g.stats.frenzies },
  { id: 'towers', text: 'Topple 12 buildings your size or bigger', goal: 12, stat: (g) => g.stats.bigTopples },
  { id: 'vaults', text: 'Crack 2 golden vaults', goal: 2, stat: (g) => g.stats.vaults },
  { id: 'bosses', text: 'Beat 3 size bosses', goal: 3, stat: (g) => g.stats.gateKills.length },
];
// City events: one or two per run, from size 2.
const CITY_EVENTS = {
  evac: { name: 'Evacuation!', sub: 'Buses packed with people are fleeing. Catch them', minStage: 2, maxStage: 4 },
  blackout: { name: 'Blackout!', sub: 'The power is out and the military can barely see you', minStage: 2, maxStage: 6 },
  meteors: { name: 'Meteor shower!', sub: 'Dodge them: they wreck everything they hit', minStage: 3, maxStage: 6 },
};

// What a run gets from the meta game (gear, Mutations, kaiju stars). A plain run uses this.
const SHIELD_CAP = 0.25; // most shield you can hold, as a share of max health
const NEUTRAL_META = {
  atkMul: 1, hpMul: 1, speedMul: 1, xpMul: 1, pickupMul: 1, dashCdMul: 1, rerolls: 0, revives: 0, perks: {}, fangs: null, skin: null,
};

// Aim time before a projectile leaves the barrel (seconds); shells, artillery and lasers
// already telegraph with ground markers.
const WINDUP = { bullet: 0.45, burst: 0.55, rocket: 0.7, missile: 0.6, net: 0.8, volley: 1 };
const GONE = new Set(['collapsing', 'rubble', 'removed', 'flung', 'eaten', 'gone']);

// Traffic keeps to the right-hand lane, this far from the middle of the road.
const LANE = 12;
// A junction is the area this far around where its roads meet (see Game.claimJunction).
const JUNCTION_R = 22;
// Road vehicles as boxes: length along the heading by width across, from their voxel models
// (traffic uses its prop's size). See Game.roadSpace.
const VEHICLE_BOX = { police: [12.8, 6.4], swat: [19.2, 9.6], tank: [30.8, 19.8], artillery: [38.4, 16.8], roadblock: [22.4, 6.4] };
function vehicleBox(v) {
  if (!v.box) {
    const d = v.isCar ? propDims(v.model) : null;
    const [len, wid] = d ? [d.w, d.h] : VEHICLE_BOX[v.def.model || v.type] || [v.r * 2, v.r];
    const m = v.elite ? 1.5 : 1;
    v.box = { hl: (len * m) / 2, hw: (wid * m) / 2 };
  }
  return v.box;
}

// How deep two vehicle boxes overlap (0 or less: they don't touch). Each is a centre, a facing
// as cos/sin, and half sizes {hl, hw}.
function boxDepth(x, y, c, s, a, ox, oy, oc, os, b) {
  let depth = Infinity;
  for (let i = 0; i < 4; i++) {
    const ax = i === 0 ? c : i === 1 ? -s : i === 2 ? oc : -os;
    const ay = i === 0 ? s : i === 1 ? c : i === 2 ? os : oc;
    const reach = a.hl * Math.abs(c * ax + s * ay) + a.hw * Math.abs(c * ay - s * ax)
      + b.hl * Math.abs(oc * ax + os * ay) + b.hw * Math.abs(oc * ay - os * ax);
    depth = Math.min(depth, reach - Math.abs((ox - x) * ax + (oy - y) * ay));
    if (depth <= 0) return depth;
  }
  return depth;
}

// Whether two routes through a junction (polylines of {x, y}) come within `clear` of each other.
function routesMeet(p, q, clear) {
  for (let i = 1; i < p.length; i++) {
    for (let j = 1; j < q.length; j++) {
      const a = p[i - 1];
      const b = p[i];
      const c = q[j - 1];
      const d = q[j];
      const side = (o, e, f) => (e.x - o.x) * (f.y - o.y) - (e.y - o.y) * (f.x - o.x);
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
      if (Math.min(distToSegment(c.x, c.y, a.x, a.y, b.x, b.y), distToSegment(d.x, d.y, a.x, a.y, b.x, b.y),
        distToSegment(a.x, a.y, c.x, c.y, d.x, d.y), distToSegment(b.x, b.y, c.x, c.y, d.x, d.y)) < clear) return true;
    }
  }
  return false;
}

export { distToRect, distToSegment };

export class Game {
  constructor({ kaijuId = 'rex', cityId = 'harbor', difficulty = 'normal', seed = Date.now(), citySeed = seed, firstRun = false, chapter = 1, meta = null } = {}) {
    this.def = KAIJU[kaijuId];
    this.cityDef = CITIES[cityId];
    // Each chapter multiplies enemy health and damage; gear and Mutations are what keep up.
    this.chapter = chapter;
    this.meta = { ...NEUTRAL_META, ...(meta || {}), perks: { ...((meta && meta.perks) || {}) } };
    const base = DIFFICULTIES[difficulty];
    const cm = Math.pow(CHAPTER_MUL, chapter - 1);
    this.diff = { ...base, enemyHp: base.enemyHp * cm, enemyDmg: base.enemyDmg * cm };
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
    this.roadVehicles = []; // everything on the streets this frame (see listRoadVehicles)
    this.junctions = new Map(); // junction key -> claims on it: [{ v, route, until }]
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
    this.spare = null; // (object) => true keeps it standing whatever hits it (the title shot's foreground)
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
    this.rerolls = 3 + this.meta.rerolls; // per run, Vampire Survivors style
    this.reviveAvailable = true; // the ad revive
    this.freeRevives = this.meta.revives; // from the Nine Lives Mutation
    this.adRerollAvailable = true;
    this.director = { spawnT: ESCALATION[1].firstDelay, jetT: 4, crowdT: 0, waveT: Infinity, eliteT: Infinity };
    this.events = [];
    this.results = null;
    this.stats = {
      scrap: 0, biomass: 0, buildings: 0, destroyed: 0, units: 0, people: 0, cars: 0,
      damage: 0, // property destroyed, in real dollars (see prices.js)
      landmark: false, rareMaterials: 0, firstSkyscraperAt: null, stageTimes: { 1: 0 }, gateKills: [],
    };
    this.kaiju.maxHp = this.kaiju.hp = this.maxHpFor(1);
    // Titan Heart: start one level up, with a pick waiting.
    if (this.meta.perks.titanHeart) {
      this.kaiju.level = 2;
      this.pendingPicks = 1;
    }
    this.perkT = { hook: 3, rocket: 5 };
    this.maxHpPenalty = 1; // the Mutation Altar's devil pact
    this.shieldBudget = 0; // Magnetic Hide's wreckage shield, refilled per second (see updateAugments)
    this.frenzy = 0;
    this.eatTimes = [];
    this.cityEvent = null;
    this.eventT = 75;
    this.eventsUsed = [];
    this.blackoutT = 0;
    this.vault = null;
    Object.assign(this.stats, { vaultGems: 0, vaults: 0, frenzies: 0, bigTopples: 0, objectiveDone: false });
    this.trainRespawn = 0;
    this.streamWorld(true);
    this.populate(true);
    this.objective = { ...OBJECTIVES[Math.floor(createRng(seed ^ 0x5bd1e995).next() * OBJECTIVES.length)], done: false };
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
    // New blocks per frame: a big kaiju needs about half a block a frame, so two keeps up
    // without a frame doing four blocks of generation at once.
    this.city.update(k.x, k.y, span * 1.3 + 520, initial ? Infinity : k.stage >= 5 ? 2 : 4, span * 0.6 + 150);
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
    this.stats.damage += TRAIN_PRICE;
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
    return this.stage.speed * this.def.speedMult * this.meta.speedMul * (1 + 0.08 * this.level('longLegs'));
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
    let m = this.stage.damage * this.meta.atkMul * (1 + 0.1 * this.level('might')) * (1 + 0.1 * this.level('glassCannon'));
    if (this.has('momentum')) m *= 1 + 0.08 * this.level('momentum') * (this.kaiju.momentum || 0);
    if (this.has('rageMode')) m *= 1 + (0.2 + 0.2 * this.level('rageMode')) * (1 - this.kaiju.hp / this.kaiju.maxHp);
    return m;
  }

  // ---- stats from passives
  maxHpFor(stage = this.kaiju.stage) {
    return STAGES[stage].maxHp * this.def.hpMult * this.meta.hpMul * (this.maxHpPenalty || 1) * (1 + 0.15 * this.level('toughness')) * (1 - 0.06 * this.level('glassCannon'));
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
  // `keepLane` holds it in the lane it is in (when something is in the way of moving across).
  placeOnRoad(u, dt = 0, keepLane = false) {
    const r = u.road;
    const n0 = norm(r.x1 - r.x0, r.y1 - r.y0);
    const lane = u.type === 'roadblock' ? 0 : Math.min(12 * (u.scale || 1), 26) * u.dir;
    if (!keepLane) u.lane = dt && u.lane !== undefined ? u.lane + (lane - u.lane) * Math.min(1, dt * 3) : lane;
    const tx = r.x0 + (r.x1 - r.x0) * u.t - n0.y * u.lane;
    const ty = r.y0 + (r.y1 - r.y0) * u.t + n0.x * u.lane;
    u.laneX = tx;
    u.laneY = ty;
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

  // The last word on vehicles never driving through each other: whether vehicle v, which was at
  // (x, y) facing `heading` before this frame's move, has now run into another vehicle (or
  // closer into one it was already touching). The caller then undoes the move.
  rammed(v, x, y, heading) {
    const a = vehicleBox(v);
    let c = null;
    let s = null;
    for (const o of this.roadVehicles) {
      if (o === v || o.dead) continue;
      const b = vehicleBox(o);
      const reach = a.hl + b.hl + 1;
      if (Math.abs(o.x - v.x) > reach || Math.abs(o.y - v.y) > reach) continue;
      if (c === null) {
        c = Math.cos(v.heading);
        s = Math.sin(v.heading);
      }
      const oc = Math.cos(o.heading);
      const os = Math.sin(o.heading);
      const now = boxDepth(v.x, v.y, c, s, a, o.x, o.y, oc, os, b);
      if (now <= 0.3) continue;
      const before = boxDepth(x, y, Math.cos(heading), Math.sin(heading), a, o.x, o.y, oc, os, b);
      // (Pulling away from a vehicle it is grazing is fine, as long as it doesn't swing into it.)
      if (now > before + 0.01 && (now > 1 || Math.hypot(o.x - v.x, o.y - v.y) < Math.hypot(o.x - x, o.y - y))) return true;
    }
    return false;
  }

  // The room around (x, y) on the streets: how far it is to the nearest vehicle's end.
  roadClearance(x, y) {
    let near = Infinity;
    for (const o of this.traffic) if (!o.dead) near = Math.min(near, Math.hypot(o.x - x, o.y - y) - vehicleBox(o).hl);
    for (const o of this.units) if (!o.dead && o.road) near = Math.min(near, Math.hypot(o.x - x, o.y - y) - vehicleBox(o).hl);
    return near;
  }

  // Whether a vehicle `length` long can appear at (x, y) without landing on another one.
  roadSpotFree(x, y, length) {
    return this.roadClearance(x, y) >= length / 2 + 8;
  }

  // Everything on the streets this frame: traffic, and police, SWAT vans, tanks and roadblocks.
  listRoadVehicles() {
    const list = this.roadVehicles;
    list.length = 0;
    if (this.junctions.size > 64) for (const [key, holds] of this.junctions) if (holds.every((h) => h.until < this.time)) this.junctions.delete(key);
    for (const c of this.traffic) if (!c.dead) list.push(c);
    for (const u of this.units) if (!u.dead && u.road && !u.flying) list.push(u);
    // Facings as of the start of the frame, for looking ahead (see roadSpace).
    for (const v of list) {
      v.hc = Math.cos(v.heading);
      v.hs = Math.sin(v.heading);
    }
    return list;
  }

  // How freely vehicle v may drive on along its lane, heading (fx, fy), as a share of its speed:
  // 1 with the way clear, easing to 0 over `ramp` as it closes on whatever is in its path, so
  // vehicles queue behind each other instead of driving through one another. The path is the
  // lane it is steering for (laneX, laneY), so a car making a U-turn isn't held up by the one
  // that was behind it.
  roadSpace(v, fx, fy, ramp) {
    const a = vehicleBox(v);
    const lx = v.laneX ?? v.x;
    const ly = v.laneY ?? v.y;
    let space = 1;
    let by = null;
    for (const o of this.roadVehicles) {
      if (o === v || o.dead) continue;
      const ahead = (o.x - v.x) * fx + (o.y - v.y) * fy;
      if (ahead <= 0 || ahead > 100) continue;
      // The other vehicle's box measured along our path and across it.
      const b = vehicleBox(o);
      const ox = o.hc;
      const oy = o.hs;
      const across = b.hl * Math.abs(oy * fx - ox * fy) + b.hw * Math.abs(ox * fx + oy * fy);
      if (Math.abs((o.y - ly) * fx - (o.x - lx) * fy) >= a.hw + across - 0.5) continue;
      const along = b.hl * Math.abs(ox * fx + oy * fy) + b.hw * Math.abs(oy * fx - ox * fy);
      const s = Math.max(0, Math.min(1, (ahead - a.hl - along - 2.5) / ramp));
      if (s < space) {
        space = s;
        by = o;
      }
    }
    v.blockedBy = space < 0.05 ? by : null;
    return space;
  }

  // Traffic takes a junction by claiming its route through it (see planTurn; a car without one,
  // turning round at a dead end, claims all of it). Police and military don't queue for
  // junctions (see driveUnit), though they still brake for what is in their way. A claim is
  // granted when no route claimed by another vehicle comes near it (or that vehicle is going
  // the same way) and nobody whose route it would cross has been waiting at the line for longer:
  // first come, first served. Claims and places in line lapse soon after their vehicle stops
  // renewing them. `dry` only asks; `wait` queues up when the claim is refused.
  claimJunction(v, x, y, route, { dry = false, wait = false } = {}) {
    const key = `${Math.round(x)},${Math.round(y)}`;
    let holds = this.junctions.get(key);
    const live = (h) => h.until >= this.time && !h.v.dead;
    const mine = holds && holds.find((h) => h.v === v && live(h));
    if (mine && !mine.waiting) {
      if (!dry) mine.until = this.time + 0.15;
      return true;
    }
    if (holds) {
      for (const h of holds) {
        if (h.v === v || !live(h)) continue;
        // Queued behind us, or not yet a matter for a vehicle only asking.
        if (h.waiting && (dry || (mine && mine.since <= h.since))) continue;
        if (h.route && route && h.route.from === route.from && h.route.to === route.to) continue;
        if (!h.route || !route || routesMeet(h.route.points, route.points, vehicleBox(h.v).hw + vehicleBox(v).hw + 3)) {
          if (wait && !dry) {
            if (mine) mine.until = this.time + 0.15;
            else this.junctions.set(key, [...holds.filter(live), { v, route, since: this.time, until: this.time + 0.15, waiting: true }]);
          }
          return false;
        }
      }
    }
    if (dry) return true;
    holds = (holds || []).filter((h) => live(h) && h.v !== v);
    holds.push({ v, route, until: this.time + 0.15 });
    this.junctions.set(key, holds);
    return true;
  }

  // Heading for the junction at (x, y), `along` away by road on `route`: a vehicle claims it
  // once it is close enough to have to brake (if it is first in line) or about to drive in, and
  // renews the claim all the way through. While it can't have it, it slows to wait short of it.
  // Returns the share of its speed it may use.
  junctionSpace(v, x, y, along, ramp, firstInLine, route = null) {
    const reach = JUNCTION_R + vehicleBox(v).hl;
    if (along > reach + ramp + 4) return 1;
    const claim = firstInLine || along <= reach + 2;
    if (this.claimJunction(v, x, y, route, { dry: !claim, wait: claim })) return 1;
    // Someone is crossing its way: wait short of the junction, but never stop in the middle of one.
    return along < reach - 2 ? 1 : Math.max(0, Math.min(1, (along - reach - 1) / ramp));
  }

  // A vehicle keeps its claim on a junction it is still inside, on the route it came by.
  holdJunction(v, x, y, route = null) {
    if (Math.hypot(v.x - x, v.y - y) <= JUNCTION_R + vehicleBox(v).hl) this.claimJunction(v, x, y, route);
  }

  // Waiting with nowhere to go (a roadblock, a jam, two vehicles nose to nose): true once it is
  // time to give up and turn around. Nose to nose, one of them gives way quickly.
  stuckOnRoad(v, space, dt) {
    v.stuck = space < 0.05 || v.jammed ? (v.stuck || 0) + dt : 0;
    if (!v.patience) v.patience = this.rng.range(2, 4);
    const faceOff = v.blockedBy && v.blockedBy.blockedBy === v;
    if (v.stuck < (faceOff ? v.patience * 0.2 : v.patience)) return false;
    v.stuck = 0;
    v.blockedBy = null;
    return true;
  }

  // Drive along the road network: toward the kaiju until in firing distance, away when scared.
  driveUnit(u, dt, dist, want, flee = false, speedMul = 1) {
    const k = this.kaiju;
    const r = u.road;
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) || 1;
    const was = { x: u.x, y: u.y, heading: u.heading, t: u.t, road: u.road, dir: u.dir, lane: u.lane, dirHold: u.dirHold, backoff: u.backoff };
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
    // Backing out of a jam: keep going the other way for a moment.
    if (u.backoff > 0) {
      u.backoff -= dt;
      move = u.dir;
    }
    if (move) {
      if (move !== u.dir) u.dirHold = 0.9;
      u.dir = move;
      // Police and military drive like emergency vehicles: they don't wait their turn at
      // junctions, but they still brake for whatever is in their lane. Queued behind another
      // unit they just wait (they can shoot from there); nose to nose with something, or wedged,
      // they back out of it.
      const speed = u.def.speed * (u.fear > 0 ? 1.3 : 1) * speedMul;
      const n = norm(r.x1 - r.x0, r.y1 - r.y0);
      const space = this.roadSpace(u, n.x * move, n.y * move, Math.max(8, speed * 0.4));
      const faceOff = u.blockedBy && u.blockedBy.blockedBy === u;
      u.stuck = faceOff || u.jammed ? (u.stuck || 0) + dt : 0;
      if (u.stuck > 1.2) {
        u.stuck = 0;
        u.dir = -u.dir;
        u.dirHold = 1.5;
        u.backoff = 1.5;
      }
      u.t += (move * speed * space * dt) / len;
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
    } else {
      u.stuck = 0;
      u.blockedBy = null;
    }
    this.placeOnRoad(u, dt);
    u.jammed = this.rammed(u, was.x, was.y, was.heading);
    if (u.jammed) {
      // Often only the move across to the other lane is in the way: try going on without it.
      const { t, road, dir } = u;
      Object.assign(u, was);
      if (road === was.road && dir === was.dir) {
        u.t = t;
        this.placeOnRoad(u, dt, true);
        u.jammed = this.rammed(u, was.x, was.y, was.heading);
        if (u.jammed) Object.assign(u, was);
      }
    }
  }

  // The nearest thing worth eating at this size: guides the player when the area is cleared.
  findPrey(maxR = 6000) {
    const k = this.kaiju;
    // From size 3 up, things big enough to count are rare: walk the loaded chunks' object lists
    // rather than sweep a huge box of mostly empty grid cells (that sweep cost 40 ms a second at
    // full size).
    if (k.stage >= 3) {
      // Nearest chunks first (each is one city block), stopping once no farther block can win.
      const cell = WORLD.cell;
      const chunks = [];
      for (const ch of this.city.chunks.values()) chunks.push([Math.hypot((ch.c + 0.5) * cell - k.x, (ch.r + 0.5) * cell - k.y), ch]);
      chunks.sort((a, b) => a[0] - b[0]);
      let best = null;
      let bestD = maxR;
      for (const [cd, ch] of chunks) {
        if (cd - cell > bestD) break;
        for (const o of ch.objects) {
          if (o.tier < k.stage || o.state !== 'intact') continue;
          const d = Math.hypot(o.x - k.x, o.y - k.y);
          if (d < bestD && canDamage(o.tier, k.stage, o.landmark)) {
            bestD = d;
            best = o;
          }
        }
      }
      return best;
    }
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
    this.updateThreat(dt);
    this.updateKaiju(dt);
    this.updateAugments(dt);
    this.updateGearPerks(dt);
    this.updateRunExtras(dt);
    this.updateDirector(dt);
    this.listRoadVehicles();
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
        // Club Tail sends them flying.
        const fling = this.meta.perks.clubTail ? 3 : 1.2;
        if (this.meta.perks.clubTail) u.fear = Math.max(u.fear, 1.2);
        const nx = u.x + away.x * k.r * fling;
        const ny = u.y + away.y * k.r * fling;
        if (!u.road && !isWater(nx, ny) && !this.blockedAt(nx, ny, u.r * 0.6, u.def.mob ? u.tier : 0)) {
          u.x = nx;
          u.y = ny;
        }
        this.damageUnit(u, this.baseDamage() * DASH.dmg * (this.meta.perks.whipTail ? 3 : 1));
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
        k.attackCd = this.def.attack.cooldown * (this.frenzy > 0 ? 0.5 : 1);
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
    let dmg = this.baseDamage() * atk.mult;
    const dir = norm(target.x - k.x, target.y - k.y);
    k.lastAttack = { kind: atk.kind, x: target.x, y: target.y, t: 0.25 };
    k.attackCount++;
    this.fxEvent({ t: 'attack', kind: atk.kind });
    k.facing = k.moving ? k.facing : dir;
    // Razor Claws: critical hits.
    if (this.meta.perks.razorClaws && this.rng.chance(0.15)) {
      dmg *= 2;
      this.fx.floaters.push({ x: target.x, y: target.y, h: k.r * 2, text: 'CRIT!', color: '#ff5a5a', life: 0.7, max: 0.7 });
    }
    if (atk.kind === 'bite') {
      this.fangHit(target, dmg, dir, 'bite');
      this.fangFollowUp(target, dmg, dir);
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
      this.fangHit(target, amount, dir, target.isPerson ? 'bite' : 'hit');
      this.fangFollowUp(target, dmg, dir);
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

  // A basic-attack hit through the equipped Fangs: Iron Jaw crunches buildings harder, Venom
  // Fangs poison units, and Magma Claws leave burning ground.
  fangHit(t, dmg, dir, cause = 'hit') {
    const f = this.meta.fangs;
    const isObj = !t.isUnit && !t.isPerson && !t.isCar && !t.isBoss;
    if (f && f.id === 'ironJaw' && isObj) dmg *= f.up ? 1.8 : 1.4;
    this.damageTarget(t, dmg, dir, cause);
    if (f && f.id === 'venomFangs' && t.isUnit && !t.dead) t.poison = { dps: dmg * 0.3, t: 3, spread: f.up };
    if (this.meta.perks.magmaClaws && this.time - (this.magmaAt || -9) > 0.5) {
      this.magmaAt = this.time;
      this.fires.push({ x: t.x, y: t.y, r: this.kaiju.r * 0.8, t: 2, max: 2, tick: 0 });
    }
  }

  // Weapon follow-ups after the main hit: Saw Teeth cleave, Thunder Fangs chain, Plasma Maw bolts.
  fangFollowUp(target, dmg, dir) {
    const f = this.meta.fangs;
    if (!f) return;
    const k = this.kaiju;
    if (f.id === 'sawTeeth') {
      const reach = k.r * this.def.attack.range + k.r;
      const half = ((f.up ? 200 : 120) * Math.PI) / 360;
      const inArc = (t) => {
        const d = Math.hypot(t.x - k.x, t.y - k.y);
        if (d > reach + (t.r || 0)) return false;
        const a = Math.atan2(t.y - k.y, t.x - k.x) - Math.atan2(dir.y, dir.x);
        return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half;
      };
      const hits = [];
      for (const u of this.units) if (!u.dead && u !== target && u.type !== 'jet' && inArc(u)) hits.push(u);
      for (const c of this.traffic) if (!c.dead && c !== target && inArc(c)) hits.push(c);
      for (const o of this.objectsNear(k.x, k.y, reach)) if (o !== target && canDamage(o.tier, k.stage, o.landmark) && inArc(o)) hits.push(o);
      for (const t of hits.slice(0, 8)) this.fangHit(t, dmg * 0.6, norm(t.x - k.x, t.y - k.y), 'hit');
      this.fx.slashes.push({ x: k.x, y: k.y, ang: Math.atan2(dir.y, dir.x), arc: half * 2, r: reach, side: 1, life: 0.2, max: 0.2, color: 0xffffff, h: k.r * 0.6 });
    } else if (f.id === 'thunderFangs') {
      const chain = [target];
      let cur = target;
      let amount = dmg;
      for (let i = 0; i < (f.up ? 4 : 2); i++) {
        const next = this.nearestChainTarget(cur, chain, k.r * 3.5);
        if (!next) break;
        amount *= 0.65;
        chain.push(next);
        this.damageTarget(next, amount, norm(next.x - cur.x, next.y - cur.y));
        cur = next;
      }
      if (chain.length > 1) this.fx.bolts.push({ points: chain.map((c) => ({ x: c.x, y: c.y })), life: 0.2, max: 0.2, width: Math.max(0.3, k.r * 0.1) });
    } else if (f.id === 'plasmaMaw' && k.attackCount % (f.up ? 3 : 4) === 0) {
      const sp = this.stage.speed * 3 + 40;
      const d = norm(target.x - k.x, target.y - k.y);
      this.projectiles.push({
        friendly: true, kind: 'spine', x: k.x, y: k.y, x0: k.x, y0: k.y, vx: d.x * sp, vy: d.y * sp, speed: sp,
        r: k.r * 0.25, size: k.r * 0.3, arc: k.r * 0.8, h0: k.r * 1.2, dmg: dmg * 2, life: 2.5, target, color: 0x6ff0ff, age: 0,
        onHit: (p) => {
          const r = k.r * 1.1;
          this.areaDamage(p.x, p.y, r, p.dmg * 0.7, 'hit');
          this.fx.rings.push({ x: p.x, y: p.y, r0: r * 0.2, r1: r, life: 0.3, max: 0.3, color: 0x6ff0ff, width: r * 0.3 });
        },
      });
    }
  }

  // Gear perks that run on their own: Hook Claws, Rocket Spines, Moss Hide.
  updateGearPerks(dt) {
    const k = this.kaiju;
    const perks = this.meta.perks;
    if (perks.hookClaws) {
      this.perkT.hook -= dt;
      if (this.perkT.hook <= 0) {
        this.perkT.hook = 3;
        let pulled = 0;
        for (const u of this.units) {
          if (u.dead || u.flying || u.road || u.tier >= k.stage || pulled >= 6) continue;
          const d = Math.hypot(u.x - k.x, u.y - k.y);
          if (d > k.r * 5 || d < k.r * 1.6) continue;
          const to = norm(k.x - u.x, k.y - u.y);
          const nx = k.x - to.x * k.r * 1.3;
          const ny = k.y - to.y * k.r * 1.3;
          if (this.blockedAt(nx, ny, u.r * 0.6, u.def.mob ? u.tier : 0)) continue;
          u.x = nx;
          u.y = ny;
          pulled++;
        }
        if (pulled) this.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 5, r1: k.r * 1.3, life: 0.3, max: 0.3, color: 0xc9d1db, width: k.r * 0.12 });
      }
    }
    if (perks.rocketSpines) {
      this.perkT.rocket -= dt;
      const target = this.perkT.rocket <= 0 ? this.nearestEnemy(k.r * 12) : null;
      if (target) {
        this.perkT.rocket = 5;
        const sp = this.stage.speed * 3.2 + 40;
        const d = norm(target.x - k.x, target.y - k.y);
        this.projectiles.push({
          friendly: true, kind: 'spine', x: k.x, y: k.y, x0: k.x, y0: k.y, vx: (d.x - d.y * 0.7) * sp, vy: (d.y + d.x * 0.7) * sp, speed: sp,
          r: k.r * 0.2, size: k.r * 0.22, arc: k.r * 2.6, h0: k.r * 1.4, dmg: this.baseDamage() * 1.5, life: 3, target, color: 0xffd23f, age: 0,
          onHit: (p) => this.areaDamage(p.x, p.y, k.r * 0.7, p.dmg * 0.5, 'hit'),
        });
      }
    }
    if (perks.mossHide && this.time - (k.lastHitAt ?? -9) > 4) this.addShield(0.01 * dt, false);
  }

  // ---------------------------------------------------------------- run extras
  // Five bites inside 3 seconds start a Feeding Frenzy: faster bites and a pull on nearby people.
  noteEat() {
    const t = this.time;
    this.eatTimes = this.eatTimes.filter((x) => t - x < 3);
    this.eatTimes.push(t);
    if (this.eatTimes.length >= 5 && this.frenzy <= 0) {
      this.frenzy = 4;
      this.eatTimes = [];
      this.stats.frenzies++;
      const k = this.kaiju;
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 3, text: 'FEEDING FRENZY!', color: '#ff5a5a', life: 1.6, max: 1.6 });
      this.emit('frenzy');
    }
  }

  updateRunExtras(dt) {
    const k = this.kaiju;
    if (this.frenzy > 0) {
      this.frenzy -= dt;
      for (const p of this.people) {
        if (p.taken) continue;
        const d = Math.hypot(k.x - p.x, k.y - p.y);
        if (d < k.r * 8 && d > k.r * 0.6) {
          p.x += ((k.x - p.x) / d) * k.r * 3 * dt;
          p.y += ((k.y - p.y) / d) * k.r * 3 * dt;
        }
      }
    }
    // The run's bonus objective.
    const ob = this.objective;
    if (!ob.done && ob.stat(this) >= ob.goal) {
      ob.done = true;
      this.stats.objectiveDone = true;
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 3, text: 'OBJECTIVE COMPLETE!', color: '#ffd84a', life: 1.8, max: 1.8 });
      this.emit('objective', { text: ob.text });
    }
    // City events, from size 2.
    if (this.blackoutT > 0) this.blackoutT -= dt;
    if (this.cityEvent && this.cityEvent.t > 0) {
      this.cityEvent.t -= dt;
      if (this.cityEvent.id === 'meteors') this.meteorTick(dt);
      if (this.cityEvent.t <= 0) this.cityEvent = null;
    }
    if (k.stage >= 2 && !this.boss && this.gateTimer === null && this.eventsUsed.length < 2) {
      this.eventT -= dt;
      if (this.eventT <= 0) {
        this.eventT = this.rng.range(80, 130);
        const options = Object.keys(CITY_EVENTS).filter((id) => !this.eventsUsed.includes(id) && k.stage >= CITY_EVENTS[id].minStage && k.stage <= CITY_EVENTS[id].maxStage);
        if (options.length) this.startCityEvent(this.rng.pick(options));
      }
    }
  }

  startCityEvent(id) {
    const k = this.kaiju;
    const ev = CITY_EVENTS[id];
    this.eventsUsed.push(id);
    this.cityEvent = { id, t: id === 'blackout' ? 30 : id === 'meteors' ? 18 : 1, tick: 0 };
    if (id === 'blackout') this.blackoutT = 30;
    if (id === 'evac') {
      const roads = this.city.roads.filter((r) => Math.hypot((r.x0 + r.x1) / 2 - k.x, (r.y0 + r.y1) / 2 - k.y) < this.viewSpan() * 0.9);
      // Four buses, each on a clear stretch of street.
      let buses = 0;
      for (let tries = 0; buses < 4 && roads.length && tries < 40; tries++) {
        const r = this.rng.pick(roads);
        const t = 0.15 + this.rng.next() * 0.7;
        if (!this.roadSpotFree(r.x0 + (r.x1 - r.x0) * t, r.y0 + (r.y1 - r.y0) * t, propDims('bus').w)) continue;
        buses++;
        this.traffic.push({
          isCar: true, road: r, t, dir: this.rng.chance(0.5) ? 1 : -1, x: r.x0 + (r.x1 - r.x0) * t, y: r.y0 + (r.y1 - r.y0) * t, heading: 0,
          speed: 34, hp: CROWD.carHp * 2, maxHp: CROWD.carHp * 2, tier: 2, dead: false, model: 'bus', variant: 0, flash: 0, evac: true,
        });
      }
    }
    this.emit('cityEvent', { id, name: ev.name, sub: ev.sub });
  }

  // Meteor shower: rocks land around the view; they hurt the kaiju and flatten what they hit.
  meteorTick(dt) {
    const ev = this.cityEvent;
    ev.tick -= dt;
    if (ev.tick > 0) return;
    ev.tick = 0.55;
    const k = this.kaiju;
    const span = this.viewSpan();
    const x = k.x + this.rng.range(-0.5, 0.5) * span;
    const y = k.y + this.rng.range(-0.4, 0.4) * span;
    const r = k.r * 1.4;
    this.hazards.push({
      kind: 'circle', x, y, r, t: 0, delay: 1.3, dmg: this.stage.maxHp * 0.06, type: 'explosive', meteor: true,
      onHit: () => {
        for (const o of this.objectsNear(x, y, r)) if (canDamage(o.tier, k.stage, o.landmark)) this.damageObject(o, o.maxHp * 2, norm(o.x - x, o.y - y), 'hit', { x, y });
        for (const u of this.units) if (!u.dead && Math.hypot(u.x - x, u.y - y) < r + u.r) this.damageUnit(u, u.maxHp);
        this.shake = Math.max(this.shake, 0.4);
      },
    });
  }

  // A golden vault: a building your size that pays gems when it falls.
  placeVault() {
    if (this.vault && this.vault.state === 'intact') return;
    const k = this.kaiju;
    const span = this.viewSpan();
    const options = this.grid.query(k.x - span, k.y - span, k.x + span, k.y + span).filter((o) => o.structure && o.state === 'intact' && !o.landmark
      && !HOSPITAL_TYPES.has(o.type) && o.tier >= k.stage && o.tier <= k.stage + 1 && Math.hypot(o.x - k.x, o.y - k.y) > span * 0.3);
    if (!options.length) return;
    const o = options.find((x) => x.type === 'bank') || this.rng.pick(options);
    o.golden = true;
    this.vault = o;
    this.emit('vault');
  }

  crackVault(o) {
    const k = this.kaiju;
    const gems = 10 + 5 * k.stage;
    o.golden = false;
    this.vault = null;
    this.stats.vaults++;
    this.stats.vaultGems += gems;
    this.stats.scrap += lootFor(o.tier, k.stage).scrap * 5;
    this.stats.damage += VAULT_PRICE;
    this.fx.floaters.push({ x: o.x, y: o.y, h: o.height, text: `VAULT! +${gems} GEMS`, color: '#ffd84a', life: 2, max: 2 });
    this.fx.rings.push({ x: o.x, y: o.y, r0: k.r, r1: k.r * 4, life: 0.7, max: 0.7, color: 0xffd84a, width: k.r * 0.4 });
    this.spawnOrbs(o.x, o.y, 12, false);
    this.emit('vaultCracked', { gems });
  }

  // Mutation Altar, after each size boss: an angel (heal and a free reroll) or a devil's pact (a big
  // augment boost for 15% of your max health this run).
  openAltar() {
    if (this.state !== 'playing' || this.kaiju.stage >= MAX_STAGE) return;
    const held = this.held;
    const pool = offerAugments({ held, rng: this.rng }).filter((id) => AUGMENT_BY_ID[id] && AUGMENT_BY_ID[id].kind !== 'filler' && AUGMENT_BY_ID[id].kind !== 'evolution');
    const devil = pool.find((id) => AUGMENT_BY_ID[id].kind === 'move') || pool[0] || null;
    this.altar = { devil };
    this.state = 'altar';
    this.emit('altar', { altar: this.altar });
  }

  altarChoose(choice) {
    if (this.state !== 'altar') return false;
    const k = this.kaiju;
    if (choice === 'devil' && this.altar.devil) {
      const id = this.altar.devil;
      const a = AUGMENT_BY_ID[id];
      for (let i = 0; i < 2; i++) if ((this.held.get(id) || 0) < maxLevel(a)) applyPick(this.held, id);
      const frac = k.hp / k.maxHp;
      this.maxHpPenalty *= 0.85;
      k.maxHp = this.maxHpFor();
      k.hp = Math.min(k.maxHp, k.maxHp * frac);
      this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 3, text: `PACT: ${a.name} +2`, color: '#ff5a8a', life: 1.8, max: 1.8 });
    } else {
      this.bigHeal(0.35, 'BLESSING', k.x, k.y);
      this.rerolls++;
    }
    this.altar = null;
    this.state = 'playing';
    this.emit('altarDone', { choice });
    return true;
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

  // Big heals that skip the falloff: smashing a hospital, eating a doctor.
  bigHeal(fraction, text, x, y) {
    const k = this.kaiju;
    const before = k.hp;
    k.hp = Math.min(k.maxHp, k.hp + k.maxHp * fraction);
    k.sedated = 0;
    const pct = Math.round(((k.hp - before) / k.maxHp) * 100);
    this.fx.floaters.push({ x, y, h: k.r * 2.8, text: pct > 0 ? `${text} +${pct}%` : `${text}: full health`, color: '#5dff88', life: 1.8, max: 1.8 });
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: k.r * 3, life: 0.6, max: 0.6, color: 0x5dff88, width: k.r * 0.25 });
    this.emit('healed', { amount: fraction });
  }

  hospitalHeal(o) {
    const gap = Math.max(0, this.kaiju.stage - o.tier);
    const f = HOSPITAL.heal[Math.min(gap, HOSPITAL.heal.length - 1)];
    this.stats.hospitals = (this.stats.hospitals || 0) + 1;
    this.bigHeal(f, 'HOSPITAL', o.x, o.y);
  }

  // ---------------------------------------------------------------- skill: charge and perfect dodges
  tryDash() {
    const k = this.kaiju;
    if (this.state !== 'playing' || k.dashCd > 0) return false;
    k.dashDir = k.moving ? norm(this.input.x, this.input.y) : { ...k.facing };
    k.facing = { ...k.dashDir };
    k.dashT = DASH.time;
    k.dashCd = DASH.cd * this.meta.dashCdMul * (this.meta.perks.rudderTail ? 0.65 : 1);
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

  // Wreckage shield (`capped`) draws on a per-second budget, so a late-game demolition spree
  // can't keep it topped up under fire; it builds up between fights instead.
  addShield(fraction, capped = true) {
    const k = this.kaiju;
    let gain = k.maxHp * fraction;
    if (capped) {
      gain = Math.min(gain, this.shieldBudget);
      this.shieldBudget -= gain;
    }
    k.shield = Math.min(k.maxHp * SHIELD_CAP, k.shield + gain);
  }

  takeDamage(amount, type = 'bullet') {
    const k = this.kaiju;
    if (this.state !== 'playing' || k.invuln > 0) return;
    // The first session is tuned so almost everyone sees the boss go down.
    let dmg = amount * this.diff.enemyDmg * (this.firstRun ? 0.8 : 1) * (this.meta.perks.graniteHide ? 0.88 : 1);
    k.lastHitAt = this.time;
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

  // Down, not out: the player can revive (free from Nine Lives, by ad, or for gems) or give up.
  die() {
    this.state = 'dead';
    this.emit('dead', { free: this.freeRevives > 0, ad: this.reviveAvailable });
  }

  // `paid`: the gems were already taken by the caller.
  revive(paid = false) {
    if (this.state !== 'dead') return false;
    if (!paid) {
      if (this.freeRevives > 0) this.freeRevives--;
      else if (this.reviveAvailable) this.reviveAvailable = false;
      else return false;
    }
    this.revives = (this.revives || 0) + 1;
    const k = this.kaiju;
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
    k.shield = Math.min(k.shield * 2, k.maxHp * SHIELD_CAP);
    this.stats.stageTimes[k.stage] = this.time;
    this.director.spawnT = 2;
    if (THREAT.waveEvery[k.stage]) this.director.waveT = THREAT.firstWave;
    if (ELITES[k.stage]) this.director.eliteT = ELITE.first;
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: s.radius * 2.5, life: 0.8, max: 0.8, color: 0x9cff7a, width: s.radius * 0.25 });
    this.fx.rings.push({ x: k.x, y: k.y, r0: s.radius, r1: s.radius * 4.5, life: 1.1, max: 1.1, color: 0xffffff, width: s.radius * 0.4 });
    this.shake = Math.max(this.shake, 0.9);
    // Size-up: a beat of slow motion and a shockwave that flattens everything far smaller.
    this.slowmo = Math.max(this.slowmo, 1.1);
    for (const o of this.objectsNear(k.x, k.y, s.radius * 4)) if (o.tier <= k.stage - 2 && !o.landmark) this.destroyObject(o, norm(o.x - k.x, o.y - k.y), 'crush');
    for (const u of this.units) if (!u.dead && u.tier < k.stage && Math.hypot(u.x - k.x, u.y - k.y) < s.radius * 4) this.killUnit(u);
    this.emit('grow', { stage: k.stage, name: s.name, size: s.size });
    if (k.stage >= 2 && k.stage <= 5) this.schedule(18, () => this.placeVault());
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
    if (id === 'growthSpurt' && k.stage < MAX_STAGE) k.biomass = Math.min(this.stage.biomassToNext, k.biomass + this.stage.biomassToNext * 0.15);
    if (id === 'scrapPile') {
      this.stats.scrap += 25 * k.stage * k.stage;
      this.stats.scrapPiles = (this.stats.scrapPiles || 0) + 1;
    }
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
    k.xp += xpFor(amount, k.stage) * (1 + 0.1 * this.level('appetite')) * this.meta.xpMul * (this.xpBoost || 1);
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
    if (o.state !== 'intact' || !o.chunk.loaded || (this.spare && this.spare(o))) return false;
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
    if (o.state !== 'intact' || !o.chunk.loaded || (this.spare && this.spare(o))) return;
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
      const price = objectPrice(o);
      this.stats.damage += price;
      this.stats.destroyed++;
      if (o.structure) this.stats.buildings++;
      if (o.structure && o.tier >= k.stage) this.stats.bigTopples++;
      if (o.golden) this.crackVault(o);
      if (o.tier >= 5 && this.stats.firstSkyscraperAt === null) this.stats.firstSkyscraperAt = this.time;
      this.spawnOrbs(o.x, o.y, Math.min(10, 1 + o.tier * 2), biomass > 0);
      if (o.structure && o.tier >= k.stage) {
        this.fx.floaters.push({ x: o.x, y: o.y, h: o.height * 0.8, text: `+${shortMoney(price)}`, color: '#ffd84a', life: 1.1, max: 1.1 });
      }
      if (this.has('magneticHide') && (o.vehicle || o.structure)) this.addShield((o.vehicle ? 0.02 : 0.03) * (0.5 + 0.5 * this.level('magneticHide')));
      if (HOSPITAL_TYPES.has(o.type)) this.hospitalHeal(o);
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
    const maxR = Math.max(120, span * (initial ? 1.4 : 1.3));
    const minR = initial ? 10 : span * 1.0;
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
      // Very rarely, while you are small, one of them is a doctor.
      let variant = this.rng.int(0, PERSON_VARIANTS - 1);
      if (!initial && k.stage <= DOCTOR_HEAL.maxStage && this.time >= (this.nextDoctorAt ?? DOCTOR_HEAL.gap[0])
        && this.rng.chance(DOCTOR_HEAL.chance) && !this.people.some((q) => q.variant === DOCTOR && !q.taken)) {
        variant = DOCTOR;
        this.nextDoctorAt = this.time + DOCTOR_HEAL.gap[0];
      }
      this.people.push({
        isPerson: true, x, y, heading: this.rng.range(0, Math.PI * 2), speed: this.rng.range(4, 7),
        state: 'walk', t: this.rng.range(1, 4), variant,
        tier: 1, z: 0, vz: 0, vx: 0, vy: 0, spin: 0, phase: this.rng.range(0, 6),
      });
    }
    if (k.stage <= 4) {
      const wantCars = CROWD.traffic;
      const roads = this.city.roads;
      tries = 0;
      while (this.traffic.length < wantCars && tries++ < wantCars * 6) {
        const r = roads[this.rng.int(0, roads.length - 1)];
        // Somewhere along the street, clear of the junctions at either end.
        const rlen = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) || 1;
        const edge = Math.min(0.45, (JUNCTION_R + 12) / rlen);
        const t = edge + this.rng.next() * (1 - 2 * edge);
        const x = r.x0 + (r.x1 - r.x0) * t;
        const y = r.y0 + (r.y1 - r.y0) * t;
        const d = Math.hypot(x - k.x, y - k.y);
        // New cars drive in from beyond the edge of the screen, never pop up in view, and never
        // on top of another vehicle.
        const model = this.rng.pick(['car', 'car', 'hatchback', 'taxi', 'van', 'pickup', 'bus']);
        if (d > Math.max(400, span * 1.6) || (!initial && d < span * 1.1) || !this.roadSpotFree(x, y, propDims(model).w)) continue;
        this.traffic.push({
          isCar: true, road: r, t, dir: this.rng.chance(0.5) ? 1 : -1, x, y, heading: 0,
          speed: this.rng.range(28, 44), hp: CROWD.carHp, maxHp: CROWD.carHp, tier: 2, dead: false,
          model, variant: this.rng.int(0, 2), flash: 0,
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
    this.xpBoost = this.meta.perks.gluttonHeart ? 1.2 : 1;
    if (this.has('ironStomach')) this.addBiomass(lootFor(u.tier, k.stage).biomass * 0.25 * this.level('ironStomach'));
    this.killUnit(u);
    this.xpBoost = 1;
    this.noteEat();
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
    this.xpBoost = this.meta.perks.gluttonHeart ? 1.2 : 1;
    this.addBiomass(loot.biomass * (1 + 0.25 * this.level('ironStomach')));
    this.xpBoost = 1;
    this.noteEat();
    this.onKill();
    this.stats.scrap += loot.scrap * this.diff.loot * 0.5;
    if (k.stage === 1) this.heal(0.01);
    if (p.variant === DOCTOR) {
      this.stats.doctors = (this.stats.doctors || 0) + 1;
      this.bigHeal(DOCTOR_HEAL.heal, 'DOCTOR', p.x, p.y);
      this.nextDoctorAt = this.time + this.rng.range(...DOCTOR_HEAL.gap);
    }
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
    for (const c of this.traffic) {
      if (c.dead) continue;
      const was = c.placed && { x: c.x, y: c.y, heading: c.heading, t: c.t, road: c.road, dir: c.dir, plan: c.plan, lastTurn: c.lastTurn };
      if (!c.plan || c.plan.road !== c.road || c.plan.dir !== c.dir) c.plan = this.planTurn(c);
      const r = c.road;
      const p = c.plan;
      const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
      const dk = Math.hypot(c.x - k.x, c.y - k.y);
      const flee = dk < k.r * 8 + 30;
      const speed = c.speed * (flee ? 1.8 : 1);
      const d0 = norm(r.x1 - r.x0, r.y1 - r.y0);
      let space = 1;
      if (c.placed) {
        const ramp = Math.max(8, speed * 0.4);
        if (c.lastTurn) this.holdJunction(c, c.lastTurn.nodeX, c.lastTurn.nodeY, c.lastTurn.route);
        const cars = this.roadSpace(c, d0.x * c.dir, d0.y * c.dir, ramp);
        const cross = this.junctionSpace(c, p.nodeX, p.nodeY, Math.abs(p.nodeT - c.t) * len, ramp, cars > 0.99, p.route);
        space = Math.min(cars, cross);
        // Stuck behind a roadblock or in a jam: make a U-turn (a busy junction takes longer to give up on).
        if (this.stuckOnRoad(c, space, cars < 0.05 ? dt : dt * 0.5)) c.dir *= -1;
      }
      c.t += (c.dir * speed * space * dt) / len;
      if (c.dir === p.dir && (c.dir > 0 ? c.t >= p.exitT : c.t <= p.exitT)) {
        c.lastTurn = p;
        if (!p.next) {
          // A dead end: turn around.
          c.dir *= -1;
          c.t = p.exitT;
        } else {
          const over = Math.abs(c.t - p.exitT) * len;
          c.road = p.next;
          c.dir = p.nextDir;
          c.t = p.entryT + (c.dir * over) / Math.hypot(p.next.x1 - p.next.x0, p.next.y1 - p.next.y0);
        }
      }
      const rr = c.road;
      const n = norm((rr.x1 - rr.x0) * c.dir, (rr.y1 - rr.y0) * c.dir);
      // Drive on the right-hand lane. The car steers toward its lane spot rather than snapping
      // to it, so turns and U-turns are smooth arcs.
      const tx = rr.x0 + (rr.x1 - rr.x0) * c.t - n.y * LANE;
      const ty = rr.y0 + (rr.y1 - rr.y0) * c.t + n.x * LANE;
      c.laneX = tx;
      c.laneY = ty;
      const lag = Math.hypot(tx - c.x, ty - c.y);
      if (!c.placed || lag > 60) {
        c.x = tx;
        c.y = ty;
        c.heading = Math.atan2(n.y, n.x);
        c.placed = true;
      } else {
        const f = Math.min(1, dt * 7);
        const ox = c.x;
        const oy = c.y;
        c.x += (tx - c.x) * f;
        c.y += (ty - c.y) * f;
        const mvx = c.x - ox;
        const mvy = c.y - oy;
        const want = Math.hypot(mvx, mvy) > 0.02 ? Math.atan2(mvy, mvx) : Math.atan2(n.y, n.x);
        const dh = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading));
        c.heading += dh * Math.min(1, dt * 6);
      }
      c.jammed = was && this.rammed(c, was.x, was.y, was.heading);
      if (c.jammed) Object.assign(c, was);
      c.flash = Math.max(0, c.flash - dt);
      if (dk > Math.max(500, span * 1.8)) c.dead = true;
    }
    this.traffic = this.traffic.filter((c) => !c.dead);
  }

  // Where a car leaves its road and joins the next one: a random street out of the junction
  // ahead, taken where the two lanes cross, so the car turns from lane to lane instead of
  // cutting across the junction. With no way on (a dead end) it turns around at the end.
  planTurn(c) {
    const r = c.road;
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) || 1;
    const nodeT = c.dir > 0 ? 1 : 0;
    const nodeX = c.dir > 0 ? r.x1 : r.x0;
    const nodeY = c.dir > 0 ? r.y1 : r.y0;
    const plan = { road: r, dir: c.dir, nodeT, nodeX, nodeY, exitT: nodeT, next: null };
    const { graph, key } = this.city.roadGraph;
    const options = (graph.get(key(nodeX, nodeY)) || []).filter((o) => o !== r);
    if (!options.length) return plan;
    const n = this.rng.pick(options);
    const atStart = Math.round(n.x0) === Math.round(nodeX) && Math.round(n.y0) === Math.round(nodeY);
    const nextDir = atStart ? 1 : -1;
    // Lane lines: node + d * dist + side(d) * LANE, with side(d) = (-d.y, d.x). Solve
    // d1 * a - d2 * b = (side(d2) - side(d1)) * LANE for how far past the node the car turns
    // (a, along this road) and where it joins the next (b, along that one).
    const d1 = norm((r.x1 - r.x0) * c.dir, (r.y1 - r.y0) * c.dir);
    const d2 = norm((n.x1 - n.x0) * nextDir, (n.y1 - n.y0) * nextDir);
    const det = d1.y * d2.x - d1.x * d2.y;
    let a = 0;
    let b = 0;
    if (Math.abs(det) > 0.2) {
      const cx = (d1.y - d2.y) * LANE;
      const cy = (d2.x - d1.x) * LANE;
      a = Math.max(-30, Math.min(30, (cy * d2.x - cx * d2.y) / det));
      b = Math.max(-30, Math.min(30, (d1.x * cy - d1.y * cx) / det));
    }
    plan.exitT = nodeT + (c.dir * a) / len;
    plan.next = n;
    plan.nextDir = nextDir;
    plan.entryT = (atStart ? 0 : 1) + (nextDir * b) / (Math.hypot(n.x1 - n.x0, n.y1 - n.y0) || 1);
    // The route through the junction, for claiming it: in along this lane, the turn, out along the next.
    const lane = (d, dist) => ({ x: nodeX + d.x * dist - d.y * LANE, y: nodeY + d.y * dist + d.x * LANE });
    plan.route = { from: r, to: n, points: [lane(d1, -JUNCTION_R - 8), lane(d1, a), lane(d2, JUNCTION_R + 8)] };
    return plan;
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
    if (c.evac) {
      // An evacuation bus: a feast, and its passengers scatter.
      this.addBiomass(lootFor(k.stage, k.stage).biomass * 0.5);
      this.fx.floaters.push({ x: c.x, y: c.y, h: k.r * 2, text: 'EVACUEES!', color: '#ffd84a', life: 1.2, max: 1.2 });
      for (let i = 0; i < 6; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        this.people.push({ isPerson: true, x: c.x + Math.cos(a) * 3, y: c.y + Math.sin(a) * 3, heading: a, speed: this.rng.range(5, 8), state: 'flee', t: 2, variant: this.rng.int(0, PERSON_VARIANTS - 1), tier: 1, z: 0, vz: 0, vx: 0, vy: 0, spin: 0, phase: this.rng.range(0, 6) });
      }
    }
    if (!c.silent) this.shake = Math.max(this.shake, k.stage <= 2 ? 0.2 : 0.1);
    if (k.stage <= 2) this.impact(0.04, 0.2);
    this.bumpCombo();
    this.onKill();
    this.addThreat(k.stage <= 2 ? 1 : 0.3);
    const loot = lootFor(2, k.stage, 1);
    this.addBiomass(loot.biomass);
    this.stats.scrap += loot.scrap * this.diff.loot;
    this.stats.damage += vehiclePrice(c.model);
    this.stats.destroyed++;
    this.stats.cars++;
    if (this.has('magneticHide')) this.addShield(0.01 + 0.01 * this.level('magneticHide'));
    this.fxEvent({ t: 'carDie', car: c, dir: norm(c.x - k.x, c.y - k.y) });
    this.spawnOrbs(c.x, c.y, 3, true);
  }

  // ---------------------------------------------------------------- augments
  updateAugments(dt) {
    const k = this.kaiju;
    this.moves.update(dt);
    // Magnetic Hide: 0.6/0.85/1.1% of max health per second of wreckage shield, banking up to 3%.
    if (this.has('magneticHide')) this.shieldBudget = Math.min(k.maxHp * 0.03, this.shieldBudget + k.maxHp * (0.0035 + 0.0025 * this.level('magneticHide')) * dt);
    // Unkillable set bonus: the debris shield regenerates while standing still.
    if (k.stillTime > 0.5 && completedSets(this.held).some((s) => s.id === 'unkillable')) this.addShield(0.02 * dt, false);
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
    dir.spawnT -= dt * (1 + th * 1.2) * (this.boss && this.boss.gate ? 0.5 : 1) * (this.blackoutT > 0 ? 0.6 : 1);
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
      heading: 0, aim: 0, strafe: this.rng.chance(0.5) ? 1 : -1, dead: false, age: 0, id: this.rng.next(),
      stress: 0, windup: 0, windupMax: 0,
    };
    // Ground vehicles and roadblocks live on the road network.
    if ((def.vehicle && !def.flying) || type === 'roadblock') {
      const nr = this.nearestRoad(x, y);
      if (nr) {
        u.dir = 1;
        // The nearest spot on the streets around there that is clear of other vehicles (a squad
        // spreads out along them), or failing that the clearest one.
        const length = (VEHICLE_BOX[def.model || type] || [u.r * 2])[0];
        let best = null;
        for (let i = 0; i < 12 && !(best && best.free); i++) {
          const a = i * 2.4;
          const at = i ? this.nearestRoad(x + Math.cos(a) * 60 * Math.sqrt(i), y + Math.sin(a) * 60 * Math.sqrt(i)) : nr;
          if (!at || isWater(at.road.x, at.road.y)) continue;
          for (const off of [0, 0.08, -0.08, 0.16, -0.16]) {
            u.road = at.road;
            u.t = Math.max(0.03, Math.min(0.97, at.t + off));
            this.placeOnRoad(u);
            const gap = this.roadClearance(u.x, u.y);
            if (!best || gap > best.gap) best = { road: u.road, t: u.t, gap, free: gap >= length / 2 + 8 };
            if (best.free) break;
          }
        }
        u.road = best ? best.road : nr.road;
        u.t = best ? best.t : nr.t;
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
    // Venom Fangs: poison ticks, and with the Epic upgrade it jumps on death.
    for (const u of this.units) {
      if (!u.poison || u.dead) continue;
      const p = u.poison;
      p.t -= dt;
      u.hp -= p.dps * dt;
      if (u.hp <= 0) {
        this.killUnit(u);
        if (p.spread) {
          const next = this.units.find((v) => !v.dead && !v.poison && v.type !== 'jet' && Math.hypot(v.x - u.x, v.y - u.y) < k.r * 4);
          if (next) next.poison = { ...p, t: 3 };
        }
      } else if (p.t <= 0) u.poison = null;
    }
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
          if (this.meta.perks.thornSpines && k.invuln <= 0) this.damageUnit(u, this.baseDamage() * 0.5);
          // Spiked Hide: brawlers get hurt hitting you.
          if (this.has('spikedHide') && k.invuln <= 0) this.damageUnit(u, this.baseDamage() * 0.3 * this.level('spikedHide'));
        }
      } else if (u.windup > 0) {
        // Telegraphed shot: the shooter aims (shown as a sight line) before the round leaves.
        u.windup -= dt;
        if (u.windup <= 0) this.unitFire(u, dist);
      } else if (u.cd <= 0 && dist - k.r <= def.range * (this.blackoutT > 0 ? 0.6 : 1) && u.stress < 0.12) {
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
    this.stats.damage += unitPrice(u);
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
      if (b.dropT <= 0) {
        b.dropT = 0.28;
        this.hazards.push({ kind: 'circle', x: b.x, y: b.y, r: b.unit * 0.9, t: 0, delay: 0.7, dmg: 0.05 * b.D, type: 'explosive', slow: 0.9, boss: true });
      }
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
    if (b.phase === 1 && b.hp < b.maxHp * 0.5) {
      b.phase = 2;
      if (g) {
        this.emit('banner', { text: g.furious });
        this.shake = Math.max(this.shake, 0.5);
      } else {
        // Enraged: the sweeping laser and missile waves join the rotation, and it attacks faster.
        b.patterns = BOSS.patterns2;
        b.patternIndex = 0;
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
      b.next = (g ? GATE.interval : BOSS.interval) * (b.phase === 2 ? 0.7 : 1);
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
    const hp = this.stage.damage * (GATE.hits + GATE.hitsPerLevel * (k.level - 1)) * (def.hits || 1) * (def.hpMul || 1) * this.diff.enemyHp;
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
      isBoss: true, name: BOSS.name, x, y, r: BOSS.r, hp: BOSS.hp * this.diff.enemyHp, maxHp: BOSS.hp * this.diff.enemyHp,
      state: 'enter', targetX: Math.max(BOSS.r, k.x - span * 0.45), targetY: y,
      phase: 1, next: 2, patterns: BOSS.patterns, patternIndex: 0,
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
    // The Coast Guard Mech. Everything it does is a red telegraph that lands quickly: sizes are
    // in kaiju radii, so the dodge is a short sidestep or a charge, never a long run.
    const u = k.r;
    const m = b.dmgMul;
    const p2 = b.phase === 2;
    const T = p2 ? 0.88 : 1;
    const lead = (t) => ({ x: k.x + k.vx * t * 0.8, y: k.y + k.vy * t * 0.8 });
    const aimAt = (p) => Math.atan2(p.y - b.y, p.x - b.x);
    const circle = (x, y, r, dmg, delay, extra = {}) => this.hazards.push({ kind: 'circle', x, y, r, t: 0, delay, dmg, type: 'explosive', boss: true, ...extra });
    const line = (a, from, len, w, dmg, delay, beam = 0xff3b3b, extra = {}) => this.hazards.push({
      kind: 'line', x1: from.x, y1: from.y, x2: from.x + Math.cos(a) * len, y2: from.y + Math.sin(a) * len, w, t: 0, delay, dmg, type: 'laser', beam, boss: true, ...extra,
    });
    const muzzle = (a) => ({ x: b.x + Math.cos(a) * b.r * 0.5, y: b.y + Math.sin(a) * b.r * 0.5 });
    if (pattern === 'barrage') {
      // Shells rain around where you are heading.
      const n = p2 ? 16 : 10;
      const c = lead(0.85 * T);
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : i === 1 ? u * 0.5 : this.rng.range(u * 1.2, u * 3.4);
        const from = i === 1 ? k : c;
        circle(from.x + Math.cos(a) * d, from.y + Math.sin(a) * d, u * 0.85, BOSS.barrageDmg * m, (0.85 + i * 0.05) * T, { from: { x: b.x, y: b.y } });
      }
    } else if (pattern === 'laser') {
      // Main gun at where you'll be; three barrels when enraged.
      const a0 = aimAt(lead(0.75 * T));
      for (const off of p2 ? [-0.3, 0, 0.3] : [0]) line(a0 + off, muzzle(a0 + off), u * 12, u * 0.8, BOSS.laserDmg * m, 0.75 * T);
      const d = norm(Math.cos(a0), Math.sin(a0));
      const hit = this.hazards[this.hazards.length - 1];
      hit.onHit = () => {
        for (const o of this.grid.query(b.x - u * 12, b.y - u * 12, b.x + u * 12, b.y + u * 12)) {
          if (o.state === 'intact' && !o.landmark && distToSegment(o.x, o.y, hit.x1, hit.y1, hit.x2, hit.y2) < hit.w / 2 + Math.min(o.w, o.h) / 2) this.destroyObject(o, d, 'boss');
        }
      };
    } else if (pattern === 'charge') {
      // The ram: the lane lights up and the hit lands as it starts; then it ploughs through.
      const d = norm(k.x - b.x, k.y - b.y);
      const len = Math.hypot(k.x - b.x, k.y - b.y) + u * 2.5;
      b.state = 'windup';
      line(Math.atan2(d.y, d.x), { x: b.x, y: b.y }, len, b.r * 1.3, BOSS.chargeDmg * m, (p2 ? 0.65 : 0.8), 0xff5555, {
        onHit: () => {
          if (!this.boss || this.boss.dead) return;
          b.state = 'charge';
          b.chargeDir = d;
          b.chargeLeft = len;
        },
      });
    } else if (pattern === 'cross') {
      // Twin rail cannons cross where you stand: step out diagonally.
      const c = lead(0.75 * T);
      const a0 = this.rng.range(0, Math.PI);
      for (const a of [a0, a0 + Math.PI / 2]) line(a, { x: c.x - Math.cos(a) * u * 6, y: c.y - Math.sin(a) * u * 6 }, u * 12, u * 0.9, BOSS.crossDmg * m, 0.75 * T, 0xffd23f);
    } else if (pattern === 'sweep') {
      // A searchlight laser sweeps across you: get behind it, or charge through.
      const a0 = aimAt(k);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      for (let i = 0; i < 8; i++) {
        const a = a0 - dir * 0.85 + dir * (1.7 * i) / 7;
        line(a, muzzle(a), u * 13, u * 0.7, BOSS.sweepDmg * m, 0.7 + i * 0.09);
      }
    } else if (pattern === 'missiles') {
      // Three waves of missiles, each aimed at where you are going when it fires.
      for (let w = 0; w < 3; w++) {
        this.schedule(w * 0.45, () => {
          if (!this.boss || this.boss.dead) return;
          const c = lead(0.75);
          for (let i = 0; i < 4; i++) {
            const a = this.rng.range(0, Math.PI * 2);
            const d = i === 0 ? 0 : this.rng.range(u * 0.6, u * 1.8);
            circle(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, u * 0.7, BOSS.missileDmg * m, 0.75 + i * 0.04, { from: { x: b.x, y: b.y } });
          }
        });
      }
    }
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
    // Every attack is a red telegraph that lands quickly (faster still when furious); a gate boss
    // never hurts by touch.
    const T = p2 ? 0.88 : 1;
    const circles = (n, spread, r, dmg, delay, extra = {}) => {
      const c = lead(delay);
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : i === 1 ? s * 0.4 : this.rng.range(s * 1.2, s * spread);
        const from = i === 1 ? k : c;
        this.hazards.push({ kind: 'circle', x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d, r, t: 0, delay: (delay + i * 0.06) * T, dmg, type: 'explosive', from: { x: b.x, y: b.y }, boss: true, ...extra });
      }
    };
    const line = (x1, y1, x2, y2, w, dmg, delay, beam, extra = {}) => {
      this.hazards.push({ kind: 'line', x1, y1, x2, y2, w, t: 0, delay, dmg, type: 'laser', beam, boss: true, ...extra });
    };
    switch (pattern) {
      case 'pistol': {
        // Laser sight, then the shot down it (a second, re-aimed one when furious).
        const shoot = (delay) => {
          const a = Math.atan2(lead(delay).y - b.y, lead(delay).x - b.x);
          const len = Math.hypot(k.x - b.x, k.y - b.y) + s * 4;
          line(b.x, b.y, b.x + Math.cos(a) * len, b.y + Math.sin(a) * len, s * 0.45, 0.12 * D, delay, 0xff2a2a, {
            onHit: () => alive() && this.fxEvent({ t: 'shot', kind: 'bullet', x: b.x, y: b.y }),
          });
        };
        shoot(0.5 * T);
        if (p2) this.schedule(0.35, () => alive() && shoot(0.45));
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
        // A fan of shots lights up from his new spot.
        const n = p2 ? 7 : 5;
        const a0 = aimAt();
        for (let i = 0; i < n; i++) {
          const a = a0 + (i - (n - 1) / 2) * 0.2;
          line(b.x, b.y, b.x + Math.cos(a) * s * 9, b.y + Math.sin(a) * s * 9, s * 0.4, 0.07 * D, 0.55 * T, 0xff2a2a, i === 0 ? { onHit: () => alive() && this.fxEvent({ t: 'shot', kind: 'burst', x: b.x, y: b.y }) } : {});
        }
        break;
      }
      case 'mines':
        // Exploding business cards scattered around the kaiju.
        circles(p2 ? 8 : 5, 4, s * 1.4, 0.1 * D, 1.0);
        break;
      case 'violation':
        // Violation notices land where you are heading.
        circles(p2 ? 5 : 3, 2.4, s * 1.1, 0.07 * D, 0.8);
        this.fxEvent({ t: 'shot', kind: 'missile', x: b.x, y: b.y });
        break;
      case 'manager': {
        // Calls in the local enforcement (not when the streets are already full).
        const types = ESCALATION[b.gate].weights;
        for (let i = 0, n = this.units.length < 40 ? (p2 ? 2 : 1) : 0; i < n; i++) {
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
        // The lane lights up and the hit lands as the charge starts; then it ploughs through.
        line(b.x, b.y, b.x + d.x * len, b.y + d.y * len, b.r * 1.3, (b.def.chargeDmg || 0.16) * D, p2 ? 0.65 : 0.8, 0xff5555, {
          onHit: () => {
            if (!alive()) return;
            b.state = 'charge';
            b.chargeDir = d;
            b.chargeLeft = len;
          },
        });
        break;
      }
      case 'scoops':
        // Lobbed scoops: each splat is a brain freeze that slows you down.
        circles(p2 ? 9 : 6, 4, s * 1.25, 0.07 * D, 0.85, { slow: 1.6 });
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
        b.swingT = 1.7;
        for (let i = 0; i < n; i++) {
          const a = a0 - dirn * 0.5 + dirn * ((sweep * i) / n);
          this.hazards.push({ kind: 'circle', x: b.x + Math.cos(a) * R, y: b.y + Math.sin(a) * R, r: s * 1.25, t: 0, delay: (0.7 + (i * 0.9) / n) * T, dmg: 0.13 * D, type: 'explosive', boss: true });
        }
        this.schedule(1.7, () => {
          if (!alive()) return;
          if (b.state === 'windup') b.state = 'idle';
          // Loose rivets fly off the end of the swing: three lit lanes.
          const a1 = aimAt();
          for (let i = 0; i < 3; i++) {
            const a = a1 + (i - 1) * 0.22;
            line(b.x, b.y, b.x + Math.cos(a) * s * 8, b.y + Math.sin(a) * s * 8, s * 0.4, 0.06 * D, 0.5, 0xb8c0cc);
          }
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
          line(cx - uy * half, cy + ux * half, cx + uy * half, cy - ux * half, s * 0.9, 0.12 * D, (0.8 + i * 0.12) * T, 0x9aa3ad);
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
          line(b.x + Math.cos(a) * b.r * 0.5, b.y + Math.sin(a) * b.r * 0.5, b.x + Math.cos(a) * len, b.y + Math.sin(a) * len, s, 0.22 * D, 0.75 * T, 0xffd23f);
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
        const c = lead(0.8);
        cut(c.x, c.y, a0, 0.8 * T);
        if (p2) cut(k.x + k.vx * 1.1, k.y + k.vy * 1.1, a0 + Math.PI / 4, 1.35);
        break;
      }
      case 'speech': {
        b.state = 'speech';
        b.shield = true;
        b.speechT = 3.5;
        b.quipT = 1.5;
        // His supporters turn up, but a long fight never floods the streets.
        const types = ESCALATION[b.gate].weights;
        if (this.units.length < 40) for (let i = 0; i < 2; i++) this.spawnGroup(this.rng.weighted(types));
        break;
      }
      case 'blimps':
        // Campaign blimps carpet-bomb the area.
        circles(p2 ? 12 : 8, 3.2, s * 1.3, 0.12 * D, 0.95);
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
    this.stats.gateKills.push(b.gate);
    this.stats.gateBosses = (this.stats.gateBosses || 0) + 1;
    const scrap = 60 * b.gate * b.gate * this.diff.loot * this.scrapMult();
    this.stats.scrap += scrap;
    this.stats.damage += bossPrice(b);
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
      this.openAltar();
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
      this.stats.damage += bossPrice(b);
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
          // Mirror Scales shrug off one shot in five.
          if (this.meta.perks.mirrorScales && k.invuln <= 0 && this.rng.chance(0.2)) {
            this.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.4, text: 'BLOCKED', color: '#bfe8ff', life: 0.8, max: 0.8 });
            this.fxEvent({ t: 'sparks', x: p.x, y: p.y, h: k.r, color: 0xbfe8ff });
            p.life = 0;
            continue;
          }
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
    const pickR = k.r * 3 * (1 + 0.4 * this.level('magnetJaws')) * this.meta.pickupMul + 6;
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
      difficulty: this.diff.id, stage: this.kaiju.stage, scrap, scrapRaw, damage: Math.round(s.damage), biomass: Math.round(s.biomass),
      buildings: s.buildings, destroyed: s.destroyed, units: s.units, people: s.people, landmark: s.landmark, rareMaterials: s.rareMaterials,
      augments: [...this.held.entries()].map(([id, level]) => ({ id, name: AUGMENT_BY_ID[id].name, level })),
      sets: sets.map((x) => x.name), title: sets.length ? sets.map((x) => x.name).join(' + ') : null,
      score, firstSkyscraperAt: s.firstSkyscraperAt, stageTimes: s.stageTimes,
      // Scavenger and Scrap Piles raise the scrap the run pays out (see meta.runRewards).
      scrapBoost: 0.2 * this.level('scavenger') + 0.1 * (s.scrapPiles || 0),
      gateKills: [...s.gateKills], chapter: this.chapter, vaultGems: s.vaultGems, vaults: s.vaults, objectiveDone: s.objectiveDone,
      objective: this.objective.text, frenzies: s.frenzies,
    };
    this.emit('end', { results: this.results });
  }

  debugGrow() {
    this.gateCleared[this.kaiju.stage] = true;
    if (this.kaiju.stage < MAX_STAGE) this.addBiomass(this.stage.biomassToNext - this.kaiju.biomass);
  }
}
