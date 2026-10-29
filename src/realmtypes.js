// What the kaiju finds past the city: the solar system, the galaxy, the multiverse and, at the
// far end, a back garden. Building-sized things (planets, stars, galaxies, mushrooms, shrubs)
// join the building catalog and smaller ones (satellites, crumbs, grass) the prop catalog, so
// they chip, crumble and collapse like the city does. Pure data: voxels only.
import { E, shade, mix, hash3 } from './voxel.js';

// ---------------------------------------------------------------- noise and shapes
function vnoise3(x, y, z, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => hash3(a + s * 7, b - s * 13, c + s * 31);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function fbm3(x, y, z, s, oct = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise3(x, y, z, s + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

// A ball centred at (cx, cy, cz) in voxels. colour(nx, ny, nz, x, y, z) gets the unit direction
// from the centre (null leaves a gap). `bump` roughens the surface; `core` fills the inside with a
// glowing colour that shows once the ball is chipped open.
function ball(g, cx, cy, cz, r, colour, { f = 0, bump = 0, seed = 0, squash = 1, core = null } = {}) {
  const ry = r * squash;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x + 0.5 - cx;
        const dy = (y + 0.5 - cy) / squash;
        const dz = z + 0.5 - cz;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        const R = bump ? r * (1 - bump * 0.5 + bump * fbm3(nx * 2.2 + 5, ny * 2.2, nz * 2.2, seed)) : r;
        if (d > R) continue;
        if (core !== null && d < R - 1.8) {
          g.set(x, y, z, core, E);
          continue;
        }
        const c = colour(nx, ny, nz, x, y, z);
        if (c === null || c === undefined) continue;
        g.set(x, y, z, c, typeof f === 'function' ? f(nx, ny, nz, x, y, z) : f);
      }
    }
  }
}

// Craters: random dents on a ball's surface; returns 0 (none), 1 (rim) or 2 (floor).
function craters(rng, n, size) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const u = rng.range(-1, 1);
    const s = Math.sqrt(1 - u * u);
    list.push({ x: s * Math.cos(a), y: u, z: s * Math.sin(a), r: rng.range(size * 0.5, size * 1.3) });
  }
  return (nx, ny, nz) => {
    for (const c of list) {
      const ang = Math.acos(Math.max(-1, Math.min(1, nx * c.x + ny * c.y + nz * c.z)));
      if (ang < c.r * 0.75) return 2;
      if (ang < c.r) return 1;
    }
    return 0;
  };
}

const rsz = (bx, bz, by) => (rng) => ({ bx: rng.int(bx[0], bx[1]), bz: rng.int(bz[0], bz[1]), by: rng.int(by[0], by[1]) });
// A round thing `d` voxels across, floating `lift` voxels up.
const roundDims = (d, lift = [2, 5], extra = 0) => (rng) => {
  const D = rng.int(d[0], d[1]);
  const L = rng.int(lift[0], lift[1]);
  return { bx: D + extra, bz: D + extra, by: D + L, D, L };
};

// ---------------------------------------------------------------- the solar system
function asteroid(g, rng, d) {
  const m = d.m;
  const base = rng.pick([0x8a8378, 0x6f6a64, 0x9a8a72, 0x7a6a5a]);
  const hit = craters(rng, 6, 0.35);
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    const c = hit(nx, ny, nz);
    const n = hash3(x, y, z);
    if (c === 2) return shade(base, 0.62 + n * 0.08);
    if (c === 1) return shade(base, 1.15);
    return n < 0.2 ? shade(base, 0.85) : n > 0.93 ? shade(base, 1.2) : base;
  }, { bump: 0.45, seed: rng.int(0, 999), squash: rng.range(0.7, 1), core: rng.chance(0.3) ? 0xffb347 : null });
}

function moon(g, rng, d) {
  const m = d.m;
  const base = rng.pick([0xc8c6c0, 0xb8b2a6, 0xd6d0c4, 0xa8a8b0]);
  const hit = craters(rng, 11, 0.32);
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    const c = hit(nx, ny, nz);
    const mare = fbm3(nx * 1.7, ny * 1.7, nz * 1.7, 4) > 0.58;
    let col = mare ? shade(base, 0.72) : base;
    if (c === 2) col = shade(col, 0.7);
    else if (c === 1) col = shade(col, 1.12);
    return hash3(x, y, z) < 0.15 ? shade(col, 0.92) : col;
  }, { core: 0x8a7a6a });
}

function spaceStation(g, rng, d) {
  const m = d.m;
  const y = 4;
  const cz = m + Math.floor(d.bz / 2);
  // Truss along x, modules across it, solar wings at both ends.
  g.box(m, y + 1, cz, m + d.bx, y + 2, cz + 1, 0xb8bcc4);
  for (let x = m; x < m + d.bx; x += 2) g.set(x, y + 2, cz, 0x8a8f98);
  const mods = [m + Math.floor(d.bx * 0.35), m + Math.floor(d.bx * 0.55)];
  for (const mx of mods) {
    g.box(mx - 1, y, cz - 4, mx + 2, y + 3, cz + 5, 0xeef0f2);
    for (let z = cz - 4; z < cz + 5; z += 2) g.set(mx + 2, y + 1, z, 0xffe9a8, E);
  }
  g.box(mods[0], y + 3, cz - 1, mods[1] + 1, y + 4, cz + 2, 0xd8dade);
  for (const x0 of [m, m + d.bx - 4]) {
    for (const side of [-1, 1]) {
      const z0 = side < 0 ? cz - 6 : cz + 2;
      g.box(x0, y + 1, z0, x0 + 4, y + 2, z0 + 5, (x, yy, z) => ((x + z) % 3 === 0 ? 0x5a6a8a : 0x24346a));
    }
  }
  g.set(mods[1], y + 4, cz, 0xff3b3b, E);
}

