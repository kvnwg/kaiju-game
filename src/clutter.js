// More things to stand on, kick over and eat around: street clutter, market stalls, parked
// vehicles of every kind, farm and forest animals, yard life, things for the snow, the desert, the
// lantern streets and the water, and a few big pieces (wind turbines, pylons, tower cranes, cargo
// ships) that still read once the kaiju is the size of a building. world.js places them.
import { E, shade, hash3 } from './voxel.js';

const GREENS = [0x3e8e41, 0x4f9d3a, 0x2f7a3a, 0x5aa845];
const BRIGHT = [0xd94f4f, 0x3b6fd1, 0xf2c12e, 0x3a8a5a, 0xd94f8a, 0xf28a1a, 0x8a5ad9];
const leafy = (x, y, z) => GREENS[Math.floor(hash3(x, y, z) * GREENS.length)];
const wheel = (g, x, z, y = 0, h = 2) => g.box(x, y, z, x + 1, y + h, z + 1, 0x15161a);

// ---------------------------------------------------------------- street clutter
function trashBags(g, rng) {
  const c = rng.pick([0x23262b, 0x2e3b2e, 0x3a3f47]);
  g.box(0, 0, 0, 2, 2, 2, c);
  g.box(2, 0, 1, 4, 2, 3, shade(c, 1.2));
  g.box(1, 2, 1, 3, 3, 2, shade(c, 0.9));
  g.set(1, 2, 0, 0xd8c048);
}
function cardboard(g) {
  g.box(0, 0, 0, 2, 2, 2, 0xb8915a);
  g.box(2, 0, 0, 4, 1, 3, 0xa8814a);
  g.box(2, 1, 1, 3, 2, 3, 0xc8a16a);
  g.box(0, 2, 0, 2, 3, 1, 0xb08a50);
  g.set(0, 1, 2, 0xd8c8a0);
}
function pallets(g) {
  for (let y = 0; y < 3; y++) g.box(0, y, 0, 4, y + 1, 3, (x, yy, z) => (y % 2 === 0 && z === 1 && x % 3 ? null : y % 2 ? 0xb08858 : 0x9a7444));
}
function shoppingCart(g) {
  // An open wire basket on wheels, its red handle at the back.
  g.box(1, 1, 0, 4, 3, 3, (x, y, z) => (y === 1 || x === 1 || x === 3 || z === 0 || z === 2 ? ((x + y + z) % 2 ? 0xc8ccd4 : 0x9aa0a8) : null));
  g.box(0, 3, 0, 1, 4, 3, 0xd93636);
  g.set(0, 2, 0, 0x9aa0a8);
  g.set(0, 2, 2, 0x9aa0a8);
  for (const [x, z] of [[1, 0], [3, 0], [1, 2], [3, 2]]) g.set(x, 0, z, 0x222222);
}
function pottedPlant(g, rng) {
  g.box(0, 0, 0, 2, 1, 2, rng.pick([0xc8643a, 0x8a8f96, 0xe8e2d0]));
  g.box(0, 1, 0, 2, 4, 2, (x, y, z) => (y === 3 && (x + z) % 2 ? null : leafy(x, y, z)));
}
function sandwichBoard(g, rng) {
  const c = rng.pick([0x2a2e2a, 0x3a2a22, 0x22303d]);
  g.box(0, 0, 0, 2, 3, 2, (x, y, z) => (y === 2 ? 0x8a6a48 : c));
  g.set(0, 1, 0, 0xf2f2f2);
  g.set(1, 1, 1, rng.pick([0xf2c12e, 0xd94f8a, 0x9fe8ff]));
}
function atm(g) {
  g.box(0, 0, 0, 2, 4, 2, 0x8a8f96);
  g.box(0, 3, 0, 2, 4, 2, 0x2a5bd9);
  g.set(0, 2, 1, 0x9fe8ff, E);
  g.set(1, 1, 1, 0x2a2a2a);
}
function wheelieBin(g, rng) {
  const c = rng.pick([0x2f7a3a, 0x2a5bd9, 0x2a2a2a]);
  g.box(0, 0, 0, 2, 2, 2, c);
  g.box(0, 2, 0, 2, 3, 2, shade(c, 0.75));
  g.set(0, 0, 0, 0x111111);
}
function postbox(g) {
  g.box(0, 0, 0, 2, 3, 2, 0xd02a2a);
  g.box(0, 3, 0, 2, 4, 2, 0xa81e1e);
  g.set(0, 2, 1, 0x1a1a1a);
  g.set(0, 1, 0, 0xf2d24a);
}
function utilityBox(g, rng) {
  const c = rng.pick([0x5a7a5a, 0x8a8f96, 0x6a7a8a]);
  g.box(0, 0, 0, 3, 4, 2, (x, y, z) => (z === 1 && y > 0 && y < 3 && x === 1 ? shade(c, 0.7) : c));
  g.set(2, 3, 1, 0xf2c12e);
}
function gacha(g) {
  for (let i = 0; i < 4; i++) {
    const c = BRIGHT[i % BRIGHT.length];
    g.box(i, 0, 0, i + 1, 2, 2, c);
    g.box(i, 2, 0, i + 1, 4, 2, (x, y, z) => (hash3(x, y, z) < 0.5 ? BRIGHT[(x + y + z) % BRIGHT.length] : 0xe8f6ff), E);
  }
}
function pigeons(g) {
  for (const [x, z] of [[0, 0], [2, 1], [4, 0], [1, 3], [3, 3]]) {
    g.set(x, 0, z, 0x8a8f9a);
    g.set(x, 1, z, 0x5a6a7a);
  }
}
function portaPotty(g, rng) {
  const c = rng.pick([0x2a6ad9, 0x3a9a5a, 0xf28a1a]);
  g.box(0, 0, 0, 2, 4, 2, (x, y, z) => (z === 1 && x === 0 && y > 0 ? shade(c, 0.8) : c));
  g.box(0, 4, 0, 2, 5, 2, 0xf2f2f2);
}
function roadSign(g, rng) {
  g.box(1, 0, 0, 2, 4, 1, 0x8a8f96);
  const c = rng.pick([0xf2c12e, 0xf28a1a, 0xf2c12e]);
  g.box(0, 3, 0, 3, 6, 1, (x, y) => (Math.abs(x - 1) + Math.abs(y - 4) > 1 ? null : x === 1 && y === 4 ? 0x1a1a1a : c));
  g.set(1, 5, 0, 0x1a1a1a);
}
function acUnit(g) {
  g.box(0, 0, 0, 3, 2, 2, 0xd8dade);
  g.box(0, 1, 0, 2, 2, 2, (x, y, z) => ((x + z) % 2 ? 0x55585e : 0x3a3d42));
}

