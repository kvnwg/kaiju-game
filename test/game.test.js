import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, distToRect } from '../src/game.js';
import { STAGES, MAX_STAGE, xpToNext, GATE_BOSSES, AD_PRESSURE, TRAITS, DASH, BOSS_FIGHT } from '../src/config.js';
import { AUGMENT_BY_ID, MOVES } from '../src/augments.js';
import { simulate, botStep } from './bot.js';
import { waterField } from '../src/world.js';
import { DOCTOR } from '../src/models.js';

// Generate a wide area around the spawn point (normally the world streams in as you move).
function wide(g, radius = 2600) {
  g.city.update(g.kaiju.x, g.kaiju.y, radius, Infinity);
  return g;
}

test('a human-sized kaiju starts among people and grows by eating them', () => {
  const g = new Game({ seed: 5 });
  assert.equal(g.kaiju.stage, 1);
  assert.ok(g.people.length > 20, 'crowd around the drop-in point');
  const before = g.kaiju.biomass;
  g.flingPerson(g.people[0], false);
  assert.ok(g.kaiju.biomass > before);
  assert.equal(g.stats.people, 1);
});

test('levelling up opens an augment pick; growing in size does not', () => {
  const g = new Game({ seed: 5 });
  g.debugLevel();
  g.update(1 / 60);
  assert.equal(g.kaiju.level, 2);
  assert.equal(g.state, 'picking');
  assert.equal(g.pick.options.length, 3);
  assert.ok(g.choose(g.pick.options[0]));
  assert.equal(g.state, 'playing');
  // A big chunk of biomass grows the kaiju (once this size's boss is down) and queues picks.
  g.gateCleared[1] = true;
  g.addBiomass(STAGES[1].biomassToNext);
  g.update(1 / 60);
  assert.equal(g.kaiju.stage, 2);
  assert.ok(g.pendingPicks >= 1 && g.state === 'picking');
  const queued = g.pendingPicks;
  g.choose(g.pick.options[0]);
  g.update(1 / 60);
  assert.equal(g.pendingPicks, queued - 1);
});

test('levels come quickly: many picks in the first five minutes, size grows slower', () => {
  const g = new Game({ seed: 1 });
  let ups = 0;
  let last = 1;
  simulate(g, { maxTime: 300, onTick: () => { if (g.kaiju.level !== last) { last = g.kaiju.level; ups++; } } });
  assert.ok(ups >= 8, `${ups} level-ups in 5 minutes`);
  assert.ok(g.kaiju.stage <= 4, 'size grows slower than levels');
});

test('each level costs more than the last: picks thin out late in a run, a big blast never chains them', () => {
  for (let l = 2; l < 40; l++) assert.ok(xpToNext(l) > xpToNext(l - 1) * 1.1);
  const g = new Game({ seed: 2 });
  const ups = [];
  simulate(g, { maxTime: 900, onTick: () => { if (g.kaiju.level > ups.length + 1) ups.push(g.time); } });
  const early = ups.filter((t) => t < 180).length;
  const late = ups.filter((t) => t >= g.time - 180).length;
  assert.ok(early >= 8, `${early} picks in the first three minutes`);
  assert.ok(late <= early / 2, `${late} picks in the last three minutes vs ${early} early`);
  const h = new Game({ seed: 3 });
  h.addBiomass(1e9);
  assert.equal(h.kaiju.level, 2);
  assert.equal(h.pendingPicks, 1);
});

test('first run guarantees Laser Eyes on the first pick, and the first offer leans on moves', () => {
  const g = new Game({ seed: 8, firstRun: true });
  g.debugLevel();
  g.update(1 / 60);
  assert.ok(g.pick.options.includes('laserEyes'));
  assert.ok(g.pick.options.filter((id) => AUGMENT_BY_ID[id].kind === 'move').length >= 2);
});

test('every move fires, hits things and shows its effect', () => {
  for (const m of MOVES) {
    const g = new Game({ seed: 5 });
    g.kaiju.invuln = 999;
    g.held.set(m.id, m.levels.length + 1); // max level: every signature upgrade on
    // Stand in the suburbs at house size so there is plenty in reach.
    g.kaiju.stage = 3;
    g.kaiju.r = 14;
    const hp0 = g.objects.filter((o) => o.state === 'intact').length;
    for (let i = 0; i < 30 * 12; i++) {
      g.update(1 / 30);
      g.drainEvents();
      g.drainVfx();
    }
    // Orbiting Spines are always on rather than firing on a cooldown.
    assert.ok(g.stats.moves > 0 || m.id === 'orbitingSpines', `${m.id} fired`);
    assert.ok(g.objects.filter((o) => o.state === 'intact').length < hp0 || g.stats.people > 0, `${m.id} did damage`);
  }
});

