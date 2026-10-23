import { WORLD, TIER_HP, LANDMARK_HP } from './config.js';
import { createRng } from './rng.js';

// Destructible object kinds. Tier = the growth stage at which this object is "your size".
export const KINDS = {
  car: { tier: 1, w: [12, 13], h: [7, 7], height: 4, vehicle: true, colors: ['#d64545', '#3f7fd1', '#f0c33c', '#e8e8e8', '#4b4b4b', '#5cb85c'] },
  lamppost: { tier: 1, value: 0.3, w: [3, 3], h: [3, 3], height: 12, colors: ['#9aa0a6'] },
  kiosk: { tier: 1, w: [9, 10], h: [9, 10], height: 7, colors: ['#e07b39', '#2f9e8f', '#c94f7c'] },
  fence: { tier: 1, value: 0.3, w: [22, 30], h: [2, 2], height: 4, colors: ['#c8b38a'] },
  tree: { tier: 1, value: 0.3, w: [9, 12], h: [9, 12], height: 10, round: true, colors: ['#3e8e41', '#4f9d3a', '#2f7a3a'] },
  container: { tier: 1, value: 0.5, w: [15, 15], h: [6, 6], height: 6, colors: ['#c0392b', '#2980b9', '#27ae60', '#e67e22'] },
  house: { tier: 2, w: [32, 44], h: [30, 40], height: 18, structure: true, colors: ['#e8d8c3', '#d9c2a5', '#cfe0e8', '#f1e0b0'], roof: ['#a8443a', '#6b4a3a', '#4a5d7a'] },
  shop: { tier: 2, w: [38, 54], h: [28, 38], height: 16, structure: true, colors: ['#f2efe6', '#e9d7c0', '#d6e6d0'], roof: ['#7c8a99', '#8a7c6c'] },
  gasStation: { tier: 2, w: [50, 56], h: [36, 42], height: 10, structure: true, colors: ['#f4f4f4'], roof: ['#d94141'] },
  warehouse: { tier: 2, w: [56, 64], h: [36, 44], height: 18, structure: true, colors: ['#b9b2a3'], roof: ['#8f877a'] },
  apartment: { tier: 3, w: [70, 95], h: [70, 95], height: 55, structure: true, colors: ['#cfc7b8', '#bfb3a3', '#d8cdb9', '#b7c0c8'], roof: ['#7d7468', '#6c7680'] },
  garage: { tier: 3, w: [100, 120], h: [80, 90], height: 30, structure: true, colors: ['#a9a9a9'], roof: ['#8a8a8a'] },
  crane: { tier: 3, w: [40, 44], h: [40, 44], height: 90, structure: true, colors: ['#e3a72f'], roof: ['#c98a17'] },
  skyscraper: { tier: 4, w: [110, 150], h: [110, 150], height: 200, structure: true, colors: ['#8fb3cf', '#9aa8b8', '#7f9db9', '#a7b7c4'], roof: ['#5c6f80', '#4d5c6b'] },
  stadium: { tier: 4, w: [260, 280], h: [200, 220], height: 50, structure: true, colors: ['#d0d4d8'], roof: ['#4f9d3a'] },
  powerPlant: { tier: 4, w: [170, 190], h: [130, 150], height: 60, structure: true, power: true, colors: ['#b8b0a0'], roof: ['#8d8576'] },
  lighthouse: { tier: 5, w: [100, 100], h: [100, 100], height: 420, structure: true, landmark: true, round: true, colors: ['#f4f4f4'], roof: ['#d23c3c'] },
};

// Uniform grid for fast area queries over thousands of static objects.
export class SpatialGrid {
  constructor(width, height, cellSize = 256) {
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

export function generateCity(seed = 1) {
  const rng = createRng(seed);
  const objects = [];
  const blocks = [];
  const { cell, road, cols, rows, seaWidth } = WORLD;
  const spawn = { x: WORLD.width - 110, y: WORLD.height / 2 };
  const maxDist = Math.hypot(WORLD.width - seaWidth, WORLD.height / 2);

  const add = (kind, x, y, opts = {}) => {
    const k = KINDS[kind];
    let w = Math.round(rng.range(k.w[0], k.w[1]));
    let h = k.round ? w : Math.round(rng.range(k.h[0], k.h[1]));
    if (opts.rotate) [w, h] = [h, w];
    const landmark = Boolean(k.landmark);
    const hp = landmark ? LANDMARK_HP : TIER_HP[k.tier];
    const obj = {
      id: objects.length,
      kind,
      tier: k.tier,
      x, y, w, h,
      height: k.height * rng.range(0.85, 1.2),
      hp, maxHp: hp,
      state: 'intact',
      structure: Boolean(k.structure),
      vehicle: Boolean(k.vehicle),
      power: Boolean(k.power),
      round: Boolean(k.round),
      landmark,
      value: k.value ?? 1,
      color: rng.pick(k.colors),
      roof: k.roof ? rng.pick(k.roof) : null,
      seed: rng.int(0, 1e9),
      flash: 0,
    };
    objects.push(obj);
    return obj;
  };

  const blockInner = cell - road;
  const placed = { stadium: false };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = seaWidth + c * cell + road / 2;
      const y0 = r * cell + road / 2;
      const cx = x0 + blockInner / 2;
      const cy = y0 + blockInner / 2;
      const d = Math.hypot(cx - spawn.x, cy - spawn.y) / maxDist + rng.range(-0.06, 0.06);
      let zone = d < 0.3 ? 'suburb' : d < 0.62 ? 'commercial' : 'downtown';
      if (c === 0) zone = 'docks';
      blocks.push({ x: x0, y: y0, w: blockInner, h: blockInner, zone });

      // Street furniture and parked cars along the block's road edges.
      for (let t = 30; t < blockInner; t += 120) {
        add('lamppost', x0 + t, y0 - 6);
        add('lamppost', x0 - 6, y0 + t);
      }
      const cars = rng.int(2, 5);
      for (let i = 0; i < cars; i++) {
        const horiz = rng.chance(0.5);
        const t = rng.range(20, blockInner - 20);
        const lane = rng.pick([-18, -42]);
        if (horiz && r > 0) add('car', x0 + t, y0 + lane);
        else if (!horiz) add('car', x0 + lane, y0 + t, { rotate: true });
      }

      if (zone === 'suburb') fillSuburb(add, rng, x0, y0, blockInner);
      else if (zone === 'commercial') fillCommercial(add, rng, x0, y0, blockInner);
      else if (zone === 'downtown') fillDowntown(add, rng, x0, y0, blockInner, placed);
      else fillDocks(add, rng, x0, y0, blockInner);
    }
  }

