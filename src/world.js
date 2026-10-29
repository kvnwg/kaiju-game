import { WORLD, TIER_HP, LANDMARK_HP } from './config.js';
import { createRng } from './rng.js';
import { BUILDING_TYPES, TYPE_BY_ID, buildingDims, VARIANTS } from './buildings.js';
import { PROP_BY_ID, propDims } from './props.js';

// The world is endless: it is cut into square cells (one city block plus its road) that are
// generated from (seed, column, row) the moment the kaiju gets near and dropped again once it
// has moved on. Destruction is remembered per cell, so a flattened block stays flattened.

const { cell, road } = WORLD;
const inner = cell - road;
const SR = 7; // cells per district region: each region gets at most one district centre

// ---------------------------------------------------------------- spatial hash
// Unbounded uniform hash for area queries; objects can be added and removed as cells stream.
export class SpatialHash {
  constructor(size = 128) {
    this.size = size;
    this.map = new Map();
    this.stamp = 0;
  }

  each(o, fn) {
    const s = this.size;
    const c0 = Math.floor((o.x - o.w / 2) / s);
    const c1 = Math.floor((o.x + o.w / 2) / s);
    const r0 = Math.floor((o.y - o.h / 2) / s);
    const r1 = Math.floor((o.y + o.h / 2) / s);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn((r + 32768) * 65536 + c + 32768);
  }

  insert(o) {
    this.each(o, (k) => {
      let arr = this.map.get(k);
      if (!arr) this.map.set(k, (arr = []));
      arr.push(o);
    });
  }

  remove(o) {
    this.each(o, (k) => {
      const arr = this.map.get(k);
      if (!arr) return;
      const i = arr.indexOf(o);
      if (i < 0) return;
      arr[i] = arr[arr.length - 1];
      arr.pop();
      if (!arr.length) this.map.delete(k);
    });
  }

