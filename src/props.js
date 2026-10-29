// Small voxel assets used to dress the city: vehicles, street furniture, nature.
// Each prop has a footprint in world units for collisions and a builder for its voxels.
import { VoxelGrid, E, W, shade, hash3 } from './voxel.js';
import { createRng } from './rng.js';
import { REALM_PROPS } from './realmtypes.js';

const CAR_COLORS = [0xd64545, 0x3f7fd1, 0xf0c33c, 0xe8e8e8, 0x3b3b3b, 0x5cb85c, 0xf08a3c, 0x7fb8c8, 0xb05a9a, 0xd8c8a8];

function car(g, rng, o = {}) {
  const L = g.nx;
  const Wd = g.nz;
  const c = o.color ?? rng.pick(CAR_COLORS);
  const cab0 = o.cab0 ?? Math.floor(L * 0.3);
  const cab1 = o.cab1 ?? Math.floor(L * 0.75);
  g.box(0, 1, 0, L, 3, Wd, c);
  g.box(cab0, 3, 0, cab1, o.cabH ?? 5, Wd, c);
  g.box(cab0 + 1, 3, 0, cab1 - 1, (o.cabH ?? 5) - 1, Wd, 0x22303d); // glass band
  g.box(cab0, (o.cabH ?? 5) - 1, 0, cab1, o.cabH ?? 5, Wd, o.roof ?? c);
  for (const x of [1, L - 3]) for (const z of [0, Wd - 1]) g.box(x, 0, z, x + 2, 2, z + 1, 0x111111);
  g.set(L - 1, 2, 0, 0xfff6d8, E);
  g.set(L - 1, 2, Wd - 1, 0xfff6d8, E);
  g.set(0, 2, 0, 0xff2a2a, E);
  g.set(0, 2, Wd - 1, 0xff2a2a, E);
  if (o.taxi) {
    g.box(Math.floor(L / 2), o.cabH ?? 5, Math.floor(Wd / 2) - 1, Math.floor(L / 2) + 2, (o.cabH ?? 5) + 1, Math.floor(Wd / 2) + 1, 0xfff2a8, E);
    g.box(0, 2, 0, L, 3, Wd, (x) => (x % 2 ? 0x1a1a1a : c));
  }
  if (o.police) {
    g.box(cab0 + 1, o.cabH ?? 5, 0, cab1 - 1, (o.cabH ?? 5) + 1, Math.floor(Wd / 2), 0xff2a2a, E);
    g.box(cab0 + 1, o.cabH ?? 5, Math.floor(Wd / 2), cab1 - 1, (o.cabH ?? 5) + 1, Wd, 0x2a5bff, E);
  }
}

function tree(g, rng, o = {}) {
  const cx = Math.floor(g.nx / 2);
  const cz = Math.floor(g.nz / 2);
  const trunkH = o.trunk ?? Math.floor(g.ny * 0.35);
  const bark = o.bark ?? 0x5a3d26;
  g.box(cx, 0, cz, cx + 1, trunkH + 1, cz + 1, bark);
  const greens = o.greens || [0x3e8e41, 0x4f9d3a, 0x2f7a3a, 0x5aa845];
  if (o.pine) {
    const layers = g.ny - trunkH;
    for (let i = 0; i < layers; i++) {
      const r = Math.max(0.6, (1 - i / layers) * (g.nx / 2));
      g.cylinder(cx + 0.5, cz + 0.5, r, trunkH + i, trunkH + i + 1, (x, y, z) => (hash3(x, y, z) < 0.35 ? shade(greens[0], 0.8) : greens[i % 2]));
    }
    return;
  }
  const r = g.nx / 2 - 0.3;
  const cy = trunkH + r;
  for (let y = trunkH; y < g.ny; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    const d = Math.hypot(x + 0.5 - g.nx / 2, (y + 0.5 - cy) * 1.15, z + 0.5 - g.nz / 2);
    if (d < r && hash3(x, y, z) > 0.08) g.set(x, y, z, greens[Math.floor(hash3(x * 3, y, z) * greens.length)]);
  }
  if (o.blossom) for (let i = 0; i < 6; i++) g.set(rng.int(1, g.nx - 2), rng.int(trunkH + 2, g.ny - 1), rng.int(1, g.nz - 2), o.blossom);
}

function lamppost(g, rng, o = {}) {
  g.box(1, 0, 1, 2, g.ny - 1, 2, o.pole ?? 0x4a4d52);
  g.box(1, g.ny - 1, 1, g.nx, g.ny, 2, o.pole ?? 0x4a4d52);
  g.set(g.nx - 1, g.ny - 2, 1, o.light ?? 0xfff2c8, E);
}

const P = (id, opts) => ({ id, tier: 1, value: 1, variants: 3, ...opts });

