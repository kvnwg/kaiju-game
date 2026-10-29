// Attack moves granted by augments. Each move's level (1-8) sets its stats and unlocks its
// signature upgrades (see moveStats in augments.js). Each move fires on its own cooldown
// when something is in reach; the visuals are described through game.fx
// (slashes, beams, rings, swirls, cracks) and the kaiju's animation state (kaiju.anim).
import { canDamage } from './config.js';
import { MOVES, moveStats } from './augments.js';
import { norm, distToRect, closestPoint, angleDiff, distToSegment } from './geom.js';

const GHOST = 0xc58bff; // tint for Echo repeats
// What Car Toss throws in each realm: cars in the city, junk and rocks in space, acorns in the garden.
const THROWABLES = {
  city: ['car', 'hatchback', 'taxi', 'van', 'pickup', 'bus'],
  solar: ['rocklet', 'satellite', 'rocket', 'space_junk'],
  galaxy: ['planetoid', 'ice_comet'],
  cosmos: ['dwarf_galaxy', 'starlet', 'nebula_puff'],
  garden: ['acorn', 'berry', 'bottle_cap', 'stone'],
};

export class MoveSystem {
  constructor(game) {
    this.g = game;
    this.timers = {};
    this.active = [];
    this.slamUntil = -1; // game time a Seismic Slam in the air lands
  }

  get k() {
    return this.g.kaiju;
  }

  // Global area from the Kaiju-Sized passive.
  size() {
    return 1 + 0.1 * this.g.level('area') + (this.g.meta && this.g.meta.perks.crystalSpines ? 0.15 : 0);
  }

  st(id) {
    return moveStats(id, this.g.level(id));
  }

  cooldown(id) {
    const m = MOVES.find((mv) => mv.id === id);
    let cd = m.cd * Math.max(0.3, this.st(id).cd) * (1 - 0.08 * this.g.level('adrenaline')) * (this.g.meta && this.g.meta.perks.atomicHeart ? 0.9 : 1);
    if (id === 'spineMissiles' && this.g.has('spineStorm')) cd *= 0.35;
    if (id === 'tailSpin' && this.g.has('cycloneKing')) cd = 3;
    return cd;
  }

  // Bloodlust: knock time off every cooldown.
  refund(seconds) {
    for (const id of Object.keys(this.timers)) this.timers[id] = Math.max(0, this.timers[id] - seconds);
  }

  // 0..1 charge for the HUD.
  readiness(id) {
    const t = this.timers[id];
    if (t === undefined) return 1;
    return Math.max(0, Math.min(1, 1 - t / this.cooldown(id)));
  }

  update(dt) {
    const g = this.g;
    const k = this.k;
    // Overclock: cooldowns run faster while badly hurt.
    if (g.has('overclock') && k.hp < k.maxHp * 0.5) dt *= 1 + 0.15 * g.level('overclock');
    if (g.has('orbitingSpines')) this.orbit(dt);
    if (g.has('extinctionEvent')) this.meteorShower(dt);
    for (const m of MOVES) {
      if (!g.has(m.id) || m.id === 'orbitingSpines') continue;
      if (this.timers[m.id] === undefined) this.timers[m.id] = 1;
      this.timers[m.id] -= dt;
      if (this.timers[m.id] > 0) continue;
      if (this.cast(m.id, false)) {
        this.timers[m.id] = this.cooldown(m.id);
        g.stats.moves = (g.stats.moves || 0) + 1;
        g.fxEvent({ t: 'move', id: m.id });
        if (g.rng.chance(0.3 * g.level('echo'))) g.schedule(0.5, () => this.cast(m.id, true) && g.fxEvent({ t: 'move', id: m.id, echo: true }));
      } else this.timers[m.id] = 0.3;
    }
    for (const a of this.active) a.update(dt);
    this.active = this.active.filter((a) => !a.done);
  }

  cast(id, echo) {
    if (this.g.state !== 'playing') return false;
    switch (id) {
      case 'clawStrike': return this.clawStrike(echo);
      case 'tailSpin': return this.tailSpin(echo);
      case 'spineMissiles': return this.spineMissiles(echo);
      case 'carToss': return this.carToss(echo);
      case 'roar': return this.roar(echo);
      case 'laserEyes': return this.laserEyes(echo);
      case 'seismicSlam': return this.seismicSlam(echo);
      case 'atomicBreath': return this.atomicBreath(echo);
      case 'meteorCall': return this.meteorCall(echo);
      case 'lightningBreath': return this.lightningBreath(echo);
      case 'buildingHurl': return this.buildingHurl(echo);
      case 'acidSpit': return this.acidSpit(echo);
      case 'iceBreath': return this.iceBreath(echo);
      case 'vortexBelch': return this.vortexBelch(echo);
      case 'magneticRoar': return this.magneticRoar(echo);
      case 'frenzyBite': return this.frenzyBite(echo);
      case 'broodCall': return this.broodCall(echo);
      default: return false;
    }
  }

  // ------------------------------------------------------------ targeting & hits
  // Everything the kaiju could hurt within `reach`, nearest first. Threats come before scenery.
  targets(reach, max = 1, exclude = []) {
    const g = this.g;
    const k = this.k;
    const out = [];
    const add = (t, d) => {
      if (d <= reach && !exclude.includes(t)) out.push({ t, d });
    };
    const b = g.boss;
    if (b && !b.dead && b.state !== 'enter') add(b, Math.hypot(b.x - k.x, b.y - k.y) - b.r);
    for (const u of g.units) if (!u.dead && u.type !== 'jet') add(u, Math.hypot(u.x - k.x, u.y - k.y) - u.r);
    const threats = out.length;
    for (const c of g.traffic) if (!c.dead) add(c, Math.hypot(c.x - k.x, c.y - k.y) + reach * 0.15);
    if (k.stage <= 2) for (const p of g.people) if (!p.taken) add(p, Math.hypot(p.x - k.x, p.y - k.y) + reach * 0.2);
    if (out.length < max || threats === 0) {
      for (const o of g.objectsNear(k.x, k.y, reach)) {
        if (o.state !== 'intact' || !canDamage(o.tier, k.stage, o.landmark) || o.walkable) continue;
        if (o.tier < k.stage - 1 && !o.structure) continue; // skip pebbles: aim for things worth hitting
        add(o, distToRect(k.x, k.y, o) + reach * 0.25);
      }
    }
    out.sort((a, b2) => a.d - b2.d);
    return out.slice(0, max).map((e) => e.t);
  }

  base() {
    return this.g.baseDamage() * 0.8;
  }

