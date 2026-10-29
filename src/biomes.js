// More kinds of town for the city to grow: farmland, a desert town, a snowy alpine village, a
// lantern district and a fairground. Building types join the building catalog and small things
// the prop catalog (see buildings.js and props.js); world.js lays the districts out.
import { E, W, body, pitchedRoof, cornice, parapet, shade, hash3 } from './voxel.js';

const LIT = [0xffd38a, 0xffc36b, 0xffe2a8];
const win = (glass, o = {}) => ({ w: 2, h: 2, gap: 2, sill: 1, glass, lit: LIT, litChance: 0.5, ...o });
const bsz = (bx, bz, by) => (rng) => ({ bx: rng.int(bx[0], bx[1]), bz: rng.int(bz[0], bz[1]), by: rng.int(by[0], by[1]) });

// A building's walls and windows; returns its corners.
function walls(g, rng, d, o) {
  const x0 = d.m;
  const z0 = d.m;
  const x1 = x0 + (o.bx ?? d.bx);
  const z1 = z0 + (o.bz ?? d.bz);
  const y0 = o.y0 ?? 0;
  const y1 = y0 + (o.by ?? d.by);
  body(g, rng, { x0, z0, x1, z1, y0, y1, floorH: o.floorH || 4, wall: o.wall, win: o.win });
  return { x0, z0, x1, z1, y1 };
}

// A roof that turns up at the corners (lantern district, pagodas).
function flaredRoof(g, x0, z0, x1, z1, y, c, over = 2) {
  g.box(x0 - over, y, z0 - over, x1 + over, y + 1, z1 + over, c);
  g.box(x0 - over + 1, y + 1, z0 - over + 1, x1 + over - 1, y + 2, z1 + over - 1, shade(c, 0.85));
  for (const [x, z] of [[x0 - over, z0 - over], [x1 + over - 1, z0 - over], [x0 - over, z1 + over - 1], [x1 + over - 1, z1 + over - 1]]) g.set(x, y + 1, z, c);
}

// ---------------------------------------------------------------- farmland
function farmhouse(g, rng, d) {
  const wall = rng.pick([0xf4efe2, 0xf2e2a8, 0xd8e8f0, 0xf0d8c8]);
  const b = walls(g, rng, d, { wall, floorH: 4, win: win(0x3b5570, { frame: 0xffffff }) });
  const roof = rng.pick([0x5a3a2a, 0x3a4a5a, 0x7a2a22]);
  pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, roof, d.bx >= d.bz);
  // A porch along the front, with posts and a rocking chair.
  g.box(b.x0, 3, b.z1, b.x1, 4, b.z1 + 3, roof);
  for (let x = b.x0; x < b.x1; x += 3) g.box(x, 0, b.z1 + 2, x + 1, 3, b.z1 + 3, 0xffffff);
  g.box(b.x0 + 2, 0, b.z1, b.x1 - 2, 1, b.z1 + 3, 0x9a7a5a);
  const door = Math.floor((b.x0 + b.x1) / 2);
  g.box(door, 0, b.z1 - 1, door + 2, 3, b.z1, 0x6a3a22);
  g.box(b.x1 - 3, b.y1, b.z0 + 1, b.x1 - 1, b.y1 + 4, b.z0 + 3, 0x8a4a3a);
}

function barn(g, rng, d) {
  const red = rng.pick([0xb83a2a, 0xa8342a, 0x8a3a5a]);
  const x0 = d.m;
  const z0 = d.m;
  const x1 = x0 + d.bx;
  const z1 = z0 + d.bz;
  const h = d.by - Math.ceil(d.bx / 2);
  g.box(x0, 0, z0, x1, h, z1, (x, y, z) => (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1 ? (y % 2 ? red : shade(red, 0.92)) : 0x2a1a14));
  for (const x of [x0, x1 - 1]) for (const z of [z0, z1 - 1]) g.box(x, 0, z, x + 1, h, z + 1, 0xf6f2ea);
  // A gambrel roof: steep sides, then a gentle top.
  const cx = (x0 + x1) / 2;
  for (let s = 0; s < Math.ceil(d.bx / 2) + 1; s++) {
    const inset = s < 3 ? Math.floor(s / 2) : s - 2;
    const w = Math.max(0, Math.floor(cx - x0 - inset));
    if (w <= 0 && s > 0) break;
    g.box(Math.floor(cx - w) - 1, h + s, z0 - 1, Math.ceil(cx + w) + 1, h + s + 1, z1 + 1, (x, y, z) => ((x + z) % 4 === 0 ? 0x4a4a52 : 0x5a5a62));
  }
  // Big doors with a white X, and a hay loft.
  const door = Math.floor(cx) - 3;
  g.box(door, 0, z1 - 1, door + 6, h - 2, z1, (x, y) => (x === door || x === door + 5 || y === 0 || y === h - 3 || Math.abs((x - door) - y * 5 / (h - 2)) < 1 || Math.abs((x - door) - (5 - y * 5 / (h - 2))) < 1 ? 0xf6f2ea : shade(red, 0.8)));
  g.box(Math.floor(cx) - 1, h + 1, z1, Math.floor(cx) + 1, h + 3, z1 + 1, 0xe8c64a);
}