  query(x0, y0, x1, y1, out = []) {
    const s = this.size;
    const c0 = Math.floor(x0 / s);
    const c1 = Math.floor(x1 / s);
    const r0 = Math.floor(y0 / s);
    const r1 = Math.floor(y1 / s);
    const stamp = ++this.stamp;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const arr = this.map.get((r + 32768) * 65536 + c + 32768);
        if (!arr) continue;
        for (const obj of arr) {
          if (obj._q === stamp) continue;
          obj._q = stamp;
          if (obj.x + obj.w / 2 < x0 || obj.x - obj.w / 2 > x1 || obj.y + obj.h / 2 < y0 || obj.y - obj.h / 2 > y1) continue;
          out.push(obj);
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- noise
export function ihash(a, b, s) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = ihash(xi, yi, s);
  const b = ihash(xi + 1, yi, s);
  const c = ihash(xi, yi + 1, s);
  const d = ihash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, s, oct) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x + i * 17.31, y - i * 9.73, s + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- world parameters
// 'rural' becomes farmland, desert or a snowy village depending on the local climate.
const STYLE_ODDS = { neon: 0.16, brick: 0.15, garden: 0.13, pastel: 0.11, suburb: 0.14, rural: 0.19, lantern: 0.07, fair: 0.03, none: 0.02 };
const SITE = {
  neon: { r: [5, 6.5], peak: 1.15 },
  brick: { r: [4.2, 5.4], peak: 0.95 },
  garden: { r: [4.2, 5.6], peak: 0.85 },
  pastel: { r: [3.8, 5], peak: 0.72 },
  suburb: { r: [3.8, 5.2], peak: 0.5 },
  farm: { r: [4.5, 6], peak: 0.55 },
  desert: { r: [4, 5.5], peak: 0.55 },
  snow: { r: [4, 5.5], peak: 0.5 },
  lantern: { r: [3.5, 4.6], peak: 0.8 },
  fair: { r: [1.2, 1.8], peak: 0.7 },
};
// Open country: no docks on its shore and no city parks in it.
const OPEN_COUNTRY = new Set(['forest', 'suburb', 'docks', 'farm', 'desert', 'snow', 'fair']);
// Parked vehicles along country roads, and what grows in the yards behind desert and lantern
// street fronts.
const TRAFFIC = {
  farm: { pickup: 3, tractor: 2, car: 1, van: 0.5 },
  desert: { pickup: 3, car: 2, truck: 0.6, van: 1 },
  snow: { car: 2, pickup: 2, van: 1, hatchback: 1 },
};
const COURTYARD = {
  desert: { cactus: 4, desert_rock: 2, tumbleweed: 1 },
  lantern: { tree_blossom: 3, stone_lion: 1, lantern_post: 2, bench: 1, planter: 2 },
};

function makeParams(seed) {
  const rng = createRng(seed * 7919 + 13);
  const s = rng.int(1, 1 << 20);
  // A downtown always sits a short walk from home, so the climb to skyscraper size never
  // depends on luck; a brick district sits on the far side.
  const a = rng.range(0, Math.PI * 2);
  const d = rng.range(7.5, 9);
  const b = a + Math.PI + rng.range(-0.8, 0.8);
  return {
    seed,
    s,
    spawn: { x: cell / 2, y: cell / 2 },
    hwRow: rng.int(2, 5), // highways every 8 rows / columns
    hwCol: rng.int(2, 5),
    metroRow: rng.int(0, 8), // elevated metro lines every 9 rows
    extra: [
      { style: 'suburb', cx: 0.5, cy: 0.5, r: 5, peak: 0.6, home: true, nk: 0 },
      { style: 'neon', cx: 0.5 + Math.cos(a) * d, cy: 0.5 + Math.sin(a) * d, r: 6.5, peak: 1.2, nk: 3 },
      { style: 'brick', cx: 0.5 + Math.cos(b) * 7, cy: 0.5 + Math.sin(b) * 7, r: 4.8, peak: 0.95, nk: 7 },
    ],
    sites: new Map(),
    zones: new Map(),
    edges: new Map(),
  };
}

let CUR = makeParams(1);

// Signed distance-ish water field in world units: > 0 is water. Lakes, the occasional sea and
// winding rivers; the land around the spawn point is always dry.
export function waterField(x, y, p = CUR) {
  if (p.dry) return -1; // the worlds past the city have no water (see realm.js)
  const s = p.s;
  const dx = x - p.spawn.x;
  const dy = y - p.spawn.y;
  const t = clamp01((Math.sqrt(dx * dx + dy * dy) - 1400) / 1800);
  const near = 1 - t * t * (3 - 2 * t);
  const lake = (fbm(x / 2400, y / 2400, s + 11, 3) - 0.7) * 1600 + (vnoise(x / 260, y / 260, s + 12) - 0.5) * 30;
  const sea = (fbm(x / 9000, y / 9000, s + 13, 2) - 0.77) * 6000;
  let v = lake > sea ? lake : sea;
  const gate = clamp01((vnoise(x / 6500, y / 6500, s + 15) - 0.55) / 0.2);
  if (gate > 0) {
    const river = (0.016 * gate - Math.abs(fbm(x / 3200, y / 3200, s + 14, 2) - 0.5)) * 2100;
    if (river > v) v = river;
  }
  return v * (1 - near) - near * 300;
}

export function isWater(x, y) {
  return waterField(x, y) > 0;
}

function siteFor(I, J, p) {
  const key = (I + 4096) * 8192 + J + 4096;
  let site = p.sites.get(key);
  if (site !== undefined) return site;
  const h = (k) => ihash(I * 13 + k, J * 7 - k * 3, p.s + 101);
  let roll = h(0);
  let style = 'none';
  for (const [st, w] of Object.entries(STYLE_ODDS)) {
    roll -= w;
    if (roll < 0) {
      style = st;
      break;
    }
  }
  site = null;
  if (style === 'rural') {
    const heat = vnoise(I / 4, J / 4, p.s + 131);
    style = heat > 0.64 ? 'desert' : heat < 0.34 ? 'snow' : 'farm';
  }
  if (style !== 'none') {
    const def = SITE[style];
    site = { style, cx: (I + 0.15 + 0.7 * h(1)) * SR, cy: (J + 0.15 + 0.7 * h(2)) * SR, r: def.r[0] + (def.r[1] - def.r[0]) * h(3), peak: def.peak, nk: Math.floor(h(4) * 1000) };
    // Leave the home neighbourhood to the suburbs.
    if (Math.hypot(site.cx - 0.5, site.cy - 0.5) < 5.5) site = null;
  }
  p.sites.set(key, site);
  return site;
}

const urbanStyle = (st) => st !== 'forest' && st !== 'water';

// Which district a cell belongs to and how dense it is (0..1). Pure: same answer every time.
function zoneFor(c, r, p = CUR) {
  const key = (c + 32768) * 65536 + r + 32768;
  let z = p.zones.get(key);
  if (z) return z;
  if (p.zones.size > 60000) p.zones.clear();
  const x = (c + 0.5) * cell;
  const y = (r + 0.5) * cell;
  const s = p.s;
  let best = { style: 'forest', density: 0, district: null };
  if (waterField(x, y, p) > 0) best = { style: 'water', density: 0, district: null };
  else {
    let bestScore = 0.12 + vnoise(c / 3, r / 3, s + 21) * 0.12;
    const consider = (d) => {
      if (!d) return;
      const dist = Math.hypot(c + 0.5 - d.cx, r + 0.5 - d.cy) / d.r;
      if (dist > 1.6) return;
      const score = (1 - dist) * d.peak + vnoise(c / 2 + d.nk, r / 2, s + 22) * 0.12;
      if (score > bestScore) {
        bestScore = score;
        best = { style: d.style, density: clamp01(score), district: d };
      }
    };
    const I0 = Math.floor(c / SR);
    const J0 = Math.floor(r / SR);
    for (let J = J0 - 1; J <= J0 + 1; J++) for (let I = I0 - 1; I <= I0 + 1; I++) consider(siteFor(I, J, p));
    for (const d of p.extra) consider(d);
    if (Math.abs(c) <= 1 && Math.abs(r) <= 1) best = { style: 'suburb', density: 0.5, district: p.extra[0] };
    // Waterfront blocks become docks.
    if (urbanStyle(best.style) && !OPEN_COUNTRY.has(best.style) && ihash(c, r, s + 31) < 0.6) {
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => waterField(x + dc * cell, y + dr * cell, p) > 0);
      if (wet) best = { style: 'docks', density: 0.4, district: best.district };
    }
    // Parks: occasional green blocks inside the city.
    if (!OPEN_COUNTRY.has(best.style) && ihash(c, r, s + 77) < 0.07) best = { style: 'park', density: 0.2, district: best.district };
  }
  z = { c, r, x: c * cell + road / 2, y: r * cell + road / 2, w: inner, h: inner, style: best.style, density: best.density, district: best.district };
  p.zones.set(key, z);
  return z;
}

const isHwRow = (r, p = CUR) => mod(r - p.hwRow, 8) === 0;
const isHwCol = (c, p = CUR) => mod(c - p.hwCol, 8) === 0;
const isMetroRow = (r, p = CUR) => mod(r - p.metroRow, 9) === 0 && !isHwRow(r, p);

// The road along the top edge (horiz) or left edge of cell (c, r): null, or how it crosses
// water: 'road' (dry), 'bridge' (short road bridge), 'deck' (highway on a suspension bridge).
function edgeFor(c, r, horiz, p = CUR) {
  const key = ((c + 32768) * 65536 + r + 32768) * 2 + (horiz ? 1 : 0);
  let e = p.edges.get(key);
  if (e !== undefined) return e;
  if (p.edges.size > 120000) p.edges.clear();
  const hw = horiz ? isHwRow(r, p) : isHwCol(c, p);
  const u1 = urbanStyle(zoneFor(c, r, p).style);
  const u2 = urbanStyle((horiz ? zoneFor(c, r - 1, p) : zoneFor(c - 1, r, p)).style);
  e = null;
  if (hw || u1 || u2) {
    const wet = [];
    for (let t = 0; t <= cell; t += 24) {
      const x = horiz ? c * cell + t : c * cell;
      const y = horiz ? r * cell : r * cell + t;
      if (waterField(x, y, p) > 0) wet.push(t);
    }
    const kind = !wet.length ? 'road' : hw ? 'deck' : wet.length <= 14 ? 'bridge' : null;
    if (kind) e = { kind, hw, urban: u1 || u2, wet, horiz, x0: c * cell, y0: r * cell, x1: horiz ? (c + 1) * cell : c * cell, y1: horiz ? r * cell : (r + 1) * cell };
  }
  p.edges.set(key, e);
  return e;
}

// ---------------------------------------------------------------- per-cell generation
const dimsCache = new Map();
function dimsOf(id, variant) {
  const key = `${id}:${variant}`;
  let d = dimsCache.get(key);
  if (!d) dimsCache.set(key, (d = buildingDims(id, variant)));
  return d;
}

const poolCache = new Map();
function weightsFor(zoneKeys, tier, fit) {
  const key = `${zoneKeys.join()}|${tier}|${fit}`;
  let w = poolCache.get(key);
  if (w) return w;
  w = {};
  for (const t of BUILDING_TYPES) {
    if (!(t.weight > 0) || !t.zones.some((z) => zoneKeys.includes(z))) continue;
    const tierFit = fit
      ? t.tier === tier ? 1 : t.tier === tier - 1 ? 0.35 : t.tier === tier + 1 ? 0.12 : 0.02
      : t.tier === tier ? 1 : Math.abs(t.tier - tier) === 1 ? 0.25 : 0.03;
    w[t.id] = t.weight * tierFit;
  }
  poolCache.set(key, w);
  return w;
}

function generateChunk(world, c, r) {
  const p = world.p;
  const rng = createRng(Math.floor(ihash(c, r, p.s + 5) * 4294967296));
  const zc = zoneFor(c, r, p);
  const chunk = { c, r, key: world.key(c, r), zone: zc, objects: [], roads: [], lights: [], decals: [], powerLines: [], bridges: [], metro: [], loaded: true };
  const { objects, lights, decals, powerLines } = chunk;
  let li = 0;
  const lean = world.detail >= 1;
  const sp = p.spawn;
  const nearSpawn = Math.abs(c) <= 1 && Math.abs(r) <= 1;
  const metroLines = [isMetroRow(r, p) ? r * cell : null, isMetroRow(r + 1, p) ? (r + 1) * cell : null].filter((v) => v !== null);
  const uniquePlaced = new Set();
  const allowUnique = ihash(c, r, p.s + 41) < 0.12;
  const uniqueOk = (id) => !TYPE_BY_ID[id].unique || (allowUnique && !uniquePlaced.has(id));

  // Every add takes a local index, even when skipped, so saved destruction lines up on reload.
  const add = (o) => {
    o.li = li++;
    o.state = 'intact';
    o.flash = 0;
    o.chunk = chunk;
    if (nearSpawn && o.tier >= 2 && Math.abs(o.x - sp.x) < 12 + o.w / 2 && Math.abs(o.y - sp.y) < 12 + o.h / 2) o.skip = true;
    if (!o.skip) {
      o.id = world.nextId++;
      objects.push(o);
    }
    return o;
  };

  const addBuilding = (typeId, x, y, rot, variant = rng.int(0, VARIANTS - 1)) => {
    const t = TYPE_BY_ID[typeId];
    const d = dimsOf(typeId, variant);
    const swap = rot % 2 === 1;
    const hp = t.landmark ? LANDMARK_HP : TIER_HP[t.tier];
    return add({
      kind: 'building', type: typeId, variant, rot, tier: t.tier, x, y,
      w: swap ? d.h : d.w, h: swap ? d.w : d.h, height: d.height,
      hp, maxHp: hp, structure: true, walkable: Boolean(t.walkable), landmark: Boolean(t.landmark),
      power: Boolean(t.power), value: 1, style: t.style,
    });
  };

  const addProp = (id, x, y, rot = 0, variant = rng.int(0, 2)) => {
    const pt = PROP_BY_ID[id];
    const d = propDims(id);
    const swap = rot % 2 === 1;
    const o = {
      kind: 'prop', type: id, variant, rot, tier: pt.tier, x, y,
      w: swap ? d.h : d.w, h: swap ? d.w : d.h, height: d.height,
      hp: TIER_HP[pt.tier], maxHp: TIER_HP[pt.tier], structure: false, vehicle: Boolean(pt.vehicle), value: pt.value,
    };
    // Big kaiju never see pocket-sized clutter, so cells generated late leave it out; and
    // nothing stands under the elevated metro.
    if ((lean && pt.tier === 1) || (id !== 'metro_entrance' && metroLines.some((ly) => Math.abs(y - ly) < 14 + o.h / 2))) o.skip = true;
    add(o);
    if (pt.light && !o.skip) lights.push({ x, y, w: 0, h: 0, height: pt.light.h, color: pt.light.color, obj: o, flicker: pt.light.flicker });
    return o;
  };

  const water = (x, y) => waterField(x, y, p) > 0;
  const footprintDry = (x, y, w, h) => !water(x, y) && !water(x - w / 2, y - h / 2) && !water(x + w / 2, y - h / 2) && !water(x - w / 2, y + h / 2) && !water(x + w / 2, y + h / 2);

  const pickBuilding = (zoneKeys, tier, maxW, maxH, rot) => {
    const weights = weightsFor(zoneKeys, tier, false);
    if (!Object.keys(weights).length) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = rng.weighted(weights);
      const variant = rng.int(0, VARIANTS - 1);
      const d = dimsOf(id, variant);
      const w = rot % 2 ? d.h : d.w;
      const h = rot % 2 ? d.w : d.h;
      if (w <= maxW && h <= maxH && uniqueOk(id)) return { id, variant };
    }
    return null;
  };

