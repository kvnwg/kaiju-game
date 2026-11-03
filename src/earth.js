// The globe: the real Earth under the kaiju's feet, eaten country by country.
//
// The map is the world's countries (Natural Earth, see worldmap.js) rasterised once into an
// equirectangular grid: each cell holds the country it is in (0 for sea), and each cell's area is
// cos(latitude) of one at the equator, so countries keep their true size on the sphere.
//
// The kaiju always stands on top of the globe and the globe turns under it: `q` is the globe's
// orientation, mapping globe space (north pole +y, longitude 0 on +x, 90°E on -z) into the local
// frame the rest of the game uses (the kaiju at the origin, up +y, the ground plane x/z). A local
// point (x, z) near the kaiju is the surface point straight below it, and walking (dx, dz) turns
// the globe by the matching angle about the axis across the walk.
//
// Bites carve craters out of that grid and drain the countries under them; a country with almost
// nothing left is finished off ("ATE FRANCE!"). Countries still standing fire back: missiles with
// a red telegraph on the ground where they will land, and now and then a nuke.
import { WORLD_TOPO } from './worldmap.js';

export const EARTH = {
  W: 1024, // the country grid, equirectangular
  H: 512,
  globeR: 480, // the globe's radius in world units (the kaiju is about 30 there)
  need: 0.5, // the share of the world's land to eat to outgrow the Earth
  finish: 0.12, // a country with less than this share of itself left gets finished off
  missile: { every: [2.1, 0.75], ramp: 75, tele: 1.8, r: 1.25, dmg: 0.06, reach: [0.35, 1.25], volley: [2, 5] },
  nuke: { chance: 0.15, tele: 2.5, r: 2.6, dmg: 0.17 },
};

// The nine nuclear powers fire the odd nuke instead of a missile.
const NUCLEAR = new Set(['United States of America', 'Russia', 'China', 'United Kingdom', 'France', 'India', 'Pakistan', 'Israel', 'North Korea']);

// Names as said out loud ("ATE THE USA!"), where the map's short label isn't.
const SAY = {
  'United States of America': 'the USA', 'United Kingdom': 'the UK', 'United Arab Emirates': 'the UAE', 'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'the Central African Republic', 'Dominican Rep.': 'the Dominican Republic', 'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Eq. Guinea': 'Equatorial Guinea', 'Falkland Is.': 'the Falkland Islands', 'Fr. S. Antarctic Lands': 'the French Southern Lands',
  'N. Cyprus': 'Northern Cyprus', 'S. Sudan': 'South Sudan', 'Solomon Is.': 'the Solomon Islands', 'W. Sahara': 'Western Sahara',
  Netherlands: 'the Netherlands', Philippines: 'the Philippines', Bahamas: 'the Bahamas', Gambia: 'the Gambia', Macedonia: 'North Macedonia',
  eSwatini: 'Eswatini', Congo: 'the Congo', 'Czechia': 'Czechia',
};

// What eating a country adds to the damage counter: roughly its yearly economy, in billions of
// dollars (rounded, recent years). Countries not listed are priced by their size.
const GDP = {
  'United States of America': 28800, China: 18500, Germany: 4600, Japan: 4100, India: 3900, 'United Kingdom': 3600, France: 3100,
  Italy: 2300, Brazil: 2200, Canada: 2200, Russia: 2100, Mexico: 1850, Australia: 1800, 'South Korea': 1750, Spain: 1700,
  Indonesia: 1400, Turkey: 1300, Netherlands: 1150, 'Saudi Arabia': 1100, Switzerland: 940, Poland: 900, Taiwan: 790, Belgium: 660,
  Argentina: 630, Sweden: 600, Ireland: 550, 'United Arab Emirates': 540, Thailand: 530, Israel: 530, Austria: 520, Norway: 500,
  Philippines: 470, Vietnam: 470, Bangladesh: 450, Iran: 430, Malaysia: 420, Colombia: 420, Denmark: 410, 'South Africa': 400,
  Egypt: 380, Romania: 380, Pakistan: 370, Czechia: 340, Chile: 330, Finland: 300, Portugal: 300, Kazakhstan: 290, Peru: 280,
  Iraq: 270, 'New Zealand': 260, Algeria: 260, Greece: 250, Nigeria: 250, Qatar: 220, Hungary: 220, Ukraine: 190, Kuwait: 160,
  Ethiopia: 160, Morocco: 150, Kenya: 110, Antarctica: 1, Greenland: 3,
};