function silo(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const r = d.bx / 2 - 0.2;
  const metal = rng.pick([0xc8ccd2, 0x9fb4c8, 0xd8d0c0]);
  g.cylinder(cx, cz, r, 0, d.by - 3, (x, y) => (y % 5 === 0 ? shade(metal, 0.85) : metal));
  for (let y = d.by - 3; y < d.by; y++) g.cylinder(cx, cz, r * (1 - (y - d.by + 3) / 3.5), y, y + 1, 0x8a2a22);
  g.box(Math.floor(cx + r) - 1, 0, Math.floor(cz), Math.floor(cx + r), d.by - 3, Math.floor(cz) + 1, 0x5a5a62);
}

function greenhouse(g, rng, d) {
  const x0 = d.m;
  const z0 = d.m;
  const x1 = x0 + d.bx;
  const z1 = z0 + d.bz;
  const h = d.by;
  for (let y = 0; y < h; y++) {
    const inset = y > h - 4 ? y - (h - 4) : 0;
    g.box(x0, y, z0 + inset, x1, y + 1, z1 - inset, (x, yy, z) => {
      const edge = x === x0 || x === x1 - 1 || z === z0 + inset || z === z1 - inset - 1 || yy === h - 1;
      if (!edge) return yy === 0 ? 0x5a3a24 : yy === 1 && (x + z) % 2 ? rng.pick([0x4f9d3a, 0xd94f4f, 0xf2c12e]) : null;
      return x % 3 === 0 || yy === 0 ? 0xf2f2f2 : 0xbfe8e0;
    });
  }
}

function windmill(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const r = d.bz / 2 - 0.5;
  const tower = d.by - 4;
  for (let y = 0; y < tower; y++) g.cylinder(cx, cz, r * (1 - (y / tower) * 0.45), y, y + 1, y % 4 === 0 ? 0xd8d0c0 : 0xf2ece0);
  g.cylinder(cx, cz, r * 0.6, tower, tower + 3, 0x6a4a32);
  // Four sails in the front plane, a little in front of the cap.
  const hx = Math.floor(cx);
  const hz = Math.floor(cz + r * 0.6) + 1;
  const hy = tower + 1;
  const L = Math.floor(d.bx / 2) - 1;
  for (let i = -L; i <= L; i++) {
    g.set(hx + i, hy, hz, 0x8a6a4a);
    g.set(hx, hy + i, hz, 0x8a6a4a);
    if (Math.abs(i) > 2) {
      g.set(hx + i, hy + (i > 0 ? 1 : -1), hz, 0xf6f2ea);
      g.set(hx + (i > 0 ? -1 : 1), hy + i, hz, 0xf6f2ea);
    }
  }
  g.box(hx - 1, 0, Math.floor(cz + r) - 1, hx + 1, 3, Math.floor(cz + r), 0x5a3a24);
}

function waterTower(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const legs = Math.floor(d.by * 0.55);
  const r = d.bx / 2 - 0.5;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = Math.floor(cx + dx * (r - 1));
    const z = Math.floor(cz + dz * (r - 1));
    g.box(x, 0, z, x + 1, legs, z + 1, 0x8a8f96);
  }
  g.box(Math.floor(cx - r + 1), Math.floor(legs / 2), Math.floor(cz), Math.ceil(cx + r - 1), Math.floor(legs / 2) + 1, Math.floor(cz) + 1, 0x8a8f96);
  const tank = rng.pick([0xe8e4dc, 0x9fc4d8, 0xd8c8a8]);
  g.cylinder(cx, cz, r, legs, d.by - 3, (x, y) => (y === legs + 3 ? 0xd94f4f : tank));
  for (let y = d.by - 3; y < d.by; y++) g.cylinder(cx, cz, r * (1 - (y - d.by + 3) / 3.2), y, y + 1, shade(tank, 0.8));
}

