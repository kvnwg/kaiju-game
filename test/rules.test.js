import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, MAX_STAGE, canDamage, isSnack, lootFor, TIER_HP, WORLD } from '../src/config.js';
import { generateCity, isWater } from '../src/world.js';

test('six growth stages from human to skyline, each roughly doubling', () => {
  assert.equal(MAX_STAGE, 6);
  assert.equal(STAGES.length - 1, 6);
  assert.equal(STAGES[1].size, 'Human');
  for (let s = 2; s <= 6; s++) {
    const ratio = STAGES[s].radius / STAGES[s - 1].radius;
    assert.ok(ratio >= 2 && ratio <= 2.5, `stage ${s} ratio ${ratio}`);
    assert.ok(STAGES[s].pickOdds, `stage ${s} grants a pick`);
  }
  assert.equal(STAGES[1].pickOdds, null);
});

test('size rules: snacks break in one hit, one size up takes several, two up is out of reach', () => {
  for (let stage = 1; stage <= MAX_STAGE; stage++) {
    const dmg = STAGES[stage].damage;
    if (stage > 1) assert.ok(isSnack(stage - 1, stage));
    assert.ok(!isSnack(stage, stage));
    assert.ok(TIER_HP[stage] / dmg >= 2, 'own size takes a couple of hits');
    if (stage < MAX_STAGE) {
      assert.ok(canDamage(stage + 1, stage));
      assert.ok(TIER_HP[stage + 1] / dmg >= 6, 'one size up takes several hits');
    }
    if (stage < MAX_STAGE - 1) assert.ok(!canDamage(stage + 2, stage));
  }
});

test('landmarks only break at max size', () => {
  for (let s = 1; s < MAX_STAGE; s++) assert.equal(canDamage(6, s, true), false);
  assert.equal(canDamage(6, MAX_STAGE, true), true);
});

test('out-sizing yourself pays more scrap', () => {
  assert.ok(lootFor(3, 2).scrap > lootFor(3, 3).scrap * 2);
  assert.ok(lootFor(3, 2).biomass > lootFor(2, 2).biomass);
});

const city = generateCity(1337);

test('city generation is deterministic with one landmark and every size class', () => {
  const again = generateCity(1337);
  assert.equal(city.objects.length, again.objects.length);
  assert.deepEqual(city.objects.slice(0, 80).map((o) => [o.type, o.x, o.y]), again.objects.slice(0, 80).map((o) => [o.type, o.x, o.y]));
  assert.equal(city.objects.filter((o) => o.landmark).length, 1);
  for (let t = 1; t <= 6; t++) assert.ok(city.objects.some((o) => o.tier === t), `tier ${t} present`);
  for (const o of city.objects) assert.ok(o.x >= 0 && o.x <= WORLD.width && o.y >= 0 && o.y <= WORLD.height);
});

test('districts: suburbs, forest, a lake with a suspension bridge, and several city styles', () => {
  const styles = new Set(city.cells.map((c) => c.style));
  for (const s of ['suburb', 'forest', 'neon', 'brick', 'pastel', 'garden', 'water']) assert.ok(styles.has(s), s);
  assert.equal(city.bridges.length, 1);
  const b = city.bridges[0];
  assert.equal(b.towers.length, 2);
  assert.ok(b.decks.length > 10);
  assert.ok(b.x1 - b.x0 > 1500, 'long span');
  for (const t of b.towers) assert.ok(isWater(t.x, t.y), 'towers stand in the lake');
});

test('no buildings stand in the water (bridges aside)', () => {
  const wet = city.objects.filter((o) => o.kind === 'building' && !o.walkable && !o.type.startsWith('bridge') && o.type !== 'lighthouse' && isWater(o.x, o.y));
  assert.equal(wet.length, 0);
});

test('the drop-in point is a backyard with nothing taller than a person', () => {
  const s = city.spawn;
  const blockers = city.objects.filter((o) => o.tier >= 2 && Math.abs(o.x - s.x) < 12 + o.w / 2 && Math.abs(o.y - s.y) < 12 + o.h / 2);
  assert.equal(blockers.length, 0);
  const near = city.objects.filter((o) => Math.hypot(o.x - s.x, o.y - s.y) < 150);
  assert.ok(near.some((o) => o.type === 'fence'), 'fenced backyards nearby');
  assert.ok(near.some((o) => o.kind === 'building' && o.tier === 3), 'houses nearby');
});

test('the city has the things a city has: civic landmarks, parks, plazas, a metro, power lines', () => {
  const types = new Set(city.objects.map((o) => o.type));
  for (const t of ['city_hall', 'museum', 'library', 'bank', 'cathedral', 'clock_tower', 'supermarket', 'shop_row', 'townhouse_row', 'construction_site']) assert.ok(types.has(t), t);
  for (const t of ['cafe_table', 'bike_rack', 'street_sign', 'statue', 'gazebo', 'slide', 'hoop', 'big_screen', 'food_truck', 'metro_entrance', 'beach_umbrella']) assert.ok(types.has(t), t);
  const kinds = new Set(city.decals.map((d) => d.kind));
  for (const k of ['path', 'pond', 'plaza', 'parking', 'manhole', 'sandbox']) assert.ok(kinds.has(k), k);
  assert.ok(kinds.has('basketball') || kinds.has('tennis'));
  assert.ok(city.metro.segments.length > 100 && city.metro.stations.length >= 5);
  assert.ok(city.powerLines.length > 20);
});
