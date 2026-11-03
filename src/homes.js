// Home life at a hatchling's scale: what fills a lived-in suburb while the kaiju is no taller than
// the people in it. Patio sets and parasols, sun loungers and pool floats, grills and fire pits,
// pergolas and greenhouses, play forts, sandpit toys and lawn flamingos, a lemonade stand, a boat
// on its trailer, a birthday party, and the park things (kites, skate ramps, swan boats, reeds).
// They're sized against the people (about 5 units tall), so a patio table comes up to a person's
// waist; most are `micro`: only generated while the kaiju is small enough to see them (world.js).
import { E, shade, hash3 } from './voxel.js';

const FOLIAGE = [0x3e8e41, 0x4f9d3a, 0x2f7a3a, 0x5aa845];
const PAINTS = [0xd94f4f, 0x3b6fd1, 0xf2c12e, 0x3a8a5a, 0xd94f8a, 0xf28a1a, 0x8a5ad9, 0x2fb8b0];
const CANOPY = [[0xd94f4f, 0xf6f2ea], [0x2f8fd1, 0xf6f2ea], [0x3a8a5a, 0xf2e8c8], [0xf2c12e, 0xf6f2ea], [0x2a3a5a, 0xe8e2d0]];
const WOOD = 0x9a7444;
const STEEL = 0xc8ccd4;
const foliage = (x, y, z) => FOLIAGE[Math.floor(hash3(x, y, z) * FOLIAGE.length)];

// A striped round canopy, centred on the grid, at height y.
function canopy(g, y, r, [a, b]) {
  const cx = g.nx / 2;
  const cz = g.nz / 2;
  for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d > r) continue;
    const ang = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
    const c = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8) % 2 ? a : b;
    g.set(x, d > r - 1.2 ? y : y + 1, z, c);
  }
}