// ---------------------------------------------------------------- the desert town
function adobe(g, rng, d) {
  const mud = rng.pick([0xd8a878, 0xc89868, 0xe0b890, 0xd0906a]);
  const b = walls(g, rng, d, { wall: (x, y) => (y === 0 ? shade(mud, 0.85) : mud), floorH: 4, win: win(0x2a2a30, { w: 1, gap: 3, litChance: 0.4 }) });
  // Soft corners, a parapet, and roof beams (vigas) poking out.
  for (const [x, z] of [[b.x0, b.z0], [b.x1 - 1, b.z0], [b.x0, b.z1 - 1], [b.x1 - 1, b.z1 - 1]]) g.box(x, b.y1 - 1, z, x + 1, b.y1, z + 1, null);
  parapet(g, b.x0, b.z0, b.x1, b.z1, b.y1, shade(mud, 0.95));
  g.box(b.x0 + 1, b.y1, b.z0 + 1, b.x1 - 1, b.y1 + 1, b.z1 - 1, shade(mud, 0.9));
  for (let x = b.x0 + 1; x < b.x1 - 1; x += 3) g.set(x, b.y1 - 2, b.z1, 0x6a4a2a);
  const door = Math.floor((b.x0 + b.x1) / 2);
  g.box(door, 0, b.z1 - 1, door + 2, 3, b.z1, rng.pick([0x2a7a8a, 0x8a3a2a, 0x3a5a9a]));
  if (rng.chance(0.5)) g.set(door + 3, 2, b.z1, 0xd94f4f);
}

function saloon(g, rng, d) {
  const wood = rng.pick([0x8a5a32, 0x7a4a2a, 0x9a6a3a]);
  const b = walls(g, rng, d, { wall: (x, y) => ((y + x) % 4 ? wood : shade(wood, 0.85)), floorH: 4, win: win(0x3a2a1a, { litChance: 0.7 }) });
  // A tall false front with the name board, a balcony on posts, swinging doors.
  g.box(b.x0, b.y1, b.z1 - 1, b.x1, b.y1 + 4, b.z1, wood);
  g.box(b.x0 + 2, b.y1 + 1, b.z1, b.x1 - 2, b.y1 + 3, b.z1 + 1, (x) => (x % 2 ? 0xf2e2b0 : 0x3a2a1a));
  g.box(b.x0, 4, b.z1, b.x1, 5, b.z1 + 3, shade(wood, 0.8));
  for (let x = b.x0; x < b.x1; x += 4) g.box(x, 0, b.z1 + 2, x + 1, 4, b.z1 + 3, shade(wood, 0.7));
  const door = Math.floor((b.x0 + b.x1) / 2);
  g.box(door - 1, 1, b.z1 - 1, door + 2, 3, b.z1, 0xc89a5a);
  g.set(door - 2, 3, b.z1, 0xffc36b, E);
  g.set(door + 2, 3, b.z1, 0xffc36b, E);
}

function motel(g, rng, d) {
  const wall = rng.pick([0x7ad8c8, 0xf6a8b8, 0xf2d27a, 0xa8c8f0]);
  const b = walls(g, rng, d, { wall, floorH: 4, win: null });
  for (let x = b.x0 + 2; x < b.x1 - 2; x += 4) {
    for (let y = 0; y < b.y1 - 1; y += 4) {
      g.box(x, y, b.z1 - 1, x + 1, y + 3, b.z1, 0xf2f2f2);
      g.set(x + 2, y + 2, b.z1 - 1, LIT[(x + y) % 3], W);
    }
  }
  if (b.y1 > 5) g.box(b.x0, 4, b.z1, b.x1, 5, b.z1 + 2, 0xe8e4dc);
  g.box(b.x0 + 1, b.y1, b.z0 + 1, b.x1 - 1, b.y1 + 1, b.z1 - 1, 0x8a8f96);
  // The sign on its pole: MOTEL in neon, with a VACANCY light.
  const sx = b.x1 + 1;
  g.box(sx, 0, b.z1 - 2, sx + 1, b.y1 + 5, b.z1 - 1, 0x5a5a62);
  g.box(sx - 1, b.y1 + 2, b.z1 - 3, sx + 2, b.y1 + 6, b.z1, 0x2a2a30);
  for (let y = b.y1 + 3; y < b.y1 + 6; y++) g.set(sx, y, b.z1 - 3, 0xff4d8a, E);
  g.set(sx, b.y1 + 2, b.z1 - 3, 0x7dff5a, E);
}

