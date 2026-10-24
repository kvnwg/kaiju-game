// Voxel character models: the four kaiju (as animatable parts), civilians, the military
// and the boss. Models face +x. Pure data; the renderer meshes and animates them.
import { VoxelGrid, E, shade, hash3 } from './voxel.js';
import { buildProp } from './props.js';

function ellipsoid(g, cx, cy, cz, rx, ry, rz, color, f = 0) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
        if (d <= 1) g.set(x, y, z, typeof color === 'function' ? color(x, y, z, d) : color, f);
      }
}

// part(name, grid, pivot (voxel coords inside grid), pos (relative to parent pivot), parent)
function part(name, g, pivot, pos, parent = null, extra = {}) {
  return { name, grid: g, pivot, pos, parent, ...extra };
}

// ---------------------------------------------------------------- kaiju
function rex() {
  const G = 0x5aa84f;
  const D = 0x2f6b2a;
  const B = 0xd2e08f;
  const skin = (x, y, z) => (hash3(x, y, z) < 0.18 ? shade(G, 0.88) : G);
  const torso = new VoxelGrid(12, 11, 9);
  ellipsoid(torso, 6, 5, 4.5, 6, 4.6, 4.2, (x, y, z) => (y < 4 && z > 1 && z < 7 && x > 4 ? B : y > 7 ? D : skin(x, y, z)));
  for (let x = 1; x < 10; x += 2) {
    torso.set(x, 10, 4, D);
    torso.set(x, 10, 5, D);
    if (x > 2 && x < 9) torso.set(x, 11 - 1, 4, 0xe8c64a);
  }
  const head = new VoxelGrid(9, 6, 7);
  head.box(0, 1, 1, 8, 6, 6, skin);
  head.box(0, 5, 1, 6, 6, 6, D);
  head.set(5, 4, 1, 0xffe14a, E);
  head.set(5, 4, 5, 0xffe14a, E);
  head.set(5, 3, 1, 0x111111);
  head.set(5, 3, 5, 0x111111);
  for (let x = 3; x < 8; x++) {
    head.set(x, 1, 1, 0xf6f2e6);
    head.set(x, 1, 5, 0xf6f2e6);
  }
  const jaw = new VoxelGrid(7, 2, 5);
  jaw.box(0, 0, 0, 7, 2, 5, B);
  for (let x = 2; x < 7; x++) {
    jaw.set(x, 1, 0, 0xf6f2e6);
    jaw.set(x, 1, 4, 0xf6f2e6);
  }
  const leg = () => {
    const g = new VoxelGrid(4, 8, 4);
    g.box(0, 2, 0, 4, 8, 4, skin);
    g.box(0, 0, 0, 5, 2, 4, shade(G, 0.8));
    g.set(4, 0, 0, 0xf6f2e6);
    g.set(4, 0, 3, 0xf6f2e6);
    return g;
  };
  const arm = () => {
    const g = new VoxelGrid(2, 4, 2);
    g.box(0, 0, 0, 2, 4, 2, skin);
    g.set(1, 0, 0, 0xf6f2e6);
    return g;
  };
  const tail = (l, w) => {
    const g = new VoxelGrid(l, w, w);
    g.box(0, 0, 0, l, w, w, skin);
    for (let x = 0; x < l; x += 2) g.set(x, w - 1, Math.floor(w / 2), D);
    return g;
  };
  return {
    radius: 7, height: 18,
    parts: [
      part('body', torso, { x: 6, y: 4, z: 4.5 }, { x: 0, y: 7, z: 0 }),
      part('head', head, { x: 1, y: 2, z: 3.5 }, { x: 5, y: 5, z: 0 }, 'body'),
      part('jaw', jaw, { x: 0, y: 2, z: 2.5 }, { x: 0, y: 0, z: 0 }, 'head'),
      part('legL', leg(), { x: 2, y: 8, z: 2 }, { x: -1, y: 1, z: -3 }, 'body', { swing: 1 }),
      part('legR', leg(), { x: 2, y: 8, z: 2 }, { x: -1, y: 1, z: 3 }, 'body', { swing: -1 }),
      part('armL', arm(), { x: 1, y: 4, z: 1 }, { x: 4, y: -1, z: -3 }, 'body', { arm: 1 }),
      part('armR', arm(), { x: 1, y: 4, z: 1 }, { x: 4, y: -1, z: 3 }, 'body', { arm: -1 }),
      part('tail1', tail(6, 4), { x: 6, y: 2, z: 2 }, { x: -5, y: 1, z: 0 }, 'body', { tail: 0 }),
      part('tail2', tail(5, 3), { x: 5, y: 1.5, z: 1.5 }, { x: -6, y: 0, z: 0 }, 'tail1', { tail: 1 }),
      part('tail3', tail(5, 2), { x: 5, y: 1, z: 1 }, { x: -5, y: 0, z: 0 }, 'tail2', { tail: 2 }),
    ],
  };
}

