// Turns a VoxelGrid into indexed triangle data: hidden faces culled, per-vertex ambient
// occlusion, slight per-voxel colour jitter, and a flags attribute for emissive/window
// voxels. Also pre-fractures grids into chunks for destruction. Pure (no three.js).
import { hash3 } from './voxel.js';

// For each face: normal, the 4 corners (unit cube), and the two in-plane axes for AO.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: 2, v: 1 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: 2, v: 1 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: 0, v: 2 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 0, v: 2 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: 0, v: 1 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: 0, v: 1 },
];
const AO = [0.52, 0.7, 0.85, 1];
// Precompute, per face corner, the three neighbour offsets that darken it.
for (const f of FACES) {
  f.ao = f.c.map((c) => {
    const du = c[f.u] ? 1 : -1;
    const dv = c[f.v] ? 1 : -1;
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const d = [0, 0, 0];
    a[f.u] = du;
    b[f.v] = dv;
    d[f.u] = du;
    d[f.v] = dv;
    return [...a, ...b, ...d];
  });
}

// opts: { v: voxel size, ox, oy, oz: origin in voxel units, removed: Uint8Array mask by
// voxel index (1 = gone), jitter: colour noise amount }
export function meshGrid(grid, opts = {}) {
  const { nx, ny, nz, data } = grid;
  const v = opts.v ?? 1;
  const ox = opts.ox ?? 0;
  const oy = opts.oy ?? 0;
  const oz = opts.oz ?? 0;
  const removed = opts.removed || null;
  const jitter = opts.jitter ?? 0.06;
  // Padded occupancy grid: neighbour lookups become plain index offsets.
  const px = nx + 2;
  const pz = nz + 2;
  const plane = px * pz;
  const occ = new Uint8Array(px * (ny + 2) * pz);
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      let i = (y * nz + z) * nx;
      let o = (y + 1) * plane + (z + 1) * px + 1;
      for (let x = 0; x < nx; x++, i++, o++) if (data[i] !== 0 && !(removed && removed[i])) occ[o] = 1;
    }
  const off = (d) => d[1] * plane + d[2] * px + d[0];
  for (const f of FACES) {
    f.no = off(f.n);
    f.aoo = f.ao.map((q) => [off([q[0], q[1], q[2]]), off([q[3], q[4], q[5]]), off([q[6], q[7], q[8]])]);
  }

  let faces = 0;
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      let o = (y + 1) * plane + (z + 1) * px + 1;
      for (let x = 0; x < nx; x++, o++) {
        if (!occ[o]) continue;
        for (let k = 0; k < 6; k++) if (!occ[o + FACES[k].no]) faces++;
      }
    }

  const vcount = faces * 4;
  const positions = new Float32Array(vcount * 3);
  const normals = new Int8Array(vcount * 3);
  const colors = new Uint8Array(vcount * 3);
  const flags = new Uint8Array(vcount);
  const indices = vcount > 65535 ? new Uint32Array(faces * 6) : new Uint16Array(faces * 6);
  const ao = [0, 0, 0, 0];
  let vi = 0;
  let ii = 0;
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      let o = (y + 1) * plane + (z + 1) * px + 1;
      for (let x = 0; x < nx; x++, o++) {
        if (!occ[o]) continue;
        const val = data[(y * nz + z) * nx + x];
        const flag = val >>> 24;
        let j = 1;
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const no = o + f.no;
          if (occ[no]) continue;
          if (j === 1) j = 1 + (hash3(x, y, z) - 0.5) * 2 * jitter + 1e-9;
          const r0 = ((val >> 16) & 255) * j;
          const g0 = ((val >> 8) & 255) * j;
          const b0 = (val & 255) * j;
          for (let k = 0; k < 4; k++) {
            const c = f.c[k];
            const q = f.aoo[k];
            const s1 = occ[no + q[0]];
            const s2 = occ[no + q[1]];
            const s3 = occ[no + q[2]];
            ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            const p3 = (vi + k) * 3;
            positions[p3] = (x + c[0] - ox) * v;
            positions[p3 + 1] = (y + c[1] - oy) * v;
            positions[p3 + 2] = (z + c[2] - oz) * v;
            normals[p3] = f.n[0] * 127;
            normals[p3 + 1] = f.n[1] * 127;
            normals[p3 + 2] = f.n[2] * 127;
            const sh = flag & 1 ? 1 : AO[ao[k]];
            colors[p3] = Math.min(255, r0 * sh);
            colors[p3 + 1] = Math.min(255, g0 * sh);
            colors[p3 + 2] = Math.min(255, b0 * sh);
            flags[vi + k] = flag;
          }
          // Flip the quad diagonal so AO interpolates without a visible seam.
          if (ao[0] + ao[2] > ao[1] + ao[3]) {
            indices[ii++] = vi;
            indices[ii++] = vi + 1;
            indices[ii++] = vi + 2;
            indices[ii++] = vi;
            indices[ii++] = vi + 2;
            indices[ii++] = vi + 3;
          } else {
            indices[ii++] = vi + 1;
            indices[ii++] = vi + 2;
            indices[ii++] = vi + 3;
            indices[ii++] = vi + 1;
            indices[ii++] = vi + 3;
            indices[ii++] = vi;
          }
          vi += 4;
        }
      }
    }
  return { positions, normals, colors, flags, indices, faces };
}