  const pickFit = (zoneKeys, tier, maxFront, maxDepth) => {
    const weights = weightsFor(zoneKeys, tier, true);
    if (!Object.keys(weights).length) return null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = rng.weighted(weights);
      const variant = rng.int(0, VARIANTS - 1);
      const d = dimsOf(id, variant);
      if (d.w <= maxFront && d.h <= maxDepth && uniqueOk(id)) return { id, variant, d };
    }
    return null;
  };

  const roadAt = (cc, rr, horiz) => edgeFor(cc, rr, horiz, p);
  const top = roadAt(c, r, true);
  const bottom = roadAt(c, r + 1, true);
  const left = roadAt(c, r, false);
  const right = roadAt(c + 1, r, false);

  function streetDressing() {
    const { x, y, w, style } = zc;
    const isUrban = style !== 'forest' && style !== 'park';
    const edges = [
      { has: Boolean(top), horiz: true, at: y - 8, out: -1 },
      { has: Boolean(bottom), horiz: true, at: y + w + 8, out: 1 },
      { has: Boolean(left), horiz: false, at: x - 8, out: -1 },
      { has: Boolean(right), horiz: false, at: x + w + 8, out: 1 },
    ];
    const country = style === 'farm' || style === 'desert' || style === 'snow';
    const lampType = style === 'neon' ? 'neon_lamp' : style === 'lantern' ? 'lantern_post' : 'lamppost';
    for (const e of edges) {
      if (!e.has) continue;
      for (let t = 30; t < w; t += isUrban && !country ? 70 : 140) {
        const px = e.horiz ? x + t : e.at;
        const py = e.horiz ? e.at : y + t;
        if (!water(px, py)) addProp(lampType, px, py, e.horiz ? (e.out > 0 ? 2 : 0) : e.out > 0 ? 1 : 3);
      }
      if (!isUrban) continue;
      const lane = e.at + e.out * 14;
      for (let t = 20; t < w - 20; t += rng.int(18, 40)) {
        if (!rng.chance(style === 'brick' ? 0.45 : country ? 0.15 : 0.35)) continue;
        const id = rng.weighted(TRAFFIC[style] || { car: 5, hatchback: 3, taxi: style === 'neon' ? 3 : 0.5, van: 2, pickup: style === 'suburb' ? 2 : 0.5, scooter: style === 'pastel' || style === 'neon' || style === 'lantern' ? 2 : 0.3, bus: 0.2, truck: style === 'brick' ? 0.6 : 0.1 });
        const px = e.horiz ? x + t : lane;
        const py = e.horiz ? lane : y + t;
        if (!water(px, py)) addProp(id, px, py, e.horiz ? (rng.chance(0.5) ? 0 : 2) : rng.chance(0.5) ? 1 : 3);
      }
      const furniture = {
        neon: { vending: 3, neon_pole: 2, food_cart: 2, trash_can: 2, bench: 1, newspaper_box: 1, phone_booth: 1, bus_stop: 0.5, planter_tree: 2, bike_rack: 1, newsstand: 0.8, bollard: 1.5, parking_meter: 1, cafe_table: 1, recycling: 0.6 },
        brick: { trash_can: 2, dumpster: 2, barrier: 3, drums: 2, crates: 2, hydrant: 1, cone: 2, bike_rack: 1, parking_meter: 1, recycling: 1, newspaper_box: 0.5 },
        pastel: { bench: 2, planter: 3, food_cart: 1, tree_blossom: 2, palm: 2, flower_bed: 2, mailbox: 1, cafe_table: 3, bike_rack: 1, ice_cream_cart: 0.8, bollard: 1 },
        garden: { tree_round: 3, bench: 2, planter: 2, bus_stop: 1, hydrant: 1, trash_can: 1, newspaper_box: 1, cafe_table: 2, bike_rack: 1.5, planter_tree: 1.5, parking_meter: 1, newsstand: 0.5 },
        docks: { container: 3, crates: 2, drums: 2, barrier: 1 },
        farm: { hay: 3, mailbox: 1, tree_round: 2, bush: 2, scarecrow: 0.6 },
        desert: { cactus: 4, desert_rock: 2, tumbleweed: 2, mailbox: 0.5 },
        snow: { tree_snow: 4, snowman: 2, mailbox: 1, bench: 0.5 },
        lantern: { lantern_post: 3, stone_lion: 1, food_cart: 2, vending: 1, planter: 1, bike_rack: 1, tree_blossom: 1 },
        fair: { balloon_cart: 3, food_cart: 2, ice_cream_cart: 2, bench: 2, trash_can: 1 },
      }[style] || { hydrant: 1, trash_can: 1, tree_round: 2, mailbox: 1, bench: 1 };
      for (let t = 50; t < w - 20; t += country ? rng.int(45, 90) : rng.int(25, 55)) {
        const px = e.horiz ? x + t : e.at + rng.range(-3, 3);
        const py = e.horiz ? e.at + rng.range(-3, 3) : y + t;
        if (!water(px, py)) addProp(rng.weighted(furniture), px, py, e.horiz ? 0 : 1);
      }
    }
    if (isUrban && (style === 'neon' || style === 'garden' || style === 'brick') && top && left) addProp('traffic_light', x - 14, y - 14);
    if (isUrban && top && right) addProp('street_sign', x + w + 12, y - 12);
    if (style === 'brick' || style === 'suburb' || style === 'farm' || style === 'desert') {
      for (const e of edges) {
        if (!e.has || !rng.chance(0.7)) continue;
        const chain = [];
        for (let t = 12; t < w; t += 62) {
          const px = e.horiz ? x + t : e.at + e.out * -3;
          const py = e.horiz ? e.at + e.out * -3 : y + t;
          if (!water(px, py)) {
            const pole = addProp('power_pole', px, py, e.horiz ? 0 : 1);
            if (!pole.skip) chain.push(pole);
          }
        }
        if (chain.length > 1) powerLines.push(chain);
      }
    }
    if (isUrban && !country && top) for (let t = 70; t < w; t += 140) decals.push({ kind: 'manhole', x: x + t, y: y - 30 - 8 * (t % 2 ? 1 : -1), w: 6, h: 6 });
  }

  function fillUrban() {
    const { x, y, w, style, density } = zc;
    let zoneKeys = [style];
    let tier = 3;
    if (style === 'neon' || style === 'brick') {
      tier = density > 0.7 ? 5 : density > 0.42 ? 4 : 3;
      if (density > 0.7) zoneKeys = ['downtown', style];
    } else if (style === 'garden') {
      tier = density > 0.55 ? 4 : 3;
      zoneKeys = ['garden', 'commercial'];
    } else if (style === 'pastel') {
      tier = density > 0.45 ? 4 : 3;
    } else if (style === 'docks') {
      zoneKeys = ['docks'];
    } else if (style === 'lantern') {
      tier = density > 0.62 ? 5 : density > 0.4 ? 4 : 3;
    } else if (style === 'desert') {
      tier = density > 0.5 ? 4 : 3;
    }
    packRect(x, y, w, w, style, zoneKeys, tier, 0);
  }

  // Street-frontage packing: buildings line every street edge shoulder to shoulder.
  function packRect(x, y, w, h, style, zoneKeys, tier, depth) {
    const setback = depth === 0 ? 5 : 3;
    const maxDepth = Math.min(w, h) * 0.42;
    const placeRow = (sx, sy, dx, dy, nx, ny, len, rot) => {
      let deepest = 0;
      let cursor = 4;
      while (cursor < len - 14) {
        const remaining = len - cursor - 4;
        const slotTier = rng.chance(0.25) ? Math.max(3, tier - 1) : tier;
        const pick = pickFit(zoneKeys, slotTier, remaining, maxDepth) || pickFit(zoneKeys, 3, remaining, maxDepth);
        if (!pick) {
          if (remaining > 8) addProp(style === 'brick' ? 'dumpster' : style === 'neon' ? 'vending' : 'tree_round', sx + dx * (cursor + 5) + nx * 8, sy + dy * (cursor + 5) + ny * 8, rot);
          break;
        }
        const along = cursor + pick.d.w / 2;
        const bx = sx + dx * along + nx * (setback + pick.d.h / 2);
        const by = sy + dy * along + ny * (setback + pick.d.h / 2);
        const fw = rot % 2 ? pick.d.h : pick.d.w;
        const fh = rot % 2 ? pick.d.w : pick.d.h;
        if (footprintDry(bx, by, fw, fh)) {
          if (TYPE_BY_ID[pick.id].unique) uniquePlaced.add(pick.id);
          addBuilding(pick.id, bx, by, rot, pick.variant);
          deepest = Math.max(deepest, pick.d.h);
        }
        cursor += pick.d.w + rng.int(2, 6);
      }
      return deepest + setback;
    };
    const topD = placeRow(x, y, 1, 0, 0, 1, w, 2);
    const botD = placeRow(x, y + h, 1, 0, 0, -1, w, 0);
    const inner0 = y + topD + 4;
    const inner1 = y + h - botD - 4;
    const leftD = placeRow(x, inner0, 0, 1, 1, 0, inner1 - inner0, 3);
    const rightD = placeRow(x + w, inner0, 0, 1, -1, 0, inner1 - inner0, 1);
    const cx0 = x + leftD + 4;
    const cx1 = x + w - rightD - 4;
    if (depth === 0 && cx1 - cx0 > 90 && inner1 - inner0 > 90) packRect(cx0 + 6, inner0 + 6, cx1 - cx0 - 12, inner1 - inner0 - 12, style, zoneKeys, Math.max(3, tier - 1), 1);
    else courtyard(cx0, inner0, cx1, inner1, style, zoneKeys, tier);
  }

  // Whatever is left inside a block: a small building, a parking lot or a garden.
  function courtyard(x0, y0, x1, y1, style, zoneKeys, tier) {
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 24 || ch < 24) return;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const small = cw > 50 && ch > 50 ? pickFit(zoneKeys, Math.max(3, tier - 1), cw - 10, ch - 10) : null;
    if (small && rng.chance(0.6) && footprintDry(cx, cy, small.d.w, small.d.h)) {
      addBuilding(small.id, cx, cy, rng.chance(0.5) ? 0 : 2, small.variant);
      return;
    }
    if (style === 'brick' || style === 'docks' || style === 'neon' || (style !== 'desert' && rng.chance(0.4))) {
      if (style !== 'docks') decals.push({ kind: 'parking', x: cx, y: cy, w: cw, h: ch });
      for (let px = x0 + 8; px < x1 - 6; px += 9) {
        for (let py = y0 + 8; py < y1 - 6; py += 16) {
          if (rng.chance(0.65)) addProp(style === 'docks' ? 'container' : rng.pick(['car', 'hatchback', 'van', 'taxi', 'pickup']), px, py, 1);
        }
      }
      return;
    }
    const yard = COURTYARD[style] || { tree_round: 3, tree_blossom: style === 'pastel' ? 3 : 1, palm: style === 'pastel' ? 2 : 0, bench: 2, flower_bed: 2, planter: 2, picnic_table: 1 };
    for (let i = 0; i < Math.min(14, Math.floor((cw * ch) / 500)); i++) {
      addProp(rng.weighted(yard), rng.range(x0 + 6, x1 - 6), rng.range(y0 + 6, y1 - 6), rng.int(0, 3));
    }
  }

  function fillSuburb() {
    const { x, y, w } = zc;
    const lots = 3;
    const lot = w / lots;
    for (let i = 0; i < lots; i++) {
      for (let j = 0; j < lots; j++) {
        const lx = x + i * lot;
        const ly = y + j * lot;
        const rot = j === lots - 1 ? 0 : j === 0 ? 2 : i === 0 ? 3 : i === lots - 1 ? 1 : 0;
        const pick = pickBuilding(['suburb'], 3, lot * 0.55, lot * 0.45, rot);
        if (!pick) continue;
        const d = dimsOf(pick.id, pick.variant);
        const bw = rot % 2 ? d.h : d.w;
        const bh = rot % 2 ? d.w : d.h;
        const fx = rot === 1 ? 1 : rot === 3 ? -1 : 0;
        const fy = rot === 0 ? 1 : rot === 2 ? -1 : 0;
        const hx = lx + lot / 2 + fx * (lot / 2 - bw / 2 - 10);
        const hy = ly + lot / 2 + fy * (lot / 2 - bh / 2 - 10);
        if (!footprintDry(hx, hy, bw, bh)) continue;
        addBuilding(pick.id, hx, hy, rot, pick.variant);
        if (rng.chance(0.6)) addProp(rng.pick(['car', 'hatchback', 'pickup', 'van']), hx + (fx ? 0 : bw / 2 + 9), hy + (fy ? 0 : bh / 2 + 9), fx ? 0 : 1);
        backyard(lx, ly, lot, -fx, -fy, hx, hy, bw, bh);
      }
    }
  }

  // Backyard: a fenced patch behind the house with sheds, swings, pools and garden clutter.
  function backyard(lx, ly, lot, bx, by, hx, hy, hw, hh) {
    const yx0 = bx > 0 ? hx + hw / 2 + 4 : lx + 4;
    const yx1 = bx < 0 ? hx - hw / 2 - 4 : lx + lot - 4;
    const yy0 = by > 0 ? hy + hh / 2 + 4 : ly + 4;
    const yy1 = by < 0 ? hy - hh / 2 - 4 : ly + lot - 4;
    if (yx1 - yx0 < 20 || yy1 - yy0 < 20) return;
    const fenceLen = propDims('fence').w;
    for (let fx = yx0; fx < yx1 - fenceLen / 2; fx += fenceLen) {
      if (by >= 0) addProp('fence', fx + fenceLen / 2, yy1, 0);
      if (by <= 0) addProp('fence', fx + fenceLen / 2, yy0, 0);
    }
    for (let fy = yy0; fy < yy1 - fenceLen / 2; fy += fenceLen) {
      if (bx >= 0) addProp('fence', yx1, fy + fenceLen / 2, 1);
      if (bx <= 0) addProp('fence', yx0, fy + fenceLen / 2, 1);
    }
    const spot = () => ({ x: rng.range(yx0 + 6, yx1 - 6), y: rng.range(yy0 + 6, yy1 - 6) });
    if (rng.chance(0.75)) {
      const shed = rng.chance(0.8) ? 'garden_shed' : rng.chance(0.5) ? 'playhouse' : 'carport';
      const sx = rng.chance(0.5) ? yx0 + 9 : yx1 - 9;
      const sy = rng.chance(0.5) ? yy0 + 8 : yy1 - 8;
      const rot = rng.int(0, 3);
      if (footprintDry(sx, sy, 16, 16)) addBuilding(shed, sx, sy, rot);
    }
    const items = { tree_round: 2, tree_autumn: 1, swing_set: 1, trampoline: 1, pool: 0.8, hot_tub: 0.5, bbq: 1.5, doghouse: 1, picnic_table: 1, lawn_chair: 2, gnome: 1.5, flower_bed: 2, bush: 2, bike: 1 };
    const n = rng.int(4, 8);
    for (let i = 0; i < n; i++) {
      const s = spot();
      addProp(rng.weighted(items), s.x, s.y, rng.int(0, 3));
    }
  }

  // Parks: crossing paths, a centrepiece, a pond, a playground, a sports court, trees.
  function fillPark() {
    const { x, y, w } = zc;
    const cx = x + w / 2;
    const cy = y + w / 2;
    decals.push({ kind: 'path', x: cx, y: cy, w, h: 12 });
    decals.push({ kind: 'path', x: cx, y: cy, w: 12, h: w });
    decals.push({ kind: 'plaza', x: cx, y: cy, w: 56, h: 56 });
    addProp(rng.chance(0.6) ? 'fountain' : 'statue', cx, cy);
    const quads = rng.shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]]);
    const q = (i) => ({ x: cx + quads[i][0] * w * 0.27, y: cy + quads[i][1] * w * 0.27 });
    const pond = q(0);
    decals.push({ kind: 'pond', x: pond.x, y: pond.y, w: 90, h: 70 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      addProp(k % 2 ? 'bush' : 'tree_birch', pond.x + Math.cos(a) * 56, pond.y + Math.sin(a) * 46, rng.int(0, 3));
    }
    const pg = q(1);
    decals.push({ kind: 'sandbox', x: pg.x, y: pg.y, w: 60, h: 50 });
    addProp('slide', pg.x - 14, pg.y - 10, 0);
    addProp('climber', pg.x + 12, pg.y - 8);
    addProp('swing_set', pg.x - 8, pg.y + 12, 0);
    addProp('seesaw', pg.x + 16, pg.y + 14, 0);
    addProp('bench', pg.x, pg.y + 30, 0);
    const ct = q(2);
    if (rng.chance(0.5)) {
      decals.push({ kind: 'basketball', x: ct.x, y: ct.y, w: 56, h: 32 });
      addProp('hoop', ct.x - 27, ct.y, 0);
      addProp('hoop', ct.x + 27, ct.y, 2);
    } else {
      decals.push({ kind: 'tennis', x: ct.x, y: ct.y, w: 60, h: 30 });
      addProp('tennis_net', ct.x, ct.y, 0);
    }
    const gz = q(3);
    addProp('gazebo', gz.x, gz.y);
    addProp('picnic_table', gz.x + 22, gz.y + 10, 0);
    addProp('picnic_table', gz.x - 20, gz.y + 14, 0);
    for (let t = 30; t < w - 20; t += 36) {
      addProp('lamppost', x + t, cy - 10, 0);
      addProp('lamppost', cx + 10, y + t, 1);
      if (Math.abs(x + t - cx) > 40) addProp('bench', x + t + 10, cy + 10, 0);
    }
    for (let i = 0; i < 26; i++) {
      const px = x + rng.range(8, w - 8);
      const py = y + rng.range(8, w - 8);
      if (Math.abs(px - cx) < 14 || Math.abs(py - cy) < 14 || water(px, py)) continue;
      if ([0, 1, 2, 3].some((k) => Math.hypot(px - q(k).x, py - q(k).y) < 50)) continue;
      addProp(rng.weighted({ tree_round: 4, tree_blossom: 2, tree_birch: 2, tree_autumn: 1, bush: 3, flower_bed: 2 }), px, py, rng.int(0, 3));
    }
  }

  // Plazas: a paved square with tree rows, flower beds, a centrepiece, a big screen,
  // food trucks and cafe seating.
  function fillPlaza() {
    const { x, y, w, style } = zc;
    const cx = x + w / 2;
    const cy = y + w / 2;
    decals.push({ kind: 'plaza', x: cx, y: cy, w: w - 10, h: w - 10 });
    addProp(rng.chance(0.5) ? 'statue' : 'fountain', cx, cy);
    let topY = y + 20;
    if (allowUnique && style !== 'neon') {
      uniquePlaced.add('city_hall');
      const d = dimsOf('city_hall', 0);
      addBuilding('city_hall', cx, y + d.h / 2 + 8, 0, 0);
      topY = y + d.h + 24;
    } else {
      addProp('big_screen', cx, y + 30, 0);
      topY = y + 50;
    }
    for (let ty = topY; ty < y + w - 40; ty += 32) {
      for (const dx of [-110, -70, 70, 110]) addProp('planter_tree', cx + dx, ty);
      addProp('bench', cx - 90, ty + 16, 1);
      addProp('bench', cx + 90, ty + 16, 1);
      addProp('lamppost', cx - 40, ty, 0);
      addProp('lamppost', cx + 40, ty, 2);
    }
    for (let a = 0; a < 8; a++) addProp('flower_bed', cx + Math.cos((a / 8) * Math.PI * 2) * 26, cy + Math.sin((a / 8) * Math.PI * 2) * 26, a % 2);
    for (let i = 0; i < 8; i++) addProp('cafe_table', x + 30 + (i % 4) * 14, y + w - 70 + Math.floor(i / 4) * 14, 0);
    for (let i = 0; i < 3; i++) addProp('food_truck', x + w - 150 + i * 46, y + w - 28, 0);
    addProp('ice_cream_cart', cx, y + w - 60, 0);
    for (const side of [-1, 1]) {
      for (let ty = topY; ty < y + w - 40; ty += 28) addProp(rng.weighted({ tree_round: 2, tree_blossom: style === 'pastel' ? 2 : 0.5, bush: 1 }), cx + side * (w / 2 - 22), ty, rng.int(0, 3));
    }
    addProp('flagpole', cx - 22, topY - 6);
    addProp('flagpole', cx + 22, topY - 6);
    if (style === 'neon') for (let i = 0; i < 6; i++) addProp('neon_pole', cx + rng.range(-150, 150), cy + rng.range(-150, 150));
  }

  // Farmland: a farmstead in one corner (house, barn, silos, a windmill or water tower), crop
  // fields over the rest, sometimes a fenced pasture of cows.
  function fillFarm() {
    const { x, y, w } = zc;
    const qx = rng.int(0, 1);
    const qy = rng.int(0, 1);
    const half = w / 2;
    // The farmstead takes quadrant (qx, qy). The other half (top or bottom) is one big field; the
    // quadrant beside the farmstead is a field or a pasture.
    const far = { x: x + half, y: qy ? y + half * 0.5 : y + half * 1.5, w: w - 16, h: half - 16 };
    const side = { x: qx ? x + half * 0.5 : x + half * 1.5, y: qy ? y + half * 1.5 : y + half * 0.5, w: half - 16, h: half - 16 };
    const crop = () => ({ kind: 'crops', crop: rng.int(0, 3), along: rng.chance(0.5) });
    decals.push({ ...crop(), x: far.x, y: far.y, w: far.w, h: far.h });
    if (rng.chance(0.65)) addProp('scarecrow', far.x + rng.range(-60, 60), far.y + rng.range(-30, 30), rng.int(0, 3));
    if (rng.chance(0.5)) addProp('tractor', far.x + rng.range(-120, 120), far.y + rng.range(-40, 40), rng.int(0, 3));
    if (rng.chance(0.35)) {
      // Pasture: fence all round, cows inside.
      const fenceLen = propDims('fence').w;
      const px0 = side.x - side.w / 2;
      const py0 = side.y - side.h / 2;
      for (let t = fenceLen / 2; t < side.w; t += fenceLen) {
        addProp('fence', px0 + t, py0, 0);
        addProp('fence', px0 + t, py0 + side.h, 0);
      }
      for (let t = fenceLen / 2; t < side.h; t += fenceLen) {
        addProp('fence', px0, py0 + t, 1);
        addProp('fence', px0 + side.w, py0 + t, 1);
      }
      for (let i = rng.int(3, 7); i > 0; i--) addProp('cow', side.x + rng.range(-side.w / 2 + 12, side.w / 2 - 12), side.y + rng.range(-side.h / 2 + 12, side.h / 2 - 12), rng.int(0, 3));
      addProp('tree_round', side.x + rng.range(-40, 40), side.y + rng.range(-40, 40), rng.int(0, 3));
    } else {
      decals.push({ ...crop(), x: side.x, y: side.y, w: side.w, h: side.h });
      for (let i = rng.int(2, 5); i > 0; i--) addProp('hay', side.x + rng.range(-side.w / 2 + 10, side.w / 2 - 10), side.y + rng.range(-side.h / 2 + 10, side.h / 2 - 10), rng.int(0, 3));
    }
    // The farmstead: buildings on a 3x3 grid of yard slots, the house nearest the corner road.
    const yard = [qx ? 0 : 2, qy ? 0 : 2];
    const slots = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) slots.push({ i, j, d: Math.abs(i - yard[0]) + Math.abs(j - yard[1]) });
    slots.sort((a, b) => a.d - b.d || rng.next() - 0.5);
    const list = ['farmhouse', 'barn', 'silo', rng.chance(0.5) ? 'windmill' : 'water_tower', rng.chance(0.6) ? 'silo' : 'greenhouse', rng.chance(0.4) ? 'greenhouse' : null];
    const sx0 = qx ? x + half + 6 : x + 6;
    const sy0 = qy ? y + half + 6 : y + 6;
    const gap = (half - 12) / 3;
    let k = 0;
    for (const id of list) {
      const slot = slots[k++];
      if (!id || !slot) continue;
      const cx = sx0 + gap * (slot.i + 0.5);
      const cy = sy0 + gap * (slot.j + 0.5);
      const variant = rng.int(0, VARIANTS - 1);
      const d = dimsOf(id, variant);
      const rot = id === 'farmhouse' ? (qy ? 0 : 2) : rng.chance(0.5) ? 0 : 2;
      if (d.w > gap * 1.15 || d.h > gap * 1.15 || !footprintDry(cx, cy, d.w, d.h)) continue;
      addBuilding(id, cx, cy, rot, variant);
    }
    for (const slot of slots.slice(k)) {
      const cx = sx0 + gap * (slot.i + 0.5);
      const cy = sy0 + gap * (slot.j + 0.5);
      addProp(rng.weighted({ hay: 3, tractor: 1, tree_round: 2, pickup: 1, cow: 1 }), cx + rng.range(-12, 12), cy + rng.range(-12, 12), rng.int(0, 3));
    }
    // A windbreak of trees along the far edge.
    for (let t = 16; t < w; t += rng.int(22, 40)) addProp(rng.chance(0.7) ? 'tree_round' : 'tree_pine', x + t, qy ? y + 6 : y + w - 6, rng.int(0, 3));
  }

  // A snowy alpine village: chalets on big lots under snow-laden pines, sometimes a frozen pond
  // to skate on in the middle.
  function fillSnow() {
    const { x, y, w, density } = zc;
    const lots = 3;
    const lot = w / lots;
    const rink = rng.chance(0.3);
    for (let i = 0; i < lots; i++) {
      for (let j = 0; j < lots; j++) {
        const lx = x + i * lot;
        const ly = y + j * lot;
        if (rink && i === 1 && j === 1) {
          decals.push({ kind: 'rink', x: lx + lot / 2, y: ly + lot / 2, w: lot - 24, h: lot - 40 });
          for (let s = 0; s < 4; s++) addProp('snowman', lx + 14 + s * ((lot - 28) / 3), ly + 10, 0);
          continue;
        }
        const rot = j === lots - 1 ? 0 : j === 0 ? 2 : i === 0 ? 3 : i === lots - 1 ? 1 : 0;
        const pick = pickBuilding(['snow'], density > 0.4 && rng.chance(0.4) ? 4 : 3, lot * 0.6, lot * 0.5, rot);
        if (pick) {
          const d = dimsOf(pick.id, pick.variant);
          const bw = rot % 2 ? d.h : d.w;
          const bh = rot % 2 ? d.w : d.h;
          const fx = rot === 1 ? 1 : rot === 3 ? -1 : 0;
          const fy = rot === 0 ? 1 : rot === 2 ? -1 : 0;
          const hx = lx + lot / 2 + fx * (lot / 2 - bw / 2 - 12);
          const hy = ly + lot / 2 + fy * (lot / 2 - bh / 2 - 12);
          if (footprintDry(hx, hy, bw, bh)) {
            addBuilding(pick.id, hx, hy, rot, pick.variant);
            if (rng.chance(0.5)) addProp(rng.pick(['car', 'pickup', 'van']), hx + (fx ? 0 : bw / 2 + 9), hy + (fy ? 0 : bh / 2 + 9), fx ? 0 : 1);
            if (rng.chance(0.5)) addProp('snowman', hx - fx * (bw / 2 + 14) + rng.range(-10, 10), hy - fy * (bh / 2 + 14) + rng.range(-10, 10), rng.int(0, 3));
          }
        }
        for (let t = rng.int(2, 4); t > 0; t--) {
          const px = lx + rng.range(10, lot - 10);
          const py = ly + rng.range(10, lot - 10);
          if (Math.abs(px - lx - lot / 2) < 30 && Math.abs(py - ly - lot / 2) < 30) continue;
          addProp('tree_snow', px, py, rng.int(0, 3));
        }
      }
    }
  }

  // The fairground: paths crossing at a ticket plaza, a big ride in one corner (Ferris wheel,
  // roller coaster or big top), a carousel, booths, carts and food trucks.
  function fillFair() {
    const { x, y, w } = zc;
    const cx = x + w / 2;
    const cy = y + w / 2;
    decals.push({ kind: 'path', x: cx, y: cy, w, h: 16 });
    decals.push({ kind: 'path', x: cx, y: cy, w: 16, h: w });
    decals.push({ kind: 'plaza', x: cx, y: cy, w: 44, h: 44 });
    addProp('ticket_booth', cx - 30, cy - 30, 0);
    addProp('ticket_booth', cx + 30, cy + 30, 2);
    const quads = rng.shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]]);
    const q = (i) => ({ x: cx + quads[i][0] * w * 0.26, y: cy + quads[i][1] * w * 0.26 });
    const big = rng.pick(['ferris_wheel', 'ferris_wheel', 'coaster', 'circus_tent']);
    const second = big === 'circus_tent' ? rng.pick(['ferris_wheel', 'coaster']) : 'circus_tent';
    for (const [i, id] of [[0, big], [1, second], [2, 'carousel']]) {
      const at = q(i);
      const d = dimsOf(id, 0);
      if (footprintDry(at.x, at.y, d.w, d.h)) addBuilding(id, at.x, at.y, rng.chance(0.5) ? 0 : 2, 0);
    }
    const food = q(3);
    for (let i = 0; i < 3; i++) addProp('food_truck', food.x - 44 + i * 44, food.y - 30, 0);
    for (let i = 0; i < 6; i++) addProp('cafe_table', food.x - 36 + (i % 3) * 30, food.y + 6 + Math.floor(i / 3) * 18, 0);
    addProp('ice_cream_cart', food.x + 50, food.y + 34, 0);
    for (let t = 24; t < w - 20; t += 40) {
      if (Math.abs(x + t - cx) > 30) {
        addProp('lamppost', x + t, cy - 14, 0);
        if (rng.chance(0.5)) addProp(rng.pick(['balloon_cart', 'food_cart', 'bench']), x + t + 14, cy + 14, 0);
      }
      if (Math.abs(y + t - cy) > 30) addProp('lamppost', cx + 14, y + t, 1);
    }
    for (let i = 0; i < 10; i++) {
      const px = x + rng.range(10, w - 10);
      const py = y + rng.range(10, w - 10);
      if (Math.abs(px - cx) < 20 || Math.abs(py - cy) < 20) continue;
      if ([0, 1, 2, 3].some((k) => Math.hypot(px - q(k).x, py - q(k).y) < 70)) continue;
      addProp(rng.weighted({ balloon_cart: 2, tree_round: 2, bench: 1, trash_can: 1 }), px, py, rng.int(0, 3));
    }
  }

  function fillForest() {
    const { x, y, w } = zc;
    const clearing = rng.chance(0.18);
    if (clearing) {
      const pick = pickBuilding(['forest'], rng.chance(0.85) ? 3 : rng.chance(0.7) ? 4 : 5, w * 0.5, w * 0.5, 0);
      if (pick && footprintDry(x + w / 2, y + w / 2, 80, 80)) addBuilding(pick.id, x + w / 2, y + w / 2, rng.int(0, 3), pick.variant);
      addProp('campfire', x + w / 2 + 40, y + w / 2 + 30);
      addProp('tent', x + w / 2 + 55, y + w / 2 + 50, rng.int(0, 3));
      addProp('log', x + w / 2 + 30, y + w / 2 + 45, 1);
    }
    const n = clearing ? 26 : 46;
    for (let i = 0; i < n; i++) {
      const px = x - 20 + rng.range(0, w + 40);
      const py = y - 20 + rng.range(0, w + 40);
      if (water(px, py)) continue;
      if (clearing && Math.hypot(px - x - w / 2, py - y - w / 2) < 90) continue;
      addProp(rng.weighted({ tree_pine: 5, tree_pine_tall: 3, tree_round: 1.5, tree_birch: 1.5, tree_autumn: 1, bush: 2, rock: 1.2, log: 0.5, hay: 0.1 }), px, py, rng.int(0, 3));
    }
  }

  // Sand and sunshades where a quiet block meets the water.
  function beach() {
    const { x, y, w, style } = zc;
    if (!['pastel', 'park', 'suburb', 'garden', 'forest'].includes(style) || ihash(c, r, p.s + 61) > 0.6) return;
    const probe = [[0, 0], [w, 0], [0, w], [w, w], [w / 2, -40], [w / 2, w + 40], [-40, w / 2], [w + 40, w / 2]];
    if (!probe.some(([dx, dy]) => water(x + dx, y + dy))) return;
    for (let py = y + 10; py < y + w - 10; py += 30) {
      for (let px = x + 10; px < x + w - 10; px += 30) {
        const f = waterField(px, py, p);
        if (f > -8 || f < -40 || !rng.chance(0.3)) continue;
        addProp('beach_umbrella', px + rng.range(-6, 6), py + rng.range(-6, 6), 0);
        decals.push({ kind: 'towel', x: px + 10, y: py + 6, w: 6, h: 12 });
        if (rng.chance(0.08)) addProp('lifeguard_tower', px + 18, py);
      }
    }
  }

  // Waterfront landmark: a lighthouse at the end of a pier.
  function lighthouse() {
    if (zc.style !== 'docks' || ihash(c, r, p.s + 51) > 0.3) return;
    const cx = (c + 0.5) * cell;
    const cy = (r + 0.5) * cell;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const ex = cx + dx * (cell / 2 + 30);
      const ey = cy + dy * (cell / 2 + 30);
      const tip = { x: ex + dx * 240, y: ey + dy * 240 };
      if (!water(tip.x, tip.y) || !water(ex + dx * 120, ey + dy * 120)) continue;
      for (let t = 0; t <= 240; t += 50) addBuilding('road_bridge', ex + dx * t, ey + dy * t, dx ? 0 : 1, 0);
      const lh = addBuilding('lighthouse', tip.x + dx * 30, tip.y + dy * 30, 0, 0);
      if (!lh.skip) lights.push({ x: lh.x, y: lh.y, w: 0, h: 0, height: lh.height, color: 0xfff2a8, obj: lh, big: true });
      return;
    }
  }

  // The roads this cell owns (its top and left edge), with bridges where they cross water.
  function roads() {
    for (const e of [top, left]) {
      if (!e) continue;
      chunk.roads.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, horiz: e.horiz, highway: e.hw, urban: e.urban, kind: e.kind, w: e.horiz ? cell : 0, h: e.horiz ? 0 : cell, x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 });
      if (e.kind === 'bridge') {
        for (const t of e.wet) addBuilding('road_bridge', e.horiz ? e.x0 + t : e.x0, e.horiz ? e.y0 : e.y0 + t, 0, 0);
      } else if (e.kind === 'deck') {
        const dd = dimsOf('bridge_deck', 0);
        const from = e.wet[0] - 60;
        const to = e.wet[e.wet.length - 1] + 60;
        const base = e.horiz ? e.x0 : e.y0;
        const decks = [];
        for (let i = Math.ceil((base + from) / dd.w - 0.5); (i + 0.5) * dd.w <= base + to; i++) {
          const a = (i + 0.5) * dd.w;
          if (a < base || a >= base + cell) continue;
          decks.push(addBuilding('bridge_deck', e.horiz ? a : e.x0, e.horiz ? e.y0 : a, e.horiz ? 0 : 1, 0));
        }
        if (e.wet.length >= 14) {
          const mid = base + cell / 2;
          const tower = addBuilding('bridge_tower', e.horiz ? mid : e.x0, e.horiz ? e.y0 : mid, e.horiz ? 0 : 1, 0);
          const td = dimsOf('bridge_tower', 0);
          chunk.bridges.push({ horiz: e.horiz, a0: base, a1: base + cell, at: e.horiz ? e.y0 : e.x0, tower, deckHeight: (dd.by - 1) * dd.v, towerHeight: tower.height, half: td.h / 2 - 6 });
        }
        for (let t = 0; t < cell; t += 140) {
          for (const side of [-50, 50]) {
            const lx = e.horiz ? e.x0 + t : e.x0 + side;
            const ly = e.horiz ? e.y0 + side : e.y0 + t;
            if (water(lx, ly)) lights.push({ x: lx, y: ly, w: 0, h: 0, height: 60, color: 0xffd38a });
          }
        }
      }
    }
  }

  // Elevated metro along the top edge of metro rows: one 40-unit span at a time.
  function metro() {
    if (!isMetroRow(r, p)) return;
    const tr = dimsOf('metro_track', 0);
    const y = r * cell;
    for (let i = Math.ceil((c * cell) / tr.w - 0.5); (i + 0.5) * tr.w < (c + 1) * cell; i++) {
      const px = (i + 0.5) * tr.w;
      if (px < c * cell) continue;
      const station = mod(i, 18) === 9;
      const seg = addBuilding(station ? 'metro_station' : 'metro_track', px, y, 0, 0);
      seg.metroRow = r;
      seg.metroI = i;
      if (!seg.skip) chunk.metro.push(seg);
      if (station && !water(px, y + 30)) addProp('metro_entrance', px, y + 30, 0);
    }
  }

  function boats() {
    if (zc.style !== 'water') return;
    const n = rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const bx = c * cell + rng.range(40, cell - 40);
      const by = r * cell + rng.range(40, cell - 40);
      if (waterField(bx, by, p) > 20) addProp('boat', bx, by, rng.int(0, 3));
    }
  }

  roads();
  metro();
  if (zc.style !== 'water') {
    streetDressing();
    if (zc.style === 'forest') fillForest();
    else if (zc.style === 'park') fillPark();
    else if (zc.style === 'suburb') fillSuburb();
    else if (zc.style === 'farm') fillFarm();
    else if (zc.style === 'snow') fillSnow();
    else if (zc.style === 'fair') fillFair();
    else if (zc.style !== 'docks' && zc.style !== 'desert' && zc.density > 0.45 && ihash(c, r, p.s + 91) < 0.07) fillPlaza();
    else fillUrban();
    beach();
    lighthouse();
  } else boats();
  chunk.powerLines = powerLines.filter((ch) => ch.length > 1);
  return chunk;
}