function gorilla() {
  const F = 0x6d5a4e;
  const D = 0x3b2f28;
  const S = 0xb8b0a8; // silver back
  const fur = (x, y, z) => (hash3(x, y, z) < 0.25 ? shade(F, 0.85) : F);
  const torso = new VoxelGrid(10, 12, 12);
  ellipsoid(torso, 5, 6, 6, 5, 6, 6, (x, y, z) => (x < 3 && y > 5 ? S : x > 6 && y < 8 && z > 3 && z < 9 ? 0x8a7a6e : fur(x, y, z)));
  const head = new VoxelGrid(6, 6, 6);
  head.box(0, 0, 0, 6, 6, 6, fur);
  head.box(4, 3, 0, 6, 4, 6, D); // brow
  head.box(4, 0, 1, 6, 3, 5, 0x8a7a6e); // muzzle
  head.set(5, 2, 1, 0xff3b2b, E);
  head.set(5, 2, 4, 0xff3b2b, E);
  const jaw = new VoxelGrid(3, 1, 4);
  jaw.box(0, 0, 0, 3, 1, 4, 0x5a4a40);
  const arm = () => {
    const g = new VoxelGrid(4, 13, 4);
    g.box(0, 3, 0, 4, 13, 4, fur);
    g.box(0, 0, 0, 4, 3, 4, D); // fist
    return g;
  };
  const leg = () => {
    const g = new VoxelGrid(4, 6, 4);
    g.box(0, 1, 0, 4, 6, 4, fur);
    g.box(0, 0, 0, 5, 1, 4, D);
    return g;
  };
  return {
    radius: 7, height: 19,
    parts: [
      part('body', torso, { x: 5, y: 4, z: 6 }, { x: 0, y: 6, z: 0 }, null, { lean: 0.35 }),
      part('head', head, { x: 1, y: 1, z: 3 }, { x: 4, y: 8, z: 0 }, 'body'),
      part('jaw', jaw, { x: 0, y: 1, z: 2 }, { x: 4, y: 0, z: 0 }, 'head'),
      part('armL', arm(), { x: 2, y: 12, z: 2 }, { x: 2, y: 6, z: -7 }, 'body', { swing: -1, punch: true }),
      part('armR', arm(), { x: 2, y: 12, z: 2 }, { x: 2, y: 6, z: 7 }, 'body', { swing: 1, punch: true }),
      part('legL', leg(), { x: 2, y: 6, z: 2 }, { x: -2, y: 0, z: -3 }, 'body', { swing: 1 }),
      part('legR', leg(), { x: 2, y: 6, z: 2 }, { x: -2, y: 0, z: 3 }, 'body', { swing: -1 }),
    ],
  };
}

