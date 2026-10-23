import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, canDamage, isSnack, lootFor, TIER_HP, WORLD } from '../src/config.js';
import { generateCity } from '../src/world.js';

test('five growth stages, each roughly doubling in size', () => {
  assert.equal(STAGES.length - 1, 5);
  for (let s = 2; s <= 5; s++) assert.equal(STAGES[s].radius, STAGES[s - 1].radius * 2);
  assert.equal(STAGES[1].pickOdds, null);
  for (let s = 2; s <= 5; s++) assert.ok(STAGES[s].pickOdds, `stage ${s} grants a pick`);
});

test('size rules: snacks break in one hit, one size up takes several, two up is out of reach', () => {
  for (let stage = 1; stage <= 5; stage++) {
    const dmg = STAGES[stage].damage;
    if (stage > 1) assert.ok(isSnack(stage - 1, stage));
    assert.ok(!isSnack(stage, stage));
    assert.ok(TIER_HP[stage] / dmg >= 2, 'own size takes a couple of hits');
    if (stage < 5) {
      assert.ok(canDamage(stage + 1, stage));
      assert.ok(TIER_HP[stage + 1] / dmg >= 6, 'one size up takes several hits');
    }
    if (stage < 4) assert.ok(!canDamage(stage + 2, stage));
  }
});

test('landmarks only break at stage 5', () => {
  for (let s = 1; s < 5; s++) assert.equal(canDamage(5, s, true), false);
  assert.equal(canDamage(5, 5, true), true);
});

test('out-sizing yourself pays more scrap', () => {
  assert.ok(lootFor(3, 2).scrap > lootFor(3, 3).scrap * 2);
  assert.ok(lootFor(3, 2).biomass > lootFor(2, 2).biomass);
});

test('city generation is deterministic with one landmark and every size class', () => {
  const a = generateCity(42);
  const b = generateCity(42);
  assert.equal(a.objects.length, b.objects.length);
  assert.deepEqual(a.objects.slice(0, 50).map((o) => [o.kind, o.x, o.y]), b.objects.slice(0, 50).map((o) => [o.kind, o.x, o.y]));
  assert.equal(a.objects.filter((o) => o.landmark).length, 1);
  for (let t = 1; t <= 5; t++) assert.ok(a.objects.some((o) => o.tier === t), `tier ${t} present`);
  for (const o of a.objects) {
    assert.ok(o.x >= 0 && o.x <= WORLD.width && o.y >= 0 && o.y <= WORLD.height);
  }
});

test('the drop-in point is clear of buildings', () => {
  const city = generateCity(1337);
  const blockers = city.objects.filter((o) => o.tier >= 2 && Math.hypot(o.x - city.spawn.x, o.y - city.spawn.y) < 90);
  assert.equal(blockers.length, 0);
});