test('levels change their move: Claw Lv3 slashes twice, Spines gain missiles', () => {
  const count = (id, level) => {
    const g = new Game({ seed: 5 });
    g.kaiju.stage = 3;
    g.kaiju.r = 14;
    g.kaiju.level = 200; // no level-up picks interrupting the count
    g.held.set(id, level);
    let slashes = 0;
    let spines = 0;
    for (let i = 0; i < 30 * 3; i++) {
      g.update(1 / 30);
      slashes += g.fx.slashes.filter((s) => !s._c && (s._c = true)).length;
      spines += g.projectiles.filter((p) => p.kind === 'spine' && !p._c && (p._c = true)).length;
    }
    return { slashes, spines, moves: g.stats.moves };
  };
  const one = count('clawStrike', 1);
  const two = count('clawStrike', 3);
  assert.equal(two.slashes / two.moves, 2 * (one.slashes / one.moves));
  const s1 = count('spineMissiles', 1);
  const s2 = count('spineMissiles', 2);
  assert.equal(s1.spines / s1.moves, 4);
  assert.equal(s2.spines / s2.moves, 6);
});

test('three rerolls per run, then one ad reroll', () => {
  const g = new Game({ seed: 2 });
  g.debugLevel();
  g.update(1 / 60);
  assert.ok(g.reroll(false));
  assert.ok(g.reroll(false));
  assert.ok(g.reroll(false));
  assert.equal(g.reroll(false), false);
  assert.ok(g.reroll(true));
  assert.equal(g.reroll(true), false);
});

test('stat passives change the kaiju: Might, Toughness, Long Legs', () => {
  const g = new Game({ seed: 2 });
  const dmg = g.baseDamage();
  const hp = g.kaiju.maxHp;
  const sp = g.kaijuSpeed();
  for (const id of ['might', 'toughness', 'longLegs']) {
    g.state = 'picking';
    g.pick = { options: [id], level: 2 };
    assert.ok(g.choose(id));
  }
  assert.ok(Math.abs(g.baseDamage() - dmg * 1.1) < 1e-9);
  assert.ok(Math.abs(g.kaiju.maxHp - hp * 1.15) < 1e-9);
  assert.ok(Math.abs(g.kaijuSpeed() - sp * 1.08) < 1e-9);
});

test('death offers one ad revive, more only if paid for; giving up ends the run keeping 50% scrap', () => {
  const g = new Game({ seed: 3 });
  g.stats.scrap = 101;
  g.takeDamage(10000);
  assert.equal(g.state, 'dead');
  assert.ok(g.revive());
  assert.equal(g.kaiju.hp, g.kaiju.maxHp * 0.5);
  g.kaiju.invuln = 0;
  g.takeDamage(10000);
  assert.equal(g.state, 'dead');
  assert.equal(g.revive(), false, 'the free ad revive is used up');
  assert.ok(g.revive(true), 'a paid (gem) revive works');
  g.kaiju.invuln = 0;
  g.takeDamage(10000);
  g.giveUp();
  assert.equal(g.state, 'lost');
  assert.equal(g.results.scrap, 51);
  // Nine Lives gives a free revive on top of the ad one.
  const h = new Game({ seed: 3, meta: { revives: 1 } });
  h.takeDamage(10000);
  assert.ok(h.revive());
  h.kaiju.invuln = 0;
  h.takeDamage(10000);
  assert.ok(h.revive());
});

test('Thick Hide reduces bullet and shell damage only', () => {
  const g = new Game({ seed: 4 });
  g.held.set('thickHide', 2);
  g.takeDamage(10, 'bullet');
  assert.ok(Math.abs(g.kaiju.maxHp - g.kaiju.hp - 8.4) < 1e-9);
  g.kaiju.hp = g.kaiju.maxHp;
  g.takeDamage(10, 'explosive');
  assert.equal(g.kaiju.maxHp - g.kaiju.hp, 10);
});

