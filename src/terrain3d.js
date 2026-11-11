/* global THREE */
// Ground for an endless world. Each tile covers one cell (2x2 or 4x4 cells once the kaiju is
// huge) and is painted onto a canvas at a resolution that follows the kaiju's size: very fine
// for the hatchling, coarse for the Apex, so the painted area stays cheap at every scale.
// The shader then lays the painting out in voxels, as if the ground were built from the same
// blocks as everything standing on it: each voxel takes the colour at its centre, with the
// models' small per-voxel colour jitter, and grass in patches of a few shades. The voxels are
// about the size of the blocks of the things that matter at each size (the props for the
// hatchling, the houses for the Brute, the towers for the Colossus), and blend back into the
// smooth painting where they would be under two pixels across. Water planes take a small field
// texture that the shader cuts out voxel by voxel too, with a ring of foam along the shore.
import { WORLD } from './config.js';
import { waterField } from './world.js';
import { shade } from './voxel.js';

const CELL = WORLD.cell;
const RW = WORLD.road;
// Ground detail per stage: world units per texel, cells per tile, and the ground's voxel size
// (props are built from 1-1.8 unit voxels, houses 2.5, towers 3-4; each size divides a cell,
// so voxels never straddle two tiles).
const LOD = [null,
  { upx: 0.41, ts: 1, vox: 1.5 },
  { upx: 0.82, ts: 1, vox: 2.5 },
  { upx: 1.64, ts: 1, vox: 3 },
  { upx: 3.3, ts: 1, vox: 4 },
  { upx: 3.3, ts: 2, vox: 6 },
  { upx: 6.5, ts: 4, vox: 10 },
];
const GLOW_UPX = 6.5;
const STYLE_COLOR = {
  forest: '#3a6232', park: '#5f9a44', suburb: '#6c9c4c', neon: '#34373f', brick: '#6e665e', garden: '#99968c', pastel: '#cdb79a', docks: '#7d7870', water: '#6c9a4c',
  farm: '#86a246', desert: '#dcc28c', snow: '#e8eef4', lantern: '#7a5e58', fair: '#8fb04a',
};
const SOFT = new Set(['forest', 'park', 'suburb', 'water', 'farm', 'desert', 'snow', 'fair']);
// Crop fields: ground colour and row colour (wheat, cabbages, ploughed soil, sunflowers).
const CROPS = [['#d8b84a', '#b8962e'], ['#4f8a3a', '#7cbc52'], ['#7a5a3a', '#5e4228'], ['#5f9a3a', '#ffd23f']];
const POOL_NEON = [0xff2bd6, 0x22e6ff, 0x7b5cff, 0xffd23f];

const pow2 = (v) => 2 ** Math.round(Math.log2(v));

function shadeHex(hexStr, f) {
  const s = shade(parseInt(hexStr.slice(1), 16), f);
  return `#${s.toString(16).padStart(6, '0')}`;
}

function cheap(a, b, s) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const GRAIN_GLSL = `
  float gHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
  float gNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // How blocky to draw here: 1 where a ground voxel is a few pixels across, 0 where it would
  // be under two (there the voxels would only shimmer, so the smooth painting shows instead).
  float voxSnap(vec2 wpos, float vox) {
    float wpp = max(fwidth(wpos.x), fwidth(wpos.y));
    return smoothstep(1.6, 3.2, vox / max(wpp, 1e-4));
  }
  // The tile's uv at the centre of the voxel this fragment is in (uv runs east and north).
  vec2 voxUv(vec2 uv, vec2 wpos, float vox, float tile) {
    vec2 cc = (floor(wpos / vox) + 0.5) * vox;
    return uv + vec2(cc.x - wpos.x, wpos.y - cc.y) / tile;
  }`;