// ---------------------------------------------------------------- the map, built once
let MAP = null;

function decode(topo) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
  // A ring is a chain of arcs (~i: arc i backwards), each starting where the last one ended.
  const ring = (ids) => {
    const pts = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
    }
    return pts;
  };
  return topo.countries.map((g) => ({
    name: g.name,
    rings: (g.type === 'Polygon' ? [g.arcs] : g.arcs).flatMap((poly) => poly.map(ring)),
  }));
}

// Rings that cross the date line (Russia's far east, Fiji) jump from +180 to -180. Unwrapped into
// one continuous ring, they are drawn twice: as they are, and a whole turn over, so each half lands
// on its own side of the map. (A ring that goes right round the pole, Antarctica's, stays as it is.)
function unwrap(rings) {
  const out = [];
  for (const pts of rings) {
    const u = [pts[0].slice()];
    let off = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i][0] - pts[i - 1][0];
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
      u.push([pts[i][0] + off, pts[i][1]]);
    }
    if (off !== 0) {
      out.push(pts);
      continue;
    }
    out.push(u);
    const lo = Math.min(...u.map((p) => p[0]));
    const hi = Math.max(...u.map((p) => p[0]));
    if (hi > 180) out.push(u.map(([x, y]) => [x - 360, y]));
    if (lo < -180) out.push(u.map(([x, y]) => [x + 360, y]));
  }
  return out;
}

// Even-odd scanline fill of every ring of a country into the grid, at each row's centre latitude.
function rasterise(ids, rings, id, W, H) {
  const rows = new Map();
  for (const pts of unwrap(rings)) {
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      // rows whose centre latitude lies in [lo, hi)
      const r0 = Math.max(0, Math.ceil(((90 - hi) * H) / 180 - 0.5));
      const r1 = Math.min(H - 1, Math.floor(((90 - lo) * H) / 180 - 0.5));
      for (let r = r0; r <= r1; r++) {
        const lat = 90 - ((r + 0.5) * 180) / H;
        if (lat < lo || lat >= hi) continue;
        const x = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1);
        let list = rows.get(r);
        if (!list) rows.set(r, (list = []));
        list.push(x);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(((xs[i] + 180) * W) / 360 - 0.5));
      const c1 = Math.min(W - 1, Math.floor(((xs[i + 1] + 180) * W) / 360 - 0.5));
      for (let c = c0; c <= c1; c++) ids[r * W + c] = id;
    }
  }
}

// The decoded, rasterised world: the grid, each row's cell area, and per country its name, area,
// the grid rows and columns it spans, and a map colour that differs from its neighbours'.
export function worldMap() {
  if (MAP) return MAP;
  const { W, H } = EARTH;
  const shapes = decode(WORLD_TOPO);
  const ids = new Uint8Array(W * H);
  shapes.forEach((s, i) => rasterise(ids, s.rings, i + 1, W, H));
  // Natural Earth stops Antarctica short of the pole; the cap below its southernmost line is it too.
  const ant = shapes.findIndex((s) => s.name === 'Antarctica') + 1;
  for (let r = H - 1; r >= 0; r--) {
    const lat = 90 - ((r + 0.5) * 180) / H;
    if (lat > -84) break;
    for (let c = 0; c < W; c++) if (!ids[r * W + c]) ids[r * W + c] = ant;
  }
  const rowW = new Float32Array(H);
  for (let r = 0; r < H; r++) rowW[r] = Math.cos(((90 - ((r + 0.5) * 180) / H) * Math.PI) / 180);
  const countries = [null];
  for (const s of shapes) countries.push({ name: s.name, say: SAY[s.name] || s.name, area: 0, r0: H, r1: -1, c0: W, c1: -1, nuclear: NUCLEAR.has(s.name), color: 0 });
  let land = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const id = ids[r * W + c];
      if (!id) continue;
      const k = countries[id];
      k.area += rowW[r];
      land += rowW[r];
      if (r < k.r0) k.r0 = r;
      if (r > k.r1) k.r1 = r;
      if (c < k.c0) k.c0 = c;
      if (c > k.c1) k.c1 = c;
    }
  }
  // Map colours: greedy, so no two neighbours share one (neighbours: cells side by side).
  const near = countries.map(() => new Set());
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const a = ids[r * W + c];
      if (!a) continue;
      const b = ids[r * W + ((c + 1) % W)];
      const d = r + 1 < H ? ids[(r + 1) * W + c] : 0;
      if (b && b !== a) {
        near[a].add(b);
        near[b].add(a);
      }
      if (d && d !== a) {
        near[a].add(d);
        near[d].add(a);
      }
    }
  }
  const order = countries.map((k, i) => i).filter((i) => i && countries[i].area > 0).sort((a, b) => near[b].size - near[a].size);
  for (const i of order) {
    const used = new Set([...near[i]].map((j) => countries[j].color));
    let col = 1;
    while (used.has(col)) col++;
    countries[i].color = col;
  }
  for (const k of countries) if (k && k.name === 'Antarctica') k.color = 0;
  for (const k of countries) {
    if (!k) continue;
    k.worth = (GDP[k.name] ?? Math.round(15 + (3000 * k.area) / land)) * 1e9;
  }
  const eatable = countries.filter((k) => k && k.area > 0).length;
  MAP = { W, H, ids, rowW, countries, land, eatable };
  return MAP;
}