// ---------------------------------------------------------------- the patio
function patioSet(g, rng) {
  const cols = rng.pick(CANOPY);
  // Table, four chairs round it, the parasol through the middle.
  g.box(3, 2, 3, 6, 3, 6, 0xf2f0ea);
  g.set(4, 0, 4, 0x8a8f96);
  g.set(4, 1, 4, 0x8a8f96);
  const chair = rng.pick([0x55585e, 0xf2f0ea, WOOD]);
  for (const [x, z, bx, bz] of [[4, 1, 4, 0], [4, 7, 4, 8], [1, 4, 0, 4], [7, 4, 8, 4]]) {
    g.set(x, 0, z, chair);
    g.set(x, 1, z, chair);
    g.set(bx, 1, bz, chair);
    g.set(bx, 2, bz, chair);
  }
  g.set(3, 3, 3, 0xffffff);
  g.set(5, 3, 5, 0xd94f4f);
  g.box(4, 3, 4, 5, 7, 5, 0xe8e2d0);
  canopy(g, 6, 4.4, cols);
}
function parasol(g, rng) {
  g.box(3, 0, 3, 4, 7, 4, 0xe8e2d0);
  g.box(2, 0, 2, 5, 1, 5, 0x55585e);
  canopy(g, 6, 3.6, rng.pick(CANOPY));
}
function sunLounger(g, rng) {
  const cushion = rng.pick([0xf2f0ea, 0x2f8fd1, 0xf2c12e, 0x3a8a5a]);
  for (const [x, z] of [[0, 0], [2, 0], [0, 5], [2, 5]]) g.set(x, 0, z, STEEL);
  g.box(0, 1, 0, 3, 2, 6, cushion);
  g.box(0, 2, 0, 3, 3, 2, cushion);
  g.box(0, 3, 0, 3, 4, 1, shade(cushion, 0.9));
  // A towel thrown over it.
  g.box(1, 2, 3, 2, 3, 6, rng.pick([0xd94f8a, 0xf28a1a, 0x2fb8b0]));
}
function grill(g) {
  g.box(1, 0, 0, 4, 3, 3, 0x2a2b30);
  g.box(0, 2, 0, 5, 3, 3, 0x6a6e76);
  g.box(1, 3, 0, 4, 5, 3, 0x1c1d21);
  g.box(1, 4, 0, 4, 5, 1, 0x3a3d44);
  g.set(1, 1, 0, STEEL);
  g.set(2, 1, 0, STEEL);
  g.set(3, 1, 0, STEEL);
  g.set(2, 3, 1, 0xff7a2a, E);
  g.set(4, 0, 2, 0xe8e8e8);
  g.set(4, 1, 2, 0xe8e8e8);
}
function firePit(g) {
  g.cylinder(4, 4, 2.4, 0, 1, (x, y, z) => (hash3(x, y, z) < 0.5 ? 0x8a8478 : 0x6e6a62), 0, true);
  g.box(3, 0, 3, 5, 1, 5, 0x3a2a1e);
  g.set(3, 1, 3, 0xff8a2a, E);
  g.set(4, 1, 4, 0xffd23f, E);
  g.set(4, 2, 3, 0xff5a1a, E);
  g.set(3, 1, 4, 0xff5a1a, E);
  // Log seats round it.
  for (const [x0, z0, x1, z1] of [[2, 0, 6, 1], [2, 7, 6, 8], [0, 2, 1, 6], [7, 2, 8, 6]]) g.box(x0, 0, z0, x1, 1, z1, (x) => (x % 2 ? 0x7a5634 : 0x8a6440));
}
function outdoorSofa(g, rng) {
  const c = rng.pick([0xe8e2d0, 0x55585e, 0x3a6a8a]);
  const pillow = rng.pick(PAINTS);
  g.box(0, 0, 0, 8, 2, 2, c);
  g.box(0, 2, 0, 8, 3, 1, shade(c, 0.9));
  g.box(0, 0, 2, 2, 2, 6, c);
  g.box(0, 2, 2, 1, 3, 6, shade(c, 0.9));
  g.set(3, 2, 1, pillow);
  g.set(1, 2, 4, pillow);
  g.box(4, 0, 3, 7, 1, 5, WOOD);
  g.set(5, 1, 4, 0xf2f0ea);
}
function pergola(g, rng) {
  const timber = rng.pick([0x8a6440, 0xe8e2d0, 0x5a4636]);
  for (const [x, z] of [[0, 0], [15, 0], [0, 11], [15, 11]]) g.box(x, 0, z, x + 1, 9, z + 1, timber);
  for (const z of [0, 11]) g.box(0, 9, z, 16, 10, z + 1, timber);
  for (let x = 1; x < 15; x += 2) g.box(x, 9, 0, x + 1, 10, 12, timber);
  // Vines over the top, with flowers.
  for (let z = 0; z < 12; z++) for (let x = 0; x < 16; x++) if (hash3(x, 11, z) < 0.35) g.set(x, 10, z, hash3(x, 12, z) < 0.15 ? 0xd94f8a : foliage(x, 10, z));
  for (const [x, z] of [[0, 0], [15, 11]]) for (let y = 3; y < 9; y++) if (hash3(x, y, z) < 0.6) g.set(x, y, z, foliage(x, y, z));
  // A dining table and chairs underneath.
  g.box(5, 2, 4, 11, 3, 8, WOOD);
  for (const x of [5, 10]) for (const z of [4, 7]) g.box(x, 0, z, x + 1, 2, z + 1, shade(WOOD, 0.8));
  for (let x = 5; x < 11; x += 2) {
    g.box(x, 0, 2, x + 1, 2, 3, timber);
    g.box(x, 0, 9, x + 1, 2, 10, timber);
  }
  g.set(7, 3, 5, 0xf2f0ea);
  g.set(9, 3, 6, 0xd94f4f);
}
function hammock(g, rng) {
  const c = rng.pick(PAINTS);
  for (const x of [0, 9]) g.box(x, 0, 1, x + 1, 5, 2, WOOD);
  for (let x = 1; x < 9; x++) {
    const sag = Math.round(3.5 - Math.sin(((x - 0.5) / 8) * Math.PI) * 1.6);
    g.box(x, sag, 0, x + 1, sag + 1, 3, (xx, y, z) => ((xx + z) % 2 ? c : 0xf6f2ea));
  }
}
function playFort(g, rng) {
  const roof = rng.pick([0x3a8a5a, 0xd94f4f, 0x2f8fd1]);
  for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) g.box(x, 0, z, x + 1, 7, z + 1, WOOD);
  g.box(0, 4, 0, 6, 5, 6, shade(WOOD, 1.1));
  g.box(0, 5, 0, 6, 6, 1, WOOD);
  g.box(0, 5, 5, 6, 6, 6, WOOD);
  g.box(0, 7, 0, 6, 8, 6, roof);
  g.box(1, 8, 1, 5, 9, 5, roof);
  g.box(2, 9, 2, 4, 10, 4, roof);
  // The slide down one side, the swing beam off the other.
  for (let x = 6; x < 11; x++) g.box(x, 4 - Math.floor((x - 6) * 0.9), 2, x + 1, 5 - Math.floor((x - 6) * 0.9), 4, 0xf2c12e);
  g.box(11, 0, 2, 12, 1, 4, 0xf2c12e);
  g.box(0, 0, 7, 1, 7, 8, WOOD);
  g.box(0, 6, 6, 1, 7, 8, WOOD);
  g.box(2, 6, 7, 6, 7, 8, WOOD);
  g.set(3, 2, 7, 0x2a2a2a);
  g.set(3, 3, 7, 0x8a8f96);
  g.set(3, 4, 7, 0x8a8f96);
  g.set(3, 5, 7, 0x8a8f96);
}
function sandToys(g, rng) {
  const a = rng.pick(PAINTS);
  g.box(0, 0, 0, 2, 2, 2, a);
  g.set(0, 2, 0, shade(a, 0.8));
  g.box(3, 0, 1, 5, 1, 2, 0xf2c12e);
  g.set(4, 1, 1, 0xd94f4f);
  g.box(1, 0, 4, 4, 1, 6, 0xe0cc8e);
  g.box(2, 1, 4, 3, 2, 5, 0xe0cc8e);
  g.set(5, 0, 4, 0x3b6fd1);
  g.set(5, 1, 4, 0x3b6fd1);
}
function toys(g, rng) {
  g.box(0, 0, 0, 2, 2, 2, rng.pick([0xd94f4f, 0xf2c12e, 0x2fb8b0]));
  g.set(0, 1, 0, 0xffffff);
  g.box(3, 0, 1, 5, 1, 2, 0xf2c12e);
  g.set(3, 1, 1, 0xd94f4f);
  g.set(4, 0, 3, 0x2f8fd1);
  g.set(4, 1, 3, 0x2f8fd1);
  g.set(4, 2, 3, 0x8a8f96);
}
function goalSmall(g) {
  g.box(0, 0, 0, 1, 4, 1, 0xf6f6f6);
  g.box(7, 0, 0, 8, 4, 1, 0xf6f6f6);
  g.box(0, 3, 0, 8, 4, 1, 0xf6f6f6);
  g.box(1, 0, 2, 7, 3, 3, (x, y) => ((x + y) % 2 ? 0xdcdcdc : null));
  g.box(0, 3, 1, 8, 4, 2, (x) => (x % 2 ? 0xdcdcdc : null));
}