test('hits on buildings report an impact point for the voxel chipping', () => {
  const g = wide(new Game({ seed: 4 }));
  g.kaiju.stage = 4;
  const b = g.objects.find((o) => o.kind === 'building' && o.tier === 4);
  g.damageObject(b, 50, { x: 1, y: 0 }, 'hit', { x: b.x - b.w / 2, y: b.y });
  const hit = g.drainVfx().find((e) => e.t === 'hit');
  assert.ok(hit && hit.obj === b && hit.x === b.x - b.w / 2 && hit.frac > 0);
});

test('chain collapses drop biomass only with the Demolition Crew set', () => {
  const g = wide(new Game({ seed: 7 }));
  g.kaiju.stage = 4;
  const [a, b] = g.objects.filter((o) => o.kind === 'building' && o.tier === 4);
  const bio0 = g.stats.biomass;
  g.destroyObject(a, { x: 1, y: 0 }, 'chain');
  assert.equal(g.stats.biomass, bio0);
  for (const id of ['gasMain', 'seismicSlam', 'meteorCall']) g.held.set(id, 1);
  g.destroyObject(b, { x: 1, y: 0 }, 'chain');
  assert.ok(g.stats.biomass > bio0);
});

test('military vehicles and soldiers never drive or walk through intact buildings', () => {
  const g = new Game({ seed: 3 });
  const inside = (u) => g.grid.query(u.x - u.r, u.y - u.r, u.x + u.r, u.y + u.r)
    .some((o) => o.kind === 'building' && o.state === 'intact' && !o.walkable && !(u.def.mob && o.tier < u.tier) && distToRect(u.x, u.y, o) < u.r * 0.5);
  let samples = 0;
  for (let i = 0; i < 30 * 300; i++) {
    botStep(g);
    g.update(1 / 30);
    g.drainEvents();
    g.drainVfx();
    if (i % 15) continue;
    for (const u of g.units) {
      if (u.flying || u.dead) continue;
      samples++;
      assert.ok(!inside(u), `${u.type} inside a building at ${Math.round(u.x)},${Math.round(u.y)}`);
      if (u.def.vehicle) assert.ok(u.road, `${u.type} is on the road network`);
    }
  }
  assert.ok(samples > 500);
});

test('autopiloted first runs grow through all six stages, fight the boss and at least half win', () => {
  // (These check the city's balance, so beating the final boss ends the run here.) A run replays
  // the same way for the same seed, but any change to the simulation reshuffles which seeds win;
  // across 16 seeds about three in four first runs do.
  const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simulate(new Game({ seed, kaijuId: 'rex', firstRun: true, ascend: false }), { maxTime: 2400 }));
  checkRuns(runs, 4);
});

test('later runs push back: the military can win, but a decent run still beats the boss', () => {
  // As above, this only asks that some of them win; across 16 seeds a little under half do.
  const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simulate(new Game({ seed, kaijuId: 'rex', ascend: false }), { maxTime: 2400 }));
  checkRuns(runs, 2);
  assert.ok(runs.some((g) => g.state === 'lost' || g.reviveAvailable === false), 'somebody got knocked down');
});

function checkRuns(runs, minWins) {
  for (const g of runs) {
    assert.ok(g.state === 'won' || g.state === 'lost', `run ended (state ${g.state})`);
    assert.ok(g.results.buildings > 30);
    assert.ok(g.stats.people > 10, 'ate people early on');
  }
  const wins = runs.filter((g) => g.state === 'won');
  assert.ok(wins.length >= minWins, `won ${wins.length}/${runs.length}`);
  for (const g of wins) {
    assert.equal(g.kaiju.stage, MAX_STAGE);
    assert.ok(g.stats.bossDefeated);
  }
  // Pacing guard: the final boss typically arrives within 25 minutes, give or take the luck of
  // the seeds. (The size 4 and 5 bosses carry 30x health, so with no gear those two fights alone
  // run several minutes.)
  const times = wins.map((g) => g.stats.stageTimes[MAX_STAGE]).sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length / 2)] < 28 * 60, `median boss arrival ${times}`);
}

