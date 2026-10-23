// Procedural voxel building catalog. Every type builds a VoxelGrid from a seeded RNG,
// so a (type, variant) pair always yields the same building. Pure data, no rendering.
import {
  VoxelGrid, E, W, body, cornice, parapet, pitchedRoof, roofClutter, garden, vines, sign, awning,
  neonStrip, brick, shade, hash3, eachWall,
} from './voxel.js';
import { createRng } from './rng.js';

const WARM = [0xffd38a, 0xffc36b, 0xffe2a8, 0xffb35c];
const COOL = [0xbfe6ff, 0xa8d8ff, 0xd8f0ff];
const NEON = [0xff2bd6, 0x22e6ff, 0xffd23f, 0x7b5cff, 0xff4d6d, 0x39ff88, 0xff8a1f];

export const PALETTES = {
  suburb: { walls: [0xe9e2d0, 0xcfe0e8, 0xf1e0b0, 0xd9c2a5, 0xbfd6c0, 0xf3f0ea], roofs: [0x8a3d32, 0x5b4636, 0x4a5d7a, 0x6b6f75], glass: 0x3b5570, lit: WARM },
  pastel: { walls: [0xf2a7a0, 0xf6c1b4, 0xf2cf6b, 0xa8d8c4, 0xf3e3c7, 0xf5b98a, 0xc9b6e4], roofs: [0xc86a4a, 0xb85c3e], glass: 0x4a4a66, lit: WARM, trim: 0xfaf3e8 },
  garden: { walls: [0xe9e6df, 0xd9573b, 0xb8bcc2, 0xdcd3c0, 0xf0ece4], roofs: [0x8f939a], glass: 0x3d5266, lit: [...WARM, ...COOL] },
  brick: { walls: [0x8a3b2a, 0xa14a34, 0x6e2f22, 0x7c4a3a], concrete: [0x8d8a83, 0xa8a399, 0x6f6c66], roofs: [0x77736c], glass: 0x2f3a44, lit: WARM },
  neon: { walls: [0x2a2f3a, 0x1f2430, 0x3a3550, 0x2d3440, 0x403a4a], roofs: [0x22252c], glass: 0x1d2b3d, lit: [...COOL, ...WARM], neon: NEON },
  forest: { walls: [0x7a5232, 0x5e3f26, 0x8a6a48], roofs: [0x3f5f34, 0x6b3a2a, 0x4a4a4a], glass: 0x2b3a3a, lit: WARM },
  docks: { walls: [0x8c8f94, 0x6f8fa8, 0xa89a7a, 0x9a5a3a], roofs: [0x5a5d63], glass: 0x334455, lit: WARM },
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- generic block building
// d: { bx, bz, by, m } in voxels. o: options describing the look.
function block(g, rng, d, o) {
  const x0 = d.m;
  const z0 = d.m;
  const x1 = d.m + d.bx;
  const z1 = d.m + d.bz;
  const floorH = o.floorH || 4;
  const top = o.y0 ?? 0;
  const y1 = top + d.by;
  body(g, rng, {
    x0, z0, x1, z1, y0: top, y1, floorH, wall: o.wall, interior: o.interior,
    win: o.win, groundFloor: Boolean(o.shop || o.shutters),
  });
  if (o.shop) storefront(g, rng, x0, z1, x1, top, floorH, o.shop);
  if (o.shutters) shutters(g, rng, x0, z1, x1, top, floorH, o.shutters);
  if (o.cornice) for (const y of o.cornice === true ? [y1 - 1] : o.cornice) cornice(g, x0, z0, x1, z1, y, o.corniceColor ?? shade(typeof o.wall === 'number' ? o.wall : 0x999999, 0.8));
  if (o.bands) for (let y = top + floorH; y < y1 - 1; y += floorH * o.bands.every) cornice(g, x0, z0, x1, z1, y, o.bands.color, 1);
  if (o.balconies) balconies(g, rng, x0, z1, x1, top, y1, floorH, o.balconies);
  if (o.fireEscape) fireEscape(g, x1, z0, z1, top + floorH, y1, floorH);
  if (o.acFacade) acUnits(g, rng, x0, z0, x1, z1, top + floorH, y1, floorH, o.acFacade);
  if (o.neon) neonDress(g, rng, x0, z0, x1, z1, top, y1, floorH, o.neon);
  if (o.parapet !== false) parapet(g, x0, z0, x1, z1, y1, o.parapetColor ?? shade(typeof o.wall === 'number' ? o.wall : 0x888888, 0.75));
  const roofY = y1 + (o.parapet !== false ? 0 : 0);
  g.box(x0 + 1, y1, z0 + 1, x1 - 1, y1 + 1, z1 - 1, o.roof ?? 0x77736c);
  if (o.garden) garden(g, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, y1 + 1, o.garden);
  if (o.clutter !== false) roofClutter(g, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, roofY + 1, o.clutter || {});
  if (o.roofSign) roofBillboard(g, rng, x0, x1, z0, z1, roofY + 1, o.roofSign);
  if (o.vines) vines(g, rng, x0, z0, x1, z1, y1, o.vines);
  return { x0, z0, x1, z1, y1 };
}

function storefront(g, rng, x0, z, x1, y0, floorH, o) {
  const zf = z - 1;
  const door = Math.floor((x0 + x1) / 2);
  for (let x = x0 + 1; x < x1 - 1; x++) {
    for (let y = y0; y < y0 + floorH - 1; y++) {
      if (Math.abs(x - door) <= 0 && y < y0 + 3) g.set(x, y, zf, 0x2a1d14);
      else if ((x - x0) % 5 === 0) g.set(x, y, zf, o.frame ?? 0x3a3a40);
      else g.set(x, y, zf, rng.pick(o.glow || WARM), W);
    }
  }
  if (o.awning) awning(g, x0 + 1, x1 - 1, y0 + floorH - 1, z, o.awning, 2);
  if (o.sign) sign(g, rng, 0, door, y0 + floorH, Math.min(x1 - x0 - 2, o.signLen || 9), 3, z, o.signColors || NEON, { seed: rng.int(0, 99) });
}

function shutters(g, rng, x0, z, x1, y0, floorH, o) {
  const zf = z - 1;
  for (let x = x0 + 1; x < x1 - 1; x++) {
    const bay = Math.floor((x - x0 - 1) / 5);
    const isPost = (x - x0 - 1) % 5 === 4;
    const open = hash3(bay, 3, x0) < (o.openChance ?? 0.25);
    for (let y = y0; y < y0 + floorH - 1; y++) {
      if (isPost) g.set(x, y, zf, o.post ?? 0x5a5650);
      else if (open) g.set(x, y, zf, y < y0 + 2 ? 0x1a1a1a : rng.pick(WARM), y < y0 + 2 ? 0 : W);
      else g.set(x, y, zf, y % 2 ? 0x9a9da3 : 0x84878d);
    }
  }
  if (o.sign) sign(g, rng, 0, Math.floor((x0 + x1) / 2), y0 + floorH, Math.min(x1 - x0 - 2, 12), 3, z, o.signColors || [0xffd23f], { seed: rng.int(0, 99), bg: 0x2a2015 });
}

function balconies(g, rng, x0, z, x1, y0, y1, floorH, o) {
  for (let y = y0 + floorH; y < y1 - 1; y += floorH * (o.every || 1)) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const bay = Math.floor((x - x0) / (o.width || 6));
      if ((x - x0) % (o.width || 6) === 0) continue;
      if (o.alternate && (bay + y) % 2) continue;
      g.set(x, y, z, o.slab ?? 0xcfcac0);
      g.set(x, y + 1, z + 0, o.rail ?? 0x55585e);
      if (o.plants && hash3(x, y, z) < 0.3) g.set(x, y + 1, z, 0x4f8f34);
      if (o.laundry && hash3(x, y, 9) < 0.15) g.set(x, y + 2, z, rng.pick([0xe8e8e8, 0xd94f4f, 0x4f7fd9]));
    }
  }
}

function fireEscape(g, x, z0, z1, y0, y1, floorH) {
  const za = z0 + 2;
  const zb = Math.min(z1 - 2, za + 6);
  for (let y = y0; y < y1 - 1; y += floorH) {
    for (let z = za; z < zb; z++) g.set(x, y, z, 0x2b2d31);
    for (let k = 0; k < floorH; k++) g.set(x, y + k, za + Math.floor((k / floorH) * (zb - za)), 0x3a3c41);
  }
}

function acUnits(g, rng, x0, z0, x1, z1, y0, y1, floorH, chance) {
  eachWall(x0, z0, x1, z1, y0, y1, (x, y, z, side) => {
    if ((y - y0) % floorH !== 0 || hash3(x, y, z) > chance) return;
    const o = side === 0 ? { x, z: z + 1 } : side === 1 ? { x, z: z - 1 } : side === 2 ? { x: x + 1, z } : { x: x - 1, z };
    g.set(o.x, y, o.z, 0xc9cbd0);
    g.set(o.x, y + 1, o.z, 0xb0b3b8);
  });
}