function comet(g, rng, d) {
  const m = d.m;
  const hr = 4.2;
  const cx = m + d.bx - hr - 1;
  const cy = d.by / 2;
  const cz = m + d.bz / 2;
  ball(g, cx, cy, cz, hr, (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.25 ? 0xb8d8e8 : 0xeef6fa), { bump: 0.3, seed: 3 });
  // The tail streams away from the head, thinning out and fading from white to cyan.
  for (let x = m; x < cx - hr + 1; x++) {
    const t = (cx - x) / (cx - m);
    const r = hr * (0.6 + t * 0.7);
    for (let z = Math.floor(cz - r); z <= cz + r; z++) {
      for (let y = Math.floor(cy - r * 0.7); y <= cy + r * 0.7; y++) {
        if (Math.hypot(z + 0.5 - cz, (y + 0.5 - cy) / 0.7) > r) continue;
        if (hash3(x, y, z) > 0.75 - t * 0.55) continue;
        g.set(x, y, z, mix(0xeaffff, 0x4fd8ff, t), E);
      }
    }
  }
}

function planetRed(g, rng, d) {
  const m = d.m;
  const s = rng.int(0, 999);
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    if (Math.abs(ny) > 0.86) return 0xf4ece6;
    const n = fbm3(nx * 2, ny * 2, nz * 2, s);
    const canyon = Math.abs(fbm3(nx * 3, ny * 3, nz * 3, s + 9) - 0.5) < 0.035;
    if (canyon) return 0x6a2a18;
    const col = n > 0.56 ? 0xa8442a : n > 0.44 ? 0xc65a32 : 0xd87a48;
    return hash3(x, y, z) < 0.12 ? shade(col, 0.9) : col;
  }, { core: 0xff6a1a });
}

function planetEarth(g, rng, d) {
  const m = d.m;
  const s = d.home ? 7 : rng.int(0, 999);
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    if (Math.abs(ny) > 0.88) return 0xf6fbff;
    if (fbm3(nx * 2.6 + 30, ny * 2.6, nz * 2.6, s + 5) > 0.62) return 0xffffff;
    const land = fbm3(nx * 1.6, ny * 1.6, nz * 1.6, s);
    if (land > 0.53) {
      if (land > 0.66) return 0x8a7a5a;
      if (Math.abs(ny) < 0.25 && land < 0.58) return 0xd8c07a;
      return hash3(x, y, z) < 0.2 ? 0x3f8a3a : 0x4f9d3a;
    }
    return land > 0.48 ? 0x3a8ad8 : 0x1f5aa8;
  }, { core: 0xff7a1a });
  if (d.home) {
    // Where the city used to be: a smoking crater with a few lights still on.
    const cx = m + d.bx / 2;
    const cz = m + d.bz / 2;
    const top = d.L + d.D;
    for (let z = Math.floor(cz - 3); z <= cz + 3; z++) for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (r > 3.2) continue;
      for (let y = top; y >= top - 4; y--) {
        if (!g.get(x, y, z)) continue;
        g.set(x, y, z, r < 1.5 ? 0x3a2a24 : hash3(x, y, z) < 0.3 ? 0xffc36b : 0x5a4a40, r >= 1.5 && hash3(x, y, z) < 0.3 ? E : 0);
        break;
      }
    }
  }
}

const GIANT_BANDS = [
  [0xe8c89a, 0xd8a870, 0xf2e2c4, 0xb8845a, 0xe0b888],
  [0xc8d8e8, 0xa8c0d8, 0xe8f0f6, 0x8aa8c8],
  [0xe8d8a8, 0xd0b878, 0xf6ecc8, 0xc8a060],
];

function gasGiant(g, rng, d) {
  const m = d.m;
  const bands = GIANT_BANDS[rng.int(0, GIANT_BANDS.length - 1)];
  const s = rng.int(0, 999);
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.L + d.D / 2;
  const R = d.D / 2;
  const spot = { x: rng.range(-0.7, 0.7), y: -0.35 };
  ball(g, cx, cy, cz, R, (nx, ny, nz, x, y, z) => {
    if (Math.hypot(nx - spot.x, ny - spot.y) < 0.18 && nz > 0) return 0xc8503a;
    const t = ny * 4.5 + (fbm3(nx * 2, ny * 6, nz * 2, s) - 0.5) * 1.6;
    const col = bands[((Math.floor(t) % bands.length) + bands.length) % bands.length];
    return hash3(x, y, z) < 0.1 ? shade(col, 0.93) : col;
  }, { squash: 0.94, core: 0xffd08a });
  if (d.ring) {
    const rIn = R * 1.3;
    const rOut = d.bx / 2 - 0.5;
    const ringCol = [0xd8cfc0, 0xb8ae9a, 0xece4d4, 0x9a907e];
    for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (r < rIn || r > rOut || hash3(x, 9, z) < 0.12) continue;
      g.set(x, Math.floor(cy), z, ringCol[Math.floor(((r - rIn) / (rOut - rIn)) * 6) % ringCol.length]);
    }
  }
}

function planetIce(g, rng, d) {
  const m = d.m;
  const s = rng.int(0, 999);
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    const t = fbm3(nx * 1.4, ny * 4, nz * 1.4, s);
    const col = t > 0.6 ? 0xd8f4ff : t > 0.45 ? 0x7ac8e8 : 0x4a8ad0;
    return hash3(x, y, z) < 0.1 ? shade(col, 1.08) : col;
  }, { core: 0x9ae8ff });
}

function sun(g, rng, d) {
  const m = d.m;
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    const n = fbm3(nx * 3, ny * 3, nz * 3, 21);
    if (n > 0.66) return 0xd8501a;
    return n > 0.52 ? 0xffb02a : hash3(x, y, z) < 0.2 ? 0xfff2a8 : 0xffd84a;
  }, { f: E, bump: 0.12, seed: 8 });
}

// ---------------------------------------------------------------- the galaxy
const starOf = (cols) => (g, rng, d) => {
  const m = d.m;
  ball(g, m + d.bx / 2, d.L + d.D / 2, m + d.bz / 2, d.D / 2, (nx, ny, nz, x, y, z) => {
    const n = fbm3(nx * 3, ny * 3, nz * 3, rng.int(0, 9));
    return n > 0.62 ? cols[2] : n > 0.48 ? cols[1] : hash3(x, y, z) < 0.15 ? cols[3] || cols[0] : cols[0];
  }, { f: E, bump: 0.15, seed: rng.int(0, 999) });
};

