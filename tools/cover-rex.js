// The rex the store art is built around: a closer, more detailed voxel build of the game's kaiju
// than the in-game model. Shared by tools/cover-art.html (the 3D video frames) and
// tools/cover-pixel.html (the pixel-art covers).
import { VoxelGrid, E, shade, hash3 } from '../src/voxel.js';

// A closer, more detailed voxel build of the game's rex: the same green hide, darker back, pale
// belly and jaw, glowing yellow eyes and white teeth. Facing +x in its own grids.
export const G = 0x5aa84f;
export const D = 0x2f6b2a;
export const B = 0xd2e08f;
export const TOOTH = 0xfaf6ea;
export const GUM = 0xb8344a;
export const MOUTH = 0x5a1424;
const skin = (x, y, z) => (hash3(x, y, z) < 0.16 ? shade(G, 0.86) : hash3(z, x, y) < 0.08 ? shade(G, 1.1) : G);

// Boxy like the in-game rex (flat faces read cleanly at any size): a deep skull, a stepped-in
// snout, a brow over each glowing eye, rows of teeth and spikes down the back.
export function upperHead() {
  const L = 48;
  const g = new VoxelGrid(L, 30, 30);
  const cz = 15;
  const y0 = 6; // jaw line
  const hw = (x) => (x < 20 ? 13 : x < 34 ? 11 : 9);
  const hh = (x) => (x < 3 ? 17 : x < 20 ? 20 : x < 34 ? 15 : 12);
  for (let x = 0; x < L; x++) {
    const w = hw(x);
    const h = hh(x);
    for (let y = y0; y <= y0 + h; y++) for (let z = cz - w; z < cz + w; z++) {
      const edgeZ = Math.min(z - (cz - w), cz + w - 1 - z);
      const edgeY = y0 + h - y;
      if (edgeZ + edgeY < 2) continue; // bevelled top edges
      if (x === L - 1 && (edgeZ < 1 || edgeY < 1)) continue;
      let c = skin(x, y, z);
      if (edgeY < 3) c = hash3(x, y, z) < 0.2 ? shade(D, 1.15) : D;
      else if (y <= y0 + 1) c = B;
      if (y === y0 && edgeZ > 1) c = x % 3 === 0 ? GUM : MOUTH; // the palate
      g.set(x, y, z, c);
    }
  }
  // Teeth along both rims, fangs at the front.
  for (let x = 14; x < L - 1; x += 3) {
    const fang = x > L - 10 && x < L - 3;
    for (const zz of [cz - hw(x) + 1, cz + hw(x) - 2]) {
      const len = fang ? 6 : 4;
      for (let k = 1; k <= len; k++) {
        g.set(x, y0 - k, zz, TOOTH);
        if (k < len - 1) g.set(x + 1, y0 - k, zz, TOOTH);
      }
    }
  }
  // Eyes: glowing yellow with a black slit, under a heavy brow that slopes down to the snout.
  const ex = 26;
  for (const [zs, out] of [[cz - hw(ex), -1], [cz + hw(ex) - 1, 1]]) {
    const ey = y0 + 8;
    for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy < 5; dy++) {
      if ((dx === -4 || dx === 4) && (dy === 0 || dy === 4)) continue;
      const pupil = dx === 1 || (dx === 2 && dy > 0 && dy < 4);
      g.set(ex + dx, ey + dy, zs, pupil ? 0x1a0a00 : dy === 4 ? 0xfff6a0 : 0xffd23a, pupil ? 0 : E);
    }
    // An angry brow: thick, low over the eye, sloping down toward the snout.
    for (let dx = -6; dx <= 6; dx++) {
      const by = ey + 5 + (dx < -2 ? 1 : 0) + (dx < -4 ? 1 : 0) - (dx > 3 ? 1 : 0);
      for (const o of [0, out, 2 * out]) g.set(ex + dx, by, zs + o, D);
      g.set(ex + dx, by + 1, zs, D);
    }
  }
  for (const zz of [cz - 4, cz + 3]) g.set(L - 2, y0 + hh(L - 2), zz, 0x1a2a14);
  // Spikes down the back of the skull.
  for (let x = 1; x < 18; x += 5) {
    const base = y0 + hh(x) + 1;
    for (let k = 0; k < 6; k++) g.box(x, base + k, cz - 1, x + Math.max(1, 4 - k), base + k + 1, cz + 1, k >= 4 ? 0xe8c64a : D);
  }
  return { g, pivot: { x: 4, y: y0, z: cz } };
}

export function lowerJaw() {
  const L = 42;
  const g = new VoxelGrid(L, 14, 26);
  const cz = 13;
  const hw = (x) => (x < 16 ? 11 : x < 30 ? 10 : 8);
  for (let x = 0; x < L; x++) {
    const w = hw(x);
    for (let y = 1; y < 9; y++) for (let z = cz - w; z < cz + w; z++) {
      const edgeZ = Math.min(z - (cz - w), cz + w - 1 - z);
      if (edgeZ + (y - 1) < 2) continue;
      let c = y < 5 ? B : skin(x, y, z);
      if (y === 8 && edgeZ > 1) c = edgeZ > 3 ? 0xd85a72 : GUM; // tongue, gums
      g.set(x, y, z, c);
    }
  }
  for (let x = 10; x < L - 1; x += 3) {
    const fang = x > L - 9;
    for (const zz of [cz - hw(x) + 1, cz + hw(x) - 2]) for (let k = 0; k < (fang ? 5 : 3); k++) g.set(x, 9 + k, zz, TOOTH);
  }
  return { g, pivot: { x: 2, y: 8, z: cz } };
}

export function neck() {
  // Thickening toward the shoulders as it runs back from the head (x = L - 1) and down.
  const L = 110;
  const g = new VoxelGrid(L, 64, 44);
  const cy = 30;
  const cz = 22;
  for (let x = 0; x < L; x++) {
    const t = (L - 1 - x) / (L - 1);
    const hwid = Math.round(12 + t * 9);
    const half = Math.round(15 + t * 12);
    for (let y = cy - half; y < cy + half; y++) for (let z = cz - hwid; z < cz + hwid; z++) {
      const edgeZ = Math.min(z - (cz - hwid), cz + hwid - 1 - z);
      const edgeY = Math.min(y - (cy - half), cy + half - 1 - y);
      if (edgeZ + edgeY < 3) continue;
      g.set(x, y, z, y < cy - half * 0.55 ? B : y > cy + half * 0.75 ? D : skin(x, y, z));
    }
    if (x % 6 === 3) for (let k = 0; k < 7; k++) g.box(x, cy + half - 1 + k, cz - 1, x + Math.max(1, 4 - k), cy + half + k, cz + 1, k >= 5 ? 0xe8c64a : D);
  }
  return { g, pivot: { x: L - 1, y: cy, z: cz } };
}

// A forearm and three hooked claws, gripping the tower lower down.
export function claw() {
  const g = new VoxelGrid(30, 18, 16);
  for (let x = 0; x < 22; x++) for (let y = 0; y < 18; y++) for (let z = 0; z < 16; z++) {
    if (Math.hypot((y - 9) / 7, (z - 8) / 6.5) > 1) continue;
    g.set(x, y, z, y < 6 ? B : skin(x, y, z));
  }
  for (const zc of [3, 8, 13]) {
    for (let k = 0; k < 8; k++) g.box(22 + k, 9 - Math.floor(k * k / 8), zc - 1, 23 + k, 12 - Math.floor(k * k / 8), zc + 1, k < 5 ? skin(k, 0, zc) : TOOTH);
  }
  return g;
}