test('chained kills build a combo that pays a scrap bonus when it lapses', () => {
  const g = wide(new Game({ seed: 5 }));
  g.kaiju.stage = 3;
  const k = g.kaiju;
  k.level = 200; // keep level-up picks from pausing the clock
  const props = g.objects.filter((o) => o.kind === 'prop' && o.tier === 3 && o.state === 'intact').slice(0, 12);
  for (const o of props) g.destroyObject(o, { x: 1, y: 0 }, 'hit');
  assert.equal(g.combo.n, props.length);
  const events = g.drainEvents();
  assert.ok(events.some((e) => e.type === 'comboTier' && e.tier === 1), 'x10 milestone');
  const scrap = g.stats.scrap;
  // Park out on the water so nothing keeps the combo alive.
  let spot = null;
  for (let r = 1500; !spot && r < 20000; r += 100) for (let a = 0; a < 6.28 && !spot; a += 0.05) if (waterField(k.x + Math.cos(a) * r, k.y + Math.sin(a) * r) > 160) spot = { x: k.x + Math.cos(a) * r, y: k.y + Math.sin(a) * r };
  k.x = spot.x;
  k.y = spot.y;
  g.people = [];
  g.traffic = [];
  g.units = [];
  g.director.spawnT = 99;
  k.invuln = 99;
  for (let i = 0; i < 30 * 3; i++) g.update(1 / 30);
  assert.equal(g.combo.n, 0);
  assert.ok(g.stats.scrap > scrap, 'combo bonus paid');
  assert.ok(k.hp > 0);
});

test('smashing something your size freezes time for a moment (hitstop)', () => {
  const g = new Game({ seed: 5 });
  g.kaiju.stage = 3;
  const house = g.objects.find((o) => o.kind === 'building' && o.tier === 3 && o.state === 'intact');
  g.destroyObject(house, { x: 1, y: 0 }, 'hit');
  assert.ok(g.hitstop > 0 && g.punch > 0);
  const t0 = g.time;
  g.update(1 / 60);
  assert.ok(g.time - t0 < 0.005, 'simulation barely moves during hitstop');
});

test('a cop goes down in one bite, whatever its level scaling', () => {
  const g = new Game({ seed: 5 });
  const k = g.kaiju;
  k.level = 30;
  const cop = g.spawnUnit('cop', k.x + 3, k.y);
  assert.ok(cop.hp > g.baseDamage() * 2, 'tough enough that a normal hit would not do');
  g.performAttack(cop);
  assert.ok(cop.dead);
  assert.equal(k.anim.kind, 'eat');
});

test('a small kaiju eats people whole: snatch, chomp, swallow', () => {
  const g = new Game({ seed: 5 });
  const k = g.kaiju;
  const p = g.people.find((q) => !q.taken);
  k.x = p.x - 2;
  k.y = p.y;
  k.attackCd = 0;
  const eaten0 = g.stats.people;
  g.performAttack(p);
  assert.equal(p.state, 'eaten');
  assert.equal(g.stats.people, eaten0 + 1);
  assert.equal(k.anim.kind, 'eat');
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    g.update(1 / 30);
    for (const e of g.drainVfx()) seen.add(e.t);
  }
  assert.ok(seen.has('chomp') && seen.has('swallow'));
  assert.ok(!g.people.includes(p), 'swallowed');
});

const settle = (g) => {
  while (g.state === 'picking' || g.state === 'altar') {
    if (g.state === 'altar') g.altarChoose('angel');
    else g.choose(g.pick.options[0]);
  }
};

test('a full growth bar sends a boss for your size; growing waits until it is beaten', () => {
  const g = new Game({ seed: 7 });
  g.addBiomass(STAGES[1].biomassToNext * 1.5);
  settle(g);
  g.update(1 / 30);
  assert.equal(g.kaiju.stage, 1, 'no size-up before the boss');
  assert.equal(g.kaiju.biomass, STAGES[1].biomassToNext, 'growth bar holds at full');
  for (let i = 0; i < 120 && !g.boss; i++) {
    g.update(1 / 30);
    settle(g);
  }
  const b = g.boss;
  assert.ok(b && b.gate === 1 && b.name === GATE_BOSSES[1].name, 'Agent Kilowatt arrives');
  b.state = 'idle';
  g.damageBoss(b.hp + 1);
  assert.ok(b.dead && g.gateCleared[1]);
  for (let i = 0; i < 90 && g.kaiju.stage === 1; i++) {
    g.update(1 / 30);
    settle(g);
  }
  assert.equal(g.kaiju.stage, 2, 'beating it grows the kaiju');
  assert.equal(g.boss, null);
});