function neonDress(g, rng, x0, z0, x1, z1, y0, y1, floorH, o) {
  const cols = o.colors || NEON;
  const c1 = rng.pick(cols);
  const c2 = rng.pick(cols);
  if (o.corners) {
    neonStrip(g, x0 - 1, y0 + 2, y1, z1, c1);
    neonStrip(g, x1, y0 + 2, y1, z1, c1);
    if (o.corners > 1) {
      neonStrip(g, x0 - 1, y0 + 2, y1, z0 - 1, c2);
      neonStrip(g, x1, y0 + 2, y1, z0 - 1, c2);
    }
  }
  if (o.bands) {
    for (let y = y0 + floorH * 2; y < y1; y += floorH * o.bands) {
      for (let x = x0; x < x1; x++) g.set(x, y, z1, c2, E);
      for (let z = z0; z < z1; z++) g.set(x1, y, z, c2, E);
    }
  }
  if (o.verticalSign) {
    const h = Math.min(y1 - y0 - 4, rng.int(10, 22));
    const ys = rng.int(y0 + floorH, Math.max(y0 + floorH, y1 - h - 1));
    const x = rng.chance(0.5) ? x0 + 1 : x1 - 2;
    const c = rng.pick(cols);
    for (let y = ys; y < ys + h; y++) {
      for (let dz = 0; dz < 2; dz++) {
        const glyph = hash3(x, y >> 1, dz) < 0.55 || y === ys || y === ys + h - 1;
        g.set(x, y, z1 + dz, glyph ? c : 0x111116, glyph ? E : 0);
      }
    }
  }
  if (o.billboards) {
    const n = o.billboards;
    for (let i = 0; i < n; i++) {
      const len = rng.int(6, Math.max(7, Math.min(16, x1 - x0 - 2)));
      const h = rng.int(4, 8);
      const y = rng.int(y0 + floorH * 2, Math.max(y0 + floorH * 2, y1 - h - 2));
      if (rng.chance(0.5)) sign(g, rng, 0, rng.int(x0 + len / 2 + 1, x1 - len / 2 - 1), y, len, h, z1, cols, { seed: rng.int(0, 99) });
      else sign(g, rng, 2, rng.int(z0 + len / 2 + 1, z1 - len / 2 - 1), y, len, h, x1, cols, { seed: rng.int(0, 99) });
    }
  }
}

function roofBillboard(g, rng, x0, x1, z0, z1, y, o) {
  const len = Math.min(x1 - x0 - 2, o.len || 14);
  const h = o.h || 6;
  const cx = Math.floor((x0 + x1) / 2);
  const z = Math.floor((z0 + z1) / 2) + 1;
  for (const px of [cx - Math.floor(len / 2) + 1, cx + Math.floor(len / 2) - 2]) g.box(px, y, z, px + 1, y + 3, z + 1, 0x4a4d52);
  sign(g, rng, 0, cx, y + 3, len, h, z, o.colors || [0xffd23f, 0xff8a1f], { seed: rng.int(0, 99), bg: o.bg ?? 0xf2c230, frame: o.frame ?? 0x7a5a18 });
}

// ---------------------------------------------------------------- special builders
function gableHouse(g, rng, d, P, opts = {}) {
  const wall = rng.pick(P.walls);
  const b = block(g, rng, d, {
    wall, floorH: 4, win: { w: 2, h: 2, gap: 3, sill: 1, glass: P.glass, lit: P.lit, litChance: 0.6, frame: 0xf6f3ee },
    parapet: false, clutter: false, roof: rng.pick(P.roofs),
  });
  const door = Math.floor((b.x0 + b.x1) / 2);
  g.box(door, 0, b.z1 - 1, door + 2, 3, b.z1, 0x5a3b28);
  g.box(door - 1, 0, b.z1, door + 3, 1, b.z1 + 1, 0x9b9b9b);
  const roof = opts.roof ?? rng.pick(P.roofs);
  const alongX = d.bx >= d.bz;
  const top = pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, roof, alongX);
  if (rng.chance(0.7)) g.box(b.x1 - 3, b.y1, b.z0 + 2, b.x1 - 1, top + 1, b.z0 + 4, 0x7a4a3a);
  if (opts.porch) {
    g.box(b.x0, 3, b.z1, b.x1, 4, b.z1 + 2, roof);
    for (let x = b.x0; x < b.x1; x += 4) g.box(x, 0, b.z1 + 1, x + 1, 3, b.z1 + 2, 0xf3f0ea);
  }
}

function gasStation(g, rng, d) {
  const m = d.m;
  const shopW = Math.floor(d.bx * 0.4);
  block(g, rng, { ...d, bx: shopW, by: 5 }, { wall: 0xf2f2f2, floorH: 5, shop: { awning: null, sign: true, signLen: 7, signColors: [0xff3b3b, 0x22e6ff] }, clutter: { sparse: true, kinds: ['ac'] } });
  const cx0 = m + shopW + 2;
  const cx1 = m + d.bx;
  for (const x of [cx0, cx1 - 1]) for (const z of [m + 2, m + d.bz - 3]) g.box(x, 0, z, x + 1, 6, z + 1, 0xdedede);
  g.box(cx0 - 1, 6, m + 1, cx1 + 1, 7, m + d.bz - 1, 0xffffff);
  g.box(cx0 - 1, 7, m + 1, cx1 + 1, 8, m + d.bz - 1, (x) => (x % 2 ? 0xd93636 : 0xffffff));
  for (let x = cx0 - 1; x < cx1 + 1; x++) g.set(x, 5, m + d.bz - 1, 0xfff4c2, E);
  for (let x = cx0 + 2; x < cx1 - 1; x += 4) {
    g.box(x, 0, m + Math.floor(d.bz / 2) - 1, x + 1, 3, m + Math.floor(d.bz / 2) + 1, 0x3b6fd1);
    g.set(x, 2, m + Math.floor(d.bz / 2), 0x9fe8ff, E);
  }
  // Price sign pole
  g.box(m + d.bx - 1, 0, m + d.bz, m + d.bx, 10, m + d.bz + 1, 0x777777);
  g.box(m + d.bx - 3, 10, m + d.bz, m + d.bx + 1, 14, m + d.bz + 1, (x, y) => (y === 13 ? 0xd93636 : 0x1a1a1a));
  for (let y = 10; y < 13; y++) g.set(m + d.bx - 2, y, m + d.bz, 0x6bff8a, E);
}

function church(g, rng, d, P) {
  const m = d.m;
  const wall = rng.pick([0xe8e2d4, 0xd8cdb8, 0xc9c2b0]);
  const naveH = Math.floor(d.by * 0.45);
  block(g, rng, { ...d, by: naveH }, { wall, floorH: naveH, win: { w: 2, h: naveH - 3, gap: 4, sill: 2, glass: 0x5a3f8a, lit: [0xffb35c, 0xff7fbf, 0x7fbfff], litChance: 0.8, arch: true }, parapet: false, clutter: false });
  pitchedRoof(g, m, m, m + d.bx, m + d.bz, naveH, 0x5b4636, d.bx < d.bz);
  const tw = Math.max(4, Math.floor(Math.min(d.bx, d.bz) * 0.35));
  const tx = m + Math.floor(d.bx / 2 - tw / 2);
  const tz = m + d.bz - tw;
  body(g, rng, { x0: tx, z0: tz, x1: tx + tw, z1: tz + tw, y0: 0, y1: d.by, floorH: 6, wall, win: { w: 1, h: 3, gap: tw - 2, sill: 2, glass: 0x222233, lit: [0xffd38a], litChance: 0.3 } });
  for (let s = 0; s < tw; s++) g.box(tx + Math.floor(s / 2), d.by + s, tz + Math.floor(s / 2), tx + tw - Math.floor(s / 2), d.by + s + 1, tz + tw - Math.floor(s / 2), 0x4a5d7a);
  g.set(tx + Math.floor(tw / 2), d.by - 3, tz + tw, 0xfff4c2, E);
}

function cylTower(g, rng, d, P, o = {}) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const r = d.bx / 2 - 0.5;
  const wall = o.wall ?? rng.pick(P.walls);
  const cols = P.neon || NEON;
  const ringC = rng.pick(cols);
  const ring2 = rng.pick(cols);
  g.cylinder(cx, cz, r - 1.5, 0, d.by, 0x1b1c22);
  for (let y = 0; y < d.by; y++) {
    const ring = y > 3 && y % (o.ringEvery || 9) === 0;
    const winRow = y % 3 !== 0;
    g.cylinder(cx, cz, ring ? r + 1 : r, y, y + 1, (x, yy, z) => {
      if (ring) return ringC;
      const a = Math.atan2(z - cz, x - cx);
      const col = Math.floor((a + Math.PI) * r * 0.5);
      if (winRow && col % 3 !== 0) return hash3(col, Math.floor(y / 3), 5) < 0.6 ? rng.pick(P.lit) : P.glass;
      return wall;
    }, 0, true);
    if (ring) g.cylinder(cx, cz, r + 1, y, y + 1, ringC, E, true);
  }
  // Lit windows need the W flag: re-flag lit colours.
  for (let y = 0; y < d.by; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    const v = g.get(x, y, z);
    if (v && (v >>> 24) === 0 && P.lit.includes(v & 0xffffff)) g.set(x, y, z, v & 0xffffff, W);
  }
  g.cylinder(cx, cz, r, d.by, d.by + 1, 0x2a2d33);
  g.cylinder(cx, cz, r * 0.6, d.by + 1, d.by + 4, wall);
  g.cylinder(cx, cz, r * 0.6 + 1, d.by + 3, d.by + 4, ring2, E, true);
  g.box(Math.floor(cx), d.by + 4, Math.floor(cz), Math.floor(cx) + 1, d.by + 4 + (o.spire || 8), Math.floor(cz) + 1, 0x9aa0a8);
  g.set(Math.floor(cx), d.by + 4 + (o.spire || 8), Math.floor(cz), 0xff3b3b, E);
}