function ember() {
  const O = 0xd9622b;
  const K = 0x2a1a14;
  const L = 0xffa21a;
  const skin = (x, y, z) => (hash3(x, y, z) < 0.12 ? K : O);
  const torso = new VoxelGrid(14, 6, 8);
  ellipsoid(torso, 7, 3, 4, 7, 3, 4, (x, y, z) => (y < 2 ? 0xf2c14e : skin(x, y, z)));
  for (let x = 1; x < 13; x++) if (x % 3 !== 0) torso.set(x, 5, 4, L, E); // lava spine
  for (let x = 2; x < 12; x += 3) {
    torso.set(x, 4, 1, L, E);
    torso.set(x, 4, 6, L, E);
  }
  const head = new VoxelGrid(7, 4, 6);
  head.box(0, 1, 0, 7, 4, 6, skin);
  head.set(4, 3, 0, 0xffe14a, E);
  head.set(4, 3, 5, 0xffe14a, E);
  head.box(5, 3, 2, 7, 4, 4, K);
  const jaw = new VoxelGrid(6, 1, 6);
  jaw.box(0, 0, 0, 6, 1, 6, 0xf2c14e);
  const leg = () => {
    const g = new VoxelGrid(3, 4, 3);
    g.box(0, 0, 0, 3, 4, 3, skin);
    g.set(2, 0, 0, K);
    g.set(2, 0, 2, K);
    return g;
  };
  const tail = (l, w, tip) => {
    const g = new VoxelGrid(l, w, w);
    g.box(0, 0, 0, l, w, w, skin);
    for (let x = 0; x < l; x += 2) g.set(x, w - 1, Math.floor(w / 2), L, E);
    if (tip) g.box(0, 0, 0, 2, w, w, (x, y, z) => (hash3(x, y, z) < 0.5 ? 0xffd23f : 0xff5a1a), E);
    return g;
  };
  return {
    radius: 7, height: 9,
    parts: [
      part('body', torso, { x: 7, y: 2, z: 4 }, { x: 0, y: 4, z: 0 }),
      part('head', head, { x: 0, y: 2, z: 3 }, { x: 6, y: 1, z: 0 }, 'body'),
      part('jaw', jaw, { x: 0, y: 1, z: 3 }, { x: 0, y: 0, z: 0 }, 'head'),
      part('legFL', leg(), { x: 1.5, y: 4, z: 1.5 }, { x: 4, y: 0, z: -4.5 }, 'body', { swing: 1 }),
      part('legFR', leg(), { x: 1.5, y: 4, z: 1.5 }, { x: 4, y: 0, z: 4.5 }, 'body', { swing: -1 }),
      part('legBL', leg(), { x: 1.5, y: 4, z: 1.5 }, { x: -4, y: 0, z: -4.5 }, 'body', { swing: -1 }),
      part('legBR', leg(), { x: 1.5, y: 4, z: 1.5 }, { x: -4, y: 0, z: 4.5 }, 'body', { swing: 1 }),
      part('tail1', tail(6, 3), { x: 6, y: 1.5, z: 1.5 }, { x: -6, y: 0, z: 0 }, 'body', { tail: 0 }),
      part('tail2', tail(6, 2, true), { x: 6, y: 1, z: 1 }, { x: -6, y: 0, z: 0 }, 'tail1', { tail: 1 }),
    ],
  };
}

