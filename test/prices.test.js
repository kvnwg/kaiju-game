import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { objectPrice, vehiclePrice, unitPrice, shortMoney } from '../src/prices.js';

const near = (o) => ({ kind: 'building', style: 'suburb', tier: 3, height: 16, ...o });

test('things cost about what they would in real life', () => {
  // A two-storey house (33 x 31 units, about 12 x 11 m) is in the hundreds of thousands.
  const house = objectPrice(near({ type: 'house_gable', w: 33, h: 31, height: 16 }));
  assert.ok(house > 300e3 && house < 1.5e6, `house $${house}`);
  // A garden shed is in the thousands.
  const shed = objectPrice(near({ type: 'garden_shed', w: 9, h: 9, height: 7, tier: 2 }));
  assert.ok(shed > 5e3 && shed < 50e3, `shed $${shed}`);
  // A downtown skyscraper is in the hundreds of millions.
  const tower = objectPrice(near({ type: 'cyber_skyscraper', style: 'neon', w: 118, h: 116, height: 228, tier: 5 }));
  assert.ok(tower > 100e6 && tower < 1e9, `tower $${tower}`);
  assert.ok(objectPrice({ kind: 'prop', type: 'bench', tier: 1 }) < 5000);
  assert.equal(vehiclePrice('car'), 28000);
  assert.ok(unitPrice({ type: 'tank' }) > 1e6);
  assert.equal(unitPrice({ type: 'cop' }), 0, 'people are not priced');
  assert.equal(shortMoney(204e6), '$204M');
  assert.equal(shortMoney(2.5e9), '$2.5B');
  assert.equal(shortMoney(15000), '$15K');
});

test('the damage counter adds up what the kaiju destroys, and nothing for eating people', () => {
  const g = new Game({ seed: 5 });
  g.city.update(g.kaiju.x, g.kaiju.y, 2600, Infinity);
  const before = g.stats.damage;
  const p = g.people.find((q) => q.state === 'walk' || q.state === 'flee');
  assert.ok(p, 'someone to eat');
  g.eatPerson(p);
  assert.equal(g.stats.damage, before);
  const houses = g.objects.filter((o) => o.kind === 'building' && o.tier === 3 && o.state === 'intact').slice(0, 10);
  g.kaiju.stage = 3;
  for (const o of houses) g.destroyObject(o, { x: 1, y: 0 }, 'hit');
  const total = houses.reduce((n, o) => n + objectPrice(o), 0);
  assert.ok(Math.abs(g.stats.damage - before - total) < 1);
  assert.ok(total > 3e6, `ten buildings your size come to millions ($${Math.round(total)})`);
});