function solarSystem(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const y = 3;
  ball(g, cx, y + 0.5, cz, 2.6, () => 0xffd84a, { f: E });
  const orbits = [5, 8, 11];
  for (const [i, R] of orbits.entries()) {
    if (R > d.bx / 2 - 1) break;
    const steps = Math.round(R * 7);
    for (let k = 0; k < steps; k += 2) {
      const a = (k / steps) * Math.PI * 2;
      g.set(Math.floor(cx + Math.cos(a) * R), y, Math.floor(cz + Math.sin(a) * R), 0x5a5a7a);
    }
    const a = rng.range(0, Math.PI * 2);
    const col = [0xd87a48, 0x4f9dd8, 0xe8c89a][i];
    ball(g, cx + Math.cos(a) * R, y + 0.5, cz + Math.sin(a) * R, 1.2 + i * 0.4, () => col);
  }
}

function blackHole(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.by / 2;
  const R = d.bx / 2 - 0.5;
  // The accretion disk: a hot ring, white at the inner edge cooling to red, with gaps.
  for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / R;
    if (r > 1 || r < 0.32) continue;
    const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
    if (hash3(x, 3, z) < 0.15 + r * 0.35 || Math.sin(a * 3 + r * 9) > 0.85) continue;
    const col = r < 0.45 ? 0xfff6e0 : r < 0.6 ? 0xffd27a : r < 0.8 ? 0xff8a3a : 0xc8402a;
    g.set(x, Math.floor(cy), z, col, E);
    if (r < 0.55 && hash3(x, 4, z) < 0.5) g.set(x, Math.floor(cy) + 1, z, col, E);
  }
  ball(g, cx, cy, cz, R * 0.32, () => 0x07050a, { core: 0x07050a });
}

function nebula(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.by / 2;
  const s = rng.int(0, 999);
  const pal = rng.pick([[0xff6ab4, 0xb86aff, 0x6ad8ff], [0x6affc8, 0x6ab4ff, 0xd8ff6a], [0xff8a5a, 0xff5aa8, 0xffd86a]]);
  for (let y = 1; y < d.by; y++) for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const dx = (x + 0.5 - cx) / (d.bx / 2);
    const dy = (y + 0.5 - cy) / (d.by / 2);
    const dz = (z + 0.5 - cz) / (d.bz / 2);
    const r = Math.hypot(dx, dy, dz);
    if (r > 1) continue;
    const n = fbm3(x * 0.12, y * 0.12, z * 0.12, s);
    if (n < 0.5 + r * 0.18) continue;
    const t = fbm3(x * 0.05 + 9, y * 0.05, z * 0.05, s + 3);
    const col = t < 0.42 ? pal[0] : t < 0.56 ? pal[1] : pal[2];
    g.set(x, y, z, col, n > 0.66 ? E : 0);
  }
  for (let i = 0; i < 6; i++) g.set(m + rng.int(2, d.bx - 3), rng.int(2, d.by - 2), m + rng.int(2, d.bz - 3), 0xffffff, E);
}

function starCluster(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.by / 2;
  const R = d.bx / 2;
  const cols = [0xfff6d8, 0xffd27a, 0xbfe6ff, 0xffffff, 0xffb08a];
  for (let i = 0; i < 260; i++) {
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = R * Math.pow(rng.next(), 1.8);
    const s2 = Math.sqrt(1 - u * u);
    const x = Math.floor(cx + s2 * Math.cos(a) * r);
    const y = Math.floor(cy + u * r);
    const z = Math.floor(cz + s2 * Math.sin(a) * r);
    g.set(x, y, z, rng.pick(cols), E);
    if (r < R * 0.3) g.set(x, y + 1, z, rng.pick(cols), E);
  }
}

// ---------------------------------------------------------------- the multiverse
function spiralGalaxy(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.by / 2;
  const R = d.bx / 2;
  const twist = rng.range(2.6, 3.6);
  const arm = rng.pick([0x9fd8ff, 0xd6b8ff, 0xbfe6ff]);
  for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const dx = x + 0.5 - cx;
    const dz = z + 0.5 - cz;
    const r = Math.hypot(dx, dz) / R;
    if (r > 1) continue;
    const a = Math.atan2(dz, dx);
    const w = Math.cos(2 * (a - twist * Math.log(r + 0.08)));
    const h = hash3(x, 0, z);
    if (r < 0.2) {
      const t = Math.round((1 - r / 0.2) * 2.5);
      for (let y = Math.floor(cy) - t; y <= Math.floor(cy) + t; y++) g.set(x, y, z, r < 0.1 ? 0xffffff : 0xfff2c8, E);
    } else if (w > 0.45 - r * 0.2 && h > r * 0.45) {
      g.set(x, Math.floor(cy), z, h < 0.2 ? 0xffffff : arm, E);
    } else if (h > 0.82) {
      g.set(x, Math.floor(cy), z, 0x4a3a6a);
    }
  }
}

function ellipticalGalaxy(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = d.by / 2;
  for (let y = 0; y < d.by; y++) for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const r = Math.hypot((x + 0.5 - cx) / (d.bx / 2), (y + 0.5 - cy) / (d.by / 2), (z + 0.5 - cz) / (d.bz / 2));
    if (r > 1 || hash3(x, y, z) < r * 0.85) continue;
    g.set(x, y, z, r < 0.3 ? 0xfff2d0 : r < 0.6 ? 0xffd08a : 0xffa86a, E);
  }
}

function quasar(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const cy = Math.floor(d.by * 0.4);
  for (let z = m; z < m + d.bz; z++) for (let x = m; x < m + d.bx; x++) {
    const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / (d.bx / 2);
    if (r > 1 || r < 0.25 || hash3(x, 1, z) < r * 0.4) continue;
    g.set(x, cy, z, r < 0.5 ? 0xffe8ff : 0xb86aff, E);
  }
  ball(g, cx, cy + 0.5, cz, 2.4, () => 0xffffff, { f: E });
  // Jets of light straight up and down from the core.
  for (let y = 0; y < d.by; y++) {
    if (Math.abs(y - cy) < 2) continue;
    const t = Math.abs(y - cy) / d.by;
    const r = 0.8 + t * 2.2;
    for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > r || hash3(x, y, z) < t * 1.3) continue;
      g.set(x, y, z, t < 0.2 ? 0xeaffff : 0x6ad8ff, E);
    }
  }
}