function volt() {
  const B = 0x3d6fd6;
  const D = 0x1d2f6b;
  const C = 0x5ff0ff;
  const shell = new VoxelGrid(14, 8, 12);
  ellipsoid(shell, 7, 1, 6, 7, 7, 6, (x, y, z) => {
    if (z === 6 || z === 5) return C; // seam glow
    if ((x + y) % 5 === 0) return C;
    return hash3(x, y, z) < 0.2 ? shade(B, 1.15) : B;
  });
  // Only seams emit: re-flag cyan voxels.
  for (let y = 0; y < shell.ny; y++) for (let z = 0; z < shell.nz; z++) for (let x = 0; x < shell.nx; x++) if ((shell.get(x, y, z) & 0xffffff) === C) shell.set(x, y, z, C, E);
  const belly = new VoxelGrid(12, 2, 10);
  belly.box(0, 0, 0, 12, 2, 10, D);
  const head = new VoxelGrid(5, 5, 6);
  head.box(0, 0, 0, 5, 4, 6, D);
  head.set(4, 2, 1, 0xff3bd6, E);
  head.set(4, 2, 4, 0xff3bd6, E);
  head.box(3, 4, 2, 4, 5, 4, D);
  const horn = new VoxelGrid(2, 7, 2);
  horn.box(0, 0, 0, 2, 6, 2, D);
  horn.box(0, 6, 0, 2, 7, 2, C, E);
  const jaw = new VoxelGrid(3, 1, 6);
  jaw.set(0, 0, 0, D);
  jaw.set(1, 0, 0, D);
  jaw.set(2, 0, 1, D);
  jaw.set(0, 0, 5, D);
  jaw.set(1, 0, 5, D);
  jaw.set(2, 0, 4, D);
  const leg = () => {
    const g = new VoxelGrid(2, 6, 2);
    g.box(0, 0, 0, 1, 6, 1, D);
    g.box(0, 0, 0, 2, 1, 2, 0x111522);
    return g;
  };
  return {
    radius: 7, height: 11,
    parts: [
      part('body', belly, { x: 6, y: 1, z: 5 }, { x: 0, y: 6, z: 0 }),
      part('shell', shell, { x: 7, y: 0, z: 6 }, { x: 0, y: 1, z: 0 }, 'body'),
      part('head', head, { x: 0, y: 2, z: 3 }, { x: 6, y: 1, z: 0 }, 'body'),
      part('horn', horn, { x: 1, y: 0, z: 1 }, { x: 3, y: 2, z: 0 }, 'head'),
      part('jaw', jaw, { x: 0, y: 0, z: 3 }, { x: 5, y: 0, z: 0 }, 'head'),
      ...[-1, 1].flatMap((s) => [
        part(`leg${s}a`, leg(), { x: 0.5, y: 6, z: 0.5 }, { x: 4, y: 0, z: 5.5 * s }, 'body', { swing: s }),
        part(`leg${s}b`, leg(), { x: 0.5, y: 6, z: 0.5 }, { x: 0, y: 0, z: 6 * s }, 'body', { swing: -s }),
        part(`leg${s}c`, leg(), { x: 0.5, y: 6, z: 0.5 }, { x: -4, y: 0, z: 5.5 * s }, 'body', { swing: s }),
      ]),
    ],
  };
}

export const KAIJU_MODELS = { rex, gorilla, ember, volt };

// ---------------------------------------------------------------- people
const SKIN = [0xf2c8a8, 0xd9a07a, 0xa8714a, 0x7a4e30, 0xf6d8c0];
const HAIR = [0x2a1d14, 0x6a4a2a, 0xd9b84a, 0x1a1a1a, 0xb84a2a, 0x9a9a9a];
const SHIRTS = [0xd94f4f, 0x3b6fd1, 0xf2c12e, 0x3a8a5a, 0xf2f2f2, 0x9f6fd9, 0xf28a3c, 0x2a2a2a, 0x6fd8c8, 0xd94f8a];
const PANTS = [0x2a3a5a, 0x3a3a3a, 0x6a5a4a, 0x2a2a2a, 0x5a6a8a];

export function personModel(i, o = {}) {
  const g = new VoxelGrid(2, 6, 2);
  const skin = o.skin ?? SKIN[i % SKIN.length];
  const shirt = o.shirt ?? SHIRTS[(i * 3) % SHIRTS.length];
  const pants = o.pants ?? PANTS[(i * 7) % PANTS.length];
  g.box(0, 0, 0, 2, 2, 2, pants);
  g.box(0, 2, 0, 2, 4, 2, shirt);
  g.box(0, 4, 0, 2, 5, 2, skin);
  g.set(1, 4, 0, o.eyes ?? 0x1a1a1a);
  g.box(0, 5, 0, 2, 6, 2, o.hat ?? HAIR[(i * 5) % HAIR.length]);
  if (!o.hat) g.set(1, 5, 1, skin);
  if (o.badge) g.set(1, 3, 0, o.badge, E);
  if (o.gun) g.set(1, 2, 1, 0x222222);
  return { grid: g, origin: { x: 1, z: 1 }, v: 0.8 };
}