// ---------------------------------------------------------------- the garden
function glasshouse(g) {
  const glass = 0xbfe6ee;
  g.box(0, 0, 0, 10, 6, 7, (x, y, z) => (x === 0 || x === 9 || z === 0 || z === 6 ? ((x + y + z) % 4 === 0 ? 0xf2f2f2 : glass) : null));
  g.box(0, 6, 1, 10, 7, 6, glass);
  g.box(0, 7, 2, 10, 8, 5, glass);
  g.box(0, 6, 0, 10, 7, 1, 0xf2f2f2);
  g.box(0, 6, 6, 10, 7, 7, 0xf2f2f2);
  g.box(0, 8, 3, 10, 8, 4, 0xf2f2f2);
  for (let x = 1; x < 9; x++) {
    g.set(x, 1, 1, x % 3 ? foliage(x, 1, 1) : 0xd94f4f);
    g.set(x, 1, 5, x % 2 ? foliage(x, 1, 5) : 0xf2c12e);
    if (x % 2) g.set(x, 2, 1, foliage(x, 2, 1));
  }
  g.box(4, 0, 0, 6, 4, 1, 0x7fc8d8);
}
function raisedBed(g) {
  g.box(0, 0, 0, 10, 2, 4, (x, y, z) => (x === 0 || x === 9 || z === 0 || z === 3 ? 0x8a6440 : y === 0 ? 0x5a3e26 : null));
  for (let x = 1; x < 9; x++) {
    g.set(x, 1, 1, x % 2 ? 0x6fbf4a : 0x4f9a3a);
    g.set(x, 1, 2, x % 3 === 0 ? 0xd94f4f : x % 3 === 1 ? 0x4f9a3a : 0xf28a1a);
    if (x % 2 === 0) g.set(x, 2, 2, 0x3e8e41);
  }
}
function compostBin(g) {
  g.box(0, 0, 0, 4, 3, 4, 0x2a3a2a);
  g.box(0, 3, 0, 4, 4, 4, 0x1e2a1e);
  g.set(1, 1, 0, 0x3a4a3a);
}
function gardenArch(g) {
  for (const x of [0, 5]) g.box(x, 0, 0, x + 1, 7, 2, 0xf2f2f2);
  g.box(0, 7, 0, 6, 8, 2, 0xf2f2f2);
  for (let y = 1; y < 8; y++) for (const x of [0, 5]) if (hash3(x, y, 3) < 0.7) g.set(x, y, hash3(x, y, 4) < 0.5 ? 0 : 1, hash3(x, y, 5) < 0.3 ? 0xd94f6a : foliage(x, y, 0));
  for (let x = 0; x < 6; x++) if (hash3(x, 8, 2) < 0.7) g.set(x, 7, x % 2, hash3(x, 9, 1) < 0.35 ? 0xf28aa8 : foliage(x, 7, 0));
}
function flamingo(g) {
  g.set(1, 0, 1, 0x2a2a2a);
  g.set(1, 1, 1, 0x2a2a2a);
  g.set(1, 2, 1, 0x2a2a2a);
  g.box(0, 3, 0, 2, 4, 3, 0xff6fa8);
  g.set(1, 4, 2, 0xff6fa8);
  g.set(1, 5, 2, 0xff6fa8);
  g.set(1, 5, 1, 0xff8abf);
  g.set(1, 5, 0, 0x1a1a1a);
}
function birdFeeder(g) {
  g.box(1, 0, 1, 2, 5, 2, WOOD);
  g.box(0, 5, 0, 3, 6, 3, 0xd8c8a0);
  g.box(0, 6, 0, 3, 7, 3, 0x8a3a2a);
  g.set(1, 5, 0, 0xf2d24a);
  g.set(2, 6, 1, 0x3b6fd1);
}
function lawnSign(g, rng) {
  const kind = rng.int(0, 2);
  g.box(0, 0, 0, 1, 6, 1, kind === 1 ? 0x55585e : 0xf2f2f2);
  const [a, b] = kind === 0 ? [0xd93636, 0xffffff] : kind === 1 ? [0x2a5bd9, 0xffffff] : [0x3a8a5a, 0xf2d24a];
  g.box(1, 2, 0, 5, 5, 1, (x, y) => (y === 3 && x > 1 && x < 4 ? b : a));
}
function lemonadeStand(g) {
  g.box(0, 0, 0, 7, 3, 3, (x, y, z) => (z === 0 && y === 1 ? 0xf2d24a : 0xd8b07a));
  g.box(0, 3, 0, 7, 4, 3, 0xe8c890);
  for (const x of [0, 6]) g.box(x, 4, 0, x + 1, 7, 1, 0xd8b07a);
  g.box(0, 6, 0, 7, 7, 1, (x) => (x % 2 ? 0xf2d24a : 0xffffff));
  g.box(2, 4, 1, 3, 6, 2, 0xfff2a8);
  g.set(4, 4, 1, 0xd94f4f);
  g.set(5, 4, 2, 0xfff2a8);
  g.box(2, 0, 3, 5, 2, 4, 0x3b6fd1);
}
function gardenLamp(g) {
  g.box(0, 0, 0, 1, 3, 1, 0x2a2a2e);
  g.set(0, 3, 0, 0xfff2b8, E);
}
function sprinkler(g) {
  g.set(1, 0, 1, 0x3a8a5a);
  // A fan of spray, caught mid-sweep.
  for (const [x, y, z] of [[1, 1, 1], [0, 2, 1], [2, 2, 1], [0, 3, 0], [2, 3, 2], [1, 3, 0], [1, 2, 2]]) g.set(x, y, z, 0xbfeaff);
}
function hoseReel(g) {
  g.box(0, 0, 0, 3, 1, 2, 0x55585e);
  g.cylinder(1.5, 1, 1.4, 1, 3, 0x3a9a4a, 0, true);
  g.set(1, 2, 1, 0x2a6a3a);
}
function rabbitHutch(g) {
  g.box(0, 0, 0, 6, 1, 3, 0x8a6440);
  g.box(0, 1, 0, 6, 4, 3, (x, y, z) => (z === 0 && x > 0 && x < 4 ? ((x + y) % 2 ? 0xc8ccd4 : null) : 0xb08858));
  g.box(0, 4, 0, 6, 5, 3, 0x5a4636);
  g.box(1, 1, 1, 3, 2, 2, 0xf2f2f2);
  g.set(2, 2, 1, 0xf2f2f2);
  g.set(1, 2, 1, 0xf2b8c8);
}
function porchSwing(g, rng) {
  const c = rng.pick([0xf2f2f2, 0x8a6440, 0x3a6a8a]);
  for (const x of [0, 6]) {
    g.box(x, 0, 0, x + 1, 6, 1, 0x55585e);
    g.box(x, 0, 2, x + 1, 6, 3, 0x55585e);
  }
  g.box(0, 5, 0, 7, 6, 3, 0x55585e);
  g.box(1, 2, 1, 6, 3, 3, c);
  g.box(1, 3, 2, 6, 4, 3, c);
  g.set(2, 3, 1, rng.pick(PAINTS));
}
function boatTrailer(g, rng) {
  const hull = rng.pick([0xf2f2f2, 0x2a5bd9, 0xd93636]);
  g.box(0, 0, 1, 1, 2, 3, 0x15161a);
  g.box(6, 0, 0, 7, 2, 1, 0x15161a);
  g.box(6, 0, 3, 7, 2, 4, 0x15161a);
  g.box(0, 1, 1, 11, 2, 3, 0x55585e);
  g.box(2, 2, 0, 11, 4, 4, hull);
  g.box(10, 2, 1, 11, 4, 3, shade(hull, 0.85));
  g.box(3, 4, 1, 6, 5, 3, 0x9fd8f2);
  g.box(2, 4, 0, 11, 5, 1, 0xf2f2f2);
  g.box(2, 4, 3, 11, 5, 4, 0xf2f2f2);
  g.box(0, 3, 1, 2, 5, 3, 0x2a2a2a);
}

