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
  farm: { pickup: 3, tractor: 2, car: 1, van: 0.5, camper_van: 0.3, motorbike: 0.3 },
  desert: { pickup: 3, car: 2, truck: 0.6, van: 1, camper_van: 1, car_wreck: 0.6, motorbike: 0.5 },
  snow: { car: 2, pickup: 2, van: 1, hatchback: 1, camper_van: 0.6, snowmobile: 1 },
};
// The city's kerbside mix, leaning each district its own way.
const KERB = new Map();
function kerbMix(style) {
  if (TRAFFIC[style]) return TRAFFIC[style];
  let m = KERB.get(style);
  if (!m) {
    const is = (...st) => st.includes(style);
    m = {
      car: 5, hatchback: 3, taxi: is('neon') ? 3 : 0.5, van: 2, pickup: is('suburb') ? 2 : 0.5, scooter: is('pastel', 'neon', 'lantern') ? 2 : 0.3,
      bus: 0.2, truck: is('brick') ? 0.6 : 0.1, sports_car: is('neon') ? 1 : 0.4, limo: is('neon') ? 0.3 : 0.05,
      motorbike: is('brick', 'neon', 'lantern') ? 1 : 0.4, camper_van: is('suburb') ? 0.4 : 0.1, ice_cream_truck: is('pastel', 'suburb') ? 0.3 : 0.05,
      school_bus: is('suburb', 'garden') ? 0.2 : 0, garbage_truck: is('brick') ? 0.4 : 0.1, rickshaw: is('lantern') ? 1.5 : 0,
    };
    KERB.set(style, m);
  }
  return m;
}
// Street furniture along the pavement, by district.
const FURNITURE = {
  neon: { vending: 3, neon_pole: 2, food_cart: 2, trash_can: 2, bench: 1, newspaper_box: 1, phone_booth: 1, bus_stop: 0.5, planter_tree: 2, bike_rack: 1, newsstand: 0.8, bollard: 1.5, parking_meter: 1, cafe_table: 1, recycling: 0.6, gacha: 2, atm: 1, pigeons: 1, potted_plant: 1, motorbike: 1, trash_bags: 1, utility_box: 0.5 },
  brick: { trash_can: 2, dumpster: 2, barrier: 3, drums: 2, crates: 2, hydrant: 1, cone: 2, bike_rack: 1, parking_meter: 1, recycling: 1, newspaper_box: 0.5, trash_bags: 3, cardboard: 2, pallets: 2, utility_box: 1, postbox: 0.5, ac_unit: 1, shopping_cart: 0.6, motorbike: 0.5, pigeons: 1 },
  pastel: { bench: 2, planter: 3, food_cart: 1, tree_blossom: 2, palm: 2, flower_bed: 2, mailbox: 1, cafe_table: 3, bike_rack: 1, ice_cream_cart: 0.8, bollard: 1, potted_plant: 2, flower_stall: 0.6, sandwich_board: 1, pigeons: 1, postbox: 0.5, motorbike: 0.6 },
  garden: { tree_round: 3, bench: 2, planter: 2, bus_stop: 1, hydrant: 1, trash_can: 1, newspaper_box: 1, cafe_table: 2, bike_rack: 1.5, planter_tree: 1.5, parking_meter: 1, newsstand: 0.5, postbox: 1, atm: 0.6, potted_plant: 1, pigeons: 1, wheelie_bin: 0.5, utility_box: 0.6 },
  docks: { container: 3, crates: 2, drums: 2, barrier: 1, pallets: 2, fish_crates: 2, lobster_traps: 1.5, forklift: 0.6 },
  farm: { hay: 3, mailbox: 1, tree_round: 2, bush: 2, scarecrow: 0.6, wheelbarrow: 0.5, hay_roll: 1.5, pumpkins: 1, water_trough: 0.5, well: 0.2 },
  desert: { cactus: 4, desert_rock: 2, tumbleweed: 2, mailbox: 0.5, barrel_cactus: 2, skull: 1, car_wreck: 0.4, wind_pump: 0.15 },
  snow: { tree_snow: 4, snowman: 2, mailbox: 1, bench: 0.5, snow_pile: 2, sled: 1, firewood: 1, ski_rack: 0.6, snowmobile: 0.6 },
  lantern: { lantern_post: 3, stone_lion: 1, food_cart: 2, vending: 1, planter: 1, bike_rack: 1, tree_blossom: 1, stone_lantern: 2, bonsai: 1, potted_plant: 1, rickshaw: 1, bamboo: 1, noodle_stall: 0.6 },
  fair: { balloon_cart: 3, food_cart: 2, ice_cream_cart: 2, bench: 2, trash_can: 1, porta_potty: 0.6, pigeons: 1, potted_plant: 0.5, sandwich_board: 0.5 },
  other: { hydrant: 1, trash_can: 1, tree_round: 2, mailbox: 1, bench: 1, wheelie_bin: 1, postbox: 0.5 },
};
// In front of the shops, between the doors and the pavement.
const SHOPFRONT = {
  neon: { sandwich_board: 2, gacha: 1.5, potted_plant: 1, trash_bags: 1, vending: 1, bike_rack: 0.5, motorbike: 1, ac_unit: 0.5 },
  brick: { trash_bags: 3, cardboard: 2, pallets: 1, ac_unit: 1, dumpster: 0.6, sandwich_board: 0.6, shopping_cart: 0.4, utility_box: 0.5 },
  pastel: { potted_plant: 3, sandwich_board: 1.5, cafe_table: 2, flower_stall: 0.4, bike: 1, planter: 1 },
  garden: { potted_plant: 2, sandwich_board: 1, cafe_table: 1, bike_rack: 0.6, atm: 0.5, newspaper_box: 0.5 },
  lantern: { stone_lantern: 1, bonsai: 1.5, potted_plant: 1, noodle_stall: 0.6, market_stall: 0.5, sandwich_board: 1, rickshaw: 0.5 },
  desert: { barrel_cactus: 1, potted_plant: 0.6, sandwich_board: 0.6, drums: 0.6, crates: 0.6, skull: 0.3 },
  docks: { pallets: 2, fish_crates: 2, lobster_traps: 1, drums: 1, crates: 1 },
};
const COURTYARD = {
  desert: { cactus: 4, desert_rock: 2, tumbleweed: 1, barrel_cactus: 2, skull: 1, car_wreck: 0.6 },
  lantern: { tree_blossom: 3, stone_lion: 1, lantern_post: 2, bench: 1, planter: 2, stone_lantern: 1.5, bamboo: 1.5, bonsai: 1 },
};
// What fills the middle of a city block when no building does: car parks, a street market, a
// back alley of bins, a ball court, a building site with its crane, or a garden.
const YARDS = {
  neon: { parking: 3, market: 2, alley: 2, court: 1, site: 1.2, garden: 0.5 },
  brick: { parking: 3, alley: 3, site: 1.5, court: 1, market: 1 },
  garden: { garden: 3, parking: 2, court: 1, site: 1, market: 0.5 },
  pastel: { garden: 3, market: 1.5, parking: 1, court: 0.5 },
  docks: { parking: 4, depot: 2.5 },
  desert: { garden: 3, parking: 0.6 },
  lantern: { garden: 2, market: 2, koi: 1.2 },
};
const ALLEY = { dumpster: 2, trash_bags: 4, cardboard: 3, pallets: 2, ac_unit: 2, drums: 1, crates: 1.5, wheelie_bin: 1.5, utility_box: 0.6, recycling: 0.8, shopping_cart: 0.5, motorbike: 0.4 };
const GARDEN_YARD = { tree_round: 3, bench: 2, flower_bed: 2, planter: 2, picnic_table: 1, topiary: 1, bird_bath: 0.8, hedge: 1, potted_plant: 1, apple_tree: 0.5, berry_bush: 0.6, bush: 1 };
const BACKYARD = {
  tree_round: 2, tree_autumn: 1, apple_tree: 0.6, swing_set: 1, trampoline: 1, pool: 0.8, hot_tub: 0.5, bbq: 1.5, doghouse: 1, picnic_table: 1,
  lawn_chair: 2, gnome: 1.5, flower_bed: 2, bush: 2, bike: 1, clothesline: 1.2, veg_patch: 1.2, kiddie_pool: 0.7, mower: 0.7, bird_bath: 0.7,
  firewood: 0.5, wheelbarrow: 0.5, chicken_coop: 0.25, ac_unit: 0.6, wheelie_bin: 0.5, topiary: 0.3, berry_bush: 0.4,
};
// Big, tall things for the open country beside the highways: a kaiju the size of a building still
// has something to knock down out there.
const COUNTRY = new Set(['farm', 'desert', 'snow', 'forest']);

