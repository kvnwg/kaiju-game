import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, distToRect } from '../src/game.js';
import { STAGES, MAX_STAGE, xpToNext } from '../src/config.js';
import { AUGMENT_BY_ID, MOVES } from '../src/augments.js';
import { simulate, botStep } from './bot.js';
import { waterField } from '../src/world.js';

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
  // A big chunk of biomass grows the kaiju and queues several picks, one after another.
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
    assert.ok(g.stats.moves > 0, `${m.id} fired`);
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

test('death offers one revive, then ends the run keeping 50% scrap', () => {
  const g = new Game({ seed: 3 });
  g.stats.scrap = 101;
  g.takeDamage(10000);
  assert.equal(g.state, 'dead');
  assert.ok(g.revive());
  assert.equal(g.kaiju.hp, g.kaiju.maxHp * 0.5);
  g.kaiju.invuln = 0;
  g.takeDamage(10000);
  assert.equal(g.state, 'lost');
  assert.equal(g.results.scrap, 51);
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

function neighbourPair(g, tier) {
  for (const a of g.objects) {
    if (a.kind !== 'building' || a.tier !== tier || a.walkable) continue;
    const n = g.objects.find((o) => o !== a && o.kind === 'building' && !o.walkable && o.tier <= tier && Math.abs(o.y - a.y) < 30 && o.x > a.x && o.x - a.x < a.w / 2 + o.w / 2 + 60);
    if (n) return [a, n];
  }
  return null;
}

test('Domino Effect topples neighbours in the fall direction', () => {
  const g = wide(new Game({ seed: 6 }), 1500);
  g.kaiju.stage = 4;
  const pair = neighbourPair(g, 4);
  assert.ok(pair, 'found neighbouring buildings');
  const [a, n] = pair;
  g.destroyObject(a, { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  assert.equal(n.hp, n.maxHp, 'no damage without the augment');

  const g2 = wide(new Game({ seed: 6 }), 1500);
  g2.kaiju.stage = 4;
  const [a2, n2] = neighbourPair(g2, 4);
  g2.held.set('dominoEffect', 1);
  g2.kaiju.level = 200;
  g2.destroyObject(a2, { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) g2.update(1 / 30);
  assert.ok(n2.hp < n2.maxHp, 'neighbour took collapse damage');
});

test('chain collapses drop biomass only with the Demolition Crew set', () => {
  const g = wide(new Game({ seed: 7 }));
  g.kaiju.stage = 4;
  const [a, b] = g.objects.filter((o) => o.kind === 'building' && o.tier === 4);
  const bio0 = g.stats.biomass;
  g.destroyObject(a, { x: 1, y: 0 }, 'chain');
  assert.equal(g.stats.biomass, bio0);
  for (const id of ['dominoEffect', 'gasMain', 'seismicSlam']) g.held.set(id, 1);
  g.destroyObject(b, { x: 1, y: 0 }, 'chain');
  assert.ok(g.stats.biomass > bio0);
});

test('military vehicles and soldiers never drive or walk through intact buildings', () => {
  const g = new Game({ seed: 3 });
  const inside = (u) => g.grid.query(u.x - u.r, u.y - u.r, u.x + u.r, u.y + u.r)
    .some((o) => o.kind === 'building' && o.state === 'intact' && !o.walkable && distToRect(u.x, u.y, o) < u.r * 0.5);
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

test('autopiloted runs grow through all six stages, fight the boss and mostly win', () => {
  const runs = [1, 2, 3].map((seed) => simulate(new Game({ seed, kaijuId: 'rex', firstRun: true }), { maxTime: 1500 }));
  checkRuns(runs, 2);
});

test('later runs push back: the military can win, but a decent run still beats the boss', () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => simulate(new Game({ seed, kaijuId: 'rex' }), { maxTime: 1500 }));
  checkRuns(runs, 3);
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
    // Pacing guard: the boss arrives inside the 10 to 15 minute session budget.
    assert.ok(g.stats.stageTimes[MAX_STAGE] < 15 * 60);
  }
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