// ---------------------------------------------------------------- the pool
function poolLadder(g) {
  for (const z of [0, 2]) {
    g.box(0, 0, z, 1, 4, z + 1, STEEL);
    g.set(1, 3, z, STEEL);
    g.set(2, 3, z, STEEL);
    g.set(2, 2, z, STEEL);
  }
  g.box(1, 1, 0, 2, 2, 3, STEEL);
}
function divingBoard(g) {
  g.box(0, 0, 0, 3, 2, 2, 0xd8d4ca);
  g.box(0, 2, 0, 3, 3, 8, 0x2f8fd1);
  g.box(0, 2, 7, 3, 3, 8, 0xf2f2f2);
}
function poolFloat(g, rng) {
  const kind = rng.int(0, 2);
  if (kind === 0) {
    // A sprinkled doughnut.
    g.cylinder(2, 2, 2, 0, 1, (x, y, z) => (hash3(x, y, z) < 0.25 ? 0xf2d24a : 0xff8abf), 0, true);
  } else if (kind === 1) {
    g.cylinder(2, 2, 2, 0, 1, (x, y, z) => ((x + z) % 2 ? 0xd93636 : 0xffffff), 0, true);
  } else {
    // A flamingo.
    g.box(0, 0, 1, 4, 1, 3, 0xff6fa8);
    g.set(3, 1, 2, 0xff6fa8);
    g.set(3, 2, 2, 0xff6fa8);
    g.set(3, 2, 1, 0xffd23f);
  }
}