function setbackTower(g, rng, d, P, o) {
  const tiers = o.tiers || 3;
  let x0 = d.m;
  let z0 = d.m;
  let x1 = d.m + d.bx;
  let z1 = d.m + d.bz;
  let y = 0;
  const wall = o.wall ?? rng.pick(P.walls);
  const per = Math.floor(d.by / tiers);
  for (let t = 0; t < tiers; t++) {
    const h = t === tiers - 1 ? d.by - y : per;
    body(g, rng, { x0, z0, x1, z1, y0: y, y1: y + h, floorH: o.floorH || 4, wall, win: o.win });
    cornice(g, x0, z0, x1, z1, y + h - 1, o.trim ?? shade(wall, 0.75));
    if (o.neon) neonDress(g, rng, x0, z0, x1, z1, y, y + h, 4, o.neon);
    y += h;
    g.box(x0, y, z0, x1, y + 1, z1, shade(wall, 0.7));
    if (t < tiers - 1) {
      const sx = Math.max(2, Math.floor((x1 - x0) * 0.14));
      const sz = Math.max(2, Math.floor((z1 - z0) * 0.14));
      roofClutter(g, rng, x0 + 1, z0 + 1, x0 + sx + 1, z1 - 1, y + 1, { sparse: true });
      x0 += sx;
      x1 -= sx;
      z0 += sz;
      z1 -= sz;
    }
  }
  roofClutter(g, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, y + 1, { kinds: ['ac', 'antenna', 'vent', 'dish'] });
  if (o.spire) {
    const cx = Math.floor((x0 + x1) / 2);
    const cz = Math.floor((z0 + z1) / 2);
    g.box(cx - 1, y + 1, cz - 1, cx + 2, y + 4, cz + 2, shade(wall, 0.8));
    g.box(cx, y + 4, cz, cx + 1, y + 4 + o.spire, cz + 1, 0xb8bcc4);
    g.set(cx, y + 4 + o.spire, cz, 0xff3b3b, E);
  }
}

function twinTowers(g, rng, d, P) {
  const m = d.m;
  const tw = Math.floor(d.bx * 0.4);
  const wall = rng.pick(P.walls);
  const win = { w: 2, h: 2, gap: 1, sill: 1, glass: P.glass, lit: P.lit, litChance: 0.5 };
  const h2 = d.by - rng.int(0, 6);
  body(g, rng, { x0: m, z0: m, x1: m + tw, z1: m + d.bz, y0: 0, y1: d.by, floorH: 3, wall, win });
  body(g, rng, { x0: m + d.bx - tw, z0: m, x1: m + d.bx, z1: m + d.bz, y0: 0, y1: h2, floorH: 3, wall, win });
  const sy = Math.floor(d.by * 0.6);
  g.box(m + tw, sy, m + Math.floor(d.bz / 2) - 2, m + d.bx - tw, sy + 3, m + Math.floor(d.bz / 2) + 2, 0x30343c);
  for (let x = m + tw; x < m + d.bx - tw; x++) g.set(x, sy + 1, m + Math.floor(d.bz / 2) + 2, rng.pick(P.neon || COOL), E);
  neonDress(g, rng, m, m, m + tw, m + d.bz, 0, d.by, 3, { corners: 1, colors: P.neon || NEON });
  neonDress(g, rng, m + d.bx - tw, m, m + d.bx, m + d.bz, 0, h2, 3, { corners: 1, colors: P.neon || NEON });
  g.box(m + 1, d.by, m + 1, m + tw - 1, d.by + 1, m + d.bz - 1, 0x2a2d33);
  g.box(m + d.bx - tw + 1, h2, m + 1, m + d.bx - 1, h2 + 1, m + d.bz - 1, 0x2a2d33);
  roofClutter(g, rng, m + 1, m + 1, m + tw - 1, m + d.bz - 1, d.by + 1, { kinds: ['antenna', 'dish', 'ac'] });
}

function tvTower(g, rng, d, P) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  g.cylinder(cx, cz, d.bx / 2 - 1, 0, 4, 0x6f737a);
  g.cylinder(cx, cz, 2.5, 0, d.by, (x, y) => (y % 6 === 0 ? 0xd94040 : 0xe8e8e8));
  const py = Math.floor(d.by * 0.72);
  g.cylinder(cx, cz, d.bx / 2 - 2, py, py + 2, 0x7d838c);
  g.cylinder(cx, cz, d.bx / 2 - 1, py + 2, py + 5, (x, y, z) => (hash3(x, y, z) < 0.6 ? 0xffd38a : 0x2a3344), 0);
  g.cylinder(cx, cz, d.bx / 2 - 1, py + 3, py + 4, rng.pick(P.neon || NEON), E, true);
  g.cylinder(cx, cz, d.bx / 2 - 3, py + 5, py + 7, 0x7d838c);
  g.box(Math.floor(cx), d.by, Math.floor(cz), Math.floor(cx) + 1, d.by + 12, Math.floor(cz) + 1, 0xc8ccd2);
  g.set(Math.floor(cx), d.by + 12, Math.floor(cz), 0xff3b3b, E);
}

function pyramid(g, rng, d, P) {
  const m = d.m;
  const layers = Math.floor(Math.min(d.bx, d.bz) / 2);
  const step = d.by / layers;
  const cols = P.neon || NEON;
  const ec = rng.pick(cols);
  for (let i = 0; i < layers; i++) {
    const y0 = Math.floor(i * step);
    const y1 = Math.floor((i + 1) * step);
    body(g, rng, { x0: m + i, z0: m + i, x1: m + d.bx - i, z1: m + d.bz - i, y0, y1, floorH: 3, wall: 0x2b2f3a, win: { w: 1, h: 1, gap: 1, sill: 1, glass: 0x1d2b3d, lit: P.lit, litChance: 0.5 } });
    if (i % 3 === 0) cornice(g, m + i, m + i, m + d.bx - i, m + d.bz - i, y1 - 1, ec);
  }
  // Edge strips glow
  for (let y = 0; y < g.ny; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    const v = g.get(x, y, z);
    if (v && (v & 0xffffff) === ec) g.set(x, y, z, ec, E);
  }
  const c = Math.floor(m + d.bx / 2);
  g.box(c - 1, Math.floor(d.by), c - 1, c + 2, Math.floor(d.by) + 3, c + 2, ec, E);
}

function stadium(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const rx = d.bx / 2;
  const rz = d.bz / 2;
  for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const e = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
    if (e > 1) continue;
    if (e > 0.62) {
      const h = Math.round(2 + (e - 0.62) / 0.38 * (d.by - 2));
      for (let y = 0; y < h; y++) g.set(x, y, z, y === h - 1 ? (Math.floor(Math.atan2(z - cz, x - cx) * 6) % 2 ? 0xd94040 : 0x3b6fd1) : y % 2 ? 0x9da3ab : 0xb8bec6);
      if (e > 0.94) for (let y = 0; y < h; y++) g.set(x, y, z, y % 3 === 1 ? 0xffd38a : 0xc8ccd2, y % 3 === 1 ? W : 0);
    } else {
      g.set(x, 0, z, (Math.floor(x / 3) % 2 ? 0x4f9d3a : 0x5fae44));
      if (Math.abs(x + 0.5 - cx) < 0.6 || Math.abs(e - 0.3) < 0.03) g.set(x, 0, z, 0xf2f2f2);
    }
  }
  for (const [px, pz] of [[m + 2, m + 2], [m + d.bx - 3, m + 2], [m + 2, m + d.bz - 3], [m + d.bx - 3, m + d.bz - 3]]) {
    g.box(px, 0, pz, px + 1, d.by + 8, pz + 1, 0x8a8f96);
    g.box(px - 1, d.by + 8, pz - 1, px + 2, d.by + 10, pz + 2, 0xfff6d8, E);
  }
}

function powerPlant(g, rng, d) {
  const m = d.m;
  block(g, rng, { ...d, bx: Math.floor(d.bx * 0.55), by: Math.floor(d.by * 0.4) }, { wall: 0xb8b0a0, floorH: 5, win: { w: 3, h: 2, gap: 3, sill: 2, glass: 0x2f3a44, lit: WARM, litChance: 0.7 }, clutter: { kinds: ['vent', 'ac', 'tank'] } });
  const tr = Math.min(d.bz / 4, d.bx * 0.2);
  for (const [cx, cz] of [[m + d.bx * 0.78, m + d.bz * 0.28], [m + d.bx * 0.78, m + d.bz * 0.72]]) {
    for (let y = 0; y < d.by; y++) {
      const t = y / d.by;
      const r = tr * (1 - 0.35 * Math.sin(t * Math.PI));
      g.cylinder(cx, cz, r, y, y + 1, y > d.by - 3 ? 0x9a948a : 0xd7d2c8, 0, true);
    }
    g.cylinder(cx, cz, tr * 0.8, d.by - 1, d.by, 0xffffff);
  }
  for (let x = m + 1; x < m + Math.floor(d.bx * 0.55) - 1; x += 3) g.set(x, Math.floor(d.by * 0.4) + 1, m + d.bz - 2, 0xffd400, E);
}

