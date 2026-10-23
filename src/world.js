import { WORLD, TIER_HP, LANDMARK_HP } from './config.js';
import { createRng } from './rng.js';
import { BUILDING_TYPES, TYPE_BY_ID, buildingDims, VARIANTS } from './buildings.js';
import { PROP_BY_ID, propDims } from './props.js';

// Uniform grid for fast area queries over thousands of static objects.
export class SpatialGrid {
  constructor(width, height, cellSize = 128) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.stamp = 0;
  }

  insert(obj) {
    const cs = this.cellSize;
    const c0 = Math.max(0, Math.floor((obj.x - obj.w / 2) / cs));
    const c1 = Math.min(this.cols - 1, Math.floor((obj.x + obj.w / 2) / cs));
    const r0 = Math.max(0, Math.floor((obj.y - obj.h / 2) / cs));
    const r1 = Math.min(this.rows - 1, Math.floor((obj.y + obj.h / 2) / cs));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(obj);
  }

  query(x0, y0, x1, y1, out = []) {
    const cs = this.cellSize;
    const c0 = Math.max(0, Math.floor(x0 / cs));
    const c1 = Math.min(this.cols - 1, Math.floor(x1 / cs));
    const r0 = Math.max(0, Math.floor(y0 / cs));
    const r1 = Math.min(this.rows - 1, Math.floor(y1 / cs));
    const stamp = ++this.stamp;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const obj of this.cells[r * this.cols + c]) {
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

// ---------------------------------------------------------------- layout
const { cell, road, cols, rows, seaWidth } = WORLD;

// District centres in cell coordinates.
const DISTRICTS = [
  { style: 'neon', cx: 4.5, cy: 8.5, r: 6.5, peak: 1.15 },
  { style: 'brick', cx: 4.5, cy: 2, r: 5.2, peak: 0.95 },
  { style: 'pastel', cx: 1.8, cy: 14, r: 4.6, peak: 0.7 },
  { style: 'garden', cx: 14.5, cy: 8.5, r: 5.6, peak: 0.85 },
  { style: 'neon', cx: 14.5, cy: 1.5, r: 4.6, peak: 0.95, name: 'Neon Heights' },
  { style: 'suburb', cx: 19, cy: 10.5, r: 6, peak: 0.5 },
  { style: 'suburb', cx: 19.5, cy: 3.5, r: 4.5, peak: 0.45 },
  { style: 'pastel', cx: 12.5, cy: 14.5, r: 4, peak: 0.65 },
];

const LAKE = { cx: seaWidth + 10.2 * cell, cy: 8.3 * cell, rx: 1250, ry: 1500 };

function noise2(x, y, seed) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = noise2(xi, yi, seed);
  const b = noise2(xi + 1, yi, seed);
  const c = noise2(xi, yi + 1, seed);
  const d = noise2(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function isWater(x, y) {
  if (x < seaWidth - 40 + smoothNoise(0, y / 300, 3) * 80) return true;
  const lx = (x - LAKE.cx) / LAKE.rx;
  const ly = (y - LAKE.cy) / LAKE.ry;
  const wob = smoothNoise(x / 400, y / 400, 5) * 0.25;
  if (lx * lx + ly * ly < 1 - wob) return true;
  // River feeding the lake from the north and draining south.
  const rx = LAKE.cx + Math.sin(y / 900) * 260 - (y > LAKE.cy ? (y - LAKE.cy) * 0.35 : 0);
  const width = 70 + smoothNoise(0, y / 500, 9) * 40;
  return Math.abs(x - rx) < width;
}

function cellCenter(c, r) {
  return { x: seaWidth + (c + 0.5) * cell, y: (r + 0.5) * cell };
}

// Which district a cell belongs to and how dense it is (0..1).
function zoneFor(c, r) {
  const p = cellCenter(c, r);
  if (isWater(p.x, p.y)) return { style: 'water', density: 0 };
  let best = { style: 'forest', density: 0 };
  let bestScore = 0.12 + smoothNoise(c / 3, r / 3, 11) * 0.12;
  for (const d of DISTRICTS) {
    const dist = Math.hypot(c + 0.5 - d.cx, r + 0.5 - d.cy) / d.r;
    const score = (1 - dist) * d.peak + smoothNoise(c / 2, r / 2, d.cx) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = { style: d.style, density: Math.max(0, Math.min(1, score)), district: d };
    }
  }
  // Forest belts: between the southern city and Neon Heights, and the eastern outskirts.
  const belt = (r >= 3.2 + smoothNoise(c / 2, 0, 21) * 1.2 && r <= 5.2 + smoothNoise(c / 2, 1, 22) && c >= 9) || c >= 22 - smoothNoise(0, r / 2, 23) * 1.5;
  if (belt && best.style !== 'neon') best = { style: 'forest', density: 0 };
  if (c === 0 && best.style !== 'forest') best = { style: 'docks', density: 0.4 };
  // Parks: occasional green cells inside cities.
  if (best.style !== 'forest' && best.style !== 'suburb' && noise2(c, r, 77) < 0.07) best = { style: 'park', density: 0.2 };
  return best;
}

export function generateCity(seed = 1) {
  const rng = createRng(seed);
  const objects = [];
  const lights = [];
  const cells = [];
  const uniquePlaced = new Set();
  const add = (o) => {
    o.id = objects.length;
    o.state = 'intact';
    o.flash = 0;
    objects.push(o);
    return o;
  };

  const addBuilding = (typeId, x, y, rot, variant = rng.int(0, VARIANTS - 1)) => {
    const t = TYPE_BY_ID[typeId];
    const d = buildingDims(typeId, variant);
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
    const p = PROP_BY_ID[id];
    const d = propDims(id);
    const swap = rot % 2 === 1;
    const o = add({
      kind: 'prop', type: id, variant, rot, tier: p.tier, x, y,
      w: swap ? d.h : d.w, h: swap ? d.w : d.h, height: d.height,
      hp: TIER_HP[p.tier], maxHp: TIER_HP[p.tier], structure: false, vehicle: Boolean(p.vehicle), value: p.value,
    });
    if (p.light) lights.push({ x, y, h: p.light.h, color: p.light.color, obj: o, flicker: p.light.flicker });
    return o;
  };

  const footprintDry = (x, y, w, h) =>
    !isWater(x, y) && !isWater(x - w / 2, y - h / 2) && !isWater(x + w / 2, y - h / 2) && !isWater(x - w / 2, y + h / 2) && !isWater(x + w / 2, y + h / 2);

  // Pick a building type for a zone, preferring a tier, that fits in maxW x maxH.
  const pickBuilding = (zoneKeys, tier, maxW, maxH, rot) => {
    const pool = BUILDING_TYPES.filter((t) => t.weight > 0 && t.zones.some((z) => zoneKeys.includes(z)));
    if (!pool.length) return null;
    const weights = {};
    for (const t of pool) {
      const tierFit = t.tier === tier ? 1 : Math.abs(t.tier - tier) === 1 ? 0.25 : 0.03;
      weights[t.id] = t.weight * tierFit;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = rng.weighted(weights);
      const variant = rng.int(0, VARIANTS - 1);
      const d = buildingDims(id, variant);
      const w = rot % 2 ? d.h : d.w;
      const h = rot % 2 ? d.w : d.h;
      if (w <= maxW && h <= maxH && !(TYPE_BY_ID[id].unique && uniquePlaced.has(id))) return { id, variant };
    }
    return null;
  };

  const inner = cell - road;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const z = zoneFor(c, r);
      cells.push({ c, r, x: seaWidth + c * cell + road / 2, y: r * cell + road / 2, w: inner, h: inner, style: z.style, density: z.density });
    }
  }
  const zoneAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? null : cells[r * cols + c]);
  const urban = (zc) => Boolean(zc) && zc.style !== 'forest' && zc.style !== 'water';

  // Roads run along cell borders wherever a neighbouring cell is urban, plus two highways.
  const HIGHWAY_ROW = 8;
  const HIGHWAY_COL = 20;
  const roadH = (c, r) => r === HIGHWAY_ROW || urban(zoneAt(c, r)) || urban(zoneAt(c, r - 1));
  const roadV = (c, r) => c === HIGHWAY_COL || urban(zoneAt(c, r)) || urban(zoneAt(c - 1, r));
  const roads = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if (roadH(c, r)) roads.push({ x0: seaWidth + c * cell, y0: r * cell, x1: seaWidth + (c + 1) * cell, y1: r * cell, horiz: true });
  for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) if (roadV(c, r)) roads.push({ x0: seaWidth + c * cell, y0: r * cell, x1: seaWidth + c * cell, y1: (r + 1) * cell, horiz: false });

  function streetDressing(zc) {
    const { x, y, w, style } = zc;
    const isUrban = style !== 'forest' && style !== 'park';
    const edges = [
      { has: roadH(zc.c, zc.r), horiz: true, at: y - 8, out: -1 },
      { has: roadH(zc.c, zc.r + 1), horiz: true, at: y + w + 8, out: 1 },
      { has: roadV(zc.c, zc.r), horiz: false, at: x - 8, out: -1 },
      { has: roadV(zc.c + 1, zc.r), horiz: false, at: x + w + 8, out: 1 },
    ];
    const lampType = style === 'neon' ? 'neon_lamp' : 'lamppost';
    for (const e of edges) {
      if (!e.has) continue;
      for (let t = 30; t < w; t += isUrban ? 70 : 140) {
        const px = e.horiz ? x + t : e.at;
        const py = e.horiz ? e.at : y + t;
        if (!isWater(px, py)) addProp(lampType, px, py, e.horiz ? (e.out > 0 ? 2 : 0) : e.out > 0 ? 1 : 3);
      }
      if (!isUrban) continue;
      // Parked cars in the curb lane
      const lane = e.at + e.out * 14;
      for (let t = 20; t < w - 20; t += rng.int(18, 40)) {
        if (!rng.chance(style === 'brick' ? 0.45 : 0.35)) continue;
        const id = rng.weighted({ car: 5, hatchback: 3, taxi: style === 'neon' ? 3 : 0.5, van: 2, pickup: style === 'suburb' ? 2 : 0.5, scooter: style === 'pastel' || style === 'neon' ? 2 : 0.3, bus: 0.2, truck: style === 'brick' ? 0.6 : 0.1 });
        const px = e.horiz ? x + t : lane;
        const py = e.horiz ? lane : y + t;
        if (!isWater(px, py)) addProp(id, px, py, e.horiz ? (rng.chance(0.5) ? 0 : 2) : rng.chance(0.5) ? 1 : 3);
      }
      // Sidewalk furniture
      const furniture = {
        neon: { vending: 3, neon_pole: 2, food_cart: 2, trash_can: 2, bench: 1, newspaper_box: 1, phone_booth: 1, bus_stop: 0.5 },
        brick: { trash_can: 2, dumpster: 2, barrier: 3, drums: 2, crates: 2, power_pole: 2, hydrant: 1, cone: 2 },
        pastel: { bench: 2, planter: 3, food_cart: 1, tree_blossom: 2, palm: 2, flower_bed: 2, mailbox: 1 },
        garden: { tree_round: 3, bench: 2, planter: 2, bus_stop: 1, hydrant: 1, trash_can: 1, newspaper_box: 1 },
        docks: { container: 3, crates: 2, drums: 2, barrier: 1 },
      }[style] || { hydrant: 1, trash_can: 1, tree_round: 2, mailbox: 1, bench: 1 };
      for (let t = 50; t < w - 20; t += rng.int(25, 55)) {
        const px = e.horiz ? x + t : e.at + rng.range(-3, 3);
        const py = e.horiz ? e.at + rng.range(-3, 3) : y + t;
        if (!isWater(px, py)) addProp(rng.weighted(furniture), px, py, e.horiz ? 0 : 1);
      }
    }
    if (isUrban && (style === 'neon' || style === 'garden' || style === 'brick') && roadH(zc.c, zc.r) && roadV(zc.c, zc.r)) addProp('traffic_light', x - 14, y - 14);
  }

  // Pick a type whose street frontage and depth fit, regardless of how it will be rotated.
  const pickFit = (zoneKeys, tier, maxFront, maxDepth) => {
    const pool = BUILDING_TYPES.filter((t) => t.weight > 0 && t.zones.some((z) => zoneKeys.includes(z)));
    const weights = {};
    for (const t of pool) {
      const tierFit = t.tier === tier ? 1 : t.tier === tier - 1 ? 0.35 : t.tier === tier + 1 ? 0.12 : 0.02;
      weights[t.id] = t.weight * tierFit;
    }
    if (!Object.keys(weights).length) return null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = rng.weighted(weights);
      const variant = rng.int(0, VARIANTS - 1);
      const d = buildingDims(id, variant);
      if (d.w <= maxFront && d.h <= maxDepth && !(TYPE_BY_ID[id].unique && uniquePlaced.has(id))) return { id, variant, d };
    }
    return null;
  };

  // Street-frontage packing: buildings line every street edge shoulder to shoulder,
  // so blocks read as dense city with no stray empty lots.
  function fillUrban(zc) {
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
    }
    packRect(x, y, w, w, style, zoneKeys, tier, 0);
  }

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
          // Too narrow for any building: a tree or planter fills the gap.
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
    const top = placeRow(x, y, 1, 0, 0, 1, w, 2);
    const bot = placeRow(x, y + h, 1, 0, 0, -1, w, 0);
    const inner0 = y + top + 4;
    const inner1 = y + h - bot - 4;
    const left = placeRow(x, inner0, 0, 1, 1, 0, inner1 - inner0, 3);
    const right = placeRow(x + w, inner0, 0, 1, -1, 0, inner1 - inner0, 1);
    const cx0 = x + left + 4;
    const cx1 = x + w - right - 4;
    // A big courtyard gets an inner ring of smaller buildings along a back alley.
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
    if (style === 'brick' || style === 'docks' || style === 'neon' || rng.chance(0.4)) {
      // Parking lot
      for (let px = x0 + 8; px < x1 - 6; px += 9) {
        for (let py = y0 + 8; py < y1 - 6; py += 16) {
          if (rng.chance(0.65)) addProp(style === 'docks' ? 'container' : rng.pick(['car', 'hatchback', 'van', 'taxi', 'pickup']), px, py, 1);
        }
      }
      return;
    }
    for (let i = 0; i < Math.min(14, Math.floor((cw * ch) / 500)); i++) {
      addProp(rng.weighted({ tree_round: 3, tree_blossom: style === 'pastel' ? 3 : 1, palm: style === 'pastel' ? 2 : 0, bench: 2, flower_bed: 2, planter: 2, picnic_table: 1 }), rng.range(x0 + 6, x1 - 6), rng.range(y0 + 6, y1 - 6), rng.int(0, 3));
    }
  }

  function fillSuburb(zc) {
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
        const d = buildingDims(pick.id, pick.variant);
        const bw = rot % 2 ? d.h : d.w;
        const bh = rot % 2 ? d.w : d.h;
        // House sits toward the street; the backyard is behind it.
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
      addBuilding(shed, rng.chance(0.5) ? yx0 + 9 : yx1 - 9, rng.chance(0.5) ? yy0 + 8 : yy1 - 8, rng.int(0, 3));
    }
    const items = { tree_round: 2, tree_autumn: 1, swing_set: 1, trampoline: 1, pool: 0.8, hot_tub: 0.5, bbq: 1.5, doghouse: 1, picnic_table: 1, lawn_chair: 2, gnome: 1.5, flower_bed: 2, bush: 2, bike: 1 };
    const n = rng.int(4, 8);
    for (let i = 0; i < n; i++) {
      const p = spot();
      addProp(rng.weighted(items), p.x, p.y, rng.int(0, 3));
    }
  }

  function fillPark(zc) {
    const { x, y, w } = zc;
    addProp('fountain', x + w / 2, y + w / 2);
    for (let i = 0; i < 26; i++) {
      const px = x + rng.range(10, w - 10);
      const py = y + rng.range(10, w - 10);
      if (Math.hypot(px - x - w / 2, py - y - w / 2) < 30 || isWater(px, py)) continue;
      addProp(rng.weighted({ tree_round: 4, tree_blossom: 2, tree_birch: 2, bush: 3, bench: 2, flower_bed: 2, picnic_table: 1, lamppost: 1 }), px, py, rng.int(0, 3));
    }
  }

  function fillForest(zc) {
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
      if (isWater(px, py)) continue;
      if (clearing && Math.hypot(px - x - w / 2, py - y - w / 2) < 90) continue;
      addProp(rng.weighted({ tree_pine: 5, tree_pine_tall: 3, tree_round: 1.5, tree_birch: 1.5, tree_autumn: 1, bush: 2, rock: 1.2, log: 0.5, hay: 0.1 }), px, py, rng.int(0, 3));
    }
  }

  for (const zc of cells) {
    if (zc.style === 'water') continue;
    streetDressing(zc);
    if (zc.style === 'forest') fillForest(zc);
    else if (zc.style === 'park') fillPark(zc);
    else if (zc.style === 'suburb') fillSuburb(zc);
    else fillUrban(zc);
  }

  // ---- the suspension bridge across the lake, on the highway row
  const bridges = [];
  {
    const by = HIGHWAY_ROW * cell;
    let xa = LAKE.cx - LAKE.rx * 1.3;
    let xb = LAKE.cx + LAKE.rx * 1.3;
    while (!isWater(xa, by) && xa < LAKE.cx) xa += 10;
    while (!isWater(xb, by) && xb > LAKE.cx) xb -= 10;
    xa -= 60;
    xb += 60;
    // Nothing else stands on the bridge line.
    for (const o of objects) if (o.x > xa && o.x < xb && Math.abs(o.y - by) < 60) o.state = 'removed';
    const dd = buildingDims('bridge_deck', 0);
    const decks = [];
    for (let x = xa; x < xb; x += dd.w) decks.push(addBuilding('bridge_deck', x + dd.w / 2, by, 0, 0));
    const span = xb - xa;
    const t1 = addBuilding('bridge_tower', xa + span * 0.24, by, 0, 0);
    const t2 = addBuilding('bridge_tower', xa + span * 0.76, by, 0, 0);
    bridges.push({ kind: 'suspension', x0: xa, x1: xb, y: by, towers: [t1, t2], decks, deckHeight: (dd.by - 1) * dd.v, towerHeight: t1.height });
    for (let x = xa; x < xb; x += 140) {
      lights.push({ x, y: by - 50, h: 60, color: 0xffd38a });
      lights.push({ x, y: by + 50, h: 60, color: 0xffd38a });
    }
  }
  // Road bridges where other roads cross the river
  for (const rd of roads) {
    if (!rd.horiz || rd.y0 === HIGHWAY_ROW * cell) continue;
    const wet = [];
    for (let x = rd.x0; x <= rd.x1; x += 24) if (isWater(x, rd.y0) && x > seaWidth + 200) wet.push(x);
    if (!wet.length || wet.length > 14) continue;
    for (const x of wet) addBuilding('road_bridge', x, rd.y0, 0, 0);
  }

  // Harbor Town's landmark: the lighthouse on a pier.
  const pier = { x: seaWidth * 0.42, y: 3 * cell, w: seaWidth * 0.6 + 40, h: 70 };
  const landmark = addBuilding('lighthouse', seaWidth * 0.42, 3 * cell, 0, 0);
  lights.push({ x: landmark.x, y: landmark.y, h: landmark.height, color: 0xfff2a8, big: true });
  for (let i = 0; i < 18; i++) {
    const bx = rng.range(80, seaWidth - 80);
    const by = rng.range(200, WORLD.height - 200);
    if (isWater(bx, by)) addProp('boat', bx, by, rng.int(0, 3));
  }

  // ---- spawn: a backyard in the eastern suburbs
  let spawn = null;
  let bestD = Infinity;
  for (const zc of cells) {
    if (zc.style !== 'suburb') continue;
    const d = Math.hypot(zc.c - 20, zc.r - 10);
    if (d < bestD) {
      bestD = d;
      spawn = { x: zc.x + zc.w / 2, y: zc.y + zc.w / 2 };
    }
  }
  spawn = spawn || { x: WORLD.width - 600, y: WORLD.height / 2 };

  // Clear the drop-in point of anything taller than a person.
  for (const o of objects) {
    if (o.tier >= 2 && Math.abs(o.x - spawn.x) < 12 + o.w / 2 && Math.abs(o.y - spawn.y) < 12 + o.h / 2) o.state = 'removed';
  }
  const live = objects.filter((o) => o.state !== 'removed');
  live.forEach((o, i) => (o.id = i));
  const liveLights = lights.filter((l) => !l.obj || l.obj.state !== 'removed');
  for (const b of bridges) b.decks = b.decks.filter((d) => d.state !== 'removed');

  const grid = new SpatialGrid(WORLD.width, WORLD.height);
  for (const o of live) grid.insert(o);
  return { objects: live, cells, roads, lights: liveLights, bridges, spawn, grid, landmark, pier, lake: LAKE, highwayRow: HIGHWAY_ROW };
}

export const WORLD_LAYOUT = { DISTRICTS, LAKE };