// Stalls (tier 2): something to wreck at Prowler size that isn't a car.
function marketStall(g, rng) {
  const awn = rng.pick([0xd94f4f, 0x3a8a5a, 0x3b6fd1, 0xf28a1a]);
  for (const [x, z] of [[0, 0], [6, 0], [0, 3], [6, 3]]) g.box(x, 0, z, x + 1, 5, z + 1, 0x6a4a2e);
  g.box(0, 1, 0, 7, 2, 4, 0x9a7444);
  g.box(1, 2, 0, 6, 3, 3, (x, y, z) => [0xf28a1a, 0xd93636, 0x8ac83a, 0xf2d24a, 0x6a3a8a][Math.floor(hash3(x, y, z) * 5)]);
  g.box(0, 5, 0, 7, 6, 4, (x) => (x % 2 ? awn : 0xf6f2ea));
}
function flowerStall(g, rng) {
  const awn = rng.pick([0x3a8a5a, 0xd94f8a, 0x2f9e8f]);
  g.box(0, 0, 0, 6, 1, 3, 0x7a5a3a);
  g.box(0, 1, 0, 6, 3, 3, (x, y, z) => (y === 1 ? 0x8a8f96 : [0xd94f8a, 0xf2d24a, 0xffffff, 0x9f6fd9, 0xd93636, 0x3e8e41][Math.floor(hash3(x, y, z) * 6)]));
  g.box(0, 4, 0, 6, 5, 3, awn);
  g.box(0, 1, 2, 1, 4, 3, 0x6a4a2e);
  g.box(5, 1, 2, 6, 4, 3, 0x6a4a2e);
}
function noodleStall(g) {
  g.box(0, 0, 1, 6, 2, 4, 0x6a3a22);
  g.box(0, 2, 1, 6, 3, 4, 0x9a6a3a);
  g.box(0, 3, 3, 1, 6, 4, 0x4a2a1a);
  g.box(5, 3, 3, 6, 6, 4, 0x4a2a1a);
  g.box(0, 5, 0, 6, 6, 4, (x) => (x % 3 === 1 ? 0xf6f2ea : 0x2a3a6a));
  g.set(0, 4, 0, 0xff3b2a, E);
  g.set(5, 4, 0, 0xff3b2a, E);
  for (const x of [1, 3, 5]) g.set(x, 0, 0, 0xd8a050);
  g.set(2, 3, 2, 0xf2f2f2);
  g.set(4, 3, 2, 0xd8d0c0);
}

// ---------------------------------------------------------------- parked vehicles
function sportsCar(g, rng) {
  const c = rng.pick([0xe0202a, 0xf2c12e, 0x2ab0e8]);
  g.box(0, 1, 0, 8, 3, 4, c);
  g.box(3, 3, 0, 6, 4, 4, 0x22303d);
  g.box(3, 4, 0, 5, 5, 4, c);
  g.box(0, 3, 0, 1, 4, 4, 0x1a1a1a);
  for (const x of [1, 6]) for (const z of [0, 3]) wheel(g, x, z);
  g.set(7, 2, 0, 0xfff6d8, E);
  g.set(7, 2, 3, 0xfff6d8, E);
  g.set(0, 2, 1, 0xff2a2a, E);
  g.set(0, 2, 2, 0xff2a2a, E);
}
function limo(g) {
  g.box(0, 1, 0, 12, 3, 4, 0x1a1a1e);
  g.box(2, 3, 0, 10, 5, 4, (x) => (x % 3 === 0 ? 0x1a1a1e : 0x2a3440));
  g.box(2, 4, 0, 10, 5, 4, 0x1a1a1e);
  for (const x of [1, 10]) for (const z of [0, 3]) wheel(g, x, z);
  g.set(11, 2, 0, 0xfff6d8, E);
  g.set(11, 2, 3, 0xfff6d8, E);
  g.set(5, 2, 0, 0xd8c048);
}
function schoolBus(g) {
  g.box(0, 1, 0, 16, 7, 5, 0xf2b81e);
  g.box(1, 4, 0, 13, 6, 5, (x) => (x % 3 === 0 ? 0xf2b81e : 0x2a3a4a));
  g.box(0, 3, 0, 16, 4, 5, 0x1a1a1a);
  g.box(13, 1, 0, 16, 5, 5, 0xf2b81e);
  g.box(14, 4, 0, 16, 6, 5, 0x2a3a4a);
  g.box(0, 7, 1, 16, 8, 4, 0xe8a81a);
  for (const x of [2, 12]) for (const z of [0, 4]) wheel(g, x, z);
  g.box(8, 2, 0, 9, 4, 1, 0xd93636);
  g.set(15, 2, 0, 0xfff6d8, E);
  g.set(15, 2, 4, 0xfff6d8, E);
}
function garbageTruck(g) {
  g.box(0, 1, 0, 9, 8, 5, (x, y) => (y % 3 === 0 ? 0x2a6a3a : 0x3a8a4a));
  g.box(0, 2, 0, 1, 7, 5, 0x55585e);
  g.box(9, 1, 0, 13, 6, 5, 0xf2f2f2);
  g.box(10, 3, 0, 13, 5, 5, 0x22303d);
  g.box(10, 3, 1, 13, 5, 4, 0xf2f2f2);
  for (const x of [1, 7, 11]) for (const z of [0, 4]) wheel(g, x, z);
  g.set(12, 6, 2, 0xf28a1a, E);
}
function iceCreamTruck(g, rng) {
  const c = rng.pick([0xf6c1d8, 0xb8e8f2, 0xfff2c8]);
  g.box(0, 1, 0, 10, 6, 4, c);
  g.box(7, 3, 0, 10, 5, 4, 0x22303d);
  g.box(2, 3, 0, 6, 5, 1, 0x9fe8ff);
  g.box(0, 1, 0, 10, 2, 4, (x) => (x % 2 ? 0xd94f8a : 0xffffff));
  for (const x of [1, 8]) for (const z of [0, 3]) wheel(g, x, z);
  // The giant cone on the roof.
  g.box(4, 6, 1, 6, 7, 3, 0xd8a050);
  g.box(4, 7, 1, 6, 8, 3, 0xf6c1d8, E);
}
function motorbike(g, rng) {
  const c = rng.pick([0xd93636, 0x1a1a1a, 0x2a5bd9]);
  wheel(g, 0, 0, 0, 2);
  wheel(g, 4, 0, 0, 2);
  g.box(1, 1, 0, 4, 2, 1, c);
  g.box(1, 2, 0, 3, 3, 1, 0x1a1a1a);
  g.set(4, 2, 0, 0xb8bcc4);
  g.set(4, 2, 0, 0xfff6d8, E);
}
function camperVan(g, rng) {
  const stripe = rng.pick([0xf28a1a, 0x3b6fd1, 0x3a8a5a]);
  g.box(0, 1, 0, 11, 7, 4, 0xf2ece0);
  g.box(0, 3, 0, 11, 4, 4, stripe);
  g.box(9, 4, 0, 11, 6, 4, 0x22303d);
  g.box(2, 5, 0, 7, 6, 1, 0x7fb8d8);
  g.box(1, 7, 1, 6, 8, 3, 0xd8d2c4);
  for (const x of [1, 8]) for (const z of [0, 3]) wheel(g, x, z);
}
function carWreck(g, rng) {
  const c = rng.pick([0x8a4a2a, 0x6a5a4a, 0x7a3a2a]);
  g.box(0, 0, 0, 8, 2, 4, (x, y, z) => (hash3(x, y, z) < 0.25 ? 0x4a2a1a : c));
  g.box(2, 2, 0, 6, 4, 4, (x, y, z) => (y === 3 || x === 2 || x === 5 ? (hash3(x, y, z) < 0.3 ? null : c) : null));
  g.set(7, 1, 1, 0x3a3a3a);
}
function cementMixer(g) {
  g.box(0, 1, 0, 12, 2, 5, 0x3a3d42);
  g.box(9, 1, 0, 12, 6, 5, 0xf2f2f2);
  g.box(10, 3, 0, 12, 5, 5, 0x22303d);
  for (let x = 1; x < 9; x++) {
    const r = 2.4 - Math.abs(x - 4.5) * 0.25;
    for (let y = 2; y < 8; y++) for (let z = 0; z < 5; z++) if (Math.hypot(y - 4.6, z - 2) < r) g.set(x, y, z, (x + y) % 3 ? 0xf28a1a : 0xf2f2f2);
  }
  for (const x of [1, 6, 10]) for (const z of [0, 4]) wheel(g, x, z);
}
function excavator(g) {
  g.box(0, 0, 0, 8, 2, 1, 0x2a2a2a);
  g.box(0, 0, 5, 8, 2, 6, 0x2a2a2a);
  g.box(1, 2, 0, 8, 4, 6, 0xf2b81e);
  g.box(4, 4, 1, 8, 7, 4, 0xf2b81e);
  g.box(5, 5, 1, 8, 6, 4, 0x22303d);
  // The arm, raised, and its bucket.
  for (let k = 0; k < 4; k++) g.box(8 + k, 4 + k, 2, 9 + k, 5 + k, 3, 0xe0a818);
  g.box(11, 2, 2, 12, 8, 3, 0xe0a818);
  g.box(10, 0, 1, 12, 2, 4, 0x55585e);
}
function forklift(g, rng) {
  const c = rng.pick([0xf28a1a, 0xf2c12e]);
  g.box(0, 1, 0, 4, 3, 4, c);
  for (const [x, z] of [[0, 0], [2, 0], [0, 3], [2, 3]]) g.box(x, 3, z, x + 1, 5, z + 1, 0x2a2a2a);
  g.box(0, 5, 0, 3, 6, 4, 0x3a3d42);
  g.set(1, 3, 1, 0x1a1a1a);
  g.box(4, 0, 0, 5, 6, 1, 0x3a3d42);
  g.box(4, 0, 3, 5, 6, 4, 0x3a3d42);
  g.box(5, 1, 0, 6, 2, 4, (x, y, z) => (z === 0 || z === 3 ? 0x8a8f96 : null));
  g.box(5, 2, 0, 6, 3, 4, 0x9a7444);
  wheel(g, 0, 0, 0, 1);
  wheel(g, 0, 3, 0, 1);
  wheel(g, 3, 0, 0, 1);
  wheel(g, 3, 3, 0, 1);
}