export const PERSON_VARIANTS = 8;

// ---------------------------------------------------------------- military
function simple(g, v, ox = g.nx / 2, oz = g.nz / 2) {
  return { grid: g, origin: { x: ox, z: oz }, v };
}

// A blocky bipedal battle mech; v sets its size.
function humanoidMech({ body, trim, eye, v, crest = false }) {
  const g = new VoxelGrid(12, 18, 10);
  g.box(3, 0, 1, 6, 2, 4, trim);
  g.box(3, 0, 6, 6, 2, 9, trim);
  g.box(3, 2, 1, 5, 8, 4, body);
  g.box(3, 2, 6, 5, 8, 9, body);
  g.box(2, 8, 1, 9, 14, 9, body);
  g.box(2, 10, 1, 9, 11, 9, trim);
  g.box(8, 11, 3, 10, 13, 7, trim);
  g.box(3, 9, 0, 7, 14, 1, trim);
  g.box(3, 9, 9, 7, 14, 10, trim);
  g.box(4, 4, 0, 10, 7, 1, body);
  g.box(4, 4, 9, 10, 7, 10, body);
  g.box(9, 4, 0, 11, 7, 1, trim);
  g.box(9, 4, 9, 11, 7, 10, trim);
  g.box(4, 14, 3, 8, 17, 7, body);
  g.box(7, 15, 3, 8, 16, 7, eye, E);
  if (crest) g.box(4, 17, 4, 7, 18, 6, eye, E);
  return simple(g, v, 5, 5);
}

