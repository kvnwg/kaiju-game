// Voxel grid + a small toolkit for procedurally building voxel models.
// Pure data, no rendering: the renderer meshes these grids, tests can inspect them.

export const E = 1; // emissive: neon, signs, lamps (glows day and night, much brighter at night)
export const W = 2; // window: glass by day, lit by night

export function hex(c) {
  return typeof c === 'number' ? c : parseInt(c.slice(1), 16);
}

export function mix(a, b, t) {
  a = hex(a);
  b = hex(b);
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

export function shade(c, f) {
  c = hex(c);
  const k = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (k((c >> 16) & 255) << 16) | (k((c >> 8) & 255) << 8) | k(c & 255);
}

// Small deterministic hash for per-voxel variation.
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class VoxelGrid {
  constructor(nx, ny, nz) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.data = new Uint32Array(nx * ny * nz);
  }

  idx(x, y, z) {
    return (y * this.nz + z) * this.nx + x;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  set(x, y, z, c, f = 0) {
    if (!this.inside(x, y, z)) return;
    c = hex(c) & 0xffffff;
    this.data[this.idx(x, y, z)] = ((c || 0x010101) | (f << 24)) >>> 0;
  }

  get(x, y, z) {
    return this.inside(x, y, z) ? this.data[this.idx(x, y, z)] : 0;
  }

  clear(x, y, z) {
    if (this.inside(x, y, z)) this.data[this.idx(x, y, z)] = 0;
  }

  // Half-open box [x0,x1) x [y0,y1) x [z0,z1). `c` may be a colour or a function (x,y,z) => colour.
  box(x0, y0, z0, x1, y1, z1, c, f = 0) {
    for (let y = Math.max(0, y0); y < Math.min(this.ny, y1); y++)
      for (let z = Math.max(0, z0); z < Math.min(this.nz, z1); z++)
        for (let x = Math.max(0, x0); x < Math.min(this.nx, x1); x++) {
          const col = typeof c === 'function' ? c(x, y, z) : c;
          if (col != null) this.set(x, y, z, col, f);
        }
  }

  cylinder(cx, cz, r, y0, y1, c, f = 0, hollow = false) {
    for (let y = y0; y < y1; y++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          if (d > r) continue;
          if (hollow && d < r - 1.2) continue;
          this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c, f);
        }
  }

  count() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }
}

// ---------------------------------------------------------------- facade helpers
// Sides: 0 = front (+z), 1 = back (-z), 2 = right (+x), 3 = left (-x).
export const SIDES = [
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
];

// Visit each wall voxel of a rectangular footprint [x0,x1) x [z0,z1) for y in [y0,y1).
// fn(x, y, z, side, u, len) where u is the position along that facade.
export function eachWall(x0, z0, x1, z1, y0, y1, fn) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      fn(x, y, z1 - 1, 0, x - x0, x1 - x0);
      fn(x, y, z0, 1, x1 - 1 - x, x1 - x0);
    }
    for (let z = z0 + 1; z < z1 - 1; z++) {
      fn(x1 - 1, y, z, 2, z1 - 1 - z, z1 - z0);
      fn(x0, y, z, 3, z - z0, z1 - z0);
    }
  }
}