export class Terrain {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.tiles = new Map();
    this.world = null;
    this.uVox = { value: 1.5 };
    this.night = 0;
    this.waterColor = new THREE.Color(0x3a8ac0);
    // Water materials are reused, never disposed: freeing the last one would throw its shader
    // away, and the next lake to stream in would compile it again mid-game.
    this.waterPool = [];
    // Wave normal map shared by every water tile (420 / 140: tiles seamlessly).
    const n = 256;
    const nc = document.createElement('canvas');
    nc.width = nc.height = n;
    const nx = nc.getContext('2d');
    const nimg = nx.createImageData(n, n);
    const hgt = (x, y) => Math.sin(x * 0.098) * 0.5 + Math.sin(y * 0.073 + x * 0.03) * 0.6 + Math.sin((x + y) * 0.21) * 0.25 + Math.sin((x - y * 0.6) * 0.147) * 0.3;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      nimg.data[i] = 128 + (hgt(x + 1, y) - hgt(x - 1, y)) * 60;
      nimg.data[i + 1] = 128 + (hgt(x, y + 1) - hgt(x, y - 1)) * 60;
      nimg.data[i + 2] = 255;
      nimg.data[i + 3] = 255;
    }
    nx.putImageData(nimg, 0, 0);
    this.waterNormal = new THREE.CanvasTexture(nc);
    this.waterNormal.wrapS = this.waterNormal.wrapT = THREE.RepeatWrapping;
    this.waterNormal.repeat.set(CELL / 140, CELL / 140);
    // Plain ground under everything, so a tile still being painted never shows the sky.
    this.under = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a8a44, polygonOffset: true, polygonOffsetFactor: 8, polygonOffsetUnits: 16 }));
    this.under.position.y = -0.6;
    this.under.receiveShadow = true;
    scene.add(this.under);
  }

  attach(world) {
    if (this.world === world) return;
    this.clear();
    this.world = world;
  }

  clear() {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
  }

  disposeTile(t) {
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
    t.mesh.material.dispose();
    t.map.dispose();
    t.glow.dispose();
    if (t.water) {
      this.scene.remove(t.water);
      t.water.geometry.dispose();
      this.waterPool.push(t.water.material);
      t.field.dispose();
    }
  }

  // ---------------------------------------------------------------- per frame
  update(stage, tx, tz, span, night, waterColor, t, budget = 5) {
    if (!this.world) return;
    const lod = LOD[stage];
    this.uVox.value = lod.vox;
    this.night = night;
    this.waterColor.copy(waterColor);
    this.waterNormal.offset.set(t * 0.01, t * 0.006);
    // Kept well below the tiles at every zoom, so it never wins the depth test against them.
    this.under.position.set(tx, -Math.max(0.6, span * 0.012), tz);
    this.under.scale.set(span * 14, 1, span * 14);
    for (const tile of this.tiles.values()) {
      tile.mesh.material.emissiveIntensity = night * 0.75;
      if (tile.water) tile.water.material.color.copy(waterColor);
    }
    const ts = lod.ts;
    const size = ts * CELL;
    const R = span * 1.45 + 260;
    const res = Math.min(1024, pow2(size / lod.upx));
    const want = [];
    const t0x = Math.floor((tx - R) / size);
    const t1x = Math.floor((tx + R) / size);
    const t0z = Math.floor((tz - R) / size);
    const t1z = Math.floor((tz + R) / size);
    for (let j = t0z; j <= t1z; j++) {
      for (let i = t0x; i <= t1x; i++) {
        const cx = (i + 0.5) * size;
        const cz = (j + 0.5) * size;
        const d = Math.hypot(Math.max(0, Math.abs(cx - tx) - size / 2), Math.max(0, Math.abs(cz - tz) - size / 2));
        if (d > R) continue;
        const key = `${ts}:${i}:${j}`;
        const tile = this.tiles.get(key);
        // Far tiles of fine stages get half resolution until the kaiju comes closer.
        const r = ts === 1 && d > span * 0.9 ? Math.max(64, res / 2) : res;
        if (!tile) want.push({ i, j, ts, res: r, prio: d });
        else if (tile.res < r) want.push({ i, j, ts, res: r, prio: d + span * 0.5 });
        else if (!tile.complete && d < span * 1.6 && this.complete(i, j, ts)) want.push({ i, j, ts, res: tile.res, prio: d + span });
      }
    }
    want.sort((a, b) => a.prio - b.prio);
    const start = performance.now();
    for (const w of want) {
      this.paint(w.i, w.j, w.ts, w.res);
      if (performance.now() - start > budget) break;
    }
    // Drop tiles far behind, and tiles of the old size once the new size covers them.
    for (const [key, tile] of this.tiles) {
      const cx = (tile.i + 0.5) * tile.size;
      const cz = (tile.j + 0.5) * tile.size;
      if (Math.hypot(cx - tx, cz - tz) > R * 1.35 + tile.size) {
        this.disposeTile(tile);
        this.tiles.delete(key);
      }
    }
  }

  complete(i, j, ts) {
    const w = this.world;
    for (let r = j * ts - 1; r <= (j + 1) * ts; r++) for (let c = i * ts - 1; c <= (i + 1) * ts; c++) if (!w.isLoaded(c, r)) return false;
    return true;
  }

  // ---------------------------------------------------------------- painting
  // A soft light pool, drawn once per colour and stamped wherever a light stands.
  poolSprite(color, al) {
    this.sprites = this.sprites || new Map();
    const key = `${color}:${al}`;
    let cv = this.sprites.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const c = new THREE.Color(color);
    const rgba = (q) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${q})`;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(al));
    grad.addColorStop(0.5, rgba(al * 0.35));
    grad.addColorStop(1, rgba(0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(key, cv);
    return cv;
  }

  paint(i, j, ts, res) {
    const w = this.world;
    const size = ts * CELL;
    const x0 = i * size;
    const y0 = j * size;
    const key = `${ts}:${i}:${j}`;
    const old = this.tiles.get(key);
    const k = res / size; // pixels per world unit
    const cv = old && old.res === res ? old.canvas : document.createElement('canvas');
    cv.width = res;
    cv.height = res;
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    const fine = (units) => units * k >= 2.5; // detail worth drawing at this resolution
    const c0 = i * ts;
    const r0 = j * ts;
    const cells = [];
    for (let r = r0; r < r0 + ts; r++) for (let c = c0; c < c0 + ts; c++) cells.push(w.zoneFor(c, r));

    // Base ground per district, mottled so lawns and pavement read as surfaces.
    for (const z of cells) {
      const X = z.c * CELL;
      const Y = z.r * CELL;
      const col = STYLE_COLOR[z.style];
      ctx.fillStyle = col;
      ctx.fillRect(X, Y, CELL, CELL);
      if (SOFT.has(z.style)) {
        const n = fine(2) ? 220 : 80;
        for (let q = 0; q < n; q++) {
          const rr = 3 + cheap(z.c * 7 + q, z.r, 3) * 9;
          ctx.fillStyle = cheap(q, z.c, z.r) < 0.5 ? shadeHex(col, 0.9) : shadeHex(col, 1.08);
          ctx.beginPath();
          ctx.arc(X + cheap(z.c, z.r, q) * CELL, Y + cheap(z.r, q, z.c) * CELL, rr, 0, Math.PI * 2);
          ctx.fill();
        }
        if (fine(0.8) && z.style !== 'forest' && z.style !== 'snow') {
          // Grass tufts: tiny darker and lighter specks.
          for (let q = 0; q < 900; q++) {
            ctx.fillStyle = q % 2 ? shadeHex(col, 0.82) : shadeHex(col, 1.16);
            ctx.fillRect(X + cheap(q, z.c * 3, z.r) * CELL, Y + cheap(z.r * 5, q, z.c) * CELL, 0.6, 1.4);
          }
        }
      } else if (z.style === 'pastel') {
        ctx.fillStyle = 'rgba(120,90,70,0.12)';
        for (let x = X; x < X + CELL; x += 8) for (let y = Y; y < Y + CELL; y += 8) if (((x - X + y - Y) / 8) % 2 === 0) ctx.fillRect(x, y, 4, 4);
      } else if (fine(1.5)) {
        // Paving joints in town.
        ctx.fillStyle = z.style === 'neon' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.07)';
        const step = z.style === 'brick' ? 5 : 8;
        for (let y = Y; y < Y + CELL; y += step) ctx.fillRect(X, y, CELL, 0.35);
        for (let x = X; x < X + CELL; x += step * 1.6) ctx.fillRect(x, Y, 0.35, CELL);
      }
    }

    // Water field: sampled on a grid, drawn as smooth contours (sand, wet sand, shallows, deep).
    const N = 64;
    const step = size / N;
    let F = null;
    {
      let near = false;
      const probe = size / 4;
      for (let b = 0; b <= 4 && !near; b++) for (let a = 0; a <= 4 && !near; a++) if (waterField(x0 + a * probe, y0 + b * probe, w.p) > -(probe * 0.8 + 50)) near = true;
      if (near) {
        F = new Float32Array((N + 1) * (N + 1));
        for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) F[b * (N + 1) + a] = waterField(x0 + a * step, y0 + b * step, w.p);
      }
    }
    const contour = (thr) => {
      ctx.beginPath();
      for (let b = 0; b < N; b++) {
        for (let a = 0; a < N; a++) {
          const va = F[b * (N + 1) + a] - thr;
          const vb = F[b * (N + 1) + a + 1] - thr;
          const vc = F[(b + 1) * (N + 1) + a + 1] - thr;
          const vd = F[(b + 1) * (N + 1) + a] - thr;
          if (va <= 0 && vb <= 0 && vc <= 0 && vd <= 0) continue;
          const X = x0 + a * step;
          const Y = y0 + b * step;
          if (va > 0 && vb > 0 && vc > 0 && vd > 0) {
            ctx.rect(X, Y, step, step);
            continue;
          }
          const cs = [[X, Y, va], [X + step, Y, vb], [X + step, Y + step, vc], [X, Y + step, vd]];
          let first = true;
          for (let q = 0; q < 4; q++) {
            const [px, py, v] = cs[q];
            const [qx, qy, u] = cs[(q + 1) % 4];
            if (v > 0) {
              if (first) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
              first = false;
            }
            if (v > 0 !== u > 0) {
              const t = v / (v - u);
              if (first) ctx.moveTo(px + (qx - px) * t, py + (qy - py) * t);
              else ctx.lineTo(px + (qx - px) * t, py + (qy - py) * t);
              first = false;
            }
          }
          ctx.closePath();
        }
      }
      ctx.fill();
    };
    if (F) {
      // Beaches on soft ground; a stone quay where the city meets the water.
      ctx.save();
      ctx.beginPath();
      for (const z of cells) if (SOFT.has(z.style) || z.style === 'pastel') ctx.rect(z.c * CELL, z.r * CELL, CELL, CELL);
      ctx.clip();
      ctx.fillStyle = '#d8c48e';
      contour(-20);
      ctx.fillStyle = '#bfa774';
      contour(-6);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      for (const z of cells) if (!(SOFT.has(z.style) || z.style === 'pastel')) ctx.rect(z.c * CELL, z.r * CELL, CELL, CELL);
      ctx.clip();
      ctx.fillStyle = '#8e8a82';
      contour(-7);
      ctx.restore();
    }

    // Roads: sidewalks, asphalt, then markings. Every edge that touches the tile is drawn
    // (the canvas clips the rest), so roads continue seamlessly across tiles.
    const edges = [];
    for (let r = r0 - 1; r <= r0 + ts; r++) {
      for (let c = c0 - 1; c <= c0 + ts; c++) {
        const h = w.edge(c, r, true);
        if (h) edges.push(h);
        const v = w.edge(c, r, false);
        if (v) edges.push(v);
      }
    }
    const rect = (e, pad) => (e.horiz ? [e.x0 - pad, e.y0 - pad, e.x1 - e.x0 + pad * 2, pad * 2] : [e.x0 - pad, e.y0 - pad, pad * 2, e.y1 - e.y0 + pad * 2]);
    for (const e of edges) {
      if (!e.urban) continue;
      ctx.fillStyle = '#a7a39a';
      ctx.fillRect(...rect(e, RW / 2 + 8));
    }
    if (fine(1)) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (const e of edges) {
        if (!e.urban) continue;
        for (let t = 0; t < CELL; t += 6) {
          for (const side of [-1, 1]) {
            if (e.horiz) ctx.fillRect(e.x0 + t, e.y0 + side * (RW / 2 + 4) - 4, 0.4, 8);
            else ctx.fillRect(e.x0 + side * (RW / 2 + 4) - 4, e.y0 + t, 8, 0.4);
          }
        }
      }
    }
    for (const e of edges) {
      ctx.fillStyle = '#5d5b57';
      ctx.fillRect(...rect(e, RW / 2 + 1));
    }
    for (const e of edges) {
      ctx.fillStyle = e.hw ? '#34363b' : '#3a3c42';
      ctx.fillRect(...rect(e, RW / 2));
    }
    for (const e of edges) {
      const len = CELL;
      const along = (t, off, l, wd, color) => {
        ctx.fillStyle = color;
        if (e.horiz) ctx.fillRect(e.x0 + t, e.y0 + off - wd / 2, l, wd);
        else ctx.fillRect(e.x0 + off - wd / 2, e.y0 + t, wd, l);
      };
      const a = RW / 2 + 4;
      const b = len - RW / 2 - 4;
      if (e.hw) {
        along(a, -1.2, b - a, 1, '#e2bd45');
        along(a, 1.2, b - a, 1, '#e2bd45');
        for (let t = a; t < b - 10; t += 24) {
          along(t, -15, 12, 1, 'rgba(240,240,235,0.85)');
          along(t, 15, 12, 1, 'rgba(240,240,235,0.85)');
        }
      } else {
        for (let t = a + 2; t < b - 10; t += 24) along(t, 0, 12, 1.2, '#e2bd45');
      }
      along(a, -RW / 2 + 2.5, b - a, 0.8, 'rgba(240,240,235,0.7)');
      along(a, RW / 2 - 2.5, b - a, 0.8, 'rgba(240,240,235,0.7)');
      if (e.urban) {
        // Crosswalks at both ends, with stop lines.
        ctx.fillStyle = 'rgba(240,240,235,0.85)';
        for (let q = -RW / 2 + 6; q < RW / 2 - 4; q += 8) {
          if (e.horiz) {
            ctx.fillRect(e.x0 + RW / 2 + 2, e.y0 + q, 10, 4);
            ctx.fillRect(e.x1 - RW / 2 - 12, e.y0 + q, 10, 4);
          } else {
            ctx.fillRect(e.x0 + q, e.y0 + RW / 2 + 2, 4, 10);
            ctx.fillRect(e.x0 + q, e.y1 - RW / 2 - 12, 4, 10);
          }
        }
      }
      if (fine(1.2)) {
        // Asphalt patches and cracks.
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let q = 0; q < 6; q++) {
          const h = cheap(e.x0 + q, e.y0, e.horiz ? 1 : 2);
          const pw = 4 + h * 10;
          if (e.horiz) ctx.fillRect(e.x0 + RW / 2 + h * (CELL - RW - pw), e.y0 - RW / 2 + 4 + cheap(q, e.x0, e.y0) * (RW - 12), pw, 2 + h * 4);
          else ctx.fillRect(e.x0 - RW / 2 + 4 + cheap(q, e.x0, e.y0) * (RW - 12), e.y0 + RW / 2 + h * (CELL - RW - pw), 2 + h * 4, pw);
        }
      }
    }

    // Painted details: paths, ponds, courts, plazas, parking bays, manholes, towels.
    const R = (x, y, ww, hh, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(x - ww / 2, y - hh / 2, ww, hh);
    };
    // A rounded rectangle (pools, kidney or not).
    const RR = (x, y, ww, hh, rad, c) => {
      const l = x - ww / 2;
      const t = y - hh / 2;
      const q = Math.min(rad, ww / 2, hh / 2);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(l + q, t);
      ctx.arcTo(l + ww, t, l + ww, t + hh, q);
      ctx.arcTo(l + ww, t + hh, l, t + hh, q);
      ctx.arcTo(l, t + hh, l, t, q);
      ctx.arcTo(l, t, l + ww, t, q);
      ctx.closePath();
      ctx.fill();
    };
    // Stripes across a decal, every `gap` units, running along x (horiz) or along y.
    const stripes = (d, gap, wd, c, horiz = d.horiz) => {
      ctx.fillStyle = c;
      if (horiz) for (let yy = d.y - d.h / 2 + gap / 2; yy < d.y + d.h / 2; yy += gap) ctx.fillRect(d.x - d.w / 2, yy, d.w, wd);
      else for (let xx = d.x - d.w / 2 + gap / 2; xx < d.x + d.w / 2; xx += gap) ctx.fillRect(xx, d.y - d.h / 2, wd, d.h);
    };
    // Lawns first, then what's laid on them (patios, then the pools let into those).
    const painted = w.decalGrid.query(x0 - 4, y0 - 4, x0 + size + 4, y0 + size + 4).sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const d of painted) {
      switch (d.kind) {
        case 'lawn': {
          // Each yard its own green: mown in stripes, left lush, or gone a bit patchy.
          const tone = d.tone ?? 0;
          R(d.x, d.y, d.w, d.h, ['#6fa64e', '#77ad55', '#7aa64f'][tone]);
          if (tone === 0 && fine(3)) stripes(d, 8, 4, 'rgba(255,255,255,0.07)', !d.horiz);
          if (tone === 2 && fine(2)) {
            ctx.fillStyle = 'rgba(170,150,80,0.28)';
            for (let q = 0; q < 10; q++) {
              ctx.beginPath();
              ctx.ellipse(d.x + (cheap(q, d.x, 9) - 0.5) * d.w * 0.9, d.y + (cheap(q, d.y, 10) - 0.5) * d.h * 0.9, 3 + cheap(q, 3, d.x) * 6, 2 + cheap(q, 4, d.y) * 4, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;
        }
        case 'drive':
          R(d.x, d.y, d.w, d.h, '#bdb8ad');
          if (fine(1.5)) {
            stripes(d, 10, 0.5, 'rgba(0,0,0,0.13)', d.horiz);
            ctx.fillStyle = 'rgba(40,36,30,0.16)';
            ctx.beginPath();
            ctx.ellipse(d.x, d.y, 2.6, 1.8, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'walk': {
          // Stepping stones from the pavement to the front door.
          const long = d.h > d.w;
          const n = Math.floor((long ? d.h : d.w) / 4);
          for (let q = 0; q < n; q++) {
            const t = -((long ? d.h : d.w) / 2) + 2 + q * 4;
            if (long) R(d.x, d.y + t, d.w, 3, '#d8cfba');
            else R(d.x + t, d.y, 3, d.h, '#d8cfba');
          }
          break;
        }
        case 'patio':
          R(d.x, d.y, d.w + 1.2, d.h + 1.2, '#b5aa94');
          R(d.x, d.y, d.w, d.h, '#d2c8b4');
          if (fine(1.5)) {
            stripes(d, 4, 0.35, 'rgba(0,0,0,0.12)', true);
            stripes(d, 4, 0.35, 'rgba(0,0,0,0.12)', false);
          }
          break;
        case 'deck':
          R(d.x, d.y, d.w + 1, d.h + 1, '#7e5a36');
          R(d.x, d.y, d.w, d.h, '#a97c4e');
          if (fine(1.5)) stripes(d, 2, 0.35, 'rgba(60,36,16,0.35)', d.horiz);
          break;
        case 'pool': {
          // Coping, water deepening toward one end, and light dancing on it.
          const rad = d.kidney ? Math.min(d.w, d.h) * 0.48 : 2.5;
          RR(d.x, d.y, d.w + 3, d.h + 3, rad + 1.5, '#efe9dc');
          RR(d.x, d.y, d.w, d.h, rad, '#46bde8');
          ctx.save();
          ctx.globalAlpha = 0.45;
          const deep = d.w > d.h;
          if (deep) RR(d.x + d.w * 0.22, d.y, d.w * 0.5, d.h - 1.5, rad, '#2b93cf');
          else RR(d.x, d.y + d.h * 0.22, d.w - 1.5, d.h * 0.5, rad, '#2b93cf');
          ctx.restore();
          if (fine(1.1)) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            for (let q = 0; q < 14; q++) ctx.fillRect(d.x + (cheap(q, d.x, 11) - 0.5) * (d.w - 4), d.y + (cheap(q, d.y, 12) - 0.5) * (d.h - 3), 1.6 + cheap(q, 5, 6) * 2.4, 0.4);
          }
          break;
        }
        case 'bed':
          R(d.x, d.y, d.w, d.h, '#6a4a2e');
          if (fine(1.5)) {
            for (let q = 0; q < Math.floor(d.w * d.h * 0.5); q++) {
              ctx.fillStyle = q % 4 === 0 ? ['#e05a7a', '#f2d24a', '#ffffff', '#a070e0'][q % 16 >> 2] : '#3f8a3a';
              ctx.fillRect(d.x - d.w / 2 + cheap(q, d.x, 13) * d.w, d.y - d.h / 2 + cheap(q, d.y, 14) * d.h, 0.9, 0.9);
            }
          }
          break;
        case 'gravel':
          R(d.x, d.y, d.w, d.h, '#c2b9a8');
          if (fine(1.5)) {
            ctx.fillStyle = 'rgba(90,80,64,0.25)';
            for (let q = 0; q < Math.floor(d.w * d.h * 0.4); q++) ctx.fillRect(d.x - d.w / 2 + cheap(q, d.x, 15) * d.w, d.y - d.h / 2 + cheap(q, d.y, 16) * d.h, 0.5, 0.5);
          }
          break;
        case 'chalk': {
          // Hopscotch on the driveway.
          if (!fine(1.1)) break;
          ctx.strokeStyle = 'rgba(255,240,250,0.85)';
          ctx.lineWidth = 0.35;
          const long = d.h > d.w;
          for (let q = 0; q < 5; q++) {
            const t = -((long ? d.h : d.w) / 2) + q * 1.8;
            const pair = q % 2 === 1;
            for (const s2 of pair ? [-0.9, 0.9] : [0]) {
              if (long) ctx.strokeRect(d.x + s2 - 0.9, d.y + t, 1.8, 1.8);
              else ctx.strokeRect(d.x + t, d.y + s2 - 0.9, 1.8, 1.8);
            }
          }
          break;
        }
        case 'confetti':
          if (!fine(1.1)) break;
          for (let q = 0; q < 160; q++) {
            ctx.fillStyle = ['#ff5a8a', '#ffd23f', '#4fc3f7', '#7ed957', '#b388ff', '#ffffff'][q % 6];
            ctx.fillRect(d.x + (cheap(q, d.x, 17) - 0.5) * d.w, d.y + (cheap(q, d.y, 18) - 0.5) * d.h, 0.7, 0.45);
          }
          break;
        case 'pitch': {
          // A football pitch: mown bands, white lines, the centre circle and the boxes.
          R(d.x, d.y, d.w + 6, d.h + 6, '#5c9a42');
          if (fine(2)) stripes(d, 10, 5, 'rgba(255,255,255,0.06)', !d.horiz);
          ctx.strokeStyle = 'rgba(245,245,240,0.9)';
          ctx.lineWidth = 0.7;
          ctx.strokeRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
          ctx.beginPath();
          if (d.horiz) {
            ctx.moveTo(d.x, d.y - d.h / 2);
            ctx.lineTo(d.x, d.y + d.h / 2);
          } else {
            ctx.moveTo(d.x - d.w / 2, d.y);
            ctx.lineTo(d.x + d.w / 2, d.y);
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(d.x, d.y, Math.min(d.w, d.h) * 0.16, 0, Math.PI * 2);
          ctx.stroke();
          const bx = d.horiz ? d.w * 0.14 : d.w * 0.5;
          const by = d.horiz ? d.h * 0.5 : d.h * 0.14;
          for (const s2 of [-1, 1]) {
            if (d.horiz) ctx.strokeRect(d.x + s2 * (d.w / 2) - (s2 > 0 ? bx : 0), d.y - by / 2, bx, by);
            else ctx.strokeRect(d.x - bx / 2, d.y + s2 * (d.h / 2) - (s2 > 0 ? by : 0), bx, by);
          }
          break;
        }
        case 'blanket': {
          // A picnic blanket, checked.
          const c2 = ['#d94f4f', '#3b6fd1', '#3a8a5a'][Math.abs(Math.floor(d.x)) % 3];
          R(d.x, d.y, d.w, d.h, '#f4efe4');
          ctx.fillStyle = c2;
          for (let xx = 0; xx < d.w; xx += 1.5) for (let yy = 0; yy < d.h; yy += 1.5) if ((Math.round(xx / 1.5) + Math.round(yy / 1.5)) % 2 === 0) ctx.fillRect(d.x - d.w / 2 + xx, d.y - d.h / 2 + yy, 1.5, 1.5);
          break;
        }
        case 'roses': {
          // A round rose garden: rings of colour round a path.
          const rings = ['#cdbb94', '#3f8a3a', '#e05a7a', '#3f8a3a', '#f2d24a', '#3f8a3a', '#ffffff'];
          for (let q = 0; q < rings.length; q++) {
            ctx.fillStyle = rings[q];
            ctx.beginPath();
            ctx.arc(d.x, d.y, (d.w / 2) * (1 - q / rings.length), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'skate':
          R(d.x, d.y, d.w, d.h, '#a3a6ab');
          if (fine(1.5)) {
            stripes(d, 12, 0.4, 'rgba(0,0,0,0.12)', true);
            stripes(d, 12, 0.4, 'rgba(0,0,0,0.12)', false);
          }
          break;
        case 'path':
          R(d.x, d.y, d.w, d.h, '#cdbb94');
          if (fine(1)) {
            ctx.fillStyle = 'rgba(120,96,60,0.18)';
            for (let q = 0; q < 60; q++) ctx.fillRect(d.x - d.w / 2 + cheap(q, d.x, 1) * d.w, d.y - d.h / 2 + cheap(q, d.y, 2) * d.h, 1, 1);
          }
          break;
        case 'plaza':
          R(d.x, d.y, d.w, d.h, '#c4c0b8');
          ctx.fillStyle = '#b2ada3';
          for (let x = d.x - d.w / 2; x < d.x + d.w / 2; x += 8) for (let y = d.y - d.h / 2; y < d.y + d.h / 2; y += 8) if (((x - d.x + d.w / 2 + y - d.y + d.h / 2) / 8) % 2 < 1) ctx.fillRect(x, y, 4, 4);
          break;
        case 'pond':
          ctx.fillStyle = '#b8a27a';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.w / 2 + 5, d.h / 2 + 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2f6f9a';
          ctx.beginPath();
          ctx.ellipse(d.x, d.y, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#4f8fba';
          ctx.beginPath();
          ctx.ellipse(d.x - d.w * 0.12, d.y - d.h * 0.12, d.w * 0.22, d.h * 0.14, 0, 0, Math.PI * 2);
          ctx.fill();
          if (fine(1)) {
            // Lily pads.
            ctx.fillStyle = '#4f9a52';
            for (let q = 0; q < 7; q++) {
              ctx.beginPath();
              ctx.arc(d.x + (cheap(q, d.x, 3) - 0.5) * d.w * 0.7, d.y + (cheap(q, d.y, 4) - 0.5) * d.h * 0.6, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          break;
        case 'dirt':
          // A building site's churned ground, with tyre ruts.
          R(d.x, d.y, d.w, d.h, '#8a7052');
          ctx.fillStyle = 'rgba(60,44,28,0.35)';
          for (let q = 0; q < 5; q++) ctx.fillRect(d.x - d.w / 2 + 4, d.y - d.h / 2 + (q + 0.5) * (d.h / 5), d.w - 8, 1.2);
          if (fine(1)) {
            ctx.fillStyle = 'rgba(180,150,110,0.35)';
            for (let q = 0; q < 50; q++) ctx.fillRect(d.x - d.w / 2 + cheap(q, d.x, 7) * d.w, d.y - d.h / 2 + cheap(q, d.y, 8) * d.h, 2, 2);
          }
          break;
        case 'sandbox':
          R(d.x, d.y, d.w + 4, d.h + 4, '#8a6a48');
          R(d.x, d.y, d.w, d.h, '#e0cc8e');
          break;
        case 'basketball':
        case 'tennis': {
          const ball = d.kind === 'basketball';
          R(d.x, d.y, d.w + 8, d.h + 8, ball ? '#5a5d63' : '#3a7a5a');
          R(d.x, d.y, d.w, d.h, ball ? '#c86a3a' : '#3a6aa8');
          ctx.strokeStyle = '#f2f2f2';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
          ctx.beginPath();
          ctx.moveTo(d.x, d.y - d.h / 2);
          ctx.lineTo(d.x, d.y + d.h / 2);
          ctx.stroke();
          if (ball) {
            ctx.beginPath();
            ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
        }
        case 'parking':
          R(d.x, d.y, d.w, d.h, '#45474d');
          ctx.fillStyle = 'rgba(240,240,235,0.8)';
          for (let x = d.x - d.w / 2 + 4; x < d.x + d.w / 2; x += 9) for (let y = d.y - d.h / 2 + 2; y < d.y + d.h / 2 - 10; y += 16) ctx.fillRect(x, y, 0.7, 12);
          break;
        case 'manhole':
          ctx.fillStyle = '#26272b';
          ctx.beginPath();
          ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'crops': {
          const [ground, row] = CROPS[d.crop % CROPS.length];
          R(d.x, d.y, d.w + 6, d.h + 6, '#6a5236');
          R(d.x, d.y, d.w, d.h, ground);
          ctx.fillStyle = row;
          const gap = 6;
          if (d.along) for (let yy = d.y - d.h / 2 + 2; yy < d.y + d.h / 2 - 1; yy += gap) ctx.fillRect(d.x - d.w / 2 + 2, yy, d.w - 4, 2);
          else for (let xx = d.x - d.w / 2 + 2; xx < d.x + d.w / 2 - 1; xx += gap) ctx.fillRect(xx, d.y - d.h / 2 + 2, 2, d.h - 4);
          break;
        }
        case 'rink':
          R(d.x, d.y, d.w + 6, d.h + 6, '#f6fafe');
          R(d.x, d.y, d.w, d.h, '#a8d4ec');
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          for (let q = 0; q < 14; q++) ctx.fillRect(d.x - d.w / 2 + cheap(q, d.x, 5) * d.w, d.y - d.h / 2 + cheap(q, d.y, 6) * d.h, 8 + cheap(q, 1, 2) * 14, 0.8);
          break;
        case 'towel':
          R(d.x, d.y, d.w, d.h, ['#d94f4f', '#3b6fd1', '#f2c12e', '#2f9e8f', '#d94f8a'][Math.abs(Math.floor(d.y)) % 5]);
          break;
        default:
          break;
      }
    }

    // Contact shadows under buildings and trees.
    const objs = w.grid.query(x0 - 14, y0 - 14, x0 + size + 14, y0 + size + 14);
    for (const o of objs) {
      if (o.kind === 'building' && !o.walkable) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(o.x - o.w / 2 - 6, o.y - o.h / 2 - 6, o.w + 12, o.h + 12);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(o.x - o.w / 2 - 2, o.y - o.h / 2 - 2, o.w + 4, o.h + 4);
      } else if (o.type && o.w * k > 1.5 && o.type.startsWith('tree')) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.w * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (F) {
      ctx.fillStyle = '#4f8f9a';
      contour(0);
      ctx.fillStyle = '#356f8a';
      contour(18);
      ctx.fillStyle = '#244f72';
      contour(60);
    }

    // Night light pools, baked per tile; their strength follows the time of day.
    const gres = Math.max(32, pow2(size / GLOW_UPX));
    const gk = gres / size;
    const gv = old ? old.glowCanvas : document.createElement('canvas');
    gv.width = gres;
    gv.height = gres;
    const gx = gv.getContext('2d');
    gx.setTransform(gk, 0, 0, gk, -x0 * gk, -y0 * gk);
    gx.fillStyle = '#000';
    gx.fillRect(x0, y0, size, size);
    gx.globalCompositeOperation = 'lighten';
    const pool = (x, y, r, color, al) => {
      if (r * gk < 0.8) return;
      gx.drawImage(this.poolSprite(color, al), x - r, y - r, 2 * r, 2 * r);
    };
    for (const l of w.lightGrid.query(x0 - 230, y0 - 230, x0 + size + 230, y0 + size + 230)) pool(l.x, l.y, l.big ? 220 : Math.max(26, l.height * 3.2), l.color, l.big ? 0.4 : 0.62);
    for (const o of w.grid.query(x0 - 120, y0 - 120, x0 + size + 120, y0 + size + 120)) {
      if (o.kind !== 'building' || o.walkable) continue;
      if (o.style === 'neon' || (o.style === 'brick' && o.tier >= 4)) pool(o.x, o.y, Math.max(o.w, o.h) * 0.85, POOL_NEON[o.id % 4], 0.35);
      else if (o.tier >= 3) pool(o.x, o.y, Math.max(o.w, o.h) * 0.7, 0xffc36b, 0.18);
    }
    gx.globalCompositeOperation = 'source-over';

    if (old) {
      this.disposeTile(old);
      this.tiles.delete(key);
    }
    const map = new THREE.CanvasTexture(cv);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const glow = new THREE.CanvasTexture(gv);
    const mat = new THREE.MeshLambertMaterial({ map, emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: this.night * 0.75, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    const uTile = { value: size };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uVox = this.uVox;
      shader.uniforms.uTile = uTile;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uVox;\nuniform float uTile;\nvarying vec3 vWP;\n${GRAIN_GLSL}`)
        .replace('#include <map_fragment>', `
          float snap = voxSnap(vWP.xz, uVox);
          {
            vec4 smoothC = texture2D(map, vUv);
            #if __VERSION__ >= 300
              // The colour at the voxel's centre, filtered for this pixel's footprint (so the
              // mip level doesn't jump at voxel edges).
              vec4 blockC = textureGrad(map, voxUv(vUv, vWP.xz, uVox, uTile), dFdx(vUv), dFdy(vUv));
            #else
              vec4 blockC = smoothC;
            #endif
            diffuseColor *= mix(smoothC, blockC, snap);
          }
          {
            vec2 cell = mod(floor(vWP.xz / uVox), 4096.0);
            // Each voxel a shade lighter or darker, as on the models.
            diffuseColor.rgb *= 1.0 + (gHash(cell) - 0.5) * 0.12 * snap;
            // Grass grows in patches a few voxels across, in three shades, with the odd
            // sunlit tuft.
            vec3 c = diffuseColor.rgb;
            float grassy = smoothstep(0.03, 0.1, c.g - max(c.r, c.b)) * snap;
            float pn = gNoise(cell / 5.0) * 0.6 + gNoise(cell / 13.0 + 17.0) * 0.4;
            diffuseColor.rgb *= 1.0 + (floor(pn * 3.0) * 0.5 - 0.5) * 0.12 * grassy;
            float tuft = step(0.94, gHash(cell + 71.0)) * grassy;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.12, 0.84), tuft);
            // Broad, gentle variation across the whole ground.
            diffuseColor.rgb *= 1.0 + (gNoise(mod(vWP.xz, 2048.0) / 41.0) - 0.5) * 0.1;
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= 0.5 + diffuseColor.rgb * 0.5;');
    };
    mat.customProgramCacheKey = () => 'ground-tile';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
    mesh.position.set(x0 + size / 2, 0, y0 + size / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const tile = { i, j, ts, size, res, canvas: cv, glowCanvas: gv, map, glow, mesh, complete: this.complete(i, j, ts), water: null, field: null };

    // Water surface over the wet part of the tile.
    if (F && F.some((v) => v > -4)) {
      const n1 = N + 1;
      const data = new Uint8Array(n1 * n1 * 4);
      for (let b = 0; b < n1; b++) {
        for (let a = 0; a < n1; a++) {
          // Texture row 0 is v = 0, the south edge of the tile.
          const v = Math.max(0, Math.min(255, 128 + F[(N - b) * n1 + a] * 2));
          const q = (b * n1 + a) * 4;
          data[q] = data[q + 1] = data[q + 2] = v;
          data[q + 3] = 255;
        }
      }
      const field = new THREE.DataTexture(data, n1, n1, THREE.RGBAFormat);
      field.magFilter = THREE.LinearFilter;
      field.minFilter = THREE.LinearFilter;
      field.needsUpdate = true;
      const wm = this.waterPool.pop() || this.makeWaterMaterial();
      wm.color.copy(this.waterColor);
      wm.userData.uTile.value = size;
      wm.userData.uField.value = field;
      wm.userData.uFS.value = N / n1;
      wm.userData.uFO.value = 0.5 / n1;
      const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), wm);
      water.position.set(x0 + size / 2, 1, y0 + size / 2);
      water.renderOrder = 2;
      water.receiveShadow = true;
      this.scene.add(water);
      tile.water = water;
      tile.field = field;
    }

    // A tile of a new size replaces the tiles of the old size underneath it.
    for (const [k2, t2] of this.tiles) {
      if (t2.ts === ts) continue;
      if (t2.i * t2.size < x0 + size && (t2.i + 1) * t2.size > x0 && t2.j * t2.size < y0 + size && (t2.j + 1) * t2.size > y0) {
        this.disposeTile(t2);
        this.tiles.delete(k2);
      }
    }
    this.tiles.set(key, tile);
    return tile;
  }

  // The water surface: the tile's wet field (a texture) cuts the outline voxel by voxel, like
  // the ground under it, and puts foam on the voxels along the shore.
  makeWaterMaterial() {
    const wm = new THREE.MeshPhongMaterial({ color: this.waterColor, specular: 0x4a5a6a, shininess: 45, transparent: true, opacity: 0.9, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.5, 0.5), depthWrite: false });
    const u = { uField: { value: null }, uFS: { value: 1 }, uFO: { value: 0 }, uTile: { value: CELL }, uVox: this.uVox };
    wm.userData = u;
    wm.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTUv;\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTUv = uv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D uField;\nuniform float uFS;\nuniform float uFO;\nuniform float uTile;\nuniform float uVox;\nvarying vec2 vTUv;\nvarying vec3 vWP;\n${GRAIN_GLSL}`)
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
          float snapW = voxSnap(vWP.xz, uVox);
          float fWet = texture2D(uField, vTUv * uFS + uFO).r;
          float fAA = fwidth(fWet) * 0.9 + 0.002;
          float wetSmooth = smoothstep(0.5 - fAA, 0.5 + fAA, fWet);
          float foamSmooth = 1.0 - smoothstep(0.5, 0.54, fWet);
          // Voxel by voxel: wet where its centre is; foam where a neighbour is dry.
          vec2 fuv = voxUv(vTUv, vWP.xz, uVox, uTile);
          float wetBlock = step(0.5, texture2D(uField, fuv * uFS + uFO).r);
          vec2 dv = vec2(uVox / uTile, 0.0);
          float dryN = min(
            min(texture2D(uField, (fuv + dv.xy) * uFS + uFO).r, texture2D(uField, (fuv - dv.xy) * uFS + uFO).r),
            min(texture2D(uField, (fuv + dv.yx) * uFS + uFO).r, texture2D(uField, (fuv - dv.yx) * uFS + uFO).r));
          float foamBlock = wetBlock * (1.0 - step(0.5, dryN)) * (0.8 + 0.4 * gHash(mod(floor(vWP.xz / uVox), 4096.0)));
          diffuseColor.a *= mix(wetSmooth, wetBlock, snapW);
          float foam = mix(foamSmooth, foamBlock, snapW);`)
        .replace('#include <output_fragment>', 'outgoingLight += vec3(0.32) * foam;\n#include <output_fragment>');
    };
    wm.customProgramCacheKey = () => 'water-tile';
    return wm;
  }
}