function crane(g, rng, d) {
  const m = d.m;
  const c = 0xe3a72f;
  g.box(m, 0, m, m + 2, d.by, m + 2, (x, y) => (y % 4 === 0 ? 0xc98a17 : c));
  g.box(m + d.bx - 2, 0, m, m + d.bx, d.by, m + 2, (x, y) => (y % 4 === 0 ? 0xc98a17 : c));
  g.box(m, 0, m + d.bz - 2, m + 2, d.by, m + d.bz, c);
  g.box(m + d.bx - 2, 0, m + d.bz - 2, m + d.bx, d.by, m + d.bz, c);
  g.box(m - 2, d.by, m, m + d.bx + 2, d.by + 3, m + d.bz, c);
  g.box(m + 2, d.by - 4, m + 2, m + 6, d.by, m + 6, 0x30343a);
  g.set(m + 3, d.by - 2, m + 6, 0xffd38a, W);
  g.box(m + Math.floor(d.bx / 2), d.by - 12, m + Math.floor(d.bz / 2), m + Math.floor(d.bx / 2) + 1, d.by, m + Math.floor(d.bz / 2) + 1, 0x333333);
  g.set(m - 2, d.by + 3, m, 0xff3b3b, E);
  g.set(m + d.bx + 1, d.by + 3, m, 0xff3b3b, E);
}

function lighthouse(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const r0 = d.bx / 2;
  g.cylinder(cx, cz, r0 + 1, 0, 3, 0x6b6f75);
  for (let y = 3; y < d.by; y++) {
    const r = r0 - (y / d.by) * r0 * 0.4;
    const band = Math.floor(y / 8) % 2;
    g.cylinder(cx, cz, r, y, y + 1, band ? 0xd23c3c : 0xf4f4f4, 0, true);
    if (y % 8 === 4) g.set(Math.floor(cx), y, Math.floor(cz + r), 0xffd38a, W);
  }
  const rt = r0 * 0.7;
  g.cylinder(cx, cz, rt + 1, d.by, d.by + 1, 0x333333);
  g.cylinder(cx, cz, rt, d.by + 1, d.by + 6, 0xfff2a8, E);
  g.cylinder(cx, cz, rt + 0.5, d.by + 6, d.by + 8, 0xd23c3c);
  g.cylinder(cx, cz, 1.5, d.by + 8, d.by + 10, 0x333333);
}

function bridgeTower(g, rng, d) {
  const m = d.m;
  const c = 0xc0432c; // international orange
  const dark = 0x9a3422;
  const lw = 4;
  for (const z of [m, m + d.bz - lw]) {
    g.box(m, 0, z, m + d.bx, d.by, z + lw, (x, y) => (y % 10 === 0 ? dark : c));
  }
  for (const y of [Math.floor(d.by * 0.35), Math.floor(d.by * 0.6), Math.floor(d.by * 0.85), d.by - 2]) {
    g.box(m, y, m + lw, m + d.bx, y + 3, m + d.bz - lw, (x, yy) => (yy === y ? dark : c));
  }
  for (const z of [m + 1, m + d.bz - 2]) g.set(m + Math.floor(d.bx / 2), d.by, z, 0xff3b3b, E);
  g.box(m - 1, 0, m - 1, m + d.bx + 1, 3, m + d.bz + 1, 0x6f737a);
}

function bridgeDeck(g, rng, d) {
  const m = d.m;
  const y = d.by - 2;
  g.box(m, y, m, m + d.bx, y + 1, m + d.bz, 0x3a3d44);
  g.box(m, y + 1, m, m + d.bx, y + 2, m + 1, 0xc0432c);
  g.box(m, y + 1, m + d.bz - 1, m + d.bx, y + 2, m + d.bz, 0xc0432c);
  for (let x = m; x < m + d.bx; x++) if (x % 4 === 0) g.set(x, y + 1, Math.floor(m + d.bz / 2), 0xf2e6a0);
  for (let x = m; x < m + d.bx; x++) g.set(x, y - 1, m + 1, 0x9a3422);
  for (let x = m; x < m + d.bx; x++) g.set(x, y - 1, m + d.bz - 2, 0x9a3422);
}

function roadBridge(g, rng, d) {
  const m = d.m;
  const y = d.by - 1;
  g.box(m, y, m, m + d.bx, y + 1, m + d.bz, 0x41444b);
  g.box(m, y + 1, m, m + d.bx, y + 2, m + 1, 0x8d8a83);
  g.box(m, y + 1, m + d.bz - 1, m + d.bx, y + 2, m + d.bz, 0x8d8a83);
  for (let x = m + 2; x < m + d.bx; x += 8) g.box(x, 0, m + 2, x + 2, y, m + d.bz - 2, 0x77736c);
}

function cabin(g, rng, d, P) {
  const wood = rng.pick(P.walls);
  const logs = (x, y) => (y % 2 ? wood : shade(wood, 0.82));
  const b = block(g, rng, d, { wall: logs, floorH: 5, win: { w: 2, h: 2, gap: 4, sill: 1, glass: P.glass, lit: WARM, litChance: 0.8, frame: 0x3a2a1a }, parapet: false, clutter: false });
  const top = pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, rng.pick(P.roofs), d.bx >= d.bz);
  g.box(b.x0 + 1, b.y1, b.z0 + 1, b.x0 + 3, top + 1, b.z0 + 3, 0x6b6f75);
  g.box(b.x0, 0, b.z1, b.x1, 1, b.z1 + 2, shade(wood, 0.7));
  g.set(b.x0 + 2, 2, b.z1, 0xffc36b, E);
}

function watchtower(g, rng, d) {
  const m = d.m;
  const wood = 0x6b4a2e;
  for (const [x, z] of [[m, m], [m + d.bx - 1, m], [m, m + d.bz - 1], [m + d.bx - 1, m + d.bz - 1]]) g.box(x, 0, z, x + 1, d.by, z + 1, wood);
  for (let y = 4; y < d.by; y += 6) {
    g.box(m, y, m, m + d.bx, y + 1, m + 1, shade(wood, 0.8));
    g.box(m, y, m + d.bz - 1, m + d.bx, y + 1, m + d.bz, shade(wood, 0.8));
  }
  g.box(m - 1, d.by, m - 1, m + d.bx + 1, d.by + 1, m + d.bz + 1, wood);
  body(g, rng, { x0: m, z0: m, x1: m + d.bx, z1: m + d.bz, y0: d.by + 1, y1: d.by + 5, floorH: 4, wall: 0x8a6a48, win: { w: 2, h: 2, gap: 1, sill: 1, glass: 0x2b3a3a, lit: WARM, litChance: 0.9 } });
  pitchedRoof(g, m, m, m + d.bx, m + d.bz, d.by + 5, 0x3f5f34, true);
}

function radioMast(g, rng, d) {
  const m = d.m;
  const cx = m + Math.floor(d.bx / 2);
  const cz = m + Math.floor(d.bz / 2);
  block(g, rng, { ...d, by: 4 }, { wall: 0xa8a399, floorH: 4, win: { w: 2, h: 1, gap: 3, sill: 2, glass: 0x334455, lit: WARM, litChance: 0.6 }, clutter: false });
  for (let y = 5; y < d.by; y++) {
    const w = Math.max(1, Math.round(4 * (1 - y / d.by)));
    g.box(cx - w, y, cz - w, cx + w + 1, y + 1, cz + w + 1, (x, yy, z) => (Math.abs(x - cx) === w || Math.abs(z - cz) === w ? (Math.floor(yy / 6) % 2 ? 0xd94040 : 0xf2f2f2) : null));
    if (y % 12 === 0) g.set(cx, y, cz + w + 1, 0xff3b3b, E);
  }
  g.set(cx, d.by, cz, 0xff3b3b, E);
}

function shanty(g, rng, d) {
  const m = d.m;
  const tarps = [0xb84a3a, 0x3a6fb8, 0xd9a03a, 0x8a8f96, 0x4a8a5a];
  const n = Math.max(2, Math.floor(d.bx / 7));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2; j++) {
      const x0 = m + i * Math.floor(d.bx / n);
      const z0 = m + j * Math.floor(d.bz / 2);
      const w = Math.floor(d.bx / n) - 1;
      const dz = Math.floor(d.bz / 2) - 1;
      const h = rng.int(4, 6);
      for (const [x, z] of [[x0, z0], [x0 + w - 1, z0], [x0, z0 + dz - 1], [x0 + w - 1, z0 + dz - 1]]) g.box(x, 0, z, x + 1, h, z + 1, 0x5a4a3a);
      const tarp = rng.pick(tarps);
      for (let x = x0 - 1; x < x0 + w + 1; x++) for (let z = z0 - 1; z < z0 + dz + 1; z++) g.set(x, h + ((x + z) % 5 === 0 ? 0 : 0), z, hash3(x, h, z) < 0.15 ? shade(tarp, 0.7) : tarp);
      g.box(x0 + 1, 0, z0 + 1, x0 + w - 1, 2, z0 + 2, 0x7a5a3a);
      if (rng.chance(0.6)) g.set(x0 + 1, 2, z0 + 1, rng.pick([0xff8a1f, 0xffd38a]), E);
      if (rng.chance(0.5)) g.box(x0 + w - 2, 0, z0 + dz - 2, x0 + w - 1, 1, z0 + dz - 1, 0x8a6a3a);
    }
  }
}

function factory(g, rng, d, P) {
  const wall = rng.pick(P.walls);
  const b = block(g, rng, d, { wall: brick(wall, shade(wall, 0.9), 0x5a4a44), floorH: d.by, win: { w: 3, h: d.by - 4, gap: 3, sill: 2, glass: 0x3a4650, lit: WARM, litChance: 0.4 }, parapet: false, clutter: false, shutters: { sign: true } });
  for (let x = b.x0; x < b.x1; x++) {
    const p = (x - b.x0) % 6;
    const h = p < 4 ? p : 6 - p;
    g.box(x, b.y1, b.z0, x + 1, b.y1 + h + 1, b.z1, p === 3 ? 0x8fb3cf : 0x6f6c66);
  }
  const cx = b.x1 - 4;
  const cz = b.z0 + 3;
  g.cylinder(cx, cz, 2, b.y1, b.y1 + Math.floor(d.by * 1.5), (x, y) => (y % 8 < 2 ? 0xd94040 : 0x8a4a3a));
}

