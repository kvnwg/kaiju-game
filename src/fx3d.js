/* global THREE */
// Visual effects for the voxel renderer: physics debris (voxels and pre-fractured chunks),
// dust and glow particles, shockwave rings, beams, lightning, attack telegraphs,
// projectiles and loot orbs. Purely visual; the game simulation never reads this.

const DEBRIS_CAP = 4000;
const PARTICLE_CAP = 2500;

const PARTICLE_VS = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vA;
varying vec3 vC;
uniform float uScale;
void main() {
  vA = alpha;
  vC = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
varying float vA;
varying vec3 vC;
uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = max(abs(c.x), abs(c.y));
  float r = length(c);
  float m = mix(step(d, 0.5), smoothstep(0.5, 0.1, r), uSoft);
  if (m < 0.01) discard;
  gl_FragColor = vec4(vC, vA * m);
}`;

class Particles {
  constructor(scene, { additive = false, soft = 1 } = {}) {
    this.n = 0;
    this.pos = new Float32Array(PARTICLE_CAP * 3);
    this.size = new Float32Array(PARTICLE_CAP);
    this.alpha = new Float32Array(PARTICLE_CAP);
    this.tint = new Float32Array(PARTICLE_CAP * 3);
    this.items = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 }, uSoft: { value: soft } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    this.geo = g;
    scene.add(this.points);
  }

  add(p) {
    if (this.items.length >= PARTICLE_CAP) this.items.shift();
    this.items.push(p);
  }

  update(dt) {
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * (p.drag ?? 1.5);
      p.vz *= 1 - dt * (p.drag ?? 1.5);
      p.vy = p.vy * (1 - dt * (p.drag ?? 1.5)) + (p.lift ?? 0) * dt;
      items[w++] = p;
    }
    items.length = w;
    for (let i = 0; i < w; i++) {
      const p = items[i];
      const t = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size * (p.grow ? 1 + (1 - t) * p.grow : t);
      this.alpha[i] = (p.a ?? 1) * Math.min(1, t * 2.5);
      this.tint[i * 3] = p.r;
      this.tint[i * 3 + 1] = p.g;
      this.tint[i * 3 + 2] = p.b;
    }
    this.geo.setDrawRange(0, w);
    for (const k of ['position', 'size', 'alpha', 'tint']) this.geo.attributes[k].needsUpdate = true;
  }
}

const AIM_LINES = 48;

function norm2(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function rgb(c) {
  return { r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 };
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    // Debris: one instanced box per voxel or per pre-fractured chunk.
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.debrisMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.debrisMesh = new THREE.InstancedMesh(box, this.debrisMat, DEBRIS_CAP);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = true;
    this.debrisMesh.receiveShadow = true;
    scene.add(this.debrisMesh);
    this.debris = [];
    this.dust = new Particles(scene, { soft: 1 });
    this.glow = new Particles(scene, { additive: true, soft: 0.6 });
    this.bits = new Particles(scene, { additive: true, soft: 0 });

    // Glowing small things: projectiles, orbs.
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.glowMesh = new THREE.InstancedMesh(box, this.glowMat, 600);
    this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glowMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.glowMesh.frustumCulled = false;
    this.glowMesh.count = 0;
    scene.add(this.glowMesh);

    // Sight lines for shooters winding up a shot.
    this.aimGeo = new THREE.BufferGeometry();
    this.aimPos = new Float32Array(AIM_LINES * 6);
    this.aimCol = new Float32Array(AIM_LINES * 6);
    this.aimGeo.setAttribute('position', new THREE.BufferAttribute(this.aimPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.aimGeo.setAttribute('color', new THREE.BufferAttribute(this.aimCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.aimLines = new THREE.LineSegments(this.aimGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aimLines.frustumCulled = false;
    scene.add(this.aimLines);

    this.ringPool = [];
    this.beamPool = [];
    this.hazardMeshes = new Map();
    this.boltLines = [];
    this.lights = []; // short-lived light flashes {x,y,z,color,intensity,radius,life,max}
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.circleGeo = new THREE.CircleGeometry(1, 40);
    this.circleGeo.rotateX(-Math.PI / 2);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.planeGeo.rotateX(-Math.PI / 2);
    this.planeGeo.translate(0.5, 0, 0);
  }

  setScale(px) {
    this.dust.uniforms.uScale.value = px;
    this.glow.uniforms.uScale.value = px;
    this.bits.uniforms.uScale.value = px;
  }

  // ---------------------------------------------------------------- spawners
  addDebris(d) {
    if (this.debris.length >= DEBRIS_CAP) {
      // Recycle the oldest settled piece first.
      let idx = this.debris.findIndex((p) => p.settled);
      if (idx < 0) idx = 0;
      this.debris.splice(idx, 1);
    }
    d.q = d.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    d.w = d.w || { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
    d.life = d.life ?? 14 + Math.random() * 8;
    d.max = d.life;
    d.settled = false;
    this.debris.push(d);
  }

  dustCloud(x, y, z, r, n = 8, color = 0xcbbfa8) {
    const c = rgb(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = r * (0.4 + Math.random() * 0.9);
      const l = 1.2 + Math.random() * 1.6;
      this.dust.add({
        x: x + Math.cos(a) * r * 0.3, y: y + Math.random() * r * 0.4, z: z + Math.sin(a) * r * 0.3,
        vx: Math.cos(a) * sp, vy: r * (0.2 + Math.random() * 0.5), vz: Math.sin(a) * sp, drag: 1.8, lift: 0,
        size: r * (0.5 + Math.random() * 0.5), grow: 1.6, life: l, max: l, a: 0.55, ...c,
      });
    }
  }

  fireBurst(x, y, z, r, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = r * (1 + Math.random() * 1.5);
      const l = 0.35 + Math.random() * 0.4;
      const c = rgb([0xffd166, 0xff7a1a, 0xff4a1a, 0xfff2b0][i % 4]);
      this.glow.add({ x, y: y + r * 0.2, z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, drag: 3, size: r * (0.6 + Math.random() * 0.6), grow: 0.5, life: l, max: l, a: 0.9, ...c });
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = r * (2 + Math.random() * 3);
      const l = 0.4 + Math.random() * 0.5;
      this.bits.add({ x, y: y + r * 0.3, z, vx: Math.cos(a) * sp, vy: r * (1 + Math.random() * 3), vz: Math.sin(a) * sp, drag: 1, lift: -r * 8, size: Math.max(0.3, r * 0.12), life: l, max: l, a: 1, ...rgb(0xffc04a) });
    }
    this.dustCloud(x, y, z, r * 0.9, 5, 0x5a5552);
    this.flash(x, y + r * 0.5, z, 0xff9a3c, 1.1, Math.min(r * 3, 400), 0.35);
  }

  sparks(x, y, z, color, size, n = 5) {
    const c = rgb(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = size * (6 + Math.random() * 10);
      const l = 0.2 + Math.random() * 0.2;
      this.bits.add({ x, y, z, vx: Math.cos(a) * sp, vy: sp * Math.random(), vz: Math.sin(a) * sp, drag: 2, size: size * 0.3, life: l, max: l, ...c });
    }
  }

  flash(x, y, z, color, intensity, radius, life) {
    this.lights.push({ x, y, z, color, intensity, radius, life, max: life });
  }

  ring(x, z, r0, r1, color, life, width = 0.15) {
    let m = this.ringPool.find((p) => !p.visible);
    if (!m) {
      m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = 7;
      this.scene.add(m);
      this.ringPool.push(m);
    }
    m.visible = true;
    m.material.color.setHex(color);
    m.userData = { x, z, r0, r1, life, max: life, width };
    m.position.set(x, 0.6, z);
    return m;
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, game) {
    this.t = (this.t || 0) + dt;
    this.updateDebris(dt);
    this.dust.update(dt);
    this.glow.update(dt);
    this.bits.update(dt);
    for (const m of this.ringPool) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) {
        m.visible = false;
        continue;
      }
      const p = 1 - u.life / u.max;
      const r = u.r0 + (u.r1 - u.r0) * (1 - (1 - p) * (1 - p));
      m.scale.set(r, 1, r);
      m.material.opacity = (1 - p) * 0.9;
    }
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    if (game) {
      this.syncRings(game);
      this.syncHazards(game);
      this.syncBeams(game);
      this.syncBolts(game);
      this.syncGlowThings(game, dt);
    }
  }

  updateDebris(dt) {
    const m = this._m;
    const q = this._q;
    const v = this._v;
    const s = this._s;
    const list = this.debris;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      d.life -= dt;
      if (d.life <= 0) continue;
      if (!d.settled) {
        const g = 40 + d.size * 18;
        d.vy -= g * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        const ang = Math.hypot(d.w.x, d.w.y, d.w.z);
        if (ang > 0.01) {
          this._e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt);
          q.setFromEuler(this._e);
          d.q.multiply(q);
        }
        const floor = d.floor ?? 0;
        if (d.y - d.sy * 0.4 < floor) {
          if (d.water) {
            d.life = Math.min(d.life, 0.6);
            d.vy *= 0.2;
            d.vx *= 0.5;
            d.vz *= 0.5;
          } else {
            d.y = floor + d.sy * 0.4;
            d.vy *= -0.25;
            d.vx *= 0.55;
            d.vz *= 0.55;
            d.w.x *= 0.5;
            d.w.y *= 0.5;
            d.w.z *= 0.5;
            if (Math.abs(d.vy) < d.size * 1.5 && Math.hypot(d.vx, d.vz) < d.size * 1.5) d.settled = true;
          }
        }
      }
      list[w++] = d;
    }
    list.length = w;
    const mesh = this.debrisMesh;
    for (let i = 0; i < w; i++) {
      const d = list[i];
      const fade = d.life < 1.2 ? d.life / 1.2 : 1;
      v.set(d.x, d.y, d.z);
      s.set(d.sx * fade, d.sy * fade, d.sz * fade);
      m.compose(v, d.q, s);
      mesh.setMatrixAt(i, m);
      this._c.setHex(d.color);
      mesh.setColorAt(i, this._c);
    }
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  syncRings(game) {
    // Game-side rings (shockwaves, explosions) are created once.
    for (const r of game.fx.rings) {
      if (r._shown) continue;
      r._shown = true;
      this.ring(r.x, r.y, r.r0, r.r1, r.color, r.max, r.width);
    }
  }

  syncHazards(game) {
    const live = new Set();
    for (const h of game.hazards) {
      live.add(h);
      let entry = this.hazardMeshes.get(h);
      const friendly = h.friendly;
      const color = friendly ? 0xffa628 : h.jet ? 0xffc828 : 0xff3030;
      if (!entry) {
        const mk = (op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false });
        if (h.kind === 'circle') {
          const outer = new THREE.Mesh(this.circleGeo, mk(0.16));
          const inner = new THREE.Mesh(this.circleGeo, mk(0.32));
          const edge = new THREE.Mesh(this.ringGeo, mk(0.85));
          for (const o of [outer, inner, edge]) {
            o.renderOrder = 20;
            o.position.set(h.x, 0.8, h.y);
            this.scene.add(o);
          }
          outer.scale.set(h.r, 1, h.r);
          edge.scale.set(h.r, 1, h.r);
          entry = { parts: [outer, inner, edge], inner };
          if (h.meteor) {
            const rock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
            this.scene.add(rock);
            entry.parts.push(rock);
            entry.rock = rock;
          }
        } else {
          const len = Math.hypot(h.x2 - h.x1, h.y2 - h.y1);
          const ang = Math.atan2(h.y2 - h.y1, h.x2 - h.x1);
          const outer = new THREE.Mesh(this.planeGeo, mk(0.16));
          const inner = new THREE.Mesh(this.planeGeo, mk(0.34));
          for (const o of [outer, inner]) {
            o.renderOrder = 20;
            o.position.set(h.x1, 0.8, h.y1);
            o.rotation.y = -ang;
            this.scene.add(o);
          }
          outer.scale.set(len, 1, h.w);
          entry = { parts: [outer, inner], inner, len, w: h.w };
        }
        this.hazardMeshes.set(h, entry);
      }
      const p = Math.min(1, h.t / h.delay);
      if (h.kind === 'circle') {
        const r = Math.max(0.01, h.r * p);
        entry.inner.scale.set(r, 1, r);
        if (entry.rock) {
          const fall = 1 - p;
          const s = h.r * 0.35;
          entry.rock.scale.set(s, s, s);
          entry.rock.position.set(h.x - fall * h.r * 2, fall * h.r * 8 + s, h.y - fall * h.r);
          entry.rock.rotation.x += 0.1;
          if (Math.random() < 0.8) this.glow.add({ x: entry.rock.position.x, y: entry.rock.position.y, z: entry.rock.position.z, vx: 0, vy: 0, vz: 0, size: s * 1.4, grow: 0.5, life: 0.4, max: 0.4, a: 0.8, ...rgb(0xff8a2a) });
        }
      } else {
        entry.inner.scale.set(Math.max(0.01, entry.len * p), 1, entry.w);
      }
      const pulse = 0.7 + 0.3 * Math.sin(h.t * 18);
      entry.parts[entry.parts.length - 1].material.opacity = entry.rock ? 1 : 0.6 * pulse + 0.25;
    }
    for (const [h, entry] of this.hazardMeshes) {
      if (live.has(h)) continue;
      for (const o of entry.parts) {
        this.scene.remove(o);
        o.material.dispose();
        if (o === entry.rock) o.geometry.dispose();
      }
      this.hazardMeshes.delete(h);
    }
  }

  syncBeams(game) {
    for (const m of this.beamPool) m.visible = false;
    let i = 0;
    for (const b of game.fx.beams) {
      let m = this.beamPool[i];
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.renderOrder = 8;
        this.scene.add(m);
        this.beamPool.push(m);
      }
      i++;
      const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
      const a = b.life / b.max;
      m.visible = true;
      m.material.color.setHex(b.color);
      m.material.opacity = a;
      const h = b.h ?? b.width * 0.5;
      m.position.set((b.x1 + b.x2) / 2, h, (b.y1 + b.y2) / 2);
      m.rotation.set(0, -Math.atan2(b.y2 - b.y1, b.x2 - b.x1), 0);
      m.scale.set(len, b.width * 0.35 * (0.6 + a * 0.4), b.width * 0.35 * (0.6 + a * 0.4));
      if (!b._lit) {
        b._lit = true;
        this.flash((b.x1 + b.x2) / 2, h, (b.y1 + b.y2) / 2, b.color, 1.4, Math.min(len * 0.5, 600), b.max);
      }
    }
  }

  syncBolts(game) {
    for (const l of this.boltLines) {
      this.scene.remove(l);
      l.geometry.dispose();
    }
    this.boltLines = [];
    for (const b of game.fx.bolts) {
      const pts = [];
      for (let i = 0; i < b.points.length - 1; i++) {
        const p0 = b.points[i];
        const p1 = b.points[i + 1];
        const h = game.kaiju.r * 0.8;
        for (let s = 0; s <= 5; s++) {
          const t = s / 5;
          const j = s === 0 || s === 5 ? 0 : (Math.random() - 0.5) * Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.3;
          pts.push(new THREE.Vector3(p0.x + (p1.x - p0.x) * t + j, h * (1 - t * 0.5) + Math.abs(j), p0.y + (p1.y - p0.y) * t - j));
        }
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: b.life / b.max }));
      line.renderOrder = 9;
      this.scene.add(line);
      this.boltLines.push(line);
      if (!b._lit) {
        b._lit = true;
        const last = b.points[b.points.length - 1];
        this.flash(last.x, game.kaiju.r, last.y, 0x8fd8ff, 1.2, game.kaiju.r * 5, 0.2);
      }
    }
  }

  syncGlowThings(game) {
    const mesh = this.glowMesh;
    const m = this._m;
    let n = 0;
    const put = (x, y, z, s, color, rotY = 0, len = 1, tall = 1) => {
      if (n >= 600) return;
      this._e.set(0, rotY, 0);
      this._q.setFromEuler(this._e);
      this._v.set(x, y, z);
      this._s.set(s * len, s * tall, s);
      m.compose(this._v, this._q, this._s);
      mesh.setMatrixAt(n, m);
      this._c.setHex(color);
      mesh.setColorAt(n, this._c);
      n++;
    };
    const k0 = game.kaiju;
    for (const p of game.projectiles) {
      const rot = -Math.atan2(p.vy, p.vx);
      if (p.kind === 'bullet') {
        // Hot tracer: a bright core, a long orange streak and a fading glow trail.
        const sz = p.size || Math.max(0.3, p.r);
        put(p.x, p.h ?? 1, p.y, sz, 0xfff6c0, rot, 2.2);
        const sp = Math.hypot(p.vx, p.vy) || 1;
        put(p.x - (p.vx / sp) * sz * 2.4, p.h ?? 1, p.y - (p.vy / sp) * sz * 2.4, sz * 0.7, 0xff8a2a, rot, 5);
        if (Math.random() < 0.5) this.glow.add({ x: p.x, y: p.h ?? 1, z: p.y, vx: 0, vy: 0, vz: 0, size: sz * 3.2, grow: -0.5, life: 0.18, max: 0.18, a: 0.75, ...rgb(0xffb347) });
      }
      else if (p.kind === 'rock') put(p.x, game.kaiju.r, p.y, p.r * 1.5, 0x8a7a66, rot, 1);
      else {
        put(p.x, p.h ?? 2, p.y, p.size || Math.max(0.5, p.r * 1.5), 0xeeeeee, rot, 2.5);
        put(p.x, p.h ?? 2, p.y, (p.size || p.r) * 0.6, 0xff4a2a, rot + Math.PI / 2, 1);
        if (Math.random() < 0.6) this.dust.add({ x: p.x, y: p.h ?? 2, z: p.y, vx: 0, vy: 0.5, vz: 0, size: p.r * 4, grow: 2, life: 0.6, max: 0.6, a: 0.4, drag: 2, ...rgb(0xaaaaaa) });
        if (Math.random() < 0.6) this.glow.add({ x: p.x, y: p.h ?? 2, z: p.y, vx: 0, vy: 0, vz: 0, size: p.r * 3, grow: 0, life: 0.15, max: 0.15, a: 0.9, ...rgb(0xff9a3c) });
      }
    }
    // Shooters winding up: a blinking muzzle glint. Panicked cops: a shaking "!" and sweat.
    const span = game.viewSpan();
    let a = 0;
    for (const u of game.units) {
      if (u.dead) continue;
      const head = u.r * (u.def.vehicle ? 1.7 : 3.2);
      if (u.windup > 0 && u.windupMax > 0) {
        const f = 1 - u.windup / u.windupMax;
        const aim = norm2(k0.x - u.x, k0.y - u.y);
        const mx = u.x + aim.x * u.r * 1.2;
        const my = u.y + aim.y * u.r * 1.2;
        const blink = Math.sin(f * 40) > -0.2 ? 1 : 0.4;
        const dot = Math.max(0.35, span * 0.0045);
        put(mx, u.flying ? u.r * 3 : u.r * 0.8, my, dot * 1.6 * (0.6 + f) * blink, 0xff3b2f, 0, 1);
        // Dotted sight line that fills in from the shooter toward the kaiju as the shot charges.
        const tx = k0.x - aim.x * k0.r * 0.8;
        const ty = k0.y - aim.y * k0.r * 0.8;
        const len = Math.hypot(tx - mx, ty - my);
        const dots = Math.max(3, Math.min(14, Math.round(len / (dot * 5))));
        const yy = u.flying ? u.r * 3 : u.r * 0.6;
        for (let d = 1; d <= dots; d++) {
          const q = d / dots;
          if (q > f + 0.15) break;
          put(mx + (tx - mx) * q, yy + (Math.min(k0.r * 0.8, 6 + k0.r * 0.4) - yy) * q, my + (ty - my) * q, dot * (0.7 + 0.5 * f), f > 0.7 ? 0xff3b2f : 0xff9a3c, 0, 1);
        }
        if (a < AIM_LINES) {
          const y = u.flying ? u.r * 3 : u.r * 0.6;
          const ky = Math.min(k0.r * 0.8, 6 + k0.r * 0.4);
          const i = a * 6;
          this.aimPos.set([mx, y, my, k0.x, ky, k0.y], i);
          const c = 0.25 + 0.75 * f;
          this.aimCol.set([c, c * 0.25, c * 0.15, c * 0.6, c * 0.1, c * 0.05], i);
          a++;
        }
      }
      if (u.stress > 0.2) {
        const s = Math.max(u.r * 0.5, span * 0.013);
        const shake = Math.sin(this.t * 55 + u.id * 100) * s * 0.25 * u.stress;
        const color = u.stress > 0.6 ? 0xff3b2f : 0xffd23f;
        const y = head + s * 1.6;
        put(u.x + shake, y + s * 1.1, u.y, s * 0.55, color, 0, 1, 2.6);
        put(u.x + shake, y - s * 0.6, u.y, s * 0.55, color, 0, 1, 1);
        if (Math.random() < u.stress * 0.25) {
          this.bits.add({ x: u.x, y: head, z: u.y, vx: (Math.random() - 0.5) * s * 6, vy: s * 5, vz: (Math.random() - 0.5) * s * 6, lift: -s * 18, drag: 0.5, size: s * 0.45, grow: 0, life: 0.45, max: 0.45, a: 0.9, ...rgb(0x9fdcff) });
        }
      }
    }
    this.aimPos.fill(0, a * 6);
    this.aimGeo.attributes.position.needsUpdate = true;
    this.aimGeo.attributes.color.needsUpdate = true;
    this.aimGeo.setDrawRange(0, a * 2);
    const k = game.kaiju;
    for (const o of game.fx.orbs) put(o.x, k.r * 0.8 + Math.sin(o.t * 10) * k.r * 0.2, o.y, Math.max(0.35, k.r * 0.12), o.color, o.t * 5, 1);
    for (const f of game.fires) {
      if (Math.random() < 0.5) {
        const c = rgb(Math.random() < 0.5 ? 0xff7a1a : 0xffc04a);
        this.glow.add({ x: f.x + (Math.random() - 0.5) * f.r, y: 0.5, z: f.y + (Math.random() - 0.5) * f.r, vx: 0, vy: f.r * 1.5, vz: 0, drag: 1, size: f.r * 0.6, grow: -0.3, life: 0.5, max: 0.5, a: 0.8 * Math.min(1, f.t), ...c });
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.debris = [];
    this.dust.items = [];
    this.glow.items = [];
    this.bits.items = [];
    for (const m of this.ringPool) m.visible = false;
    for (const [, entry] of this.hazardMeshes) for (const o of entry.parts) this.scene.remove(o);
    this.hazardMeshes.clear();
    this.lights = [];
  }
}