// ---------------------------------------------------------------- animals
function sheep(g) {
  g.box(0, 1, 0, 3, 3, 2, (x, y, z) => (hash3(x, y, z) < 0.3 ? 0xe8e4dc : 0xf8f6f0));
  g.box(3, 1, 0, 4, 3, 2, 0x2a2a2a);
  for (const [x, z] of [[0, 0], [2, 1]]) g.set(x, 0, z, 0x2a2a2a);
}
function pig(g) {
  g.box(0, 1, 0, 3, 3, 2, 0xf2b0b8);
  g.box(3, 1, 0, 4, 3, 2, 0xf6c0c6);
  g.set(3, 1, 0, 0xd88a96);
  g.set(0, 2, 1, 0xd88a96);
  for (const [x, z] of [[0, 0], [2, 1]]) g.set(x, 0, z, 0xe89aa6);
}
function chicken(g, rng) {
  const c = rng.pick([0xf8f6f0, 0xb8743a, 0xf8f6f0]);
  g.box(0, 0, 0, 2, 1, 1, c);
  g.set(1, 1, 0, c);
  g.set(1, 1, 0, 0xd93636);
}
function horse(g, rng) {
  const c = rng.pick([0x7a4a2a, 0x3a2a1e, 0xd8c8a8]);
  const mane = shade(c, 0.5);
  g.box(1, 2, 0, 5, 4, 2, c);
  for (const [x, z] of [[1, 0], [1, 1], [4, 0], [4, 1]]) g.box(x, 0, z, x + 1, 2, z + 1, shade(c, 0.85));
  g.box(5, 3, 0, 6, 6, 2, c);
  g.set(5, 5, 0, mane);
  g.set(5, 5, 1, mane);
  g.set(0, 3, 0, mane);
}
function deer(g) {
  g.box(0, 2, 0, 3, 3, 2, 0xa8743a);
  for (const [x, z] of [[0, 0], [2, 1]]) g.box(x, 0, z, x + 1, 2, z + 1, 0x8a5a2a);
  g.box(3, 3, 0, 4, 4, 2, 0xa8743a);
  g.set(0, 3, 0, 0xf2f2f2);
  g.set(3, 4, 0, 0xd8c8a8);
  g.set(3, 4, 1, 0xd8c8a8);
}
function bear(g) {
  g.box(0, 1, 0, 4, 4, 3, 0x4a3022);
  g.box(4, 1, 0, 5, 3, 3, 0x4a3022);
  g.set(4, 1, 1, 0xa8845a);
  g.set(4, 3, 0, 0x4a3022);
  g.set(4, 3, 2, 0x4a3022);
  for (const [x, z] of [[0, 0], [0, 2], [3, 0], [3, 2]]) g.set(x, 0, z, 0x3a2418);
}
function ducks(g) {
  for (const [x, z] of [[0, 0], [2, 1], [1, 2]]) {
    g.set(x, 0, z, 0xf2f0ea);
    g.set(x + 1, 0, z, 0x2f7a3a);
  }
}