export const UNIT_MODELS = {
  cop: () => personModel(0, { shirt: 0x2a3f7a, pants: 0x1a2440, hat: 0x1a2440, badge: 0xffd23f, gun: true }),
  police: () => {
    const p = buildProp('car', 0);
    const g = p.grid;
    g.box(0, 1, 0, g.nx, 3, g.nz, (x, y) => (y === 2 && x > 1 && x < g.nx - 2 ? 0xf2f2f2 : 0x1a1a1a));
    g.box(Math.floor(g.nx * 0.3) + 1, 5, 0, Math.floor(g.nx * 0.75) - 1, 6, 2, 0xff2a2a, E);
    g.box(Math.floor(g.nx * 0.3) + 1, 5, 2, Math.floor(g.nx * 0.75) - 1, 6, 4, 0x2a5bff, E);
    return { ...p, siren: true };
  },
  dog: () => {
    const g = new VoxelGrid(5, 4, 2);
    g.box(0, 1, 0, 4, 3, 2, 0x5a3a24);
    g.box(3, 2, 0, 5, 4, 2, 0x5a3a24);
    g.set(4, 3, 0, 0x111111);
    g.set(0, 0, 0, 0x3a2414);
    g.set(3, 0, 1, 0x3a2414);
    g.set(0, 3, 1, 0x5a3a24);
    return simple(g, 0.9);
  },
  swat: () => {
    const g = new VoxelGrid(12, 8, 6);
    g.box(0, 1, 0, 12, 7, 6, 0x15171c);
    g.box(9, 1, 0, 12, 6, 6, 0x1f2229);
    g.box(10, 3, 0, 12, 5, 6, 0x2a3a4a);
    g.box(1, 3, 0, 9, 4, 6, (x) => (x % 3 ? 0xf2f2f2 : 0x15171c));
    g.box(2, 7, 1, 8, 8, 5, 0x2a2d33);
    g.set(9, 7, 1, 0xff2a2a, E);
    g.set(9, 7, 4, 0x2a5bff, E);
    for (const x of [1, 8]) for (const z of [0, 5]) g.box(x, 0, z, x + 2, 2, z + 1, 0x0a0a0a);
    g.set(11, 2, 0, 0xfff6d8, E);
    g.set(11, 2, 5, 0xfff6d8, E);
    return { ...simple(g, 1.6), siren: true };
  },
  roadblock: () => {
    const g = new VoxelGrid(14, 4, 4);
    for (let x = 0; x < 14; x++) g.box(x, 0, 1, x + 1, 2, 3, x % 4 < 2 ? 0xe8e6e0 : 0xd93636);
    g.box(0, 2, 1, 14, 3, 2, 0xe8e6e0);
    g.box(6, 0, 3, 8, 4, 4, 0x2a3f7a);
    g.set(6, 3, 3, 0xf2c8a8);
    g.set(0, 3, 1, 0xff2a2a, E);
    g.set(13, 3, 1, 0x2a5bff, E);
    return simple(g, 1.6);
  },
  tank: () => {
    const g = new VoxelGrid(14, 7, 9);
    g.box(0, 0, 0, 14, 2, 2, 0x2f3a20);
    g.box(0, 0, 7, 14, 2, 9, 0x2f3a20);
    g.box(1, 2, 0, 13, 4, 9, 0x566b3a);
    g.box(4, 4, 2, 10, 6, 7, 0x4a5d30);
    g.box(10, 5, 4, 16, 6, 5, 0x3e4f28);
    g.set(5, 6, 3, 0x2a2a2a);
    return simple(g, 2.2, 7, 4.5);
  },
  infantry: () => {
    const g = new VoxelGrid(6, 6, 6);
    for (const [x, z] of [[0, 0], [3, 2], [0, 4]]) {
      g.box(x, 0, z, x + 2, 2, z + 2, 0x3a4a2a);
      g.box(x, 2, z, x + 2, 4, z + 2, 0x4d5a32);
      g.box(x, 4, z, x + 2, 5, z + 2, 0xd9a07a);
      g.box(x, 5, z, x + 2, 6, z + 2, 0x3a4a2a);
      g.box(x + 1, 4, z, x + 3, 5, z + 1, 0x222222);
    }
    return simple(g, 0.9);
  },
  heli: () => {
    // Police gunship drone with four glowing ring rotors.
    const g = new VoxelGrid(14, 4, 14);
    g.box(4, 1, 5, 11, 4, 9, 0xf2f2f2);
    g.box(4, 1, 5, 11, 2, 9, 0x15171c);
    g.box(9, 2, 5, 11, 4, 9, 0x2a3a4a);
    g.box(1, 2, 6, 4, 3, 8, 0xf2f2f2);
    for (const [cx, cz, c] of [[3, 3, 0x2a5bff], [11, 3, 0xff2a2a], [3, 11, 0xff2a2a], [11, 11, 0x2a5bff]]) {
      g.cylinder(cx, cz, 2.6, 2, 3, c, E, true);
      g.box(Math.min(cx, 7), 2, Math.min(cz, 7), Math.max(cx, 7) + 1, 3, Math.min(cz, 7) + 1, 0x55585e);
    }
    return { ...simple(g, 2), siren: true };
  },
  jet: () => {
    const g = new VoxelGrid(16, 4, 13);
    g.box(0, 1, 5, 16, 3, 8, 0x8a939d);
    for (let x = 2; x < 11; x++) {
      const span = Math.floor((x - 2) * 0.7);
      g.box(x, 1, 6 - span, x + 1, 2, 7 + span, 0x7a838d);
    }
    g.box(0, 3, 6, 3, 4, 7, 0x7a838d);
    g.box(12, 2, 6, 15, 3, 7, 0x2a3a4a);
    g.box(0, 1, 6, 1, 3, 7, 0xff9a3c, E);
    return simple(g, 2.4);
  },
  artillery: () => {
    const g = new VoxelGrid(16, 6, 7);
    g.box(0, 1, 0, 12, 4, 7, 0x6b6b4a);
    g.box(12, 1, 1, 16, 5, 6, 0x5a5a3a);
    g.box(3, 4, 2, 7, 6, 5, 0x4a4a30);
    g.box(7, 5, 3, 17, 6, 4, 0x3b3b28);
    for (const x of [1, 5, 9, 13]) for (const z of [0, 6]) g.box(x, 0, z, x + 2, 2, z + 1, 0x111111);
    return simple(g, 2.4);
  },
  // Melee mobs, one built to each size: they rush in and brawl.
  drone: () => {
    const g = new VoxelGrid(6, 3, 6);
    g.box(2, 1, 2, 4, 3, 4, 0x2a2d33);
    g.set(3, 1, 3, 0xff3b3b, E);
    for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) {
      g.box(x, 2, z, x + 2, 3, z + 2, 0x8c939c);
      g.box(Math.min(x + 1, 3), 2, Math.min(z + 1, 3), Math.max(x + 1, 3) + 1, 3, Math.min(z + 1, 3) + 1, 0x55585e);
    }
    return simple(g, 0.65);
  },
  robodog: () => {
    const g = new VoxelGrid(8, 6, 4);
    g.box(1, 2, 0, 6, 4, 4, 0xb8bec8);
    g.box(5, 3, 1, 8, 6, 3, 0x9aa1ab);
    g.box(7, 4, 1, 8, 5, 3, 0xff3b3b, E);
    g.box(0, 3, 1, 1, 5, 3, 0x6c737c);
    for (const x of [1, 5]) for (const z of [0, 3]) g.box(x, 0, z, x + 1, 2, z + 1, 0x3a3f47);
    g.box(2, 4, 1, 5, 5, 3, 0xffb13b);
    return simple(g, 1.05);
  },
  walker: () => humanoidMech({ body: 0xf2b134, trim: 0x2a2d33, eye: 0x6fe8ff, v: 1.7 }),
  crusher: () => {
    // Six-legged spider tank.
    const g = new VoxelGrid(16, 8, 16);
    g.box(4, 3, 4, 12, 6, 12, 0x3e4651);
    g.box(5, 6, 5, 11, 7, 11, 0x56606d);
    g.box(11, 4, 6, 14, 6, 10, 0x2a2f37);
    g.box(13, 4, 7, 14, 5, 9, 0xff3b3b, E);
    for (const [x, z] of [[1, 2], [7, 0], [13, 2], [1, 13], [7, 15], [13, 13]]) {
      g.box(Math.min(x, 7), 4, Math.min(z, 7), Math.max(x, 8) + 1, 5, Math.min(z, 7) + 1, 0x2a2f37);
      g.box(x, 0, z, x + 1, 5, z + 1, 0x2a2f37);
    }
    return simple(g, 2.75);
  },
  warframe: () => humanoidMech({ body: 0x9aa4b4, trim: 0x2e3c5a, eye: 0xff4d6d, v: 5.8 }),
  titan: () => humanoidMech({ body: 0x5a1f2a, trim: 0x16181e, eye: 0xffd23f, v: 12, crest: true }),
  mech: () => {
    const g = new VoxelGrid(10, 16, 10);
    g.box(2, 0, 1, 5, 7, 4, 0x3a3f47);
    g.box(2, 0, 6, 5, 7, 9, 0x3a3f47);
    g.box(1, 7, 1, 8, 13, 9, 0x8c939c);
    g.box(7, 9, 3, 9, 12, 7, 0x6c737c);
    g.box(8, 10, 4, 10, 11, 6, 0xff4d6d, E);
    g.box(2, 11, 0, 6, 13, 1, 0x5c636c);
    g.box(2, 11, 9, 6, 13, 10, 0x5c636c);
    g.box(3, 13, 3, 6, 16, 7, 0x6c737c);
    return simple(g, 2.4);
  },
};