// ---------------------------------------------------------------- vectors and turns
// Globe-space direction <-> latitude/longitude (degrees).
export function dirOf(lat, lon) {
  const a = (lat * Math.PI) / 180;
  const o = (lon * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(o), Math.sin(a), -Math.cos(a) * Math.sin(o)];
}
export function latLonOf(v) {
  return { lat: (Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180) / Math.PI, lon: (Math.atan2(-v[2], v[0]) * 180) / Math.PI };
}

// Quaternions as [x, y, z, w].
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qAxis(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}
function qRot(q, v) {
  // v' = v + w t + q.xyz x t, with t = 2 q.xyz x v
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]];
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
// The turn taking unit vector a onto unit vector b.
function qBetween(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) return qAxis(1, 0, 0, Math.PI);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// ---------------------------------------------------------------- the globe, while the kaiju is on it
export class EarthSim {
  // rng: { next(), range(a, b), chance(p), pick(list) } (the game's lifeRng). `north`: the local
  // ground direction to start with north pointing (up the screen, so the map reads as a map).
  constructor(rng, north = { x: 0, z: -1 }) {
    this.map = worldMap();
    this.rng = rng;
    this.R = EARTH.globeR;
    const { W, H } = this.map;
    this.eaten = new Uint8Array(W * H); // 1: land bitten away
    this.left = this.map.countries.map((k) => (k ? k.area : 0)); // area of each country still there
    this.gone = new Set(); // countries finished off
    this.landEaten = 0;
    this.dirty = []; // grid rects [c0, r0, c1, r1] changed since the renderer last looked
    this.missiles = [];
    this.launchT = 3.5;
    this.time = 0;
    this.warned = new Set(); // countries that have announced their first nuke
    // Land somewhere with plenty of country around: a random spot in one of the big ones.
    const big = this.map.countries.filter((k) => k && k.area > 200 && k.name !== 'Antarctica');
    const k = rng.pick(big);
    let start = dirOf(0, 0);
    for (let i = 0; i < 400; i++) {
      const r = Math.floor(rng.range(k.r0, k.r1 + 1));
      const c = Math.floor(rng.range(k.c0, k.c1 + 1));
      if (this.map.ids[r * W + c] !== this.map.countries.indexOf(k)) continue;
      start = dirOf(90 - ((r + 0.5) * 180) / H, -180 + ((c + 0.5) * 360) / W);
      break;
    }
    this.north = north;
    this.standOn(start);
  }

  // Put globe point v (a direction, or [lat, lon] in degrees) under the kaiju, north pointing
  // `this.north` along the ground.
  standOn(v) {
    if (v.length === 2) v = dirOf(v[0], v[1]);
    this.q = qBetween(v, [0, 1, 0]);
    const n = qRot(this.q, [0, 1, 0]);
    if (Math.hypot(n[0], n[2]) > 1e-6) this.q = qNorm(qMul(qAxis(0, 1, 0, Math.atan2(n[2], n[0]) - Math.atan2(this.north.z, this.north.x)), this.q));
  }

  // The globe-space point under the kaiju.
  up() {
    return qRot(qInv(this.q), [0, 1, 0]);
  }

  // The globe-space surface point under local ground point (x, z).
  toGlobe(x, z) {
    const l = Math.hypot(x, this.R, z);
    return qRot(qInv(this.q), [x / l, this.R / l, z / l]);
  }

  // A globe-space direction in the local frame: the exact 3D point on the surface (kaiju at the
  // origin, the globe's centre R below it).
  toLocal(v, lift = 0) {
    const d = qRot(this.q, v);
    const r = this.R + lift;
    return { x: d[0] * r, y: d[1] * r - this.R, z: d[2] * r, facing: d[1] };
  }