  hitArc(x, y, ang, arc, reach, dmg) {
    const g = this.g;
    const inArc = (px, py, pad = 0) => {
      const d = Math.hypot(px - x, py - y);
      if (d > reach + pad) return false;
      return arc >= Math.PI * 2 - 0.01 || Math.abs(angleDiff(Math.atan2(py - y, px - x), ang)) <= arc / 2 + Math.atan2(pad, Math.max(1, d));
    };
    for (const o of g.objectsNear(x, y, reach)) {
      const cp = closestPoint(x, y, o);
      if (inArc(cp.x, cp.y) || inArc(o.x, o.y, Math.min(o.w, o.h) / 2)) g.damageObject(o, dmg, norm(o.x - x, o.y - y), 'hit', cp);
    }
    for (const u of g.units) if (!u.dead && !u.flying && inArc(u.x, u.y, u.r)) g.damageUnit(u, dmg);
    for (const p of g.people) if (!p.taken && inArc(p.x, p.y)) g.flingPerson(p, false, { x, y });
    for (const c of g.traffic) if (!c.dead && inArc(c.x, c.y, 4)) g.damageCar(c, dmg);
    const b = g.boss;
    if (b && !b.dead && b.state !== 'enter' && inArc(b.x, b.y, b.r)) g.damageBoss(dmg);
  }

  hitLine(x1, y1, x2, y2, width, dmg) {
    this.g.lineDamage(x1, y1, x2, y2, width, dmg);
  }

  anim(kind, dur, extra = {}) {
    this.k.anim = { kind, t: dur, max: dur, ...extra };
  }

  // ------------------------------------------------------------ Claw Strike
  clawStrike(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('clawStrike');
    const S = this.size() * s.area;
    const wide = s.full;
    const reach = k.r * 2.6 * S;
    const D = this.base() * s.dmg;
    const [t] = this.targets(reach + k.r * 0.5);
    if (!t) return false;
    const ang = Math.atan2(t.y - k.y, t.x - k.x);
    const slash = (side) => {
      const arc = wide ? Math.PI * 1.9 : 2.3;
      this.hitArc(k.x, k.y, ang, arc, reach, D * 3.2);
      g.fx.slashes.push({ x: k.x, y: k.y, ang, arc, r: reach, side, life: 0.34, max: 0.34, color: echo ? GHOST : 0xfff3c4, h: k.r * 0.75 });
      this.anim('claw', 0.26, { side });
      g.shake = Math.max(g.shake, 0.14);
      if (s.molten) {
        for (let i = -1; i <= 1; i++) {
          const a = ang + i * arc * 0.3;
          g.fires.push({ x: k.x + Math.cos(a) * reach * 0.7, y: k.y + Math.sin(a) * reach * 0.7, r: k.r * 0.7 * S, t: 3.5, max: 3.5, tick: 0 });
        }
      }
    };
    slash(1);
    if (s.twice) g.schedule(0.2, () => slash(-1));
    return true;
  }

