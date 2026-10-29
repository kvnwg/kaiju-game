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
// The rare doctor: a white coat with a glowing red cross. Eat one to heal.
export const DOCTOR = PERSON_VARIANTS;
// In the back garden the crowd is ants (two colours) and the odd ladybug (see antModel).
export const ANT = PERSON_VARIANTS + 1;
export const PERSON_LOOKS = PERSON_VARIANTS + 4;
export function personLook(i) {
  if (i >= ANT) return antModel(i - ANT);
  if (i !== DOCTOR) return personModel(i);
  const m = personModel(1, { shirt: 0xf4f6f8, pants: 0x8fd1c0, hat: 0x6ab8a8, badge: 0xff2a2a });
  m.grid.set(0, 3, 0, 0xf4f6f8);
  m.grid.set(0, 2, 1, 0x7a8a94);
  return m;
}

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
  // Brood Call hatchling: a little green kaiju.
  hatchling: () => {
    const g = new VoxelGrid(8, 5, 4);
    g.box(1, 1, 1, 6, 4, 3, 0x5aa84f);
    g.box(5, 2, 1, 8, 5, 3, 0x6fc25f);
    g.set(7, 4, 1, 0x111111);
    g.set(7, 4, 2, 0x111111);
    g.box(0, 2, 1, 1, 3, 3, 0x4a8c40);
    for (const x of [1, 4]) for (const z of [1, 2]) g.set(x, 0, z, 0x3c7a34);
    g.box(2, 4, 1, 5, 5, 3, 0xf2d24a);
    return simple(g, 0.4);
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

// ---------------------------------------------------------------- past the city
// The Galactic Federation and the Cosmic Guard out in space, and the back garden's defenders.
function fighter(hull, trim, glow) {
  const g = new VoxelGrid(14, 5, 13);
  g.box(2, 1, 5, 14, 3, 8, hull);
  g.box(10, 2, 5, 13, 4, 8, 0x6fe8ff, E);
  for (let x = 1; x < 10; x++) {
    const span = Math.floor((10 - x) * 0.6);
    g.box(x, 1, 6 - span, x + 1, 2, 7 + span, x % 3 ? hull : trim);
  }
  g.box(0, 1, 0, 3, 3, 1, trim);
  g.box(0, 1, 12, 3, 3, 13, trim);
  g.box(0, 3, 6, 3, 5, 7, trim);
  g.box(0, 1, 5, 1, 3, 8, glow, E);
  return g;
}
function saucer(n, v, rim) {
  const g = new VoxelGrid(n, 6, n);
  const c = n / 2;
  g.cylinder(c, c, c - 0.2, 1, 2, 0x8a939d);
  g.cylinder(c, c, c - 1.2, 2, 3, 0xb8c0ca);
  g.cylinder(c, c, c * 0.4, 3, 5, 0x9fe8ff, E);
  g.cylinder(c, c, c * 0.5, 0, 1, 0x5a626c);
  const steps = Math.round(n * 2.5);
  for (let i = 0; i < steps; i += 2) {
    const a = (i / steps) * Math.PI * 2;
    g.set(Math.floor(c + Math.cos(a) * (c - 0.8)), 1, Math.floor(c + Math.sin(a) * (c - 0.8)), rim[(i / 2) % rim.length], E);
  }
  return simple(g, v);
}

Object.assign(UNIT_MODELS, {
  interceptor: () => simple(fighter(0xe8ecf2, 0xd9362a, 0xff9a3c), 2.6),
  starjet: () => simple(fighter(0x3a3f5a, 0xffd23f, 0x6fe8ff), 2.6),
  frigate: () => {
    const g = new VoxelGrid(16, 6, 8);
    g.box(1, 1, 2, 14, 4, 6, 0xc8ccd4);
    g.box(3, 4, 3, 8, 6, 5, 0x8a939d);
    g.box(6, 5, 3, 8, 6, 5, 0x6fe8ff, E);
    g.box(14, 2, 3, 16, 3, 5, 0x5a626c);
    g.set(15, 2, 3, 0xff3b5a, E);
    g.set(15, 2, 4, 0xff3b5a, E);
    g.box(0, 1, 2, 1, 4, 6, 0x6fb8ff, E);
    g.box(2, 2, 0, 9, 3, 2, 0x8a939d);
    g.box(2, 2, 6, 9, 3, 8, 0x8a939d);
    return simple(g, 2);
  },
  cruiser: () => {
    const g = new VoxelGrid(20, 8, 12);
    g.box(0, 1, 2, 18, 5, 10, 0x5a6478);
    g.box(2, 5, 3, 12, 7, 9, 0x6a7488);
    g.box(10, 7, 5, 13, 8, 7, 0x9fe8ff, E);
    g.box(18, 2, 4, 20, 4, 8, 0x4a5262);
    for (let z = 3; z < 10; z += 2) g.set(0, 3, z, 0x6fb8ff, E);
    for (let x = 3; x < 17; x += 3) {
      g.set(x, 4, 2, 0xffe9a8, E);
      g.set(x, 4, 9, 0xffe9a8, E);
    }
    for (const z of [3, 8]) g.box(5, 7, z, 7, 8, z + 1, 0x3a4252);
    return simple(g, 2.2);
  },
  saucer: () => saucer(12, 2.3, [0xff3b5a, 0xffd23f, 0x6fe8ff, 0x8aff6a]),
  mothership: () => saucer(22, 2.8, [0xffd23f, 0xff8a3a, 0xff3b5a]),
  sentinel: () => {
    const g = new VoxelGrid(10, 14, 10);
    for (let y = 0; y < 14; y++) {
      const r = y < 8 ? (y / 8) * 4.6 : ((14 - y) / 6) * 4.6;
      g.cylinder(5, 5, Math.max(0.6, r), y, y + 1, (x, yy, z) => ((x + yy + z) % 4 === 0 ? 0xe8fbff : 0x8ae8ff));
    }
    g.box(7, 7, 4, 10, 9, 6, 0xff4dd2, E);
    g.cylinder(5, 5, 4.8, 13, 14, 0xffd23f, E, true);
    return simple(g, 2.6, 5, 5);
  },
  warden: () => {
    const g = new VoxelGrid(12, 12, 12);
    for (let y = 0; y < 12; y++) for (let z = 0; z < 12; z++) for (let x = 0; x < 12; x++) {
      const dx = x + 0.5 - 6;
      const dy = y + 0.5 - 6;
      const dz = z + 0.5 - 6;
      const d = Math.hypot(dx, dy, dz);
      if (d > 5.6) continue;
      const front = dx / (d || 1);
      g.set(x, y, z, front > 0.92 ? 0x0a0612 : front > 0.72 ? 0xb84dff : 0xf2eef6, front > 0.72 && front <= 0.92 ? E : 0);
    }
    g.cylinder(6, 6, 6, 5, 6, 0x6a5a9a, 0, true);
    return simple(g, 2.6, 6, 6);
  },
  soldier_ant: () => {
    const g = new VoxelGrid(8, 4, 5);
    g.box(0, 1, 1, 3, 3, 4, 0x6a1a14);
    g.box(3, 1, 2, 5, 3, 3, 0x7a2218);
    g.box(5, 1, 1, 7, 3, 4, 0x8a2a1a);
    g.set(7, 1, 1, 0x2a0a08);
    g.set(7, 1, 3, 0x2a0a08);
    g.set(6, 3, 1, 0x3a0e0a);
    g.set(6, 3, 3, 0x3a0e0a);
    for (const x of [2, 4, 5]) {
      g.set(x, 0, 0, 0x3a0e0a);
      g.set(x, 0, 4, 0x3a0e0a);
    }
    return simple(g, 0.8);
  },
  wasp: () => {
    const g = new VoxelGrid(7, 4, 6);
    g.box(0, 1, 2, 4, 3, 4, (x) => (x % 2 ? 0x1a1a1a : 0xf2c12e));
    g.box(4, 1, 2, 6, 3, 4, 0x2a2a2a);
    g.set(6, 2, 2, 0xf2c12e);
    g.set(6, 2, 3, 0xf2c12e);
    g.set(0, 1, 2, 0x1a1a1a);
    g.box(3, 3, 0, 5, 4, 2, 0xd8ecf6);
    g.box(3, 3, 4, 5, 4, 6, 0xd8ecf6);
    return simple(g, 0.85);
  },
  spider: () => {
    const g = new VoxelGrid(9, 4, 9);
    g.box(2, 1, 3, 6, 4, 6, 0x1a1a1e);
    g.box(6, 1, 3, 8, 3, 6, 0x2a2a30);
    g.set(8, 2, 3, 0xff3b3b, E);
    g.set(8, 2, 5, 0xff3b3b, E);
    g.box(3, 3, 4, 5, 4, 5, 0xd9362a);
    for (const x of [2, 4, 5, 7]) {
      g.box(x, 0, 0, x + 1, 2, 3, 0x1a1a1e);
      g.box(x, 0, 6, x + 1, 2, 9, 0x1a1a1e);
    }
    return simple(g, 0.95);
  },
  beetle: () => {
    const g = new VoxelGrid(10, 5, 8);
    g.box(0, 1, 1, 7, 4, 7, (x, y, z) => (z === 4 && y === 3 ? 0x0a2a2a : y === 3 ? 0x2a8a8a : 0x1a6a6a));
    g.box(7, 1, 2, 9, 3, 6, 0x1a3a3a);
    g.box(9, 2, 2, 10, 4, 3, 0x2a1a0a);
    g.box(9, 2, 5, 10, 4, 6, 0x2a1a0a);
    g.set(8, 3, 2, 0xd8ffd8, E);
    for (const x of [1, 3, 5]) {
      g.set(x, 0, 0, 0x0a1a1a);
      g.set(x, 0, 7, 0x0a1a1a);
    }
    return simple(g, 1.1);
  },
});

// Garden ants (and the odd ladybug) take the place of people in the back garden.
export const ANT_LOOKS = 3;
export function antModel(i) {
  const g = new VoxelGrid(5, 2, 3);
  if (i === 2) {
    g.box(0, 0, 0, 4, 2, 3, (x, y, z) => ((x + z) % 3 === 0 && y === 1 ? 0x1a1a1a : 0xd9202a));
    g.box(4, 0, 1, 5, 1, 2, 0x1a1a1a);
    return { grid: g, origin: { x: 2.5, z: 1.5 }, v: 0.8 };
  }
  const c = i === 1 ? 0x9a2a14 : 0x1a1a1e;
  g.box(0, 0, 1, 2, 2, 2, c);
  g.box(2, 0, 1, 3, 1, 2, c);
  g.box(3, 0, 1, 5, 2, 2, c);
  g.set(4, 1, 0, c);
  g.set(4, 1, 2, c);
  g.set(1, 0, 0, c);
  g.set(1, 0, 2, c);
  g.set(3, 0, 0, c);
  g.set(3, 0, 2, c);
  return { grid: g, origin: { x: 2.5, z: 1.5 }, v: 0.8 };
}

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

// ---------------------------------------------------------------- gate bosses
// One boss guards each size-up. Built from parts so they can walk and swing; front is +x.
export const GATE_BOSS_MODELS = {
  // Agent Kilowatt: a cyborg hitman in a trench coat, shades and one glowing red eye.
  kilowatt() {
    const coat = 0xb89a6a;
    const body = new VoxelGrid(4, 8, 6);
    body.box(0, 0, 0, 4, 8, 6, coat);
    body.box(3, 2, 2, 4, 8, 4, 0xf2f2f2);
    body.box(3, 3, 2, 4, 7, 3, 0xc0262c);
    body.box(0, 2, 0, 4, 3, 6, 0x5a4a32);
    const head = new VoxelGrid(4, 4, 4);
    head.box(0, 0, 0, 4, 4, 4, 0xd9a07a);
    head.box(0, 3, 0, 4, 4, 4, 0x1a1a1a);
    head.box(3, 2, 0, 4, 3, 4, 0x111111);
    head.set(3, 2, 1, 0xff2a2a, E);
    head.box(0, 0, 0, 2, 2, 1, 0x8c939c);
    const leg = () => {
      const g = new VoxelGrid(2, 6, 2);
      g.box(0, 1, 0, 2, 6, 2, 0x22252b);
      g.box(0, 0, 0, 3, 1, 2, 0x0d0d0d);
      return g;
    };
    const gunArm = new VoxelGrid(7, 2, 2);
    gunArm.box(0, 0, 0, 4, 2, 2, coat);
    gunArm.box(4, 0, 0, 7, 2, 2, 0x1a1a1a);
    gunArm.set(6, 1, 0, 0x59c3ff, E);
    const cyberArm = new VoxelGrid(5, 2, 2);
    cyberArm.box(0, 0, 0, 5, 2, 2, 0x8c939c);
    cyberArm.set(2, 1, 0, 0xff2a2a, E);
    return {
      radius: 3, height: 18,
      parts: [
        part('body', body, { x: 2, y: 0, z: 3 }, { x: 0, y: 6, z: 0 }),
        part('head', head, { x: 2, y: 0, z: 2 }, { x: 0, y: 8, z: 0 }, 'body'),
        part('legL', leg(), { x: 1, y: 6, z: 1 }, { x: 0, y: 0, z: -1.5 }, 'body', { swing: 1 }),
        part('legR', leg(), { x: 1, y: 6, z: 1 }, { x: 0, y: 0, z: 1.5 }, 'body', { swing: -1 }),
        part('armL', cyberArm, { x: 1, y: 1, z: 1 }, { x: 0, y: 6, z: -4 }, 'body', { arm: 1 }),
        part('armR', gunArm, { x: 1, y: 1, z: 1 }, { x: 0, y: 6, z: 4 }, 'body', { arm: -1 }),
      ],
    };
  },
  // KAREN-9000: HOA power armour, an asymmetric blonde bob and a clipboard.
  karen() {
    const shell = 0xe8dcc8;
    const pink = 0xe86aa0;
    const body = new VoxelGrid(7, 9, 9);
    body.box(0, 0, 0, 7, 9, 9, shell);
    body.box(0, 4, 0, 7, 5, 9, pink);
    body.box(6, 5, 3, 7, 8, 6, 0x6fd8ff, E);
    const head = new VoxelGrid(6, 6, 6);
    head.box(0, 0, 0, 6, 5, 6, shell);
    head.box(5, 1, 1, 6, 3, 5, 0x2a2a2a);
    head.box(0, 4, 0, 6, 6, 6, 0xf2d36b);
    head.box(0, 1, 0, 3, 6, 1, 0xf2d36b);
    head.box(0, 1, 5, 2, 4, 6, 0xf2d36b);
    head.box(5, 2, 1, 6, 3, 2, 0xff4a4a, E);
    const leg = () => {
      const g = new VoxelGrid(3, 7, 3);
      g.box(0, 1, 0, 3, 7, 3, shell);
      g.box(0, 0, 0, 4, 1, 3, pink);
      return g;
    };
    const clipArm = new VoxelGrid(8, 3, 3);
    clipArm.box(0, 0, 0, 5, 3, 3, shell);
    clipArm.box(5, -1, 0, 6, 5, 3, 0x8a5a2a);
    clipArm.box(5, 0, 0, 6, 4, 3, 0xf8f8f0);
    clipArm.set(5, 3, 1, 0x8a8a8a);
    const arm = new VoxelGrid(6, 3, 3);
    arm.box(0, 0, 0, 6, 3, 3, shell);
    arm.box(5, 0, 0, 6, 3, 3, pink);
    return {
      radius: 6, height: 24,
      parts: [
        part('body', body, { x: 3.5, y: 0, z: 4.5 }, { x: 0, y: 7, z: 0 }),
        part('head', head, { x: 3, y: 0, z: 3 }, { x: 0, y: 9, z: 0 }, 'body'),
        part('legL', leg(), { x: 1.5, y: 7, z: 1.5 }, { x: 0, y: 0, z: -2.5 }, 'body', { swing: 1 }),
        part('legR', leg(), { x: 1.5, y: 7, z: 1.5 }, { x: 0, y: 0, z: 2.5 }, 'body', { swing: -1 }),
        part('armL', clipArm, { x: 1, y: 1.5, z: 1.5 }, { x: 0, y: 7, z: -6 }, 'body', { arm: 1 }),
        part('armR', arm, { x: 1, y: 1.5, z: 1.5 }, { x: 0, y: 7, z: 6 }, 'body', { arm: -1 }),
      ],
    };
  },
  // Mr. Whippy: an armoured ice-cream truck with angry headlights and a giant cone on top.
  whippy() {
    const body = new VoxelGrid(16, 9, 8);
    body.box(0, 1, 0, 16, 9, 8, 0xf8f4ee);
    body.box(0, 3, 0, 16, 4, 8, 0xff8fc0);
    body.box(4, 4, 0, 10, 7, 1, 0x6fd8ff);
    body.box(4, 4, 7, 10, 7, 8, 0x6fd8ff);
    body.box(13, 5, 1, 16, 8, 7, 0x2a3a4a);
    body.box(13, 7, 1, 16, 8, 3, 0x1a1a1a);
    body.box(13, 7, 5, 16, 8, 7, 0x1a1a1a);
    body.set(15, 2, 1, 0xfff2a0, E);
    body.set(15, 2, 6, 0xfff2a0, E);
    for (const x of [2, 11]) for (const z of [0, 7]) body.box(x, 0, z, x + 3, 2, z + 1, 0x111111);
    const cone = new VoxelGrid(6, 10, 6);
    cone.box(2, 0, 2, 4, 4, 4, 0xd99a4a);
    cone.box(1, 4, 1, 5, 6, 5, 0xffd0e0);
    cone.box(1, 6, 1, 5, 8, 5, 0x8a5a3a);
    cone.box(2, 8, 2, 4, 10, 4, 0xf8f4ee);
    cone.set(3, 9, 3, 0xff3b6b, E);
    return {
      radius: 8, height: 20,
      parts: [
        part('body', body, { x: 8, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }),
        part('cone', cone, { x: 3, y: 0, z: 3 }, { x: -2, y: 9, z: 0 }, 'body', { spin: true }),
      ],
    };
  },
  // Wrecking Bill: a demolition crane in a hard hat with a wrecking ball on a boom.
  bill() {
    const yellow = 0xf2b134;
    const body = new VoxelGrid(12, 8, 10);
    body.box(0, 0, 0, 12, 2, 10, 0x2a2a2a);
    body.box(1, 2, 1, 11, 7, 9, yellow);
    body.box(8, 3, 2, 11, 6, 8, 0x6fd8ff);
    body.box(3, 7, 3, 8, 8, 7, 0xffd23f);
    body.box(9, 4, 3, 11, 5, 4, 0x1a1a1a);
    body.box(9, 4, 6, 11, 5, 7, 0x1a1a1a);
    const boom = new VoxelGrid(22, 2, 2);
    for (let x = 0; x < 22; x++) boom.box(x, 0, 0, x + 1, 2, 2, x % 3 ? yellow : 0x2a2a2a);
    const ball = new VoxelGrid(5, 8, 5);
    ball.box(2, 5, 2, 3, 8, 3, 0x5a5a5a);
    ball.box(0, 0, 0, 5, 5, 5, 0x3a3d42);
    ball.set(2, 4, 4, 0xffffff);
    return {
      radius: 10, height: 30,
      parts: [
        part('body', body, { x: 6, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }),
        part('boom', boom, { x: 0, y: 1, z: 1 }, { x: 2, y: 7, z: 0 }, 'body', { boom: true }),
        part('ball', ball, { x: 2.5, y: 8, z: 2.5 }, { x: 21, y: 0, z: 0 }, 'boom', { swingBall: true }),
      ],
    };
  },
  // The Mecha-Mayor: City Hall stood up and walked off, with a dome head and a moustache.
  mayor() {
    const stone = 0xe8e2d4;
    const body = new VoxelGrid(14, 16, 18);
    body.box(0, 0, 0, 14, 16, 18, stone);
    for (let z = 1; z < 18; z += 3) body.box(13, 1, z, 14, 13, z + 1, 0xfaf6ee);
    body.box(12, 13, 0, 14, 16, 18, 0xcfc8b8);
    body.box(13, 4, 7, 14, 9, 11, 0x5a3a2a);
    body.box(11, 2, 0, 12, 16, 3, 0xc0262c);
    body.box(11, 12, 3, 12, 14, 18, 0xc0262c);
    const head = new VoxelGrid(10, 10, 10);
    head.cylinder(5, 5, 4.6, 0, 6, 0x7fa89a);
    head.cylinder(5, 5, 3.4, 6, 9, 0x8fb8aa);
    head.box(4, 9, 4, 6, 10, 6, 0xffd23f, E);
    head.box(9, 3, 3, 10, 4, 4, 0xfff2a0, E);
    head.box(9, 3, 6, 10, 4, 7, 0xfff2a0, E);
    head.box(9, 1, 2, 10, 2, 8, 0x3a2414);
    head.box(9, 0, 1, 10, 1, 3, 0x3a2414);
    head.box(9, 0, 7, 10, 1, 9, 0x3a2414);
    const leg = () => {
      const g = new VoxelGrid(6, 14, 6);
      g.box(0, 2, 0, 6, 14, 6, 0xcfc8b8);
      g.box(-1, 0, -1, 7, 2, 7, 0x9a948a);
      return g;
    };
    const arm = (gavel) => {
      const g = new VoxelGrid(20, 5, 5);
      g.box(0, 0, 0, 14, 5, 5, stone);
      g.box(14, 1, 1, 18, 4, 4, 0xcfc8b8);
      if (gavel) {
        g.box(17, 0, 2, 18, 5, 3, 0x6a4a2a);
        g.box(18, -2, 0, 20, 7, 5, 0x8a5a3a);
      }
      return g;
    };
    return {
      radius: 14, height: 46,
      parts: [
        part('body', body, { x: 7, y: 0, z: 9 }, { x: 0, y: 14, z: 0 }),
        part('head', head, { x: 5, y: 0, z: 5 }, { x: 0, y: 16, z: 0 }, 'body'),
        part('legL', leg(), { x: 3, y: 14, z: 3 }, { x: 0, y: 0, z: -5 }, 'body', { swing: 1 }),
        part('legR', leg(), { x: 3, y: 14, z: 3 }, { x: 0, y: 0, z: 5 }, 'body', { swing: -1 }),
        part('armL', arm(true), { x: 2, y: 2.5, z: 2.5 }, { x: 0, y: 12, z: -11 }, 'body', { arm: 1 }),
        part('armR', arm(false), { x: 2, y: 2.5, z: 2.5 }, { x: 0, y: 12, z: 11 }, 'body', { arm: -1 }),
      ],
    };
  },
};

// Recolours a grid's voxels in place: fn(colour, flags) -> [colour, flags].
function recolor(g, fn) {
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i];
    if (!v) continue;
    const [c, f] = fn(v & 0xffffff, v >>> 24, i);
    g.data[i] = ((c || 0x010101) | (f << 24)) >>> 0;
  }
}

