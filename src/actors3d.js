/* global THREE */
// Animated voxel characters: the player's kaiju, the boss, military units, crowds and traffic.
import { meshGrid } from './mesher.js';
import { KAIJU_MODELS, UNIT_MODELS, bossModel, personModel, PERSON_VARIANTS } from './models.js';
import { buildProp } from './props.js';
import { arcHeight } from './fx3d.js';

export function toGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3, true));
  g.setAttribute('aFlags', new THREE.BufferAttribute(m.flags, 1));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function partsGroup(model, mat) {
  const nodes = {};
  const root = new THREE.Group();
  for (const p of model.parts) {
    const geo = toGeometry(meshGrid(p.grid, { v: 1, ox: p.pivot.x, oy: p.pivot.y, oz: p.pivot.z, jitter: 0.08 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(p.pos.x, p.pos.y, p.pos.z);
    g.userData.part = p;
    g.userData.base = g.position.clone();
    nodes[p.name] = g;
    (p.parent ? nodes[p.parent] : root).add(g);
  }
  return { root, nodes, model };
}

// Walk cycle, tail sway, bite and punch poses for a parts rig.
function animateRig(rig, phase, moving, t, attack, extra = {}) {
  const swingAmt = moving ? 0.7 : 0.05;
  for (const g of Object.values(rig.nodes)) {
    const p = g.userData.part;
    if (p.swing) g.rotation.z = Math.sin(phase) * swingAmt * p.swing;
    if (p.arm) g.rotation.z = Math.sin(phase + Math.PI) * swingAmt * 0.6 * p.arm - (attack ? 0.9 : 0);
    if (p.punch && attack) g.rotation.z = -1.4;
    if (p.tail !== undefined) g.rotation.y = Math.sin(t * 3 + p.tail * 0.9) * (0.18 + p.tail * 0.08);
    if (p.name === 'jaw') g.rotation.z = attack ? -0.6 : -0.05 - Math.max(0, Math.sin(t * 1.3)) * 0.08;
    if (p.name === 'head') g.rotation.z = Math.sin(phase * 2) * 0.04 + (attack ? -0.15 : 0);
    if (p.name === 'body') {
      g.position.y = g.userData.base.y + Math.abs(Math.sin(phase)) * (moving ? 0.6 : 0.1);
      g.rotation.z = -(p.lean || 0) + (extra.recoil || 0);
    }
  }
}

export class Actors {
  constructor(scene, makeMat) {
    this.scene = scene;
    this.makeMat = makeMat;
    this.mat = makeMat();
    this.kaiju = null;
    this.boss = null;
    this.unitGeo = {};
    this.unitMeshes = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();

    // Crowd: one instanced mesh per person look.
    this.peopleMeshes = [];
    for (let i = 0; i < PERSON_VARIANTS; i++) {
      const pm = personModel(i);
      const geo = toGeometry(meshGrid(pm.grid, { v: pm.v, ox: pm.origin.x, oz: pm.origin.z, jitter: 0.03 }));
      const im = new THREE.InstancedMesh(geo, this.mat, 160);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = true;
      im.count = 0;
      scene.add(im);
      this.peopleMeshes.push(im);
    }
    this.trafficMeshes = new Map();
  }

  setKaiju(id) {
    if (this.kaiju) this.scene.remove(this.kaiju.root);
    const kmat = this.makeMat(0.3);
    const rig = partsGroup(KAIJU_MODELS[id](), kmat);
    rig.mat = kmat;
    rig.yaw = null;
    this.kaiju = rig;
    this.scene.add(rig.root);
  }

  clear() {
    if (this.boss) {
      this.scene.remove(this.boss.root);
      this.boss = null;
    }
    for (const [, m] of this.unitMeshes) this.scene.remove(m);
    this.unitMeshes.clear();
  }

  update(game, dt, t, elev) {
    this.updateKaiju(game, t, elev);
    this.updateBoss(game, t);
    this.updateUnits(game, t);
    this.updatePeople(game, t);
    this.updateTraffic(game);
  }

  updateKaiju(game, t, elev) {
    const k = game.kaiju;
    const rig = this.kaiju;
    const s = k.r / rig.model.radius;
    rig.root.scale.setScalar(s);
    rig.root.position.set(k.x, (k.inWater ? -k.r * 0.35 : elev) + (k.z || 0), k.y);
    // Mid-hop: tuck forward on the way up, level out for the landing.
    const hop = k.hopT > 0 ? Math.sin((1 - k.hopT / k.hopMax) * Math.PI * 2) * 0.35 : 0;
    rig.root.rotation.order = 'YZX';
    rig.root.rotation.z = -hop;
    const target = -Math.atan2(k.facing.y, k.facing.x);
    rig.yaw = rig.yaw ?? target;
    let d = target - rig.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    rig.yaw += d * (k.anim && k.anim.kind === 'laser' ? 0.6 : 0.25);
    rig.root.rotation.y = rig.yaw;
    animateRig(rig, k.walkPhase, k.moving, t, Boolean(k.lastAttack));
    const glow = this.movePose(rig, k, t);
    const fl = k.hitFlash > 0 ? 0.6 : k.invuln > 0 && Math.floor(t * 12) % 2 ? 0.35 : 0;
    rig.mat.emissive.setRGB(fl + glow[0], fl * 0.3 + glow[1], fl * 0.3 + glow[2]);
    if (k.shield > 0) rig.mat.emissive.setRGB(fl + 0.05 + glow[0], fl + 0.05 + glow[1], fl + 0.08 + glow[2]);
  }

  // Poses for augment moves layered over the walk cycle. Returns an emissive glow (rgb).
  movePose(rig, k, t) {
    const a = k.anim;
    if (!a) return [0, 0, 0];
    const f = 1 - a.t / a.max; // 0 -> 1 through the move
    const n = rig.nodes;
    const each = (fn) => {
      for (const g of Object.values(n)) fn(g, g.userData.part);
    };
    switch (a.kind) {
      case 'claw': {
        // Wind up, then rake: the striking arm sweeps through, the body twists into it.
        const swing = Math.sin(f * Math.PI);
        each((g, p) => {
          if (p.arm && Math.sign(p.arm) === (a.side || 1)) g.rotation.z = -2.2 * swing;
          else if (p.arm) g.rotation.z = 0.5 * swing;
          if (p.name === 'jaw') g.rotation.z = -0.5 * swing;
        });
        rig.root.rotation.y += (a.side || 1) * 0.6 * (f < 0.4 ? -f : f - 0.8);
        return [0.25 * swing, 0.2 * swing, 0.1 * swing];
      }
      case 'spin': {
        // Whole body whirls; the tail streams out.
        const turns = a.turns || 1;
        const ease = f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
        rig.root.rotation.y += ease * turns * Math.PI * 2;
        each((g, p) => {
          if (p.tail !== undefined) g.rotation.y = -0.3;
          if (p.arm) g.rotation.z = -0.8;
        });
        return [0, 0, 0];
      }
      case 'slam': {
        // Tuck on the way up, stamp down hard.
        each((g, p) => {
          if (p.swing) g.rotation.z = f < 0.6 ? -0.9 : 0.4;
          if (p.arm) g.rotation.z = f < 0.6 ? -2.4 : -0.4;
          if (p.name === 'jaw') g.rotation.z = -0.5;
        });
        rig.root.rotation.z = f < 0.6 ? -0.25 : 0.2;
        return [0.2, 0.12, 0];
      }
      case 'laser': {
        const pulse = 0.5 + 0.5 * Math.sin(t * 40);
        each((g, p) => {
          if (p.name === 'head') g.rotation.z = -0.2;
        });
        return [0.18 + 0.12 * pulse, 0, 0.06];
      }
      case 'breath': {
        const charging = a.max - a.t < a.charge;
        const c = charging ? (a.max - a.t) / a.charge : 1;
        each((g, p) => {
          if (p.name === 'head') g.rotation.z = charging ? 0.35 * c : -0.1;
          if (p.name === 'jaw') g.rotation.z = charging ? -0.15 : -0.9;
          if (p.name === 'body') g.rotation.z += charging ? -0.15 * c : 0.1;
        });
        const flick = 0.85 + 0.15 * Math.sin(t * 50);
        return [0.02 * c, 0.2 * c * flick, 0.26 * c * flick];
      }
      case 'roar': {
        const r = Math.sin(Math.min(1, f * 2.5) * Math.PI * 0.5);
        each((g, p) => {
          if (p.name === 'head') g.rotation.z = 0.45 * r;
          if (p.name === 'jaw') g.rotation.z = -1.0 * r;
          if (p.arm) g.rotation.z = 0.8 * r;
        });
        return [0.15 * r, 0.12 * r, 0];
      }
      case 'throw': {
        const s = Math.sin(f * Math.PI);
        each((g, p) => {
          if (p.arm) g.rotation.z = f < 0.35 ? 1.2 : -2.2 * s;
        });
        return [0, 0, 0];
      }
      case 'spines': {
        const s = Math.sin(f * Math.PI);
        each((g, p) => {
          if (p.name === 'body') g.rotation.z += 0.25 * s;
          if (p.name === 'head') g.rotation.z = -0.3 * s;
        });
        return [0.05 * s, 0.4 * s, 0.25 * s];
      }
      default:
        return [0, 0, 0];
    }
  }

  updateBoss(game, t) {
    const b = game.boss;
    if (!b) {
      if (this.boss) {
        this.scene.remove(this.boss.root);
        this.boss = null;
      }
      return;
    }
    if (!this.boss) {
      const bm = this.makeMat();
      this.boss = partsGroup(bossModel(), bm);
      this.boss.mat = bm;
      this.scene.add(this.boss.root);
    }
    const rig = this.boss;
    if (b.dead) {
      rig.root.position.y -= 0.6;
      rig.root.rotation.z += 0.004;
      if (rig.root.position.y < -b.r * 2) rig.root.visible = false;
      return;
    }
    rig.root.scale.setScalar(b.r / rig.model.radius);
    rig.root.position.set(b.x, 0, b.y);
    rig.root.rotation.y = -b.aim;
    animateRig(rig, b.walk * 4, b.state !== 'idle' || true, t, b.state === 'windup');
    const fl = b.flash > 0 ? 0.5 : b.state === 'windup' ? 0.25 + 0.25 * Math.sin(t * 30) : 0;
    rig.mat.emissive.setRGB(fl, fl * 0.4, fl * 0.2);
  }

  unitGeometry(type) {
    if (!this.unitGeo[type]) {
      const um = UNIT_MODELS[type]();
      this.unitGeo[type] = { geo: toGeometry(meshGrid(um.grid, { v: um.v, ox: um.origin.x, oz: um.origin.z })), siren: um.siren, height: um.grid.ny * um.v };
    }
    return this.unitGeo[type];
  }

  updateUnits(game, t) {
    const live = new Set();
    const k = game.kaiju;
    for (const u of game.units) {
      live.add(u);
      let m = this.unitMeshes.get(u);
      if (!m) {
        const ug = this.unitGeometry(u.type);
        m = new THREE.Mesh(ug.geo, this.mat);
        m.castShadow = true;
        m.userData.siren = ug.siren;
        this.unitMeshes.set(u, m);
        this.scene.add(m);
      }
      m.visible = !(u.type === 'jet' && u.warn > 0);
      let y = 0;
      if (u.type === 'heli') y = Math.max(20, k.r * 2.2) + Math.sin(t * 2 + u.age) * 2;
      else if (u.type === 'jet') y = Math.max(40, k.r * 3);
      else if (u.type === 'mech' || u.type === 'cop' || u.type === 'dog') y = Math.abs(Math.sin(u.age * 6)) * u.r * 0.15;
      // Panic: trembling, running hunched away instead of facing the kaiju, cars fishtailing.
      const st = u.stress || 0;
      const shake = st > 0.2 ? Math.sin(t * 60 + u.id * 50) * u.r * 0.12 * st : 0;
      m.position.set(u.x + shake, y, u.y - shake * 0.6);
      const faceAim = st < 0.12 && (u.type === 'heli' || u.type === 'tank' || u.type === 'artillery' || u.type === 'mech' || u.type === 'cop' || u.type === 'roadblock');
      m.rotation.y = -(faceAim ? u.aim : u.heading) + (u.type === 'police' ? Math.sin(t * 9 + u.age) * 0.18 * st : 0);
      m.rotation.order = 'YXZ';
      m.rotation.z = u.type === 'heli' ? Math.sin(t * 3 + u.age) * 0.08 : u.type === 'cop' ? -st * 0.35 : 0;
      const pulse = u.flash > 0 ? 1.25 : 1;
      m.scale.setScalar(pulse);
    }
    for (const [u, m] of this.unitMeshes) {
      if (live.has(u)) continue;
      this.scene.remove(m);
      this.unitMeshes.delete(u);
    }
  }

  updatePeople(game, t) {
    const counts = new Array(PERSON_VARIANTS).fill(0);
    const m = this._m;
    for (const p of game.people) {
      const im = this.peopleMeshes[p.variant];
      const i = counts[p.variant]++;
      if (i >= 160) continue;
      const bob = p.state === 'flung' ? 0 : Math.abs(Math.sin(p.phase)) * 0.35;
      this._v.set(p.x, p.z + bob, p.y);
      if (p.state === 'flung') this._e.set(p.spin, -p.heading, p.spin * 0.7);
      else this._e.set(0, -p.heading, p.state === 'flee' ? -0.25 : 0);
      this._q.setFromEuler(this._e);
      this._s.set(1, 1, 1);
      m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, m);
    }
    for (let v = 0; v < PERSON_VARIANTS; v++) {
      const im = this.peopleMeshes[v];
      im.count = Math.min(160, counts[v]);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  trafficMesh(model, variant) {
    const key = `${model}:${variant}`;
    let im = this.trafficMeshes.get(key);
    if (!im) {
      const p = buildProp(model, variant);
      const geo = toGeometry(meshGrid(p.grid, { v: p.v, ox: p.origin.x, oz: p.origin.z }));
      im = new THREE.InstancedMesh(geo, this.mat, 40);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = true;
      im.count = 0;
      this.scene.add(im);
      this.trafficMeshes.set(key, im);
    }
    return im;
  }

  updateTraffic(game) {
    const counts = new Map();
    for (const c of game.traffic) {
      const im = this.trafficMesh(c.model, c.variant);
      const i = counts.get(im) || 0;
      if (i >= 40) continue;
      counts.set(im, i + 1);
      this._v.set(c.x, 0, c.y);
      this._e.set(0, -c.heading, 0);
      this._q.setFromEuler(this._e);
      this._s.setScalar(c.flash > 0 ? 1.15 : 1);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
    }
    // Cars hurled by Car Toss: oversized and tumbling end over end.
    for (const p of game.projectiles) {
      if (p.kind !== 'car') continue;
      const im = this.trafficMesh(p.model, p.variant);
      const i = counts.get(im) || 0;
      if (i >= 40) continue;
      counts.set(im, i + 1);
      this._v.set(p.x, arcHeight(p), p.y);
      this._e.set(p.age * p.spin, -Math.atan2(p.vy, p.vx), p.age * p.spin * 0.6);
      this._q.setFromEuler(this._e);
      this._s.setScalar(p.scale);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
    }
    for (const [, im] of this.trafficMeshes) {
      im.count = counts.get(im) || 0;
      im.visible = im.count > 0;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // Light sources carried by actors (sirens, the boss cockpit, an ember kaiju).
  lightSources(game, t) {
    const out = [];
    for (const u of game.units) {
      const m = this.unitMeshes.get(u);
      if (!m || !m.userData.siren) continue;
      const red = Math.floor(t * 4 + u.age) % 2 === 0;
      out.push({ x: u.x, y: (m.position.y || 0) + u.r * 1.2, z: u.y, color: red ? 0xff2a2a : 0x2a5bff, intensity: 2.2, radius: u.r * 7, prio: 2 });
    }
    const b = game.boss;
    if (b && !b.dead) out.push({ x: b.x, y: b.r * 2, z: b.y, color: b.phase === 2 ? 0xff3b3b : 0x59c3ff, intensity: 3, radius: b.r * 4, prio: 3 });
    const k = game.kaiju;
    if (game.def.id === 'ember') out.push({ x: k.x, y: k.r * 1.2, z: k.y, color: 0xff8a2a, intensity: 1.6, radius: k.r * 6, prio: 2 });
    if (game.def.id === 'volt') out.push({ x: k.x, y: k.r * 1.2, z: k.y, color: 0x5ff0ff, intensity: 1.2, radius: k.r * 5, prio: 2 });
    return out;
  }
}