// A chapter's theme (CHAPTER_THEMES) reweights the district odds, picks the countryside's climate
// and the style of the second district near home; no theme is Harbor Town as it always was.
function themedOdds(theme) {
  const odds = { ...STYLE_ODDS };
  for (const [st, m] of Object.entries((theme && theme.odds) || {})) odds[st] = (odds[st] || 0) * m;
  const total = Object.values(odds).reduce((a, b) => a + b, 0);
  for (const st of Object.keys(odds)) odds[st] /= total;
  return odds;
}

function makeParams(seed, theme = null) {
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
      { style: (theme && theme.near) || 'brick', cx: 0.5 + Math.cos(b) * 7, cy: 0.5 + Math.sin(b) * 7, r: 4.8, peak: 0.95, nk: 7 },
    ],
    odds: themedOdds(theme),
    climate: (theme && theme.climate) || null,
    sea: (theme && theme.wet) || 0.77,
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
  const sea = (fbm(x / 9000, y / 9000, s + 13, 2) - (p.sea ?? 0.77)) * 6000;
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
  for (const [st, w] of Object.entries(p.odds || STYLE_ODDS)) {
    roll -= w;
    if (roll < 0) {
      style = st;
      break;
    }
  }
  site = null;
  if (style === 'rural') {
    const heat = vnoise(I / 4, J / 4, p.s + 131);
    style = p.climate || (heat > 0.64 ? 'desert' : heat < 0.34 ? 'snow' : 'farm');
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
  // Street clutter draws from its own stream, so dressing a block differently never moves its
  // buildings.
  const crng = createRng(Math.floor(ihash(c, r, p.s + 6) * 4294967296));
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

  // What already stands where, on a coarse grid over the cell, so clutter scattered in later
  // finds the gaps instead of landing inside a house.
  const OCC = 4;
  const occN = Math.ceil(cell / OCC);
  const occ = new Uint8Array(occN * occN);
  const ox0 = c * cell;
  const oy0 = r * cell;
  const occSpan = (x, y, w, h, fn) => {
    const i0 = Math.max(0, Math.floor((x - w / 2 - ox0) / OCC));
    const i1 = Math.min(occN - 1, Math.floor((x + w / 2 - ox0) / OCC));
    const j0 = Math.max(0, Math.floor((y - h / 2 - oy0) / OCC));
    const j1 = Math.min(occN - 1, Math.floor((y + h / 2 - oy0) / OCC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (fn(j * occN + i)) return true;
    return false;
  };
  const free = (x, y, w, h) => !occSpan(x, y, w, h, (k) => occ[k]);

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
      occSpan(o.x, o.y, o.w, o.h, (k) => void (occ[k] = 1));
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

  const addProp = (id, x, y, rot = 0, variant = crng.int(0, (PROP_BY_ID[id].variants || 3) - 1)) => {
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

  // `n` tries at dropping something from `table` into the rectangle, each only where it fits
  // between what is already there (with `gap` to spare) and on dry land.
  const scatter = (x0, y0, x1, y1, n, table, gap = 1) => {
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const id = crng.weighted(table);
      const rot = crng.int(0, 3);
      const d = propDims(id);
      const w = rot % 2 ? d.h : d.w;
      const h = rot % 2 ? d.w : d.h;
      if (x1 - x0 < w + 2 || y1 - y0 < h + 2) continue;
      const px = crng.range(x0 + w / 2 + 1, x1 - w / 2 - 1);
      const py = crng.range(y0 + h / 2 + 1, y1 - h / 2 - 1);
      if (!free(px, py, w + gap * 2, h + gap * 2) || !footprintDry(px, py, w, h)) continue;
      addProp(id, px, py, rot);
      placed++;
    }
    return placed;
  };
  // A little group of one thing (sheep in a field, pigeons on a square, ducks on a pond).
  const flock = (id, x, y, n, spread) => {
    for (let i = 0; i < n; i++) {
      const px = x + crng.range(-spread, spread);
      const py = y + crng.range(-spread, spread);
      const d = propDims(id);
      if (free(px, py, d.w, d.w) && !water(px, py)) addProp(id, px, py, crng.int(0, 3));
    }
  };

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
    const furniture = FURNITURE[style] || FURNITURE.other;
    for (const e of edges) {
      if (!e.has) continue;
      const at = (t, off = 0) => (e.horiz ? [x + t, e.at + off] : [e.at + off, y + t]);
      for (let t = 30; t < w; t += isUrban && !country ? 70 : 140) {
        const [px, py] = at(t);
        if (!water(px, py)) addProp(lampType, px, py, e.horiz ? (e.out > 0 ? 2 : 0) : e.out > 0 ? 1 : 3);
      }
      if (!isUrban) continue;
      // Now and then a stretch of kerb is coned off for road works instead of parked on.
      const works = !country && crng.chance(0.07) ? crng.range(40, w - 110) : null;
      const lane = e.out * 14;
      for (let t = 20; t < w - 20; t += crng.int(18, 40)) {
        if (works !== null && t > works - 14 && t < works + 84) continue;
        if (!crng.chance(style === 'brick' ? 0.45 : country ? 0.15 : 0.35)) continue;
        const id = crng.weighted(kerbMix(style));
        const [px, py] = at(t, lane);
        if (!water(px, py)) addProp(id, px, py, e.horiz ? (crng.chance(0.5) ? 0 : 2) : crng.chance(0.5) ? 1 : 3);
      }
      if (works !== null) {
        const rot = e.horiz ? 0 : 1;
        for (let t = works; t <= works + 70; t += 6) addProp('cone', ...at(t, lane + e.out * 5));
        addProp('barrier', ...at(works - 6, lane), e.horiz ? 1 : 0);
        addProp('barrier', ...at(works + 76, lane), e.horiz ? 1 : 0);
        addProp('road_sign', ...at(works - 12, lane - e.out * 4), rot);
        addProp(crng.chance(0.5) ? 'sand_pile' : 'pallets', ...at(works + 24, lane), rot);
        addProp(crng.chance(0.5) ? 'porta_potty' : 'cardboard', ...at(works + 50, lane - e.out * 3), rot);
      }
      for (let t = 40; t < w - 16; t += country ? crng.int(30, 60) : crng.int(16, 34)) {
        const [px, py] = at(t, crng.range(-3, 3));
        if (!water(px, py)) addProp(crng.weighted(furniture), px, py, e.horiz ? 0 : 1);
      }
    }
    if (isUrban && (style === 'neon' || style === 'garden' || style === 'brick') && top && left) addProp('traffic_light', x - 14, y - 14);
    if (isUrban && top && right) addProp('street_sign', x + w + 12, y - 12);
    if (style === 'brick' || style === 'suburb' || style === 'farm' || style === 'desert') {
      for (const e of edges) {
        if (!e.has || !crng.chance(0.7)) continue;
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

  // Beside the highways out in the country: big roadside billboards, steel pylons carrying the
  // grid across the fields, and wind turbines on the farms. Placed last, in whatever room is left.
  function highwayDressing() {
    const { x, y, w, style } = zc;
    const hwEdges = [
      { e: top, horiz: true, at: y + 16, rot: 0 },
      { e: bottom, horiz: true, at: y + w - 16, rot: 2 },
      { e: left, horiz: false, at: x + 16, rot: 3 },
      { e: right, horiz: false, at: x + w - 16, rot: 1 },
    ].filter((h) => h.e && h.e.hw);
    for (const h of hwEdges) {
      const at = (t) => (h.horiz ? [x + t, h.at] : [h.at, y + t]);
      if (style !== 'water' && style !== 'forest' && crng.chance(isCountry(style) ? 0.5 : 0.25)) {
        const [px, py] = at(crng.range(60, w - 60));
        const d = propDims('billboard');
        const bw = h.horiz ? d.w : d.h;
        const bh = h.horiz ? d.h : d.w;
        if (free(px, py, bw + 4, bh + 4) && footprintDry(px, py, bw, bh)) addProp('billboard', px, py, h.rot);
      }
      if (!COUNTRY.has(style)) continue;
      const chain = [];
      const d = propDims('pylon');
      for (let t = 50; t < w; t += 150) {
        const [px, py] = at(t);
        // Arms across the line: turned a quarter beside an east-west highway.
        const pw = h.horiz ? d.h : d.w;
        const ph = h.horiz ? d.w : d.h;
        if (!free(px, py, pw, ph) || !footprintDry(px, py, pw, ph)) continue;
        const pyl = addProp('pylon', px, py, h.horiz ? 1 : 0);
        if (!pyl.skip) chain.push(pyl);
      }
      if (chain.length > 1) {
        chain.wire = { h: d.height * 0.69, off: 6.3 };
        powerLines.push(chain);
      }
    }
  }
  const isCountry = (st) => st === 'farm' || st === 'desert' || st === 'snow';

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
    const front = SHOPFRONT[style];
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
          // A sign, a pot plant, bags out for collection: something at the door.
          if (depth === 0 && front && pick.d.w > 8) {
            for (let k = crng.chance(0.6) ? crng.int(1, 2) : 0; k > 0; k--) {
              const id = crng.weighted(front);
              const pd = propDims(id);
              if (pd.h > setback - 0.5) continue;
              const a = cursor + crng.range(pd.w / 2 + 1, Math.max(pd.w / 2 + 1, pick.d.w - pd.w / 2 - 1));
              const off = setback - pd.h / 2 - 0.5;
              const ix = sx + dx * a + nx * off;
              const iy = sy + dy * a + ny * off;
              if (free(ix, iy, rot % 2 ? pd.h : pd.w, rot % 2 ? pd.w : pd.h) && !water(ix, iy)) addProp(id, ix, iy, rot);
            }
          }
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
      scatter(x0 + 2, y0 + 2, x1 - 2, y1 - 2, 6, style === 'brick' || style === 'neon' ? ALLEY : GARDEN_YARD);
      return;
    }
    const area = cw * ch;
    let kind = crng.weighted(YARDS[style] || { parking: 2, garden: 3 });
    if ((kind === 'court' && (cw < 70 || ch < 44)) || (kind === 'market' && (cw < 40 || ch < 40)) || (kind === 'koi' && (cw < 60 || ch < 60))) kind = 'garden';
    if (kind === 'parking') {
      if (style !== 'docks') decals.push({ kind: 'parking', x: cx, y: cy, w: cw, h: ch });
      const parked = style === 'docks' ? null : { car: 4, hatchback: 2, van: 1, taxi: style === 'neon' ? 1.5 : 0.5, pickup: 1, sports_car: 0.5, motorbike: 0.5 };
      for (let px = x0 + 8; px < x1 - 6; px += 9) {
        for (let py = y0 + 8; py < y1 - 6; py += 16) {
          if (crng.chance(style === 'docks' ? 0.65 : 0.72)) addProp(parked ? crng.weighted(parked) : crng.chance(0.25) ? 'container_stack' : 'container', px, py, 1);
          else if (parked && crng.chance(0.15)) addProp(crng.pick(['shopping_cart', 'trash_can', 'cone']), px, py, crng.int(0, 3));
        }
      }
      return;
    }
    if (kind === 'market') {
      // Rows of stalls with crates and rubbish between them.
      decals.push({ kind: 'plaza', x: cx, y: cy, w: cw - 4, h: ch - 4 });
      const stalls = style === 'lantern' || style === 'neon' ? { market_stall: 3, noodle_stall: 2, food_cart: 1, flower_stall: 0.6 } : { market_stall: 3, flower_stall: 1.5, food_cart: 1, ice_cream_cart: 0.4 };
      for (let py = y0 + 10; py < y1 - 8; py += 22) {
        for (let px = x0 + 10; px < x1 - 8; px += crng.range(11, 15)) {
          const id = crng.weighted(stalls);
          const d = propDims(id);
          if (px + d.w / 2 < x1 - 2 && free(px, py, d.w, d.h)) addProp(id, px, py, crng.chance(0.5) ? 0 : 2);
        }
      }
      scatter(x0, y0, x1, y1, Math.floor(area / 400), { crates: 2, cardboard: 2, trash_bags: 1.5, pallets: 1, pigeons: 1.5, bench: 0.5, trash_can: 1 });
      return;
    }
    if (kind === 'alley') {
      decals.push({ kind: 'parking', x: cx, y: cy, w: cw, h: ch });
      if (crng.chance(0.5)) addProp(crng.pick(['garbage_truck', 'van', 'truck']), cx, cy, cw > ch ? 0 : 1);
      scatter(x0, y0, x1, y1, Math.floor(area / 160), ALLEY);
      return;
    }
    if (kind === 'court') {
      const ball = crng.chance(0.6);
      decals.push({ kind: ball ? 'basketball' : 'tennis', x: cx, y: cy, w: ball ? 56 : 60, h: ball ? 32 : 30 });
      if (ball) {
        addProp('hoop', cx - 27, cy, 0);
        addProp('hoop', cx + 27, cy, 2);
      } else addProp('tennis_net', cx, cy, 0);
      for (const side of [-1, 1]) addProp('bench', cx + side * 18, cy + 24, 0);
      scatter(x0, y0, x1, y1, Math.floor(area / 500), { trash_can: 1, bench: 1, tree_round: 1, bike: 1, bike_rack: 0.5, pigeons: 0.5 }, 2);
      return;
    }
    if (kind === 'site') {
      // A building site: churned ground, a tower crane over the bigger ones, plant and materials.
      decals.push({ kind: 'dirt', x: cx, y: cy, w: cw - 2, h: ch - 2 });
      if (cw > 70 && ch > 50) {
        const d = propDims('crane_tower');
        const kx = x0 + d.w / 2 + 4;
        const ky = y0 + d.h / 2 + 6;
        if (free(kx, ky, d.w, d.h)) addProp('crane_tower', kx, ky, crng.chance(0.5) ? 0 : 2);
      }
      for (const id of ['excavator', crng.chance(0.6) ? 'cement_mixer' : 'forklift']) scatter(x0, y0, x1, y1, 3, { [id]: 1 }, 2);
      scatter(x0, y0, x1, y1, Math.floor(area / 260), { sand_pile: 2, pallets: 2, porta_potty: 1, cone: 2, barrier: 1.5, drums: 1, cardboard: 0.6, road_sign: 0.5, wheelbarrow: 0.6 });
      return;
    }
    if (kind === 'depot') {
      // Tank farm and stacked boxes behind the quays.
      for (let px = x0 + 14; px < x1 - 12; px += 26) for (let py = y0 + 14; py < y1 - 12; py += 26) if (crng.chance(0.55)) scatter(px - 13, py - 13, px + 13, py + 13, 1, { oil_tank: 2, container_stack: 1.5 }, 1);
      scatter(x0, y0, x1, y1, Math.floor(area / 400), { forklift: 1, pallets: 2, drums: 2, fish_crates: 1, container: 1 });
      return;
    }
    if (kind === 'koi') {
      decals.push({ kind: 'pond', x: cx, y: cy, w: Math.min(cw, ch) * 0.5, h: Math.min(cw, ch) * 0.38 });
      flock('ducks', cx, cy, 2, Math.min(cw, ch) * 0.12);
      const rr = Math.min(cw, ch) * 0.36;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        addProp(k % 2 ? 'stone_lantern' : crng.pick(['bonsai', 'bamboo', 'tree_blossom']), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, crng.int(0, 3));
      }
      return;
    }
    const yard = COURTYARD[style] || (style === 'pastel' ? { ...GARDEN_YARD, tree_blossom: 3, palm: 2 } : GARDEN_YARD);
    scatter(x0, y0, x1, y1, Math.floor(area / 220) + 4, yard);
    if (style === 'desert') {
      // Out the back in the desert: a nodding oil pump, a wind pump, solar panels, a dead car.
      if (crng.chance(0.4)) scatter(x0, y0, x1, y1, 4, { pump_jack: 1 }, 2);
      if (crng.chance(0.35)) scatter(x0, y0, x1, y1, 4, { wind_pump: 1 }, 2);
      if (crng.chance(0.4)) scatter(x0, y0, x1, y1, 6, { solar_panels: 1 }, 1);
      if (crng.chance(0.3)) scatter(x0, y0, x1, y1, 4, { radio_dish: 1 }, 2);
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
        if (rng.chance(0.6)) addProp(rng.weighted({ car: 3, hatchback: 3, pickup: 3, van: 2, camper_van: 0.5, sports_car: 0.4, motorbike: 0.4 }), hx + (fx ? 0 : bw / 2 + 9), hy + (fy ? 0 : bh / 2 + 9), fx ? 0 : 1);
        frontYard(hx, hy, bw, bh, fx, fy, rot);
        backyard(lx, ly, lot, -fx, -fy, hx, hy, bw, bh);
      }
    }
  }

  // Front yard: the strip between the house and the street gets a path to the door, bins out by
  // the kerb, a mailbox, and a hedge, flower beds or a tree.
  function frontYard(hx, hy, bw, bh, fx, fy, rot) {
    if (!fx && !fy) return;
    // Along: the direction across the house front; depth: out from the front wall to the street.
    const ax = fy ? 1 : 0;
    const ay = fx ? 1 : 0;
    const half = fy ? bw / 2 : bh / 2;
    const face = fy ? bh / 2 : bw / 2;
    const at = (along, out) => [hx + ax * along + fx * (face + out), hy + ay * along + fy * (face + out)];
    const [px, py] = at(0, 5);
    decals.push({ kind: 'path', x: px, y: py, w: fx ? 10 : 3, h: fx ? 3 : 10 });
    addProp('mailbox', ...at(half - 3, 9), rot);
    for (let k = crng.int(0, 2); k > 0; k--) addProp('wheelie_bin', ...at(-half + 2 + k * 2.5, 8.5), rot);
    const style = crng.next();
    const hedgeLen = propDims('hedge').w;
    if (style < 0.35) {
      for (let a = -half + hedgeLen / 2; a < half - hedgeLen / 2; a += hedgeLen) if (Math.abs(a) > hedgeLen / 2 + 1) addProp('hedge', ...at(a, 7.5), fx ? 1 : 0);
    } else if (style < 0.7) {
      for (const side of [-1, 1]) addProp('flower_bed', ...at(side * half * 0.5, 2), fx ? 1 : 0);
    }
    if (crng.chance(0.45)) addProp(crng.weighted({ tree_round: 3, tree_autumn: 1, tree_blossom: 1, apple_tree: 0.5 }), ...at(crng.chance(0.5) ? -half * 0.6 : half * 0.6, 4), crng.int(0, 3));
    if (crng.chance(0.3)) addProp(crng.weighted({ gnome: 2, bike: 1, bird_bath: 1, potted_plant: 1, kiddie_pool: 0.4 }), ...at(crng.range(-half + 2, half - 2), 2.5), crng.int(0, 3));
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
    if (rng.chance(0.75)) {
      const shed = rng.chance(0.8) ? 'garden_shed' : rng.chance(0.5) ? 'playhouse' : 'carport';
      const sx = rng.chance(0.5) ? yx0 + 9 : yx1 - 9;
      const sy = rng.chance(0.5) ? yy0 + 8 : yy1 - 8;
      const rot = rng.int(0, 3);
      if (footprintDry(sx, sy, 16, 16)) addBuilding(shed, sx, sy, rot);
    }
    scatter(yx0 + 2, yy0 + 2, yx1 - 2, yy1 - 2, crng.int(10, 16), BACKYARD);
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
    // Ducks on the pond, a cart by the fountain, and the lawns filled in around the paths.
    flock('ducks', pond.x, pond.y, crng.int(2, 4), 22);
    flock('pigeons', cx, cy, crng.int(2, 4), 24);
    for (const [ox, oy] of [[34, 10], [-34, -10]]) if (free(cx + ox, cy + oy, 6, 6)) addProp(crng.pick(['ice_cream_cart', 'food_cart', 'balloon_cart']), cx + ox, cy + oy, 0);
    const lawn = { flower_bed: 2, bush: 2, topiary: 0.6, bird_bath: 0.6, pigeons: 1, trash_can: 1, hedge: 1, berry_bush: 0.6, toadstools: 0.3, stump: 0.3, apple_tree: 0.6, picnic_table: 0.6, tree_round: 1.5, bench: 0.6 };
    for (const [ax, ay, bx, by] of [[x + 4, y + 4, cx - 8, cy - 8], [cx + 8, y + 4, x + w - 4, cy - 8], [x + 4, cy + 8, cx - 8, y + w - 4], [cx + 8, cy + 8, x + w - 4, y + w - 4]]) scatter(ax, ay, bx, by, 12, lawn, 2);
    if (crng.chance(0.4)) scatter(x + 4, y + 4, x + w - 4, y + w - 4, 4, { porta_potty: 1 }, 1);
    if (crng.chance(0.12)) scatter(x + 4, y + 4, x + w - 4, y + w - 4, 6, { hot_air_balloon: 1 }, 3);
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
    // Pigeons round the fountain, and the square's own clutter in the gaps.
    for (let k = 0; k < 4; k++) flock('pigeons', cx + crng.range(-60, 60), cy + crng.range(-40, 60), 2, 10);
    scatter(x + 10, y + 10, x + w - 10, y + w - 10, 26, { potted_plant: 2, sandwich_board: 1, atm: 0.6, flower_stall: 0.8, market_stall: 0.6, newsstand: 0.5, trash_can: 1.5, bike_rack: 0.8, gacha: style === 'neon' ? 1 : 0, pigeons: 1 }, 2);
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
      // Cattle, a flock of sheep, horses or pigs, with a trough to drink from.
      const herd = crng.weighted({ cow: 3, sheep: 2.5, horse: 1.2, pig: 1 });
      const [n0, n1] = { cow: [3, 7], sheep: [8, 16], horse: [3, 5], pig: [4, 8] }[herd];
      for (let i = crng.int(n0, n1); i > 0; i--) addProp(herd, side.x + crng.range(-side.w / 2 + 12, side.w / 2 - 12), side.y + crng.range(-side.h / 2 + 12, side.h / 2 - 12), crng.int(0, 3));
      addProp('tree_round', side.x + crng.range(-40, 40), side.y + crng.range(-40, 40), crng.int(0, 3));
      scatter(side.x - side.w / 2 + 6, side.y - side.h / 2 + 6, side.x + side.w / 2 - 6, side.y + side.h / 2 - 6, 3, { water_trough: 2, hay: 1, hay_roll: 1 }, 1);
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
    // Farmyard life between the buildings: hens and their coop, the vegetable patch, a well.
    if (crng.chance(0.6)) flock('chicken', sx0 + half / 2, sy0 + half / 2, crng.int(4, 8), 30);
    scatter(sx0, sy0, sx0 + half - 12, sy0 + half - 12, 18, { chicken: 2, wheelbarrow: 1, firewood: 1, veg_patch: 1.5, water_trough: 0.6, hay_roll: 1, hay: 1, well: 0.4, chicken_coop: 0.6, beehive: 0.8, pickup: 0.4 });
    // Out in the big field: a wind turbine or two, now and then a balloon come down, then the crop
    // itself in rows: corn, pumpkins, round bales of hay or an orchard.
    const fx0 = far.x - far.w / 2 + 4;
    const fy0 = far.y - far.h / 2 + 4;
    const fx1 = far.x + far.w / 2 - 4;
    const fy1 = far.y + far.h / 2 - 4;
    for (let t = crng.chance(0.3) ? crng.int(1, 2) : 0; t > 0; t--) scatter(fx0, fy0, fx1, fy1, 6, { wind_turbine: 1 }, 6);
    if (crng.chance(0.06)) scatter(fx0, fy0, fx1, fy1, 4, { hot_air_balloon: 1 }, 3);
    const field = crng.weighted({ plain: 3, corn: 2.5, pumpkins: 1.5, hay: 2, orchard: 1 });
    if (field === 'corn' || field === 'orchard') {
      const [along, across, id] = field === 'corn' ? [12, 16, 'corn'] : [24, 26, 'apple_tree'];
      const d = propDims(id);
      for (let py = fy0 + across / 2; py < fy1; py += across) {
        for (let px = fx0 + along / 2; px < fx1; px += along) {
          const jx = px + crng.range(-1.5, 1.5);
          if (free(jx, py, d.w, d.h) && !water(jx, py)) addProp(id, jx, py, crng.int(0, 3));
        }
      }
    } else if (field === 'pumpkins') scatter(fx0, fy0, fx1, fy1, 70, { pumpkins: 1 }, 1);
    else if (field === 'hay') scatter(fx0, fy0, fx1, fy1, 36, { hay_roll: 3, hay: 1 }, 2);
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
          scatter(lx + 14, ly + 22, lx + lot - 14, ly + lot - 22, 6, { ice_hut: 1, sled: 2, snow_pile: 0.6 }, 2);
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
        scatter(lx + 4, ly + 4, lx + lot - 4, ly + lot - 4, crng.int(5, 8), { snow_pile: 2, sled: 1, firewood: 1, ski_rack: 0.6, snowmobile: 0.6, snowman: 1, tree_snow: 1.5, ice_hut: 0.2, igloo: 0.25 }, 1);
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
    for (const [ax, ay, bx, by] of [[x + 4, y + 4, cx - 10, cy - 10], [cx + 10, y + 4, x + w - 4, cy - 10], [x + 4, cy + 10, cx - 10, y + w - 4], [cx + 10, cy + 10, x + w - 4, y + w - 4]]) {
      scatter(ax, ay, bx, by, 10, { balloon_cart: 1, porta_potty: 0.6, trash_can: 1, pigeons: 0.8, potted_plant: 0.4, sandwich_board: 0.5, cafe_table: 0.6, food_cart: 0.6, bench: 0.6 }, 2);
    }
    if (crng.chance(0.35)) scatter(x + 4, y + 4, x + w - 4, y + w - 4, 6, { hot_air_balloon: 1 }, 3);
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
    const n = clearing ? 50 : 96;
    for (let i = 0; i < n; i++) {
      const px = x - 20 + rng.range(0, w + 40);
      const py = y - 20 + rng.range(0, w + 40);
      if (water(px, py)) continue;
      if (clearing && Math.hypot(px - x - w / 2, py - y - w / 2) < 90) continue;
      addProp(rng.weighted({ tree_pine: 5, tree_pine_tall: 3, tree_round: 1.5, tree_birch: 1.5, tree_autumn: 1, bush: 2, rock: 1.2, log: 0.5, hay: 0.1 }), px, py, rng.int(0, 3));
    }
    // The forest floor: ferns, toadstools, stumps and berry bushes, a boulder or two, and the
    // odd deer (or bear).
    scatter(x - 10, y - 10, x + w + 10, y + w + 10, clearing ? 40 : 64, { fern: 3, toadstools: 1.5, stump: 1.5, berry_bush: 1.5, boulder: 0.6, rock: 0.8, log: 0.8 }, 1);
    for (let k = crng.chance(0.55) ? crng.int(1, 2) : 0; k > 0; k--) flock('deer', x + crng.range(40, w - 40), y + crng.range(40, w - 40), crng.int(2, 4), 18);
    if (crng.chance(0.12)) flock('bear', x + crng.range(40, w - 40), y + crng.range(40, w - 40), 1, 4);
    if (clearing) scatter(x + w / 2 - 80, y + w / 2 - 80, x + w / 2 + 80, y + w / 2 + 80, 6, { firewood: 2, camper_van: 0.6, canoe: 0.6, tent: 1, picnic_table: 1 }, 2);
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
        else if (crng.chance(0.4)) addProp(crng.weighted({ lawn_chair: 3, canoe: 0.6, ice_cream_cart: 0.4, kiddie_pool: 0.3 }), px - 8, py + 8, crng.int(0, 3));
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

  // On open water: sailboats, yachts and the odd cargo ship; nearer the shore rowboats, jet skis
  // and buoys. Each only where its whole hull is afloat.
  function boats() {
    if (zc.style !== 'water') return;
    const deep = waterField((c + 0.5) * cell, (r + 0.5) * cell, p) > 120;
    const fleet = deep ? { boat: 2, sailboat: 2, yacht: 1.2, cargo_ship: 0.8, buoy: 1 } : { boat: 2, sailboat: 1.5, rowboat: 1.2, jetski: 1, buoy: 1.2, canoe: 0.4 };
    for (let i = crng.int(1, 4); i > 0; i--) {
      const id = crng.weighted(fleet);
      const rot = crng.int(0, 3);
      const d = propDims(id);
      const hw = (rot % 2 ? d.h : d.w) / 2;
      const hh = (rot % 2 ? d.w : d.h) / 2;
      const bx = c * cell + crng.range(40, cell - 40);
      const by = r * cell + crng.range(40, cell - 40);
      const afloat = [[0, 0], [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].every(([dx, dy]) => waterField(bx + dx, by + dy, p) > 12);
      if (afloat && free(bx, by, hw * 2 + 6, hh * 2 + 6)) addProp(id, bx, by, rot);
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
    highwayDressing();
  } else boats();
  chunk.powerLines = powerLines.filter((ch) => ch.length > 1);
  return chunk;
}

// ---------------------------------------------------------------- the streaming world
const roadKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

export class World {
  constructor(seed = 1, theme = null) {
    this.seed = seed;
    this.theme = theme;
    this.realm = 'city';
    this.cell = cell;
    this.p = makeParams(seed, theme);
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