// ---------------------------------------------------------------- the party
function partyTable(g) {
  g.box(0, 2, 0, 10, 3, 4, (x, y, z) => ((x + z) % 2 ? 0xffffff : 0xffb8d0));
  for (const x of [0, 9]) for (const z of [0, 3]) g.box(x, 0, z, x + 1, 2, z + 1, 0xd8d8d8);
  // The cake, its candles lit.
  g.box(4, 3, 1, 7, 5, 3, 0xf6e6c8);
  g.box(4, 5, 1, 7, 6, 3, 0xff8abf);
  g.set(5, 6, 2, 0xffd23f, E);
  g.set(6, 6, 1, 0xffd23f, E);
  for (const [x, z, c] of [[1, 1, 0xd94f4f], [2, 3, 0x3b6fd1], [8, 1, 0xf2c12e], [9, 2, 0x3a8a5a]]) g.set(x, 3, z, c);
  g.set(1, 3, 3, 0xf28a1a);
  g.set(8, 3, 3, 0x8a5ad9);
}
function balloons(g) {
  g.box(1, 0, 1, 3, 1, 3, 0x55585e);
  for (let y = 1; y < 6; y++) g.set(2, y, 2, 0xf2f2f2);
  for (const [x, y, z, c] of [[1, 7, 1, 0xd94f4f], [3, 8, 2, 0x3b6fd1], [2, 9, 3, 0xf2c12e], [0, 8, 3, 0x3a8a5a], [2, 7, 2, 0xd94f8a], [3, 6, 0, 0x8a5ad9]]) {
    g.set(x, y, z, c);
    g.set(x, y - 1, z, shade(c, 0.9));
  }
}
function bouncyCastle(g, rng) {
  const [a, b] = rng.pick([[0xd94f4f, 0xf2c12e], [0x2f8fd1, 0xf2c12e], [0xd94f8a, 0x2fb8b0]]);
  g.box(0, 0, 0, 12, 2, 12, a);
  g.box(1, 2, 1, 11, 3, 11, 0x3b6fd1);
  g.box(0, 2, 0, 12, 5, 1, (x, y) => ((x + y) % 2 ? a : b));
  g.box(0, 2, 11, 12, 5, 12, (x, y) => ((x + y) % 2 ? a : b));
  g.box(0, 2, 0, 1, 5, 12, (x, y, z) => ((z + y) % 2 ? a : b));
  g.box(11, 2, 0, 12, 5, 12, (x, y, z) => ((z + y) % 2 ? a : b));
  for (const [x, z] of [[0, 0], [10, 0], [0, 10], [10, 10]]) {
    g.box(x, 2, z, x + 2, 8, z + 2, b);
    g.box(x, 8, z, x + 2, 9, z + 2, a);
  }
  g.box(4, 2, 0, 8, 4, 1, 0x3b6fd1);
}
function giftPile(g, rng) {
  for (const [x, z, w, h] of [[0, 0, 2, 2], [2, 1, 3, 2], [1, 2, 2, 1]]) {
    const c = rng.pick(PAINTS);
    g.box(x, 0, z, x + w, h, z + 2, c);
    g.box(x + Math.floor(w / 2), 0, z, x + Math.floor(w / 2) + 1, h, z + 2, 0xffffff);
  }
}
function garageSale(g) {
  g.box(0, 2, 0, 9, 3, 4, 0xe8e2d0);
  for (const x of [0, 8]) for (const z of [0, 3]) g.box(x, 0, z, x + 1, 2, z + 1, 0x8a8f96);
  g.box(1, 3, 1, 3, 5, 3, 0x2a2a2e);
  g.box(1, 4, 1, 3, 5, 2, 0x5fa8c8);
  g.box(4, 3, 1, 6, 4, 2, 0xd94f4f);
  g.box(4, 4, 1, 6, 5, 2, 0x3b6fd1);
  g.set(7, 3, 2, 0xf2d24a);
  g.set(7, 4, 2, 0xf2f2e0);
  g.box(0, 0, 4, 2, 2, 5, 0xc8a070);
}