// ---------------------------------------------------------------- farm and yard
function chickenCoop(g) {
  g.box(0, 1, 0, 5, 3, 4, (x, y) => (y === 1 ? 0xb83a2a : 0xc84a3a));
  g.box(0, 3, 0, 5, 4, 4, 0x5a5a62);
  g.box(2, 1, 3, 3, 2, 4, 0x1a1a1a);
  for (const [x, z] of [[0, 0], [4, 0], [0, 3], [4, 3]]) g.set(x, 0, z, 0x6a4a2e);
  g.set(1, 0, 3, 0xf8f6f0);
  g.set(3, 0, 3, 0xb8743a);
}
function beehive(g) {
  g.box(0, 0, 0, 2, 1, 2, 0x6a4a2e);
  g.box(0, 1, 0, 2, 3, 2, (x, y) => (y === 1 ? 0xf6f2ea : 0xf2d27a));
  g.set(0, 1, 0, 0x2a2a2a);
}
function waterTrough(g) {
  g.box(0, 0, 0, 5, 2, 2, 0x8a8f96);
  g.box(1, 1, 0, 4, 2, 2, 0x3f8fd1);
}
function well(g) {
  g.cylinder(2, 2, 2, 0, 2, (x, y, z) => (hash3(x, y, z) < 0.4 ? 0x8a8a82 : 0xa8a49a), 0, true);
  g.box(0, 2, 2, 1, 5, 3, 0x6a4a2e);
  g.box(3, 2, 2, 4, 5, 3, 0x6a4a2e);
  g.box(0, 5, 1, 4, 6, 4, 0x8a3a2a);
  g.set(2, 3, 2, 0x8a6a48);
}
function pumpkins(g) {
  for (const [x, z, s] of [[0, 0, 2], [2, 1, 1], [1, 2, 1]]) {
    g.box(x, 0, z, x + s, s, z + s, 0xf28a1a);
    g.set(x, s, z, 0x3a6a2a);
  }
}
function hayRoll(g) {
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    if (Math.hypot(y - 1, z - 1) > 1.5) continue;
    g.set(x, y, z, x === 0 || x === 2 ? (Math.hypot(y - 1, z - 1) < 0.6 ? 0xb8963a : 0xd9b84a) : 0xc8a83a);
  }
}
function wheelbarrow(g, rng) {
  const c = rng.pick([0x3a8a5a, 0xd93636, 0x8a8f96]);
  g.box(0, 1, 0, 3, 2, 2, c);
  g.set(3, 0, 0, 0x1a1a1a);
  g.set(0, 0, 0, 0x6a4a2e);
  g.set(0, 0, 1, 0x6a4a2e);
  g.set(1, 1, 1, 0x7a5a3a);
}
function vegPatch(g) {
  g.box(0, 0, 0, 5, 1, 3, (x, y, z) => (x === 0 || x === 4 || z === 0 || z === 2 ? 0x8a6a48 : 0x4a3424));
  for (let x = 1; x < 4; x++) g.set(x, 1, 1, [0x6ac83a, 0xf28a1a, 0x3e8e41][x % 3]);
}
function corn(g) {
  for (const [x, z] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) {
    g.box(x, 0, z, x + 1, 4, z + 1, (xx, y) => (y === 2 && (x + z) % 2 === 0 ? 0xf2d24a : 0x6aa83a));
    g.set(x, 4, z, 0xd8c87a);
  }
}
function appleTree(g) {
  g.box(3, 0, 3, 4, 4, 4, 0x5a3d26);
  for (let y = 3; y < 9; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
    if (Math.hypot(x - 3, (y - 5.5) * 1.2, z - 3) > 3.2) continue;
    g.set(x, y, z, hash3(x, y, z) < 0.12 ? 0xd93636 : leafy(x, y, z));
  }
}
function clothesline(g) {
  g.box(0, 0, 0, 1, 4, 1, 0x8a8f96);
  g.box(6, 0, 0, 7, 4, 1, 0x8a8f96);
  g.box(0, 3, 0, 7, 4, 1, 0xe8e8e8);
  for (const [x, h] of [[1, 2], [2, 1], [3, 2], [5, 1]]) g.box(x, 3 - h, 0, x + 1, 3, 1, BRIGHT[(x * 3) % BRIGHT.length]);
}
function kiddiePool(g, rng) {
  const c = rng.pick([0x3b6fd1, 0xd94f8a, 0xf2c12e]);
  g.box(0, 0, 0, 4, 1, 4, (x, y, z) => (x === 0 || x === 3 || z === 0 || z === 3 ? c : 0x7fd8f2));
}
function mower(g) {
  g.box(0, 0, 0, 2, 1, 2, 0xd93636);
  g.set(2, 1, 0, 0x2a2a2a);
  g.set(2, 1, 1, 0x2a2a2a);
}
function birdBath(g) {
  g.box(0, 0, 0, 2, 1, 2, 0xb8b4aa);
  g.set(0, 1, 0, 0xc8c4ba);
  g.box(0, 2, 0, 2, 3, 2, 0x7fc8e8);
}
function hedge(g) {
  g.box(0, 0, 0, 8, 3, 2, (x, y, z) => (y === 2 && hash3(x, y, z) < 0.2 ? null : shade(0x3a7a3a, 0.9 + hash3(x, y, z) * 0.2)));
}
function topiary(g) {
  g.box(1, 0, 1, 2, 1, 2, 0xc8643a);
  g.box(0, 0, 0, 3, 1, 3, 0xb85a32);
  g.set(1, 1, 1, 0x5a3d26);
  for (let y = 2; y < 5; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) if (Math.hypot(x - 1, y - 3, z - 1) < 1.5) g.set(x, y, z, leafy(x, y, z));
}
function firewood(g) {
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) g.box(x, y, 0, x + 1, y + 1, 2, (xx, yy, z) => (z === 0 ? 0xc8a070 : 0x6a4a2e));
}

// ---------------------------------------------------------------- forest
function stump(g) {
  g.box(0, 0, 0, 3, 2, 3, (x, y, z) => (y === 1 && x === 1 && z === 1 ? 0xc8a070 : y === 1 ? 0x8a6a48 : 0x5a3d26));
}
function toadstools(g) {
  for (const [x, z, h] of [[0, 0, 2], [2, 2, 1]]) {
    g.box(x, 0, z, x + 1, h, z + 1, 0xf2ece0);
    g.set(x, h, z, 0xd93636);
  }
  g.set(1, 2, 0, 0xd93636);
  g.set(0, 2, 1, 0xf2f2f2);
}
function fern(g) {
  for (const [x, z] of [[0, 1], [2, 1], [1, 0], [1, 2], [1, 1]]) g.set(x, x === 1 && z === 1 ? 1 : 0, z, leafy(x, 1, z));
  g.set(1, 0, 1, 0x2f6a2a);
}
function boulder(g) {
  for (let y = 0; y < 4; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 6; x++) {
    if (Math.hypot((x - 2.5) * 0.75, y * 1.05, z - 2) > 2.6 + hash3(x, y, z) * 0.5) continue;
    g.set(x, y, z, y >= 2 && hash3(x, z, y) < 0.35 ? 0x5a7a3a : hash3(x, y, z) < 0.5 ? 0x8a8a8a : 0x7a7a7a);
  }
}
function berryBush(g, rng) {
  const berry = rng.pick([0xd93636, 0x3a3ad9, 0x8a2a6a]);
  for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    if (Math.hypot(x - 1.5, y * 1.3, z - 1.5) > 2.3) continue;
    g.set(x, y, z, hash3(x, y, z) < 0.18 ? berry : leafy(x, y, z));
  }
}
function canoe(g, rng) {
  const c = rng.pick([0xd93636, 0x3a8a5a, 0xf2c12e]);
  g.box(1, 0, 0, 6, 1, 2, c);
  g.set(0, 0, 0, c);
  g.set(6, 0, 1, c);
  g.set(3, 0, 0, 0x8a6a48);
}