  // Walk (dx, dz) along the ground: the globe turns the other way under the kaiju.
  move(dx, dz) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) return;
    // axis = dir x up, with dir = (dx, 0, dz) / d and up = +y
    const turn = qAxis(-dz / d, 0, dx / d, d / this.R);
    this.q = qNorm(qMul(turn, this.q));
  }

  cellOf(v) {
    const { W, H } = this.map;
    const { lat, lon } = latLonOf(v);
    const r = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) * H) / 180)));
    const c = ((Math.floor(((lon + 180) * W) / 360) % W) + W) % W;
    return r * W + c;
  }

  // The country under globe point v (0 at sea or where it has been eaten).
  countryAt(v) {
    const i = this.cellOf(v);
    return this.eaten[i] ? 0 : this.map.ids[i];
  }

  // Every grid cell within angular radius `rho` of globe point v: f(index, row) for each.
  forCap(v, rho, f) {
    const { W, H } = this.map;
    const { lat, lon } = latLonOf(v);
    const latC = (lat * Math.PI) / 180;
    const cosR = Math.cos(rho);
    const sinC = Math.sin(latC);
    const cosC = Math.cos(latC);
    const r0 = Math.max(0, Math.floor(((90 - lat - (rho * 180) / Math.PI) * H) / 180));
    const r1 = Math.min(H - 1, Math.ceil(((90 - lat + (rho * 180) / Math.PI) * H) / 180));
    for (let r = r0; r <= r1; r++) {
      const phi = ((90 - ((r + 0.5) * 180) / H) * Math.PI) / 180;
      const den = Math.cos(phi) * cosC;
      let half;
      if (den < 1e-6) half = Math.PI;
      else {
        const cd = (cosR - Math.sin(phi) * sinC) / den;
        if (cd > 1) continue;
        half = cd < -1 ? Math.PI : Math.acos(cd);
      }
      // columns whose centres are within `half` of the centre's longitude
      const cMid = ((lon + 180) * W) / 360 - 0.5;
      const hc = (half * W) / (2 * Math.PI);
      const c0 = half >= Math.PI ? 0 : Math.ceil(cMid - hc);
      const c1 = half >= Math.PI ? W - 1 : Math.floor(cMid + hc);
      for (let j = c0; j <= c1; j++) f(r * W + (((j % W) + W) % W), r);
    }
  }

  // How much uneaten land (in cell areas) lies within radius `rad` (world units) of local (x, z).
  landNear(x, z, rad) {
    const { ids, rowW } = this.map;
    let a = 0;
    this.forCap(this.toGlobe(x, z), rad / this.R, (i, r) => {
      if (ids[i] && !this.eaten[i]) a += rowW[r];
    });
    return a;
  }

  // Bite a crater of radius `rad` at local (x, z). Returns what went: land area, area per country,
  // and the countries that were finished off (with all that was left of them).
  bite(x, z, rad) {
    const { ids, rowW, countries, W } = this.map;
    const v = this.toGlobe(x, z);
    const per = new Map();
    let area = 0;
    let rMin = Infinity;
    let rMax = -1;
    let cells = 0;
    const cols = [];
    this.forCap(v, rad / this.R, (i, r) => {
      const id = ids[i];
      if (!id || this.eaten[i]) return;
      this.eaten[i] = 1;
      area += rowW[r];
      per.set(id, (per.get(id) || 0) + rowW[r]);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      cols.push(i % W);
      cells++;
    });
    const finished = [];
    for (const [id, a] of per) {
      this.left[id] -= a;
      const k = countries[id];
      if (!this.gone.has(id) && this.left[id] < k.area * EARTH.finish) {
        const rest = this.finishOff(id);
        area += rest;
        per.set(id, a + rest);
        finished.push(id);
      }
    }
    if (cells) this.markDirty(cols, rMin, rMax);
    this.landEaten += area;
    return { area, per, finished, v };
  }

  // Eat whatever is left of country `id`.
  finishOff(id) {
    const { ids, rowW, countries, W } = this.map;
    const k = countries[id];
    let rest = 0;
    for (let r = k.r0; r <= k.r1; r++) {
      for (let c = k.c0; c <= k.c1; c++) {
        const i = r * W + c;
        if (ids[i] !== id || this.eaten[i]) continue;
        this.eaten[i] = 1;
        rest += rowW[r];
      }
    }
    this.left[id] = 0;
    this.gone.add(id);
    this.dirty.push([k.c0, k.r0, k.c1, k.r1]);
    return rest;
  }

  markDirty(cols, r0, r1) {
    const { W } = this.map;
    // A crater over the date line comes in two pieces.
    const lo = cols.filter((c) => c < W / 2);
    const hi = cols.filter((c) => c >= W / 2);
    const wraps = lo.length && hi.length && Math.min(...lo) < 8 && Math.max(...hi) > W - 9;
    if (wraps) {
      this.dirty.push([0, r0, Math.max(...lo), r1]);
      this.dirty.push([Math.min(...hi), r0, W - 1, r1]);
    } else this.dirty.push([Math.min(...cols), r0, Math.max(...cols), r1]);
  }

  // The share of the world's land eaten so far.
  get progress() {
    return this.landEaten / this.map.land;
  }

  // ---------------------------------------------------------------- missiles
  // Countries within reach send missiles (a few at once later on) at where the kaiju is heading;
  // nuclear powers sometimes send a nuke. Returns the launches as { country, nuke } for callouts.
  updateMissiles(dt, vx, vz, kr) {
    const M = EARTH.missile;
    this.time += dt;
    this.launchT -= dt;
    const launches = [];
    if (this.launchT <= 0) {
      const ramp = Math.min(1, this.time / M.ramp);
      this.launchT = M.every[0] + (M.every[1] - M.every[0]) * ramp;
      const n = Math.round(M.volley[0] + (M.volley[1] - M.volley[0]) * ramp * this.rng.next());
      const site = this.launchSite();
      if (site) {
        const k = this.map.countries[site.id];
        const nuke = k.nuclear && this.rng.chance(EARTH.nuke.chance);
        if (nuke) launches.push({ country: site.id, nuke: true, first: !this.warned.has(site.id) });
        if (nuke) this.warned.add(site.id);
        for (let i = 0; i < (nuke ? 1 : n); i++) {
          // The first leads the kaiju exactly (running in a straight line gets you hit), the second
          // lands where it stands (so does stopping), the rest fall around the path between.
          const P = nuke ? EARTH.nuke : M;
          const lead = P.tele * (i === 0 ? 1 : i === 1 ? 0 : this.rng.range(0.3, 1.1));
          const spread = kr * (i < 2 ? 0.3 : 2);
          const ax = vx * lead + this.rng.range(-spread, spread);
          const az = vz * lead + this.rng.range(-spread, spread);
          const to = this.toGlobe(ax, az);
          const tele = P.tele + i * 0.18;
          this.missiles.push({ from: site.v, to, t: 0, dur: tele, r: (P.r * kr) / this.R, nuke, by: site.id, dmg: P.dmg });
        }
        if (!nuke) launches.push({ country: site.id, nuke: false });
      }
    }
    const impacts = [];
    for (const m of this.missiles) {
      m.t += dt;
      if (m.t >= m.dur) impacts.push(m);
    }
    if (impacts.length) this.missiles = this.missiles.filter((m) => m.t < m.dur);
    return { launches, impacts };
  }

  // A launch site: uneaten land in some country a good way off (but on this side of the world).
  launchSite() {
    const M = EARTH.missile;
    const up = this.up();
    for (let i = 0; i < 24; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(M.reach[0], M.reach[1]) * this.R;
      const v = this.toGlobe(Math.cos(a) * d * 1.4, Math.sin(a) * d * 1.4);
      const id = this.countryAt(v);
      if (id && angleBetween(v, up) > 0.2) return { id, v };
    }
    return null;
  }

  // Did missile m land on the kaiju (radius kr, world units)?
  hits(m, kr) {
    return angleBetween(m.to, this.up()) < m.r + (kr * 0.7) / this.R;
  }

  // Where missile m is, f of the way along its arc (globe space, as a direction and a height).
  missileAt(m) {
    const f = Math.min(1, m.t / m.dur);
    const ang = angleBetween(m.from, m.to);
    const s = Math.sin(ang) || 1;
    const a = Math.sin((1 - f) * ang) / s;
    const b = Math.sin(f * ang) / s;
    const v = [m.from[0] * a + m.to[0] * b, m.from[1] * a + m.to[1] * b, m.from[2] * a + m.to[2] * b];
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return { v: [v[0] / l, v[1] / l, v[2] / l], h: Math.sin(f * Math.PI) * (0.12 + ang * 0.35) * this.R, f };
  }
}
