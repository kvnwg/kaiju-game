/* global THREE */
// three.js voxel renderer: tilted camera, golden-hour-to-neon-night lighting, streamed ground
// tiles with baked street-light pools, voxel buildings that chip and collapse (simplified
// meshes once they are small next to the kaiju), instanced street props, water, suspension
// bridges, and post-processing.
import { WORLD } from './config.js';
import { buildBuilding } from './buildings.js';
import { PROP_BY_ID, buildProp } from './props.js';
import { meshGrid, fracture } from './mesher.js';
import { isWater, METRO } from './world.js';
import { Terrain } from './terrain3d.js';
import { VoxelGrid, hash3, shade } from './voxel.js';
import { FX } from './fx3d.js';
import { Actors, toGeometry } from './actors3d.js';
import { Ambient } from './ambient3d.js';
import { personModel } from './models.js';

export const QUALITY = {
  high: { name: 'High', pixelRatio: 1.5, shadows: 2048, bloom: true, tilt: true, lights: 8 },
  medium: { name: 'Medium', pixelRatio: 1, shadows: 1024, bloom: true, tilt: false, lights: 6 },
  low: { name: 'Low', pixelRatio: 0.75, shadows: 0, bloom: false, tilt: false, lights: 4 },
};
const POINT_LIGHTS = 8;
const YAW = 0.62;
const PITCH = 0.92; // ~53 degrees down
const FOV = 32;

// Lighting keyframes: golden afternoon -> sunset -> neon night.
const SKY = [
  { sun: 0xffdcb0, sunI: 0.8, elev: 0.6, az: -0.9, hemiS: 0xe4eaf6, hemiG: 0xa0907a, hemiI: 0.68, fog: 0xf0d6b8, night: 0, bloom: 0.2, water: 0x3a8ac0 },
  { sun: 0xff9a60, sunI: 0.8, elev: 0.3, az: -1.25, hemiS: 0xc0a8d8, hemiG: 0x7a6670, hemiI: 0.78, fog: 0xd99aa6, night: 0.35, bloom: 0.45, water: 0x3a6a9a },
  { sun: 0xa8bcff, sunI: 0.38, elev: 0.95, az: 0.6, hemiS: 0x6a7cc0, hemiG: 0x3a3a52, hemiI: 0.78, fog: 0x18204a, night: 1, bloom: 0.65, water: 0x163a60 },
];

function lerpKey(t) {
  const seg = t < 0.5 ? 0 : 1;
  const f = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = SKY[seg];
  const b = SKY[seg + 1];
  const out = {};
  for (const k of Object.keys(a)) {
    if (['sun', 'hemiS', 'hemiG', 'fog', 'water'].includes(k)) out[k] = new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), f);
    else out[k] = a[k] + (b[k] - a[k]) * f;
  }
  return out;
}

// Pixel-art grade for the low-resolution render: 1px dark outlines where a pixel sits next to
// something brighter (silhouettes, windows, roof edges), a little extra saturation, and a
// limited palette with an ordered dither so gradients band like hand-made pixel art.
const PIXEL_GRADE = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, levels: { value: 22 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float levels;
    varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 px = 1.0 / resolution;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = lum(c);
      float n = max(max(lum(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb), lum(texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb)),
                    max(lum(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb), lum(texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb)));
      c *= 1.0 - smoothstep(0.1, 0.3, n - l) * 0.5;
      c = mix(vec3(lum(c)), c, 1.15);
      vec2 f = mod(floor(gl_FragCoord.xy), 2.0);
      float bayer = (f.x * 2.0 + f.y * 3.0 - f.x * f.y * 4.0) / 4.0 - 0.375;
      c = floor(c * levels + 0.5 + bayer * 0.9) / levels;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Miniature look: blur away from a horizontal focus band (golden-angle disc), soft vignette.
const TILT_SHIFT = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, focus: { value: 0.52 }, amount: { value: 5 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float focus; uniform float amount;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focus);
      float r = smoothstep(0.14, 0.5, d) * amount;
      vec4 sum = texture2D(tDiffuse, vUv);
      float w = 1.0;
      if (r > 0.35) {
        for (int i = 0; i < 18; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt(float(i) + 0.5) / 4.24 * r;
          sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr / resolution);
          w += 1.0;
        }
      }
      vec4 c = sum / w;
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - dot(q, q) * 0.55;
      gl_FragColor = c;
    }`,
};

// selfLit: how much of its own colour a surface shows regardless of light (keeps the kaiju readable at dusk).
export function makeVoxelMaterial(uniforms, selfLit = 0) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uSelf = { value: selfLit };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlags;\nvarying float vFlags;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlags = aFlags;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uSelf;\nvarying float vFlags;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fE = mod(vFlags, 2.0);
        float fW = step(1.5, mod(vFlags, 4.0));
        vec3 baseCol = diffuseColor.rgb;
        if (fW > 0.5) {
          diffuseColor.rgb = mix(vec3(0.26, 0.36, 0.48), baseCol * 0.35, uNight);
          totalEmissiveRadiance += baseCol * uNight * 1.45;
        }
        if (fE > 0.5) totalEmissiveRadiance += baseCol * mix(0.55, 1.75, uNight);
        // City glow at night: every surface keeps a little of its own colour so facades read.
        totalEmissiveRadiance += baseCol * 0.2 * smoothstep(0.0, 0.7, uNight);
        totalEmissiveRadiance += baseCol * uSelf * (0.35 + 0.65 * uNight);`);
    // Separate program per self-lit level.
    m.customProgramCacheKey = () => `voxel-${selfLit}`;
  };
  return m;
}