// A whole universe: a soap-bubble skin with galaxies floating inside.
function universe(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const R = d.D / 2;
  const cy = d.L + R;
  const s = rng.int(0, 999);
  ball(g, cx, cy, cz, R, (nx, ny, nz, x, y, z) => {
    const n = fbm3(nx * 3, ny * 3, nz * 3, s);
    if (n < 0.47) return null;
    return n > 0.6 ? 0xffd8f4 : ny > 0.2 ? 0xc8f0ff : 0xe0d0ff;
  }, { f: (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.25 ? E : 0) });
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz) < R - 1.3) g.clear(x, y, z);
  }
  // Galaxies inside, each a little swirl of light.
  for (let i = 0; i < 9; i++) {
    const u = rng.range(-1, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = R * 0.6 * Math.cbrt(rng.next());
    const gx = cx + Math.sqrt(1 - u * u) * Math.cos(a) * r;
    const gy = cy + u * r * 0.7;
    const gz = cz + Math.sqrt(1 - u * u) * Math.sin(a) * r;
    const col = rng.pick([0xfff2c8, 0x9fd8ff, 0xffb8e8, 0xd6b8ff]);
    g.set(Math.floor(gx), Math.floor(gy), Math.floor(gz), 0xffffff, E);
    for (let k = 0; k < 8; k++) {
      const t = k * 0.8;
      g.set(Math.floor(gx + Math.cos(t) * k * 0.35), Math.floor(gy), Math.floor(gz + Math.sin(t) * k * 0.35), col, E);
      g.set(Math.floor(gx - Math.cos(t) * k * 0.35), Math.floor(gy), Math.floor(gz - Math.sin(t) * k * 0.35), col, E);
    }
  }
}

function galaxyCluster(g, rng, d) {
  const m = d.m;
  const cy = Math.floor(d.by / 2);
  for (let i = 0; i < 7; i++) {
    const R = rng.range(3, 6);
    const gx = m + rng.range(R, d.bx - R);
    const gz = m + rng.range(R, d.bz - R);
    const gy = cy + rng.int(-2, 2);
    const col = rng.pick([0x9fd8ff, 0xffd08a, 0xd6b8ff, 0xffb8e8]);
    for (let z = Math.floor(gz - R); z <= gz + R; z++) for (let x = Math.floor(gx - R); x <= gx + R; x++) {
      const r = Math.hypot(x + 0.5 - gx, z + 0.5 - gz) / R;
      if (r > 1) continue;
      const a = Math.atan2(z + 0.5 - gz, x + 0.5 - gx);
      if (r > 0.25 && Math.cos(2 * (a - 3 * Math.log(r + 0.1))) < 0.4) continue;
      g.set(x, gy, z, r < 0.25 ? 0xffffff : col, E);
    }
  }
  for (let i = 0; i < 40; i++) g.set(m + rng.int(0, d.bx - 1), cy + rng.int(-3, 3), m + rng.int(0, d.bz - 1), 0x6a5a9a);
}

// ---------------------------------------------------------------- the back garden
function mushroom(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const stem = Math.floor(d.by * 0.55);
  g.cylinder(cx, cz, 1.3, 0, stem, (x, y) => (y < 1 ? 0xd8ccb0 : 0xf2ead8));
  const cap = rng.pick([0xd93a2a, 0xc8642a, 0x8a5a3a, 0xe0b04a]);
  const spots = cap === 0xd93a2a || rng.chance(0.4);
  ball(g, cx, stem, cz, d.bx / 2 - 0.2, (nx, ny, nz, x, y, z) => {
    if (ny < 0.05) return ny > -0.2 ? 0xf2e2c8 : null;
    return spots && hash3(x >> 1, y >> 1, z >> 1) < 0.18 ? 0xfff6ec : cap;
  }, { squash: 0.75 });
}

function pebble(g, rng, d) {
  const m = d.m;
  const base = rng.pick([0x9a948a, 0xb8aa98, 0x7a7a80, 0xc8bca8]);
  ball(g, m + d.bx / 2, d.by * 0.4, m + d.bz / 2, d.bx / 2, (nx, ny, nz, x, y, z) => (ny < -0.45 ? null : hash3(x, y, z) < 0.25 ? shade(base, 0.9) : base), { squash: (d.by * 0.95) / d.bx, bump: 0.25, seed: rng.int(0, 99) });
}

function daisy(g, rng, d) {
  const m = d.m;
  const cx = Math.floor(m + d.bx / 2);
  const cz = Math.floor(m + d.bz / 2);
  const top = d.by - 2;
  g.box(cx, 0, cz, cx + 1, top, cz + 1, 0x4a9a3a);
  g.box(cx - 2, 2, cz, cx, 3, cz + 1, 0x5aa845);
  g.box(cx + 1, 4, cz, cx + 3, 5, cz + 1, 0x5aa845);
  const petal = rng.pick([0xffffff, 0xffffff, 0xffd8ec, 0xfff2a8]);
  for (let z = cz - 3; z <= cz + 3; z++) for (let x = cx - 3; x <= cx + 3; x++) {
    const r = Math.hypot(x - cx, z - cz);
    if (r > 3.3) continue;
    g.set(x, top, z, r < 1.2 ? 0xf2c12e : petal);
  }
  g.set(cx, top + 1, cz, 0xe8a81a);
}

function dandelion(g, rng, d) {
  const m = d.m;
  const cx = Math.floor(m + d.bx / 2);
  const cz = Math.floor(m + d.bz / 2);
  const r = d.bx / 2 - 0.4;
  const cy = d.by - r - 0.5;
  g.box(cx, 0, cz, cx + 1, Math.floor(cy), cz + 1, 0x6aaa4a);
  ball(g, cx + 0.5, cy, cz + 0.5, r, (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.35 ? null : hash3(x, y + 1, z) < 0.2 ? 0xd8d8d0 : 0xffffff));
  g.set(cx, Math.floor(cy), cz, 0xc8b88a);
}

function snail(g, rng, d) {
  const m = d.m;
  const z0 = m + Math.floor(d.bz / 2) - 1;
  g.box(m, 0, z0, m + d.bx, 2, z0 + 3, 0xc8b8a0);
  g.box(m + d.bx - 2, 2, z0, m + d.bx, 4, z0 + 3, 0xc8b8a0);
  g.set(m + d.bx - 1, 5, z0, 0x5a4a3a);
  g.set(m + d.bx - 1, 5, z0 + 2, 0x5a4a3a);
  const cx = m + d.bx * 0.4;
  const cy = 2 + d.bz * 0.42;
  const shell = rng.pick([[0xa8642a, 0xe0b06a], [0xc87a4a, 0xf2d8a8], [0x8a5a3a, 0xd8a86a]]);
  ball(g, cx, cy, m + d.bz / 2, d.bz * 0.42, (nx, ny, nz) => {
    const a = Math.atan2(ny, nx);
    return Math.sin(a * 2 + Math.hypot(nx, ny) * 9) > 0.3 ? shell[0] : shell[1];
  }, { squash: 1.05 });
}