function parkingGarage(g, rng, d) {
  const m = d.m;
  const levels = Math.floor(d.by / 3);
  for (let l = 0; l <= levels; l++) {
    const y = l * 3;
    g.box(m, y, m, m + d.bx, y + 1, m + d.bz, 0x9a9a96);
    if (l > 0) {
      g.box(m, y - 1, m, m + d.bx, y, m + 1, 0xb8b6b0);
      g.box(m, y - 1, m + d.bz - 1, m + d.bx, y, m + d.bz, 0xb8b6b0);
    }
    for (let x = m + 2; x < m + d.bx - 2; x += 5) {
      if (l < levels && rng.chance(0.5)) {
        const c = rng.pick([0xd64545, 0x3f7fd1, 0xf0c33c, 0xe8e8e8, 0x4b4b4b]);
        g.box(x, y + 1, m + 2, x + 2, y + 2, m + 5, c);
      }
    }
    for (let x = m; x < m + d.bx; x += 6) for (const z of [m, m + d.bz - 1, m + Math.floor(d.bz / 2)]) g.box(x, y + 1, z, x + 1, y + 3, z + 1, 0x8a8a86);
    for (let x = m; x < m + d.bx; x += 6) g.set(x, y + 2, m + d.bz - 1, 0xfff4c2, W);
  }
  g.box(m + d.bx - 6, levels * 3 + 1, m + d.bz - 3, m + d.bx - 1, levels * 3 + 4, m + d.bz, 0x3b6fd1);
  for (let x = m + d.bx - 5; x < m + d.bx - 2; x++) g.set(x, levels * 3 + 2, m + d.bz, 0xffffff, E);
}

function waterTowerBuilding(g, rng, d, P) {
  const b = block(g, rng, { ...d, by: d.by - 8 }, {
    wall: brick(rng.pick(P.walls), 0x7c3a2a, 0x5a4a44), floorH: 4,
    win: { w: 2, h: 2, gap: 2, sill: 1, glass: P.glass, lit: WARM, litChance: 0.5 }, shutters: {}, clutter: { sparse: true },
  });
  const cx = Math.floor((b.x0 + b.x1) / 2);
  const cz = Math.floor((b.z0 + b.z1) / 2);
  for (const [x, z] of [[cx - 2, cz - 2], [cx + 2, cz - 2], [cx - 2, cz + 2], [cx + 2, cz + 2]]) g.box(x, b.y1 + 1, z, x + 1, b.y1 + 4, z + 1, 0x4a3a2a);
  g.cylinder(cx + 0.5, cz + 0.5, 3, b.y1 + 4, b.y1 + 9, (x, y) => (y % 2 ? 0x8b6e4e : 0x7a5e40));
  for (let s = 0; s < 3; s++) g.cylinder(cx + 0.5, cz + 0.5, 3 - s, b.y1 + 9 + s, b.y1 + 10 + s, 0x5a4a3a);
}

function megablock(g, rng, d, P) {
  const wall = rng.pick(P.concrete || [0x8d8a83, 0x6f6c66]);
  block(g, rng, d, {
    wall: (x, y) => ((y % 4 === 0) ? shade(wall, 0.8) : wall), floorH: 4,
    win: { w: 3, h: 2, gap: 1, sill: 1, glass: 0x2a323a, lit: [...WARM, 0xff7fbf, 0x7fbfff], litChance: 0.5 },
    balconies: { width: 4, slab: shade(wall, 0.9), rail: 0x3a3c41, laundry: true, plants: true },
    acFacade: 0.25, shop: { sign: true, signColors: NEON, awning: [0x3a6fb8, 0xb84a3a] },
    neon: { verticalSign: true, billboards: 1, colors: NEON },
    clutter: { kinds: ['ac', 'ac', 'tank', 'antenna', 'vent'] },
  });
}

function bellTower(g, rng, d, P) {
  const wall = rng.pick(P.walls);
  const b = block(g, rng, d, { wall, floorH: 6, win: { w: 2, h: 3, gap: 4, sill: 2, glass: 0x4a4a66, lit: WARM, litChance: 0.3, arch: true }, parapet: false, clutter: false, cornice: [d.by - 7, d.by - 1] });
  for (let s = 0; s < Math.ceil(d.bx / 2); s++) g.box(b.x0 + s, b.y1 + s, b.z0 + s, b.x1 - s, b.y1 + s + 1, b.z1 - s, 0xc86a4a);
  g.set(Math.floor((b.x0 + b.x1) / 2), b.y1 - 4, b.z1, 0xfff4c2, E);
}

// ---------------------------------------------------------------- catalog
const T2 = 2.5;
const T3 = 3;
const T4 = 4;

function def(id, name, tier, style, zones, v, size, build, extra = {}) {
  return { id, name, tier, style, zones, v, size, build, weight: extra.weight ?? 1, ...extra };
}

// size(rng) -> { bx, bz, by } in voxels.
const sz = (bx, bz, by) => (rng) => ({ bx: rng.int(bx[0], bx[1]), bz: rng.int(bz[0], bz[1]), by: rng.int(by[0], by[1]) });

const winStd = (P, o = {}) => ({ w: 2, h: 2, gap: 2, sill: 1, glass: P.glass, lit: P.lit, litChance: 0.55, ...o });