// ---------------------------------------------------------------- the park
function picnicBasket(g) {
  g.box(0, 0, 0, 3, 2, 2, 0xc89a5a);
  g.box(1, 2, 0, 2, 3, 2, 0x9a7444);
  g.set(0, 1, 0, 0xd93636);
}
function kite(g, rng) {
  const c = rng.pick(PAINTS);
  // The string runs up from a peg to the kite riding high.
  g.set(0, 0, 0, 0x8a6440);
  for (let y = 1; y < 12; y++) g.set(Math.min(2, Math.floor(y / 5)), y, Math.min(2, Math.floor(y / 6)), 0xf2f2f2);
  g.box(1, 12, 1, 4, 13, 2, c);
  g.box(2, 11, 1, 3, 14, 2, c);
  g.set(2, 12, 1, shade(c, 0.7));
  g.set(2, 10, 1, rng.pick(PAINTS));
  g.set(2, 9, 2, rng.pick(PAINTS));
}
function skateRamp(g) {
  for (let x = 0; x < 10; x++) {
    const h = Math.max(1, Math.round(4 * Math.pow(x / 9, 2)));
    g.box(x, 0, 0, x + 1, h, 8, (xx, y) => (y === h - 1 ? 0x9aa0a8 : 0x6a6e76));
  }
  g.box(9, 4, 0, 10, 5, 8, 0xd8d8d8);
  g.box(2, 0, 3, 3, 1, 5, 0xf28a1a);
}
function outdoorGym(g) {
  for (const x of [0, 4, 9]) g.box(x, 0, 1, x + 1, x === 4 ? 4 : 6, 2, 0x2f8fd1);
  g.box(0, 5, 1, 5, 6, 2, 0xf2c12e);
  g.box(4, 3, 1, 10, 4, 2, 0xf2c12e);
  g.box(6, 0, 0, 8, 1, 3, 0x55585e);
}
function merryGoRound(g) {
  g.cylinder(4, 4, 4, 0, 1, (x, y, z) => (Math.floor(Math.atan2(z - 4, x - 4) * 2) % 2 ? 0xd94f4f : 0xf2c12e));
  g.box(3, 1, 3, 5, 3, 5, 0x55585e);
  for (const [x, z] of [[1, 4], [7, 4], [4, 1], [4, 7]]) g.set(x, 1, z, 0x3b6fd1);
}
function springRider(g, rng) {
  const c = rng.pick([0xd94f4f, 0x3a8a5a, 0xf2c12e]);
  g.set(1, 0, 0, 0x8a8f96);
  g.set(1, 1, 0, 0x8a8f96);
  g.box(0, 2, 0, 3, 3, 2, c);
  g.box(2, 3, 0, 3, 4, 2, c);
  g.set(2, 4, 0, 0x1a1a1a);
}
function drinkingFountain(g) {
  g.box(0, 0, 0, 2, 3, 2, 0x8a8f96);
  g.box(0, 3, 0, 2, 4, 2, STEEL);
  g.set(1, 4, 1, 0x7fd8f2);
}
function parkSign(g) {
  for (const x of [0, 5]) g.box(x, 0, 0, x + 1, 4, 1, 0x5a4636);
  g.box(0, 3, 0, 6, 6, 1, 0x3a6a3a);
  g.box(1, 4, 0, 5, 5, 1, 0xf2e8c8);
}
function swanBoat(g) {
  g.box(0, 0, 0, 5, 2, 3, 0xf6f6f6);
  g.box(1, 2, 0, 4, 3, 3, 0xf6f6f6);
  g.box(4, 2, 1, 5, 5, 2, 0xf6f6f6);
  g.set(4, 5, 1, 0xf6f6f6);
  g.set(4, 4, 0, 0xf28a1a);
  g.set(2, 2, 1, 0x2f8fd1);
}
function reeds(g) {
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    if (hash3(x, 0, z) < 0.45) continue;
    const h = 2 + Math.floor(hash3(x, 1, z) * 3);
    for (let y = 0; y < h; y++) g.set(x, y, z, y === h - 1 && hash3(x, 2, z) < 0.4 ? 0x6a4a2a : shade(0x6a9a3a, 0.85 + hash3(x, y, z) * 0.3));
  }
}
function roseBush(g, rng) {
  const c = rng.pick([0xd93a4a, 0xf2f2f2, 0xf28aa8, 0xf2d24a]);
  for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
    if (Math.hypot(x - 1, y * 1.2 - 0.6, z - 1) > 1.8) continue;
    g.set(x, y, z, hash3(x, y, z) < 0.3 ? c : foliage(x, y, z));
  }
}