function pinecone(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  for (let y = 0; y < d.by; y++) {
    const t = y / d.by;
    const r = (d.bx / 2) * Math.sin(Math.min(1, t * 1.15 + 0.12) * Math.PI) * 0.95;
    g.cylinder(cx, cz, Math.max(0.6, r), y, y + 1, (x, yy, z) => ((x + yy + z) % 2 ? 0x8a5a32 : 0x6a4224));
  }
}

function toyCar(g, rng, d) {
  const m = d.m;
  const c = rng.pick([0xe83a3a, 0x3a7ae8, 0xf2c12e, 0x3ac85a]);
  const L = d.bx;
  const Wd = d.bz;
  g.box(m, 1, m, m + L, 3, m + Wd, c);
  g.box(m + 2, 3, m, m + L - 3, 5, m + Wd, c);
  g.box(m + 3, 3, m, m + L - 4, 4, m + Wd, 0x9fd8ff);
  for (const x of [m + 1, m + L - 3]) for (const z of [m - 1, m + Wd]) g.box(x, 0, z, x + 2, 2, z + 1, 0x1a1a1a);
  g.set(m + L - 1, 2, m + 1, 0xfff6a8, E);
  g.set(m + L - 1, 2, m + Wd - 2, 0xfff6a8, E);
}

function legoBrick(g, rng, d) {
  const m = d.m;
  const c = rng.pick([0xf2c12e, 0xe83a3a, 0x3a7ae8, 0x3ac85a, 0xf2f2f2]);
  g.box(m, 0, m, m + d.bx, d.by - 1, m + d.bz, (x, y, z) => (y === d.by - 2 ? shade(c, 1.08) : c));
  for (let x = m + 1; x < m + d.bx; x += 2) for (let z = m + 1; z < m + d.bz; z += 2) g.set(x, d.by - 1, z, shade(c, 1.12));
}

function shrub(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const greens = [0x3e8e41, 0x4f9d3a, 0x2f7a3a, 0x5aa845];
  const bloom = rng.pick([null, 0xff8ac8, 0xffffff, 0xffd84a]);
  g.cylinder(cx, cz, 1, 0, 3, 0x5a3d26);
  ball(g, cx, d.by * 0.55, cz, d.bx / 2, (nx, ny, nz, x, y, z) => {
    const h = hash3(x, y, z);
    if (h < 0.1) return null;
    if (bloom && h > 0.95 && ny > -0.2) return bloom;
    return greens[Math.floor(hash3(x * 3, y, z) * greens.length)];
  }, { squash: (d.by * 0.5) / (d.bx / 2), bump: 0.3, seed: rng.int(0, 99) });
}

function flowerPot(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const potH = Math.floor(d.by * 0.45);
  for (let y = 0; y < potH; y++) g.cylinder(cx, cz, d.bx / 2 - 1.5 + (y / potH) * 1.2, y, y + 1, y === potH - 1 ? 0xd8805a : 0xc8643a);
  g.cylinder(cx, cz, d.bx / 2 - 1.2, potH - 1, potH, 0x4a3424);
  const petal = rng.pick([0xff5a8a, 0xffd84a, 0xb86aff, 0xff8a3a]);
  for (let i = 0; i < 3; i++) {
    const fx = Math.floor(cx + (i - 1) * 2.5);
    const fz = Math.floor(cz + (i === 1 ? 1 : -1));
    const top = d.by - 2 - (i % 2) * 2;
    g.box(fx, potH, fz, fx + 1, top, fz + 1, 0x4a9a3a);
    for (let z = fz - 1; z <= fz + 1; z++) for (let x = fx - 1; x <= fx + 1; x++) g.set(x, top, z, x === fx && z === fz ? 0xf2c12e : petal);
    g.set(fx, top + 1, fz, petal);
  }
}

function gnome(g, rng, d) {
  const m = d.m;
  const cx = m + d.bx / 2;
  const cz = m + d.bz / 2;
  const coat = rng.pick([0x3a6ad8, 0x3a9a5a, 0x8a5ad8]);
  g.cylinder(cx, cz, 2.6, 0, 2, 0x5a3a24);
  g.cylinder(cx, cz, 2.8, 2, 7, coat);
  g.cylinder(cx, cz, 2.9, 4, 5, 0x3a2a1a);
  g.cylinder(cx, cz, 2.4, 7, 10, 0xf2c8a8);
  // A big white beard down the front, a round nose, and the pointy red hat.
  g.box(Math.floor(cx) + 1, 5, Math.floor(cz) - 2, Math.floor(cx) + 3, 9, Math.floor(cz) + 2, 0xf6f2ea);
  g.set(Math.floor(cx) + 3, 9, Math.floor(cz), 0xf0a890);
  g.set(Math.floor(cx) + 2, 10, Math.floor(cz) - 1, 0x1a1a1a);
  g.set(Math.floor(cx) + 2, 10, Math.floor(cz) + 1, 0x1a1a1a);
  for (let y = 10; y < d.by; y++) g.cylinder(cx - (y - 10) * 0.15, cz, Math.max(0.5, 2.8 * (1 - (y - 10) / (d.by - 10))), y, y + 1, 0xd9362a);
}

function wateringCan(g, rng, d) {
  const m = d.m;
  const c = rng.pick([0x3a9a5a, 0x3a7ad8, 0xd8a83a]);
  const cz = m + d.bz / 2;
  const cx = m + 6;
  g.cylinder(cx, cz, 3.8, 0, 7, (x, y) => (y === 6 ? shade(c, 1.15) : c));
  for (let i = 0; i < 7; i++) g.box(cx + 3 + i, 2 + i, Math.floor(cz), cx + 4 + i, 3 + i, Math.floor(cz) + 1, shade(c, 0.9));
  g.box(cx + 9, 8, Math.floor(cz) - 1, cx + 11, 10, Math.floor(cz) + 2, shade(c, 0.8));
  for (let i = -3; i <= 3; i++) g.set(Math.floor(cx + i), 8 + (Math.abs(i) < 3 ? 1 : 0), Math.floor(cz), shade(c, 0.85));
}