// ---------------------------------------------------------------- the snowy village
const SNOW = 0xf4f8fc;

function chalet(g, rng, d) {
  const wood = rng.pick([0x8a5a3a, 0x6a4228, 0x9a6a48]);
  const b = walls(g, rng, d, { wall: (x, y) => (y < 2 ? 0x9a9aa2 : wood), floorH: 4, win: win(0x2a3a4a, { frame: 0xf6f2ea, litChance: 0.8 }) });
  const along = d.bx >= d.bz;
  const top = pitchedRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, 0x5a3a2a, along, 2);
  // Snow over the roof: the voxel on top of each roof column turns white.
  for (let z = b.z0 - 3; z < b.z1 + 3; z++) {
    for (let x = b.x0 - 3; x < b.x1 + 3; x++) {
      for (let y = top + 1; y >= b.y1; y--) {
        if (!g.get(x, y, z)) continue;
        g.set(x, y, z, SNOW);
        if (!g.get(x, y + 1, z) && hash3(x, y, z) < 0.6) g.set(x, y + 1, z, SNOW);
        break;
      }
    }
  }
  // A carved balcony across the front, and a chimney.
  g.box(b.x0 + 1, 4, b.z1, b.x1 - 1, 5, b.z1 + 2, shade(wood, 0.8));
  for (let x = b.x0 + 1; x < b.x1 - 1; x += 2) g.set(x, 5, b.z1 + 1, shade(wood, 0.7));
  g.box(b.x1 - 3, b.y1, b.z0 + 2, b.x1 - 1, top + 2, b.z0 + 4, 0x7a7a82);
  g.box(b.x1 - 3, top + 2, b.z0 + 2, b.x1 - 1, top + 3, b.z0 + 4, SNOW);
}

// ---------------------------------------------------------------- the lantern district
const RED = 0xc8302a;
const JADE = 0x2a8a72;

function lanternPagoda(g, rng, d) {
  const levels = Math.max(3, Math.floor(d.by / 6));
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const roof = rng.pick([JADE, 0x2a5a8a, 0x3a3a42]);
  let y = 0;
  for (let i = 0; i < levels; i++) {
    const half = Math.max(2, Math.floor(d.bx / 2) - i - 1);
    const x0 = Math.floor(cx - half);
    const x1 = Math.ceil(cx + half);
    const z0 = Math.floor(cz - half);
    const z1 = Math.ceil(cz + half);
    g.box(x0, y, z0, x1, y + 4, z1, (x, yy, z) => ((x === x0 || x === x1 - 1) && (z === z0 || z === z1 - 1) ? RED : 0xf2e8d0));
    for (let x = x0 + 2; x < x1 - 2; x += 3) {
      g.set(x, y + 2, z1 - 1, 0xffd38a, W);
      g.set(x, y + 2, z0, 0xffd38a, W);
    }
    flaredRoof(g, x0, z0, x1, z1, y + 4, roof, 2);
    y += 6;
  }
  g.box(Math.floor(cx), y, Math.floor(cz), Math.floor(cx) + 1, y + 4, Math.floor(cz) + 1, 0xffd23f, E);
}

function teaHouse(g, rng, d) {
  const b = walls(g, rng, d, { wall: (x, y, z, side, u) => (u % 5 === 0 ? RED : 0xf2e8d0), floorH: 4, win: win(0x3a2a1a, { litChance: 0.8, lit: [0xffb35c, 0xffd38a] }) });
  flaredRoof(g, b.x0, b.z0, b.x1, b.z1, b.y1, rng.pick([0x3a3a42, JADE]), 2);
  // A round moon door and red lanterns under the eaves.
  const cx = Math.floor((b.x0 + b.x1) / 2);
  for (let y = 0; y < 4; y++) for (let x = cx - 2; x <= cx + 2; x++) if (Math.hypot(x - cx, (y - 1.5) * 1.2) < 2.4) g.set(x, y, b.z1 - 1, 0x2a1a14);
  for (let x = b.x0; x < b.x1; x += 4) g.set(x, b.y1 - 1, b.z1 + 1, 0xff3b2a, E);
}