export const BUILDING_TYPES = [
  // ---- backyard scale (tier 2): the first things a backyard-sized kaiju has to work at
  def('garden_shed', 'Garden shed', 2, 'suburb', ['suburb', 'backyard'], 1.5, sz([6, 8], [5, 6], [4, 5]), (g, r, d, P) => { const b = block(g, r, d, { wall: (x, y) => (x % 2 ? r.pick([0x8a6a48, 0x6f8f6a, 0xb85a4a]) : 0x7a5a3a), floorH: 6, win: null, parapet: false, clutter: false, roof: 0x5b4636 }); pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0x4a4a4a, true, 0); g.box(b.x0 + 2, 0, b.z1 - 1, b.x0 + 4, 3, b.z1, 0x4a3424); }, { weight: 3 }),
  def('playhouse', 'Playhouse', 2, 'suburb', ['backyard'], 1.5, sz([5, 6], [5, 6], [4, 4]), (g, r, d, P) => { const b = block(g, r, d, { wall: r.pick([0xf2a7a0, 0xa8d8c4, 0xf2cf6b]), floorH: 4, win: { w: 1, h: 1, gap: 2, sill: 2, glass: 0x3b5570, lit: WARM, litChance: 0.3 }, parapet: false, clutter: false }); pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0xd94f4f, true, 0); g.box(b.x1, 0, b.z0, b.x1 + 2, 3, b.z0 + 1, 0xf2c12e); }, { weight: 1 }),
  def('carport', 'Carport', 2, 'suburb', ['backyard'], 1.5, sz([9, 10], [7, 8], [4, 4]), (g, r, d) => { const m = d.m; for (const [x, z] of [[m, m], [m + d.bx - 1, m], [m, m + d.bz - 1], [m + d.bx - 1, m + d.bz - 1]]) g.box(x, 0, z, x + 1, 4, z + 1, 0x8a8f96); g.box(m - 1, 4, m - 1, m + d.bx + 1, 5, m + d.bz + 1, 0x6f737a); }, { weight: 0.6 }),
  // ---- suburb
  def('house_gable', 'Gable house', 3, 'suburb', ['suburb'], T2, sz([12, 16], [11, 14], [5, 8]), (g, r, d, P) => gableHouse(g, r, d, P), { weight: 4 }),
  def('house_porch', 'Porch bungalow', 3, 'suburb', ['suburb'], T2, sz([14, 18], [11, 13], [4, 5]), (g, r, d, P) => gableHouse(g, r, d, P, { porch: true }), { weight: 2 }),
  def('house_modern', 'Modern house', 3, 'suburb', ['suburb'], T2, sz([12, 16], [12, 15], [7, 9]), (g, r, d, P) => block(g, r, d, { wall: 0xf3f0ea, floorH: 4, win: winStd(P, { w: 4, h: 3, gap: 2, sill: 0, glass: 0x2b4560 }), garden: 0.6, clutter: { kinds: ['solar'], sparse: true }, parapetColor: 0x3a3d44, roof: 0x55585e }), { weight: 2 }),
  def('cottage', 'Cottage', 3, 'suburb', ['suburb', 'forest'], T2, sz([10, 12], [9, 11], [4, 5]), (g, r, d, P) => gableHouse(g, r, d, P, { roof: 0x4a5d7a }), { weight: 2 }),
  def('duplex', 'Duplex', 3, 'suburb', ['suburb'], T2, sz([16, 20], [11, 13], [7, 8]), (g, r, d, P) => { gableHouse(g, r, d, P); for (let y = 0; y < d.by; y++) for (let z = d.m; z < d.m + d.bz; z++) g.set(d.m + Math.floor(d.bx / 2), y, z, 0xf3f0ea); }, { weight: 1.5 }),
  def('gas_station', 'Gas station', 3, 'suburb', ['suburb', 'commercial', 'garden'], T2, sz([22, 26], [16, 18], [6, 6]), (g, r, d) => gasStation(g, r, d), { weight: 0.8 }),
  def('corner_store', 'Corner store', 3, 'suburb', ['suburb', 'commercial'], T2, sz([12, 16], [12, 14], [7, 8]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P), shop: { awning: [0x2f9e8f, 0xffffff], sign: true, signColors: [0xff4d6d, 0x22e6ff] } })),
  def('church', 'Chapel', 4, 'suburb', ['suburb', 'pastel'], T3, sz([16, 20], [24, 30], [22, 28]), (g, r, d, P) => church(g, r, d, P), { weight: 0.4 }),
  def('school', 'School', 4, 'suburb', ['suburb'], T3, sz([34, 40], [18, 22], [10, 12]), (g, r, d, P) => block(g, r, d, { wall: brick(0xa8553f, 0x9a4a36, 0x7a6a5a), floorH: 5, win: winStd(P, { w: 3, h: 3, gap: 2 }), cornice: true, clutter: { kinds: ['ac', 'vent'] } }), { weight: 0.5 }),
  def('fire_station', 'Fire station', 3, 'suburb', ['suburb', 'commercial'], T2, sz([18, 22], [14, 16], [8, 9]), (g, r, d, P) => { const b = block(g, r, d, { wall: brick(0xb04030, 0x9a3828, 0x6a5a50), floorH: 4, win: winStd(P), shutters: { openChance: 0.6, sign: true, signColors: [0xff3b3b] } }); g.set(b.x0 + 1, b.y1, b.z1, 0xff2020, E); }, { weight: 0.6 }),
  def('garage_workshop', 'Workshop', 3, 'suburb', ['suburb', 'brick'], T2, sz([14, 18], [12, 14], [5, 6]), (g, r, d, P) => block(g, r, d, { wall: 0xa8a399, floorH: 5, shutters: { openChance: 0.5, sign: true }, clutter: { kinds: ['vent', 'ac'] } })),

  // ---- pastel old town
  def('pastel_townhouse', 'Townhouse', 3, 'pastel', ['pastel'], T2, sz([10, 14], [12, 14], [12, 16]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { w: 2, h: 3, gap: 2, sill: 0, arch: true, frame: P.trim }), shop: { awning: r.pick([[0xf2e6a0, 0xffffff], [0x6fa8c8, 0xffffff], [0xe07b6a, 0xfaf3e8]]), glow: WARM }, balconies: { width: 5, alternate: true, slab: P.trim, rail: 0x6b4a3a, plants: true }, cornice: true, corniceColor: P.trim, clutter: { kinds: ['tank', 'garden', 'ac'], sparse: true }, roof: 0xe8d8c0 }), { weight: 4 }),
  def('pastel_cafe', 'Corner cafe', 3, 'pastel', ['pastel'], T2, sz([12, 15], [12, 14], [8, 12]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { arch: true, frame: P.trim }), shop: { awning: [0xd94f4f, 0xfaf3e8], sign: true, signColors: [0xffd23f] }, garden: 0.5, cornice: true, corniceColor: P.trim, roof: 0xe8d8c0 }), { weight: 2 }),
  def('pastel_villa', 'Villa', 4, 'pastel', ['pastel', 'suburb'], T3, sz([20, 26], [18, 22], [10, 13]), (g, r, d, P) => { const b = block(g, r, d, { wall: r.pick(P.walls), floorH: 5, win: winStd(P, { w: 2, h: 3, gap: 3, arch: true, frame: P.trim }), balconies: { width: 7, slab: P.trim, rail: 0x6b4a3a, plants: true }, cornice: true, corniceColor: P.trim, clutter: false }); pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0xc86a4a, true, 1); }, { weight: 1 }),
  def('pastel_tower', 'Pastel tower house', 4, 'pastel', ['pastel'], T3, sz([16, 20], [16, 20], [20, 28]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { w: 2, h: 3, gap: 2, sill: 0, arch: true, frame: P.trim }), shop: { awning: [0x6fa8c8, 0xffffff] }, balconies: { width: 4, alternate: true, slab: P.trim, rail: 0x6b4a3a, plants: true, laundry: true }, cornice: [8, 16, 24].filter((y) => y < d.by), corniceColor: P.trim, clutter: { kinds: ['tank', 'garden', 'dish'] }, roof: 0xe8d8c0, vines: 0.08 }), { weight: 2 }),
  def('pastel_arcade', 'Arcade row', 4, 'pastel', ['pastel'], T3, sz([30, 38], [16, 20], [14, 18]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 5, win: winStd(P, { w: 2, h: 3, gap: 3, arch: true, frame: P.trim }), shop: { awning: [0xf2e6a0, 0xe07b6a], sign: true, signColors: [0xffd23f, 0xff4d6d] }, cornice: true, corniceColor: P.trim, garden: 0.4, roof: 0xe8d8c0 }), { weight: 1.2 }),
  def('bell_tower', 'Bell tower', 4, 'pastel', ['pastel'], T3, sz([10, 12], [10, 12], [34, 40]), (g, r, d, P) => bellTower(g, r, d, P), { weight: 0.3 }),
  def('pastel_hotel', 'Seaside hotel', 4, 'pastel', ['pastel', 'docks'], T3, sz([26, 32], [16, 20], [22, 28]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { w: 3, h: 3, gap: 2, sill: 0, frame: P.trim }), balconies: { width: 5, slab: P.trim, rail: 0xffffff, plants: true }, shop: { awning: [0x6fa8c8, 0xffffff], sign: true, signColors: [0xff4d6d] }, roofSign: { colors: [0xff4d6d], bg: 0xfaf3e8, frame: 0xc86a4a, len: 12, h: 4 }, roof: 0xe8d8c0 }), { weight: 0.8 }),

  // ---- garden / daytime modern
  def('green_roof_office', 'Green-roof office', 4, 'garden', ['commercial', 'garden'], T3, sz([22, 30], [20, 26], [14, 22]), (g, r, d, P) => block(g, r, d, { wall: 0xe9e6df, floorH: 4, win: winStd(P, { w: 3, h: 2, gap: 2 }), garden: 0.75, vines: 0.18, shop: { awning: [0xd94f4f], sign: true }, cornice: true }), { weight: 2 }),
  def('red_walkup', 'Red walk-up', 3, 'garden', ['garden', 'commercial', 'brick'], T2, sz([12, 16], [12, 16], [12, 18]), (g, r, d, P) => block(g, r, d, { wall: 0xd9573b, floorH: 4, win: winStd(P, { frame: 0xf2f0ea }), shop: { awning: [0xd94f4f, 0xffffff] }, garden: 0.55, cornice: true, corniceColor: 0xf2f0ea, clutter: { kinds: ['garden', 'ac', 'tank'] } }), { weight: 2 }),
  def('glass_lowrise', 'Glass low-rise', 4, 'garden', ['commercial', 'garden'], T3, sz([24, 30], [20, 26], [12, 18]), (g, r, d, P) => block(g, r, d, { wall: 0xb8bcc2, floorH: 4, win: winStd(P, { w: 4, h: 3, gap: 1, sill: 0, glass: 0x3d5a78 }), bands: { every: 1, color: 0xd8dade }, clutter: { kinds: ['ac', 'solar', 'vent'] } }), { weight: 1.5 }),
  def('overgrown_block', 'Overgrown block', 4, 'garden', ['garden', 'commercial'], T3, sz([20, 26], [18, 24], [16, 24]), (g, r, d, P) => block(g, r, d, { wall: 0xc9c2b0, floorH: 4, win: winStd(P, { litChance: 0.35 }), garden: 0.85, vines: 0.4, balconies: { width: 5, alternate: true, plants: true }, clutter: { kinds: ['garden', 'garden', 'tank'] } }), { weight: 1.5 }),
  def('mall', 'Shopping mall', 4, 'garden', ['commercial'], T3, sz([36, 44], [26, 32], [10, 14]), (g, r, d, P) => block(g, r, d, { wall: 0xdcd3c0, floorH: 5, win: winStd(P, { w: 5, h: 2, gap: 3 }), shop: { sign: true, signLen: 16, awning: [0x3b6fd1] }, roofSign: { colors: [0x22e6ff, 0xff4d6d], bg: 0x1a1a24, frame: 0x55585e, len: 18 }, clutter: { kinds: ['ac', 'ac', 'vent', 'solar'] } }), { weight: 0.6 }),
  def('hospital', 'Hospital', 4, 'garden', ['commercial'], T3, sz([30, 36], [22, 28], [18, 24]), (g, r, d, P) => { const b = block(g, r, d, { wall: 0xf0ece4, floorH: 4, win: winStd(P, { w: 3, lit: COOL, litChance: 0.7 }), bands: { every: 2, color: 0x9fc4d8 }, clutter: { kinds: ['ac', 'vent'] } }); const cx = Math.floor((b.x0 + b.x1) / 2); for (let i = -2; i <= 2; i++) { g.set(cx + i, b.y1 - 4, b.z1, 0xff3b3b, E); g.set(cx, b.y1 - 4 + i, b.z1, 0xff3b3b, E); } g.box(b.x0 + 3, b.y1 + 1, b.z0 + 3, b.x0 + 10, b.y1 + 2, b.z0 + 10, (x, y, z) => (x === b.x0 + 6 || (z === b.z0 + 6 && (x === b.x0 + 4 || x === b.x0 + 8)) ? 0xf2f2f2 : 0x4f5a66)); }, { weight: 0.5 }),
  def('cinema', 'Cinema', 4, 'garden', ['commercial', 'neon'], T3, sz([24, 30], [22, 26], [12, 16]), (g, r, d, P) => { const b = block(g, r, d, { wall: 0x8a3b4a, floorH: 6, win: null, shop: { sign: true, signLen: 14, signColors: [0xffd23f, 0xff4d6d] }, clutter: { sparse: true } }); for (let x = b.x0; x < b.x1; x++) { g.set(x, 6, b.z1, x % 2 ? 0xffe28a : 0xffffff, E); g.set(x, 7, b.z1 + 1, 0xd94040); } sign(g, r, 0, Math.floor((b.x0 + b.x1) / 2), 8, 12, 5, b.z1, [0xff4d6d, 0x22e6ff], { seed: 3 }); }, { weight: 0.6 }),
  def('balcony_apartments', 'Balcony apartments', 4, 'garden', ['commercial', 'garden', 'pastel'], T3, sz([20, 26], [18, 22], [20, 28]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P), balconies: { width: 5, plants: true, laundry: true }, shop: { awning: [0x3b6fd1, 0xffffff], sign: true }, garden: 0.4, clutter: { kinds: ['tank', 'ac', 'garden', 'dish'] } }), { weight: 2 }),

  // ---- brick industrial district
  def('brick_shophouse', 'Brick shophouse', 3, 'brick', ['brick'], T2, sz([14, 20], [14, 18], [9, 13]), (g, r, d, P) => block(g, r, d, { wall: brick(r.pick(P.walls), 0x7c3a2a, 0x5a4a44), floorH: 4, win: winStd(P, { w: 3, gap: 2 }), shutters: { sign: true }, cornice: true, corniceColor: 0x8d8a83, acFacade: 0.12, clutter: { kinds: ['ac', 'ac', 'ac', 'vent', 'tank'] } }), { weight: 3 }),
  def('self_storage', 'Self storage', 4, 'brick', ['brick'], T3, sz([34, 42], [18, 22], [10, 13]), (g, r, d, P) => block(g, r, d, { wall: brick(0x8a3b2a, 0xa14a34, 0x5a4a44), floorH: 5, win: winStd(P, { w: 4, h: 2, gap: 4, litChance: 0.2 }), shutters: { openChance: 0.1 }, cornice: [5], corniceColor: 0x8d8a83, roofSign: { colors: [0xffd23f], bg: 0x1a1a18, frame: 0x3a3a3a, len: 18, h: 4 }, clutter: { kinds: ['ac', 'ac', 'ac', 'vent'] } }), { weight: 1 }),
  def('brick_tenement', 'Tenement', 4, 'brick', ['brick'], T3, sz([18, 24], [16, 20], [20, 30]), (g, r, d, P) => block(g, r, d, { wall: brick(r.pick(P.walls), 0x6e2f22, 0x5a4a44), floorH: 4, win: winStd(P, { frame: 0x2a2a2a }), fireEscape: true, acFacade: 0.2, shutters: { sign: true }, cornice: true, corniceColor: 0x8d8a83, clutter: { kinds: ['tank', 'ac', 'ac', 'antenna'] } }), { weight: 2.5 }),
  def('warehouse', 'Warehouse', 3, 'brick', ['brick', 'docks'], T2, sz([20, 26], [14, 18], [7, 9]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.concrete || [0x8d8a83]), floorH: 9, win: winStd(P, { w: 4, h: 1, gap: 4, sill: 6, litChance: 0.3 }), shutters: { openChance: 0.3 }, clutter: { kinds: ['vent', 'ac'], sparse: true } }), { weight: 1.5 }),
  def('factory', 'Factory', 4, 'brick', ['brick'], T3, sz([28, 36], [20, 26], [9, 12]), (g, r, d, P) => factory(g, r, d, P), { weight: 1 }),
  def('police_station', 'Police station', 4, 'brick', ['brick', 'commercial'], T3, sz([22, 28], [18, 22], [10, 14]), (g, r, d, P) => { const b = block(g, r, d, { wall: 0x8d8a83, floorH: 5, win: winStd(P, { w: 3, lit: COOL }), shop: { sign: true, signColors: [0x3b8bff], glow: COOL }, clutter: { kinds: ['antenna', 'dish', 'ac'] } }); g.set(b.x0, b.y1 + 1, b.z1 - 1, 0x2a5bff, E); g.set(b.x1 - 1, b.y1 + 1, b.z1 - 1, 0xff2a2a, E); }, { weight: 0.5 }),
  def('market_shanty', 'Street market', 3, 'brick', ['brick', 'neon'], T2, sz([18, 24], [12, 14], [6, 6]), (g, r, d) => shanty(g, r, d), { weight: 1 }),
  def('water_tower_building', 'Water-tower walk-up', 4, 'brick', ['brick'], T3, sz([18, 22], [16, 20], [22, 28]), (g, r, d, P) => waterTowerBuilding(g, r, d, P), { weight: 1 }),
  def('parking_garage', 'Parking garage', 4, 'brick', ['brick', 'commercial', 'neon'], T3, sz([30, 38], [24, 30], [12, 15]), (g, r, d) => parkingGarage(g, r, d), { weight: 0.8 }),
  def('data_center', 'Data center', 4, 'brick', ['brick', 'neon'], T3, sz([26, 32], [20, 24], [10, 13]), (g, r, d, P) => block(g, r, d, { wall: 0x3a3d44, floorH: 13, win: null, bands: { every: 1, color: 0x22e6ff }, clutter: { kinds: ['ac', 'ac', 'ac', 'vent', 'dish'] }, neon: { bands: 1, colors: [0x22e6ff, 0x39ff88] } }), { weight: 0.6 }),
  def('capsule_stack', 'Capsule stack', 4, 'brick', ['brick', 'neon'], T3, sz([18, 24], [16, 20], [24, 32]), (g, r, d, P) => block(g, r, d, { wall: (x, y, z) => (hash3(x >> 2, y >> 2, z >> 2) < 0.5 ? 0xa8a399 : 0x8d8a83), floorH: 4, win: winStd(P, { w: 3, h: 2, gap: 1, litChance: 0.6, lit: [...WARM, 0xff7fbf] }), acFacade: 0.35, balconies: { width: 4, alternate: true, laundry: true }, shop: { sign: true, signColors: NEON }, clutter: { kinds: ['ac', 'ac', 'tank', 'antenna'] } }), { weight: 1.2 }),
  def('megablock', 'Megablock', 5, 'brick', ['brick', 'downtown'], T4, sz([28, 36], [24, 30], [36, 50]), (g, r, d, P) => megablock(g, r, d, P), { weight: 1.5 }),

  // ---- neon cyberpunk
  def('neon_ramen', 'Ramen bar', 3, 'neon', ['neon', 'brick'], T2, sz([10, 14], [12, 14], [8, 11]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { lit: [0xff7fbf, 0xffd38a] }), shop: { sign: true, signColors: [0xff2bd6, 0xffd23f], awning: [0xb84a3a, 0x2a2a2a], glow: [0xffb35c] }, neon: { verticalSign: true, colors: NEON }, clutter: { kinds: ['ac', 'vent'] } }), { weight: 2 }),
  def('arcade', 'Arcade', 3, 'neon', ['neon'], T2, sz([14, 18], [14, 16], [9, 12]), (g, r, d, P) => block(g, r, d, { wall: 0x2a1f3a, floorH: 4, win: null, shop: { sign: true, signColors: [0x22e6ff, 0xff2bd6], glow: [0xff7fbf, 0x7fbfff, 0xb0ff7f] }, neon: { corners: 1, bands: 1, colors: NEON }, roofSign: { colors: [0xff2bd6, 0x22e6ff], bg: 0x110c1a, frame: 0x22e6ff, len: 12, h: 5 } }), { weight: 1.5 }),
  def('karaoke', 'Karaoke box', 3, 'neon', ['neon'], T2, sz([12, 16], [12, 15], [12, 16]), (g, r, d, P) => block(g, r, d, { wall: 0x3a2a4a, floorH: 4, win: winStd(P, { lit: [0xff7fbf, 0xb07fff, 0x7fbfff], litChance: 0.8 }), shop: { sign: true, signColors: NEON }, neon: { verticalSign: true, corners: 1, colors: NEON } }), { weight: 1.2 }),
  def('pachinko', 'Pachinko parlor', 4, 'neon', ['neon'], T3, sz([22, 28], [18, 22], [10, 14]), (g, r, d, P) => block(g, r, d, { wall: 0x3a2030, floorH: 5, win: null, shop: { sign: true, signLen: 16, signColors: [0xffd23f, 0xff4d6d], glow: [0xffe28a, 0xff9a5c] }, neon: { bands: 1, billboards: 2, colors: [0xffd23f, 0xff4d6d, 0xff8a1f] }, clutter: { kinds: ['ac', 'ac'] } }), { weight: 1 }),
  def('nightclub', 'Nightclub', 4, 'neon', ['neon'], T3, sz([20, 26], [18, 22], [10, 14]), (g, r, d, P) => block(g, r, d, { wall: 0x1a1622, floorH: 5, win: null, neon: { corners: 2, bands: 1, billboards: 1, colors: [0x7b5cff, 0xff2bd6, 0x22e6ff] }, shop: { sign: true, signColors: [0x7b5cff, 0xff2bd6], glow: [0xb07fff] }, clutter: { sparse: true } }), { weight: 0.8 }),
  def('neon_apartment', 'Neon apartments', 4, 'neon', ['neon', 'downtown'], T3, sz([18, 24], [16, 22], [24, 34]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 4, win: winStd(P, { w: 2, gap: 1 }), acFacade: 0.2, balconies: { width: 4, alternate: true, laundry: true, rail: 0x22252c }, shop: { sign: true, signColors: NEON }, neon: { verticalSign: true, billboards: 1, colors: NEON }, clutter: { kinds: ['ac', 'tank', 'antenna', 'dish'] } }), { weight: 3 }),
  def('cyber_skyscraper', 'Glass skyscraper', 5, 'neon', ['downtown'], T4, sz([26, 34], [26, 34], [44, 60]), (g, r, d, P) => block(g, r, d, { wall: r.pick(P.walls), floorH: 3, win: winStd(P, { w: 3, h: 2, gap: 1, sill: 0 }), neon: { corners: 2, colors: P.neon }, shop: { sign: true, signColors: NEON, glow: COOL }, clutter: { kinds: ['antenna', 'ac', 'dish', 'vent'] } }), { weight: 3 }),
  def('ring_tower', 'Ring tower', 5, 'neon', ['downtown'], T4, sz([24, 30], [24, 30], [46, 62]), (g, r, d, P) => { d.bz = d.bx; cylTower(g, r, d, P); }, { weight: 1.5, square: true }),
  def('stepped_tower', 'Stepped tower', 5, 'neon', ['downtown'], T4, sz([30, 38], [30, 38], [44, 58]), (g, r, d, P) => setbackTower(g, r, d, P, { tiers: 3, floorH: 3, win: winStd(P, { w: 2, h: 2, gap: 1, sill: 0 }), neon: { corners: 1, colors: P.neon }, spire: 10 }), { weight: 2 }),
  def('twin_towers', 'Twin towers', 5, 'neon', ['downtown'], T4, sz([34, 40], [20, 24], [48, 62]), (g, r, d, P) => twinTowers(g, r, d, P), { weight: 1 }),
  def('billboard_tower', 'Billboard tower', 5, 'neon', ['downtown', 'neon'], T4, sz([24, 30], [24, 30], [36, 48]), (g, r, d, P) => block(g, r, d, { wall: 0x23262e, floorH: 3, win: winStd(P, { w: 2, gap: 2, litChance: 0.4 }), neon: { billboards: 5, verticalSign: true, corners: 1, colors: NEON }, roofSign: { colors: NEON, bg: 0x110c1a, frame: 0xff2bd6, len: 20, h: 8 } }), { weight: 1.5 }),
  def('corporate_hq', 'Corporate HQ', 5, 'neon', ['downtown'], T4, sz([30, 36], [30, 36], [50, 66]), (g, r, d, P) => setbackTower(g, r, d, P, { tiers: 2, floorH: 3, wall: 0x2d3440, win: winStd(P, { w: 3, h: 2, gap: 1, sill: 0, lit: COOL }), neon: { bands: 3, colors: [0x22e6ff] }, spire: 18 }), { weight: 1 }),
  def('hotel_tower', 'Hotel tower', 5, 'neon', ['downtown'], T4, sz([28, 34], [22, 28], [40, 54]), (g, r, d, P) => block(g, r, d, { wall: 0x4a4050, floorH: 3, win: winStd(P, { w: 2, gap: 1, lit: WARM, litChance: 0.65 }), balconies: { width: 3, slab: 0x6a6070, rail: 0xb8a070 }, roofSign: { colors: [0xffd23f], bg: 0x1a1218, frame: 0xffd23f, len: 16, h: 5 }, shop: { sign: true, glow: WARM, awning: [0x8a2a2a] } }), { weight: 1.2 }),
  def('residential_highrise', 'Residential high-rise', 5, 'neon', ['downtown', 'brick'], T4, sz([26, 32], [26, 32], [40, 56]), (g, r, d, P) => block(g, r, d, { wall: 0x6f6c66, floorH: 3, win: winStd(P, { w: 2, gap: 2 }), balconies: { width: 4, laundry: true, plants: true }, acFacade: 0.15, neon: { verticalSign: true, colors: NEON }, clutter: { kinds: ['tank', 'ac', 'antenna', 'garden'] } }), { weight: 2 }),
  def('pyramid_arcology', 'Arcology', 5, 'neon', ['downtown'], T4, sz([34, 40], [34, 40], [40, 50]), (g, r, d, P) => { d.bz = d.bx; pyramid(g, r, d, P); }, { weight: 0.4, square: true }),
  def('tv_tower', 'TV tower', 5, 'neon', ['downtown', 'commercial'], T4, sz([16, 18], [16, 18], [60, 72]), (g, r, d, P) => { d.bz = d.bx; tvTower(g, r, d, P); }, { weight: 0.3, square: true }),
  def('stadium', 'Stadium', 5, 'garden', ['commercial'], T4, sz([64, 70], [50, 56], [12, 14]), (g, r, d) => stadium(g, r, d), { weight: 0.15, unique: true }),
  def('power_plant', 'Power plant', 5, 'brick', ['brick', 'commercial'], T4, sz([44, 50], [34, 40], [28, 34]), (g, r, d) => powerPlant(g, r, d), { weight: 0.25, power: true }),

  // ---- docks
  def('crane', 'Harbor crane', 4, 'docks', ['docks'], T3, sz([12, 14], [10, 12], [28, 34]), (g, r, d) => crane(g, r, d), { weight: 1 }),
  def('harbor_warehouse', 'Harbor warehouse', 3, 'docks', ['docks'], T2, sz([22, 26], [14, 18], [7, 9]), (g, r, d, P) => { const b = block(g, r, d, { wall: r.pick(P.walls), floorH: 9, win: winStd(P, { w: 4, h: 1, gap: 4, sill: 6 }), shutters: { openChance: 0.4, sign: true, signColors: [0xffffff] }, parapet: false, clutter: false }); pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0x5a5d63, true, 0); }, { weight: 1.5 }),

  // ---- forest
  def('cabin', 'Log cabin', 3, 'forest', ['forest'], T2, sz([10, 14], [9, 12], [4, 5]), (g, r, d, P) => cabin(g, r, d, P), { weight: 2 }),
  def('ranger_tower', 'Ranger tower', 4, 'forest', ['forest'], T3, sz([8, 10], [8, 10], [22, 28]), (g, r, d) => watchtower(g, r, d), { weight: 0.5 }),
  def('radio_mast', 'Radio mast', 5, 'forest', ['forest'], T4, sz([12, 14], [12, 14], [55, 70]), (g, r, d) => radioMast(g, r, d), { weight: 0.2 }),
  def('lumber_mill', 'Lumber mill', 3, 'forest', ['forest'], T2, sz([20, 24], [14, 16], [7, 9]), (g, r, d, P) => { const b = block(g, r, d, { wall: (x, y) => (y % 2 ? 0x8a6a48 : 0x7a5a3a), floorH: 9, win: winStd(P, { w: 3, h: 2, gap: 4, sill: 3 }), shutters: { openChance: 0.6 }, parapet: false, clutter: false }); pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0x6b3a2a, true); for (let i = 0; i < 4; i++) g.box(b.x0, i % 2, b.z1 + 1 + Math.floor(i / 2), b.x0 + 8, i % 2 + 1, b.z1 + 2 + Math.floor(i / 2), 0x8a5a32); }, { weight: 0.6 }),

  // ---- landmark & bridges
  def('lighthouse', 'Lighthouse', 6, 'docks', [], T4, sz([12, 12], [12, 12], [80, 80]), (g, r, d) => lighthouse(g, r, d), { weight: 0, landmark: true, square: true }),
  def('bridge_tower', 'Bridge tower', 5, 'bridge', [], T4, sz([8, 8], [26, 26], [70, 70]), (g, r, d) => bridgeTower(g, r, d), { weight: 0 }),
  def('bridge_deck', 'Bridge deck', 4, 'bridge', [], T4, sz([20, 20], [20, 20], [14, 14]), (g, r, d) => bridgeDeck(g, r, d), { weight: 0, walkable: true }),
  def('road_bridge', 'Road bridge', 3, 'bridge', [], T2, sz([24, 24], [24, 24], [4, 4]), (g, r, d) => roadBridge(g, r, d), { weight: 0, walkable: true }),
];

