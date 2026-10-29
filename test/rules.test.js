import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, MAX_STAGE, LAST_STAGE, REALMS, canDamage, isSnack, lootFor, TIER_HP, WORLD, CHAPTER_THEMES } from '../src/config.js';
import { World } from '../src/world.js';

test('six city sizes from human to skyline, each roughly doubling, then five more past the city', () => {
  assert.equal(MAX_STAGE, 6);
  assert.equal(LAST_STAGE, 11);
  assert.equal(STAGES.length - 1, LAST_STAGE);
  assert.equal(STAGES[1].size, 'Human');
  for (let s = 2; s <= LAST_STAGE; s++) {
    // Each realm counts sizes in its own units: within one, size roughly doubles each step.
    if (STAGES[s].realm !== STAGES[s - 1].realm) continue;
    const ratio = STAGES[s].radius / STAGES[s - 1].radius;
    assert.ok(ratio >= 2 && ratio <= 2.5, `stage ${s} ratio ${ratio}`);
  }
  assert.deepEqual([...new Set(STAGES.slice(1).map((st) => st.realm))], ['city', 'solar', 'galaxy', 'cosmos', 'garden']);
  for (let s = 2; s <= LAST_STAGE; s++) {
    assert.ok(STAGES[s].maxHp > STAGES[s - 1].maxHp && STAGES[s].damage > STAGES[s - 1].damage, `size ${s} is stronger`);
    assert.ok(REALMS[STAGES[s].realm], `size ${s} has a realm`);
  }
});

test('size rules: snacks break in one hit, one size up takes several, two up is out of reach', () => {
  for (let stage = 1; stage <= LAST_STAGE; stage++) {
    const dmg = STAGES[stage].damage;
    if (stage > 1) assert.ok(isSnack(stage - 1, stage));
    assert.ok(!isSnack(stage, stage));
    assert.ok(TIER_HP[stage] / dmg >= 2, 'own size takes a couple of hits');
    assert.ok(canDamage(stage + 1, stage));
    assert.ok(TIER_HP[stage + 1] / dmg >= 6, 'one size up takes several hits');
    assert.ok(!canDamage(stage + 2, stage));
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

test('the countryside: farms, desert towns, snowy villages, lantern streets and fairgrounds', () => {
  const w = new World(7);
  const found = {};
  for (let r = -60; r < 60; r++) for (let c = -60; c < 60; c++) {
    const z = w.zoneFor(c, r);
    if (['farm', 'desert', 'snow', 'lantern', 'fair'].includes(z.style) && z.density > 0.3) found[z.style] ||= [c, r];
  }
  const expect = { farm: ['farmhouse', 'barn'], desert: ['adobe', 'saloon', 'motel', 'adobe_big'], snow: ['chalet', 'ski_lodge'], lantern: ['tea_house', 'shophouse', 'paifang', 'lantern_pagoda', 'pagoda'], fair: ['ferris_wheel', 'circus_tent', 'carousel', 'coaster'] };
  for (const [st, types] of Object.entries(expect)) {
    assert.ok(found[st], `no ${st} district`);
    w.load(...found[st]);
    const chunk = w.chunks.get(w.key(...found[st]));
    const built = new Set(chunk.objects.filter((o) => o.kind === 'building').map((o) => o.type));
    assert.ok(types.some((t) => built.has(t)), `${st}: ${[...built]}`);
  }
});

test("each chapter's city leans towards its name", () => {
  const mix = (ch) => {
    const w = new World(7, CHAPTER_THEMES[ch]);
    const n = {};
    for (let r = -40; r < 40; r++) for (let c = -40; c < 40; c++) {
      const st = w.zoneFor(c, r).style;
      n[st] = (n[st] || 0) + 1;
    }
    return (st) => n[st] || 0;
  };
  const harbor = mix(1);
  const byName = Object.fromEntries(CHAPTER_THEMES.slice(1).map((t, i) => [t.name, i + 1]));
  assert.ok(mix(byName['Pastel Bay'])('pastel') > harbor('pastel') * 2, 'Pastel Bay is pastel');
  assert.ok(mix(byName['Neo Tokyo'])('lantern') > harbor('lantern') * 2, 'Neo Tokyo has lantern streets');
  const frost = mix(byName.Frostgate);
  assert.ok(frost('snow') > harbor('snow') && frost('desert') === 0 && frost('farm') === 0, 'Frostgate is all snow');
  const sunset = mix(byName['Sunset Strip']);
  assert.ok(sunset('desert') > harbor('desert') && sunset('snow') === 0, 'Sunset Strip is desert');
  assert.ok(mix(byName['Iron Docks'])('water') > harbor('water'), 'Iron Docks is wetter');
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

test('blocks are full of small things to wreck, and the countryside of big ones', () => {
  // Small, street-level props per block, by district: plenty to eat at the small sizes.
  for (const st of ['suburb', 'neon', 'brick', 'garden']) {
    const cs = chunks.filter((c) => c.zone.style === st);
    const small = cs.reduce((n, c) => n + c.objects.filter((o) => o.kind === 'prop' && o.tier === 1).length, 0) / cs.length;
    assert.ok(small >= 40, `${st}: ${small.toFixed(0)} small props a block`);
  }
  const types = new Set(city.objects.map((o) => o.type));
  for (const t of ['trash_bags', 'wheelie_bin', 'hedge', 'pigeons', 'potted_plant', 'mailbox', 'clothesline', 'market_stall', 'billboard']) assert.ok(types.has(t), t);
  // Nothing scattered in lands inside a building.
  for (const ch of chunks) {
    const blds = ch.objects.filter((o) => o.kind === 'building' && !o.walkable);
    for (const o of ch.objects) {
      if (o.kind !== 'prop' || !['potted_plant', 'trash_bags', 'pigeons', 'clothesline'].includes(o.type)) continue;
      assert.ok(!blds.some((b) => Math.abs(o.x - b.x) < (b.w - o.w) / 2 && Math.abs(o.y - b.y) < (b.h - o.h) / 2), `${o.type} inside a building`);
    }
  }
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
