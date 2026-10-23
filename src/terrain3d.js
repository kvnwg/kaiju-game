/* global THREE */
// Ground for an endless world. Each tile covers one cell (2x2 or 4x4 cells once the kaiju is
// huge) and is painted onto a canvas at a resolution that follows the kaiju's size: very fine
// for the hatchling, coarse for the Apex, so the painted area stays cheap at every scale.
// A world-space voxel grain in the shader keeps the ground crisp up close, shorelines are
// drawn as smooth contours of the water field, and water planes take a small field texture
// that the shader thresholds, so coasts stay smooth at any zoom.
import { WORLD } from './config.js';
import { waterField } from './world.js';
import { shade } from './voxel.js';

const CELL = WORLD.cell;
const RW = WORLD.road;
// Ground detail per stage: world units per texel, cells per tile, voxel grain size.
const LOD = [null,
  { upx: 0.41, ts: 1, grain: 0.5 },
  { upx: 0.82, ts: 1, grain: 0.75 },
  { upx: 1.64, ts: 1, grain: 1.25 },
  { upx: 3.3, ts: 1, grain: 2.5 },
  { upx: 3.3, ts: 2, grain: 5 },
  { upx: 6.5, ts: 4, grain: 10 },
];
const GLOW_UPX = 6.5;
const STYLE_COLOR = { forest: '#3a6232', park: '#5f9a44', suburb: '#6c9c4c', neon: '#34373f', brick: '#6e665e', garden: '#99968c', pastel: '#cdb79a', docks: '#7d7870', water: '#6c9a4c' };
const SOFT = new Set(['forest', 'park', 'suburb', 'water']);
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
  }`;

export class Terrain {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.tiles = new Map();
    this.world = null;
    this.uGrain = { value: 0.5 };
    this.night = 0;
    this.waterColor = new THREE.Color(0x3a8ac0);
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
    this.under = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a8a44 }));
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
      t.water.material.dispose();
      t.field.dispose();
    }
  }

  // ---------------------------------------------------------------- per frame
  update(stage, tx, tz, span, night, waterColor, t, budget = 5) {
    if (!this.world) return;
    const lod = LOD[stage];
    this.uGrain.value = lod.grain;
    this.night = night;
    this.waterColor.copy(waterColor);
    this.waterNormal.offset.set(t * 0.01, t * 0.006);
    this.under.position.x = tx;
    this.under.position.z = tz;
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
        if (fine(0.8) && z.style !== 'forest') {
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
    for (const d of w.decalGrid.query(x0 - 4, y0 - 4, x0 + size + 4, y0 + size + 4)) {
      switch (d.kind) {
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
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGrain = this.uGrain;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uGrain;\nvarying vec3 vWP;\n${GRAIN_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 wp = mod(vWP.xz, 2048.0);
            vec2 g = wp / uGrain;
            float fw = max(fwidth(g.x), fwidth(g.y));
            float fade = 1.0 - smoothstep(0.3, 0.8, fw);
            float n = gHash(floor(g)) * 0.65 + gHash(floor(g * 0.5) + 31.0) * 0.35;
            diffuseColor.rgb *= 1.0 + (n - 0.5) * 0.2 * fade;
            diffuseColor.rgb *= 1.0 + (gNoise(wp / 41.0) - 0.5) * 0.1;
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
      const wm = new THREE.MeshPhongMaterial({ color: this.waterColor, specular: 0x4a5a6a, shininess: 45, transparent: true, opacity: 0.9, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.5, 0.5), depthWrite: false });
      const fs = N / n1;
      const fo = 0.5 / n1;
      wm.onBeforeCompile = (shader) => {
        shader.uniforms.uField = { value: field };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vTUv;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTUv = uv;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uField;\nvarying vec2 vTUv;')
          .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
            float fWet = texture2D(uField, vTUv * ${fs.toFixed(6)} + ${fo.toFixed(6)}).r;
            float fAA = fwidth(fWet) * 0.9 + 0.002;
            diffuseColor.a *= smoothstep(0.5 - fAA, 0.5 + fAA, fWet);
            float foam = 1.0 - smoothstep(0.5, 0.54, fWet);`)
          .replace('#include <output_fragment>', 'outgoingLight += vec3(0.32) * foam;\n#include <output_fragment>');
      };
      wm.customProgramCacheKey = () => 'water-tile';
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
}