// ---------------------------------------------------------------- the streaming world
const roadKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.realm = 'city';
    this.cell = cell;
    this.p = makeParams(seed);
    CUR = this.p;
    this.spawn = { ...this.p.spawn };
    this.grid = new SpatialHash(128);
    this.lightGrid = new SpatialHash(256);
    this.decalGrid = new SpatialHash(256);
    this.roadGrid = new SpatialHash(420);
    this.chunks = new Map();
    this.saved = new Map(); // cell key -> Map(local index -> saved state)
    this.listeners = new Set();
    this.graph = new Map();
    this.roadGraph = { graph: this.graph, key: roadKey };
    this.metroSegs = new Map();
    this.nextId = 1;
    this.detail = 0; // 1 = leave out pocket-sized clutter (set once the kaiju is huge)
    this._objects = null;
    this._roads = null;
  }

  key(c, r) {
    return (c + 32768) * 65536 + r + 32768;
  }

  zoneFor(c, r) {
    return zoneFor(c, r, this.p);
  }

  cellAt(x, y) {
    return zoneFor(Math.floor(x / cell), Math.floor(y / cell), this.p);
  }

  // Road along the top (horiz) or left edge of a cell, or null.
  edge(c, r, horiz) {
    return edgeFor(c, r, horiz, this.p);
  }

  isWater(x, y) {
    return waterField(x, y, this.p) > 0;
  }

  isMetroRow(r) {
    return isMetroRow(r, this.p);
  }

  isLoaded(c, r) {
    return this.chunks.has(this.key(c, r));
  }

  get objects() {
    if (!this._objects) {
      this._objects = [];
      for (const ch of this.chunks.values()) for (const o of ch.objects) this._objects.push(o);
    }
    return this._objects;
  }

  get roads() {
    if (!this._roads) {
      this._roads = [];
      for (const ch of this.chunks.values()) for (const rd of ch.roads) this._roads.push(rd);
    }
    return this._roads;
  }

  load(c, r) {
    const chunk = generateChunk(this, c, r);
    const saved = this.saved.get(chunk.key);
    if (saved) {
      for (const o of chunk.objects) {
        const s = saved.get(o.li);
        if (!s) continue;
        o.state = s.state;
        o.hp = s.hp;
        if (s.fallDir) o.fallDir = s.fallDir;
      }
      this.saved.delete(chunk.key);
    }
    for (const o of chunk.objects) this.grid.insert(o);
    for (const l of chunk.lights) this.lightGrid.insert(l);
    for (const d of chunk.decals) this.decalGrid.insert(d);
    for (const rd of chunk.roads) {
      this.roadGrid.insert(rd);
      for (const [x, y] of [[rd.x0, rd.y0], [rd.x1, rd.y1]]) {
        const k = roadKey(x, y);
        if (!this.graph.has(k)) this.graph.set(k, []);
        this.graph.get(k).push(rd);
      }
    }
    for (const seg of chunk.metro) this.metroSegs.set(`${seg.metroRow}:${seg.metroI}`, seg);
    this.chunks.set(chunk.key, chunk);
    this._objects = null;
    this._roads = null;
    for (const l of this.listeners) if (l.load) l.load(chunk);
    return chunk;
  }

  unload(chunk) {
    for (const l of this.listeners) if (l.unload) l.unload(chunk);
    chunk.loaded = false;
    let saved = null;
    for (const o of chunk.objects) {
      if (o.state !== 'intact' || o.hp < o.maxHp) {
        if (!saved) saved = new Map();
        saved.set(o.li, { state: o.state === 'collapsing' ? 'rubble' : o.state, hp: o.hp, fallDir: o.fallDir });
      }
      this.grid.remove(o);
    }
    if (saved) this.saved.set(chunk.key, saved);
    for (const l of chunk.lights) this.lightGrid.remove(l);
    for (const d of chunk.decals) this.decalGrid.remove(d);
    for (const rd of chunk.roads) {
      this.roadGrid.remove(rd);
      for (const [x, y] of [[rd.x0, rd.y0], [rd.x1, rd.y1]]) {
        const k = roadKey(x, y);
        const list = this.graph.get(k);
        if (!list) continue;
        const i = list.indexOf(rd);
        if (i >= 0) list.splice(i, 1);
        if (!list.length) this.graph.delete(k);
      }
    }
    for (const seg of chunk.metro) this.metroSegs.delete(`${seg.metroRow}:${seg.metroI}`);
    this.chunks.delete(chunk.key);
    this._objects = null;
    this._roads = null;
  }

  // Stream cells around (x, y): everything within `must` loads now, the rest of `radius`
  // loads nearest first, at most `maxNew` cells per call; far cells are dropped.
  update(x, y, radius, maxNew = 4, must = 0) {
    const c0 = Math.floor((x - radius) / cell);
    const c1 = Math.floor((x + radius) / cell);
    const r0 = Math.floor((y - radius) / cell);
    const r1 = Math.floor((y + radius) / cell);
    const missing = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.chunks.has(this.key(c, r))) continue;
        const dx = Math.max(c * cell - x, 0, x - (c + 1) * cell);
        const dy = Math.max(r * cell - y, 0, y - (r + 1) * cell);
        const d = Math.hypot(dx, dy);
        if (d <= radius) missing.push({ c, r, d });
      }
    }
    missing.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const m of missing) {
      if (m.d > must && n >= maxNew) break;
      this.load(m.c, m.r);
      n++;
    }
    const far = radius * 1.3 + cell;
    for (const ch of [...this.chunks.values()]) {
      const cx = (ch.c + 0.5) * cell;
      const cy = (ch.r + 0.5) * cell;
      if (Math.hypot(cx - x, cy - y) > far) this.unload(ch);
    }
    return missing.length - n;
  }

  nearestRoad(x, y, maxR = 3000) {
    for (let R = 300; R <= maxR; R *= 2) {
      let best = null;
      let bestD = Infinity;
      let bestT = 0;
      for (const rd of this.roadGrid.query(x - R, y - R, x + R, y + R)) {
        const vx = rd.x1 - rd.x0;
        const vy = rd.y1 - rd.y0;
        const t = Math.max(0, Math.min(1, ((x - rd.x0) * vx + (y - rd.y0) * vy) / (vx * vx + vy * vy || 1)));
        const px = rd.x0 + vx * t;
        const py = rd.y0 + vy * t;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD && !isWater(px, py)) {
          bestD = d;
          best = rd;
          bestT = t;
        }
      }
      if (best) return { road: best, t: bestT };
    }
    return null;
  }

  // Metro rows run along y = row * cell; the nearest one to y.
  metroRowNear(y) {
    const r = Math.round(y / cell);
    for (let d = 0; d < 12; d++) {
      if (isMetroRow(r + d, this.p)) return r + d;
      if (isMetroRow(r - d, this.p)) return r - d;
    }
    return null;
  }

  metroSeg(row, x) {
    return this.metroSegs.get(`${row}:${Math.floor(x / dimsOf('metro_track', 0).w)}`) || null;
  }
}

export const METRO = (() => {
  const tr = buildingDims('metro_track', 0);
  return { segLen: tr.w, deck: (tr.by - 2) * tr.v, stationEvery: 18, stationOffset: 9 };
})();

// Make a world's parameters current (isWater and friends read them).
export function useCity(world) {
  CUR = world.p;
}