// ---------------------------------------------------------------- snow
function sled(g, rng) {
  g.box(0, 0, 0, 3, 1, 1, 0x8a8f96);
  g.box(0, 0, 1, 3, 1, 2, 0x8a8f96);
  g.box(0, 1, 0, 3, 2, 2, rng.pick([0xd93636, 0x8a6a48, 0x3b6fd1]));
}
function snowmobile(g, rng) {
  const c = rng.pick([0xd93636, 0xf2c12e, 0x2a2a2a]);
  g.box(0, 0, 0, 3, 1, 2, 0x2a2a2a);
  g.box(0, 1, 0, 4, 2, 2, c);
  g.box(1, 2, 0, 3, 3, 2, 0x1a1a1a);
  g.set(4, 0, 0, 0x8a8f96);
  g.set(4, 0, 1, 0x8a8f96);
  g.set(3, 2, 0, 0x9fd8ff);
}
function skiRack(g) {
  g.box(0, 0, 0, 5, 1, 1, 0x6a4a2e);
  g.box(0, 2, 0, 5, 3, 1, 0x6a4a2e);
  for (let x = 0; x < 5; x++) g.box(x, 0, 0, x + 1, 4, 1, (xx, y) => (y === 2 ? 0x6a4a2e : BRIGHT[x % BRIGHT.length]));
}
function snowPile(g) {
  for (let y = 0; y < 2; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) if (Math.hypot(x - 1.5, y * 1.6, z - 1.5) < 2.2) g.set(x, y, z, hash3(x, y, z) < 0.3 ? 0xe2ecf4 : 0xf6fafe);
}
function igloo(g) {
  for (let y = 0; y < 4; y++) for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
    const d = Math.hypot(x - 2.5, y * 1.25, z - 2.5);
    if (d > 3.1 || d < 2) continue;
    g.set(x, y, z, (x + y * 2 + z) % 3 ? 0xf2f8fe : 0xd8e8f4);
  }
  g.box(2, 0, 5, 4, 2, 6, 0x5a7a9a);
}
function iceHut(g, rng) {
  const c = rng.pick([0xc83a2a, 0x2a5bd9, 0x3a8a5a]);
  g.box(0, 0, 0, 4, 3, 4, c);
  g.box(1, 0, 3, 2, 2, 4, 0x2a1a14);
  g.box(0, 3, 0, 4, 4, 4, 0xf6fafe);
  g.set(3, 4, 1, 0x5a5a62);
}

// ---------------------------------------------------------------- desert
function skull(g) {
  g.box(1, 0, 0, 2, 2, 2, 0xf2ead8);
  g.set(0, 1, 0, 0xe8dcc4);
  g.set(2, 1, 0, 0xe8dcc4);
  g.set(0, 1, 1, 0xe8dcc4);
  g.set(2, 1, 1, 0xe8dcc4);
  g.set(1, 1, 0, 0x2a2a2a);
}
function barrelCactus(g) {
  for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
    if (Math.hypot(x - 1, (y - 0.8) * 1.1, z - 1) > 1.5) continue;
    g.set(x, y, z, (x + z) % 2 ? 0x4a8a4a : 0x3a7a3a);
  }
  g.set(1, 2, 1, 0xf27aa8);
}
function pumpJack(g) {
  g.box(0, 0, 0, 12, 1, 3, 0x55585e);
  // The A-frame, the walking beam on top and the horse head nodding over the well.
  for (let y = 1; y < 6; y++) {
    g.set(5 - Math.floor(y / 3), y, 0, 0x3a3d42);
    g.set(5 - Math.floor(y / 3), y, 2, 0x3a3d42);
  }
  g.box(1, 6, 1, 11, 7, 2, 0xc84a2a);
  g.box(10, 4, 1, 12, 8, 2, 0xc84a2a);
  g.box(11, 1, 1, 12, 4, 2, 0x2a2a2a);
  g.box(0, 1, 0, 3, 4, 3, 0x3a3d42);
  g.box(1, 4, 1, 2, 6, 2, 0x3a3d42);
}
function windPump(g) {
  for (let y = 0; y < 11; y++) {
    const i = Math.floor(y / 5);
    for (const [x, z] of [[i, i], [4 - i, i], [i, 4 - i], [4 - i, 4 - i]]) g.set(x, y, z, 0x8a8f96);
    if (y % 4 === 3) g.box(i, y, i, 5 - i, y + 1, 5 - i, (x, yy, z) => (x === i || x === 4 - i || z === i || z === 4 - i ? 0x8a8f96 : null));
  }
  // The fan wheel and its tail vane.
  for (let y = 9; y < 14; y++) for (let x = 0; x < 5; x++) if (Math.hypot(x - 2, y - 11.5) < 2.6 && (x + y) % 2 === 0) g.set(x, y, 0, 0xd8dade);
  g.set(2, 11, 0, 0xc84a2a);
  g.box(2, 11, 1, 3, 12, 5, 0x8a8f96);
  g.box(2, 10, 4, 3, 13, 5, 0xc84a2a);
}
function solarPanels(g) {
  for (let r = 0; r < 2; r++) {
    const z0 = r * 3;
    g.box(0, 0, z0 + 1, 8, 1, z0 + 2, 0x8a8f96);
    g.box(0, 1, z0, 8, 2, z0 + 2, (x, y, z) => ((x + z) % 2 ? 0x1a2a5a : 0x2a3a7a));
  }
}
function radioDish(g) {
  g.box(3, 0, 3, 7, 2, 7, 0xd8dade);
  g.box(4, 2, 4, 6, 5, 6, 0xc8ccd2);
  // A dish tipped back towards the sky.
  for (let y = 4; y < 10; y++) for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) {
    const dx = x - 4.5;
    const dz = z - 4.5;
    const dy = y - 6.5;
    const along = dz * 0.6 + dy * 0.8;
    const perp = Math.hypot(dx, dz * 0.8 - dy * 0.6);
    if (perp < 4.6 && Math.abs(along - perp * perp * 0.06) < 0.55) g.set(x, y, z, 0xf2f2f2);
  }
  g.set(4, 7, 4, 0xd93636, E);
}

// ---------------------------------------------------------------- lantern streets
function stoneLantern(g) {
  g.box(0, 0, 0, 3, 1, 3, 0x9a9aa2);
  g.box(1, 1, 1, 2, 3, 2, 0xa8a8b0);
  g.box(0, 3, 0, 3, 4, 3, 0xa8a8b0);
  for (const [x, z] of [[1, 0], [0, 1], [2, 1], [1, 2]]) g.set(x, 3, z, 0xffb85a, E);
  g.box(0, 4, 0, 3, 5, 3, 0x8a8a92);
  g.set(1, 4, 1, 0x7a7a82);
}
function bamboo(g) {
  for (const [x, z, h] of [[0, 0, 9], [2, 0, 7], [1, 2, 10], [0, 2, 6], [2, 2, 8]]) {
    g.box(x, 0, z, x + 1, h, z + 1, (xx, y) => (y % 3 === 2 ? 0x5a8a2a : 0x7aaa3a));
    g.set(x, h - 1, z, 0x8aca4a);
  }
}
function bonsai(g) {
  g.box(0, 0, 0, 3, 1, 2, 0x3a5a7a);
  g.set(1, 1, 0, 0x5a3d26);
  g.set(1, 1, 1, 0x5a3d26);
  g.box(0, 2, 0, 2, 3, 2, 0x3e7e3a);
  g.set(2, 2, 1, 0x4f9d3a);
}
function rickshaw(g) {
  g.box(0, 0, 0, 1, 3, 1, 0x1a1a1a);
  g.box(0, 0, 2, 1, 3, 3, 0x1a1a1a);
  g.box(0, 1, 0, 2, 2, 3, 0xc83a2a);
  g.box(0, 2, 0, 1, 4, 3, 0x2a2a2a);
  g.box(2, 1, 0, 5, 2, 1, 0x6a4a2e);
  g.box(2, 1, 2, 5, 2, 3, 0x6a4a2e);
}