// Boss: Coast Guard Mech, built from parts so it can stride and swing its cannons.
export function bossModel() {
  const white = 0xf2f2f2;
  const orange = 0xe8611a;
  const navy = 0x1f3d8a;
  const torso = new VoxelGrid(18, 16, 22);
  torso.box(1, 0, 2, 17, 14, 20, (x, y, z) => (z >= 9 && z <= 12 ? orange : y < 3 ? 0x8a8f96 : white));
  torso.box(1, 0, 13, 17, 14, 14, navy);
  torso.box(13, 8, 7, 18, 12, 15, 0x59c3ff, E); // cockpit glow
  torso.box(2, 14, 4, 8, 16, 18, 0x2b2f36); // missile pods
  for (let z = 5; z < 18; z += 2) torso.set(4, 15, z, 0xff6b3a, E);
  const leg = () => {
    const g = new VoxelGrid(7, 20, 7);
    g.box(1, 4, 1, 6, 20, 6, 0x3a3f47);
    g.box(0, 0, 0, 9, 4, 7, 0x2a2e35);
    g.box(1, 10, 0, 6, 13, 7, orange);
    return g;
  };
  const arm = () => {
    const g = new VoxelGrid(22, 6, 6);
    g.box(0, 0, 0, 6, 6, 6, white);
    g.box(6, 1, 1, 22, 5, 5, 0x5d6670);
    g.box(20, 2, 2, 22, 4, 4, 0xff3b3b, E);
    g.box(2, 0, 0, 4, 6, 6, orange);
    return g;
  };
  return {
    radius: 14, height: 40,
    parts: [
      part('body', torso, { x: 9, y: 0, z: 11 }, { x: 0, y: 20, z: 0 }),
      part('legL', leg(), { x: 3.5, y: 20, z: 3.5 }, { x: -1, y: 0, z: -6 }, 'body', { swing: 1 }),
      part('legR', leg(), { x: 3.5, y: 20, z: 3.5 }, { x: -1, y: 0, z: 6 }, 'body', { swing: -1 }),
      part('armL', arm(), { x: 3, y: 3, z: 3 }, { x: 2, y: 9, z: -14 }, 'body', { arm: 1 }),
      part('armR', arm(), { x: 3, y: 3, z: 3 }, { x: 2, y: 9, z: 14 }, 'body', { arm: -1 }),
    ],
  };
}