  // Harbor Town's landmark stands on a pier in the sea.
  const lighthouse = add('lighthouse', seaWidth * 0.45, WORLD.height * 0.32);
  const pier = { x: seaWidth * 0.45, y: WORLD.height * 0.32, w: seaWidth * 0.55 + 20, h: 60 };

  // Keep the drop-in point clear so the first seconds are smashing, not stuck on a house.
  const clear = objects.filter((o) => o.tier >= 2 && Math.hypot(o.x - spawn.x, o.y - spawn.y) < 90);
  for (const o of clear) o.state = 'removed';
  const live = objects.filter((o) => o.state !== 'removed');
  live.forEach((o, i) => (o.id = i));

  const grid = new SpatialGrid(WORLD.width, WORLD.height);
  for (const o of live) grid.insert(o);
  return { objects: live, blocks, spawn, grid, landmark: lighthouse, pier };
}

function fillSuburb(add, rng, x0, y0, size) {
  const lots = 3;
  const lot = size / lots;
  for (let i = 0; i < lots; i++) {
    for (let j = 0; j < lots; j++) {
      const lx = x0 + i * lot;
      const ly = y0 + j * lot;
      if (rng.chance(0.82)) add('house', lx + lot / 2 + rng.range(-8, 8), ly + lot / 2 + rng.range(-8, 8));
      const trees = rng.int(0, 2);
      for (let t = 0; t < trees; t++) add('tree', lx + rng.range(12, lot - 12), ly + rng.range(10, 22));
      if (rng.chance(0.5)) add('fence', lx + lot / 2, ly + lot - 8);
      if (rng.chance(0.15)) add('kiosk', lx + rng.range(15, lot - 15), ly + lot - 20);
    }
  }
}

function fillCommercial(add, rng, x0, y0, size) {
  const lot = size / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const lx = x0 + i * lot;
      const ly = y0 + j * lot;
      const cx = lx + lot / 2;
      const cy = ly + lot / 2;
      const roll = rng.next();
      if (roll < 0.45) add('apartment', cx, cy);
      else if (roll < 0.58) add('garage', cx, cy);
      else if (roll < 0.85) {
        add('shop', lx + lot * 0.3, ly + lot * 0.3);
        add('shop', lx + lot * 0.7, ly + lot * 0.32);
        if (rng.chance(0.6)) add('shop', lx + lot * 0.5, ly + lot * 0.72);
      } else {
        add('gasStation', cx, cy);
        add('car', cx - 10, cy + 30);
      }
      if (rng.chance(0.4)) add('kiosk', lx + rng.range(12, lot - 12), ly + lot - 10);
      if (rng.chance(0.5)) add('tree', lx + 10, ly + rng.range(10, lot - 10));
    }
  }
}

function fillDowntown(add, rng, x0, y0, size, placed) {
  if (!placed.stadium && rng.chance(0.08)) {
    placed.stadium = true;
    add('stadium', x0 + size / 2, y0 + size / 2);
    return;
  }
  if (rng.chance(0.07)) {
    add('powerPlant', x0 + size / 2, y0 + size / 2);
    for (let i = 0; i < 3; i++) add('kiosk', x0 + 20 + i * 40, y0 + size - 15);
    return;
  }
  const lot = size / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const lx = x0 + i * lot;
      const ly = y0 + j * lot;
      if (rng.chance(0.8)) add('skyscraper', lx + lot / 2, ly + lot / 2);
      else {
        add('apartment', lx + lot / 2, ly + lot / 2);
        add('tree', lx + 14, ly + 14);
      }
      if (rng.chance(0.5)) add('kiosk', lx + rng.range(10, lot - 10), ly + 8);
    }
  }
}

function fillDocks(add, rng, x0, y0, size) {
  add('warehouse', x0 + size * 0.7, y0 + size * 0.25);
  if (rng.chance(0.6)) add('crane', x0 + 30, y0 + size * 0.5);
  else add('warehouse', x0 + size * 0.7, y0 + size * 0.65);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      if (rng.chance(0.7)) add('container', x0 + 90 + j * 22, y0 + size * 0.55 + i * 12);
    }
  }
}