function shophouse(g, rng, d) {
  const face = rng.pick([0xe8b84a, 0x7ac8a8, 0xe87a6a, 0xd8c8f0, 0xf2e8d0]);
  const b = walls(g, rng, d, { wall: (x, y) => (y < 4 ? RED : face), floorH: 4, win: win(0x2a2a30, { litChance: 0.7, frame: 0xffffff }) });
  cornice(g, b.x0, b.z0, b.x1, b.z1, b.y1 - 1, shade(face, 0.8));
  g.box(b.x0 + 1, b.y1, b.z0 + 1, b.x1 - 1, b.y1 + 1, b.z1 - 1, 0x5a5a62);
  // A tall neon sign down the corner, and strings of lanterns across the front.
  const sx = b.x1 - 2;
  g.box(sx, 5, b.z1, sx + 2, b.y1 - 1, b.z1 + 1, 0x2a1a14);
  for (let y = 6; y < b.y1 - 2; y += 2) g.set(sx, y, b.z1 + 1, rng.pick([0xff3b6a, 0xffd23f, 0x5ff0ff]), E);
  for (let y = 7; y < b.y1; y += 8) for (let x = b.x0 + 1; x < sx - 1; x += 3) g.set(x, y, b.z1, 0xff3b2a, E);
}

function paifang(g, rng, d) {
  const x0 = d.m;
  const x1 = d.m + d.bx;
  const cz = d.m + Math.floor(d.bz / 2);
  for (const x of [x0 + 1, x1 - 2]) g.box(x, 0, cz - 1, x + 1, d.by - 4, cz + 1, RED);
  g.box(x0, d.by - 5, cz - 1, x1, d.by - 3, cz + 1, (x) => (x === Math.floor((x0 + x1) / 2) ? 0xffd23f : RED));
  flaredRoof(g, x0 + 1, cz - 1, x1 - 1, cz + 1, d.by - 3, JADE, 1);
}

// ---------------------------------------------------------------- the fairground
const FAIR = [0xff5a8a, 0xffd23f, 0x5ad8ff, 0x7dff5a, 0xc58bff, 0xff8a3a];

function ferrisWheel(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + Math.floor(d.bz / 2);
  const R = d.bx / 2 - 1;
  const cy = R + 3;
  // A-frame legs, then the rim, spokes and gondolas in the front plane.
  for (let y = 0; y < cy; y++) {
    const off = Math.round(((cy - y) / cy) * (R * 0.55));
    for (const z of [cz - 2, cz + 2]) {
      g.set(Math.floor(cx) - off, y, z, 0xe8e4dc);
      g.set(Math.floor(cx) + off, y, z, 0xe8e4dc);
    }
  }
  const steps = Math.round(R * 8);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * R);
    const y = Math.round(cy + Math.sin(a) * R);
    g.set(x, y, cz, i % 3 === 0 ? 0xfff2a8 : 0xff8ac0, i % 3 === 0 ? E : 0);
  }
  const spokes = 12;
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    for (let t = 0; t < R; t += 0.7) g.set(Math.round(cx + Math.cos(a) * t), Math.round(cy + Math.sin(a) * t), cz, 0xd8d0e0);
    const gx = Math.round(cx + Math.cos(a) * R);
    const gy = Math.round(cy + Math.sin(a) * R) - 2;
    g.box(gx - 1, gy, cz - 1, gx + 2, gy + 2, cz + 2, FAIR[s % FAIR.length]);
  }
  g.box(Math.floor(cx) - 1, cy - 1, cz - 1, Math.floor(cx) + 2, cy + 2, cz + 2, 0xffd23f, E);
}