// Gate bosses past the city: out in space, then in the back garden.
Object.assign(GATE_BOSS_MODELS, {
  // Nebulor: the other kaiju. Rex's build, grown up somewhere else: a starry violet hide, glowing
  // crystal spines down its back, three horns and white-hot eyes.
  nebulor() {
    const m = rex();
    const hide = [0x3a2a6a, 0x34245e, 0x2c1e52];
    for (const p of m.parts) {
      recolor(p.grid, (c, f, i) => {
        if (c === 0xffe14a) return [0xfff0ff, E]; // eyes
        if (c === 0xe8c64a) return [0x6ff0ff, E]; // back plates
        if (c === 0xf6f2e6 || c === 0x111111) return [c, f]; // teeth, pupils
        if (c === 0xd2e08f) return [0x8a6ad8, 0]; // belly
        if (c === 0x2f6b2a) return [0x1a1030, 0]; // dark stripes
        const h = hash3(i, 7, 3);
        return h < 0.035 ? [0xfff2c8, E] : [hide[Math.floor(h * 3)], 0];
      });
    }
    const horns = new VoxelGrid(5, 4, 7);
    for (const z of [1, 3, 5]) {
      horns.box(1, 0, z, 2, 2, z + 1, 0xd8c8ff);
      horns.set(z === 3 ? 0 : 1, 2, z, 0xff8ae8, E);
    }
    horns.set(0, 3, 3, 0xff8ae8, E);
    const spines = new VoxelGrid(10, 4, 3);
    for (let x = 0; x < 10; x += 2) {
      const h = 2 + (x % 4 === 0 ? 2 : 1);
      spines.box(x, 0, 1, x + 1, h, 2, 0x6ff0ff, E);
      spines.set(x, 0, 0, 0xb8f8ff, E);
      spines.set(x, 0, 2, 0xb8f8ff, E);
    }
    m.parts.push(part('horns', horns, { x: 2, y: 0, z: 3.5 }, { x: 0, y: 3.5, z: 0 }, 'head'));
    m.parts.push(part('spines', spines, { x: 5, y: 0, z: 1.5 }, { x: -1, y: 4.5, z: 0 }, 'body'));
    return m;
  },
  // Admiral Zorblax: a big-headed green alien admiral in a white uniform and a purple cape.
  zorblax() {
    const suit = 0xf2f2f6;
    const body = new VoxelGrid(4, 8, 6);
    body.box(0, 0, 0, 4, 8, 6, suit);
    body.box(3, 5, 1, 4, 7, 2, 0xffd23f, E);
    body.box(3, 2, 0, 4, 3, 6, 0x3a2a6a);
    body.box(0, 0, 0, 1, 8, 6, 0x7a3ac8);
    const head = new VoxelGrid(6, 8, 6);
    head.box(0, 0, 1, 6, 6, 5, 0x7ad86a);
    head.box(1, 1, 0, 5, 5, 6, 0x7ad86a);
    head.box(5, 2, 1, 6, 4, 2, 0x0a0a12);
    head.box(5, 2, 4, 6, 4, 5, 0x0a0a12);
    head.box(0, 5, 2, 4, 7, 4, 0x2a2a5a);
    head.set(2, 7, 2, 0xffd23f, E);
    const leg = () => {
      const g = new VoxelGrid(2, 6, 2);
      g.box(0, 1, 0, 2, 6, 2, 0x2a2a5a);
      g.box(0, 0, 0, 3, 1, 2, 0x1a1a1a);
      return g;
    };
    const gun = new VoxelGrid(8, 2, 2);
    gun.box(0, 0, 0, 4, 2, 2, suit);
    gun.box(4, 0, 0, 8, 2, 2, 0x5a626c);
    gun.set(7, 1, 0, 0x6fe8ff, E);
    const arm = new VoxelGrid(5, 2, 2);
    arm.box(0, 0, 0, 4, 2, 2, suit);
    arm.box(4, 0, 0, 5, 2, 2, 0x7ad86a);
    return {
      radius: 3, height: 20,
      parts: [
        part('body', body, { x: 2, y: 0, z: 3 }, { x: 0, y: 6, z: 0 }),
        part('head', head, { x: 3, y: 0, z: 3 }, { x: 0, y: 8, z: 0 }, 'body'),
        part('legL', leg(), { x: 1, y: 6, z: 1 }, { x: 0, y: 0, z: -1.5 }, 'body', { swing: 1 }),
        part('legR', leg(), { x: 1, y: 6, z: 1 }, { x: 0, y: 0, z: 1.5 }, 'body', { swing: -1 }),
        part('armL', arm, { x: 1, y: 1, z: 1 }, { x: 0, y: 6, z: -4 }, 'body', { arm: 1 }),
        part('armR', gun, { x: 1, y: 1, z: 1 }, { x: 0, y: 6, z: 4 }, 'body', { arm: -1 }),
      ],
    };
  },
  // That's No Moon: a grey battle station with a trench round its middle and a big green dish.
  nomoon() {
    const g = new VoxelGrid(20, 20, 20);
    for (let y = 0; y < 20; y++) for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++) {
      const dx = x + 0.5 - 10;
      const dy = y + 0.5 - 10;
      const dz = z + 0.5 - 10;
      const d = Math.hypot(dx, dy, dz);
      if (d > 9.8) continue;
      if (Math.abs(dy) < 0.8 && d > 8.6) continue;
      const dish = Math.hypot(dy - 3.5, dz) < 3.2 && dx > 7.2;
      let c = hash3(x >> 1, y >> 1, z >> 1) < 0.3 ? 0x8a8f98 : 0xa8adb6;
      if (dish) c = Math.hypot(dy - 3.5, dz) < 1.2 ? 0x8aff6a : 0x5a626c;
      g.set(x, y, z, c, dish && Math.hypot(dy - 3.5, dz) < 1.2 ? E : 0);
      if (!dish && d > 9 && hash3(x, y, z) < 0.04) g.set(x, y, z, 0xffe9a8, E);
    }
    return { radius: 10, height: 20, parts: [part('body', g, { x: 10, y: 0, z: 10 }, { x: 0, y: 2, z: 0 })] };
  },
  // The Ant Queen: a long red-black ant with a golden crown and folded wings.
  queen() {
    const shell = 0x7a1a14;
    const body = new VoxelGrid(16, 6, 8);
    body.box(0, 1, 1, 7, 6, 7, (x, y) => (y % 2 ? shell : 0x5a1210));
    body.box(7, 2, 2, 11, 5, 6, 0x8a2218);
    body.box(1, 5, 0, 9, 6, 2, 0xe0f0ff);
    body.box(1, 5, 6, 9, 6, 8, 0xe0f0ff);
    const head = new VoxelGrid(6, 6, 6);
    head.box(0, 0, 1, 5, 4, 5, 0x9a2a1a);
    head.box(5, 0, 0, 6, 1, 2, 0x2a0a08);
    head.box(5, 0, 4, 6, 1, 6, 0x2a0a08);
    head.set(4, 2, 1, 0xffd23f, E);
    head.set(4, 2, 4, 0xffd23f, E);
    head.box(1, 4, 1, 4, 5, 5, 0xffd23f);
    for (const [x, z] of [[1, 1], [3, 1], [1, 4], [3, 4], [2, 2]]) head.set(x, 5, z, 0xffd23f, E);
    const legs = () => {
      const g = new VoxelGrid(8, 5, 2);
      for (const x of [0, 3, 6]) g.box(x, 0, 0, x + 1, 5, 2, 0x2a0a08);
      g.box(0, 4, 0, 7, 5, 2, 0x2a0a08);
      return g;
    };
    return {
      radius: 8, height: 14,
      parts: [
        part('body', body, { x: 9, y: 0, z: 4 }, { x: 0, y: 3, z: 0 }),
        part('head', head, { x: 1, y: 0, z: 3 }, { x: 2, y: 2, z: 0 }, 'body'),
        part('legL', legs(), { x: 4, y: 5, z: 1 }, { x: 0, y: 2, z: -5 }, 'body', { swing: 1 }),
        part('legR', legs(), { x: 4, y: 5, z: 1 }, { x: 0, y: 2, z: 5 }, 'body', { swing: -1 }),
      ],
    };
  },
  // The Lawnmower: a red push mower with a spinning blade, a grass bag and a long handle.
  mower() {
    const red = 0xd9362a;
    // The deck runs from x = 6 to 20, the grass bag hangs off the back (x 0 to 6).
    const body = new VoxelGrid(20, 9, 14);
    body.box(6, 1, 1, 20, 4, 13, red);
    body.box(7, 4, 3, 17, 5, 11, shade(red, 0.85));
    body.box(10, 5, 5, 15, 8, 9, 0x3a3a3a);
    body.box(11, 8, 6, 14, 9, 8, 0x5a5a5a);
    body.set(19, 3, 4, 0xfff6a8, E);
    body.set(19, 3, 9, 0xfff6a8, E);
    for (const x of [7, 16]) for (const z of [0, 13]) body.box(x, 0, z, x + 3, 3, z + 1, 0x1a1a1a);
    body.box(0, 2, 4, 6, 7, 10, (x, y, z) => ((x + y + z) % 3 ? 0x4a8a3a : 0x5a9a4a));
    const handle = new VoxelGrid(12, 12, 10);
    // Rises up and back from the rear of the deck to a crossbar with a grip.
    for (let i = 0; i < 11; i++) {
      handle.set(10 - i, i, 0, 0x2a2a2a);
      handle.set(10 - i, i, 9, 0x2a2a2a);
    }
    handle.box(0, 10, 0, 1, 11, 10, 0x2a2a2a);
    handle.box(0, 10, 3, 1, 11, 7, 0x1a1a1a);
    const blade = new VoxelGrid(13, 1, 13);
    blade.box(0, 0, 6, 13, 1, 7, 0xd8dce0);
    blade.box(6, 0, 0, 7, 1, 13, 0xd8dce0);
    return {
      radius: 7, height: 16,
      parts: [
        part('body', body, { x: 13, y: 0, z: 7 }, { x: 0, y: 1, z: 0 }),
        part('handle', handle, { x: 10, y: 0, z: 5 }, { x: -7, y: 4, z: 0 }, 'body'),
        part('blade', blade, { x: 6.5, y: 0, z: 6.5 }, { x: 0, y: 0.5, z: 0 }, 'body', { blade: true }),
      ],
    };
  },
});

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