// A solid building body: dark interior, walls with a facade pattern.
// win: { style, w, h, gap, sill, glass, lit: [colours], litChance, frame?, arch?, accent? }
// Facade styles: punched (window grid), ribbon (horizontal glass bands), curtain (all glass
// with mullions), grid (concrete frame with glass infill), tiles (two-colour panels),
// stripes (alternating floor colours).
export function body(g, rng, b) {
  const { x0, z0, x1, z1, y0, y1 } = b;
  const floorH = b.floorH || 4;
  const interior = b.interior ?? 0x1b1c22;
  g.box(x0 + 1, y0, z0 + 1, x1 - 1, y1, z1 - 1, (x, y, z) => ((y - y0) % floorH === 0 ? 0x2a2a30 : interior));
  const w = b.win;
  const roomLit = w ? w.lit : null;
  const litSeed = rng.int(0, 1e6);
  const style = (w && w.style) || 'punched';
  const glassAt = (cell, floor, side) => {
    if (hash3(cell + side * 101, floor, litSeed) < (w.litChance ?? 0.55)) return [roomLit[Math.floor(hash3(cell, floor * 7, side) * roomLit.length)], W];
    return [w.glass, 0];
  };
  eachWall(x0, z0, x1, z1, y0, y1, (x, y, z, side, u, len) => {
    const wall = typeof b.wall === 'function' ? b.wall(x, y, z, side, u) : b.wall;
    const fy = (y - y0) % floorH;
    const floor = Math.floor((y - y0) / floorH);
    const above = y >= y0 + (b.groundFloor ? floorH : 0);
    const edge = u === 0 || u === len - 1;
    if (!w || !above || edge) {
      g.set(x, y, z, wall);
      return;
    }
    const frame = w.frame ?? wall;
    const accent = w.accent ?? frame;
    if (style === 'curtain' || style === 'grid') {
      const mull = w.w + 1;
      const thick = style === 'grid' ? 1 : 0;
      if (fy <= thick - (style === 'curtain' ? 1 : 0) || (u % mull) === 0) {
        g.set(x, y, z, style === 'grid' ? wall : frame);
        return;
      }
      const [c, f] = glassAt(Math.floor(u / mull), floor, side);
      g.set(x, y, z, c, f);
      return;
    }
    if (style === 'ribbon') {
      if (fy >= w.sill && fy < w.sill + w.h) {
        if (u % (w.w + w.gap) === 0) {
          g.set(x, y, z, frame);
          return;
        }
        const [c, f] = glassAt(Math.floor(u / (w.w + w.gap)), floor, side);
        g.set(x, y, z, c, f);
        return;
      }
      g.set(x, y, z, wall);
      return;
    }
    const period = w.w + w.gap;
    // Centre the window pattern on the facade: gap, window, gap, window, ..., gap.
    const n = Math.max(1, Math.floor((len - w.gap) / period));
    const margin = Math.floor((len - n * period - w.gap) / 2);
    const pu = (u - margin + period * 10) % period;
    const inWin = pu >= w.gap && fy >= w.sill && fy < w.sill + w.h;
    let base = wall;
    if (style === 'stripes' && floor % 2) base = accent;
    if (style === 'tiles' && (Math.floor(u / 2) + floor) % 2) base = accent;
    if (inWin) {
      const top = fy === w.sill + w.h - 1;
      if (w.arch && top && (pu === w.gap || pu === period - 1)) {
        g.set(x, y, z, base);
        return;
      }
      const [c, f] = glassAt(Math.floor((u + period * 10) / period), floor, side);
      g.set(x, y, z, c, f);
      return;
    }
    if (w.frame && pu >= w.gap - 1 && fy >= w.sill - 1 && fy <= w.sill + w.h && (pu === w.gap - 1 || fy === w.sill - 1)) {
      g.set(x, y, z, w.frame);
      return;
    }
    g.set(x, y, z, base);
  });
}

// Vertical fins/piers standing one voxel proud of every facade.
export function fins(g, x0, z0, x1, z1, y0, y1, every, c) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x += every) {
      g.set(x, y, z1, c);
      g.set(x, y, z0 - 1, c);
    }
    for (let z = z0; z < z1; z += every) {
      g.set(x1, y, z, c);
      g.set(x0 - 1, y, z, c);
    }
  }
}

// Classical portico: a row of columns in front of the facade with a beam on top.
export function portico(g, x0, x1, z, y0, y1, c, spacing = 3) {
  for (let x = x0; x < x1; x += spacing) {
    g.box(x, y0, z, x + 1, y1, z + 2, c);
    g.set(x, y0, z, shade(c, 0.85));
  }
  g.box(x0 - 1, y1, z - 1, x1 + 1, y1 + 2, z + 3, c);
}

// Triangular pediment over a front face, stepped in voxels.
export function pediment(g, x0, x1, z0, z1, y, c) {
  const steps = Math.ceil((x1 - x0) / 4);
  for (let s = 0; s < steps; s++) g.box(x0 + s * 2, y + s, z0, x1 - s * 2, y + s + 1, z1, c);
}