export const TYPE_BY_ID = Object.fromEntries(BUILDING_TYPES.map((t) => [t.id, t]));
export const VARIANTS = 3;
const MARGIN = 3;

// Footprint and height for a (type, variant) without building the voxels.
export function buildingDims(typeId, variant, override = null) {
  const t = TYPE_BY_ID[typeId];
  const rng = createRng(hashStr(typeId) + variant * 7919);
  const s = override || t.size(rng);
  if (t.square) s.bz = s.bx;
  return { ...s, m: MARGIN, v: t.v, w: s.bx * t.v, h: s.bz * t.v, height: s.by * t.v };
}

export function buildBuilding(typeId, variant, override = null) {
  const t = TYPE_BY_ID[typeId];
  const d = buildingDims(typeId, variant, override);
  const rng = createRng(hashStr(typeId) * 3 + variant * 104729);
  const extra = t.tier >= 5 ? 30 : t.tier <= 2 ? 6 : 16;
  const g = new VoxelGrid(d.bx + MARGIN * 2, d.by + extra, d.bz + MARGIN * 2);
  t.build(g, rng, { ...d }, PALETTES[t.style] || PALETTES.neon);
  return { grid: g, dims: d, origin: { x: MARGIN + d.bx / 2, z: MARGIN + d.bz / 2 } };
}