function circusTent(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const R = d.bx / 2 - 0.3;
  const wallH = Math.floor(d.by * 0.35);
  const stripe = rng.pick([[0xd9362a, 0xf6f2ea], [0x3a6ad8, 0xf6f2ea], [0xc58bff, 0xffd23f]]);
  const col = (x, z) => (Math.floor(((Math.atan2(z + 0.5 - cz, x + 0.5 - cx) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? stripe[0] : stripe[1]);
  g.cylinder(cx, cz, R, 0, wallH, (x, y, z) => col(x, z));
  const coneH = d.by - wallH - 3;
  for (let y = 0; y < coneH; y++) g.cylinder(cx, cz, (R + 1) * (1 - y / coneH), wallH + y, wallH + y + 1, (x, yy, z) => col(x, z));
  g.box(Math.floor(cx), d.by - 3, Math.floor(cz), Math.floor(cx) + 1, d.by, Math.floor(cz) + 1, 0x8a8f96);
  g.box(Math.floor(cx) + 1, d.by - 1, Math.floor(cz), Math.floor(cx) + 3, d.by, Math.floor(cz) + 1, 0xffd23f);
  g.box(Math.floor(cx) - 2, 0, Math.floor(cz + R) - 1, Math.floor(cx) + 2, wallH - 1, Math.floor(cz + R) + 1, 0x2a1a14);
}

function carousel(g, rng, d) {
  const cx = d.m + d.bx / 2;
  const cz = d.m + d.bz / 2;
  const R = d.bx / 2 - 0.3;
  g.cylinder(cx, cz, R, 0, 1, 0xd8c8a8);
  g.cylinder(cx, cz, 1.2, 1, d.by - 3, 0xffd23f);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * (R - 1.5));
    const z = Math.round(cz + Math.sin(a) * (R - 1.5));
    g.box(x, 1, z, x + 1, d.by - 3, z + 1, 0xe8e4dc);
    g.box(x, 2 + (i % 2), z, x + 2, 4 + (i % 2), z + 1, FAIR[i % FAIR.length]);
  }
  for (let y = d.by - 3; y < d.by; y++) g.cylinder(cx, cz, (R + 0.6) * (1 - (y - d.by + 3) / 3.4), y, y + 1, (x, yy, z) => (Math.floor(Math.atan2(z - cz, x - cx) * 2.5) % 2 ? 0xff5a8a : 0xfff2f6));
  const steps = Math.round(R * 6);
  for (let i = 0; i < steps; i += 2) {
    const a = (i / steps) * Math.PI * 2;
    g.set(Math.round(cx + Math.cos(a) * R), d.by - 3, Math.round(cz + Math.sin(a) * R), 0xfff2a8, E);
  }
}

function coaster(g, rng, d) {
  const x0 = d.m;
  const z = d.m + Math.floor(d.bz / 2);
  const H = d.by - 2;
  // A hill of red track on white lattice legs, with a car about to drop.
  let prev = 0;
  for (let x = 0; x < d.bx; x++) {
    const t = x / (d.bx - 1);
    const h = Math.round(2 + Math.sin(t * Math.PI) * (H - 3) * (t < 0.5 ? 1 : 0.85 + 0.15 * Math.cos(t * 9)));
    for (let y = Math.min(prev, h); y <= Math.max(prev, h); y++) {
      g.set(x0 + x, y, z - 1, 0xd9362a);
      g.set(x0 + x, y, z + 1, 0xd9362a);
    }
    if (x % 3 === 0) for (let y = 0; y < h; y++) g.set(x0 + x, y, z, y % 2 ? 0xe8e4dc : 0xb8bcc4);
    prev = h;
  }
  const peak = Math.floor(d.bx / 2);
  g.box(x0 + peak - 2, H, z - 1, x0 + peak + 1, H + 2, z + 2, 0xffd23f);
}

// ---------------------------------------------------------------- catalog
const B = (id, name, tier, style, zones, v, size, build, more = {}) => ({ id, name, tier, style, zones, v, size, build, weight: 1, ...more });

export const BIOME_BUILDINGS = [
  B('farmhouse', 'Farmhouse', 3, 'farm', ['farm'], 2.5, bsz([12, 15], [10, 12], [8, 8]), farmhouse, { weight: 2 }),
  B('barn', 'Barn', 3, 'farm', ['farm'], 2.5, bsz([12, 14], [16, 20], [13, 14]), barn, { weight: 2 }),
  B('silo', 'Grain silo', 4, 'farm', ['farm'], 2.5, bsz([6, 7], [6, 7], [20, 26]), silo, { weight: 1.5, square: true }),
  B('greenhouse', 'Greenhouse', 3, 'farm', ['farm'], 2.5, bsz([14, 18], [8, 9], [6, 6]), greenhouse, { weight: 1 }),
  B('windmill', 'Windmill', 4, 'farm', ['farm'], 2.5, bsz([20, 22], [8, 8], [24, 26]), windmill, { weight: 0.8 }),
  B('water_tower', 'Water tower', 4, 'farm', ['farm', 'desert'], 2.5, bsz([8, 8], [8, 8], [22, 24]), waterTower, { weight: 0.7, square: true }),
  B('adobe', 'Adobe house', 3, 'desert', ['desert'], 2.5, bsz([10, 14], [9, 12], [5, 9]), adobe, { weight: 4 }),
  B('adobe_big', 'Adobe block', 4, 'desert', ['desert'], 3, bsz([14, 18], [12, 16], [10, 13]), adobe, { weight: 1.5 }),
  B('saloon', 'Saloon', 3, 'desert', ['desert'], 2.5, bsz([12, 14], [11, 13], [8, 8]), saloon, { weight: 2 }),
  B('motel', 'Motel', 3, 'desert', ['desert'], 2.5, bsz([22, 28], [8, 9], [4, 8]), motel, { weight: 1.5 }),
  B('chalet', 'Chalet', 3, 'snow', ['snow'], 2.5, bsz([11, 14], [10, 12], [6, 8]), chalet, { weight: 4 }),
  B('ski_lodge', 'Ski lodge', 4, 'snow', ['snow'], 3, bsz([16, 20], [12, 14], [10, 12]), chalet, { weight: 1.2 }),
  B('lantern_pagoda', 'Five-roof pagoda', 5, 'lantern', ['lantern'], 3, bsz([12, 14], [12, 14], [26, 32]), lanternPagoda, { weight: 0.5, square: true }),
  B('tea_house', 'Tea house', 3, 'lantern', ['lantern'], 2.5, bsz([12, 15], [10, 12], [8, 8]), teaHouse, { weight: 2.5 }),
  B('shophouse', 'Shophouse', 4, 'lantern', ['lantern'], 3, bsz([9, 12], [10, 12], [14, 20]), shophouse, { weight: 3 }),
  B('paifang', 'Lantern gate', 3, 'lantern', ['lantern'], 2.5, bsz([16, 18], [4, 4], [12, 12]), paifang, { weight: 0.5 }),
  B('ferris_wheel', 'Ferris wheel', 5, 'fair', [], 3, bsz([30, 30], [7, 7], [34, 34]), ferrisWheel, { weight: 0 }),
  B('circus_tent', 'Big top', 4, 'fair', [], 2.5, bsz([22, 24], [22, 24], [18, 20]), circusTent, { weight: 0, square: true }),
  B('carousel', 'Carousel', 3, 'fair', [], 2.5, bsz([12, 13], [12, 13], [9, 9]), carousel, { weight: 0, square: true }),
  B('coaster', 'Roller coaster', 4, 'fair', [], 3, bsz([28, 34], [5, 5], [16, 18]), coaster, { weight: 0 }),
];

// ---------------------------------------------------------------- props
function cactus(g, rng) {
  const c = 0x4a8a3a;
  g.box(2, 0, 2, 3, 7, 3, c);
  g.box(0, 3, 2, 2, 4, 3, c);
  g.box(0, 4, 2, 1, 6, 3, c);
  if (rng.chance(0.6)) {
    g.box(3, 2, 2, 5, 3, 3, c);
    g.box(4, 3, 2, 5, 5, 3, c);
  }
  if (rng.chance(0.4)) g.set(2, 7, 2, 0xff8ac8);
}
function tumbleweed(g) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if ((i + j + k) % 2 === 0) g.set(i, j, k, 0xb8945a);
}
function desertRock(g, rng) {
  const c = rng.pick([0xc87a4a, 0xb86a3a, 0xd8a070]);
  g.box(0, 0, 0, 5, 3, 4, (x, y, z) => (y === 2 && (x === 0 || x === 4) ? null : hash3(x, y, z) < 0.3 ? shade(c, 0.85) : c));
  g.box(1, 3, 1, 4, 4, 3, c);
}
function snowman(g) {
  g.box(0, 0, 0, 3, 2, 3, SNOW);
  g.box(0, 2, 0, 3, 4, 3, SNOW);
  g.set(1, 4, 1, SNOW);
  g.set(2, 3, 1, 0xff8a2a);
  g.set(1, 5, 1, 0x2a2a30);
  g.set(2, 2, 0, 0xd9362a);
  g.set(2, 2, 2, 0xd9362a);
}
function snowPine(g) {
  g.box(2, 0, 2, 3, 2, 3, 0x5a3d26);
  for (let i = 0; i < 6; i++) {
    const r = Math.max(0.7, 2.6 - i * 0.42);
    g.cylinder(2.5, 2.5, r, 2 + i, 3 + i, (x, y, z) => (hash3(x, y, z) < 0.45 || i % 2 ? SNOW : 0x2f6a3a));
  }
}
function cow(g, rng) {
  const spots = rng.pick([0x1a1a1a, 0x7a4a2a]);
  g.box(0, 1, 0, 4, 3, 2, (x, y, z) => (hash3(x, y, z) < 0.4 ? spots : 0xf6f2ea));
  g.box(4, 2, 0, 5, 4, 2, 0xf6f2ea);
  g.set(4, 3, 0, 0x1a1a1a);
  for (const x of [0, 3]) for (const z of [0, 1]) g.set(x, 0, z, 0x3a2a1a);
}
function scarecrow(g) {
  g.box(1, 0, 0, 2, 5, 1, 0x8a6a4a);
  g.box(0, 3, 0, 3, 4, 1, 0x3a6ad8);
  g.set(1, 4, 0, 0x3a6ad8);
  g.set(1, 5, 0, 0xf2d27a);
  g.box(0, 6, 0, 3, 7, 1, 0x8a5a32);
}
function tractor(g) {
  g.box(0, 1, 0, 6, 3, 4, 0x3a9a3a);
  g.box(3, 3, 1, 6, 6, 3, 0x3a9a3a);
  g.box(4, 4, 1, 6, 5, 3, 0x9fd8ff);
  g.box(0, 0, 0, 2, 3, 1, 0x1a1a1a);
  g.box(0, 0, 3, 2, 3, 4, 0x1a1a1a);
  g.box(4, 0, 0, 5, 2, 1, 0x1a1a1a);
  g.box(4, 0, 3, 5, 2, 4, 0x1a1a1a);
  g.set(1, 4, 2, 0x5a5a62);
}
function lanternPost(g) {
  g.box(1, 0, 1, 2, 6, 2, 0x2a1a14);
  g.box(0, 6, 0, 3, 8, 3, 0xff3b2a, E);
  g.box(1, 8, 1, 2, 9, 2, 0xffd23f);
}
function stoneLion(g) {
  g.box(0, 0, 0, 4, 1, 3, 0x9a9aa2);
  g.box(0, 1, 0, 3, 3, 3, 0xb8b8c0);
  g.box(2, 3, 0, 4, 5, 3, 0xb8b8c0);
  g.set(3, 4, 0, 0x2a2a30);
}
function ticketBooth(g) {
  g.box(0, 0, 0, 4, 5, 4, (x, y) => (y % 2 ? 0xff5a8a : 0xfff2f6));
  g.box(1, 2, 3, 3, 4, 4, 0x9fd8ff);
  g.box(0, 5, 0, 4, 6, 4, 0xffd23f, E);
}
function balloonCart(g, rng) {
  g.box(0, 0, 0, 3, 2, 2, 0xe8e4dc);
  g.box(1, 2, 1, 2, 6, 2, 0xd8d8d8);
  for (let i = 0; i < 5; i++) g.set(rng.int(0, 2), 6 + (i % 2), rng.int(0, 2), FAIR[i % FAIR.length]);
}