test('every size has its own boss with working attack patterns', () => {
  for (let n = 1; n < GATE_BOSSES.length; n++) {
    if (!GATE_BOSSES[n]) continue; // the city's top size faces the final boss instead
    const g = new Game({ seed: 20 + n });
    if (n > 1) g.debugJump(n);
    g.spawnGateBoss();
    const b = g.boss;
    assert.equal(b.gate, n);
    b.state = 'idle';
    for (const p of new Set(GATE_BOSSES[n].patterns)) {
      b.state = 'idle';
      g.bossAttack(p);
      for (let i = 0; i < 150; i++) {
        g.update(1 / 30);
        while (g.state === 'picking') g.choose(g.pick.options[0]);
        if (g.state !== 'playing') break;
      }
      assert.ok(!Number.isNaN(b.x) && !Number.isNaN(b.y), `${b.name} ${p}`);
    }
  }
});

test('no augment heals; hospitals and the rare doctor do', () => {
  for (const id of ['regen', 'buildingEater', 'snackAttack', 'feast']) assert.equal(AUGMENT_BY_ID[id], undefined, id);
  const g = new Game({ seed: 9 });
  for (let s = 1; s < 4; s++) g.grow();
  g.city.update(g.kaiju.x, g.kaiju.y, 3000, 9999, true);
  const h = g.city.objects.find((o) => o.type === 'hospital' && o.state === 'intact');
  assert.ok(h, 'hospitals exist in the world');
  const k = g.kaiju;
  k.hp = k.maxHp * 0.3;
  g.destroyObject(h, { x: 1, y: 0 }, 'hit');
  assert.ok(Math.abs(k.hp / k.maxHp - 0.55) < 1e-6, 'a hospital your size heals 25%');

  const d = new Game({ seed: 9 });
  const p = d.people.find((q) => !q.taken);
  p.variant = DOCTOR;
  d.kaiju.hp = d.kaiju.maxHp * 0.5;
  d.eatPerson(p);
  assert.ok(d.kaiju.hp / d.kaiju.maxHp > 0.6, 'eating a doctor heals');
});

test('Seismic Slam crouches, leaps and lands; an Echo mid-leap waits for the landing', () => {
  const g = new Game({ seed: 5 });
  const k = g.kaiju;
  // House size in the suburbs, as in the move test above: plenty in reach.
  k.stage = 3;
  k.r = 14;
  k.invuln = 999;
  g.held.set('seismicSlam', 1);
  g.moves.timers.seismicSlam = 99; // cast by hand only
  assert.ok(g.moves.cast('seismicSlam', false), 'something in reach');
  let peak = 0;
  let slams = 0;
  for (let i = 0; i < 45; i++) {
    if (i === 12) {
      // Mid-leap: the echo is queued for after the landing, not started on top of this leap.
      const anim = k.anim;
      const lands = g.moves.slamUntil;
      assert.ok(k.z > 0, 'in the air');
      assert.ok(g.moves.cast('seismicSlam', true));
      assert.equal(k.anim, anim);
      assert.equal(g.moves.slamUntil, lands);
    }
    g.update(1 / 60);
    settle(g);
    peak = Math.max(peak, k.z || 0);
    slams += g.drainEvents().filter((e) => e.type === 'slam').length;
    g.drainVfx();
  }
  assert.ok(peak > k.r * 2 && peak < k.r * 3.2, 'a clear leap');
  assert.equal(slams, 1, 'lands with a slam');
  assert.equal(k.z, 0, 'back on the ground');
});

test('Magnetic Hide turns wreckage into a shield, but only so fast', () => {
  const g = wide(new Game({ seed: 5 }));
  for (let s = 1; s < 3; s++) g.grow();
  settle(g);
  const k = g.kaiju;
  g.held.set('magneticHide', 1);
  k.shield = 0;
  g.updateAugments(10); // bank the per-second budget
  const pile = g.city.objects.filter((o) => o.state === 'intact' && o.structure && !o.landmark).slice(0, 30);
  assert.ok(pile.length >= 10, 'buildings to wreck');
  for (const o of pile) g.destroyObject(o, { x: 1, y: 0 }, 'hit');
  assert.ok(k.shield > 0, 'wreckage gives shield');
  assert.ok(k.shield <= k.maxHp * 0.03 + 1e-6, 'a demolition spree only cashes in the banked budget');
});