// ---------------------------------------------------------------- water and docks
function rowboat(g) {
  g.box(1, 0, 0, 5, 1, 2, 0x8a5a32);
  g.set(0, 0, 0, 0x8a5a32);
  g.set(0, 0, 1, 0x8a5a32);
  g.set(2, 1, 0, 0xc8a070);
  g.set(2, 1, 1, 0xc8a070);
}
function sailboat(g, rng) {
  const sail = rng.pick([0xf6f2ea, 0xf6f2ea, 0xd94f4f]);
  g.box(1, 0, 0, 7, 2, 3, 0xf2f2f2);
  g.box(0, 1, 1, 8, 2, 2, 0xf2f2f2);
  g.box(1, 0, 0, 7, 1, 3, 0x2a5bd9);
  g.box(4, 2, 1, 5, 12, 2, 0xd8d8d8);
  for (let y = 3; y < 11; y++) g.box(5, y, 1, 5 + Math.max(1, Math.floor((11 - y) * 0.4)), y + 1, 2, sail);
  for (let y = 3; y < 9; y++) g.box(Math.max(1, 4 - Math.floor((9 - y) * 0.4)), y, 1, 4, y + 1, 2, shade(sail, 0.92));
}
function yacht(g) {
  g.box(1, 0, 0, 15, 2, 5, 0xf6f6f6);
  g.box(0, 1, 1, 16, 2, 4, 0xf6f6f6);
  g.box(1, 0, 0, 15, 1, 5, 0x1a2a4a);
  g.box(3, 2, 0, 12, 4, 5, 0xf2f2f2);
  g.box(3, 3, 0, 12, 4, 5, (x) => (x % 2 ? 0x22303d : 0x2a4a6a));
  g.box(5, 4, 1, 10, 6, 4, 0xf2f2f2);
  g.box(6, 5, 1, 10, 6, 4, 0x22303d);
  g.box(7, 6, 2, 8, 7, 3, 0xd8d8d8);
}
function cargoShip(g, rng) {
  const hull = rng.pick([0xa83a2a, 0x2a3a5a, 0x3a5a3a]);
  g.box(1, 0, 0, 31, 4, 8, (x, y) => (y === 0 ? 0x5a2a22 : hull));
  g.box(0, 2, 1, 32, 4, 7, hull);
  g.box(1, 4, 0, 31, 5, 8, 0x8a8f96);
  for (let x = 6; x < 26; x += 4) {
    for (let y = 5; y < 5 + 1 + Math.floor(hash3(x, 1, 2) * 3); y++) {
      for (let z = 1; z < 7; z += 2) g.box(x, y, z, x + 4, y + 1, z + 2, BRIGHT[Math.floor(hash3(x, y, z) * BRIGHT.length)]);
    }
  }
  g.box(26, 5, 1, 31, 9, 7, 0xf2f2f2);
  g.box(26, 7, 1, 31, 8, 7, (x, y, z) => (z % 2 ? 0x22303d : 0xf2f2f2));
  g.box(28, 9, 3, 29, 10, 5, 0x2a2a2a);
}
function buoy(g) {
  g.box(0, 0, 0, 2, 2, 2, (x, y) => (y === 1 ? 0xf2f2f2 : 0xd93636));
  g.set(0, 2, 0, 0xffd23f, E);
}
function jetski(g, rng) {
  const c = rng.pick([0xf2c12e, 0x2ab0e8, 0xd93636]);
  g.box(0, 0, 0, 3, 1, 2, c);
  g.set(1, 1, 0, 0x1a1a1a);
  g.set(1, 1, 1, 0x1a1a1a);
  g.set(2, 1, 0, 0x55585e);
}
function fishCrates(g) {
  g.box(0, 0, 0, 4, 1, 3, 0x2a5bd9);
  g.box(0, 1, 0, 2, 2, 3, 0x2a5bd9);
  for (const [x, y, z] of [[1, 1, 1], [2, 1, 0], [3, 1, 2], [0, 2, 1]]) g.set(x, y, z, 0xc8d4e0);
}
function lobsterTraps(g) {
  g.box(0, 0, 0, 4, 3, 3, (x, y, z) => ((x + y + z) % 2 ? 0x8a6a48 : y === 2 && z === 1 ? 0xf28a1a : null));
  g.set(0, 0, 0, 0x8a6a48);
}
function oilTank(g) {
  g.cylinder(5, 5, 4.9, 0, 7, (x, y) => (y === 6 ? 0xd8dade : 0xf2f2f2));
  g.cylinder(5, 5, 3, 7, 8, 0xd8dade);
  for (let y = 0; y < 7; y++) g.set(Math.max(0, 9 - Math.floor(y / 2)), y, 1 + Math.floor(y / 2), 0x8a8f96);
  g.box(0, 3, 4, 1, 4, 6, 0x3b6fd1);
}
function containerStack(g, rng) {
  const a = rng.pick([0xc0392b, 0x2980b9, 0x27ae60]);
  const b = rng.pick([0xe67e22, 0x8e44ad, 0x16a085]);
  g.box(0, 0, 0, 8, 4, 3, (x) => (x % 2 ? a : shade(a, 0.82)));
  g.box(0, 4, 0, 8, 8, 3, (x) => (x % 2 ? b : shade(b, 0.82)));
}

