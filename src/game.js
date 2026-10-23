import {
  WORLD, STAGES, MAX_STAGE, KAIJU, CITIES, DIFFICULTIES, ENEMIES, ESCALATION, BOSS, LIMITS,
  UNIT_HEAL, LOSS_SCRAP_KEEP, canDamage, isSnack, lootFor,
} from './config.js';
import { AUGMENT_BY_ID, offerAugments, applyPick, rollTier, completedSets } from './augments.js';
import { generateCity } from './world.js';
import { createRng } from './rng.js';

const CITY_SEED = 1337;

export function distToRect(px, py, o) {
  const dx = Math.max(Math.abs(px - o.x) - o.w / 2, 0);
  const dy = Math.max(Math.abs(py - o.y) - o.h / 2, 0);
  return Math.hypot(dx, dy);
}

export function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / len2));
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

function norm(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export class Game {
  constructor({ kaijuId = 'rex', cityId = 'harbor', difficulty = 'normal', seed = Date.now(), firstRun = false } = {}) {
    this.def = KAIJU[kaijuId];
    this.cityDef = CITIES[cityId];
    this.diff = DIFFICULTIES[difficulty];
    this.rng = createRng(seed);
    this.firstRun = firstRun;
    this.city = generateCity(CITY_SEED);
    this.objects = this.city.objects;
    this.grid = this.city.grid;

    const s1 = STAGES[1];
    this.kaiju = {
      x: this.city.spawn.x,
      y: this.city.spawn.y,
      r: s1.radius,
      stage: 1,
      maxHp: s1.maxHp * this.def.hpMult,
      hp: s1.maxHp * this.def.hpMult,
      biomass: 0,
      facing: { x: -1, y: 0 },
      vx: 0,
      vy: 0,
      moving: false,
      stillTime: 0,
      attackCd: 0.5,
      attackCount: 0,
      shield: 0,
      hitFlash: 0,
      invuln: 0,
      trailT: 0,
      stompT: 0,
      walkPhase: 0,
      lastAttack: null,
    };
    this.input = { x: 0, y: 0 };
    this.held = new Map();
    this.timers = { debrisToss: 2, roar: 3, atomicBreath: 3, meteorCall: 6 };
    this.units = [];
    this.projectiles = [];
    this.hazards = [];
    this.scheduled = [];
    this.fires = [];
    this.fx = { particles: [], debris: [], orbs: [], floaters: [], rings: [], beams: [], bolts: [] };
    this.boss = null;
    this.bossTimer = null;
    this.collapsing = 0;
    this.active = new Set();
    this.shake = 0;
    this.slowmo = 0;
    this.slowmoReadyAt = 0;
    this.time = 0;
    this.state = 'playing';
    this.pick = null;
    this.picksMade = 0;
    this.reviveAvailable = true;
    this.adRerollAvailable = true;
    this.director = { spawnT: ESCALATION[1].firstDelay, jetT: 4 };
    this.events = [];
    this.results = null;
    this.stats = {
      scrap: 0, biomass: 0, buildings: 0, destroyed: 0, units: 0,
      landmark: false, rareMaterials: 0, firstSkyscraperAt: null, stageTimes: { 1: 0 },
    };
  }

  // ---------------------------------------------------------------- helpers
  get stage() {
    return STAGES[this.kaiju.stage];
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

  schedule(delay, fn) {
    this.scheduled.push({ t: delay, fn });
  }

  // How much of the city the camera shows (shortest screen side, world units).
  viewSpan(radius = STAGES[this.kaiju.stage].radius) {
    return 200 + radius * 12.5;
  }

  baseDamage() {
    let m = this.stage.damage;
    if (this.has('rageMode')) m *= 1 + 0.6 * (1 - this.kaiju.hp / this.kaiju.maxHp);
    return m;
  }

  setInput(x, y) {
    const l = Math.hypot(x, y);
    this.input = l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  objectsNear(x, y, radius) {
    const found = this.grid.query(x - radius, y - radius, x + radius, y + radius);
    return found.filter((o) => o.state === 'intact' && distToRect(x, y, o) <= radius);
  }

  // ---------------------------------------------------------------- main loop
  update(realDt) {
    if (this.state !== 'playing') return;
    const dt = realDt * (this.slowmo > 0 ? 0.35 : 1);
    this.slowmo = Math.max(0, this.slowmo - realDt);
    this.time += dt;

    this.checkGrowth();
    if (this.state !== 'playing') return;
    this.updateKaiju(dt);
    this.updateAugments(dt);
    this.updateDirector(dt);
    this.updateUnits(dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateScheduled(dt);
    this.updateObjects(dt);
    this.updateFires(dt);
    this.updateFx(dt);
    this.shake = Math.max(0, this.shake - realDt * 2.5);
  }

  // ---------------------------------------------------------------- kaiju
  updateKaiju(dt) {
    const k = this.kaiju;
    const target = this.stage.radius;
    k.r += (target - k.r) * Math.min(1, dt * 3);
    k.hitFlash = Math.max(0, k.hitFlash - dt);
    k.invuln = Math.max(0, k.invuln - dt);

    const mag = Math.hypot(this.input.x, this.input.y);
    k.moving = mag > 0.05;
    let speed = this.stage.speed * this.def.speedMult;
    if (k.x < WORLD.seaWidth && !this.onPier(k.x, k.y)) speed *= 0.6; // wading through the harbor
    k.vx = this.input.x * speed;
    k.vy = this.input.y * speed;
    if (k.moving) {
      k.facing = norm(this.input.x, this.input.y);
      k.stillTime = 0;
      k.walkPhase += dt * speed / Math.max(10, k.r) * 2.2;
    } else {
      k.stillTime += dt;
    }
    k.x += k.vx * dt;
    k.y += k.vy * dt;

    // Crush what is smaller, bump into what is your size or bigger.
    const near = this.grid.query(k.x - k.r, k.y - k.r, k.x + k.r, k.y + k.r);
    for (const o of near) {
      if (o.state !== 'intact') continue;
      const d = distToRect(k.x, k.y, o);
      if (d >= k.r) continue;
      const crushable = isSnack(o.tier, k.stage) || (!o.structure && o.tier <= k.stage);
      if (crushable && !o.landmark) {
        this.destroyObject(o, norm(o.x - k.x, o.y - k.y), 'crush');
      } else {
        this.pushOut(k, o);
      }
    }
    for (const u of this.units) {
      if (u.flying || u.dead) continue;
      if (u.tier < k.stage && Math.hypot(u.x - k.x, u.y - k.y) < k.r + u.r) this.killUnit(u);
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
    k.x = Math.max(k.r * 0.5, Math.min(WORLD.width - k.r * 0.5, k.x));
    k.y = Math.max(k.r * 0.5, Math.min(WORLD.height - k.r * 0.5, k.y));

    // Auto attack the nearest target in reach.
    k.attackCd -= dt;
    if (k.attackCd <= 0) {
      const target = this.findTarget();
      if (target) {
        this.performAttack(target);
        k.attackCd = this.def.attack.cooldown;
      } else {
        k.attackCd = 0.1;
      }
    }

    if (this.def.trail && k.moving) {
      k.trailT -= dt;
      if (k.trailT <= 0) {
        k.trailT = 0.22;
        this.fires.push({ x: k.x - k.facing.x * k.r * 0.8, y: k.y - k.facing.y * k.r * 0.8, r: k.r * 0.7, t: 3, max: 3, tick: 0 });
      }
    }
  }

  onPier(x, y) {
    const p = this.city.pier;
    return Math.abs(x - (p.x + p.w / 2 - 50)) < p.w / 2 + 50 && Math.abs(y - p.y) < 80;
  }

  pushOut(k, o) {
    const cx = Math.max(o.x - o.w / 2, Math.min(k.x, o.x + o.w / 2));
    const cy = Math.max(o.y - o.h / 2, Math.min(k.y, o.y + o.h / 2));
    let dx = k.x - cx;
    let dy = k.y - cy;
    let d = Math.hypot(dx, dy);
    if (d < 1e-4) {
      // Centre inside the rect: push out along the shallowest axis.
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
    for (const u of this.units) {
      if (u.dead || u.type === 'jet') continue;
      const d = Math.hypot(u.x - k.x, u.y - k.y) - u.r;
      if (d <= reach && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    if (best) return best;
    for (const o of this.objectsNear(k.x, k.y, reach)) {
      if (!canDamage(o.tier, k.stage, o.landmark)) continue;
      const d = distToRect(k.x, k.y, o);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  damageTarget(t, amount, dir, cause = 'hit') {
    if (t.isBoss) return this.damageBoss(amount);
    if (t.isUnit) return this.damageUnit(t, amount);
    return this.damageObject(t, amount, dir, cause);
  }

  performAttack(target) {
    const k = this.kaiju;
    const atk = this.def.attack;
    const dmg = this.baseDamage() * atk.mult;
    const dir = norm(target.x - k.x, target.y - k.y);
    k.lastAttack = { kind: atk.kind, x: target.x, y: target.y, t: 0.18 };
    k.attackCount++;
    if (atk.kind === 'bite') {
      this.damageTarget(target, dmg, dir);
      this.spawnSparks(target.x - dir.x * Math.min(target.r || target.w / 2 || 8, 40), target.y - dir.y * Math.min(target.r || target.h / 2 || 8, 40), 6, '#fff4c2', k.r * 0.15);
    } else if (atk.kind === 'pound') {
      const radius = k.r * atk.range;
      this.areaDamage(k.x, k.y, radius, dmg, 'hit', true);
      this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius, life: 0.35, max: 0.35, color: '#f5e6c8', width: k.r * 0.18 });
      this.shake = Math.max(this.shake, 0.15);
    } else if (atk.kind === 'zap') {
      const chain = [target];
      let cur = target;
      let amount = dmg;
      this.damageTarget(target, amount, dir);
      for (let i = 0; i < atk.chains; i++) {
        const next = this.nearestChainTarget(cur, chain, k.r * 3);
        if (!next) break;
        amount *= 0.75;
        chain.push(next);
        this.damageTarget(next, amount, norm(next.x - cur.x, next.y - cur.y));
        cur = next;
      }
      const pts = [{ x: k.x, y: k.y }, ...chain.map((c) => ({ x: c.x, y: c.y }))];
      this.fx.bolts.push({ points: pts, life: 0.22, max: 0.22, width: Math.max(2, k.r * 0.12) });
    }
    if (this.has('tailShockwave')) {
      const every = 5;
      if (k.attackCount % every === 0) {
        const radius = k.r * 3.5 * (1 + 0.3 * (this.level('tailShockwave') - 1));
        for (const o of this.objectsNear(k.x, k.y, radius)) {
          if (isSnack(o.tier, k.stage) && !o.landmark) this.destroyObject(o, norm(o.x - k.x, o.y - k.y), 'hit');
        }
        for (const u of this.units) {
          if (!u.dead && !u.flying && Math.hypot(u.x - k.x, u.y - k.y) < radius) this.damageUnit(u, this.baseDamage() * 0.5);
        }
        this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius, life: 0.45, max: 0.45, color: '#b8f0ff', width: k.r * 0.2 });
      }
    }
  }

  nearestChainTarget(from, exclude, reach) {
    let best = null;
    let bestD = reach;
    for (const u of this.units) {
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
      // Lightning prefers vehicles.
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
      this.damageObject(o, amount, norm(o.x - x, o.y - y), cause);
    }
    for (const u of this.units) {
      if (!u.dead && Math.hypot(u.x - x, u.y - y) < radius + u.r) this.damageUnit(u, amount);
    }
    const b = this.boss;
    if (hitsBoss && b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - x, b.y - y) < radius + b.r) this.damageBoss(amount);
  }

  heal(fraction) {
    const k = this.kaiju;
    k.hp = Math.min(k.maxHp, k.hp + k.maxHp * fraction);
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
    if ((type === 'bullet' || type === 'shell') && this.has('thickHide')) {
      dmg *= 1 - (0.15 + 0.1 * (this.level('thickHide') - 1));
    }
    if (k.shield > 0) {
      const absorbed = Math.min(k.shield, dmg);
      k.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) return;
    k.hp -= dmg;
    k.hitFlash = 0.12;
    if (k.hp <= 0) {
      k.hp = 0;
      this.die();
    }
  }

  die() {
    if (this.reviveAvailable) {
      this.state = 'dead';
      this.emit('dead', { canRevive: true });
    } else {
      this.end(false);
    }
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
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: k.r * 5, life: 0.6, max: 0.6, color: '#fff', width: k.r * 0.3 });
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
    if (k.stage >= MAX_STAGE) return;
    if (k.biomass < this.stage.biomassToNext) return;
    k.biomass -= this.stage.biomassToNext;
    this.grow();
  }

  grow() {
    const k = this.kaiju;
    const frac = k.hp / k.maxHp;
    k.stage++;
    const s = this.stage;
    k.maxHp = s.maxHp * this.def.hpMult;
    k.hp = Math.min(k.maxHp, k.maxHp * frac + k.maxHp * 0.15);
    k.shield = Math.min(k.shield * 2, k.maxHp * 0.3);
    this.stats.stageTimes[k.stage] = this.time;
    this.director.spawnT = 2;
    this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: s.radius * 2.5, life: 0.8, max: 0.8, color: '#9cff7a', width: s.radius * 0.25 });
    this.shake = Math.max(this.shake, 0.5);
    this.emit('grow', { stage: k.stage, name: s.name, size: s.size });
    if (s.pickOdds) this.openPick();
    if (k.stage === MAX_STAGE) this.bossTimer = BOSS.arriveDelay;
  }

  openPick() {
    let tier;
    let guarantee = null;
    if (this.firstRun && this.picksMade === 0) {
      // First session: Domino Effect is guaranteed on the first pick so the player sees a chain collapse.
      tier = 'gold';
      guarantee = 'dominoEffect';
    } else {
      tier = rollTier(this.stage.pickOdds, this.rng);
    }
    const options = offerAugments({ held: this.held, tier, rng: this.rng, guarantee });
    this.pick = { tier, options, freeRerolls: 1 };
    this.state = 'picking';
    this.emit('pick', { pick: this.pick });
  }

  reroll(useAd = false) {
    const p = this.pick;
    if (!p || this.state !== 'picking') return false;
    if (p.freeRerolls > 0) p.freeRerolls--;
    else if (useAd && this.adRerollAvailable) this.adRerollAvailable = false;
    else return false;
    p.options = offerAugments({ held: this.held, tier: p.tier, rng: this.rng, exclude: p.options });
    this.emit('pick', { pick: p });
    return true;
  }

  choose(id) {
    if (this.state !== 'picking' || !this.pick.options.includes(id)) return false;
    const before = completedSets(this.held).map((s) => s.id);
    const level = applyPick(this.held, id);
    this.picksMade++;
    this.pick = null;
    this.state = 'playing';
    this.emit('picked', { id, level, name: AUGMENT_BY_ID[id].name });
    for (const set of completedSets(this.held)) {
      if (!before.includes(set.id)) this.emit('synergy', { set });
    }
    return true;
  }

  addBiomass(amount) {
    this.kaiju.biomass += amount;
    this.stats.biomass += amount;
  }

  // ---------------------------------------------------------------- destruction
  damageObject(o, amount, dir, cause = 'hit') {
    if (o.state !== 'intact') return false;
    const stage = this.kaiju.stage;
    if (!canDamage(o.tier, stage, o.landmark)) return false;
    if (isSnack(o.tier, stage) && !o.landmark) amount = o.hp;
    o.hp -= amount;
    o.flash = 0.12;
    this.active.add(o);
    if (o.structure && o.hp > 0) this.spawnDust(o.x, o.y, Math.max(o.w, o.h) * 0.3, 2, 0.6);
    if (o.hp <= 0) this.destroyObject(o, dir, cause);
    return true;
  }

  destroyObject(o, dir, cause = 'hit') {
    if (o.state !== 'intact') return;
    const k = this.kaiju;
    const size = Math.max(o.w, o.h);
    o.hp = 0;
    o.fallDir = dir && (dir.x || dir.y) ? dir : norm(o.x - k.x, o.y - k.y);
    if (o.structure && this.collapsing < LIMITS.collapsing) {
      o.state = 'collapsing';
      o.collapseT = 0;
      this.collapsing++;
      this.active.add(o);
    } else {
      o.state = 'rubble';
    }

    if (cause !== 'boss') {
      const loot = lootFor(o.tier, k.stage, o.value);
      let biomass = loot.biomass * (this.has('quickGrowth') ? 1.15 : 1);
      if (cause === 'chain' && !completedSets(this.held).some((s) => s.id === 'demolition')) biomass = 0;
      let scrap = loot.scrap * this.diff.loot * (this.has('scavenger') ? 1.2 : 1);
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
      if (o.tier >= 4 && this.stats.firstSkyscraperAt === null) this.stats.firstSkyscraperAt = this.time;
      this.spawnOrbs(o.x, o.y, Math.min(10, 1 + o.tier * 2), biomass > 0);
      if (o.structure && o.tier >= k.stage) {
        this.fx.floaters.push({ x: o.x, y: o.y - o.height * 0.4, text: `+${Math.round(scrap)}`, color: '#ffd84a', life: 1, max: 1, size: k.r * 0.6 });
      }

      if (o.vehicle && this.has('snackAttack')) this.heal(0.03);
      if (this.has('magneticHide') && (o.vehicle || o.structure)) this.addShield(o.vehicle ? 0.02 : 0.03);
      if (o.structure && this.has('buildingEater')) this.heal(0.05);
    }

    // Juice: dust, physics debris, shake and a slow-motion beat on big collapses.
    const big = o.tier >= Math.max(2, k.stage - 1);
    this.spawnDust(o.x, o.y, size * 0.6, o.structure ? Math.min(14, 3 + o.tier * 3) : 2, o.structure ? 1.4 : 0.5);
    if (o.structure) this.spawnDebris(o, Math.min(8, 2 + o.tier * 2));
    if (o.structure && big) this.shake = Math.max(this.shake, Math.min(1, 0.2 + o.tier * 0.12));
    // Slow-motion beat on a big collapse, rationed so a rampage at Apex stays full speed.
    if (o.landmark || (o.tier >= 3 && o.tier >= k.stage && cause !== 'crush' && cause !== 'boss' && this.time >= this.slowmoReadyAt)) {
      this.slowmo = Math.max(this.slowmo, o.landmark ? 0.6 : 0.25);
      this.slowmoReadyAt = this.time + 6;
    }

    if (o.structure && o.tier >= 2) {
      if (this.has('dominoEffect')) this.schedule(0.25, () => this.domino(o));
      if (this.has('gasMain') && this.rng.chance(0.2)) this.schedule(0.35, () => this.explode(o));
    }
  }

  domino(o) {
    const size = Math.max(o.w, o.h);
    const len = size * 1.3;
    const d = o.fallDir;
    const x1 = o.x + d.x * size * 0.5;
    const y1 = o.y + d.y * size * 0.5;
    const x2 = x1 + d.x * len;
    const y2 = y1 + d.y * len;
    const width = Math.min(o.w, o.h);
    const found = this.grid.query(Math.min(x1, x2) - width, Math.min(y1, y2) - width, Math.max(x1, x2) + width, Math.max(y1, y2) + width);
    for (const n of found) {
      if (n === o || n.state !== 'intact') continue;
      if (distToSegment(n.x, n.y, x1, y1, x2, y2) > width / 2 + Math.max(n.w, n.h) / 2) continue;
      this.damageObject(n, o.maxHp * 0.75, d, 'chain');
    }
    for (const u of this.units) {
      if (!u.dead && !u.flying && distToSegment(u.x, u.y, x1, y1, x2, y2) < width / 2 + u.r) this.damageUnit(u, o.maxHp * 0.75);
    }
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && distToSegment(b.x, b.y, x1, y1, x2, y2) < width / 2 + b.r) this.damageBoss(o.maxHp * 0.75);
    this.spawnDust((x1 + x2) / 2, (y1 + y2) / 2, len * 0.4, 6, 1.2);
  }

  explode(o) {
    const radius = Math.max(o.w, o.h) * 1.3;
    this.areaDamage(o.x, o.y, radius, o.maxHp * 0.8, 'chain');
    this.spawnExplosion(o.x, o.y, radius);
  }

  updateObjects(dt) {
    // Only flashing and collapsing objects need per-frame work.
    for (const o of this.active) {
      if (o.flash > 0) o.flash -= dt;
      if (o.state === 'collapsing') {
        o.collapseT += dt / (0.7 + o.tier * 0.12);
        if (Math.random() < 0.5) {
          this.spawnDust(o.x + o.fallDir.x * o.w * o.collapseT * 0.4, o.y + o.fallDir.y * o.h * o.collapseT * 0.4, Math.max(o.w, o.h) * 0.4, 1, 1.2);
        }
        if (o.collapseT >= 1) {
          o.state = 'rubble';
          this.collapsing--;
        }
      }
      if (o.flash <= 0 && o.state !== 'collapsing') this.active.delete(o);
    }
  }

  // ---------------------------------------------------------------- augments
  updateAugments(dt) {
    const k = this.kaiju;
    const t = this.timers;

    if (this.has('debrisToss')) {
      t.debrisToss -= dt;
      if (t.debrisToss <= 0) {
        const target = this.nearestEnemy(k.r * 10);
        if (target) {
          const d = norm(target.x - k.x, target.y - k.y);
          this.projectiles.push({
            friendly: true, kind: 'rock', x: k.x, y: k.y, vx: d.x * 700, vy: d.y * 700, speed: Math.max(700, this.stage.speed * 2),
            r: k.r * 0.25, dmg: this.baseDamage() * 2, life: 2.5, target,
          });
          t.debrisToss = 4;
        } else t.debrisToss = 0.5;
      }
    }

    if (this.has('roar')) {
      t.roar -= dt;
      if (t.roar <= 0) {
        const radius = k.r * 8;
        const scared = this.units.filter((u) => !u.dead && u.def.soft && Math.hypot(u.x - k.x, u.y - k.y) < radius);
        if (scared.length) {
          for (const u of scared) u.fear = 3;
          this.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius, life: 0.6, max: 0.6, color: '#ffe08a', width: k.r * 0.3 });
          this.emit('roar');
          t.roar = 10;
        } else t.roar = 0.5;
      }
    }

    if (this.has('atomicBreath')) {
      t.atomicBreath -= dt;
      if (t.atomicBreath <= 0) {
        this.fireBeam();
        t.atomicBreath = 8;
      }
    }

    if (this.has('meteorCall')) {
      t.meteorCall -= dt;
      if (t.meteorCall <= 0) {
        this.callMeteor();
        t.meteorCall = 30;
      }
    }

    if (this.has('heavyStomp') && k.moving) {
      k.stompT -= dt;
      if (k.stompT <= 0) {
        k.stompT = 0.7;
        const radius = k.r * 2.2;
        const dmg = this.baseDamage() * 0.35 * (1 + 0.5 * (this.level('heavyStomp') - 1));
        for (const u of this.units) {
          if (!u.dead && !u.flying && Math.hypot(u.x - k.x, u.y - k.y) < radius + u.r) this.damageUnit(u, dmg);
        }
        this.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 0.8, r1: radius, life: 0.3, max: 0.3, color: 'rgba(120,90,60,0.8)', width: k.r * 0.12 });
      }
    }

    // Unkillable set bonus: the debris shield regenerates while standing still.
    if (k.stillTime > 0.5 && completedSets(this.held).some((s) => s.id === 'unkillable')) {
      this.addShield(0.04 * dt);
    }
  }

  nearestEnemy(reach) {
    const k = this.kaiju;
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
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - k.x, b.y - k.y) - b.r < reach) return b;
    return best;
  }

  fireBeam() {
    const k = this.kaiju;
    const len = k.r * 14;
    const width = k.r * 0.9;
    const x1 = k.x + k.facing.x * k.r * 0.6;
    const y1 = k.y + k.facing.y * k.r * 0.6;
    const x2 = x1 + k.facing.x * len;
    const y2 = y1 + k.facing.y * len;
    const dmg = this.baseDamage() * 5;
    const pad = width + 200;
    const found = this.grid.query(Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad);
    for (const o of found) {
      if (o.state !== 'intact') continue;
      if (distToSegment(o.x, o.y, x1, y1, x2, y2) > width / 2 + Math.min(o.w, o.h) / 2) continue;
      this.damageObject(o, dmg, k.facing, 'hit');
    }
    for (const u of this.units) {
      if (!u.dead && distToSegment(u.x, u.y, x1, y1, x2, y2) < width / 2 + u.r) this.damageUnit(u, dmg);
    }
    const b = this.boss;
    if (b && !b.dead && b.state !== 'enter' && distToSegment(b.x, b.y, x1, y1, x2, y2) < width / 2 + b.r) this.damageBoss(dmg);
    this.fx.beams.push({ x1, y1, x2, y2, width, life: 0.45, max: 0.45, color: '#7df9ff' });
    this.shake = Math.max(this.shake, 0.35);
  }

  callMeteor() {
    const k = this.kaiju;
    const half = this.viewSpan() * 0.6;
    const found = this.grid.query(k.x - half, k.y - half, k.x + half, k.y + half);
    let target = null;
    for (const o of found) {
      if (o.state !== 'intact' || !o.structure || !canDamage(o.tier, k.stage, o.landmark)) continue;
      if (!target || o.tier > target.tier || (o.tier === target.tier && o.maxHp * o.w * o.h > target.maxHp * target.w * target.h)) target = o;
    }
    const b = this.boss;
    const pos = target ? { x: target.x, y: target.y } : b && !b.dead ? { x: b.x, y: b.y } : null;
    if (!pos) {
      this.timers.meteorCall = 3;
      return;
    }
    const radius = target ? Math.max(target.w, target.h) * 0.9 : b.r * 1.2;
    this.hazards.push({
      friendly: true, kind: 'circle', x: pos.x, y: pos.y, r: radius, t: 0, delay: 1.3,
      onHit: () => {
        if (target) this.damageObject(target, target.maxHp * 3, norm(target.x - k.x, target.y - k.y), 'hit');
        this.areaDamage(pos.x, pos.y, radius * 1.5, this.baseDamage() * 6, 'hit');
        this.spawnExplosion(pos.x, pos.y, radius * 1.4);
        this.shake = Math.max(this.shake, 0.8);
      },
    });
  }

  updateFires(dt) {
    for (const f of this.fires) {
      f.t -= dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.25;
        const dmg = this.baseDamage() * 0.5 * 0.25;
        for (const o of this.objectsNear(f.x, f.y, f.r)) this.damageObject(o, dmg, null, 'hit');
        for (const u of this.units) {
          if (!u.dead && !u.flying && Math.hypot(u.x - f.x, u.y - f.y) < f.r + u.r) this.damageUnit(u, dmg);
        }
        const b = this.boss;
        if (b && !b.dead && b.state !== 'enter' && Math.hypot(b.x - f.x, b.y - f.y) < f.r + b.r) this.damageBoss(dmg);
        if (this.fx.particles.length < LIMITS.particles) {
          this.fx.particles.push({ kind: 'fire', x: f.x + this.rng.range(-f.r, f.r) * 0.5, y: f.y + this.rng.range(-f.r, f.r) * 0.5, vx: 0, vy: -f.r * 0.8, life: 0.5, max: 0.5, size: f.r * 0.5, color: '#ff9a2e' });
        }
      }
    }
    this.fires = this.fires.filter((f) => f.t > 0);
  }

  // ---------------------------------------------------------------- military
  updateDirector(dt) {
    const k = this.kaiju;
    const esc = ESCALATION[k.stage];
    const dir = this.director;
    dir.spawnT -= dt;
    const alive = this.units.filter((u) => !u.dead && u.type !== 'jet').length;
    if (dir.spawnT <= 0) {
      dir.spawnT = esc.interval * this.rng.range(0.7, 1.3);
      if (alive < esc.maxAlive) {
        const type = this.rng.weighted(esc.weights);
        const count = type === 'infantry' ? 2 : 1;
        const pos = this.spawnPoint(type);
        for (let i = 0; i < count; i++) this.spawnUnit(type, pos.x + i * 14, pos.y + (i % 2) * 14);
      }
    }
    if (esc.jetEvery) {
      dir.jetT -= dt;
      if (dir.jetT <= 0) {
        dir.jetT = esc.jetEvery * this.rng.range(0.8, 1.2);
        this.spawnJet();
      }
    }
  }

  spawnPoint(type) {
    const k = this.kaiju;
    const def = ENEMIES[type];
    const span = this.viewSpan();
    const dist = Math.max(span * this.rng.range(0.65, 0.85), def.standoff + k.r + 100);
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rng.range(0, Math.PI * 2);
      const x = k.x + Math.cos(a) * dist;
      const y = k.y + Math.sin(a) * dist;
      if (x > WORLD.seaWidth + 20 && x < WORLD.width - 20 && y > 20 && y < WORLD.height - 20) return { x, y };
    }
    return {
      x: Math.max(WORLD.seaWidth + 20, Math.min(WORLD.width - 20, k.x + dist)),
      y: Math.max(20, Math.min(WORLD.height - 20, k.y)),
    };
  }

  spawnUnit(type, x, y) {
    const def = ENEMIES[type];
    const u = {
      isUnit: true, type, def, x, y, r: def.r, tier: def.tier,
      hp: def.hp * this.diff.enemyHp, maxHp: def.hp * this.diff.enemyHp,
      flying: Boolean(def.flying), cd: this.rng.range(0.6, def.cd || 1), fear: 0, flash: 0,
      heading: 0, aim: 0, strafe: this.rng.chance(0.5) ? 1 : -1, dead: false, age: 0,
    };
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
    u.width = 90;
    u.heading = a;
    u.struck = false;
    this.hazards.push({ kind: 'line', ...u.line, w: u.width, t: 0, delay: u.warn, visualOnly: true });
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
      let mx = 0;
      let my = 0;
      if (u.fear > 0) {
        u.fear -= dt;
        mx = -to.x;
        my = -to.y;
      } else if (def.speed > 0) {
        const want = k.r + def.standoff + u.r;
        if (dist > want + 25) {
          mx = to.x;
          my = to.y;
        } else if (dist < want - 25) {
          mx = -to.x * 0.7;
          my = -to.y * 0.7;
        }
        // Circle around the kaiju while in range.
        const strafe = u.flying ? 0.9 : 0.35;
        mx += -to.y * u.strafe * strafe;
        my += to.x * u.strafe * strafe;
        if (u.age % 6 < dt) u.strafe *= this.rng.chance(0.3) ? -1 : 1;
      }
      const ml = Math.hypot(mx, my);
      if (ml > 0.01) {
        const sp = def.speed * (u.fear > 0 ? 1.3 : 1);
        u.x += (mx / ml) * sp * dt * Math.min(1, ml);
        u.y += (my / ml) * sp * dt * Math.min(1, ml);
        u.heading = Math.atan2(my, mx);
      }
      u.x = Math.max(WORLD.seaWidth * 0.5, Math.min(WORLD.width - 10, u.x));
      u.y = Math.max(10, Math.min(WORLD.height - 10, u.y));

      if (u.fear > 0) continue;
      u.cd -= dt;
      if (def.attack === 'melee') {
        if (u.cd <= 0 && dist < k.r + u.r + 6) {
          this.takeDamage(def.dmg, 'bullet');
          u.cd = def.cd;
        }
      } else if (u.cd <= 0 && dist - k.r <= def.range) {
        this.unitFire(u, to, dist);
        u.cd = def.cd * this.rng.range(0.85, 1.15);
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
        this.takeDamage(u.def.dmg, 'bullet');
        this.spawnExplosion(k.x - u.dir.y * k.r * 0.3, k.y + u.dir.x * k.r * 0.3, k.r * 0.6);
      }
    }
    const past = (u.x - u.line.x2) * u.dir.x + (u.y - u.line.y2) * u.dir.y;
    if (past > 200) u.dead = true;
  }

  unitFire(u, to, dist) {
    const k = this.kaiju;
    const def = u.def;
    const lead = Math.min(0.6, dist / 600);
    const tx = k.x + k.vx * lead * 0.5;
    const ty = k.y + k.vy * lead * 0.5;
    const aim = norm(tx - u.x, ty - u.y);
    const shoot = (angleOff, speed, kind, dmg, type) => {
      const c = Math.cos(angleOff);
      const s = Math.sin(angleOff);
      const vx = aim.x * c - aim.y * s;
      const vy = aim.x * s + aim.y * c;
      this.projectiles.push({ kind, x: u.x, y: u.y, vx: vx * speed, vy: vy * speed, r: kind === 'bullet' ? 2.5 : 4, dmg, type, life: (def.range + k.r * 2) / speed + 0.4, homing: kind === 'missile' });
    };
    switch (def.attack) {
      case 'bullet':
        shoot(this.rng.range(-0.06, 0.06), 540, 'bullet', def.dmg, 'bullet');
        break;
      case 'burst':
        for (const off of [-0.14, 0, 0.14]) shoot(off, 520, 'bullet', def.dmg, 'bullet');
        break;
      case 'rocket':
        shoot(this.rng.range(-0.05, 0.05), 380, 'rocket', def.dmg, 'explosive');
        break;
      case 'missile':
        shoot(-0.25, 430, 'missile', def.dmg, 'explosive');
        shoot(0.25, 430, 'missile', def.dmg, 'explosive');
        break;
      case 'shell':
        this.hazards.push({ kind: 'circle', x: tx + this.rng.range(-20, 20), y: ty + this.rng.range(-20, 20), r: 48, t: 0, delay: 1.1, dmg: def.dmg, type: 'shell', from: { x: u.x, y: u.y } });
        break;
      case 'artillery':
        this.hazards.push({ kind: 'circle', x: k.x + this.rng.range(-k.r, k.r) * 0.4, y: k.y + this.rng.range(-k.r, k.r) * 0.4, r: 140, t: 0, delay: 1.6, dmg: def.dmg, type: 'shell' });
        break;
      case 'laser': {
        const len = dist + k.r * 2;
        this.hazards.push({ kind: 'line', x1: u.x, y1: u.y, x2: u.x + aim.x * len, y2: u.y + aim.y * len, w: 40, t: 0, delay: 0.7, dmg: def.dmg, type: 'laser', beam: '#ff5577' });
        break;
      }
      default:
        break;
    }
  }

  damageUnit(u, amount) {
    if (u.dead) return false;
    if (u.tier < this.kaiju.stage) amount = u.hp;
    u.hp -= amount;
    u.flash = 0.1;
    if (u.hp <= 0) this.killUnit(u);
    return true;
  }

  killUnit(u) {
    if (u.dead) return;
    u.dead = true;
    const k = this.kaiju;
    const loot = lootFor(u.tier, k.stage);
    this.addBiomass(loot.biomass * (this.has('quickGrowth') ? 1.15 : 1));
    this.stats.scrap += loot.scrap * this.diff.loot * (this.has('scavenger') ? 1.2 : 1);
    this.stats.units++;
    this.heal(UNIT_HEAL);
    if (u.def.vehicle && this.has('snackAttack')) this.heal(0.03);
    if (u.def.vehicle && this.has('magneticHide')) this.addShield(0.02);
    this.spawnExplosion(u.x, u.y, u.r * 2.2);
    this.spawnOrbs(u.x, u.y, 2 + u.tier, true);
    if (u.type === 'jet' || u.flying) this.spawnDebrisAt(u.x, u.y, u.r, '#555', 3);
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
    const b = this.boss;
    if (!b || b.dead) return;
    const k = this.kaiju;
    b.flash = Math.max(0, b.flash - dt);
    b.walk += dt;
    const dx = k.x - b.x;
    const dy = k.y - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    b.aim = Math.atan2(dy, dx);

    if (b.state === 'enter') {
      b.y += (b.targetY - b.y) * Math.min(1, dt * 0.8);
      b.x += (b.targetX - b.x) * Math.min(1, dt * 0.8);
      if (Math.hypot(b.targetX - b.x, b.targetY - b.y) < 20) {
        b.state = 'idle';
        b.next = 1.5;
        this.emit('bossFight', { name: BOSS.name });
      }
      return;
    }

    if (b.state === 'charge') {
      const step = 1500 * dt;
      b.x += b.chargeDir.x * step;
      b.y += b.chargeDir.y * step;
      b.chargeLeft -= step;
      if (!b.chargeHit && Math.hypot(k.x - b.x, k.y - b.y) < b.r + k.r) {
        b.chargeHit = true;
        this.takeDamage(BOSS.chargeDmg, 'melee');
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

    // Walk to a fighting distance, trampling the skyline on the way.
    const want = b.r + k.r + 260;
    if (dist > want) {
      b.x += (dx / dist) * BOSS.speed * dt;
      b.y += (dy / dist) * BOSS.speed * dt;
      this.bossTrample(b);
    }
    if (dist < b.r + k.r + 10) this.takeDamage(BOSS.contactDmg * dt, 'melee');

    if (b.phase === 1 && b.hp < b.maxHp * 0.5) {
      b.phase = 2;
      this.emit('banner', { text: `${BOSS.name} is enraged!` });
      for (let i = 0; i < 2; i++) {
        const p = this.spawnPoint('mech');
        this.spawnUnit('mech', p.x, p.y);
      }
    }

    b.next -= dt;
    if (b.next <= 0) {
      const pattern = b.patterns[b.patternIndex % b.patterns.length];
      b.patternIndex++;
      this.bossAttack(pattern);
      b.next = b.phase === 2 ? 2.3 : 3.3;
    }
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
      aim: 0, flash: 0, walk: 0, dead: false, start: this.time,
    };
    this.shake = 1;
    this.emit('bossSpawn', { name: BOSS.name });
  }

  bossTrample(b) {
    for (const o of this.objectsNear(b.x, b.y, b.r * 0.8)) {
      if (o.landmark) continue;
      this.destroyObject(o, norm(o.x - b.x, o.y - b.y), 'boss');
    }
  }

  bossAttack(pattern) {
    const b = this.boss;
    const k = this.kaiju;
    if (pattern === 'barrage') {
      const n = b.phase === 2 ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = i === 0 ? 0 : this.rng.range(k.r * 1.2, k.r * 3);
        this.hazards.push({ kind: 'circle', x: k.x + Math.cos(a) * d, y: k.y + Math.sin(a) * d, r: 110, t: 0, delay: 1.3 + i * 0.07, dmg: BOSS.barrageDmg, type: 'explosive', from: { x: b.x, y: b.y } });
      }
    } else if (pattern === 'laser') {
      const d = norm(k.x - b.x, k.y - b.y);
      const len = 2400;
      const line = { x1: b.x + d.x * b.r * 0.5, y1: b.y + d.y * b.r * 0.5, x2: b.x + d.x * len, y2: b.y + d.y * len };
      this.hazards.push({
        kind: 'line', ...line, w: 130, t: 0, delay: 1.0, dmg: BOSS.laserDmg, type: 'laser', beam: '#ff3b3b',
        onHit: () => {
          for (const o of this.grid.query(Math.min(line.x1, line.x2) - 100, Math.min(line.y1, line.y2) - 100, Math.max(line.x1, line.x2) + 100, Math.max(line.y1, line.y2) + 100)) {
            if (o.state === 'intact' && !o.landmark && distToSegment(o.x, o.y, line.x1, line.y1, line.x2, line.y2) < 65 + Math.min(o.w, o.h) / 2) {
              this.destroyObject(o, d, 'boss');
            }
          }
        },
      });
    } else if (pattern === 'charge') {
      const d = norm(k.x - b.x, k.y - b.y);
      const len = Math.hypot(k.x - b.x, k.y - b.y) + 250;
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

  damageBoss(amount) {
    const b = this.boss;
    if (!b || b.dead || b.state === 'enter') return false;
    b.hp -= amount;
    b.flash = 0.08;
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      this.stats.bossDefeated = true;
      this.stats.bossTime = this.time - b.start;
      this.stats.rareMaterials += 1;
      this.slowmo = 1.2;
      this.shake = 1.2;
      for (let i = 0; i < 6; i++) {
        this.schedule(i * 0.25, () => this.spawnExplosion(b.x + this.rng.range(-b.r, b.r), b.y + this.rng.range(-b.r, b.r), b.r * 0.8));
      }
      this.spawnDebrisAt(b.x, b.y, b.r, '#e86b2a', 12);
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
        if (t && !t.dead) {
          const d = norm(t.x - p.x, t.y - p.y);
          p.vx = d.x * p.speed;
          p.vy = d.y * p.speed;
          if (Math.hypot(t.x - p.x, t.y - p.y) < (t.r || 10) + p.r) {
            this.damageTarget(t, p.dmg, d);
            this.spawnDust(p.x, p.y, p.r * 2, 3, 0.6);
            p.life = 0;
          }
        } else if (!t || t.dead) p.life = Math.min(p.life, 0.3);
      } else {
        if (p.homing) {
          const d = norm(k.x - p.x, k.y - p.y);
          const sp = Math.hypot(p.vx, p.vy);
          p.vx += (d.x * sp - p.vx) * Math.min(1, dt * 0.6);
          p.vy += (d.y * sp - p.vy) * Math.min(1, dt * 0.6);
        }
        if (Math.hypot(k.x - p.x, k.y - p.y) < k.r + p.r) {
          this.takeDamage(p.dmg, p.type);
          if (p.kind !== 'bullet') this.spawnExplosion(p.x, p.y, 14);
          else this.spawnSparks(p.x, p.y, 2, '#ffe16b', 4);
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
        this.fx.beams.push({ x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2, width: h.w, life: 0.3, max: 0.3, color: h.beam || '#ff5555' });
      }
      if (hit) this.takeDamage(h.dmg, h.type);
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

  // ---------------------------------------------------------------- fx
  spawnDust(x, y, spread, n, life = 1) {
    const ps = this.fx.particles;
    for (let i = 0; i < n && ps.length < LIMITS.particles; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.2 + Math.random() * 0.6);
      ps.push({ kind: 'dust', x: x + Math.cos(a) * spread * 0.3, y: y + Math.sin(a) * spread * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: spread * (0.3 + Math.random() * 0.4), color: '#cbbfa8' });
    }
  }

  spawnSparks(x, y, n, color, size) {
    const ps = this.fx.particles;
    for (let i = 0; i < n && ps.length < LIMITS.particles; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = size * (6 + Math.random() * 10);
      ps.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25, max: 0.25, size: Math.max(1.5, size * 0.4), color });
    }
  }

  spawnExplosion(x, y, radius) {
    this.fx.rings.push({ x, y, r0: radius * 0.2, r1: radius, life: 0.35, max: 0.35, color: '#ffb347', width: radius * 0.25 });
    const ps = this.fx.particles;
    for (let i = 0; i < 6 && ps.length < LIMITS.particles; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = radius * (0.5 + Math.random());
      ps.push({ kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.4, size: radius * 0.45, color: i % 2 ? '#ff7a1a' : '#ffd166' });
    }
    this.spawnDust(x, y, radius * 0.8, 3, 1);
  }

  spawnDebris(o, n) {
    const size = Math.max(o.w, o.h);
    this.spawnDebrisAt(o.x, o.y, size / 2, o.color, n, o.fallDir);
  }

  spawnDebrisAt(x, y, radius, color, n, dir = null) {
    const ds = this.fx.debris;
    for (let i = 0; i < n; i++) {
      if (ds.length >= LIMITS.debris) ds.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = radius * (1 + Math.random() * 1.5);
      ds.push({
        x: x + Math.cos(a) * radius * 0.4, y: y + Math.sin(a) * radius * 0.4, z: radius * 0.3,
        vx: Math.cos(a) * sp + (dir ? dir.x * radius * 2 : 0), vy: Math.sin(a) * sp + (dir ? dir.y * radius * 2 : 0),
        vz: radius * (2 + Math.random() * 2), size: radius * (0.12 + Math.random() * 0.15), color,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, life: 1.6, max: 1.6,
      });
    }
  }

  spawnOrbs(x, y, n, biomass) {
    const os = this.fx.orbs;
    for (let i = 0; i < n && os.length < 150; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 120;
      os.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, color: biomass && i % 2 === 0 ? '#7dff5a' : '#ffd84a' });
    }
  }

  updateFx(dt) {
    const k = this.kaiju;
    const { particles, debris, orbs, floaters, rings, beams, bolts } = this.fx;
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 2;
      p.vy *= 1 - dt * 2;
    }
    for (const d of debris) {
      d.life -= dt;
      d.vz -= 900 * dt * (d.size / 10 + 0.5);
      d.z += d.vz * dt;
      if (d.z < 0) {
        d.z = 0;
        d.vz *= -0.3;
        d.vx *= 0.6;
        d.vy *= 0.6;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
    }
    for (const o of orbs) {
      o.t += dt;
      const toK = norm(k.x - o.x, k.y - o.y);
      const pull = o.t * 2600 + 200;
      o.vx += toK.x * pull * dt;
      o.vy += toK.y * pull * dt;
      o.vx *= 1 - dt * 3;
      o.vy *= 1 - dt * 3;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (Math.hypot(k.x - o.x, k.y - o.y) < k.r * 0.6 || o.t > 2) o.t = 99;
    }
    for (const f of floaters) {
      f.life -= dt;
      f.y -= f.size * 1.2 * dt;
    }
    for (const r of rings) r.life -= dt;
    for (const b of beams) b.life -= dt;
    for (const b of bolts) b.life -= dt;
    if (k.lastAttack) {
      k.lastAttack.t -= dt;
      if (k.lastAttack.t <= 0) k.lastAttack = null;
    }
    this.fx.particles = particles.filter((p) => p.life > 0);
    this.fx.debris = debris.filter((d) => d.life > 0);
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
      s.buildings * 10 + s.units * 5 + scrapRaw * 0.5 + (won ? 5000 : 0) + (s.landmark ? 1000 : 0) + (won ? Math.max(0, 900 - this.time) * 5 : 0),
    );
    this.results = {
      won,
      time: this.time,
      kaiju: this.def.name,
      kaijuId: this.def.id,
      city: this.cityDef.name,
      cityId: this.cityDef.id,
      difficulty: this.diff.id,
      stage: this.kaiju.stage,
      scrap,
      scrapRaw,
      biomass: Math.round(s.biomass),
      buildings: s.buildings,
      destroyed: s.destroyed,
      units: s.units,
      landmark: s.landmark,
      rareMaterials: s.rareMaterials,
      augments: [...this.held.entries()].map(([id, level]) => ({ id, name: AUGMENT_BY_ID[id].name, level })),
      sets: sets.map((x) => x.name),
      title: sets.length ? sets.map((x) => x.name).join(' + ') : null,
      score,
      firstSkyscraperAt: s.firstSkyscraperAt,
      stageTimes: s.stageTimes,
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
    if (this.kaiju.stage < MAX_STAGE) this.addBiomass(this.stage.biomassToNext - this.kaiju.biomass);
  }
}