test('vehicles on the streets never drive through each other', () => {
  // How deep two vehicle boxes overlap (separating axes); each has x, y, heading and box {hl, hw}.
  const depth = (a, b) => {
    let d = Infinity;
    for (const th of [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2]) {
      const ax = Math.cos(th);
      const ay = Math.sin(th);
      const ext = (v) => v.box.hl * Math.abs(Math.cos(v.heading) * ax + Math.sin(v.heading) * ay) + v.box.hw * Math.abs(Math.sin(v.heading) * ax - Math.cos(v.heading) * ay);
      d = Math.min(d, ext(a) + ext(b) - Math.abs((b.x - a.x) * ax + (b.y - a.y) * ay));
    }
    return d;
  };
  for (const stage of [1, 3]) {
    const g = new Game({ seed: 3 });
    for (let s = 1; s < stage; s++) {
      g.gateCleared[s] = true;
      g.grow();
    }
    let frames = 0;
    let crossings = 0;
    for (let i = 0; i < 30 * 40; i++) {
      if (g.state === 'picking') g.choose(g.pick.options[0]);
      g.setInput(Math.cos(i / 200) * 0.3, Math.sin(i / 200) * 0.3);
      g.kaiju.hp = g.kaiju.maxHp;
      g.kaiju.invuln = 1;
      g.update(1 / 30);
      const vs = [...g.traffic.filter((c) => c.placed), ...g.units.filter((u) => !u.dead && u.road && !u.flying)].filter((v) => v.box);
      for (let a = 0; a < vs.length; a++) {
        for (let b = a + 1; b < vs.length; b++) {
          if (Math.hypot(vs[a].x - vs[b].x, vs[a].y - vs[b].y) < 60 && depth(vs[a], vs[b]) > 1) crossings++;
        }
      }
      frames += vs.length > 1 ? 1 : 0;
    }
    assert.ok(frames > 1000, `traffic on the streets at size ${stage}`);
    assert.ok(crossings <= 2, `size ${stage}: vehicles overlapped ${crossings} times`);
  }
});

test('past the city: space, the multiverse, the garden, then round to the start', () => {
  const g = new Game({ seed: 41 });
  g.takeDamage = () => {}; // this checks the journey, not the balance
  g.debugJump(6);
  g.stats.bossDefeated = true;
  g.ascendFromCity();
  assert.equal(g.state, 'warp');
  const seen = [];
  const realms = [];
  let warps = 0;
  for (let i = 0; i < 30 * 60 * 40 && !(g.loop === 2 && g.kaiju.stage === 2); i++) {
    botStep(g);
    g.update(1 / 30);
    for (const e of g.drainEvents()) {
      if (e.type === 'warp') warps++;
      if (e.type === 'warpDone') realms.push(e.realm);
    }
    // Size bosses go down as soon as they arrive.
    if (g.boss && !g.boss.dead && g.boss.state !== 'enter') g.damageBoss(g.boss.hp + 1);
    for (const u of g.units) if (!seen.includes(u.type)) seen.push(u.type);
    const k = g.kaiju;
    assert.ok(Number.isFinite(k.x) && Number.isFinite(k.y), 'the kaiju stays somewhere real');
  }
  assert.deepEqual(realms, ['solar', 'galaxy', 'cosmos', 'garden', 'city']);
  assert.equal(warps, 5);
  assert.equal(g.loop, 2);
  assert.equal(g.realm, 'city');
  assert.ok(g.stats.peak >= 13, `peak ${g.stats.peak}`);
  for (const t of ['interceptor', 'sentinel', 'soldier_ant']) assert.ok(seen.includes(t), `met ${t}: ${seen}`);
  assert.ok(g.stats.people > 20, 'ate ants in the garden');
  g.cashOut();
  assert.equal(g.state, 'won');
  assert.equal(g.results.loop, 2);
});

