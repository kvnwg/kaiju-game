/* global THREE */
// How the realms past the city look: a painted nebula sky and a deep, twinkling starfield out in
// space, a sunny lawn in the back garden, and each realm's own light.

// Lighting per realm, in the same shape as the city's sky keys (see render3d.js SKY).
const LOOKS = {
  solar: {
    sky: ['#04030c', '#100c2c', '#22103e'], blobs: ['#3a1a6a', '#1a3a7a', '#5a1a4a'], stars: [0xffffff, 0xbfe6ff, 0xffe9b8],
    sun: 0xfff0d8, sunI: 1.15, elev: 0.75, az: -0.9, hemiS: 0x9aa8d8, hemiG: 0x1c1432, hemiI: 0.7, fog: 0x0a0820, night: 0.7, bloom: 0.7,
  },
  galaxy: {
    sky: ['#06031a', '#200e46', '#46164e'], blobs: ['#a83a8a', '#3a5ac8', '#d86a4a', '#6a2aa8'], stars: [0xffffff, 0xffd8f0, 0xbfe6ff, 0xfff2b0],
    sun: 0xffe0f0, sunI: 1.05, elev: 0.8, az: -0.6, hemiS: 0xb8a0e8, hemiG: 0x24103a, hemiI: 0.7, fog: 0x120828, night: 0.8, bloom: 0.8,
  },
  cosmos: {
    sky: ['#010106', '#081632', '#180834'], blobs: ['#2a8ac8', '#8a3ac8', '#c83a8a', '#2ac8a8'], stars: [0xffffff, 0x9fd8ff, 0xffb8e8, 0xd6b8ff],
    sun: 0xe0f0ff, sunI: 1, elev: 0.85, az: 0.4, hemiS: 0x8ab8e8, hemiG: 0x0c0c28, hemiI: 0.72, fog: 0x060618, night: 0.85, bloom: 0.85,
  },
  garden: {
    sun: 0xfff2c8, sunI: 0.85, elev: 0.95, az: -0.8, hemiS: 0xeaf6d0, hemiG: 0x4a6a2a, hemiI: 0.62, fog: 0xc6dc98, night: 0, bloom: 0.22,
  },
};

const STAR_VS = `
attribute float aSeed;
attribute vec3 color;
uniform vec2 uCenter;
uniform float uRange;
uniform float uDepth;
uniform float uSize;
uniform float uTime;
varying vec3 vColor;
varying float vTw;
void main() {
  // A pattern of stars repeating every uRange, centred on the view, uDepth below the play plane.
  vec2 w = position.xz * uRange;
  vec2 rel = mod(w - uCenter + 0.5 * uRange, uRange) - 0.5 * uRange;
  vec4 mv = modelViewMatrix * vec4(uCenter.x + rel.x, -uDepth, uCenter.y + rel.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.55 + 0.45 * fract(aSeed * 7.31));
  vTw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.5) + aSeed * 40.0);
  vColor = color;
}`;
const STAR_FS = `
varying vec3 vColor;
varying float vTw;
void main() {
  gl_FragColor = vec4(vColor * vTw, 1.0);
}`;

function skyTexture(look) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, look.sky[0]);
  g.addColorStop(0.55, look.sky[1]);
  g.addColorStop(1, look.sky[2]);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  // Soft nebula clouds, then a sprinkle of faint far stars.
  let seed = look.sky[1].length * 977;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const cx = rnd() * 256;
    const cy = rnd() * 256;
    const r = 40 + rnd() * 90;
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const col = look.blobs[i % look.blobs.length];
    rg.addColorStop(0, `${col}66`);
    rg.addColorStop(0.5, `${col}22`);
    rg.addColorStop(1, `${col}00`);
    x.fillStyle = rg;
    x.fillRect(0, 0, 256, 256);
  }
  x.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
    x.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