function sunflower(g, rng, d) {
  const m = d.m;
  const cx = Math.floor(m + d.bx / 2);
  const cz = Math.floor(m + d.bz / 2);
  const top = d.by - 2;
  g.box(cx, 0, cz, cx + 1, top, cz + 1, 0x5a9a3a);
  for (const y of [6, 12, 18]) {
    g.box(cx - 3, y, cz, cx, y + 1, cz + 1, 0x4a8a3a);
    g.box(cx + 1, y + 2, cz, cx + 4, y + 3, cz + 1, 0x4a8a3a);
  }
  for (let z = cz - 4; z <= cz + 4; z++) for (let x = cx - 4; x <= cx + 4; x++) {
    const r = Math.hypot(x - cx, z - cz);
    if (r > 4.4) continue;
    g.set(x, top, z, r < 2.3 ? (hash3(x, top, z) < 0.5 ? 0x5a3a1a : 0x7a4a24) : 0xf2c12e);
  }
}

function rock(g, rng, d) {
  const m = d.m;
  const base = rng.pick([0x8a8a8a, 0x9a9488, 0x7a7670]);
  ball(g, m + d.bx / 2, d.by * 0.35, m + d.bz / 2, d.bx / 2, (nx, ny, nz, x, y, z) => {
    if (ny < -0.4) return null;
    if (ny > 0.55 && fbm3(nx * 3, ny * 3, nz * 3, 5) > 0.5) return 0x5a8a3a;
    return hash3(x, y, z) < 0.2 ? shade(base, 0.88) : base;
  }, { squash: (d.by * 0.75) / (d.bx / 2), bump: 0.35, seed: rng.int(0, 99) });
}

// ---------------------------------------------------------------- catalog
// tier: size class (see config canDamage); v: world units per voxel. `vanish`: in space there is
// no ground for rubble to land on, so it scatters instead. `extra`: spare rows above the model.
const RB = (id, name, tier, style, v, size, build, more = {}) => ({ id, name, tier, style, zones: [], v, size, build, weight: 0, extra: 2, ...more });
const SPACE = { vanish: true };

export const REALM_BUILDINGS = [
  // The solar system (size 7).
  RB('asteroid', 'Asteroid', 7, 'space', 2.2, roundDims([9, 14], [2, 6]), asteroid, SPACE),
  RB('moon', 'Moon', 7, 'space', 2.4, roundDims([15, 19], [2, 5]), moon, SPACE),
  RB('space_station', 'Space station', 7, 'space', 2.2, rsz([18, 22], [12, 13], [9, 9]), spaceStation, SPACE),
  RB('comet', 'Comet', 7, 'space', 2, rsz([22, 26], [9, 10], [11, 11]), comet, SPACE),
  RB('planet_red', 'Red planet', 8, 'space', 3, roundDims([22, 26], [2, 4]), planetRed, SPACE),
  RB('planet_earth', 'Blue planet', 8, 'space', 3, roundDims([24, 27], [2, 4]), planetEarth, SPACE),
  RB('earth', 'Earth', 8, 'space', 3, () => ({ bx: 26, bz: 26, by: 29, D: 26, L: 3, home: true }), planetEarth, SPACE),
  RB('gas_giant', 'Gas giant', 8, 'space', 3.4, (rng) => { const D = rng.int(26, 30); const ring = rng.chance(0.6); const W = ring ? Math.round(D * 1.75) : D; return { bx: W, bz: W, by: D + 3, D, L: 3, ring }; }, gasGiant, SPACE),
  RB('planet_ice', 'Ice giant', 8, 'space', 3, roundDims([20, 24], [2, 4]), planetIce, SPACE),
  RB('sun', 'The Sun', 8, 'space', 3.5, () => ({ bx: 40, bz: 40, by: 43, D: 40, L: 3 }), sun, SPACE),
  // The galaxy (size 8).
  RB('star_yellow', 'Yellow star', 8, 'space', 2.6, roundDims([12, 14], [3, 6]), starOf([0xffe46a, 0xfff6c8, 0xffb02a, 0xffd84a]), SPACE),
  RB('star_red', 'Red giant', 8, 'space', 2.6, roundDims([15, 18], [3, 5]), starOf([0xff6a3a, 0xffa86a, 0xc8301a, 0xff8a4a]), SPACE),
  RB('star_blue', 'Blue star', 8, 'space', 2.6, roundDims([9, 11], [4, 7]), starOf([0x9fd8ff, 0xffffff, 0x6ab4ff, 0xc8ecff]), SPACE),
  RB('solar_system', 'Solar system', 8, 'space', 2.2, rsz([24, 24], [24, 24], [6, 6]), solarSystem, SPACE),
  RB('black_hole', 'Black hole', 9, 'space', 3, rsz([26, 30], [26, 30], [10, 10]), blackHole, { ...SPACE, square: true }),
  RB('nebula', 'Nebula', 9, 'space', 3, rsz([30, 36], [26, 34], [14, 16]), nebula, SPACE),
  RB('star_cluster', 'Star cluster', 9, 'space', 3, rsz([26, 28], [26, 28], [26, 28]), starCluster, { ...SPACE, square: true }),
  // The multiverse (size 9).
  RB('galaxy_spiral', 'Spiral galaxy', 9, 'space', 2.4, rsz([20, 24], [20, 24], [5, 5]), spiralGalaxy, { ...SPACE, square: true }),
  RB('galaxy_elliptical', 'Elliptical galaxy', 9, 'space', 2.4, rsz([16, 20], [12, 15], [9, 10]), ellipticalGalaxy, SPACE),
  RB('quasar', 'Quasar', 9, 'space', 2.2, rsz([12, 13], [12, 13], [26, 28]), quasar, { ...SPACE, square: true }),
  RB('universe', 'Universe', 10, 'space', 3.6, roundDims([30, 34], [2, 4]), universe, SPACE),
  RB('galaxy_cluster', 'Galaxy cluster', 10, 'space', 3, rsz([32, 36], [32, 36], [8, 8]), galaxyCluster, SPACE),
  // The back garden (sizes 10 and 11).
  RB('mushroom', 'Mushroom', 11, 'garden', 0.9, rsz([7, 9], [7, 9], [8, 10]), mushroom, { square: true }),
  RB('pebble', 'Pebble', 11, 'garden', 1, rsz([8, 10], [6, 8], [5, 6]), pebble),
  RB('daisy', 'Daisy', 11, 'garden', 0.8, rsz([7, 7], [7, 7], [11, 13]), daisy),
  RB('dandelion', 'Dandelion', 11, 'garden', 0.8, rsz([7, 7], [7, 7], [12, 14]), dandelion),
  RB('snail', 'Snail', 11, 'garden', 0.9, rsz([10, 11], [6, 7], [8, 8]), snail),
  RB('pinecone', 'Pinecone', 11, 'garden', 0.9, rsz([6, 7], [6, 7], [8, 9]), pinecone, { square: true }),
  RB('toy_car', 'Toy car', 11, 'garden', 1, rsz([10, 11], [5, 6], [6, 6]), toyCar),
  RB('lego_brick', 'Toy brick', 11, 'garden', 1.2, rsz([8, 8], [4, 4], [4, 4]), legoBrick),
  RB('shrub', 'Mini shrub', 12, 'garden', 1.4, rsz([13, 16], [13, 16], [12, 15]), shrub, { square: true }),
  RB('flower_pot', 'Flower pot', 12, 'garden', 1.3, rsz([10, 11], [10, 11], [12, 13]), flowerPot, { square: true }),
  RB('garden_gnome', 'Garden gnome', 12, 'garden', 1.4, rsz([8, 8], [8, 8], [16, 17]), gnome),
  RB('watering_can', 'Watering can', 12, 'garden', 1.3, rsz([18, 18], [8, 8], [11, 11]), wateringCan),
  RB('sunflower', 'Sunflower', 12, 'garden', 1.2, rsz([9, 9], [9, 9], [28, 32]), sunflower),
  RB('rock', 'Rock', 12, 'garden', 1.5, rsz([15, 18], [12, 15], [8, 10]), rock),
];