// Pre-fracture: Voronoi chunks seeded on a jittered lattice (spacing in voxels).
export function fracture(grid, spacing = 4) {
  const { nx, ny, nz, data } = grid;
  const s = spacing;
  const cx = Math.ceil(nx / s);
  const cy = Math.ceil(ny / s);
  const cz = Math.ceil(nz / s);
  const seed = (i, j, k) => [
    (i + 0.2 + 0.6 * hash3(i, j, k)) * s,
    (j + 0.2 + 0.6 * hash3(j, k, i + 17)) * s,
    (k + 0.2 + 0.6 * hash3(k, i, j + 31)) * s,
  ];
  const chunkOf = new Int32Array(nx * ny * nz).fill(-1);
  const ids = new Map();
  const chunks = [];
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const idx = (y * nz + z) * nx + x;
        const val = data[idx];
        if (!val) continue;
        const li = Math.floor(x / s);
        const lj = Math.floor(y / s);
        const lk = Math.floor(z / s);
        let best = 0;
        let bestD = Infinity;
        for (let dj = -1; dj <= 1; dj++)
          for (let dk = -1; dk <= 1; dk++)
            for (let di = -1; di <= 1; di++) {
              const i = li + di;
              const j = lj + dj;
              const k = lk + dk;
              if (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) continue;
              const sp = seed(i, j, k);
              const d = (x + 0.5 - sp[0]) ** 2 + ((y + 0.5 - sp[1]) * 1.2) ** 2 + (z + 0.5 - sp[2]) ** 2;
              if (d < bestD) {
                bestD = d;
                best = (j * cz + k) * cx + i;
              }
            }
        let id = ids.get(best);
        if (id === undefined) {
          id = chunks.length;
          ids.set(best, id);
          chunks.push({ voxels: [], sx: 0, sy: 0, sz: 0, min: [x, y, z], max: [x, y, z], colors: new Map(), emissive: 0 });
        }
        chunkOf[idx] = id;
        const ch = chunks[id];
        ch.voxels.push(idx);
        ch.sx += x;
        ch.sy += y;
        ch.sz += z;
        if (x < ch.min[0]) ch.min[0] = x;
        if (y < ch.min[1]) ch.min[1] = y;
        if (z < ch.min[2]) ch.min[2] = z;
        if (x > ch.max[0]) ch.max[0] = x;
        if (y > ch.max[1]) ch.max[1] = y;
        if (z > ch.max[2]) ch.max[2] = z;
        const col = val & 0xffffff;
        ch.colors.set(col, (ch.colors.get(col) || 0) + 1);
        if (val >>> 24) ch.emissive++;
      }
  for (const ch of chunks) {
    const n = ch.voxels.length;
    ch.cx = ch.sx / n + 0.5;
    ch.cy = ch.sy / n + 0.5;
    ch.cz = ch.sz / n + 0.5;
    let best = 0;
    let bestN = -1;
    // The colour a broken chunk shows is its most common surface colour (ignores dark interior).
    for (const [c, k] of ch.colors) {
      const lum = ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
      const weight = lum < 120 ? k * 0.3 : k;
      if (weight > bestN) {
        bestN = weight;
        best = c;
      }
    }
    ch.color = best;
    ch.glow = ch.emissive > n * 0.3;
    ch.size = [ch.max[0] - ch.min[0] + 1, ch.max[1] - ch.min[1] + 1, ch.max[2] - ch.min[2] + 1];
    delete ch.colors;
  }
  return { chunkOf, chunks };
}
