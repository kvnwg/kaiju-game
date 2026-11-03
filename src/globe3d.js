/* global THREE */
// The globe size, drawn: the Earth as a pixel-art political map wrapped on a sphere under the
// kaiju's feet (see earth.js for the simulation). The map is painted from the same country grid
// the game bites into: each country a map colour that differs from its neighbours, crisp borders
// and coastlines, shallow water near the shore, ice at the poles. Bites repaint just the cells
// they took: scorched crust with a hot orange rim. Missiles arc over the globe and land on red
// telegraphs, all parented to the globe so they turn with it.
import { EARTH, worldMap } from './earth.js';

export const GLOBE_LAND = [0, 0x5fa84a, 0xd9a83a, 0xc8603e, 0x8f9a34, 0xe0803c, 0x8c6ab8, 0x3f9a8a];
const ICE_COL = 0xeef4f8;
const SEA_COLS = [0x5aa6d8, 0x3a86c4, 0x2a6aae, 0x22589a, 0x1c4a86];
const CRUST_COL = 0x3b2a28;
const RIM_COL = 0xff8a3a;

const ATMO_VS = `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ATMO_FS = `
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(clamp(1.0 + dot(vN, vV), 0.0, 1.0), 2.2);
  gl_FragColor = vec4(uColor * rim * 1.4, rim);
}`;

function cellHash(i) {
  let h = (i * 374761393) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tint(c, f) {
  return [Math.min(255, ((c >> 16) & 255) * f), Math.min(255, ((c >> 8) & 255) * f), Math.min(255, (c & 255) * f)];
}

export class GlobeView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.sim = null;
    this.built = false;
    this.missileMeshes = [];
    this.teleMeshes = [];
    this.repaintT = 0;
  }

  // The map, the sphere, the air and the clouds: built the first time the kaiju reaches the globe.
  build() {
    this.built = true;
    const M = worldMap();
    const { W, H } = M;
    const R = EARTH.globeR;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(W, H);
    // How far each sea cell is from the shore (for shallows), up to SEA_COLS.length - 1 cells.
    this.seaDepth = new Uint8Array(W * H).fill(SEA_COLS.length - 1);
    let front = [];
    for (let i = 0; i < W * H; i++) if (M.ids[i]) front.push(i);
    for (let d = 0; d < SEA_COLS.length - 1 && front.length; d++) {
      const next = [];
      for (const i of front) {
        const r = Math.floor(i / W);
        const c = i % W;
        for (const j of [r * W + ((c + 1) % W), r * W + ((c + W - 1) % W), r > 0 ? i - W : -1, r < H - 1 ? i + W : -1]) {
          if (j < 0 || M.ids[j] || this.seaDepth[j] <= d) continue;
          this.seaDepth[j] = d;
          next.push(j);
        }
      }
      front = next;
    }
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.anisotropy = 4;
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 80), new THREE.MeshLambertMaterial({ map: this.tex }));
    this.group.add(this.sphere);
    // A soft blue halo round the edge of the planet.
    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.08, 64, 40),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VS, fragmentShader: ATMO_FS, uniforms: { uColor: { value: new THREE.Color(0x6fb4ff) } },
        side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.atmo);
    // Pixel clouds drifting a little above the ground (thin enough to read the map through).
    const cc = document.createElement('canvas');
    cc.width = 1024;
    cc.height = 512;
    const cx = cc.getContext('2d');
    let seed = 777;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 110; i++) {
      const x0 = rnd() * 1024;
      const y0 = 60 + rnd() * 392;
      const n = 4 + Math.floor(rnd() * 9);
      cx.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.3})`;
      for (let j = 0; j < n; j++) {
        const w = 2 + Math.floor(rnd() * 7);
        cx.fillRect(Math.floor(x0 + rnd() * 16 - 8) % 1024, Math.floor(y0 + rnd() * 5 - 2), w, 1 + Math.floor(rnd() * 2));
      }
    }
    const ct = new THREE.CanvasTexture(cc);
    ct.magFilter = THREE.NearestFilter;
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.018, 64, 40), new THREE.MeshLambertMaterial({ map: ct, transparent: true, depthWrite: false, opacity: 0.45 }));
    this.group.add(this.clouds);
    // Missiles and the red circles where they will land.
    this.missileGeo = new THREE.BoxGeometry(0.5, 0.5, 2.2);
    this.teleGeo = new THREE.CircleGeometry(1, 40);
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 48);
  }

  // Follow a new globe (null: the kaiju isn't on one).
  attach(sim) {
    this.sim = sim;
    this.group.visible = Boolean(sim);
    if (!sim) {
      for (const m of this.missileMeshes) m.visible = false;
      for (const t of this.teleMeshes) t.disc.visible = t.ring.visible = false;
      return;
    }
    if (!this.built) this.build();
    this.paint(0, 0, worldMap().W - 1, worldMap().H - 1);
    sim.dirty = [];
    this.tex.needsUpdate = true;
  }

  // Repaint grid cells c0..c1 x r0..r1 from the map and what has been eaten.
  paint(c0, r0, c1, r1) {
    const M = worldMap();
    const { W, H, ids, countries } = M;
    const eaten = this.sim.eaten;
    const d = this.img.data;
    c0 = Math.max(0, c0);
    r0 = Math.max(0, r0);
    c1 = Math.min(W - 1, c1);
    r1 = Math.min(H - 1, r1);
    for (let r = r0; r <= r1; r++) {
      const lat = 90 - ((r + 0.5) * 180) / H;
      for (let c = c0; c <= c1; c++) {
        const i = r * W + c;
        const id = ids[i];
        const n = cellHash(i);
        let rgb;
        if (!id) {
          const depth = this.seaDepth[i];
          rgb = tint(SEA_COLS[depth], n < 0.025 && depth > 0 ? 1.25 : 0.97 + n * 0.06);
        } else if (eaten[i]) {
          // Scorched crust; a hot rim where it meets land still standing; the odd ember.
          const nb = [r * W + ((c + 1) % W), r * W + ((c + W - 1) % W), r > 0 ? i - W : i, r < H - 1 ? i + W : i];
          const rim = nb.some((j) => ids[j] && !eaten[j]);
          rgb = rim ? tint(RIM_COL, 0.9 + n * 0.2) : n < 0.05 ? tint(0xe8562a, 0.9) : tint(CRUST_COL, 0.85 + n * 0.3);
        } else {
          const k = countries[id];
          const icy = k.color === 0 || k.name === 'Greenland' || Math.abs(lat) > 78;
          const base = icy ? ICE_COL : GLOBE_LAND[1 + ((k.color - 1) % (GLOBE_LAND.length - 1))];
          let f = 0.94 + n * 0.1;
          // Borders: a dark line where the next cell over is another country; coasts a touch darker.
          const right = ids[r * W + ((c + 1) % W)];
          const below = r < H - 1 ? ids[i + W] : id;
          if ((right && right !== id) || (below && below !== id)) f *= 0.62;
          else if (!right || !below || !ids[r * W + ((c + W - 1) % W)] || (r > 0 && !ids[i - W])) f *= 0.82;
          rgb = tint(base, f);
        }
        const o = i * 4;
        d[o] = rgb[0];
        d[o + 1] = rgb[1];
        d[o + 2] = rgb[2];
        d[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, c0, r0, c1 - c0 + 1, r1 - r0 + 1);
  }

  update(game, dt, t) {
    const sim = this.sim;
    if (!sim) return;
    const R = EARTH.globeR;
    const k = game.kaiju;
    this.group.position.set(k.x, -R, k.y);
    this.group.quaternion.set(sim.q[0], sim.q[1], sim.q[2], sim.q[3]);
    this.clouds.rotation.y += dt * 0.012;
    // New craters: repaint their cells (and a cell round them, for the rims), a few times a second.
    this.repaintT -= dt;
    if (sim.dirty.length && this.repaintT <= 0) {
      this.repaintT = 0.08;
      for (const [c0, r0, c1, r1] of sim.dirty) this.paint(c0 - 1, r0 - 1, c1 + 1, r1 + 1);
      sim.dirty = [];
      this.tex.needsUpdate = true;
    }
    // Missiles in flight, and their telegraphs.
    const ms = sim.missiles;
    while (this.missileMeshes.length < ms.length) {
      const m = new THREE.Mesh(this.missileGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
      this.group.add(m);
      this.missileMeshes.push(m);
    }
    while (this.teleMeshes.length < ms.length) {
      const disc = new THREE.Mesh(this.teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.32, depthWrite: false }));
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.9, depthWrite: false }));
      disc.renderOrder = ring.renderOrder = 6;
      this.group.add(disc, ring);
      this.teleMeshes.push({ disc, ring });
    }
    const z = new THREE.Vector3(0, 0, 1);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < this.missileMeshes.length; i++) {
      const mesh = this.missileMeshes[i];
      const tele = this.teleMeshes[i];
      const m = ms[i];
      mesh.visible = tele.disc.visible = tele.ring.visible = Boolean(m);
      if (!m) continue;
      // The red circle: an outline at full size and a fill that grows as the missile closes in.
      const to = a.set(m.to[0], m.to[1], m.to[2]);
      const size = m.r * R;
      const f = Math.min(1, m.t / m.dur);
      for (const [obj, s] of [[tele.ring, size], [tele.disc, size * Math.max(0.05, f)]]) {
        obj.position.copy(to).multiplyScalar(R + 0.8);
        obj.quaternion.setFromUnitVectors(z, to);
        obj.scale.setScalar(s);
      }
      tele.ring.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(t * (6 + f * 10)));
      tele.ring.material.color.setHex(m.nuke ? 0xffd23f : 0xff4a4a);
      // The missile, nose first along its arc.
      const p = sim.missileAt(m);
      const q = sim.missileAt({ ...m, t: m.t + 0.02 });
      a.set(p.v[0], p.v[1], p.v[2]).multiplyScalar(R + p.h);
      b.set(q.v[0], q.v[1], q.v[2]).multiplyScalar(R + q.h).sub(a);
      mesh.position.copy(a);
      if (b.lengthSq() > 1e-9) mesh.quaternion.setFromUnitVectors(z, b.normalize());
      mesh.scale.setScalar(k.r * (m.nuke ? 0.5 : 0.3));
      mesh.material.color.setHex(m.nuke ? 0xffd23f : (t * 12) % 2 < 1 ? 0xfff2c8 : 0xff8a3a);
    }
  }
}