// ---------------------------------------------------------------- small things (props)
function satellite(g) {
  g.box(2, 3, 1, 5, 6, 4, 0xe0b43a);
  g.box(2, 3, 1, 5, 4, 4, 0xc8962a);
  g.box(0, 4, 2, 2, 5, 3, 0x24346a);
  g.box(5, 4, 2, 7, 5, 3, 0x24346a);
  g.set(3, 6, 2, 0xd8d8d8);
  g.set(4, 6, 2, 0xff3b3b, E);
}
function junk(g, rng) {
  for (let i = 0; i < 7; i++) g.set(rng.int(0, 4), rng.int(1, 4), rng.int(0, 4), rng.pick([0x8a8f98, 0xd8dade, 0xe0b43a, 0x5a5a62]));
  g.box(1, 2, 1, 4, 3, 3, 0x9aa0a8);
}
function rocklet(g, rng) {
  const base = rng.pick([0x8a8378, 0x6f6a64, 0x9a8a72]);
  ball(g, 2.5, 2.5, 2.5, 2.4, (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.25 ? shade(base, 0.8) : base), { bump: 0.4, seed: rng.int(0, 99) });
}
function astronaut(g) {
  g.box(0, 1, 0, 3, 4, 3, 0xf2f2f2);
  g.box(0, 4, 0, 3, 6, 3, 0xf2f2f2);
  g.set(2, 5, 1, 0xf2c12e, E);
  g.box(0, 2, 0, 1, 4, 3, 0xd8d8d8);
  g.set(1, 0, 0, 0xd8d8d8);
  g.set(1, 0, 2, 0xd8d8d8);
}
function rocket(g) {
  g.box(1, 2, 1, 2, 9, 2, 0xf2f2f2);
  g.set(1, 9, 1, 0xd9362a);
  g.set(1, 6, 1, 0x6ab4ff);
  g.box(0, 2, 1, 3, 3, 2, 0xd9362a);
  g.box(1, 2, 0, 2, 3, 3, 0xd9362a);
  g.set(1, 1, 1, 0xffb02a, E);
  g.set(1, 0, 1, 0xff6a2a, E);
}
function planetoid(g, rng) {
  const c = rng.pick([0xd87a48, 0x4f9dd8, 0x9ad86a, 0xd8b86a, 0xb86ad8]);
  ball(g, 2.5, 2.5, 2.5, 2.4, (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.3 ? shade(c, 0.82) : c));
}
function iceComet(g) {
  ball(g, 6, 2, 2, 1.8, () => 0xeef6fa);
  for (let x = 0; x < 5; x++) g.set(x, 2, 2, mix(0x4fd8ff, 0xeaffff, x / 5), E);
  for (let x = 1; x < 4; x++) {
    g.set(x, 2, 1, 0x4fd8ff, E);
    g.set(x, 2, 3, 0x4fd8ff, E);
  }
}
function dwarfGalaxy(g, rng) {
  const col = rng.pick([0x9fd8ff, 0xffd08a, 0xd6b8ff]);
  for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
    const r = Math.hypot(x + 0.5 - 3, z + 0.5 - 3);
    if (r < 1.2) g.set(x, 1, z, 0xffffff, E);
    else if (r < 3 && hash3(x, 0, z) > 0.45) g.set(x, 1, z, col, E);
  }
}
function nebulaPuff(g, rng) {
  const c = rng.pick([0xff6ab4, 0xb86aff, 0x6ad8ff]);
  ball(g, 3, 2.5, 3, 2.6, (nx, ny, nz, x, y, z) => (hash3(x, y, z) < 0.35 ? null : c), { f: (nx, ny, nz, x, y, z) => (hash3(x, y + 3, z) < 0.3 ? E : 0) });
}
function starlet(g, rng) {
  const c = rng.pick([0xfff6c8, 0x9fd8ff, 0xffb08a]);
  g.box(1, 1, 1, 2, 2, 2, 0xffffff, E);
  for (const [x, y, z] of [[0, 1, 1], [2, 1, 1], [1, 0, 1], [1, 2, 1], [1, 1, 0], [1, 1, 2]]) g.set(x, y, z, c, E);
}
function crumb(g, rng) {
  const c = rng.pick([0xd8a050, 0xc88a3a, 0xe8c07a]);
  g.box(0, 0, 0, 3, 1, 3, (x, y, z) => (hash3(x, y, z) < 0.3 ? shade(c, 0.85) : c));
  g.set(1, 1, 1, shade(c, 1.1));
  g.set(rng.int(0, 2), 1, rng.int(0, 2), c);
}
function seed(g) {
  g.box(0, 0, 0, 2, 1, 3, (x, y, z) => (x === 0 ? 0x2a2a2a : 0xe8e0c8));
}
function sugar(g) {
  g.box(0, 0, 0, 2, 2, 2, (x, y, z) => ((x + y + z) % 2 ? 0xffffff : 0xeef2f6));
}
function aphid(g) {
  g.box(0, 0, 0, 3, 1, 2, 0x8ad84a);
  g.box(1, 1, 0, 3, 2, 2, 0x9ae85a);
  g.set(2, 1, 0, 0x1a1a1a);
}
function sprout(g) {
  g.box(1, 0, 1, 2, 3, 2, 0x6aba4a);
  g.set(0, 3, 1, 0x8ad86a);
  g.set(2, 3, 1, 0x8ad86a);
  g.set(1, 3, 1, 0x7ac85a);
}
function grassTuft(g, rng) {
  const greens = [0x2f6e2a, 0x3e8e41, 0x4f9d3a, 0x6ab84a, 0x8ad05a];
  for (let i = 0; i < 12; i++) {
    let x = rng.int(0, 5);
    let z = rng.int(0, 5);
    const h = rng.int(5, 12);
    const lean = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (let y = 0; y < h; y++) {
      if (y > 4 && y % 3 === 0) {
        x = Math.max(0, Math.min(5, x + lean[0]));
        z = Math.max(0, Math.min(5, z + lean[1]));
      }
      g.set(x, y, z, greens[Math.min(4, Math.floor((y / h) * 5))]);
    }
  }
}
function clover(g, rng) {
  const c = rng.chance(0.5) ? 0x4f9d3a : 0x5aa845;
  for (const [ox, oz] of [[0, 0], [3, 0], [1, 3]]) g.box(ox, 2, oz, ox + 3, 3, oz + 3, (x, y, z) => ((x + z) % 3 === 0 ? shade(c, 1.15) : c));
  g.box(2, 0, 2, 3, 2, 3, 0x3e7a32);
  if (rng.chance(0.25)) g.set(2, 3, 2, 0xffffff);
}
function leaf(g, rng) {
  const c = rng.pick([0x5aa845, 0xd8a83a, 0xc8642a, 0x8ab83a]);
  for (let x = 0; x < 8; x++) {
    const w = Math.round(Math.sin(((x + 0.5) / 8) * Math.PI) * 2.4);
    for (let z = 2 - w; z <= 2 + w; z++) g.set(x, 0, z, z === 2 ? shade(c, 0.8) : c);
  }
  g.set(7, 1, 2, shade(c, 0.7));
}
function acorn(g) {
  g.box(0, 0, 0, 4, 3, 4, (x, y, z) => ((x === 0 || x === 3) && (z === 0 || z === 3) ? null : 0xb8783a));
  g.box(0, 3, 0, 4, 4, 4, 0x6a4a2a);
  g.box(1, 4, 1, 3, 5, 3, 0x7a5a32);
}
function bottleCap(g, rng) {
  const c = rng.pick([0xd9362a, 0x3a7ad8, 0xf2c12e, 0x3a9a5a]);
  for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
    const r = Math.hypot(x + 0.5 - 3, z + 0.5 - 3);
    if (r > 3) continue;
    g.set(x, 0, z, r > 2.3 && (x + z) % 2 ? shade(c, 0.8) : c);
    g.set(x, 1, z, r > 2.3 ? c : 0xd8d8d8);
  }
}
function berry(g, rng) {
  const c = rng.pick([0xd9203a, 0x5a2a8a, 0x3a4ad8]);
  ball(g, 1.5, 1.5, 1.5, 1.6, () => c);
  g.set(1, 2, 1, 0xffffff);
  g.set(1, 3, 1, 0x4a8a3a);
}
function stone(g, rng) {
  const c = rng.pick([0x9a948a, 0xb8aa98, 0x8a8a8a]);
  ball(g, 2, 1, 2, 2, (nx, ny, nz, x, y, z) => (ny < -0.3 ? null : hash3(x, y, z) < 0.3 ? shade(c, 0.88) : c), { squash: 0.7 });
}