// size: [nx, ny, nz] voxels; v: voxel size in world units.
export const PROP_TYPES = [
  P('car', { tier: 2, v: 1.6, size: [8, 6, 4], vehicle: true, build: (g, r) => car(g, r), weight: 6 }),
  P('hatchback', { tier: 2, v: 1.6, size: [7, 6, 4], vehicle: true, build: (g, r) => car(g, r, { cab0: 2, cab1: 6 }), weight: 3 }),
  P('taxi', { tier: 2, v: 1.6, size: [8, 6, 4], vehicle: true, build: (g, r) => car(g, r, { color: 0xf2c12e, taxi: true }), weight: 2 }),
  P('van', { tier: 2, v: 1.6, size: [9, 7, 4], vehicle: true, build: (g, r) => car(g, r, { cab0: 1, cab1: 8, cabH: 6, color: r.pick([0xe8e8e8, 0x3f7fd1, 0x2a2a2a]) }), weight: 2 }),
  P('pickup', { tier: 2, v: 1.6, size: [9, 6, 4], vehicle: true, build: (g, r) => car(g, r, { cab0: 4, cab1: 7 }), weight: 1.5 }),
  P('bus', { tier: 3, value: 2, v: 1.8, size: [16, 8, 5], vehicle: true, build: (g, r) => { const c = r.pick([0xf2c12e, 0x3b6fd1, 0xe8e8e8]); g.box(0, 1, 0, 16, 7, 5, c); g.box(1, 4, 0, 15, 6, 5, (x) => (x % 3 === 0 ? c : 0x2a3a4a)); g.box(0, 7, 1, 16, 8, 4, shade(c, 0.85)); for (const x of [2, 12]) for (const z of [0, 4]) g.box(x, 0, z, x + 2, 2, z + 1, 0x111111); for (let x = 1; x < 15; x += 3) g.set(x, 5, 0, 0xffe2a8, W); g.set(15, 2, 0, 0xfff6d8, E); g.set(15, 2, 4, 0xfff6d8, E); }, weight: 0.6 }),
  P('truck', { tier: 3, value: 2, v: 1.8, size: [14, 8, 5], vehicle: true, build: (g, r) => { g.box(0, 1, 0, 10, 8, 5, r.pick([0xe8e8e8, 0xb84a3a, 0x3a6fb8])); g.box(10, 1, 0, 14, 6, 5, r.pick(CAR_COLORS)); g.box(11, 3, 0, 14, 5, 5, 0x22303d); for (const x of [1, 7, 11]) for (const z of [0, 4]) g.box(x, 0, z, x + 2, 2, z + 1, 0x111111); g.set(13, 2, 0, 0xfff6d8, E); }, weight: 0.5 }),
  P('scooter', { tier: 1, v: 1.2, size: [4, 4, 2], vehicle: true, build: (g, r) => { const c = r.pick(CAR_COLORS); g.box(0, 0, 0, 1, 1, 2, 0x111111); g.box(3, 0, 0, 4, 1, 2, 0x111111); g.box(0, 1, 0, 4, 2, 2, c); g.box(3, 2, 0, 4, 4, 1, 0x333333); }, weight: 1 }),
  P('lamppost', { tier: 2, v: 1.5, size: [4, 9, 3], value: 0.3, light: { color: 0xffd9a0, h: 12 }, build: (g, r) => lamppost(g, r), weight: 0 }),
  P('neon_lamp', { tier: 2, v: 1.5, size: [4, 9, 3], value: 0.3, light: { color: 0xff6bd6, h: 12 }, build: (g, r) => lamppost(g, r, { pole: 0x2a2d33, light: r.pick([0xff2bd6, 0x22e6ff, 0x7b5cff]) }), weight: 0 }),
  P('traffic_light', { tier: 2, v: 1.2, size: [3, 9, 3], value: 0.3, build: (g) => { g.box(1, 0, 1, 2, 7, 2, 0x3a3d42); g.box(0, 6, 1, 3, 9, 2, 0x2a2a2a); g.set(1, 8, 2, 0xff3030, E); g.set(1, 7, 2, 0x30ff60, E); }, weight: 0 }),
  P('bench', { tier: 1, v: 1.2, size: [5, 3, 2], value: 0.3, build: (g, r) => { const c = r.pick([0x8a5a32, 0x3a6a4a, 0x55585e]); g.box(0, 1, 0, 5, 2, 2, c); g.box(0, 2, 1, 5, 3, 2, c); g.set(0, 0, 0, 0x333333); g.set(4, 0, 0, 0x333333); }, weight: 1 }),
  P('hydrant', { tier: 1, v: 1, size: [2, 3, 2], value: 0.2, build: (g) => { g.box(0, 0, 0, 2, 2, 2, 0xd93636); g.set(0, 2, 0, 0xb02a2a); }, weight: 1 }),
  P('trash_can', { tier: 1, v: 1.1, size: [2, 3, 2], value: 0.2, build: (g, r) => { g.box(0, 0, 0, 2, 3, 2, r.pick([0x3a6a4a, 0x55585e, 0x2f5f8f])); }, weight: 1 }),
  P('dumpster', { tier: 2, v: 1.4, size: [5, 4, 3], value: 0.5, build: (g, r) => { const c = r.pick([0x3a6a4a, 0x2f5f8f, 0x8a5a32]); g.box(0, 0, 0, 5, 3, 3, c); g.box(0, 3, 0, 5, 4, 3, shade(c, 0.8)); }, weight: 0.8 }),
  P('bus_stop', { tier: 2, v: 1.4, size: [7, 6, 3], value: 0.5, light: { color: 0xcfe8ff, h: 6 }, build: (g) => { g.box(0, 0, 0, 1, 5, 1, 0x55585e); g.box(6, 0, 0, 7, 5, 1, 0x55585e); g.box(0, 5, 0, 7, 6, 3, 0x6f737a); g.box(1, 1, 0, 6, 4, 1, 0x7fb8d8); g.box(2, 2, 0, 5, 4, 1, 0xcfe8ff, E); g.box(1, 1, 2, 6, 2, 3, 0x8a5a32); }, weight: 0.6 }),
  P('vending', { tier: 1, v: 1.2, size: [3, 5, 2], value: 0.4, light: { color: 0x9fe8ff, h: 3 }, build: (g, r) => { const c = r.pick([0xd93636, 0x3b6fd1, 0xf2f2f2]); g.box(0, 0, 0, 3, 5, 2, c); g.box(0, 1, 1, 2, 4, 2, r.pick([0x9fe8ff, 0xffe28a]), E); }, weight: 0.8 }),
  P('phone_booth', { tier: 2, v: 1.2, size: [3, 6, 3], value: 0.4, build: (g) => { g.box(0, 0, 0, 3, 6, 3, 0xd93636); g.box(0, 1, 2, 3, 5, 3, 0x9fd0e8); g.box(0, 5, 0, 3, 6, 3, 0xfff2c8, E); }, weight: 0.3 }),
  P('mailbox', { tier: 1, v: 1, size: [2, 3, 2], value: 0.2, build: (g) => { g.box(0, 0, 0, 2, 3, 2, 0x2a5bd9); g.set(0, 2, 1, 0xd8d8d8); }, weight: 0.5 }),
  P('planter', { tier: 1, v: 1.2, size: [4, 3, 4], value: 0.3, build: (g, r) => { g.box(0, 0, 0, 4, 1, 4, 0xa89a7a); g.box(0, 1, 0, 4, 3, 4, (x, y, z) => (hash3(x, y, z) < 0.25 ? r.pick([0xd94f8a, 0xf2d24a]) : r.pick([0x3e8e41, 0x5aa845]))); }, weight: 1 }),
  P('fountain', { tier: 3, value: 1.5, v: 1.5, size: [10, 5, 10], build: (g) => { g.cylinder(5, 5, 5, 0, 1, 0xb8b0a0); g.cylinder(5, 5, 4.2, 1, 2, 0x3f8fd1); g.cylinder(5, 5, 1.2, 1, 4, 0xc8c0b0); g.box(4, 4, 4, 6, 5, 6, 0x9fdcff, E); }, weight: 0.2 }),
  P('food_cart', { tier: 2, v: 1.3, size: [5, 6, 3], value: 0.5, light: { color: 0xffc36b, h: 5 }, build: (g, r) => { const c = r.pick([0xd94f4f, 0x3a8a5a, 0xf2c12e]); g.box(0, 1, 0, 5, 3, 3, c); g.box(0, 5, 0, 5, 6, 3, (x) => (x % 2 ? 0xffffff : c)); g.box(0, 3, 0, 1, 5, 1, 0x55585e); g.box(4, 3, 0, 5, 5, 1, 0x55585e); g.set(2, 3, 0, 0xffc36b, E); g.set(1, 0, 0, 0x111111); g.set(3, 0, 0, 0x111111); }, weight: 0.6 }),
  P('barrier', { tier: 1, v: 1.3, size: [6, 3, 2], value: 0.3, build: (g, r) => { g.box(0, 0, 0, 6, 1, 2, 0xd8d6d0); g.box(0, 1, 0, 6, 3, 1, r.chance(0.5) ? 0xe8e6e0 : (x) => (x % 2 ? 0xd93636 : 0xf2f2f2)); }, weight: 1 }),
  P('cone', { tier: 1, v: 0.9, size: [2, 3, 2], value: 0.1, build: (g) => { g.box(0, 0, 0, 2, 1, 2, 0xf27a1a); g.box(0, 1, 0, 1, 3, 1, (x, y) => (y === 2 ? 0xf2f2f2 : 0xf27a1a)); }, weight: 1 }),
  P('power_pole', { tier: 2, v: 1.5, size: [5, 14, 1], value: 0.4, build: (g) => { g.box(2, 0, 0, 3, 14, 1, 0x5a4434); g.box(0, 12, 0, 5, 13, 1, 0x5a4434); g.set(0, 13, 0, 0x8a8a8a); g.set(4, 13, 0, 0x8a8a8a); g.box(3, 9, 0, 4, 11, 1, 0x6a6a6a); }, weight: 0 }),
  P('neon_pole', { tier: 2, v: 1.3, size: [3, 12, 3], value: 0.4, light: { color: 0xff2bd6, h: 10 }, build: (g, r) => { const c = r.pick([0xff2bd6, 0x22e6ff, 0xffd23f, 0x39ff88]); g.box(1, 0, 1, 2, 6, 2, 0x2a2d33); for (let y = 6; y < 12; y++) g.set(1, y, 1, hash3(1, y, 3) < 0.7 ? c : 0x15151c, hash3(1, y, 3) < 0.7 ? E : 0); g.box(0, 6, 1, 3, 12, 2, (x, y) => (x === 1 ? undefined : 0x15151c)); }, weight: 0 }),
  P('billboard', { tier: 3, value: 1, v: 1.8, size: [12, 12, 2], light: { color: 0xffe28a, h: 10 }, build: (g, r) => { g.box(2, 0, 0, 3, 6, 1, 0x4a4d52); g.box(9, 0, 0, 10, 6, 1, 0x4a4d52); const c = r.pick([0xff2bd6, 0x22e6ff, 0xffd23f, 0xff8a1f]); g.box(0, 6, 0, 12, 12, 1, (x, y) => (x === 0 || y === 6 || x === 11 || y === 11 ? 0x2a2a2a : hash3(x >> 1, y, 4) < 0.5 ? c : 0xf2f2f2)); for (let x = 1; x < 11; x++) for (let y = 7; y < 11; y++) if (hash3(x >> 1, y, 4) < 0.5) g.set(x, y, 0, c, E); }, weight: 0.3 }),
  P('crates', { tier: 1, v: 1.2, size: [4, 4, 3], value: 0.3, build: (g, r) => { g.box(0, 0, 0, 2, 2, 2, 0x9a7444); g.box(2, 0, 0, 4, 2, 3, 0x8a6434); g.box(1, 2, 0, 3, 4, 2, 0xaa8454); }, weight: 0.8 }),
  P('drums', { tier: 1, v: 1.1, size: [3, 3, 3], value: 0.3, build: (g, r) => { const c = r.pick([0x2f5f8f, 0xb84a3a, 0x3a6a4a]); g.box(0, 0, 0, 1, 3, 1, c); g.box(2, 0, 0, 3, 3, 1, c); g.box(1, 0, 2, 2, 3, 3, c); }, weight: 0.6 }),
  P('container', { tier: 2, v: 2, size: [8, 4, 3], value: 0.6, build: (g, r) => { const c = r.pick([0xc0392b, 0x2980b9, 0x27ae60, 0xe67e22, 0x8e44ad]); g.box(0, 0, 0, 8, 4, 3, (x) => (x % 2 ? c : shade(c, 0.82))); }, weight: 0 }),
  P('boat', { tier: 2, v: 1.6, size: [10, 5, 4], value: 0.6, build: (g, r) => { const c = r.pick([0xf2f2f2, 0xd94f4f, 0x3b6fd1]); g.box(1, 0, 0, 9, 2, 4, c); g.box(0, 1, 1, 10, 2, 3, c); g.box(4, 2, 1, 7, 4, 3, 0xf2f2f2); g.set(6, 3, 1, 0x9fd0e8); g.set(9, 2, 2, 0xfff2c8, E); }, weight: 0 }),
  P('fence', { tier: 2, v: 1.2, size: [8, 3, 1], value: 0.2, build: (g, r) => { const c = r.pick([0xf2f0ea, 0x8a6a48, 0x55585e]); for (let x = 0; x < 8; x += 2) g.box(x, 0, 0, x + 1, 3, 1, c); g.box(0, 2, 0, 8, 3, 1, c); g.box(0, 1, 0, 8, 2, 1, c); }, weight: 0 }),
  // Nature
  P('tree_round', { tier: 2, v: 1.5, size: [7, 10, 7], value: 0.4, build: (g, r) => tree(g, r), weight: 0 }),
  P('tree_blossom', { tier: 2, v: 1.5, size: [7, 9, 7], value: 0.4, build: (g, r) => tree(g, r, { greens: [0xf2a7c8, 0xe88ab4, 0xf6c1d8], blossom: 0xffffff }), weight: 0 }),
  P('tree_pine', { tier: 2, v: 1.5, size: [6, 14, 6], value: 0.4, build: (g, r) => tree(g, r, { pine: true, trunk: 3, greens: [0x2f5f34, 0x3a6f3c] }), weight: 0 }),
  P('tree_pine_tall', { tier: 2, v: 1.8, size: [8, 20, 8], value: 0.5, build: (g, r) => tree(g, r, { pine: true, trunk: 4, greens: [0x264f2c, 0x335f37] }), weight: 0 }),
  P('tree_birch', { tier: 2, v: 1.4, size: [6, 12, 6], value: 0.4, build: (g, r) => tree(g, r, { bark: 0xe8e4dc, greens: [0x8abf4a, 0x9fcf5a, 0x7aaf3a] }), weight: 0 }),
  P('tree_autumn', { tier: 2, v: 1.5, size: [7, 10, 7], value: 0.4, build: (g, r) => tree(g, r, { greens: [0xd9822b, 0xe8a23a, 0xc0562a] }), weight: 0 }),
  P('palm', { tier: 2, v: 1.5, size: [7, 12, 7], value: 0.4, build: (g) => { for (let y = 0; y < 10; y++) g.set(3 + (y > 6 ? 1 : 0), y, 3, 0x8a6a3a); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) for (let k = 1; k < 4; k++) g.set(4 + dx * k, 10 - (k > 2 ? 1 : 0), 3 + dz * k, 0x3e8e41); g.set(4, 10, 3, 0x2f7a3a); }, weight: 0 }),
  P('bush', { tier: 1, v: 1.2, size: [4, 3, 4], value: 0.2, build: (g, r) => { for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) if (Math.hypot(x - 1.5, y * 1.3, z - 1.5) < 2.3) g.set(x, y, z, r.pick([0x3e8e41, 0x4f9d3a, 0x2f7a3a])); }, weight: 0 }),
  P('rock', { tier: 1, v: 1.5, size: [5, 3, 4], value: 0.2, build: (g, r) => { for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 5; x++) if (Math.hypot((x - 2) * 0.8, y * 1.2, z - 1.5) < 2.2 + hash3(x, y, z) * 0.6) g.set(x, y, z, hash3(x, y, z) < 0.5 ? 0x7d7a74 : 0x8d8a83); }, weight: 0 }),
  P('log', { tier: 1, v: 1.3, size: [7, 2, 2], value: 0.2, build: (g) => { g.box(0, 0, 0, 7, 2, 2, (x) => (x === 0 || x === 6 ? 0xc8a070 : 0x6a4a2e)); }, weight: 0 }),
  P('campfire', { tier: 1, v: 1.2, size: [4, 3, 4], value: 0.3, light: { color: 0xff8a2a, h: 3, flicker: true }, build: (g) => { for (const [x, z] of [[0, 1], [3, 2], [1, 0], [2, 3]]) g.set(x, 0, z, 0x7d7a74); g.box(1, 0, 1, 3, 1, 3, 0x6a4a2e); g.set(1, 1, 1, 0xff8a2a, E); g.set(2, 1, 2, 0xffd23f, E); g.set(2, 2, 1, 0xff5a1a, E); }, weight: 0 }),
  P('tent', { tier: 2, v: 1.3, size: [6, 4, 5], value: 0.3, build: (g, r) => { const c = r.pick([0xd94f4f, 0x3b8a5a, 0xf2a02a]); for (let y = 0; y < 4; y++) g.box(0, y, y, 6, y + 1, 5 - y, c); g.box(0, 0, 2, 1, 2, 3, 0x2a2a2a); }, weight: 0 }),
  P('hay', { tier: 1, v: 1.4, size: [3, 2, 3], value: 0.2, build: (g) => g.box(0, 0, 0, 3, 2, 3, (x, y, z) => (hash3(x, y, z) < 0.5 ? 0xd9b84a : 0xc8a83a)), weight: 0 }),
  // Backyard life
  P('swing_set', { tier: 2, v: 1.2, size: [8, 6, 4], value: 0.4, build: (g, r) => { const c = r.pick([0xd94f4f, 0x3b6fd1, 0xf2c12e]); for (const x of [0, 7]) { g.box(x, 0, 0, x + 1, 6, 1, c); g.box(x, 0, 3, x + 1, 6, 4, c); } g.box(0, 5, 0, 8, 6, 4, c); g.box(2, 2, 1, 3, 3, 3, 0x333333); g.box(5, 2, 1, 6, 3, 3, 0x333333); }, weight: 0 }),
  P('trampoline', { tier: 2, v: 1.2, size: [7, 2, 7], value: 0.3, build: (g) => { g.cylinder(3.5, 3.5, 3.5, 1, 2, 0x3b6fd1, 0, true); g.cylinder(3.5, 3.5, 2.6, 1, 2, 0x1f1f24); for (const [x, z] of [[1, 1], [5, 1], [1, 5], [5, 5]]) g.set(x, 0, z, 0x55585e); }, weight: 0 }),
  P('pool', { tier: 2, v: 1.2, size: [10, 1, 6], value: 0.3, build: (g) => { g.box(0, 0, 0, 10, 1, 6, 0xe8e2d0); g.box(1, 0, 1, 9, 1, 5, 0x3fb8e8); g.set(2, 0, 2, 0x9fe8ff, E); }, weight: 0 }),
  P('hot_tub', { tier: 1, v: 1.2, size: [4, 2, 4], value: 0.3, build: (g) => { g.box(0, 0, 0, 4, 2, 4, 0x8a6a48); g.box(1, 1, 1, 3, 2, 3, 0x6fd8f2, E); }, weight: 0 }),
  P('bbq', { tier: 1, v: 1, size: [3, 3, 2], value: 0.2, build: (g) => { g.box(0, 2, 0, 3, 3, 2, 0x2a2a2a); g.set(0, 0, 0, 0x55585e); g.set(2, 0, 1, 0x55585e); g.box(0, 1, 0, 3, 2, 2, 0x3a3a3a); g.set(1, 3, 1, 0xff7a2a, E); }, weight: 0 }),
  P('doghouse', { tier: 1, v: 1, size: [4, 4, 4], value: 0.3, build: (g, r) => { const c = r.pick([0xd94f4f, 0x8a6a48, 0xf2f0ea]); g.box(0, 0, 0, 4, 2, 4, c); g.box(1, 0, 3, 3, 2, 4, 0x1a1a1a); g.box(0, 2, 1, 4, 3, 3, 0x5b4636); g.box(0, 3, 2, 4, 4, 2, 0x5b4636); g.box(0, 2, 0, 4, 3, 1, 0x5b4636); g.box(0, 2, 3, 4, 3, 4, 0x5b4636); g.box(0, 3, 1, 4, 4, 3, 0x5b4636); }, weight: 0 }),
  P('picnic_table', { tier: 1, v: 1, size: [5, 3, 4], value: 0.2, build: (g) => { g.box(0, 2, 1, 5, 3, 3, 0x9a7444); g.box(0, 1, 0, 5, 2, 1, 0x8a6434); g.box(0, 1, 3, 5, 2, 4, 0x8a6434); g.set(0, 0, 1, 0x6a4a2e); g.set(4, 0, 2, 0x6a4a2e); }, weight: 0 }),
  P('lawn_chair', { tier: 1, v: 0.8, size: [2, 3, 2], value: 0.1, build: (g, r) => { const c = r.pick([0xf2c12e, 0x3fb8e8, 0xd94f8a]); g.box(0, 1, 0, 2, 2, 2, c); g.box(0, 2, 0, 2, 3, 1, c); g.set(0, 0, 0, 0xcccccc); g.set(1, 0, 1, 0xcccccc); }, weight: 0 }),
  P('gnome', { tier: 1, v: 0.7, size: [2, 4, 2], value: 0.1, build: (g) => { g.box(0, 0, 0, 2, 2, 2, 0x3b6fd1); g.box(0, 2, 0, 2, 3, 2, 0xf2c8a8); g.set(0, 3, 0, 0xd93636); g.set(1, 3, 1, 0xd93636); g.set(0, 3, 1, 0xd93636); g.set(1, 3, 0, 0xffffff); }, weight: 0 }),
  P('bike', { tier: 1, v: 0.8, size: [4, 3, 1], value: 0.2, vehicle: true, build: (g, r) => { const c = r.pick([0xd94f4f, 0x3b6fd1, 0x2a2a2a]); g.set(0, 0, 0, 0x111111); g.set(3, 0, 0, 0x111111); g.box(0, 1, 0, 4, 2, 1, c); g.set(3, 2, 0, 0x333333); g.set(1, 2, 0, 0x222222); }, weight: 0 }),
  P('flower_bed', { tier: 1, v: 1, size: [5, 1, 2], value: 0.1, build: (g, r) => g.box(0, 0, 0, 5, 1, 2, (x, y, z) => (hash3(x, y, z) < 0.4 ? r.pick([0xd94f8a, 0xf2d24a, 0xffffff, 0x9f6fd9]) : 0x3e8e41)), weight: 0 }),
  P('newspaper_box', { tier: 1, v: 0.9, size: [2, 3, 2], value: 0.1, build: (g, r) => { g.box(0, 0, 0, 2, 3, 2, r.pick([0x3b6fd1, 0xd94f4f, 0x3a8a5a])); g.set(0, 2, 1, 0xf2f2f2); }, weight: 0.5 }),
  // City life
  P('cafe_table', { tier: 1, v: 0.8, size: [4, 5, 4], value: 0.2, build: (g, r) => { const c = r.pick([0xd94f4f, 0xf2f2f2, 0x2f9e8f, 0xf2c12e]); g.box(1, 0, 1, 3, 2, 3, 0x55585e); g.box(0, 2, 0, 4, 3, 4, 0xe8e2d0); g.set(2, 3, 2, 0x8a8f96); g.box(0, 4, 0, 4, 5, 4, (x, y, z) => ((x + z) % 2 ? c : 0xffffff)); g.set(0, 1, 2, 0x8a5a32); g.set(3, 1, 1, 0x8a5a32); }, weight: 0 }),
  P('bike_rack', { tier: 1, v: 0.8, size: [6, 3, 2], value: 0.2, build: (g, r) => { for (let x = 0; x < 6; x += 2) g.box(x, 0, 0, x + 1, 2, 2, 0x8a8f96); for (let k = 0; k < 2; k++) { const c = r.pick([0xd94f4f, 0x3b6fd1, 0x2a2a2a, 0x3a8a5a]); g.box(1 + k * 2, 1, k, 2 + k * 2, 2, k + 1, c); g.set(1 + k * 2, 2, k, 0x222222); } }, weight: 0 }),
  P('street_sign', { tier: 1, v: 0.9, size: [5, 7, 1], value: 0.1, build: (g) => { g.box(2, 0, 0, 3, 7, 1, 0x6a6f75); g.box(0, 5, 0, 5, 6, 1, 0x2a7a4a); g.set(1, 5, 0, 0xf2f2f2); g.set(3, 5, 0, 0xf2f2f2); g.box(2, 6, 0, 3, 7, 1, 0xd93636); }, weight: 0 }),
  P('newsstand', { tier: 2, v: 1.2, size: [6, 6, 4], value: 0.5, light: { color: 0xffe2a8, h: 4 }, build: (g, r) => { g.box(0, 0, 0, 6, 4, 4, 0x2a5a3a); g.box(0, 1, 3, 6, 4, 4, (x, y) => [0xd94f4f, 0xf2c12e, 0x3b6fd1, 0xf2f2f2, 0xd94f8a][(x + y) % 5]); g.box(-1, 4, 0, 7, 5, 5, 0x1f4a2e); g.box(1, 5, 1, 5, 6, 3, 0xfff2a8, E); }, weight: 0 }),
  P('bollard', { tier: 1, v: 0.7, size: [1, 2, 1], value: 0.05, build: (g) => { g.set(0, 0, 0, 0x55585e); g.set(0, 1, 0, 0xf2c12e); }, weight: 0 }),
  P('parking_meter', { tier: 1, v: 0.6, size: [1, 4, 1], value: 0.05, build: (g) => { g.box(0, 0, 0, 1, 3, 1, 0x55585e); g.set(0, 3, 0, 0x8a8f96); }, weight: 0 }),
  P('recycling', { tier: 1, v: 1, size: [4, 3, 2], value: 0.2, build: (g) => { g.box(0, 0, 0, 1, 3, 2, 0x3b6fd1); g.box(1, 0, 0, 2, 3, 2, 0x3a8a3a); g.box(2, 0, 0, 3, 3, 2, 0xf2c12e); g.box(3, 0, 0, 4, 3, 2, 0x55585e); }, weight: 0 }),
  P('statue', { tier: 2, v: 1, size: [5, 12, 5], value: 1, build: (g, r) => { g.box(0, 0, 0, 5, 4, 5, 0xc8c0b0); g.box(0, 4, 0, 5, 5, 5, 0xd8d0c0); const c = r.pick([0x4a7a6a, 0x8a6a3a, 0xd8d0c0]); g.box(1, 5, 2, 4, 7, 3, c); g.box(1, 7, 1, 4, 10, 4, c); g.box(2, 10, 2, 3, 12, 3, c); g.box(4, 9, 2, 5, 12, 3, c); }, weight: 0 }),
  P('gazebo', { tier: 2, v: 1.2, size: [9, 8, 9], value: 0.6, light: { color: 0xffe2a8, h: 6 }, build: (g) => { g.cylinder(4.5, 4.5, 4.5, 0, 1, 0xd8d0c0); for (const [x, z] of [[1, 1], [7, 1], [1, 7], [7, 7], [4, 0], [4, 8], [0, 4], [8, 4]]) g.box(x, 1, z, x + 1, 5, z + 1, 0xf2f2f2); for (let k = 0; k < 4; k++) g.cylinder(4.5, 4.5, 5 - k, 5 + k, 6 + k, k === 3 ? 0x5f9a86 : 0x4a8a76); g.set(4, 5, 4, 0xfff2a8, E); }, weight: 0 }),
  P('slide', { tier: 1, v: 0.9, size: [7, 5, 3], value: 0.2, build: (g) => { g.box(0, 0, 0, 1, 5, 1, 0xf2c12e); g.box(0, 0, 2, 1, 5, 3, 0xf2c12e); g.box(0, 4, 0, 2, 5, 3, 0xd94f4f); for (let k = 0; k < 5; k++) g.box(2 + k, 4 - k, 1, 3 + k, 5 - k, 2, 0x3b6fd1); }, weight: 0 }),
  P('climber', { tier: 1, v: 0.9, size: [6, 5, 6], value: 0.2, build: (g) => { for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x += 2) for (let z = 0; z < 6; z += 2) { g.set(x, y, z, 0xd94f4f); if (y % 2 === 0) { g.set(x + 1, y, z, 0x3b6fd1); g.set(x, y, z + 1, 0x3b6fd1); } } }, weight: 0 }),
  P('seesaw', { tier: 1, v: 0.8, size: [8, 2, 2], value: 0.1, build: (g) => { g.set(4, 0, 0, 0x55585e); g.set(4, 0, 1, 0x55585e); g.box(0, 1, 0, 8, 2, 2, (x) => (x < 4 ? 0xf2c12e : 0x3a8a5a)); }, weight: 0 }),
  P('hoop', { tier: 1, v: 0.9, size: [3, 9, 2], value: 0.2, build: (g) => { g.box(1, 0, 0, 2, 8, 1, 0x55585e); g.box(0, 7, 0, 3, 9, 1, 0xf2f2f2); g.set(1, 7, 1, 0xf28a1a); }, weight: 0 }),
  P('tennis_net', { tier: 1, v: 1, size: [1, 2, 18], value: 0.2, build: (g) => { g.box(0, 0, 0, 1, 2, 18, (x, y, z) => (y === 1 ? 0xf2f2f2 : (z % 2 ? 0x2a2a2a : 0x3a3a3a))); }, weight: 0 }),
  P('beach_umbrella', { tier: 1, v: 0.9, size: [5, 5, 5], value: 0.1, build: (g, r) => { const c = r.pick([0xd94f4f, 0x3b6fd1, 0xf2c12e, 0x2f9e8f, 0xd94f8a]); g.box(2, 0, 2, 3, 4, 3, 0xf2f2f2); g.box(0, 4, 0, 5, 5, 5, (x, y, z) => ((x + z) % 2 ? c : 0xffffff)); g.box(0, 0, 3, 3, 1, 5, r.pick([0xf2c12e, 0xd94f8a, 0x6fd8c8])); }, weight: 0 }),
  P('lifeguard_tower', { tier: 2, v: 1, size: [5, 9, 5], value: 0.4, build: (g) => { for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) g.box(x, 0, z, x + 1, 5, z + 1, 0xf2f2f2); g.box(0, 5, 0, 5, 8, 5, 0xd94f4f); g.box(0, 6, 4, 5, 7, 5, 0x9fd0e8); g.box(-1, 8, -1, 6, 9, 6, 0xf2f2f2); }, weight: 0 }),
  P('big_screen', { tier: 3, v: 1.6, size: [16, 14, 2], value: 1.5, light: { color: 0x9fe8ff, h: 12 }, build: (g, r) => { g.box(3, 0, 1, 4, 5, 2, 0x3a3d44); g.box(12, 0, 1, 13, 5, 2, 0x3a3d44); g.box(0, 5, 1, 16, 14, 2, 0x15151c); const palette = r.pick([[0x22e6ff, 0xff2bd6, 0xffffff], [0xffd23f, 0xff4d6d, 0xffffff], [0x39ff88, 0x7b5cff, 0x22e6ff]]); for (let x = 1; x < 15; x++) for (let y = 6; y < 13; y++) g.set(x, y, 0, palette[Math.floor(hash3(x >> 1, y >> 1, 3) * 3)], E); }, weight: 0 }),
  P('flagpole', { tier: 1, v: 0.9, size: [4, 12, 1], value: 0.1, build: (g, r) => { g.box(0, 0, 0, 1, 12, 1, 0xd8d8d8); g.box(1, 9, 0, 4, 11, 1, (x, y) => (y === 10 ? r.pick([0xd93636, 0x2a4a9a, 0x3a8a3a]) : 0xf2f2f2)); }, weight: 0 }),
  P('planter_tree', { tier: 2, v: 1.4, size: [5, 10, 5], value: 0.4, build: (g, r) => { g.box(0, 0, 0, 5, 1, 5, 0x8d8a83); g.box(2, 1, 2, 3, 5, 3, 0x5a3d26); for (let y = 4; y < 10; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) if (Math.hypot(x - 2, (y - 7) * 1.2, z - 2) < 2.6 && hash3(x, y, z) > 0.1) g.set(x, y, z, r.pick([0x3e8e41, 0x4f9d3a, 0x2f7a3a])); }, weight: 0 }),
  P('food_truck', { tier: 2, v: 1.6, size: [9, 7, 4], vehicle: true, light: { color: 0xffc36b, h: 5 }, build: (g, r) => { const c = r.pick([0xf2c12e, 0xd94f8a, 0x2f9e8f, 0xf28a1a]); g.box(0, 1, 0, 9, 6, 4, c); g.box(7, 3, 0, 9, 5, 4, 0x22303d); g.box(1, 3, 3, 6, 5, 4, 0xffe2a8, E); g.box(0, 5, 4, 7, 6, 5, 0xffffff); for (const x of [1, 6]) for (const z of [0, 3]) g.box(x, 0, z, x + 2, 2, z + 1, 0x111111); g.box(2, 6, 1, 6, 7, 3, 0xff4d6d, E); }, weight: 0 }),
  P('ice_cream_cart', { tier: 1, v: 0.8, size: [4, 5, 2], value: 0.2, build: (g) => { g.box(0, 1, 0, 4, 3, 2, 0xf2f2f2); g.box(0, 2, 0, 4, 3, 2, 0xf6c1d8); g.box(0, 4, 0, 4, 5, 2, (x) => (x % 2 ? 0xd94f8a : 0xffffff)); g.box(0, 3, 0, 1, 4, 1, 0xaaaaaa); g.set(1, 0, 0, 0x111111); g.set(3, 0, 1, 0x111111); }, weight: 0 }),
  P('metro_entrance', { tier: 2, v: 1, size: [6, 6, 8], value: 0.6, light: { color: 0x9fd8ff, h: 5 }, build: (g) => { g.box(0, 0, 0, 1, 3, 8, 0x55585e); g.box(5, 0, 0, 6, 3, 8, 0x55585e); for (let k = 0; k < 6; k++) g.box(1, 0, k, 5, 1, k + 1, 0x3a3d44); g.box(0, 3, 0, 6, 4, 8, 0x6a7a8a); g.box(1, 4, 6, 5, 6, 7, 0x2a5bd9); g.box(2, 4, 6, 4, 6, 7, 0xffffff, E); }, weight: 0 }),
];

// Space clutter and the garden floor, past the city (see realmtypes.js).
PROP_TYPES.push(...REALM_PROPS);

export const PROP_BY_ID = Object.fromEntries(PROP_TYPES.map((p) => [p.id, p]));

export function propDims(id) {
  const p = PROP_BY_ID[id];
  return { w: p.size[0] * p.v, h: p.size[2] * p.v, height: p.size[1] * p.v, v: p.v };
}

export function buildProp(id, variant) {
  const p = PROP_BY_ID[id];
  const g = new VoxelGrid(p.size[0], p.size[1], p.size[2]);
  const rng = createRng(1000 + variant * 7 + id.length * 131 + id.charCodeAt(0));
  p.build(g, rng);
  return { grid: g, origin: { x: p.size[0] / 2, z: p.size[2] / 2 }, v: p.v };
}