// The lawn: a tile of pixel grass, blades in three greens over a darker base, with the odd speck
// of soil and a tiny flower.
function grassTexture() {
  const n = 192;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const x = c.getContext('2d');
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  x.fillStyle = '#3d7530';
  x.fillRect(0, 0, n, n);
  // A few soft lighter and darker patches, so the lawn isn't one flat colour.
  for (let i = 0; i < 10; i++) {
    const cx = rnd() * n;
    const cy = rnd() * n;
    const r = 18 + rnd() * 40;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const col = rnd() < 0.5 ? '90,150,60' : '40,90,34';
    g.addColorStop(0, `rgba(${col},0.55)`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g;
    for (const [ox, oy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {
      x.save();
      x.translate(ox, oy);
      x.fillRect(-ox, -oy, n, n);
      x.restore();
    }
  }
  const greens = ['#4f8a38', '#5f9a44', '#6cab4a', '#2f6226', '#7cbc52'];
  for (let i = 0; i < 2600; i++) {
    const px = Math.floor(rnd() * n);
    const py = Math.floor(rnd() * n);
    x.fillStyle = greens[Math.floor(rnd() * greens.length)];
    x.fillRect(px, py, 1, 2 + Math.floor(rnd() * 4));
  }
  for (let i = 0; i < 70; i++) {
    x.fillStyle = rnd() < 0.7 ? '#5a4a30' : '#6e5c3c';
    x.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 1 + Math.floor(rnd() * 2), 1);
  }
  for (let i = 0; i < 8; i++) {
    x.fillStyle = rnd() < 0.5 ? '#fff6ec' : '#ffd84a';
    x.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

export class RealmBackdrop {
  constructor(scene) {
    this.scene = scene;
    this.realm = 'city';
    this.keys = {};
    this.skies = {};
    // Three layers of stars at different depths, for parallax as the kaiju swims along.
    this.layers = [];
    for (const [count, depth, size] of [[700, 0.6, 2], [500, 1.4, 2], [260, 2.6, 3]]) {
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = Math.random();
        pos[i * 3 + 2] = Math.random();
        seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.ShaderMaterial({
        vertexShader: STAR_VS, fragmentShader: STAR_FS, depthWrite: false,
        uniforms: { uCenter: { value: new THREE.Vector2() }, uRange: { value: 1000 }, uDepth: { value: 500 }, uSize: { value: size }, uTime: { value: 0 } },
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.visible = false;
      pts.renderOrder = -10;
      scene.add(pts);
      this.layers.push({ pts, geo, mat, depth, count });
    }
    // The lawn under the back garden: one big plane that follows the camera a whole tile at a
    // time, so the grass stays put on the ground.
    this.grassTile = 20;
    this.grassTex = grassTexture();
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: this.grassTex }));
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.ground.position.y = -0.05;
    scene.add(this.ground);
  }

  // The lighting key for a realm (THREE colours), like the city's lerpKey output.
  key(realm) {
    if (!this.keys[realm]) {
      const L = LOOKS[realm];
      const C = (v) => new THREE.Color(v);
      this.keys[realm] = {
        sun: C(L.sun), sunI: L.sunI, elev: L.elev, az: L.az, hemiS: C(L.hemiS), hemiG: C(L.hemiG), hemiI: L.hemiI,
        fog: C(L.fog), night: L.night, bloom: L.bloom, water: C(0x3a8ac0),
      };
    }
    return this.keys[realm];
  }

  // What the scene's background should be: a painted sky out in space, plain colour otherwise.
  background(realm) {
    const L = LOOKS[realm];
    if (!L || !L.sky) return null;
    if (!this.skies[realm]) this.skies[realm] = skyTexture(L);
    return this.skies[realm];
  }

  set(realm) {
    this.realm = realm;
    const L = LOOKS[realm];
    const space = Boolean(L && L.sky);
    for (const layer of this.layers) {
      layer.pts.visible = space;
      if (!space) continue;
      const col = layer.geo.attributes.color;
      const c = new THREE.Color();
      for (let i = 0; i < layer.count; i++) {
        c.set(L.stars[Math.floor(Math.random() * L.stars.length)]);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
    this.ground.visible = realm === 'garden';
  }

  update(t, tx, tz, span) {
    if (this.realm === 'city') return;
    for (const layer of this.layers) {
      if (!layer.pts.visible) continue;
      const u = layer.mat.uniforms;
      u.uCenter.value.set(tx, tz);
      u.uDepth.value = span * layer.depth;
      u.uRange.value = span * (2.4 + layer.depth * 2.2);
      u.uTime.value = t;
    }
    if (this.ground.visible) {
      const tile = this.grassTile;
      const size = Math.ceil((span * 8) / tile) * tile;
      this.ground.scale.set(size, 1, size);
      this.ground.position.set(Math.round(tx / tile) * tile, -0.05, Math.round(tz / tile) * tile);
      this.grassTex.repeat.set(size / tile, size / tile);
    }
  }
}