const RP = (id, tier, v, size, build, more = {}) => ({ id, tier, v, size, build, value: 1, variants: 3, weight: 0, ...more });

export const REALM_PROPS = [
  // Space clutter (snacks at sizes 7, 8 and 9).
  RP('satellite', 6, 1.6, [7, 7, 5], satellite),
  RP('space_junk', 6, 1.5, [5, 5, 5], junk),
  RP('rocklet', 6, 2, [5, 5, 5], rocklet),
  RP('astronaut', 6, 1.1, [3, 6, 3], astronaut),
  RP('rocket', 6, 1.4, [3, 10, 3], rocket),
  RP('planetoid', 7, 2, [5, 5, 5], planetoid),
  RP('ice_comet', 7, 2, [8, 4, 4], iceComet),
  RP('dwarf_galaxy', 8, 2.2, [6, 3, 6], dwarfGalaxy),
  RP('nebula_puff', 8, 2, [6, 5, 6], nebulaPuff),
  RP('starlet', 8, 2.2, [3, 3, 3], starlet),
  // The garden floor (snacks and your size at size 10, all snacks at 11).
  RP('crumb', 9, 0.45, [3, 2, 3], crumb),
  RP('seed', 9, 0.5, [2, 1, 3], seed),
  RP('sugar_grain', 9, 0.45, [2, 2, 2], sugar),
  RP('aphid', 9, 0.45, [3, 2, 2], aphid),
  RP('sprout', 9, 0.45, [3, 4, 3], sprout),
  RP('grass_tuft', 10, 0.7, [6, 12, 6], grassTuft, { value: 0.5 }),
  RP('clover', 10, 0.6, [6, 3, 6], clover),
  RP('leaf', 10, 0.7, [8, 2, 5], leaf),
  RP('acorn', 10, 0.6, [4, 5, 4], acorn),
  RP('bottle_cap', 10, 0.6, [6, 2, 6], bottleCap),
  RP('berry', 10, 0.7, [3, 4, 3], berry),
  RP('stone', 10, 0.7, [4, 3, 4], stone),
];
