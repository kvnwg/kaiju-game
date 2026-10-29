// The worlds past the city: the solar system, the galaxy, the multiverse and the back garden.
// Like the city, each is endless, streamed in square cells around the kaiju, generated from
// (seed, column, row) and remembered once wrecked. There are no roads, water or districts here:
// just things to eat, scattered about. Same interface as World, so the game and the renderer
// treat both alike.
import { TIER_HP, REALMS } from './config.js';
import { createRng } from './rng.js';
import { TYPE_BY_ID, buildingDims } from './buildings.js';
import { PROP_BY_ID, propDims } from './props.js';
import { SpatialHash, ihash } from './world.js';

// What each realm is made of, as [type, average count per cell]: props are small clutter (drawn
// instanced, crushed underfoot), bodies are building-sized and placed biggest first.
const REALM_GEN = {
  solar: {
    props: [['rocklet', 8], ['satellite', 3.5], ['space_junk', 5], ['astronaut', 1.4], ['rocket', 1]],
    bodies: [['gas_giant', 0.24], ['planet_earth', 0.18], ['planet_red', 0.32], ['planet_ice', 0.28], ['moon', 1.8], ['space_station', 0.9], ['comet', 0.7], ['asteroid', 4.5]],
    gap: 20, clear: 80,
  },
  galaxy: {
    props: [['planetoid', 10], ['ice_comet', 4]],
    bodies: [['nebula', 0.35], ['black_hole', 0.2], ['star_cluster', 0.3], ['star_red', 1.2], ['solar_system', 1], ['star_yellow', 2.2], ['star_blue', 2]],
    gap: 20, clear: 80,
  },
  cosmos: {
    props: [['starlet', 12], ['dwarf_galaxy', 5], ['nebula_puff', 5]],
    bodies: [['universe', 0.45], ['galaxy_cluster', 0.25], ['galaxy_spiral', 2.6], ['galaxy_elliptical', 1.5], ['quasar', 0.9]],
    gap: 20, clear: 80,
  },
  garden: {
    props: [
      ['grass_tuft', 150], ['clover', 12], ['crumb', 10], ['seed', 6], ['sugar_grain', 4], ['aphid', 5], ['sprout', 6], ['leaf', 6],
      ['acorn', 2], ['bottle_cap', 0.8], ['berry', 2], ['stone', 5],
    ],
    bodies: [
      ['sunflower', 0.5], ['shrub', 1], ['rock', 0.5], ['flower_pot', 0.3], ['garden_gnome', 0.2], ['watering_can', 0.15], ['mushroom', 3.5],
      ['pebble', 2.5], ['daisy', 3], ['dandelion', 2], ['snail', 0.8], ['pinecone', 1], ['toy_car', 0.25], ['lego_brick', 0.35],
    ],
    gap: 2.5, clear: 22,
  },
};

// Set pieces near where the kaiju arrives: the Earth it just outgrew (and the Sun, further off),
// the solar system it came from, its home galaxy. [type, x, y, value]
const HOME = {
  solar: [['earth', -150, 40, 3], ['sun', 1400, -840, 6]],
  galaxy: [['solar_system', -120, 40, 2]],
  cosmos: [['galaxy_spiral', -110, 30, 2]],
  garden: [],
};

const PICK_TRIES = 10;

function realmChunk(world, c, r) {
  const gen = REALM_GEN[world.realm];
  const cell = world.cell;
  const rng = createRng(Math.floor(ihash(c, r, world.s + 5) * 4294967296));
  const chunk = { c, r, key: world.key(c, r), zone: world.zone, objects: [], roads: [], lights: [], decals: [], powerLines: [], bridges: [], metro: [], loaded: true };
  const x0 = c * cell;
  const y0 = r * cell;
  const placed = [];
  let li = 0;
  const near = (x, y, w, h, pad) => Math.abs(x) < w / 2 + pad && Math.abs(y) < h / 2 + pad;
  // Every add takes a local index, even when skipped, so saved destruction lines up on reload.
  const add = (o) => {
    o.li = li++;
    o.state = 'intact';
    o.flash = 0;
    o.chunk = chunk;
    o.id = world.nextId++;
    chunk.objects.push(o);
    return o;
  };
  const body = (type, x, y, variant, rot, value = 1) => {
    const t = TYPE_BY_ID[type];
    const d = buildingDims(type, variant);
    const swap = rot % 2 === 1;
    const hp = TIER_HP[t.tier] * value;
    return add({
      kind: 'building', type, variant, rot, tier: t.tier, x, y, w: swap ? d.h : d.w, h: swap ? d.w : d.h, height: d.height,
      hp, maxHp: hp, structure: true, walkable: false, landmark: false, power: false, value, style: t.style, vanish: Boolean(t.vanish),
    });
  };
  const free = (x, y, w, h, gap) => placed.every((p) => Math.abs(p.x - x) > (p.w + w) / 2 + gap || Math.abs(p.y - y) > (p.h + h) / 2 + gap);

  for (const [type, x, y, value] of HOME[world.realm]) {
    if (Math.floor(x / cell) !== c || Math.floor(y / cell) !== r) continue;
    const o = body(type, x, y, 0, 0, value);
    placed.push(o);
  }
  for (const [type, mean] of gen.bodies) {
    const n = Math.floor(mean * rng.range(0.6, 1.4) + rng.next());
    for (let i = 0; i < n; i++) {
      const variant = rng.int(0, 3);
      const rot = rng.int(0, 3);
      const d = buildingDims(type, variant);
      const w = rot % 2 ? d.h : d.w;
      const h = rot % 2 ? d.w : d.h;
      if (w > cell * 0.9 || h > cell * 0.9) continue;
      for (let k = 0; k < PICK_TRIES; k++) {
        const x = x0 + w / 2 + rng.next() * (cell - w);
        const y = y0 + h / 2 + rng.next() * (cell - h);
        if (near(x - world.spawn.x, y - world.spawn.y, w, h, gen.clear) || !free(x, y, w, h, gen.gap)) continue;
        placed.push(body(type, x, y, variant, rot));
        break;
      }
    }
  }
  for (const [type, mean] of gen.props) {
    const pt = PROP_BY_ID[type];
    const d = propDims(type);
    const n = Math.floor(mean * rng.range(0.6, 1.4) + rng.next());
    for (let i = 0; i < n; i++) {
      const rot = rng.int(0, 3);
      const w = rot % 2 ? d.h : d.w;
      const h = rot % 2 ? d.w : d.h;
      const x = x0 + w / 2 + rng.next() * (cell - w);
      const y = y0 + h / 2 + rng.next() * (cell - h);
      if (near(x - world.spawn.x, y - world.spawn.y, w, h, gen.clear * 0.4) || !free(x, y, w, h, 0.5)) continue;
      add({
        kind: 'prop', type, variant: rng.int(0, pt.variants - 1), rot, tier: pt.tier, x, y, w, h, height: d.height,
        hp: TIER_HP[pt.tier], maxHp: TIER_HP[pt.tier], structure: false, vehicle: false, value: pt.value,
      });
    }
  }
  return chunk;
}