const BP = (id, tier, v, size, build, more = {}) => ({ id, tier, v, size, build, value: 1, variants: 3, weight: 0, ...more });

export const BIOME_PROPS = [
  BP('cactus', 2, 1.2, [6, 8, 4], cactus),
  BP('tumbleweed', 1, 0.8, [3, 3, 3], tumbleweed, { value: 0.1 }),
  BP('desert_rock', 2, 1.4, [5, 4, 4], desertRock),
  BP('snowman', 1, 0.9, [3, 6, 3], snowman, { value: 0.2 }),
  BP('tree_snow', 2, 1.4, [5, 9, 5], snowPine, { value: 0.4 }),
  BP('cow', 1, 1, [5, 4, 2], cow, { value: 0.5 }),
  BP('scarecrow', 1, 0.9, [3, 7, 1], scarecrow, { value: 0.1 }),
  BP('tractor', 2, 1.4, [6, 6, 4], tractor, { vehicle: true }),
  BP('lantern_post', 1, 0.9, [3, 9, 3], lanternPost, { value: 0.2, light: { color: 0xff6a3a, h: 7 } }),
  BP('stone_lion', 1, 0.9, [4, 5, 3], stoneLion, { value: 0.2 }),
  BP('ticket_booth', 2, 1.2, [4, 6, 4], ticketBooth, { light: { color: 0xffd23f, h: 6 } }),
  BP('balloon_cart', 1, 0.9, [3, 8, 2], balloonCart, { value: 0.2 }),
];
