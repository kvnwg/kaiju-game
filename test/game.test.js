import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { STAGES } from '../src/config.js';
import { simulate } from './bot.js';

test('crushing small objects grows the kaiju and opens an augment pick', () => {
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

test('first run guarantees Domino Effect on the first pick', () => {
  const g = new Game({ seed: 8, firstRun: true });
  g.debugGrow();
  g.update(1 / 60);
  assert.ok(g.pick.options.includes('dominoEffect'));
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

test('Domino Effect topples neighbours in the fall direction', () => {
  const g = new Game({ seed: 6 });
  g.kaiju.stage = 3;
  const apartments = g.objects.filter((o) => o.kind === 'apartment');
  // Find an apartment with another building right next to it and topple it that way.
  let pair = null;
  for (const a of apartments) {
    const n = g.objects.find((o) => o !== a && o.structure && o.tier <= 3 && Math.abs(o.y - a.y) < 30 && o.x > a.x && o.x - a.x < 200);
    if (n) {
      pair = [a, n];
      break;
    }
  }
  assert.ok(pair, 'found neighbouring buildings');
  const [a, n] = pair;
  const without = new Game({ seed: 6 });
  without.kaiju.stage = 3;
  without.destroyObject(without.objects[a.id], { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) without.update(1 / 30);
  assert.equal(without.objects[n.id].hp, n.maxHp, 'no damage without the augment');

  g.held.set('dominoEffect', 1);
  g.destroyObject(a, { x: 1, y: 0 }, 'hit');
  for (let i = 0; i < 30; i++) g.update(1 / 30);
  assert.ok(n.hp < n.maxHp, 'neighbour took collapse damage');
});

test('chain collapses drop biomass only with the Demolition Crew set', () => {
  const g = new Game({ seed: 7 });
  g.kaiju.stage = 3;
  const [a, b] = g.objects.filter((o) => o.kind === 'apartment');
  const bio0 = g.stats.biomass;
  g.destroyObject(a, { x: 1, y: 0 }, 'chain');
  assert.equal(g.stats.biomass, bio0);
  for (const id of ['dominoEffect', 'gasMain', 'debrisToss']) g.held.set(id, 1);
  g.destroyObject(b, { x: 1, y: 0 }, 'chain');
  assert.ok(g.stats.biomass > bio0);
});

test('autopiloted runs reach Apex, fight the boss and mostly win', () => {
  const runs = [1, 2, 3].map((seed) => simulate(new Game({ seed, kaijuId: 'rex', firstRun: true }), { maxTime: 1500 }));
  for (const g of runs) {
    assert.ok(g.state === 'won' || g.state === 'lost', `run ended (state ${g.state})`);
    assert.ok(g.results.buildings > 50);
  }
  const wins = runs.filter((g) => g.state === 'won');
  assert.ok(wins.length >= 2, `won ${wins.length}/3`);
  for (const g of wins) {
    assert.ok(g.stats.bossDefeated);
    // Pacing guard: the boss arrives inside the 10 to 15 minute session budget.
    assert.ok(g.stats.stageTimes[5] < 15 * 60);
  }
});
