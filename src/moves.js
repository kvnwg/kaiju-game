// Attack moves granted by augments. Each move's level (1-8) sets its stats and unlocks its
// signature upgrades (see moveStats in augments.js). Each move fires on its own cooldown
// when something is in reach; the visuals are described through game.fx
// (slashes, beams, rings, swirls, cracks) and the kaiju's animation state (kaiju.anim).
import { canDamage } from './config.js';
import { MOVES, moveStats } from './augments.js';
import { norm, distToRect, closestPoint, angleDiff } from './geom.js';

const GHOST = 0xc58bff; // tint for Echo repeats

export class MoveSystem {
  constructor(game) {
    this.g = game;
    this.timers = {};
    this.active = [];
  }

  get k() {
    return this.g.kaiju;
  }

  // Global area from the Kaiju-Sized passive.
  size() {
    return 1 + 0.1 * this.g.level('area');
  }

  st(id) {
    return moveStats(id, this.g.level(id));
  }

  cooldown(id) {
    const m = MOVES.find((mv) => mv.id === id);
    return m.cd * Math.max(0.3, this.st(id).cd) * (1 - 0.08 * this.g.level('adrenaline'));
  }

  // 0..1 charge for the HUD.
  readiness(id) {
    const t = this.timers[id];
    if (t === undefined) return 1;
    return Math.max(0, Math.min(1, 1 - t / this.cooldown(id)));
  }

  update(dt) {
    const g = this.g;
    for (const m of MOVES) {
      if (!g.has(m.id)) continue;
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
    const cyclone = Boolean(s.cyclone);
    const D = s.dmg;
    const dur = cyclone ? 2 * s.duration : 0.42 * spins;
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
              u.x += ((k.x - u.x) / d) * pull * 0.6 * dt;
              u.y += ((k.y - u.y) / d) * pull * 0.6 * dt;
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
    const n = s.count;
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
    const count = s.count;
    const targets = this.targets(k.r * 11 * S, count);
    if (!targets.length) return false;
    this.anim('throw', 0.35);
    for (let i = 0; i < count; i++) {
      // Use a real car off the street when one is close, otherwise one appears from the rubble.
      let model = g.rng.pick(['car', 'hatchback', 'taxi', 'van', 'pickup', 'bus']);
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
    const S = this.size() * s.area;
    const radius = k.r * 8 * S;
    if (!this.targets(radius).length) return false;
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
    const len = k.r * 9 * S * s.length;
    const D = s.dmg;
    const [t] = this.targets(len * 0.9);
    if (!t) return false;
    const center = Math.atan2(t.y - k.y, t.x - k.x);
    const sweep = 0.95;
    const dur = over ? 1.6 : 0.9;
    const width = k.r * 0.3 * S * s.width;
    const fan = s.split ? [-0.22, 0, 0.22] : [0];
    const color = echo ? GHOST : 0xff3b6b;
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
    const up = 0.42;
    this.anim('slam', up + 0.25);
    const color = echo ? GHOST : 0xffc36b;
    const land = () => {
      g.areaDamage(k.x, k.y, radius, this.base() * s.dmg * 4.5, 'hit');
      g.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 0.6, r1: radius, life: 0.5, max: 0.5, color, width: k.r * 0.45 });
      g.fx.rings.push({ x: k.x, y: k.y, r0: k.r * 0.3, r1: radius * 0.6, life: 0.35, max: 0.35, color: 0xffffff, width: k.r * 0.3 });
      g.fxEvent({ t: 'dust', x: k.x, y: k.y, r: radius });
      g.fx.cracks.push({ x: k.x, y: k.y, r: radius * 0.8, life: 2.5, max: 2.5, seed: Math.random() * 100 });
      g.shake = Math.max(g.shake, 0.7);
      g.emit('slam');
      for (let i = 0; i < s.aftershock; i++) {
        g.schedule(0.55 * (i + 1), () => {
          g.areaDamage(k.x, k.y, radius * 1.45, this.base() * s.dmg * 3, 'hit');
          g.fx.rings.push({ x: k.x, y: k.y, r0: radius * 0.5, r1: radius * 1.45, life: 0.6, max: 0.6, color, width: k.r * 0.5 });
          g.fxEvent({ t: 'dust', x: k.x, y: k.y, r: radius * 1.2 });
          g.shake = Math.max(g.shake, 0.5);
        });
      }
      if (s.faults) {
        const base = Math.atan2(k.facing.y, k.facing.x) + Math.PI / 4;
        for (let i = 0; i < 4; i++) this.faultLine(k.x, k.y, base + (i * Math.PI) / 2, radius * 2.4, echo);
      }
    };
    this.active.push({
      t: 0,
      update(dt) {
        this.t += dt;
        if (this.t < up) k.z = Math.sin((this.t / up) * Math.PI * 0.5) * k.r * 1.6;
        else if (!this.landed) {
          this.landed = true;
          k.z = 0;
          land();
        }
        if (this.t >= up + 0.05) this.done = true;
      },
    });
    return true;
  }

  faultLine(x, y, ang, len, echo) {
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
        g.lineDamage(px, py, nx, ny, k.r * 0.9, g.baseDamage() * 3);
        g.fx.beams.push({ x1: px, y1: py, x2: nx, y2: ny, width: k.r * 0.5, life: 1.6, max: 1.6, color: echo ? GHOST : 0xff7a1a, h: 0.4, noFlash: true });
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
    const D = s.dmg;
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
        if (this.t >= charge + dur) this.done = true;
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
    this.anim('roar', 0.8);
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
}

