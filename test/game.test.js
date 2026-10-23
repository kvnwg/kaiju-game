import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, distToRect } from '../src/game.js';
import { STAGES, MAX_STAGE } from '../src/config.js';
import { AUGMENTS, AUGMENT_BY_ID, MOVES } from '../src/augments.js';
import { simulate, botStep } from './bot.js';

test('a human-sized kaiju starts among people and grows by eating them', () => {
  const g = new Game({ seed: 5 });
  assert.equal(g.kaiju.stage, 1);
  assert.ok(g.people.length > 20, 'crowd around the drop-in point');
  const before = g.kaiju.biomass;
  g.flingPerson(g.people[0], false);
  assert.ok(g.kaiju.biomass > before);
  assert.equal(g.stats.people, 1);
});

test('growing opens an augment pick', () => {
  const g = new Game({ seed: 5 });
  g.addBiomass(STAGES[1].biomassToNext);
  g.update(1 / 60);
  assert.equal(g.kaiju.stage, 2);
  assert.equal(g.state, 'picking');
  assert.equal(g.pick.options.length, 3);
  assert.ok(g.drainEvents().some((e) => e.type === 'grow'));
  assert.ok(g.choose(g.pick.options[0]));
  assert.equal(g.state, 'playing');
});

test('first run guarantees Laser Eyes on the first pick, and the first offer is all moves', () => {
  const g = new Game({ seed: 8, firstRun: true });
  g.debugGrow();
  g.update(1 / 60);
  assert.ok(g.pick.options.includes('laserEyes'));
  assert.ok(g.pick.options.every((id) => AUGMENT_BY_ID[id].kind === 'move'));
});

test('every move fires, hits things and shows its effect', () => {
  for (const m of MOVES) {
    const g = new Game({ seed: 5 });
    g.kaiju.invuln = 999;
    g.held.set(m.id, 1);
    for (const a of AUGMENTS) if (a.kind === 'mod' && a.requires === m.id) g.held.set(a.id, 1);
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

test('mods change their move: Double Strike slashes twice, Barrage fires 8 spines', () => {
  const count = (id, mods) => {
    const g = new Game({ seed: 5 });
    g.kaiju.stage = 3;
    g.kaiju.r = 14;
    g.held.set(id, 1);
    for (const m of mods) g.held.set(m, 1);
    let slashes = 0;
    let spines = 0;
    for (let i = 0; i < 30 * 3; i++) {
      g.update(1 / 30);
      slashes += g.fx.slashes.filter((s) => !s._c && (s._c = true)).length;
      spines += g.projectiles.filter((p) => p.kind === 'spine' && !p._c && (p._c = true)).length;
    }
    return { slashes, spines, moves: g.stats.moves };
  };
  const one = count('clawStrike', []);
  const two = count('clawStrike', ['doubleStrike']);
  assert.equal(two.slashes / two.moves, 2 * (one.slashes / one.moves));
  const s4 = count('spineMissiles', []);
  const s8 = count('spineMissiles', ['barrage']);
  assert.equal(s4.spines / s4.moves, 4);
  assert.equal(s8.spines / s8.moves, 8);
});

test('one free reroll per pick, then one ad reroll per run', () => {
  const g = new Game({ seed: 2 });
  g.debugGrow();
  g.update(1 / 60);
  assert.ok(g.reroll(false));
  assert.equal(g.reroll(false), false);
  assert.ok(g.reroll(true));
  assert.equal(g.reroll(true), false);
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
  g.held.set('thickHide', 1);
  g.takeDamage(10, 'bullet');
  assert.equal(g.kaiju.maxHp - g.kaiju.hp, 8.5);
  g.kaiju.hp = g.kaiju.maxHp;
  g.takeDamage(10, 'explosive');
  assert.equal(g.kaiju.maxHp - g.kaiju.hp, 10);
});

test('hits on buildings report an impact point for the voxel chipping', () => {
  const g = new Game({ seed: 4 });
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
  const g = new Game({ seed: 6 });
  g.kaiju.stage = 4;
  const pair = neighbourPair(g, 4);
  assert.ok(pair, 'found neighbouring buildings');
  const [a, n] = pair;
  g.destroyObject(a, { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  assert.equal(n.hp, n.maxHp, 'no damage without the augment');

  const g2 = new Game({ seed: 6 });
  g2.kaiju.stage = 4;
  const [a2, n2] = neighbourPair(g2, 4);
  g2.held.set('dominoEffect', 1);
  g2.destroyObject(a2, { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) g2.update(1 / 30);
  assert.ok(n2.hp < n2.maxHp, 'neighbour took collapse damage');
});

test('chain collapses drop biomass only with the Demolition Crew set', () => {
  const g = new Game({ seed: 7 });
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
  for (const g of runs) {
    assert.ok(g.state === 'won' || g.state === 'lost', `run ended (state ${g.state})`);
    assert.ok(g.results.buildings > 30);
    assert.ok(g.stats.people > 10, 'ate people early on');
  }
  const wins = runs.filter((g) => g.state === 'won');
  assert.ok(wins.length >= 2, `won ${wins.length}/3`);
  for (const g of wins) {
    assert.equal(g.kaiju.stage, MAX_STAGE);
    assert.ok(g.stats.bossDefeated);
    // Pacing guard: the boss arrives inside the 10 to 15 minute session budget.
    assert.ok(g.stats.stageTimes[MAX_STAGE] < 15 * 60);
  }
});

test('chained kills build a combo that pays a scrap bonus when it lapses', () => {
  const g = new Game({ seed: 5 });
  g.kaiju.stage = 3;
  const k = g.kaiju;
  const props = g.objects.filter((o) => o.kind === 'prop' && o.tier === 3 && o.state === 'intact').slice(0, 12);
  for (const o of props) g.destroyObject(o, { x: 1, y: 0 }, 'hit');
  assert.equal(g.combo.n, props.length);
  const events = g.drainEvents();
  assert.ok(events.some((e) => e.type === 'comboTier' && e.tier === 1), 'x10 milestone');
  const scrap = g.stats.scrap;
  // Park out at sea so nothing keeps the combo alive.
  k.x = 150;
  k.y = 1500;
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