// ---------------------------------------------------------------- building sites
function sandPile(g) {
  for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) for (let x = 0; x < 5; x++) if (Math.hypot((x - 2) * 0.8, y * 1.2, z - 1.5) < 2.2) g.set(x, y, z, hash3(x, y, z) < 0.4 ? 0xd8b878 : 0xe8c888);
}
function craneTower(g) {
  const Y = 0xf2b81e;
  // The lattice mast, the jib along the top, the counterweight and a hook hanging off the end.
  for (let y = 0; y < 38; y++) {
    for (const [x, z] of [[1, 0], [3, 0], [1, 2], [3, 2]]) g.set(x, y, z, Y);
    if (y % 3 === 0) g.box(1, y, 0, 4, y + 1, 3, (x, yy, z) => (x === 2 && z === 1 ? null : Y));
  }
  g.box(0, 38, 1, 14, 39, 2, Y);
  g.box(2, 39, 1, 14, 40, 2, (x) => (x % 2 ? Y : null));
  g.box(0, 36, 0, 2, 38, 3, 0x8a8f96);
  g.box(2, 36, 0, 4, 38, 3, 0x2a3a4a);
  g.box(12, 30, 1, 13, 38, 2, 0x2a2a2a);
  g.box(11, 29, 1, 14, 30, 2, 0xd93636);
  g.box(2, 40, 1, 3, 43, 2, Y);
}
function pylon(g) {
  const M = 0x9aa0a8;
  for (let y = 0; y < 30; y++) {
    const i = Math.min(3, Math.floor(y / 6));
    g.set(i, y, 0, M);
    g.set(7 - i, y, 0, M);
    g.set(i, y, 2, M);
    g.set(7 - i, y, 2, M);
    if (y % 4 === 0) g.box(i, y, 0, 8 - i, y + 1, 3, (x, yy, z) => (x === i || x === 7 - i || z !== 1 ? M : null));
  }
  for (const y of [21, 26]) {
    g.box(0, y, 1, 8, y + 1, 2, M);
    for (const x of [0, 7]) g.set(x, y - 1, 1, 0xd8e0e8);
  }
}
function windTurbine(g) {
  const H = 30;
  g.box(10, 0, 1, 11, H, 2, 0xf2f4f6);
  g.box(9, 0, 0, 12, 1, 3, 0xd8dade);
  g.box(9, H - 1, 1, 12, H + 1, 3, 0xf2f4f6);
  g.set(10, H, 0, 0xd8dade);
  // Three long blades at 120 degrees, one straight up.
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
    for (let t = 1; t < 10.4; t += 0.4) g.set(Math.round(10 + Math.cos(a) * t), Math.round(H + Math.sin(a) * t), 0, t > 9 ? 0xd93636 : 0xf6f8fa);
  }
}
function hotAirBalloon(g, rng) {
  const a = rng.pick([0xd93636, 0x3b6fd1, 0xf28a1a]);
  const b = rng.pick([0xf2c12e, 0xf6f2ea, 0x3a8a5a]);
  g.box(2, 0, 2, 5, 2, 5, 0x8a6a48);
  for (const [x, z] of [[2, 2], [4, 2], [2, 4], [4, 4]]) g.box(x, 2, z, x + 1, 4, z + 1, 0x5a4a3a);
  for (let y = 4; y < 12; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) {
    const r = y < 7 ? 1.6 + (y - 4) * 0.6 : 3.4 - Math.max(0, y - 9) * 0.6;
    if (Math.hypot(x - 3, z - 3) > r) continue;
    g.set(x, y, z, Math.floor(Math.atan2(z - 3, x - 3) * 2 + 7) % 2 ? a : b);
  }
}

// [id, tier, voxel size, [nx, ny, nz], builder, extras]. variants: how many looks it has (1 for
// models with fixed colours, so they share one instanced mesh).
const C = (id, tier, v, size, build, more = {}) => ({ id, tier, v, size, build, value: tier === 1 ? 0.2 : tier === 2 ? 0.5 : 1.5, variants: 3, weight: 0, ...more });
const one = { variants: 1 };