// [id, tier, voxel size, [nx, ny, nz], builder, extras]. micro: only built while the kaiju is
// small (world.js leaves it out of blocks generated once you've outgrown the yards).
const H = (id, tier, v, size, build, more = {}) => ({ id, tier, v, size, build, value: tier === 1 ? 0.15 : 0.4, variants: 3, weight: 0, micro: true, ...more });
const fixed = { variants: 1 };

export const HOME_PROPS = [
  H('patio_set', 1, 0.55, [9, 8, 9], patioSet),
  H('parasol', 1, 0.6, [7, 8, 7], parasol),
  H('sun_lounger', 1, 0.6, [3, 4, 6], sunLounger),
  H('grill', 1, 0.6, [5, 5, 3], grill, { ...fixed, value: 0.2 }),
  H('fire_pit', 1, 0.6, [8, 3, 8], firePit, { ...fixed, light: { color: 0xff8a3a, h: 2 } }),
  H('outdoor_sofa', 1, 0.6, [8, 4, 6], outdoorSofa),
  H('pergola', 2, 0.75, [16, 11, 12], pergola, { micro: false }),
  H('hammock', 1, 0.6, [10, 5, 3], hammock),
  H('play_fort', 2, 0.75, [12, 10, 8], playFort, { micro: false }),
  H('sand_toys', 1, 0.45, [6, 3, 6], sandToys),
  H('toys', 1, 0.45, [5, 3, 4], toys),
  H('goal_small', 1, 0.6, [8, 4, 3], goalSmall, fixed),
  H('glasshouse', 2, 0.75, [10, 9, 7], glasshouse, { ...fixed, micro: false }),
  H('raised_bed', 1, 0.6, [10, 3, 4], raisedBed, fixed),
  H('compost_bin', 1, 0.6, [4, 4, 4], compostBin, fixed),
  H('garden_arch', 1, 0.6, [6, 8, 2], gardenArch, fixed),
  H('flamingo', 1, 0.45, [2, 6, 3], flamingo, fixed),
  H('bird_feeder', 1, 0.5, [3, 7, 3], birdFeeder, fixed),
  H('lawn_sign', 1, 0.5, [5, 6, 1], lawnSign),
  H('lemonade_stand', 1, 0.6, [7, 7, 4], lemonadeStand, { ...fixed, value: 0.3 }),
  H('garden_lamp', 1, 0.45, [1, 4, 1], gardenLamp, fixed),
  H('sprinkler', 1, 0.45, [3, 4, 3], sprinkler, fixed),
  H('hose_reel', 1, 0.45, [3, 3, 2], hoseReel, fixed),
  H('rabbit_hutch', 1, 0.6, [6, 5, 3], rabbitHutch, fixed),
  H('porch_swing', 1, 0.6, [7, 6, 3], porchSwing),
  H('boat_trailer', 2, 1.1, [11, 5, 4], boatTrailer, { vehicle: true, micro: false, value: 0.5 }),
  H('pool_ladder', 1, 0.45, [3, 4, 3], poolLadder, fixed),
  H('diving_board', 1, 0.5, [3, 3, 8], divingBoard, fixed),
  H('pool_float', 1, 0.6, [4, 3, 4], poolFloat),
  H('party_table', 1, 0.6, [10, 7, 4], partyTable, { ...fixed, value: 0.4 }),
  H('balloons', 1, 0.5, [4, 10, 4], balloons, fixed),
  H('bouncy_castle', 2, 0.8, [12, 9, 12], bouncyCastle, { micro: false, value: 0.6 }),
  H('gift_pile', 1, 0.5, [5, 3, 4], giftPile),
  H('garage_sale', 1, 0.6, [9, 5, 5], garageSale, fixed),
  H('picnic_basket', 1, 0.45, [3, 3, 2], picnicBasket, fixed),
  H('kite', 1, 0.6, [4, 14, 3], kite),
  H('skate_ramp', 2, 0.8, [10, 5, 8], skateRamp, { ...fixed, micro: false }),
  H('outdoor_gym', 1, 0.6, [10, 6, 3], outdoorGym, fixed),
  H('merry_go_round', 1, 0.6, [8, 3, 8], merryGoRound, fixed),
  H('spring_rider', 1, 0.5, [3, 5, 2], springRider),
  H('drinking_fountain', 1, 0.5, [2, 5, 2], drinkingFountain, fixed),
  H('park_sign', 1, 0.6, [6, 6, 1], parkSign, fixed),
  H('swan_boat', 1, 0.7, [5, 6, 3], swanBoat, fixed),
  H('reeds', 1, 0.55, [4, 5, 4], reeds, fixed),
  H('rose_bush', 1, 0.55, [3, 3, 3], roseBush),
];

