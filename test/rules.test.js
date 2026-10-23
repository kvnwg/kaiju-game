import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, MAX_STAGE, canDamage, isSnack, lootFor, TIER_HP, WORLD } from '../src/config.js';
import { World } from '../src/world.js';

test('six growth stages from human to skyline, each roughly doubling', () => {
  assert.equal(MAX_STAGE, 6);
  assert.equal(STAGES.length - 1, 6);
  assert.equal(STAGES[1].size, 'Human');
  for (let s = 2; s <= 6; s++) {
    const ratio = STAGES[s].radius / STAGES[s - 1].radius;
    assert.ok(ratio >= 2 && ratio <= 2.5, `stage ${s} ratio ${ratio}`);
  }
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

// A wide patch of the endless world, generated eagerly for inspection.
function patch(seed, radius = 6000) {
  const w = new World(seed);
  w.update(w.spawn.x, w.spawn.y, radius, Infinity);
  return w;
}
const city = patch(1337);
const chunks = [...city.chunks.values()];
const decals = chunks.flatMap((c) => c.decals);

test('world generation is deterministic per cell, whatever order cells load in', () => {
  const a = new World(1337);
  a.update(5000, 5000, 900, Infinity);
  a.update(a.spawn.x, a.spawn.y, 900, Infinity);
  const b = new World(1337);
  b.update(b.spawn.x, b.spawn.y, 900, Infinity);
  const key = (w) => w.objects.filter((o) => Math.hypot(o.x - 210, o.y - 210) < 700).map((o) => `${o.type}@${o.x.toFixed(1)},${o.y.toFixed(1)}`).sort();
  assert.deepEqual(key(a), key(b));
  for (let t = 1; t <= 6; t++) assert.ok(city.objects.some((o) => o.tier === t), `tier ${t} present`);
});

test('the world has no edge: cells generate wherever the kaiju goes', () => {
  const w = new World(5);
  for (const [x, y] of [[-40000, 0], [0, 52000], [123456, -98765]]) {
    w.update(x, y, 800, Infinity);
    assert.ok(w.isLoaded(Math.floor(x / WORLD.cell), Math.floor(y / WORLD.cell)));
  }
  assert.ok(w.chunks.size < 60, 'far cells are dropped again');
});

test('destruction is remembered when a cell unloads and loads again', () => {
  const w = new World(9);
  w.update(w.spawn.x, w.spawn.y, 600, Infinity);
  const house = w.objects.find((o) => o.kind === 'building' && o.tier === 3);
  house.state = 'rubble';
  house.hp = 0;
  const { c, r } = house.chunk;
  const li = house.li;
  w.update(30000, 30000, 600, Infinity);
  assert.ok(!w.isLoaded(c, r));
  w.update(w.spawn.x, w.spawn.y, 600, Infinity);
  const again = w.chunks.get(w.key(c, r)).objects.find((o) => o.li === li);
  assert.equal(again.type, house.type);
  assert.equal(again.state, 'rubble');
});

test('districts: suburbs, forest, water, docks and every city style turn up', () => {
  const styles = new Set(chunks.map((c) => c.zone.style));
  for (const st of ['suburb', 'forest', 'neon', 'brick', 'pastel', 'garden', 'water', 'park']) assert.ok(styles.has(st), st);
});

test('no buildings stand in the water (bridges and piers aside)', () => {
  const wet = city.objects.filter((o) => o.kind === 'building' && !o.walkable && !o.type.startsWith('bridge') && o.type !== 'lighthouse' && city.isWater(o.x, o.y));
  assert.equal(wet.length, 0);
});

test('highways cross wide water on suspension bridges, short crossings get road bridges', () => {
  let found = null;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = seed === 1337 ? city : patch(seed, 9000);
    const b = [...w.chunks.values()].flatMap((c) => c.bridges)[0];
    if (b) {
      found = { ...b, world: w };
      break;
    }
  }
  assert.ok(found, 'a suspension bridge somewhere');
  assert.ok(found.world.isWater(found.tower.x, found.tower.y), 'towers stand in the water');
  assert.ok(city.objects.some((o) => o.type === 'road_bridge'));
});

test('the drop-in point is a backyard with nothing taller than a person', () => {
  const s = city.spawn;
  const blockers = city.objects.filter((o) => o.tier >= 2 && Math.abs(o.x - s.x) < 12 + o.w / 2 && Math.abs(o.y - s.y) < 12 + o.h / 2);
  assert.equal(blockers.length, 0);
  const near = city.objects.filter((o) => Math.hypot(o.x - s.x, o.y - s.y) < 150);
  assert.ok(near.some((o) => o.type === 'fence'), 'fenced backyards nearby');
  assert.ok(near.some((o) => o.kind === 'building' && o.tier === 3), 'houses nearby');
});

test('a downtown with skyscrapers is always within a short walk of home', () => {
  for (const seed of [1, 2, 3, 11, 29]) {
    const w = new World(seed);
    w.update(w.spawn.x, w.spawn.y, 4800, Infinity);
    const towers = w.objects.filter((o) => o.kind === 'building' && o.tier === 5);
    assert.ok(towers.length >= 15, `seed ${seed}: ${towers.length} tier-5 buildings`);
  }
});

test('the city has the things a city has: civic buildings, parks, plazas, a metro, power lines', () => {
  const types = new Set(city.objects.map((o) => o.type));
  for (const t of ['museum', 'library', 'bank', 'cathedral', 'clock_tower', 'supermarket', 'shop_row', 'townhouse_row', 'construction_site', 'metro_track', 'metro_station']) assert.ok(types.has(t), t);
  for (const t of ['cafe_table', 'bike_rack', 'street_sign', 'statue', 'gazebo', 'slide', 'hoop', 'big_screen', 'food_truck', 'metro_entrance']) assert.ok(types.has(t), t);
  const kinds = new Set(decals.map((d) => d.kind));
  for (const k of ['path', 'pond', 'plaza', 'parking', 'manhole', 'sandbox']) assert.ok(kinds.has(k), k);
  assert.ok(kinds.has('basketball') || kinds.has('tennis'));
  assert.ok(chunks.reduce((n, c) => n + c.powerLines.length, 0) > 20);
  // Metro spans line up end to end along their row.
  const row = city.objects.find((o) => o.type === 'metro_track').metroRow;
  const xs = city.objects.filter((o) => o.metroRow === row).map((o) => o.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 40) < 1e-6 || xs[i] - xs[i - 1] > 400, 'continuous track');
});

test('every seed makes a different world, and the run always starts in the suburbs', () => {
  const sigs = new Set();
  for (const seed of [2, 9, 31]) {
    const w = new World(seed);
    assert.equal(w.cellAt(w.spawn.x, w.spawn.y).style, 'suburb', `seed ${seed}`);
    let sig = '';
    for (let r = -6; r <= 6; r++) for (let c = -6; c <= 6; c++) sig += w.zoneFor(c, r).style[0];
    sigs.add(sig);
  }
  assert.equal(sigs.size, 3);
});