export class Renderer3D {
  constructor(canvas, { quality = 'high', floaterLayer = null, pixelArt = false } = {}) {
    this.canvas = canvas;
    this.floaterLayer = floaterLayer;
    this.pixelArt = pixelArt;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
    this.uniforms = { uNight: { value: 0 } };
    this.voxelMat = makeVoxelMaterial(this.uniforms);
    // Hit flash: the same voxels lit pure white for a few frames.
    this.flashMat = makeVoxelMaterial(this.uniforms);
    this.flashMat.emissive.setRGB(1.25, 1.25, 1.22);
    this.flashPool = [];
    this.t = 0;
    this.dusk = 0;
    this.camDist = 200;
    this.target = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.points = [];
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 50, 1.6);
      this.scene.add(p);
      this.points.push(p);
    }
    this.scene.fog = new THREE.Fog(0xf0d6b8, 300, 1200);
    this.scene.background = new THREE.Color(0xf0d6b8);

    this.fx = new FX(this.scene);
    this.actors = new Actors(this.scene, (selfLit = 0) => makeVoxelMaterial(this.uniforms, selfLit));
    this.ambient = new Ambient(this.scene, this.voxelMat);
    this.terrain = new Terrain(this.scene, this.renderer);
    this.bridgeMeshes = new Map();
    this._pm = new THREE.Matrix4();
    this._pq = new THREE.Quaternion();
    this._pe = new THREE.Euler();
    this._pv = new THREE.Vector3();
    this._ps = new THREE.Vector3(1, 1, 1);
    this.variants = new Map();
    this.propCache = new Map();
    this.bld = new Map();
    this.buildQueue = [];
    this.remeshQueue = new Set();
    this.collapses = new Set();
    this.rubbleCache = new Map();
    this.bInst = new Map();
    this.rInst = new Map();
    this.floaters = new Map();
    this.cityBuilt = null;
    this.frameTimes = [];
    this.setQuality(quality);
    this.resize();
  }

  // ---------------------------------------------------------------- setup
  setQuality(q) {
    this.qualityName = q;
    this.quality = QUALITY[q];
    const sh = this.quality.shadows;
    this.renderer.shadowMap.enabled = sh > 0;
    this.sun.castShadow = sh > 0;
    if (sh > 0) {
      this.sun.shadow.mapSize.set(sh, sh);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.composer = null;
    this.bloom = null;
    this.tilt = null;
    this.grade = null;
    if ((this.quality.bloom || this.pixelArt) && THREE.EffectComposer) {
      const c = new THREE.EffectComposer(this.renderer);
      c.addPass(new THREE.RenderPass(this.scene, this.camera));
      if (this.quality.bloom && THREE.UnrealBloomPass) {
        this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.93);
        c.addPass(this.bloom);
      }
      // Tilt-shift blur would smear the pixels, so the pixel look skips it.
      this.tilt = this.quality.tilt && !this.pixelArt ? new THREE.ShaderPass(TILT_SHIFT) : null;
      if (this.tilt) c.addPass(this.tilt);
      this.grade = this.pixelArt ? new THREE.ShaderPass(PIXEL_GRADE) : null;
      if (this.grade) c.addPass(this.grade);
      this.composer = c;
    }
    this.resize(true);
  }

  setPixelArt(on) {
    this.pixelArt = on;
    this.setQuality(this.qualityName);
  }

  resize(force = false) {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (!force && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    // Pixel look: render a small frame (about 260 px on the short side) and let the browser
    // blow it up with nearest-neighbour sampling.
    const pr = this.pixelArt ? 1 / Math.max(2, Math.round(Math.min(w, h) / 260)) : Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.pr = pr;
    this.canvas.style.imageRendering = this.pixelArt ? 'pixelated' : '';
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.bloom) this.bloom.resolution.set(w * pr * (this.pixelArt ? 1 : 0.5), h * pr * (this.pixelArt ? 1 : 0.5));
      if (this.grade) this.grade.uniforms.resolution.value.set(Math.round(w * pr), Math.round(h * pr));
      if (this.tilt) {
        this.tilt.uniforms.resolution.value.set(w * pr, h * pr);
        this.tilt.uniforms.amount.value = 5.5 * pr;
      }
    }
    this.fx.setScale((h * pr) / (2 * Math.tan((FOV * Math.PI) / 360)));
  }

  // Screen-space stick direction -> world direction for this camera.
  worldDir(ix, iy) {
    const c = Math.cos(YAW);
    const s = Math.sin(YAW);
    return { x: c * ix + s * iy, y: -s * ix + c * iy };
  }

  // Follow a streaming world: cells loading and unloading add and drop bridges and meshes.
  buildCity(world) {
    if (this.cityBuilt === world) return;
    this.clearCity();
    this.cityBuilt = world;
    this.city = world;
    this.terrain.attach(world);
    this.ambient.build(world);
    this.listener = { load: (ch) => this.chunkLoaded(ch), unload: (ch) => this.chunkUnloaded(ch) };
    world.listeners.add(this.listener);
    for (const ch of world.chunks.values()) this.chunkLoaded(ch);
  }

  chunkLoaded(ch) {
    this.propsDirty = true;
    this.buildingsDirty = true;
    this.ambient.dirty = true;
    for (const b of ch.bridges) this.buildBridge(ch, b);
  }

  chunkUnloaded(ch) {
    this.propsDirty = true;
    this.buildingsDirty = true;
    this.ambient.dirty = true;
    for (const [id, rec] of this.bld) {
      if (rec.obj.chunk !== ch) continue;
      this.disposeRec(rec);
      this.bld.delete(id);
      this.collapses.delete(rec);
      this.remeshQueue.delete(rec);
    }
    const parts = this.bridgeMeshes.get(ch);
    if (parts) {
      for (const bp of parts) for (const m of bp.meshes) {
        this.scene.remove(m);
        m.dispose();
      }
      this.bridgeMeshes.delete(ch);
    }
  }

  // Distinct voxel colours of a person look (skin, hair, shirt, trousers) for crumbs.
  personColors(variant) {
    this.pcols = this.pcols || new Map();
    let cols = this.pcols.get(variant);
    if (!cols) {
      const set = new Set();
      for (const v of personModel(variant).grid.data) if (v) set.add(v & 0xffffff);
      cols = [...set];
      this.pcols.set(variant, cols);
    }
    return cols;
  }

  // Damaged-but-standing things flash white: hit buildings swap to the flash material, and
  // instanced props get a white copy drawn just over them.
  updateFlashes(game) {
    for (const rec of this.bld.values()) {
      if (!rec.mesh) continue;
      const o = rec.obj;
      const flashing = o.flash > 0 && o.state === 'intact';
      rec.mesh.material = flashing ? this.flashMat : this.voxelMat;
      // Squash on impact: the building gives a little and springs back.
      if (o.state === 'intact') {
        const f = flashing ? Math.sin((1 - o.flash / 0.13) * Math.PI) : 0;
        rec.mesh.scale.set(1 + f * 0.035, 1 - f * 0.05, 1 + f * 0.035);
      }
    }
    let n = 0;
    for (const o of game.active) {
      if (o.kind !== 'prop' || o.state !== 'intact' || !(o.flash > 0)) continue;
      const e = this.propCache.get(`${o.type}:${o.variant}`);
      if (!e) continue;
      let m = this.flashPool[n];
      if (!m) {
        m = new THREE.Mesh(e.geo, this.flashMat);
        this.scene.add(m);
        this.flashPool.push(m);
      }
      n++;
      m.geometry = e.geo;
      m.visible = true;
      m.position.set(o.x, 0, o.y);
      m.rotation.set(0, (o.rot * Math.PI) / 2, 0);
      m.scale.setScalar(1.06);
    }
    for (let i = n; i < this.flashPool.length; i++) this.flashPool[i].visible = false;
  }

  // A new run brings a new world: drop everything the previous one added to the scene.
  clearCity() {
    if (!this.cityBuilt) return;
    this.cityBuilt.listeners.delete(this.listener);
    for (const ch of [...this.bridgeMeshes.keys()]) this.chunkUnloaded(ch);
    this.terrain.clear();
    this.ambient.clear();
    for (const e of this.propCache.values()) e.n = 0;
    this.cityBuilt = null;
    this.lastPropAt = null;
    this.lastBldAt = null;
  }

  startRun(game) {
    this.buildCity(game.city);
    for (const rec of this.bld.values()) this.disposeRec(rec);
    this.bld.clear();
    this.buildQueue = [];
    this.remeshQueue.clear();
    this.collapses.clear();
    this.fx.clear();
    this.actors.clear();
    this.actors.setKaiju(game.def.id);
    this.ambient.reset();
    for (const [, f] of this.floaters) f.el.remove();
    this.floaters.clear();
    this.propsDirty = true;
    this.buildingsDirty = true;
    this.dusk = game.dusk;
    const k = game.kaiju;
    this.target.set(k.x, 0, k.y);
    this.camDist = this.distFor(game.viewSpan(k.r));
    // Paint the ground around the drop-in point before the first frame.
    this.terrain.update(k.stage, k.x, k.y, game.viewSpan(k.r), 0, new THREE.Color(SKY[0].water), 0, 60);
  }

  // ---------------------------------------------------------------- props (instanced, refilled for the view)
  propEntry(type, variant) {
    const key = `${type}:${variant}`;
    let e = this.propCache.get(key);
    if (!e) {
      const p = buildProp(type, variant);
      const geo = toGeometry(meshGrid(p.grid, { v: p.v, ox: p.origin.x, oz: p.origin.z, jitter: 0.05 }));
      e = { key, type, built: p, geo, im: null, cap: 0, n: 0 };
      this.propCache.set(key, e);
    }
    return e;
  }

  // Instanced meshes grow as the view takes in more of the city.
  ensureInst(e, need, castShadow) {
    if (e.im && e.cap >= need) return;
    if (e.im) {
      this.scene.remove(e.im);
      e.im.dispose();
    }
    e.cap = Math.max(16, 2 ** Math.ceil(Math.log2(need * 1.3)));
    e.im = new THREE.InstancedMesh(e.geo, this.voxelMat, e.cap);
    e.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    e.im.frustumCulled = false;
    e.im.count = 0;
    e.im.castShadow = castShadow;
    e.im.receiveShadow = true;
    this.scene.add(e.im);
  }

  refreshProps(game, half) {
    const k = game.kaiju;
    const cx = this.target.x;
    const cz = this.target.z;
    const moved = !this.lastPropAt || Math.hypot(cx - this.lastPropAt.x, cz - this.lastPropAt.z) > half * 0.08 || Math.abs(half - this.lastPropAt.half) > half * 0.05;
    if (!moved && !this.propsDirty) return;
    this.lastPropAt = { x: cx, z: cz, half };
    this.propsDirty = false;
    for (const e of this.propCache.values()) e.n = 0;
    const pxPerUnit = this.h / (half * 2);
    const R = half * 1.5;
    const found = game.grid.query(cx - R, cz - R, cx + R, cz + R);
    let grow = false;
    for (const o of found) {
      if (o.kind !== 'prop' || o.state !== 'intact') continue;
      if (o.height * pxPerUnit < 1.2 && o.tier < k.stage - 1) continue;
      const e = this.propEntry(o.type, o.variant);
      e.n++;
      if (!e.im || e.n > e.cap) grow = true;
    }
    if (grow) {
      for (const e of this.propCache.values()) if (e.n && (!e.im || e.n > e.cap)) this.ensureInst(e, e.n, PROP_BY_ID[e.type].tier >= 2);
    }
    for (const e of this.propCache.values()) e.n = 0;
    for (const o of found) {
      if (o.kind !== 'prop' || o.state !== 'intact') continue;
      if (o.height * pxPerUnit < 1.2 && o.tier < k.stage - 1) continue;
      const e = this.propCache.get(`${o.type}:${o.variant}`);
      if (!e || !e.im || e.n >= e.cap) continue;
      this._pv.set(o.x, 0, o.y);
      this._pe.set(0, (o.rot * Math.PI) / 2, 0);
      this._pq.setFromEuler(this._pe);
      this._pm.compose(this._pv, this._pq, this._ps);
      e.im.setMatrixAt(e.n++, this._pm);
    }
    for (const e of this.propCache.values()) {
      if (!e.im) continue;
      e.im.count = e.n;
      e.im.visible = e.n > 0;
      e.im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- bridge cables
  // Cables hang from each tower and dip to their lowest halfway to the next one.
  buildBridge(ch, b) {
    const tw = b.tower;
    const top = b.towerHeight * 0.97;
    const deck = b.deckHeight;
    const mid = (b.a0 + b.a1) / 2;
    const halfSpan = (b.a1 - b.a0) / 2;
    const curve = (a) => deck + 6 + (top - deck - 6) * Math.pow((a - mid) / halfSpan, 2);
    const pos = (a, side, y) => (b.horiz ? new THREE.Vector3(a, y, b.at + side) : new THREE.Vector3(b.at + side, y, a));
    this._box = this._box || new THREE.BoxGeometry(1, 1, 1);
    this._cableMat = this._cableMat || new THREE.MeshLambertMaterial({ color: 0xc0432c });
    const cables = [];
    const suspenders = [];
    const lamps = [];
    for (const side of [-b.half, b.half]) {
      for (let a = b.a0; a < b.a1; a += 4) {
        const y0 = curve(a);
        const y1 = curve(a + 4);
        cables.push({ p: pos(a + 2, side, (y0 + y1) / 2), len: Math.hypot(4, y1 - y0), ang: Math.atan2(y1 - y0, 4) });
        if (Math.round(a) % 16 < 4) suspenders.push({ p: pos(a, side, (y0 + deck) / 2), h: y0 - deck });
        if (Math.round(a) % 40 < 4) lamps.push(pos(a, side, y0 + 1.5));
      }
    }
    const mk = (n, mat) => {
      const im = new THREE.InstancedMesh(this._box, mat, Math.max(1, n));
      im.frustumCulled = false;
      this.scene.add(im);
      return im;
    };
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    const cim = mk(cables.length, this._cableMat);
    const sim = mk(suspenders.length, this._cableMat);
    const lim = mk(lamps.length, lampMat);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    cables.forEach((c, i) => {
      if (b.horiz) e.set(0, 0, c.ang);
      else e.set(-c.ang, 0, 0);
      q.setFromEuler(e);
      m.compose(c.p, q, b.horiz ? new THREE.Vector3(c.len + 0.5, 2.2, 2.2) : new THREE.Vector3(2.2, 2.2, c.len + 0.5));
      cim.setMatrixAt(i, m);
    });
    suspenders.forEach((sp, i) => {
      m.compose(sp.p, new THREE.Quaternion(), new THREE.Vector3(0.8, Math.max(0.1, sp.h), 0.8));
      sim.setMatrixAt(i, m);
    });
    lamps.forEach((l, i) => {
      m.compose(l, new THREE.Quaternion(), new THREE.Vector3(2, 2, 2));
      lim.setMatrixAt(i, m);
    });
    cim.castShadow = true;
    if (!this.bridgeMeshes.has(ch)) this.bridgeMeshes.set(ch, []);
    this.bridgeMeshes.get(ch).push({ tower: tw, meshes: [cim, sim, lim], lampsMat: lampMat });
  }

  // ---------------------------------------------------------------- buildings
  variant(o) {
    const key = `${o.type}:${o.variant}`;
    let v = this.variants.get(key);
    if (!v) {
      const built = buildBuilding(o.type, o.variant);
      const geo = toGeometry(meshGrid(built.grid, { v: built.dims.v, ox: built.origin.x, oz: built.origin.z }));
      v = { key, built, geo, frac: null };
      this.variants.set(key, v);
    }
    return v;
  }

  fracture(v) {
    if (!v.frac) {
      const d = v.built.dims;
      const spacing = Math.max(3, Math.min(6, Math.round(Math.max(d.bx, d.bz, d.by) / 7)));
      v.frac = fracture(v.built.grid, spacing);
    }
    return v.frac;
  }

  // Instanced mesh for one building variant (intact, simplified, or its rubble pile).
  instFor(map, key, geo) {
    let e = map.get(key);
    if (!e) {
      e = { geo, im: null, n: 0, cap: 0 };
      map.set(key, e);
    }
    return e;
  }

  // Half-resolution voxel copy of a building, for when it is small next to the kaiju.
  lodGeo(v) {
    if (v.lod) return v.lod;
    const g = v.built.grid;
    const nx = Math.ceil(g.nx / 2);
    const ny = Math.ceil(g.ny / 2);
    const nz = Math.ceil(g.nz / 2);
    const out = new VoxelGrid(nx, ny, nz);
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let val = 0;
      let cnt = 0;
      for (let dy = 1; dy >= 0; dy--) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        const s2 = g.get(x * 2 + dx, y * 2 + dy, z * 2 + dz);
        if (!s2) continue;
        cnt++;
        if (!val) val = s2;
      }
      if (cnt >= 3) out.data[out.idx(x, y, z)] = val;
    }
    const b = v.built;
    v.lod = toGeometry(meshGrid(out, { v: b.dims.v * 2, ox: b.origin.x / 2, oz: b.origin.z / 2 }));
    return v.lod;
  }

  // A building gets its own mesh only once it is hit, so it can lose chunks and fall.
  ensureMesh(o) {
    let rec = this.bld.get(o.id);
    if (rec && rec.mesh) return rec;
    if (!rec) {
      rec = { obj: o, mesh: null, removed: null, geo: null };
      this.bld.set(o.id, rec);
    }
    rec.v = this.variant(o);
    if (o.state === 'rubble') return rec;
    const mesh = new THREE.Mesh(rec.geo || rec.v.geo, this.voxelMat);
    mesh.position.set(o.x, 0, o.y);
    mesh.rotation.y = (o.rot * Math.PI) / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    rec.mesh = mesh;
    this.buildingsDirty = true;
    return rec;
  }

  disposeRec(rec) {
    if (rec.mesh) this.scene.remove(rec.mesh);
    if (rec.geo) rec.geo.dispose();
    rec.mesh = null;
    rec.geo = null;
  }

  refreshBuildings(game, half) {
    const cx = this.target.x;
    const cz = this.target.z;
    const R = half * 1.7 + 160;
    const last = this.lastBldAt;
    const moved = !last || Math.hypot(cx - last.x, cz - last.z) > half * 0.08 || Math.abs(half - last.half) > half * 0.05;
    if (!moved && !this.buildingsDirty) return;
    this.lastBldAt = { x: cx, z: cz, half };
    this.buildingsDirty = false;
    const stage = game.kaiju.stage;
    const span = game.viewSpan();
    const missing = [];
    const list = [];
    for (const o of game.grid.query(cx - R, cz - R, cx + R, cz + R)) {
      if (o.kind !== 'building') continue;
      const rec = this.bld.get(o.id);
      const key = `${o.type}:${o.variant}`;
      const v = this.variants.get(key);
      if (!v) {
        missing.push(o);
        continue;
      }
      if (o.state === 'intact') {
        if (rec && rec.mesh) continue;
        // Buildings far below the kaiju's size (or far off at big sizes) use the simple mesh.
        const lod = o.tier <= stage - 2 || (stage >= 4 && o.tier <= stage - 1 && Math.hypot(o.x - cx, o.y - cz) > span * 1.1);
        list.push(lod ? this.instFor(this.bInst, `${key}:L`, null) : this.instFor(this.bInst, key, v.geo), o, 0);
        if (lod) list[list.length - 3].lodOf = v;
      } else if (!o.walkable && !(rec && rec.collapse)) {
        list.push(this.instFor(this.rInst, key, null), o, 1);
        list[list.length - 3].rubbleOf = v;
      }
    }
    for (const map of [this.bInst, this.rInst]) for (const e of map.values()) e.n = 0;
    for (let i = 0; i < list.length; i += 3) list[i].n++;
    for (const map of [this.bInst, this.rInst]) {
      for (const e of map.values()) {
        if (!e.n || (e.im && e.n <= e.cap)) continue;
        if (!e.geo) e.geo = e.lodOf ? this.lodGeo(e.lodOf) : this.rubbleGeo(e.rubbleOf);
        this.ensureInst(e, e.n, true);
      }
    }
    for (const map of [this.bInst, this.rInst]) for (const e of map.values()) e.n = 0;
    const m = this._pm;
    for (let i = 0; i < list.length; i += 3) {
      const e = list[i];
      const o = list[i + 1];
      if (!e.im || e.n >= e.cap) continue;
      if (list[i + 2] === 0) this._pv.set(o.x, 0, o.y);
      else {
        const dir = o.fallDir || { x: 0, y: 0 };
        this._pv.set(o.x + dir.x * o.w * 0.2, 0, o.y + dir.y * o.h * 0.2);
      }
      this._pe.set(0, (o.rot * Math.PI) / 2, 0);
      this._pq.setFromEuler(this._pe);
      m.compose(this._pv, this._pq, this._ps);
      e.im.setMatrixAt(e.n++, m);
    }
    for (const map of [this.bInst, this.rInst]) {
      for (const e of map.values()) {
        if (!e.im) continue;
        e.im.count = e.n;
        e.im.visible = e.n > 0;
        e.im.instanceMatrix.needsUpdate = true;
      }
    }
    // Build new variants nearest first, within a frame budget; refill next frame.
    if (missing.length) {
      missing.sort((a, b) => Math.hypot(a.x - cx, a.y - cz) - Math.hypot(b.x - cx, b.y - cz));
      const t0 = performance.now();
      for (const o of missing) {
        this.variant(o);
        if (performance.now() - t0 > 8) break;
      }
      this.buildingsDirty = true;
    }
    let n = 0;
    for (const rec of this.remeshQueue) {
      this.remesh(rec);
      this.remeshQueue.delete(rec);
      if (++n >= 3) break;
    }
  }

  remesh(rec) {
    if (!rec.mesh || !rec.removed) return;
    const b = rec.v.built;
    const m = meshGrid(b.grid, { v: b.dims.v, ox: b.origin.x, oz: b.origin.z, removed: rec.removed });
    if (rec.geo) rec.geo.dispose();
    rec.geo = toGeometry(m);
    rec.mesh.geometry = rec.geo;
  }

  localToWorld(o, lx, ly, lz) {
    const th = (o.rot * Math.PI) / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return { x: o.x + lx * c + lz * s, y: ly, z: o.y - lx * s + lz * c };
  }

  // A hit knocks the nearest pre-fractured chunks off the building as debris.
  chip(e) {
    const o = e.obj;
    const rec = this.ensureMesh(o);
    if (!rec.mesh) return;
    const v = rec.v;
    const b = v.built;
    const frac = this.fracture(v);
    if (!rec.removed) {
      rec.removed = new Uint8Array(b.grid.data.length);
      rec.chunksGone = new Uint8Array(frac.chunks.length);
    }
    const th = (o.rot * Math.PI) / 2;
    const dx = e.x - o.x;
    const dz = e.y - o.y;
    const vs = b.dims.v;
    const lx = (dx * Math.cos(th) - dz * Math.sin(th)) / vs + b.origin.x;
    const lz = (dx * Math.sin(th) + dz * Math.cos(th)) / vs + b.origin.z;
    const ly = (e.h * (0.35 + Math.random() * 0.65)) / vs;
    const cand = [];
    for (let i = 0; i < frac.chunks.length; i++) {
      if (rec.chunksGone[i]) continue;
      const c = frac.chunks[i];
      cand.push({ i, d: (c.cx - lx) ** 2 + ((c.cy - ly) * 0.8) ** 2 + (c.cz - lz) ** 2 });
    }
    cand.sort((a, b2) => a.d - b2.d);
    const n = Math.max(1, Math.min(18, Math.round(e.frac * frac.chunks.length * 0.6)));
    const dir = e.dir || { x: 0, y: 0 };
    for (let k = 0; k < Math.min(n, cand.length); k++) {
      const ci = cand[k].i;
      rec.chunksGone[ci] = 1;
      const c = frac.chunks[ci];
      for (const idx of c.voxels) rec.removed[idx] = 1;
      this.spawnChunk(o, b, c, dir, 1, c.voxels.length <= 40);
    }
    const wp = this.localToWorld(o, (lx - b.origin.x) * vs, ly * vs, (lz - b.origin.z) * vs);
    this.fx.dustCloud(wp.x, wp.y, wp.z, Math.max(3, vs * 3), 4);
    this.remeshQueue.add(rec);
  }

  spawnChunk(o, b, c, dir, power, perVoxel) {
    const vs = b.dims.v;
    const grid = b.grid;
    const height = b.dims.by;
    const up = c.cy / Math.max(1, height);
    const speed = vs * (6 + up * 10) * power;
    const out = this.localToWorld(o, (c.cx - b.origin.x) * vs, 0, (c.cz - b.origin.z) * vs);
    const ox = out.x - o.x;
    const oz = out.z - o.y;
    const ol = Math.hypot(ox, oz) || 1;
    const vx = (dir.x * 0.8 + (ox / ol) * 0.5) * speed;
    const vz = (dir.y * 0.8 + (oz / ol) * 0.5) * speed;
    const waterAt = isWater(o.x, o.y);
    if (perVoxel) {
      for (const idx of c.voxels) {
        const x = idx % grid.nx;
        const z = Math.floor(idx / grid.nx) % grid.nz;
        const y = Math.floor(idx / (grid.nx * grid.nz));
        const p = this.localToWorld(o, (x + 0.5 - b.origin.x) * vs, (y + 0.5) * vs, (z + 0.5 - b.origin.z) * vs);
        const col = grid.data[idx] & 0xffffff;
        this.fx.addDebris({
          x: p.x, y: p.y, z: p.z, vx: vx + (Math.random() - 0.5) * speed * 0.6, vy: speed * (0.2 + Math.random() * 0.5), vz: vz + (Math.random() - 0.5) * speed * 0.6,
          sx: vs * 0.95, sy: vs * 0.95, sz: vs * 0.95, size: vs, color: col, water: waterAt,
        });
      }
    } else {
      const p = this.localToWorld(o, (c.cx - b.origin.x) * vs, c.cy * vs, (c.cz - b.origin.z) * vs);
      this.fx.addDebris({
        x: p.x, y: p.y, z: p.z, vx: vx + (Math.random() - 0.5) * speed * 0.5, vy: speed * (0.1 + Math.random() * 0.4), vz: vz + (Math.random() - 0.5) * speed * 0.5,
        sx: c.size[0] * vs * 0.85, sy: c.size[1] * vs * 0.85, sz: c.size[2] * vs * 0.85, size: Math.max(...c.size) * vs, color: c.glow ? shade(c.color, 1.2) : c.color, water: waterAt,
      });
    }
  }

  // Break what is left of a building into flying chunks, most of them tipping the fall way.
  breakApart(rec, dir, share = 1, budget = 140) {
    const o = rec.obj;
    const v = rec.v || this.variant(o);
    const b = v.built;
    const frac = this.fracture(v);
    const left = [];
    for (let i = 0; i < frac.chunks.length; i++) if (!rec.chunksGone || !rec.chunksGone[i]) left.push(i);
    left.sort((a, c) => frac.chunks[c].cy - frac.chunks[a].cy);
    const n = Math.min(budget, Math.ceil(left.length * share));
    const step = left.length / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const c = frac.chunks[left[Math.floor(k * step)]];
      this.spawnChunk(o, b, c, dir, 1.2, false);
    }
  }

  destroyed(e) {
    const o = e.obj;
    if (o.kind === 'prop') return this.propBreak(o, e.dir);
    this.buildingsDirty = true;
    const dist = Math.hypot(o.x - this.target.x, o.y - this.target.z);
    if (dist > this.camDist * 2) {
      const rec = this.bld.get(o.id);
      if (rec) {
        this.disposeRec(rec);
        this.bld.delete(o.id);
      }
      return;
    }
    const rec = this.ensureMeshFor(o);
    const size = Math.max(o.w, o.h);
    this.fx.dustCloud(o.x, 0, o.y, size * 0.6, 12);
    if (e.animated) {
      rec.collapse = { t: 0, dur: 0.9 + o.tier * 0.15, dir: e.dir, nextBurst: 0.1 };
      this.collapses.add(rec);
      this.breakApart(rec, e.dir, 0.25, 50);
    } else {
      this.breakApart(rec, e.dir, 1, 90);
      this.disposeRec(rec);
      this.bld.delete(o.id);
    }
  }

  // Like ensureMesh, but works after the game already marked the building as collapsing.
  ensureMeshFor(o) {
    let rec = this.bld.get(o.id);
    if (rec && rec.mesh) return rec;
    if (!rec) {
      rec = { obj: o, mesh: null, removed: null, geo: null };
      this.bld.set(o.id, rec);
    }
    rec.v = this.variant(o);
    const mesh = new THREE.Mesh(rec.geo || rec.v.geo, this.voxelMat);
    mesh.position.set(o.x, 0, o.y);
    mesh.rotation.y = (o.rot * Math.PI) / 2;
    mesh.castShadow = true;
    this.scene.add(mesh);
    rec.mesh = mesh;
    return rec;
  }

  updateCollapses(dt) {
    for (const rec of this.collapses) {
      const c = rec.collapse;
      const o = rec.obj;
      c.t += dt;
      const p = Math.min(1, c.t / c.dur);
      if (rec.mesh) {
        const ang = 0.95 * p * p;
        const axis = new THREE.Vector3(c.dir.y, 0, -c.dir.x).normalize();
        const qt = new THREE.Quaternion().setFromAxisAngle(axis, ang);
        const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (o.rot * Math.PI) / 2);
        rec.mesh.quaternion.copy(qt.multiply(qr));
        rec.mesh.position.set(o.x + c.dir.x * o.height * 0.3 * p, -o.height * 0.9 * Math.pow(p, 1.7), o.y + c.dir.y * o.height * 0.3 * p);
      }
      c.nextBurst -= dt;
      if (c.nextBurst <= 0) {
        c.nextBurst = 0.12;
        this.fx.dustCloud(o.x + c.dir.x * o.height * 0.3 * p, 0, o.y + c.dir.y * o.height * 0.3 * p, Math.max(o.w, o.h) * 0.5, 4);
      }
      if (p >= 1) {
        this.breakApart(rec, c.dir, 0.6, 90);
        this.disposeRec(rec);
        this.bld.delete(o.id);
        this.collapses.delete(rec);
        this.buildingsDirty = true;
        this.fx.dustCloud(o.x, 0, o.y, Math.max(o.w, o.h) * 0.8, 10);
      }
    }
  }

  rubbleGeo(v) {
    let g = this.rubbleCache.get(v.key);
    if (g) return g;
    const b = v.built;
    // Rubble takes the building's own most common bright colours plus concrete greys.
    const tally = new Map();
    const data = b.grid.data;
    for (let i = 0; i < data.length; i += 7) {
      const c = data[i] & 0xffffff;
      if (!data[i] || ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255) < 120) continue;
      tally.set(c, (tally.get(c) || 0) + 1);
    }
    const colors = [...tally.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map((x) => x[0]);
    colors.push(0x8d8a83, 0x6f6c66, 0x4a4744);
    const nx = b.dims.bx + 4;
    const nz = b.dims.bz + 4;
    const maxH = Math.max(2, Math.min(12, Math.round(b.dims.by * 0.2 + 1)));
    const grid = new VoxelGrid(nx, maxH + 1, nz);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const d = Math.hypot((x + 0.5 - nx / 2) / (nx / 2), (z + 0.5 - nz / 2) / (nz / 2));
      const hh = Math.round((1 - d) * maxH * (0.55 + 0.45 * hash3(x >> 1, 0, z >> 1)) + hash3(x, 1, z) * 1.5);
      for (let y = 0; y < hh; y++) grid.set(x, y, z, colors[Math.floor(hash3(x, y, z) * colors.length)]);
    }
    g = toGeometry(meshGrid(grid, { v: b.dims.v, ox: nx / 2, oz: nz / 2, jitter: 0.1 }));
    this.rubbleCache.set(v.key, g);
    return g;
  }

  propBreak(o, dir) {
    this.propsDirty = true;
    const e = this.propCache.get(`${o.type}:${o.variant}`);
    if (!e) return;
    const dist = Math.hypot(o.x - this.target.x, o.y - this.target.z);
    if (dist > this.camDist * 1.5) return;
    const p = e.built;
    const g = p.grid;
    const vs = p.v;
    const th = (o.rot * Math.PI) / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const total = g.count();
    const keep = Math.min(1, 50 / Math.max(1, total));
    const speed = vs * 8 + o.height * 2;
    const d = dir || { x: 0, y: 0 };
    for (let y = 0; y < g.ny; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
      const val = g.get(x, y, z);
      if (!val || Math.random() > keep) continue;
      const lx = (x + 0.5 - p.origin.x) * vs;
      const lz = (z + 0.5 - p.origin.z) * vs;
      const sz = vs * (keep < 1 ? 1.3 : 1);
      this.fx.addDebris({
        x: o.x + lx * c + lz * s, y: (y + 0.5) * vs, z: o.y - lx * s + lz * c,
        vx: d.x * speed + (Math.random() - 0.5) * speed, vy: speed * (0.3 + Math.random() * 0.6), vz: d.y * speed + (Math.random() - 0.5) * speed,
        sx: sz, sy: sz, sz, size: sz, color: val & 0xffffff, life: 6 + Math.random() * 4, water: isWater(o.x, o.y),
      });
    }
    if (o.height > 6) this.fx.dustCloud(o.x, 0, o.y, Math.max(o.w, o.h) * 0.5, 3);
  }

  // ---------------------------------------------------------------- per-frame
  distFor(span) {
    return (span * 0.5) / Math.tan((FOV * Math.PI) / 360) * 1.05;
  }

  handleVfx(game) {
    const list = game.drainVfx();
    if (this.onVfx) this.onVfx(list, game);
    for (const e of list) {
      switch (e.t) {
        case 'step':
          // Footfalls kick up dust once the kaiju outgrows the backyard.
          if (e.stage >= 2) this.fx.dustCloud(e.x, 0, e.y, e.r * (0.35 + e.stage * 0.06), e.stage >= 4 ? 4 : 2);
          break;
        case 'hit':
          this.chip(e);
          break;
        case 'destroy':
          this.destroyed(e);
          break;
        case 'chip':
          this.fx.sparks(e.obj.x, e.obj.height * 0.6, e.obj.y, 0xfff4c2, Math.max(0.5, e.obj.w * 0.1), 4);
          break;
        case 'dust':
          this.fx.dustCloud(e.x, 0, e.y, e.r, 6);
          break;
        case 'explode':
          this.fx.fireBurst(e.x, 0, e.y, e.r, 8);
          break;
        case 'sparks':
          this.fx.sparks(e.x, e.h, e.y, e.color, Math.max(0.3, game.kaiju.r * 0.1), 3);
          break;
        case 'chomp': {
          // The jaw snaps shut: cartoon crumbs in the eaten person's own colours tumble out.
          const k = game.kaiju;
          const m = this.actors.mouthWorld();
          const cols = this.personColors(e.p.variant);
          const sz = Math.max(0.16, k.r * 0.07);
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = k.r * (0.6 + Math.random() * 1.4);
            this.fx.addDebris({
              x: m.x, y: m.y, z: m.z,
              vx: Math.cos(a) * sp + k.facing.x * k.r, vy: k.r * (1.2 + Math.random() * 2.2), vz: Math.sin(a) * sp + k.facing.y * k.r,
              sx: sz, sy: sz, sz, size: sz, color: cols[i % cols.length], life: 2 + Math.random() * 1.5,
            });
          }
          this.fx.sparks(m.x, m.y, m.z, 0xffffff, Math.max(0.3, k.r * 0.22), 7);
          break;
        }
        case 'swallow': {
          const k = game.kaiju;
          if (e.burp) {
            const m = this.actors.mouthWorld();
            this.fx.dustCloud(m.x, m.y, m.z, Math.max(0.6, k.r * 0.35), 3, 0xd8ffc8);
            game.fx.floaters.push({ x: k.x, y: k.y, h: k.r * 2.4, text: 'burp!', color: '#c8ffb2', life: 1, max: 1 });
          }
          break;
        }
        case 'poof':
          this.fx.dustCloud(e.x, 1, e.y, 1.2, 3, 0xf2efe6);
          break;
        case 'unitDie': {
          const u = e.u;
          this.fx.fireBurst(u.x, u.flying ? game.kaiju.r * 2 : 0, u.y, u.r * 1.5, 6);
          for (let i = 0; i < 6; i++) this.fx.addDebris({ x: u.x, y: u.r, z: u.y, vx: e.dir.x * u.r * 6 + (Math.random() - 0.5) * u.r * 6, vy: u.r * (3 + Math.random() * 4), vz: e.dir.y * u.r * 6 + (Math.random() - 0.5) * u.r * 6, sx: u.r * 0.4, sy: u.r * 0.3, sz: u.r * 0.4, size: u.r * 0.4, color: 0x3a3d42, life: 5 });
          break;
        }
        case 'carDie': {
          const c = e.car;
          this.propBreak({ type: c.model, variant: c.variant, x: c.x, y: c.y, rot: 0, height: 8, w: 12, h: 6 }, e.dir);
          break;
        }
        case 'trainDie': {
          const tr = e.train;
          const deck = METRO.deck + 4;
          this.fx.fireBurst(tr.x, deck, tr.y, 24, 10);
          for (let i = 0; i < 3; i++) {
            const p = game.metroAt(tr.s - tr.dir * i * 36, tr.row);
            this.fx.addDebris({ x: p.x, y: deck, z: p.y, vx: e.dir.x * 40 + (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 30, vz: e.dir.y * 40 + (Math.random() - 0.5) * 30, sx: 34, sy: 12, sz: 12, size: 34, color: 0xc8ccd2, life: 12 });
          }
          break;
        }
        case 'bossDie':
          this.fx.fireBurst(e.b.x, e.b.r, e.b.y, e.b.r, 30);
          break;
        default:
          break;
      }
    }
  }

  updateLights(game, night) {
    const cands = [];
    for (const l of this.fx.lights) cands.push({ ...l, intensity: l.intensity * (l.life / l.max), prio: 4 });
    for (const l of this.actors.lightSources(game, this.t)) cands.push(l);
    if (night > 0.15) {
      const R = this.camDist * 0.7;
      const near = game.city.lightGrid.query(this.target.x - R, this.target.z - R, this.target.x + R, this.target.z + R);
      const arr = [];
      for (const l of near) {
        if (l.obj && l.obj.state !== 'intact') continue;
        arr.push({ l, d: Math.hypot(l.x - this.target.x, l.y - this.target.z) });
      }
      arr.sort((a, b) => a.d - b.d);
      for (const { l } of arr.slice(0, 5)) {
        const flick = l.flicker ? 0.8 + Math.random() * 0.4 : 1;
        cands.push({ x: l.x, y: l.height * 0.9, z: l.y, color: l.color, intensity: (l.big ? 0.8 : 0.55) * night * flick, radius: l.big ? 400 : Math.max(30, l.height * 4), prio: 1 });
      }
    }
    cands.sort((a, b) => b.prio - a.prio);
    const max = this.quality.lights;
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const p = this.points[i];
      const c = i < max ? cands[i] : null;
      if (!c) {
        p.intensity = 0;
        p.visible = false;
        continue;
      }
      p.visible = true;
      p.position.set(c.x, c.y, c.z);
      p.color.setHex(c.color);
      p.intensity = c.intensity;
      p.distance = c.radius;
    }
  }

  updateFloaters(game) {
    if (!this.floaterLayer) return;
    const live = new Set();
    const v = new THREE.Vector3();
    for (const f of game.fx.floaters) {
      live.add(f);
      let entry = this.floaters.get(f);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'floater';
        el.textContent = f.text;
        this.floaterLayer.appendChild(el);
        entry = { el };
        this.floaters.set(f, entry);
      }
      const p = 1 - f.life / f.max;
      v.set(f.x, f.h + p * f.h * 0.4, f.y).project(this.camera);
      entry.el.style.transform = `translate(${((v.x + 1) / 2) * this.w}px, ${((1 - v.y) / 2) * this.h}px) translate(-50%, -50%)`;
      entry.el.style.opacity = String(Math.min(1, (f.life / f.max) * 2));
    }
    for (const [f, entry] of this.floaters) {
      if (live.has(f)) continue;
      entry.el.remove();
      this.floaters.delete(f);
    }
  }

  // World position -> screen pixels (and whether it is in view).
  project(x, y, h = 0) {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h, behind: v.z > 1 };
  }

  kaijuElevation(game) {
    const k = game.kaiju;
    for (const o of game.grid.query(k.x - 1, k.y - 1, k.x + 1, k.y + 1)) {
      if (!o.walkable || o.state !== 'intact') continue;
      if (Math.abs(k.x - o.x) > o.w / 2 || Math.abs(k.y - o.y) > o.h / 2) continue;
      const top = o.type === 'bridge_deck' ? o.height - 4 : o.height;
      if (k.r * 2 < top + 8) return top;
    }
    return 0;
  }

  render(game, dt) {
    const t0 = performance.now();
    this.t += dt;
    this.resize();
    const k = game.kaiju;
    this.handleVfx(game);

    // Time of day follows run progress.
    this.dusk += (game.dusk - this.dusk) * Math.min(1, dt * 0.6);
    const key = lerpKey(this.dusk);
    this.uniforms.uNight.value = key.night;
    this.hemi.color.copy(key.hemiS);
    this.hemi.groundColor.copy(key.hemiG);
    this.hemi.intensity = key.hemiI;
    this.sun.color.copy(key.sun);
    this.sun.intensity = key.sunI;
    this.scene.fog.color.copy(key.fog);
    this.scene.background.copy(key.fog);
    if (this.bloom) this.bloom.strength = key.bloom;
    for (const parts of this.bridgeMeshes.values()) {
      for (const bp of parts) {
        const ok = bp.tower.state === 'intact';
        for (const m of bp.meshes) m.visible = ok;
        bp.lampsMat.color.setScalar(0.5 + key.night * 0.6);
      }
    }

    // Camera: tilted, looking slightly ahead of the kaiju, pulling back as it grows.
    const span = game.viewSpan(k.r);
    const aspect = this.w / this.h;
    const wantDist = this.distFor(span) * (aspect < 1 ? 1.15 : 1);
    this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 2.2);
    const lookX = k.x + k.facing.x * k.r * 1.2;
    const lookZ = k.y + k.facing.y * k.r * 1.2;
    if (Math.hypot(lookX - this.target.x, lookZ - this.target.z) > span * 2) {
      this.target.set(lookX, this.target.y, lookZ);
      this.camDist = wantDist;
    }
    this.target.x += (lookX - this.target.x) * Math.min(1, dt * 4);
    this.target.z += (lookZ - this.target.z) * Math.min(1, dt * 4);
    const elev = this.kaijuElevation(game);
    this.target.y += (elev + k.r * 0.6 - this.target.y) * Math.min(1, dt * 4);
    // Shake scales with how much of the city is on screen, so a thump reads the same at every size.
    const shake = game.shake * span * 0.022;
    // Zoom punch: big kills kick the camera in a touch, then it eases back out.
    const d = this.camDist * (1 - game.punch * 0.06);
    this.camera.position.set(
      this.target.x + Math.sin(YAW) * Math.cos(PITCH) * d + (Math.random() - 0.5) * shake,
      this.target.y + Math.sin(PITCH) * d + (Math.random() - 0.5) * shake,
      this.target.z + Math.cos(YAW) * Math.cos(PITCH) * d + (Math.random() - 0.5) * shake,
    );
    this.camera.lookAt(this.target);
    // A tight near/far ratio keeps depth precision high on phones (no z-fighting stripes).
    this.camera.near = Math.max(1, d * 0.25);
    this.camera.far = d * 4.5;
    this.camera.updateProjectionMatrix();
    this.scene.fog.near = d * 1.05;
    this.scene.fog.far = d * 3.4;

    // Sun / moon with a shadow box around the view.
    const sdir = new THREE.Vector3(Math.cos(key.az) * Math.cos(key.elev), Math.sin(key.elev), Math.sin(key.az) * Math.cos(key.elev));
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).addScaledVector(sdir, d * 2);
    if (this.sun.castShadow) {
      const sc = this.sun.shadow.camera;
      const ext = span * 0.85;
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 1;
      sc.far = d * 5;
      sc.updateProjectionMatrix();
      const texel = (2 * ext) / this.quality.shadows;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = texel * 1.2;
    }

    const half = span * 0.75;
    this.terrain.update(k.stage, this.target.x, this.target.z, span, key.night, key.water, this.t);
    this.refreshBuildings(game, half);
    this.updateCollapses(dt);
    this.refreshProps(game, half);
    this.actors.update(game, dt, this.t, elev);
    this.ambient.update(game, dt, this.t, { span, x: this.target.x, z: this.target.z });
    // Footsteps and wading
    if (k.moving && k.r >= 6) {
      const step = Math.floor(k.walkPhase / Math.PI);
      if (step !== this.lastStep) {
        this.lastStep = step;
        if (k.inWater) this.fx.dustCloud(k.x, 0.5, k.y, k.r * 0.8, 4, 0xe0f0ff);
        else this.fx.dustCloud(k.x, 0, k.y, k.r * 0.6, 3);
      }
    }
    this.fx.update(dt, game);
    this.updateLights(game, key.night);
    this.updateFlashes(game);
    this.updateFloaters(game);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.trackPerf(performance.now() - t0, dt);
  }

  // Step quality down if frames run long for a few seconds.
  trackPerf(ms, dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.04 && this.autoQuality !== false) {
      const next = this.qualityName === 'high' ? 'medium' : this.qualityName === 'medium' ? 'low' : null;
      if (next) {
        this.setQuality(next);
        if (this.onQualityChange) this.onQualityChange(next);
      }
    }
  }
}