// Half-ellipsoid dome.
export function dome(g, cx, cz, r, y, h, c, f = 0) {
  for (let yy = 0; yy < h; yy++) {
    const rr = r * Math.sqrt(1 - (yy / h) ** 2);
    g.cylinder(cx, cz, rr, y + yy, y + yy + 1, typeof c === 'function' ? c : (x, Y, z) => (Math.floor(Math.atan2(z - cz, x - cx) * 3) % 2 ? c : shade(c, 0.88)), f);
  }
}

// Steel scaffolding: poles and planks around a footprint.
export function scaffold(g, x0, z0, x1, z1, y0, y1) {
  const pole = 0xe0a020;
  const plank = 0x8a6a3a;
  for (let y = y0; y < y1; y++) {
    for (let x = x0 - 1; x <= x1; x += 3) {
      g.set(x, y, z0 - 2, pole);
      g.set(x, y, z1 + 1, pole);
    }
    for (let z = z0 - 1; z <= z1; z += 3) {
      g.set(x0 - 2, y, z, pole);
      g.set(x1 + 1, y, z, pole);
    }
    if ((y - y0) % 4 === 3) {
      for (let x = x0 - 2; x <= x1 + 1; x++) {
        g.set(x, y, z0 - 2, plank);
        g.set(x, y, z1 + 1, plank);
      }
      for (let z = z0 - 2; z <= z1 + 1; z++) {
        g.set(x0 - 2, y, z, plank);
        g.set(x1 + 1, y, z, plank);
      }
    }
  }
}

// One-voxel outset band around the footprint at height y.
export function cornice(g, x0, z0, x1, z1, y, c, h = 1) {
  for (let yy = y; yy < y + h; yy++) {
    for (let x = x0 - 1; x <= x1; x++) {
      g.set(x, yy, z0 - 1, c);
      g.set(x, yy, z1, c);
    }
    for (let z = z0; z < z1; z++) {
      g.set(x0 - 1, yy, z, c);
      g.set(x1, yy, z, c);
    }
  }
}

// Parapet rim on a flat roof.
export function parapet(g, x0, z0, x1, z1, y, c, h = 1) {
  eachWall(x0, z0, x1, z1, y, y + h, (x, yy, z) => g.set(x, yy, z, c));
}

export function pitchedRoof(g, x0, z0, x1, z1, y, c, alongX = true, overhang = 1) {
  const span = alongX ? z1 - z0 : x1 - x0;
  const steps = Math.ceil(span / 2) + 1;
  for (let s = 0; s < steps; s++) {
    const a = s - overhang;
    if (alongX) g.box(x0 - overhang, y + s, z0 + a, x1 + overhang, y + s + 1, z1 - a, (x, yy, z) => ((x + yy) % 3 === 0 ? shade(c, 0.85) : c));
    else g.box(x0 + a, y + s, z0 - overhang, x1 - a, y + s + 1, z1 + overhang, (x, yy, z) => ((z + yy) % 3 === 0 ? shade(c, 0.85) : c));
  }
  return y + steps;
}

// Clutter for flat roofs: AC units, vents, water tanks, antennas, solar panels, gardens.
export function roofClutter(g, rng, x0, z0, x1, z1, y, opts = {}) {
  const area = (x1 - x0) * (z1 - z0);
  const n = Math.max(1, Math.round(area / (opts.sparse ? 60 : 30)));
  const metal = opts.metal ?? 0xb9bcc2;
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(opts.kinds || ['ac', 'ac', 'ac', 'vent', 'tank', 'antenna', 'solar']);
    const x = rng.int(x0 + 1, x1 - 3);
    const z = rng.int(z0 + 1, z1 - 3);
    if (kind === 'ac') {
      g.box(x, y, z, x + 2, y + 2, z + 2, metal);
      g.set(x, y + 1, z + 2, 0x55585e);
    } else if (kind === 'vent') {
      g.box(x, y, z, x + 3, y + 1, z + 1, shade(metal, 0.85));
      g.set(x + 1, y + 1, z, 0x7a7d83);
    } else if (kind === 'tank') {
      g.cylinder(x + 1, z + 1, 1.6, y + 1, y + 4, opts.tank ?? 0x8b6e4e);
      g.set(x, y, z, 0x444444);
      g.set(x + 2, y, z + 2, 0x444444);
    } else if (kind === 'antenna') {
      const h = rng.int(3, 7);
      g.box(x, y, z, x + 1, y + h, z + 1, 0x8a8f96);
      g.set(x, y + h, z, 0xff3b3b, E);
    } else if (kind === 'solar') {
      g.box(x, y, z, x + 3, y + 1, z + 2, 0x23324d);
    } else if (kind === 'garden') {
      g.box(x, y, z, x + 3, y + 1, z + 3, (xx, yy, zz) => (hash3(xx, yy, zz) < 0.5 ? 0x4f8f34 : 0x67a83d));
      if (rng.chance(0.5)) g.box(x + 1, y + 1, z + 1, x + 2, y + 3, z + 2, 0x3f7f2c);
    } else if (kind === 'dish') {
      g.box(x, y, z, x + 1, y + 2, z + 1, 0x8a8f96);
      g.box(x - 1, y + 2, z - 1, x + 2, y + 3, z + 2, 0xd8dade);
    }
  }
}