// Elevated metro car: silver with a blue stripe and lit windows.
export function trainCarModel(front = false) {
  const g = new VoxelGrid(14, 6, 5);
  g.box(0, 0, 0, 14, 5, 5, 0xc8ccd2);
  g.box(0, 1, 0, 14, 2, 5, 0x2a5bd9);
  for (let x = 1; x < 13; x++) if (x % 3) {
    g.set(x, 3, 0, 0xfff2d8, E);
    g.set(x, 3, 4, 0xfff2d8, E);
  }
  g.box(0, 5, 1, 14, 6, 4, 0x9aa0a8);
  if (front) {
    g.box(13, 2, 1, 14, 4, 4, 0x22303d);
    g.set(13, 1, 1, 0xfff6d8, E);
    g.set(13, 1, 3, 0xfff6d8, E);
  }
  return { grid: g, origin: { x: 7, z: 2.5 }, v: 2.5 };
}

// A small bird for flocks.
export function birdModel() {
  const g = new VoxelGrid(3, 1, 3);
  g.set(1, 0, 1, 0x2a2a2a);
  g.set(0, 0, 1, 0x3a3a3a);
  g.set(2, 0, 1, 0x3a3a3a);
  g.set(1, 0, 0, 0x4a4a4a);
  return { grid: g, origin: { x: 1.5, z: 1.5 }, v: 0.8 };
}

// Advertising blimp.
export function blimpModel() {
  const g = new VoxelGrid(30, 10, 10);
  for (let x = 0; x < 30; x++) {
    const t = (x - 15) / 15;
    const r = Math.sqrt(Math.max(0, 1 - t * t)) * 4.8;
    for (let y = 0; y < 10; y++) for (let z = 0; z < 10; z++) if (Math.hypot(y - 4.5, z - 4.5) < r) g.set(x, y, z, Math.abs(y - 4.5) < 1.2 && x > 8 && x < 22 ? 0xff2bd6 : 0xd8dce2, Math.abs(y - 4.5) < 1.2 && x > 8 && x < 22 ? E : 0);
  }
  g.box(12, 0, 4, 18, 1, 6, 0x3a3d44);
  for (const z of [1, 8]) g.box(0, 4, z, 3, 6, z + 1, 0xd94f4f);
  return { grid: g, origin: { x: 15, z: 5 }, v: 6 };
}