test('a fence smashes the moment the kaiju walks into it, at any size', () => {
  const g = new Game({ seed: 5, firstRun: true });
  const k = g.kaiju;
  const fence = g.objects.filter((o) => o.type === 'fence' && o.state === 'intact').sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
  assert.ok(fence, 'a fence near home');
  const dir = { x: fence.x - k.x, y: fence.y - k.y };
  const d = Math.hypot(dir.x, dir.y);
  k.x = fence.x - (dir.x / d) * (k.r + 3);
  k.y = fence.y - (dir.y / d) * (k.r + 3);
  for (let i = 0; i < 40 && fence.state === 'intact'; i++) {
    g.setInput(dir.x / d, dir.y / d);
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.notEqual(fence.state, 'intact');
  assert.equal(k.hopT, 0, 'no hop over it');
});

test('a first run starts with a rickety shed close to home and skips the Altar on the first size-up', () => {
  const g = new Game({ seed: 5, firstRun: true });
  const k = g.kaiju;
  const sheds = g.objects.filter((o) => o.kind === 'building' && o.tier === 2 && Math.hypot(o.x - k.x, o.y - k.y) < 160);
  assert.ok(sheds.length && sheds.every((o) => o.hp <= 15));
  g.gateCleared[1] = true;
  g.boss = null;
  g.addBiomass(g.stage.biomassToNext);
  for (let i = 0; i < 200 && k.stage < 2; i++) {
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
    assert.notEqual(g.state, 'altar');
  }
  assert.equal(k.stage, 2);
});

test('an ad-pressure surge hits harder and brings extra waves, once a run', () => {
  const g = new Game({ seed: 4 });
  g.addBiomass(STAGES[1].biomassToNext);
  g.gateCleared[1] = true;
  for (let i = 0; i < 300 && g.kaiju.stage < 2; i++) {
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  const k = g.kaiju;
  k.invuln = 0;
  k.shield = 0;
  k.hp = k.maxHp;
  g.takeDamage(10);
  const normal = k.maxHp - k.hp;
  assert.ok(g.startPressure());
  assert.equal(g.startPressure(), false, 'once a run');
  k.hp = k.maxHp;
  k.invuln = 0;
  g.takeDamage(10);
  assert.ok(Math.abs(k.maxHp - k.hp - normal * AD_PRESSURE.dmgMul) < 1e-6);
  const before = g.units.length;
  for (let i = 0; i < 30 * 8; i++) {
    k.invuln = 99;
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.ok(g.units.length > before, 'extra strike waves');
  for (let i = 0; i < 30 * AD_PRESSURE.duration; i++) {
    k.invuln = 99;
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.equal(g.pressure, null, 'the surge ends');
});

// A kaiju grown to size 3 (house-sized), the gate bosses waved through, for the trait tests.
function grown(kaijuId, seed = 3) {
  const g = new Game({ seed, kaijuId });
  for (let s = 1; s < 3; s++) {
    g.gateCleared[s] = true;
    g.addBiomass(g.stage.biomassToNext);
    for (let i = 0; i < 300 && g.kaiju.stage === s; i++) {
      g.update(1 / 30);
      if (g.state === 'picking') g.choose(g.pick.options[0]);
      if (g.state === 'altar') g.altarChoose('angel');
    }
  }
  while (g.state === 'picking' || g.state === 'altar') {
    if (g.state === 'altar') g.altarChoose('angel');
    else g.choose(g.pick.options[0]);
  }
  g.kaiju.invuln = 999;
  return g;
}

test('Rex pounces on an enemy ahead (a dash elsewhere stays a dash), and eating readies the next one', () => {
  const g = grown('rex');
  const k = g.kaiju;
  g.setInput(0, 1);
  g.update(1 / 30);
  k.dashCd = 0;
  assert.ok(g.tryDash());
  assert.ok(!k.pounce, 'no prey that way: an ordinary dash');
  for (let i = 0; i < 30 * 30 && !g.units.some((u) => !u.dead && !u.flying); i++) {
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  const u = g.units.find((v) => !v.dead && !v.flying);
  assert.ok(u, 'some military turned up');
  k.x = u.x - k.r * 4;
  k.y = u.y;
  k.dashT = 0;
  k.dashCd = 0;
  g.input.x = 1;
  g.input.y = 0;
  k.moving = true;
  assert.ok(g.tryDash());
  assert.ok(k.pounce && k.hopT > 0, 'pounced');
  for (let i = 0; i < 60 && k.pounce; i++) g.update(1 / 60);
  assert.equal(k.pounce, false, 'landed');
  assert.ok(Math.hypot(k.x - u.x, k.y - u.y) < k.r * 3, 'landed on its prey');
  k.dashCd = 2;
  const p = g.people.find((q) => !q.taken);
  g.eatPerson(p);
  assert.ok(k.dashCd < 2, 'eating cut the cooldown');
});

test('Volt Beetle blinks forward, zapping the way, and a full charge overloads its zap', () => {
  const g = grown('volt');
  const k = g.kaiju;
  const x0 = k.x;
  g.setInput(1, 0);
  g.update(1 / 30);
  k.dashCd = 0;
  assert.ok(g.tryDash());
  assert.ok(Math.abs(k.x - x0 - k.r * TRAITS.blink.dist) < k.r * 1.5, 'jumped ahead at once');
  for (let i = 0; i < 30 * 5; i++) {
    g.setInput(Math.cos(i / 20), Math.sin(i / 20));
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
    if (k.charge >= 100) break;
  }
  assert.ok(k.charge >= 100, 'moving charged it up');
  g.setInput(0, 0);
  for (let i = 0; i < 30 * 10 && k.charge >= 100; i++) {
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.ok(k.charge < 100, 'the charge was spent on an overload');
});

test('Gorilla Grunt hurls a building every few hits and shrugs off hits standing still', () => {
  const g = grown('gorilla');
  const k = g.kaiju;
  const before = g.projectiles.filter((p) => p.kind === 'slab').length;
  const bld = g.objects.find((o) => o.kind === 'building' && o.state === 'intact' && !o.landmark && o.tier <= k.stage);
  k.x = bld.x + bld.w / 2 + k.r * 0.8;
  k.y = bld.y;
  k.grip = TRAITS.throw.every - 1;
  g.performAttack(bld);
  assert.ok(g.projectiles.filter((p) => p.kind === 'slab').length > before, 'a building is in the air');
  assert.equal(k.grip, 0);
  k.invuln = 0;
  k.shield = 0;
  k.hp = k.maxHp;
  k.moving = false;
  g.takeDamage(20);
  const still = k.maxHp - k.hp;
  const h = new Game({ seed: 3, kaijuId: 'rex' });
  h.kaiju.hp = h.kaiju.maxHp;
  h.takeDamage(20);
  assert.ok(still < h.kaiju.maxHp - h.kaiju.hp, 'less damage standing its ground');
});

test("Ember Lizard sets what it wrecks alight, and the fire spreads", () => {
  const g = grown('ember');
  const k = g.kaiju;
  const near = g.objects.filter((o) => o.kind === 'building' && o.state === 'intact' && !o.landmark && o.tier <= k.stage && Math.hypot(o.x - k.x, o.y - k.y) < 600);
  assert.ok(near.length > 3);
  g.destroyObject(near[0], { x: 1, y: 0 }, 'hit');
  assert.ok(g.fires.some((f) => f.spread), 'the wreck burns');
  let spread = false;
  for (let i = 0; i < 30 * 12 && !spread; i++) {
    g.update(1 / 30);
    if (g.state === 'picking') g.choose(g.pick.options[0]);
    spread = g.fires.some((f) => f.gen > 0);
  }
  assert.ok(spread, 'fire crept to a neighbour');
  k.hp = k.maxHp * 0.5;
  g.fires.push({ x: k.x, y: k.y, r: k.r * 2, t: 5, max: 5, tick: 1 });
  const hp = k.hp;
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  assert.ok(k.hp > hp, 'healed standing in fire');
});

test('tanky bosses stagger when their meter fills, break at phase lines and give way to rage', () => {
  const g = new Game({ seed: 3 });
  // A quick early boss: no meter, no phase breaks.
  g.spawnGateBoss();
  let b = g.boss;
  b.state = 'idle';
  assert.equal(b.tanky, false);
  g.addPoise(5);
  assert.equal(b.staggerT, 0, 'no stagger on a quick fight');
  // A tanky one (Wrecking Bill, size 4).
  for (let s = 1; s < 4; s++) {
    g.gateCleared[s] = true;
    g.kaiju.stage = s + 1;
  }
  g.boss = null;
  g.spawnGateBoss();
  b = g.boss;
  b.state = 'idle';
  assert.ok(b.tanky);
  g.addPoise(0.5);
  assert.equal(b.staggerT, 0);
  g.addPoise(0.6);
  assert.ok(b.staggerT > 0, 'a full meter staggers it');
  assert.ok(b.poiseNeed > 1, 'the next one takes more');
  const hp = b.hp;
  g.damageBoss(100);
  assert.ok(Math.abs(hp - b.hp - 100 * BOSS_FIGHT.staggerMul) < 1e-6, 'staggered, it takes extra damage');
  // Fresh fight clock: past the first phase line it breaks and the kaiju gets Fury.
  b.staggerT = 0;
  b.hp = b.maxHp * (BOSS_FIGHT.phases[0] + 0.01);
  g.damageBoss(b.maxHp * 0.02);
  assert.equal(b.phaseBreaks, 1);
  assert.ok(b.staggerT > 0 && g.furyT > 0);
  assert.equal(g.bossRage(b), 1);
  b.fight = BOSS_FIGHT.rageAfter + 20;
  assert.ok(g.bossRage(b) > 1.5, 'a long fight brings rage');
  b.fight = 1e6;
  assert.equal(g.bossRage(b), 1 + BOSS_FIGHT.rageMax);
});