export class RealmWorld {
  constructor(realm, seed = 1) {
    this.realm = realm;
    this.def = REALMS[realm];
    this.cell = this.def.cell;
    this.seed = seed;
    this.s = Math.floor(ihash(seed, realm.length * 31 + realm.charCodeAt(0), 77) * 1e6);
    this.p = { dry: true, s: this.s }; // no water anywhere (see world.js waterField)
    this.spawn = { x: 0, y: 0 };
    this.zone = { style: realm, density: 0, district: null };
    this.grid = new SpatialHash(this.cell >= 400 ? 160 : 64);
    this.lightGrid = new SpatialHash(256);
    this.decalGrid = new SpatialHash(256);
    this.roadGrid = new SpatialHash(420);
    this.chunks = new Map();
    this.saved = new Map();
    this.listeners = new Set();
    this.graph = new Map();
    this.roadGraph = { graph: this.graph, key: () => '' };
    this.metroSegs = new Map();
    this.roads = [];
    this.nextId = 1;
    this.detail = 0;
    this._objects = null;
  }

  key(c, r) {
    return (c + 32768) * 65536 + r + 32768;
  }

  zoneFor() {
    return this.zone;
  }

  cellAt() {
    return this.zone;
  }

  edge() {
    return null;
  }

  isWater() {
    return false;
  }

  isMetroRow() {
    return false;
  }

  metroRowNear() {
    return null;
  }

  metroSeg() {
    return null;
  }

  nearestRoad() {
    return null;
  }

  isLoaded(c, r) {
    return this.chunks.has(this.key(c, r));
  }

  get objects() {
    if (!this._objects) {
      this._objects = [];
      for (const ch of this.chunks.values()) for (const o of ch.objects) this._objects.push(o);
    }
    return this._objects;
  }

  load(c, r) {
    const chunk = realmChunk(this, c, r);
    const saved = this.saved.get(chunk.key);
    if (saved) {
      for (const o of chunk.objects) {
        const s = saved.get(o.li);
        if (!s) continue;
        o.state = s.state;
        o.hp = s.hp;
        if (s.fallDir) o.fallDir = s.fallDir;
      }
      this.saved.delete(chunk.key);
    }
    for (const o of chunk.objects) this.grid.insert(o);
    this.chunks.set(chunk.key, chunk);
    this._objects = null;
    for (const l of this.listeners) if (l.load) l.load(chunk);
    return chunk;
  }

  unload(chunk) {
    for (const l of this.listeners) if (l.unload) l.unload(chunk);
    chunk.loaded = false;
    let saved = null;
    for (const o of chunk.objects) {
      if (o.state !== 'intact' || o.hp < o.maxHp) {
        if (!saved) saved = new Map();
        saved.set(o.li, { state: o.state === 'collapsing' ? 'rubble' : o.state, hp: o.hp, fallDir: o.fallDir });
      }
      this.grid.remove(o);
    }
    if (saved) this.saved.set(chunk.key, saved);
    this.chunks.delete(chunk.key);
    this._objects = null;
  }

  // Stream cells around (x, y), as World.update does.
  update(x, y, radius, maxNew = 4, must = 0) {
    const cell = this.cell;
    const c0 = Math.floor((x - radius) / cell);
    const c1 = Math.floor((x + radius) / cell);
    const r0 = Math.floor((y - radius) / cell);
    const r1 = Math.floor((y + radius) / cell);
    const missing = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.chunks.has(this.key(c, r))) continue;
        const dx = Math.max(c * cell - x, 0, x - (c + 1) * cell);
        const dy = Math.max(r * cell - y, 0, y - (r + 1) * cell);
        const d = Math.hypot(dx, dy);
        if (d <= radius) missing.push({ c, r, d });
      }
    }
    missing.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const m of missing) {
      if (m.d > must && n >= maxNew) break;
      this.load(m.c, m.r);
      n++;
    }
    const far = radius * 1.3 + cell;
    for (const ch of [...this.chunks.values()]) {
      if (Math.hypot((ch.c + 0.5) * cell - x, (ch.r + 0.5) * cell - y) > far) this.unload(ch);
    }
    return missing.length - n;
  }
}