export const CLUTTER_PROPS = [
  // Streets and shopfronts.
  C('trash_bags', 1, 1, [4, 3, 3], trashBags, { value: 0.1 }),
  C('cardboard', 1, 0.9, [4, 3, 3], cardboard, { ...one, value: 0.1 }),
  C('pallets', 1, 1.1, [4, 3, 3], pallets, one),
  C('shopping_cart', 1, 0.8, [4, 4, 3], shoppingCart, one),
  C('potted_plant', 1, 1, [2, 4, 2], pottedPlant),
  C('sandwich_board', 1, 0.8, [2, 3, 2], sandwichBoard, { value: 0.1 }),
  C('atm', 1, 1, [2, 4, 2], atm, { ...one, value: 0.4, light: { color: 0x9fe8ff, h: 3 } }),
  C('wheelie_bin', 1, 1, [2, 3, 2], wheelieBin, { value: 0.1 }),
  C('postbox', 1, 0.9, [2, 4, 2], postbox, one),
  C('utility_box', 1, 1, [3, 4, 2], utilityBox),
  C('gacha', 1, 0.8, [4, 4, 2], gacha, { ...one, value: 0.3, light: { color: 0xff9ad8, h: 3 } }),
  C('pigeons', 1, 0.5, [5, 2, 4], pigeons, { ...one, value: 0.1 }),
  C('porta_potty', 1, 1.1, [2, 5, 2], portaPotty),
  C('road_sign', 1, 0.9, [3, 6, 1], roadSign),
  C('ac_unit', 1, 1, [3, 2, 2], acUnit, one),
  C('market_stall', 2, 1.2, [7, 6, 4], marketStall),
  C('flower_stall', 2, 1.1, [6, 5, 3], flowerStall),
  C('noodle_stall', 2, 1.1, [6, 6, 4], noodleStall, { ...one, light: { color: 0xff6a3a, h: 5 } }),
  // Parked vehicles.
  C('sports_car', 2, 1.6, [8, 5, 4], sportsCar, { vehicle: true }),
  C('limo', 2, 1.6, [12, 5, 4], limo, { ...one, vehicle: true }),
  C('school_bus', 3, 1.8, [16, 8, 5], schoolBus, { ...one, vehicle: true }),
  C('garbage_truck', 3, 1.8, [13, 8, 5], garbageTruck, { ...one, vehicle: true }),
  C('ice_cream_truck', 2, 1.6, [10, 8, 4], iceCreamTruck, { vehicle: true }),
  C('motorbike', 1, 1, [5, 3, 1], motorbike, { vehicle: true }),
  C('camper_van', 2, 1.6, [11, 8, 4], camperVan, { vehicle: true }),
  C('car_wreck', 2, 1.6, [8, 4, 4], carWreck),
  C('cement_mixer', 3, 1.6, [12, 8, 5], cementMixer, { ...one, vehicle: true }),
  C('excavator', 3, 1.6, [12, 8, 6], excavator, { ...one, vehicle: true }),
  C('forklift', 2, 1.2, [6, 6, 4], forklift, { vehicle: true }),
  // Animals.
  C('sheep', 1, 1, [4, 3, 2], sheep, { ...one, value: 0.4 }),
  C('pig', 1, 0.9, [4, 3, 2], pig, { ...one, value: 0.4 }),
  C('chicken', 1, 0.7, [2, 2, 1], chicken, { value: 0.2 }),
  C('horse', 2, 1.1, [6, 6, 2], horse, { value: 0.6 }),
  C('deer', 1, 1, [4, 5, 2], deer, { ...one, value: 0.4 }),
  C('bear', 2, 1.2, [5, 4, 3], bear, { ...one, value: 0.6 }),
  C('ducks', 1, 0.6, [4, 1, 3], ducks, { ...one, value: 0.1 }),
  // Farms and yards.
  C('chicken_coop', 1, 1, [5, 4, 4], chickenCoop, one),
  C('beehive', 1, 1, [2, 3, 2], beehive, one),
  C('water_trough', 1, 1, [5, 2, 2], waterTrough, one),
  C('well', 2, 1, [4, 6, 4], well, one),
  C('pumpkins', 1, 0.9, [3, 2, 3], pumpkins, { ...one, value: 0.1 }),
  C('hay_roll', 1, 1.3, [3, 3, 3], hayRoll, one),
  C('wheelbarrow', 1, 0.8, [4, 2, 2], wheelbarrow),
  C('veg_patch', 1, 1, [5, 2, 3], vegPatch, { ...one, value: 0.1 }),
  C('corn', 1, 1.3, [3, 5, 3], corn, { ...one, value: 0.1 }),
  C('apple_tree', 2, 1.5, [7, 9, 7], appleTree, { ...one, value: 0.4 }),
  C('clothesline', 1, 0.9, [7, 4, 1], clothesline, { ...one, value: 0.1 }),
  C('kiddie_pool', 1, 1, [4, 1, 4], kiddiePool, { value: 0.1 }),
  C('mower', 1, 0.8, [3, 2, 2], mower, { ...one, value: 0.1 }),
  C('bird_bath', 1, 0.9, [2, 3, 2], birdBath, { ...one, value: 0.1 }),
  C('hedge', 1, 1.2, [8, 3, 2], hedge, { ...one, value: 0.1 }),
  C('topiary', 1, 1, [3, 5, 3], topiary, { ...one, value: 0.1 }),
  C('firewood', 1, 1, [4, 2, 2], firewood, { ...one, value: 0.1 }),
  // The woods.
  C('stump', 1, 1, [3, 2, 3], stump, { ...one, value: 0.1 }),
  C('toadstools', 1, 0.8, [3, 3, 3], toadstools, { ...one, value: 0.1 }),
  C('fern', 1, 1, [3, 2, 3], fern, { ...one, value: 0.1 }),
  C('boulder', 2, 1.6, [6, 4, 5], boulder, one),
  C('berry_bush', 1, 1.1, [4, 3, 4], berryBush, { value: 0.1 }),
  C('canoe', 1, 1, [7, 1, 2], canoe),
  // Snow.
  C('sled', 1, 0.9, [3, 2, 2], sled, { value: 0.1 }),
  C('snowmobile', 1, 1.1, [5, 3, 2], snowmobile, { vehicle: true }),
  C('ski_rack', 1, 0.9, [5, 4, 1], skiRack, one),
  C('snow_pile', 1, 1.2, [4, 2, 4], snowPile, { ...one, value: 0.05 }),
  C('igloo', 2, 1.2, [6, 4, 6], igloo, one),
  C('ice_hut', 1, 1.1, [4, 5, 4], iceHut),
  // Desert.
  C('skull', 1, 0.8, [3, 2, 2], skull, { ...one, value: 0.05 }),
  C('barrel_cactus', 1, 0.8, [3, 3, 3], barrelCactus, { ...one, value: 0.1 }),
  C('pump_jack', 3, 1.6, [12, 8, 3], pumpJack, one),
  C('wind_pump', 2, 1.2, [5, 14, 5], windPump, one),
  C('solar_panels', 2, 1.4, [8, 2, 5], solarPanels, one),
  C('radio_dish', 3, 1.6, [10, 10, 10], radioDish, one),
  // Lantern streets.
  C('stone_lantern', 1, 0.9, [3, 5, 3], stoneLantern, { ...one, light: { color: 0xffb85a, h: 3 } }),
  C('bamboo', 2, 1, [3, 10, 3], bamboo, one),
  C('bonsai', 1, 0.8, [3, 3, 2], bonsai, one),
  C('rickshaw', 1, 1, [5, 4, 3], rickshaw, { ...one, vehicle: true }),
  // On the water and the quays.
  C('rowboat', 1, 1, [5, 2, 2], rowboat, one),
  C('sailboat', 2, 1.4, [8, 12, 3], sailboat),
  C('yacht', 3, 1.8, [16, 7, 5], yacht, one),
  C('cargo_ship', 3, 2.2, [32, 10, 8], cargoShip, { value: 3 }),
  C('buoy', 1, 0.9, [2, 3, 2], buoy, { ...one, light: { color: 0xffd23f, h: 2 } }),
  C('jetski', 1, 1, [3, 2, 2], jetski, { vehicle: true }),
  C('fish_crates', 1, 1, [4, 2, 3], fishCrates, one),
  C('lobster_traps', 1, 1, [4, 3, 3], lobsterTraps, one),
  C('oil_tank', 3, 2, [10, 8, 10], oilTank, { ...one, value: 2 }),
  C('container_stack', 3, 2, [8, 8, 3], containerStack, { value: 2 }),
  // Building sites, and big things for the big sizes.
  C('sand_pile', 1, 1.2, [5, 3, 4], sandPile, { ...one, value: 0.05 }),
  C('crane_tower', 3, 1.8, [14, 43, 3], craneTower, { ...one, value: 3 }),
  C('pylon', 3, 1.8, [8, 30, 3], pylon, { ...one, value: 2 }),
  C('wind_turbine', 3, 1.8, [21, 41, 3], windTurbine, { ...one, value: 3 }),
  C('hot_air_balloon', 2, 1.8, [7, 12, 7], hotAirBalloon),
];

// Sticker prices for the damage counter (see prices.js).
export const CLUTTER_PRICE = {
  trash_bags: 5, cardboard: 5, pallets: 100, shopping_cart: 200, potted_plant: 80, sandwich_board: 60, atm: 30000,
  wheelie_bin: 60, postbox: 900, utility_box: 6000, gacha: 2500, pigeons: 0, porta_potty: 1500, road_sign: 250, ac_unit: 3000,
  market_stall: 3000, flower_stall: 2500, noodle_stall: 8000,
  sports_car: 180000, limo: 120000, school_bus: 250000, garbage_truck: 300000, ice_cream_truck: 80000, motorbike: 12000,
  camper_van: 90000, car_wreck: 400, cement_mixer: 150000, excavator: 300000, forklift: 30000,
  sheep: 300, pig: 250, chicken: 20, horse: 6000, deer: 0, bear: 0, ducks: 0,
  chicken_coop: 900, beehive: 300, water_trough: 300, well: 3000, pumpkins: 15, hay_roll: 60, wheelbarrow: 150,
  veg_patch: 100, corn: 5, apple_tree: 2500, clothesline: 50, kiddie_pool: 40, mower: 300, bird_bath: 150, hedge: 200,
  topiary: 400, firewood: 100,
  stump: 0, toadstools: 0, fern: 0, boulder: 0, berry_bush: 20, canoe: 1200,
  sled: 100, snowmobile: 12000, ski_rack: 800, snow_pile: 0, igloo: 0, ice_hut: 3000,
  skull: 0, barrel_cactus: 30, pump_jack: 250000, wind_pump: 15000, solar_panels: 20000, radio_dish: 5e6,
  stone_lantern: 3000, bamboo: 100, bonsai: 2000, rickshaw: 3000,
  rowboat: 1500, sailboat: 80000, yacht: 3e6, cargo_ship: 50e6, buoy: 2000, jetski: 10000, fish_crates: 150,
  lobster_traps: 200, oil_tank: 2e6, container_stack: 50000,
  sand_pile: 50, crane_tower: 2e6, pylon: 500000, wind_turbine: 3e6, hot_air_balloon: 50000,
};