  // ------------------------------------------------------------ Tail Spin
  tailSpin(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('tailSpin');
    const S = this.size() * s.area;
    const reach = k.r * 3.1 * S;
    if (!this.targets(reach).length) return false;
    const spins = s.spins;
    const king = g.has('cycloneKing');
    const cyclone = Boolean(s.cyclone) || king;
    const D = s.dmg * (king ? 1.3 : 1);
    const dur = king ? 3 : cyclone ? 2 * s.duration : 0.42 * spins;
    if (king) {
      this.cycloneUntil = g.time + dur;
    }
    const turns = cyclone ? 5 * spins : spins;
    this.anim('spin', dur, { turns });
    let hitT = 0;
    let hits = 0;
    const totalHits = cyclone ? Math.round(dur / 0.25) : spins;
    const color = echo ? GHOST : 0xe8f6ff;
    if (cyclone) g.fx.swirls.push({ x: k.x, y: k.y, r: reach * 1.5, life: dur, max: dur, follow: true, color: echo ? GHOST : 0xd9cbb0 });
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        hitT -= dt;
        if (cyclone) {
          // Drag the small stuff in.
          const pull = reach * 1.6;
          for (const p of g.people) {
            if (p.taken) continue;
            const d = Math.hypot(p.x - k.x, p.y - k.y);
            if (d < pull * 1.5 && d > 0.1) {
              p.x += ((k.x - p.x) / d) * pull * 0.9 * dt;
              p.y += ((k.y - p.y) / d) * pull * 0.9 * dt;
            }
          }
          for (const u of g.units) {
            if (u.dead || u.flying || u.road) continue;
            const d = Math.hypot(u.x - k.x, u.y - k.y);
            if (d < pull * 1.5 && d > 0.1) {
              // Dragged along the ground, but never into a building.
              const nx = u.x + ((k.x - u.x) / d) * pull * 0.6 * dt;
              const ny = u.y + ((k.y - u.y) / d) * pull * 0.6 * dt;
              if (!g.blockedAt(nx, ny, u.r * 0.6, u.def.mob ? u.tier : 0)) {
                u.x = nx;
                u.y = ny;
              }
            }
          }
        }
        if (hitT <= 0 && hits < totalHits) {
          hitT = cyclone ? 0.25 : 0.42;
          hits++;
          g.areaDamage(k.x, k.y, reach, g.baseDamage() * D * (cyclone ? 1.3 : 2.6), 'hit');
          g.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: reach * 1.1, life: 0.35, max: 0.35, color, width: k.r * 0.25 });
          g.fxEvent({ t: 'dust', x: k.x, y: k.y, r: reach * 0.8 });
          g.shake = Math.max(g.shake, 0.2);
        }
        if (this.t >= dur) this.done = true;
      },
    });
    return true;
  }

  // ------------------------------------------------------------ Spine Missiles
  spineMissiles(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('spineMissiles');
    const S = this.size() * s.area;
    const n = s.count + (g.has('spineStorm') ? 4 : 0);
    const targets = this.targets(k.r * 12 * S, n);
    if (!targets.length) return false;
    this.anim('spines', 0.5);
    for (let i = 0; i < n; i++) {
      const t = targets[i % targets.length];
      g.schedule(i * 0.06, () => this.launchSpine(k.x - k.facing.x * k.r * 0.3, k.y - k.facing.y * k.r * 0.3, t, 1, echo, i));
    }
    return true;
  }

  launchSpine(x, y, target, scale, echo, i = 0) {
    const g = this.g;
    const k = this.k;
    const S = this.size();
    const sp = g.stage.speed * 3.2 + 40;
    const spread = (i % 2 ? 1 : -1) * (0.6 + (i % 4) * 0.25);
    const d = norm(target.x - x, target.y - y);
    g.projectiles.push({
      friendly: true, kind: 'spine', x, y, x0: x, y0: y, vx: (d.x - d.y * spread) * sp, vy: (d.y + d.x * spread) * sp, speed: sp,
      r: k.r * 0.2 * scale, size: k.r * 0.22 * scale * S, arc: k.r * 2.6 * scale, h0: k.r * 1.4, dmg: this.base() * this.st('spineMissiles').dmg * 1.7 * scale, life: 3, target,
      color: echo ? GHOST : 0x8affd2, age: 0,
      onHit: (p) => {
        const r = k.r * 0.7 * scale * S;
        g.areaDamage(p.x, p.y, r, p.dmg * 0.6, 'hit');
        g.fx.rings.push({ x: p.x, y: p.y, r0: r * 0.2, r1: r, life: 0.25, max: 0.25, color: p.color, width: r * 0.3 });
        g.fxEvent({ t: 'sparks', x: p.x, y: p.y, h: k.r * 0.3, color: p.color });
        if (scale === 1 && this.st('spineMissiles').cluster) {
          const near = this.targets(k.r * 14, 6).filter((t) => t !== target && Math.hypot(t.x - p.x, t.y - p.y) < k.r * 5);
          for (let j = 0; j < 3; j++) {
            const nt = near[j] || { x: p.x + Math.cos(j * 2.1) * k.r * 2, y: p.y + Math.sin(j * 2.1) * k.r * 2 };
            this.launchSpine(p.x, p.y, nt, 0.55, echo, j);
          }
        }
      },
    });
  }

  // ------------------------------------------------------------ Car Toss
  carToss(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('carToss');
    const S = this.size() * s.area;
    const storm = g.has('junkyardStorm');
    const count = storm ? s.count + 5 : s.count;
    const targets = this.targets(k.r * 11 * S, count);
    if (!targets.length) return false;
    this.anim('throw', 0.35);
    if (storm) {
      // Cars circle up out of the wreckage, then fire outward at everything in reach.
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const sx = k.x + Math.cos(a) * k.r * 2.4;
        const sy = k.y + Math.sin(a) * k.r * 2.4;
        g.fx.rings.push({ x: sx, y: sy, r0: k.r * 0.2, r1: k.r * 0.8, life: 0.4, max: 0.4, color: 0xff9a3c, width: k.r * 0.12 });
        const model = g.rng.pick(THROWABLES[g.realm] || THROWABLES.city);
        g.schedule(0.35 + i * 0.07, () => this.throwCar(sx, sy, targets[i % targets.length], model, g.rng.int(0, 2), s.bounce, echo));
      }
      return true;
    }
    for (let i = 0; i < count; i++) {
      // Use a real car off the street when one is close, otherwise one appears from the rubble.
      let model = g.rng.pick(THROWABLES[g.realm] || THROWABLES.city);
      let variant = g.rng.int(0, 2);
      const grab = g.traffic.find((c) => !c.dead && Math.hypot(c.x - k.x, c.y - k.y) < k.r * 5);
      if (grab) {
        grab.dead = true;
        grab.silent = true;
        model = grab.model;
        variant = grab.variant;
      }
      g.schedule(i * 0.12, () => this.throwCar(k.x, k.y, targets[i % targets.length], model, variant, s.bounce, echo));
    }
    return true;
  }

  throwCar(x, y, target, model, variant, bounces, echo, hit = []) {
    const g = this.g;
    const k = this.k;
    const cs = this.st('carToss');
    const S = this.size() * cs.area;
    const sp = g.stage.speed * 2.6 + 30;
    const d = norm(target.x - x, target.y - y);
    g.projectiles.push({
      friendly: true, kind: 'car', model, variant, x, y, x0: x, y0: y, vx: d.x * sp, vy: d.y * sp, speed: sp,
      r: k.r * 0.4, scale: Math.max(1, k.r / 10) * Math.min(1.5, S), arc: k.r * 2.2, h0: k.r * 1.6, dmg: this.base() * cs.dmg * 3, life: 3, target, age: 0,
      spin: g.rng.range(4, 9), color: echo ? GHOST : 0xff9a3c,
      onHit: (p) => {
        const r = k.r * 1.3 * S;
        g.areaDamage(p.x, p.y, r, p.dmg, 'hit');
        g.spawnExplosion(p.x, p.y, r);
        g.shake = Math.max(g.shake, 0.25);
        if (bounces > 0) {
          const next = this.targets(k.r * 14, 6, [...hit, target]).find((t) => Math.hypot(t.x - p.x, t.y - p.y) < k.r * 8);
          if (next) this.throwCar(p.x, p.y, next, model, variant, bounces - 1, echo, [...hit, target]);
        }
      },
    });
  }

  // ------------------------------------------------------------ Roar
  roar(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('roar');
    const doom = g.has('doomRoar');
    const S = this.size() * s.area * (doom ? 1.3 : 1);
    const radius = k.r * 8 * S;
    if (!this.targets(radius).length) return false;
    if (doom) {
      // Doom Roar: everything a size below you within the blast is flattened outright.
      for (const o of g.objectsNear(k.x, k.y, radius * 0.8)) if (o.tier < k.stage && !o.landmark && !o.walkable) g.destroyObject(o, norm(o.x - k.x, o.y - k.y), 'hit');
      for (const u of g.units) if (!u.dead && u.tier < k.stage && Math.hypot(u.x - k.x, u.y - k.y) < radius * 0.8) g.killUnit(u);
      g.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius * 0.85, life: 0.7, max: 0.7, color: 0xff3b3b, width: k.r * 0.6 });
      g.impact(0.08, 0.6);
    }
    this.anim('roar', 0.9);
    const color = echo ? GHOST : 0xffe9a8;
    for (let i = 0; i < 3; i++) g.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: radius * (0.7 + i * 0.15), life: 0.6 + i * 0.15, max: 0.6 + i * 0.15, color, width: k.r * (0.35 - i * 0.08) });
    for (const u of g.units) if (!u.dead && u.def.soft && Math.hypot(u.x - k.x, u.y - k.y) < radius) u.fear = s.fear;
    for (const p of g.people) if (!p.taken && Math.hypot(p.x - k.x, p.y - k.y) < radius * 0.6) g.flingPerson(p, false, k);
    // Shatter the windows nearby: every building in range gets chipped.
    for (const o of g.objectsNear(k.x, k.y, radius * 0.7)) {
      if (o.structure && o.state === 'intact') g.damageObject(o, this.base() * s.dmg * (s.sonic ? 4 : 0.5), norm(o.x - k.x, o.y - k.y), 'hit', closestPoint(k.x, k.y, o));
    }
    if (s.sonic) g.areaDamage(k.x, k.y, radius * 0.7, this.base() * s.dmg * 2, 'hit');
    g.shake = Math.max(g.shake, 0.35);
    g.emit('roar');
    return true;
  }

  // ------------------------------------------------------------ Laser Eyes
  laserEyes(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('laserEyes');
    const S = this.size() * s.area;
    const over = Boolean(s.sweepBack);
    const omega = g.has('omegaBeam');
    const len = k.r * 9 * S * s.length;
    const D = s.dmg * (omega ? 1.6 : 1);
    const [t] = this.targets(len * 0.9);
    if (!t) return false;
    const center = Math.atan2(t.y - k.y, t.x - k.x);
    const sweep = 0.95;
    const dur = over ? 1.6 : 0.9;
    const width = k.r * 0.3 * S * s.width * (omega ? 1.4 : 1);
    const fan = s.split ? [-0.22, 0, 0.22] : [0];
    const color = echo ? GHOST : omega ? 0xffffff : 0xff3b6b;
    let scorch = 0;
    this.anim('laser', dur + 0.1);
    let tick = 0;
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        const f = Math.min(1, this.t / dur);
        // Sweep left to right (and back again when overcharged).
        const s = over ? Math.sin(f * Math.PI * 2 - Math.PI / 2) : f * 2 - 1;
        const a = center + s * sweep;
        k.facing = { x: Math.cos(a), y: Math.sin(a) };
        const hx = k.x + Math.cos(a) * k.r * 0.9;
        const hy = k.y + Math.sin(a) * k.r * 0.9;
        tick -= dt;
        const hit = tick <= 0;
        if (hit) tick = 0.1;
        for (const eye of [-1, 1]) {
          const ex = hx - Math.sin(a) * k.r * 0.18 * eye;
          const ey = hy + Math.cos(a) * k.r * 0.18 * eye;
          for (const off of fan) {
            const b = a + off + eye * 0.03;
            const x2 = ex + Math.cos(b) * len;
            const y2 = ey + Math.sin(b) * len;
            g.fx.beams.push({ x1: ex, y1: ey, x2, y2, width, life: 0.06, max: 0.06, color, h: k.r * 1.55, h2: 0.6, noFlash: true, spark: true, core: true });
            if (hit) g.lineDamage(ex, ey, x2, y2, width * 1.6, g.baseDamage() * D * 0.55);
            // Omega Beam: the sweep leaves a burning scar across the city.
            if (omega && hit && eye === 1 && off === 0 && (scorch = (scorch + 1) % 2) === 0) {
              const f = 0.3 + Math.random() * 0.7;
              g.fires.push({ x: ex + (x2 - ex) * f, y: ey + (y2 - ey) * f, r: k.r * 0.8, t: 5, max: 5, tick: 0 });
            }
          }
        }
        if (this.t >= dur) this.done = true;
      },
    });
    return true;
  }

  // ------------------------------------------------------------ Seismic Slam
  seismicSlam(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('seismicSlam');
    const S = this.size() * s.area;
    const radius = k.r * 4.6 * S;
    if (!this.targets(radius * 1.2).length) return false;
    // An echo that comes up mid-leap waits for this slam to land.
    if (g.time < this.slamUntil) {
      g.schedule(this.slamUntil - g.time + 0.12, () => this.cast('seismicSlam', true));
      return true;
    }
    // Crouch, leap, hang at the top, then drop: squash, a hit-stop, shockwave rings, a burst of
    // flung rock, glowing cracks and a second ripple running out after the first.
    const T = { crouch: 0.14, rise: 0.3, hang: 0.08, drop: 0.09 };
    const landAt = T.crouch + T.rise + T.hang + T.drop;
    const top = k.r * 2.8;
    this.slamUntil = g.time + landAt;
    this.anim('slam', landAt + 0.34, T);
    const color = echo ? GHOST : 0xffc36b;
    const land = () => {
      g.areaDamage(k.x, k.y, radius, this.base() * s.dmg * 4.5, 'hit');
      g.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 0.6, r1: radius, life: 0.5, max: 0.5, color, width: k.r * 0.45 });
      g.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 0.3, r1: radius * 0.6, life: 0.35, max: 0.35, color: 0xffffff, width: k.r * 0.3 });
      g.fxEvent({ t: 'slam', x: k.x, y: k.y, r: radius, kr: k.r, echo });
      g.fx.cracks.push({ x: k.x, y: k.y, r: radius * 0.8, life: 2.5, max: 2.5, seed: Math.random() * 100 });
      g.shake = Math.max(g.shake, 0.8);
      g.impact(0.07, 0.9);
      g.schedule(0.16, () => {
        g.fx.rings.push({ x: k.x, y: k.y, r0: radius * 0.7, r1: radius * 1.35, life: 0.45, max: 0.45, color, width: k.r * 0.22 });
        g.fxEvent({ t: 'dustRing', x: k.x, y: k.y, r: radius * 1.2 });
      });
      g.emit('slam');
      for (let i = 0; i < s.aftershock; i++) {
        g.schedule(0.55 * (i + 1), () => {
          g.areaDamage(k.x, k.y, radius * 1.45, this.base() * s.dmg * 3, 'hit');
          g.fx.rings.push({ x: k.x, y: k.y, r0: radius * 0.5, r1: radius * 1.45, life: 0.6, max: 0.6, color, width: k.r * 0.5 });
          g.fxEvent({ t: 'dust', x: k.x, y: k.y, r: radius * 1.2 });
          g.shake = Math.max(g.shake, 0.5);
        });
      }
      const chasm = g.has('earthbreaker');
      if (s.faults || chasm) {
        const base = Math.atan2(k.facing.y, k.facing.x) + Math.PI / 4;
        for (let i = 0; i < 4; i++) this.faultLine(k.x, k.y, base + (i * Math.PI) / 2, radius * (chasm ? 3.2 : 2.4), echo, chasm);
      }
    };
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        const t = this.t;
        const up = T.crouch + T.rise;
        if (t < T.crouch) k.z = 0;
        else if (t < up) k.z = top * (1 - (1 - (t - T.crouch) / T.rise) ** 2);
        else if (t < up + T.hang) k.z = top * (1 + 0.04 * Math.sin(((t - up) / T.hang) * Math.PI));
        else if (t < landAt) k.z = top * (1 - ((t - up - T.hang) / T.drop) ** 2);
        else {
          k.z = 0;
          land();
          this.done = true;
        }
      },
    });
    return true;
  }

  faultLine(x, y, ang, len, echo, chasm = false) {
    const g = this.g;
    const k = this.k;
    const steps = 8;
    const seg = len / steps;
    let px = x;
    let py = y;
    let a = ang;
    for (let i = 0; i < steps; i++) {
      g.schedule(i * 0.06, () => {
        a += (Math.random() - 0.5) * 0.5;
        const nx = px + Math.cos(a) * seg;
        const ny = py + Math.sin(a) * seg;
        g.lineDamage(px, py, nx, ny, k.r * (chasm ? 1.6 : 0.9), g.baseDamage() * (chasm ? 6 : 3));
        g.fx.beams.push({ x1: px, y1: py, x2: nx, y2: ny, width: k.r * (chasm ? 1.1 : 0.5), life: chasm ? 4 : 1.6, max: chasm ? 4 : 1.6, color: echo ? GHOST : chasm ? 0xff4a10 : 0xff7a1a, h: 0.4, noFlash: true });
        // Earthbreaker: the chasm swallows any unit your size or smaller.
        if (chasm) for (const u of g.units) if (!u.dead && !u.flying && u.tier <= k.stage && distToSegment(u.x, u.y, px, py, nx, ny) < k.r * 0.9 + u.r) g.killUnit(u);
        g.fxEvent({ t: 'dust', x: nx, y: ny, r: k.r * 0.8 });
        px = nx;
        py = ny;
      });
    }
  }

  // ------------------------------------------------------------ Atomic Breath
  atomicBreath(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('atomicBreath');
    const S = this.size() * s.area;
    const len = k.r * 13 * S * s.length;
    const melt = g.has('meltdown');
    const D = s.dmg * (melt ? 1.3 : 1);
    if (!this.targets(len * 0.8).length) return false;
    const charge = 0.55;
    const dur = 1.2 * s.duration;
    const width = k.r * 0.95 * S * s.width;
    const color = echo ? GHOST : 0x7df9ff;
    this.anim('breath', charge + dur, { charge });
    let tick = 0;
    let fireT = 0;
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        if (this.t < charge) return;
        const f = k.facing;
        const x1 = k.x + f.x * k.r * 1.1;
        const y1 = k.y + f.y * k.r * 1.1;
        const x2 = x1 + f.x * len;
        const y2 = y1 + f.y * len;
        g.fx.beams.push({ x1, y1, x2, y2, width, life: 0.07, max: 0.07, color, h: k.r * 1.3, h2: k.r * 0.3, noFlash: true, spark: true, core: true });
        g.shake = Math.max(g.shake, 0.18);
        tick -= dt;
        if (tick <= 0) {
          tick = 0.12;
          g.lineDamage(x1, y1, x2, y2, width, g.baseDamage() * D * 1.5);
        }
        if (s.napalm) {
          fireT -= dt;
          if (fireT <= 0) {
            fireT = 0.15;
            const t = 0.35 + Math.random() * 0.65;
            g.fires.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, r: k.r * 0.9 * S, t: 4, max: 4, tick: 0 });
          }
        }
        if (this.t >= charge + dur) {
          this.done = true;
          // Meltdown: when badly hurt, the breath ends in a detonation where it lands.
          if (melt && k.hp < k.maxHp * 0.4) {
            const R = k.r * 5 * S;
            g.areaDamage(x2, y2, R, g.baseDamage() * 12, 'hit');
            g.spawnExplosion(x2, y2, R);
            g.fx.rings.push({ x: x2, y: y2, r0: R * 0.2, r1: R * 1.3, life: 0.9, max: 0.9, color: 0x7df9ff, width: R * 0.2 });
            g.fx.cracks.push({ x: x2, y: y2, r: R, life: 3, max: 3, seed: Math.random() * 100 });
            g.shake = 1;
            g.impact(0.15, 1);
          }
        }
      },
    });
    return true;
  }

  // ------------------------------------------------------------ Meteor Call
  meteorCall(echo) {
    const g = this.g;
    const k = this.k;
    const ok = g.callMeteor();
    if (!ok) return false;
    this.anim('summon', 1);
    const s = this.st('meteorCall');
    if (s.count > 1) {
      const span = g.viewSpan() * 0.35;
      for (let i = 0; i < s.count - 1; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = span * (0.3 + Math.random() * 0.7);
        const x = k.x + Math.cos(a) * d;
        const y = k.y + Math.sin(a) * d;
        const r = k.r * 2.2 * this.size() * s.area;
        g.hazards.push({
          friendly: true, kind: 'circle', x, y, r, t: 0, delay: 1.4 + i * 0.22, meteor: true, ghost: echo,
          onHit: () => {
            g.areaDamage(x, y, r * 1.4, g.baseDamage() * s.dmg * 5, 'hit');
            g.spawnExplosion(x, y, r * 1.3);
            g.shake = Math.max(g.shake, 0.6);
          },
        });
      }
    }
    return true;
  }

  // ------------------------------------------------------------ Extinction Event (evolution)
  meteorShower(dt) {
    const g = this.g;
    const k = this.k;
    this.showerT = (this.showerT ?? 1) - dt;
    if (this.showerT > 0 || g.state !== 'playing') return;
    this.showerT = 1.4;
    const s = this.st('meteorCall');
    const span = g.viewSpan() * 0.4;
    const a = Math.random() * Math.PI * 2;
    const d = span * (0.25 + Math.random() * 0.75);
    const x = k.x + Math.cos(a) * d;
    const y = k.y + Math.sin(a) * d;
    const r = k.r * 2 * this.size() * s.area;
    g.hazards.push({
      friendly: true, kind: 'circle', x, y, r, t: 0, delay: 1.1, meteor: true,
      onHit: () => {
        g.areaDamage(x, y, r * 1.4, g.baseDamage() * s.dmg * 4, 'hit');
        g.spawnExplosion(x, y, r * 1.3);
        g.shake = Math.max(g.shake, 0.4);
      },
    });
  }

  // ------------------------------------------------------------ Lightning Breath
  // Nearest thing that conducts: units and vehicles first, then anything breakable.
  metalNear(from, reach, exclude) {
    const g = this.g;
    const k = this.k;
    let best = null;
    let bestD = reach;
    const consider = (t, d) => {
      if (d < bestD && !exclude.includes(t)) {
        best = t;
        bestD = d;
      }
    };
    for (const u of g.units) if (!u.dead && u.type !== 'jet') consider(u, Math.hypot(u.x - from.x, u.y - from.y) - u.r);
    for (const c of g.traffic) if (!c.dead) consider(c, Math.hypot(c.x - from.x, c.y - from.y));
    const b = g.boss;
    if (b && !b.dead && b.state !== 'enter') consider(b, Math.hypot(b.x - from.x, b.y - from.y) - b.r);
    if (!best) {
      for (const o of g.objectsNear(from.x, from.y, reach)) {
        if (o.walkable || !canDamage(o.tier, k.stage, o.landmark) || !(o.vehicle || o.structure)) continue;
        consider(o, Math.hypot(o.x - from.x, o.y - from.y));
      }
    }
    return best;
  }

  lightningBreath(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('lightningBreath');
    const S = this.size() * s.area;
    const [first] = this.targets(k.r * 7 * S);
    if (!first) return false;
    this.anim('breath', 0.4, { charge: 0.1, tint: 'lightning' });
    const color = echo ? GHOST : 0x9fe8ff;
    const hit = [];
    const chain = (from, t, n, dmg) => {
      const pts = [{ x: from.x, y: from.y }];
      let cur = t;
      let prev = from;
      for (let i = 0; i < n && cur; i++) {
        pts.push({ x: cur.x, y: cur.y });
        hit.push(cur);
        g.damageTarget(cur, dmg, norm(cur.x - prev.x, cur.y - prev.y), 'hit');
        g.fxEvent({ t: 'sparks', x: cur.x, y: cur.y, h: k.r * 0.5, color });
        const nxt = this.metalNear(cur, k.r * 4 * S, hit);
        if (s.fork && i % 2 === 0) {
          const f = this.metalNear(cur, k.r * 4 * S, [...hit, nxt]);
          if (f) chain(cur, f, 1, dmg * 0.7);
        }
        prev = cur;
        cur = nxt;
        dmg *= 0.88;
      }
      g.fx.bolts.push({ points: pts, life: 0.3, max: 0.3, width: Math.max(0.4, k.r * 0.12), color });
    };
    chain({ x: k.x + k.facing.x * k.r, y: k.y + k.facing.y * k.r }, first, s.count, this.base() * s.dmg * 2.6);
    g.shake = Math.max(g.shake, 0.15);
    return true;
  }

  // ------------------------------------------------------------ Building Hurl
  buildingHurl(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('buildingHurl');
    const S = this.size() * s.area;
    const targets = this.targets(k.r * 13 * S, Math.max(3, s.count)).sort((a, b) => (b.isUnit ? 1 : 0) - (a.isUnit ? 1 : 0));
    if (!targets.length) return false;
    // Rip up the biggest building within arm's reach.
    const near = g.objectsNear(k.x, k.y, k.r * 3).filter((o) => o.structure && !o.walkable && !o.landmark && o.tier <= k.stage && canDamage(o.tier, k.stage, false));
    near.sort((a, b) => b.w * b.h * b.height - a.w * a.h * a.height);
    if (!near.length) return false;
    this.anim('heave', 0.6);
    const colors = { neon: 0x3a3f4a, brick: 0x9a4a3a, garden: 0xd8d2c4, pastel: 0xe8c8a8, suburb: 0xd9c8a8, docks: 0x8a8f96, farm: 0xb83a2a, desert: 0xd8a878, snow: 0x8a5a3a, lantern: 0xc8302a, fair: 0xff5a8a };
    for (let i = 0; i < s.count; i++) {
      const b = near[i % near.length];
      const t = targets[i % targets.length];
      // The building is torn up as the kaiju reaches down, then flies from its hands at the
      // top of the heave.
      if (i < near.length && b.state === 'intact') g.destroyObject(b, norm(t.x - b.x, t.y - b.y), 'hit');
      g.schedule(0.32 + i * 0.25, () => {
        const size = Math.max(b.w, b.h);
        if (b.state === 'intact') g.destroyObject(b, norm(t.x - b.x, t.y - b.y), 'hit');
        const sp = g.stage.speed * 2.2 + 30;
        const x0 = k.x + k.facing.x * k.r * 0.6;
        const y0 = k.y + k.facing.y * k.r * 0.6;
        const d = norm(t.x - x0, t.y - y0);
        g.projectiles.push({
          friendly: true, kind: 'slab', x: x0, y: y0, x0, y0, vx: d.x * sp, vy: d.y * sp, speed: sp,
          r: size * 0.3, size: Math.min(size * 0.7, k.r * 2.2), arc: k.r * 3, h0: k.r * 2.4, dmg: this.base() * s.dmg * 6, life: 3, target: t, age: 0,
          color: echo ? GHOST : colors[b.style] || 0x9a948a,
          onHit: (p) => {
            const r = Math.max(k.r * 1.6, size * 0.9) * S;
            g.areaDamage(p.x, p.y, r, p.dmg, 'hit');
            g.spawnExplosion(p.x, p.y, r * 0.8);
            g.fxEvent({ t: 'dust', x: p.x, y: p.y, r: r * 1.2 });
            g.shake = Math.max(g.shake, 0.5);
            if (s.quake) {
              g.areaDamage(p.x, p.y, r * 1.8, p.dmg * 0.5, 'hit');
              g.fx.rings.push({ x: p.x, y: p.y, r0: r * 0.5, r1: r * 1.8, life: 0.5, max: 0.5, color: 0xffc36b, width: r * 0.2 });
              g.fx.cracks.push({ x: p.x, y: p.y, r: r * 1.2, life: 2.5, max: 2.5, seed: Math.random() * 100 });
            }
          },
        });
      });
    }
    return true;
  }

  // ------------------------------------------------------------ Acid Spit
  acidSpit(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('acidSpit');
    const S = this.size() * s.area;
    const targets = this.targets(k.r * 9, s.count);
    if (!targets.length) return false;
    this.anim('breath', 0.3, { charge: 0.08, tint: 'acid' });
    const puddle = (x, y, scale = 1) => g.fires.push({ x, y, r: k.r * 1.1 * S * scale, t: 4 * s.duration, max: 4 * s.duration, tick: 0, acid: true, dmgMul: 1.7 * s.dmg });
    targets.forEach((t, i) => {
      g.schedule(i * 0.1, () => {
        const x = k.x + k.facing.x * k.r;
        const y = k.y + k.facing.y * k.r;
        const sp = g.stage.speed * 2.4 + 30;
        const d = norm(t.x - x, t.y - y);
        g.projectiles.push({
          friendly: true, kind: 'acid', x, y, x0: x, y0: y, vx: d.x * sp, vy: d.y * sp, speed: sp,
          r: k.r * 0.3, size: k.r * 0.35, arc: k.r * 2, h0: k.r * 1.2, dmg: this.base() * s.dmg * 1.2, life: 3, target: t, age: 0, color: echo ? GHOST : 0x8dff4a,
          onHit: (p) => {
            puddle(p.x, p.y);
            if (s.splash) for (let j = 0; j < 3; j++) puddle(p.x + Math.cos(j * 2.1) * k.r * 1.6, p.y + Math.sin(j * 2.1) * k.r * 1.6, 0.6);
            g.fxEvent({ t: 'sparks', x: p.x, y: p.y, h: k.r * 0.2, color: 0x8dff4a });
          },
        });
      });
    });
    return true;
  }

  // ------------------------------------------------------------ Ice Breath
  iceBreath(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('iceBreath');
    const S = this.size() * s.area;
    const reach = k.r * 6 * S;
    const [t] = this.targets(reach);
    if (!t) return false;
    const ang = Math.atan2(t.y - k.y, t.x - k.x);
    k.facing = { x: Math.cos(ang), y: Math.sin(ang) };
    const charge = 0.15;
    const dur = 0.7;
    const arc = 1.0;
    const color = echo ? GHOST : 0xcff6ff;
    const freezeFor = 2 * s.duration;
    this.anim('breath', charge + dur, { charge, tint: 'ice' });
    const freeze = (u) => {
      if (u.dead || u.type === 'jet' || u.frozen > 0) return;
      g.damageUnit(u, this.base() * 0.6 * s.dmg);
      if (!u.dead) u.frozen = freezeFor;
    };
    let tick = 0;
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        if (this.t < charge) return;
        tick -= dt;
        if (tick <= 0) {
          tick = 0.1;
          const x0 = k.x + Math.cos(ang) * k.r;
          const y0 = k.y + Math.sin(ang) * k.r;
          for (let i = -2; i <= 2; i++) {
            const a = ang + (i / 2) * (arc / 2) + (Math.random() - 0.5) * 0.1;
            g.fx.beams.push({ x1: x0, y1: y0, x2: x0 + Math.cos(a) * reach, y2: y0 + Math.sin(a) * reach, width: k.r * 0.45, life: 0.14, max: 0.14, color, h: k.r * 1.2, h2: k.r * 0.2, noFlash: true });
          }
          for (const u of g.units) {
            const d = Math.hypot(u.x - k.x, u.y - k.y);
            if (d < reach + u.r && Math.abs(angleDiff(Math.atan2(u.y - k.y, u.x - k.x), ang)) < arc / 2 + 0.1) freeze(u);
          }
          for (const p of g.people) if (!p.taken && Math.hypot(p.x - k.x, p.y - k.y) < reach && Math.abs(angleDiff(Math.atan2(p.y - k.y, p.x - k.x), ang)) < arc / 2) g.flingPerson(p, false, k);
        }
        if (this.t >= charge + dur) {
          this.done = true;
          if (s.nova) {
            const R = k.r * 4 * S;
            for (const u of g.units) if (Math.hypot(u.x - k.x, u.y - k.y) < R + u.r) freeze(u);
            g.fx.rings.push({ x: k.x, y: k.y, r0: k.r, r1: R, life: 0.5, max: 0.5, color, width: k.r * 0.4 });
          }
        }
      },
    });
    return true;
  }

  // ------------------------------------------------------------ Vortex Belch
  vortexBelch(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('vortexBelch');
    const S = this.size() * s.area;
    const targets = this.targets(k.r * 10 * S, s.count);
    if (!targets.length) return false;
    this.anim('belch', 0.6);
    const dur = 3 * s.duration;
    for (const t of targets) {
      const v = { x: t.x, y: t.y, r: k.r * 3.5 * S };
      g.fx.swirls.push({ x: v.x, y: v.y, r: v.r, life: dur, max: dur, color: echo ? GHOST : 0xb8f0c8 });
      let tick = 0;
      this.active.push({
        t: 0,
        update(dt) {
          this.t += dt;
          const pull = (o, f, pad = 0, minTier = 0) => {
            const d = Math.hypot(o.x - v.x, o.y - v.y);
            if (d < v.r * 1.4 && d > 0.5) {
              const nx = o.x + ((v.x - o.x) / d) * v.r * f * dt;
              const ny = o.y + ((v.y - o.y) / d) * v.r * f * dt;
              // Units are dragged across the ground, never into a building.
              if (pad && g.blockedAt(nx, ny, pad, minTier)) return;
              o.x = nx;
              o.y = ny;
            }
          };
          for (const u of g.units) if (!u.dead && !u.road && u.type !== 'jet' && !(u.tier > k.stage)) pull(u, 0.9, u.flying ? 0 : u.r * 0.6, u.def.mob ? u.tier : 0);
          for (const p of g.people) if (!p.taken) pull(p, 1.2);
          for (const c of g.traffic) if (!c.dead && Math.hypot(c.x - v.x, c.y - v.y) < v.r * 0.8) g.killCar(c);
          tick -= dt;
          if (tick <= 0) {
            tick = 0.35;
            g.areaDamage(v.x, v.y, v.r * 0.7, g.baseDamage() * 1.1 * s.dmg, 'hit');
            g.fxEvent({ t: 'dust', x: v.x, y: v.y, r: v.r * 0.5 });
          }
          if (this.t >= dur) {
            this.done = true;
            if (s.implode) {
              g.areaDamage(v.x, v.y, v.r * 1.2, g.baseDamage() * 5 * s.dmg, 'hit');
              g.spawnExplosion(v.x, v.y, v.r);
              g.shake = Math.max(g.shake, 0.5);
            }
          }
        },
      });
    }
    return true;
  }

  // ------------------------------------------------------------ Orbiting Spines (always on)
  orbit(dt) {
    const g = this.g;
    const k = this.k;
    if (g.state !== 'playing') return;
    const s = this.st('orbitingSpines');
    const S = this.size() * s.area;
    const n = s.count;
    const R = k.r * 1.9 * S;
    this.orbA = (this.orbA || 0) + dt * 2.6 * s.speed;
    this.orbHit = this.orbHit || new Map();
    for (const [t, c] of this.orbHit) {
      if (c - dt <= 0) this.orbHit.delete(t);
      else this.orbHit.set(t, c - dt);
    }
    const hr = k.r * 0.5 * S;
    const D = this.base() * 1.1 * s.dmg;
    for (let i = 0; i < n; i++) {
      const a = this.orbA + (i / n) * Math.PI * 2;
      const x = k.x + Math.cos(a) * R;
      const y = k.y + Math.sin(a) * R;
      const tx = -Math.sin(a) * k.r * 0.55;
      const ty = Math.cos(a) * k.r * 0.55;
      g.fx.beams.push({ x1: x - tx, y1: y - ty, x2: x + tx, y2: y + ty, width: k.r * 0.2, life: 0.05, max: 0.05, color: 0x8affd2, h: k.r * 0.9, noFlash: true, core: true });
      const once = (t, fn) => {
        if (this.orbHit.has(t)) return;
        this.orbHit.set(t, 0.5);
        fn();
      };
      for (const u of g.units) if (!u.dead && !u.flying && Math.hypot(u.x - x, u.y - y) < hr + u.r) once(u, () => g.damageUnit(u, D));
      for (const c of g.traffic) if (!c.dead && Math.hypot(c.x - x, c.y - y) < hr + 3) once(c, () => g.damageCar(c, D));
      for (const p of g.people) if (!p.taken && Math.hypot(p.x - x, p.y - y) < hr) g.flingPerson(p, false, k);
      for (const o of g.objectsNear(x, y, hr)) if (!o.walkable && canDamage(o.tier, k.stage, o.landmark)) once(o, () => g.damageObject(o, D, norm(o.x - k.x, o.y - k.y), 'hit', { x, y }));
    }
  }

  // ------------------------------------------------------------ Magnetic Roar
  magneticRoar(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('magneticRoar');
    const S = this.size() * s.area;
    const radius = k.r * 8 * S;
    const heap = { x: k.x + k.facing.x * k.r * 2.2, y: k.y + k.facing.y * k.r * 2.2 };
    const cars = g.traffic.filter((c) => !c.dead && Math.hypot(c.x - k.x, c.y - k.y) < radius);
    const parked = g.objectsNear(k.x, k.y, radius).filter((o) => o.vehicle && o.state === 'intact' && canDamage(o.tier, k.stage, false));
    const vehicles = g.units.filter((u) => !u.dead && u.def.vehicle && !u.flying && Math.hypot(u.x - k.x, u.y - k.y) < radius);
    if (!cars.length && !parked.length && !vehicles.length) return false;
    this.anim('roar', 0.7, { tint: [0.3, 0.1, 0.45] });
    const color = echo ? GHOST : 0xc58bff;
    for (let i = 0; i < 3; i++) g.fx.rings.push({ x: k.x, y: k.y, r0: radius * (1 - i * 0.15), r1: k.r * 1.5, life: 0.5 + i * 0.12, max: 0.5 + i * 0.12, color, width: k.r * 0.3 });
    let shown = 0;
    const fling = (x, y, model, variant) => {
      if (shown++ > 8) return;
      const sp = g.stage.speed * 3 + 40;
      const d = norm(heap.x - x, heap.y - y);
      g.projectiles.push({
        friendly: true, kind: 'car', model, variant, x, y, x0: x, y0: y, vx: d.x * sp, vy: d.y * sp, speed: sp,
        r: k.r * 0.4, scale: Math.max(1, k.r / 10), arc: k.r * 1.5, h0: k.r * 0.5, dmg: 0, life: 2, target: { x: heap.x, y: heap.y }, age: 0, spin: 6, color,
        onHit: (p) => g.fxEvent({ t: 'dust', x: p.x, y: p.y, r: k.r * 0.6 }),
      });
    };
    for (const c of cars) {
      fling(c.x, c.y, c.model, c.variant);
      g.killCar(c);
    }
    for (const o of parked) {
      fling(o.x, o.y, o.type, o.variant);
      g.destroyObject(o, norm(heap.x - o.x, heap.y - o.y), 'hit');
    }
    for (const u of vehicles) g.damageUnit(u, this.base() * (s.heavy || u.tier < k.stage ? 3 : 1.2) * s.dmg);
    g.schedule(0.6, () => {
      g.areaDamage(heap.x, heap.y, k.r * 1.6 * S, this.base() * 2 * s.dmg, 'hit');
      g.fxEvent({ t: 'dust', x: heap.x, y: heap.y, r: k.r * 1.5 });
      if (s.blast) {
        g.areaDamage(heap.x, heap.y, k.r * 2.8 * S, this.base() * 4 * s.dmg, 'hit');
        g.spawnExplosion(heap.x, heap.y, k.r * 2.4 * S);
        g.shake = Math.max(g.shake, 0.5);
      }
    });
    return true;
  }

  // ------------------------------------------------------------ Frenzy Bite
  frenzyBite(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('frenzyBite');
    const reach = k.r * 3.2 * this.size() * s.area;
    const cands = this.targets(reach, 8);
    if (!cands.length) return false;
    const tough = (t) => (t.isBoss ? 1e12 : t.maxHp || t.hp || 1);
    let target = cands.sort((a, b) => tough(b) - tough(a))[0];
    const n = s.count;
    for (let i = 0; i < n; i++) {
      g.schedule(i * 0.13, () => {
        if (!target || target.dead || (target.state && target.state !== 'intact')) target = this.targets(reach, 1)[0];
        if (!target) return;
        const crit = s.crit && i === n - 1;
        const dmg = this.base() * 1.5 * s.dmg * (crit ? 3 : 1);
        const dir = norm(target.x - k.x, target.y - k.y);
        this.anim('eat', 0.13);
        k.facing = dir;
        g.fx.slashes.push({ x: target.x - dir.x * k.r * 0.4, y: target.y - dir.y * k.r * 0.4, ang: Math.atan2(dir.y, dir.x), arc: 1.4, r: k.r * 0.9, side: i % 2 ? 1 : -1, life: 0.2, max: 0.2, color: echo ? GHOST : crit ? 0xff4d4d : 0xffffff, h: k.r * 0.6 });
        g.damageTarget(target, dmg, dir, 'bite');
        g.shake = Math.max(g.shake, crit ? 0.3 : 0.1);
        if (crit) g.fx.floaters.push({ x: target.x, y: target.y, h: k.r * 1.6, text: 'CRIT!', color: '#ff6a6a', life: 0.8, max: 0.8 });
      });
    }
    return true;
  }

  // ------------------------------------------------------------ Brood Call
  broodCall(echo) {
    const g = this.g;
    const k = this.k;
    const s = this.st('broodCall');
    if (!this.targets(k.r * 12).length) return false;
    this.anim('howl', 0.7);
    for (let i = 0; i < s.count && g.allies.length < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      g.allies.push({
        x: k.x + Math.cos(a) * k.r, y: k.y + Math.sin(a) * k.r, r: Math.max(0.8, k.r * 0.3), life: 8 * s.duration, cd: 0.3, target: null, retarget: 0,
        dmg: this.base() * 0.7 * s.dmg, speed: g.stage.speed * 1.25, heading: a, boom: Boolean(s.boom), echo, phase: Math.random() * 6,
      });
      g.fxEvent({ t: 'dust', x: k.x + Math.cos(a) * k.r, y: k.y + Math.sin(a) * k.r, r: k.r * 0.4 });
    }
    return true;
  }
}