export function garden(g, rng, x0, z0, x1, z1, y, density = 0.7) {
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      if (rng.chance(density)) g.set(x, y, z, rng.pick([0x4c8a30, 0x5f9e38, 0x72b043, 0x3d7a2a]));
      if (rng.chance(density * 0.18)) {
        const h = rng.int(1, 3);
        for (let k = 1; k <= h; k++) g.set(x, y + k, z, rng.pick([0x3d7a2a, 0x4c8a30]));
      }
    }
}

// Ivy hanging down facades (needs a 1-voxel margin around the body).
export function vines(g, rng, x0, z0, x1, z1, yTop, amount = 0.25) {
  const greens = [0x3f7f2c, 0x4f8f34, 0x5f9e38, 0x2f6b25];
  const drop = (x, z) => {
    const len = rng.int(2, Math.max(3, Math.floor(yTop * 0.6)));
    for (let k = 0; k < len; k++) {
      const y = yTop - k;
      if (y < 0) break;
      if (rng.chance(0.85)) g.set(x, y, z, rng.pick(greens));
    }
  };
  for (let x = x0; x < x1; x++) {
    if (rng.chance(amount)) drop(x, z1);
    if (rng.chance(amount)) drop(x, z0 - 1);
  }
  for (let z = z0; z < z1; z++) {
    if (rng.chance(amount)) drop(x1, z);
    if (rng.chance(amount)) drop(x0 - 1, z);
  }
}

// A glowing sign panel on a facade with blocky glyphs.
export function sign(g, rng, side, cx, y, len, h, frontAt, colors, opts = {}) {
  const fg = rng.pick(colors);
  const bg = opts.bg ?? 0x15151c;
  for (let u = 0; u < len; u++) {
    for (let v = 0; v < h; v++) {
      const border = u === 0 || v === 0 || u === len - 1 || v === h - 1;
      const glyph = !border && hash3(u >> 1, v, opts.seed ?? 7) < 0.5 && (u % 3 !== 0);
      const c = border ? (opts.frame ?? fg) : glyph ? fg : bg;
      const f = border || glyph ? E : 0;
      const p = sideCoord(side, cx - Math.floor(len / 2) + u, frontAt);
      g.set(p.x, y + v, p.z, c, opts.frame && border ? 0 : f);
    }
  }
}

// Converts (along, out) coordinates for a side into grid x/z.
export function sideCoord(side, along, at) {
  if (side === 0) return { x: along, z: at };
  if (side === 1) return { x: along, z: at };
  if (side === 2) return { x: at, z: along };
  return { x: at, z: along };
}

// Striped awning along the front face.
export function awning(g, x0, x1, y, z, colors, depth = 2) {
  for (let x = x0; x < x1; x++) {
    const c = colors[Math.floor((x - x0) / 2) % colors.length];
    for (let d = 0; d < depth; d++) g.set(x, y - d, z + d, c);
  }
}

export function neonStrip(g, x, y0, y1, z, c) {
  for (let y = y0; y < y1; y++) g.set(x, y, z, c, E);
}

export function brick(c1, c2, mortar) {
  return (x, y, z) => {
    if (y % 3 === 2) return mortar;
    const off = Math.floor(y / 3) % 2 ? 1 : 0;
    return (x + z + off) % 4 === 0 ? mortar : hash3(x, y, z) < 0.5 ? c1 : c2;
  };
}