// Things that go up when smashed: a grill's gas bottle, a fire pit's embers (game.js).
export const HOME_BANG = new Set(['grill', 'fire_pit']);

// Sticker prices for the damage counter (see prices.js).
export const HOME_PRICE = {
  patio_set: 900, parasol: 150, sun_lounger: 200, grill: 700, fire_pit: 400, outdoor_sofa: 1800, pergola: 6000, hammock: 120,
  play_fort: 3500, sand_toys: 20, toys: 30, goal_small: 80, glasshouse: 4000, raised_bed: 250, compost_bin: 90, garden_arch: 200,
  flamingo: 25, bird_feeder: 40, lawn_sign: 30, lemonade_stand: 15, garden_lamp: 60, sprinkler: 25, hose_reel: 60,
  rabbit_hutch: 300, porch_swing: 600, boat_trailer: 35000, pool_ladder: 400, diving_board: 1200, pool_float: 20,
  party_table: 300, balloons: 25, bouncy_castle: 2500, gift_pile: 150, garage_sale: 200, picnic_basket: 60, kite: 40,
  skate_ramp: 5000, outdoor_gym: 8000, merry_go_round: 6000, spring_rider: 900, drinking_fountain: 2000,
  park_sign: 400, swan_boat: 3000, reeds: 0, rose_bush: 40,
};
