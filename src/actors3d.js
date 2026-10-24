/* global THREE */
// Animated voxel characters: the player's kaiju, the boss, military units, crowds and traffic.
import { meshGrid } from './mesher.js';
import { VoxelGrid } from './voxel.js';
import { KAIJU_MODELS, UNIT_MODELS, bossModel, GATE_BOSS_MODELS, personModel, personLook, PERSON_LOOKS, DOCTOR } from './models.js';
import { buildProp } from './props.js';
import { arcHeight } from './fx3d.js';
import { EAT_TIME } from './config.js';

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
    this.flashMat = makeMat();
    this.flashMat.emissive.setRGB(1.25, 1.25, 1.22);
    this.carFlash = [];
    this.kaiju = null;
    this.boss = null;
    this.unitGeo = {};
    this.unitMeshes = new Map();
    this.allyMeshes = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();

    // Crowd: one instanced mesh per person look.
    this.peopleMeshes = [];
    const pm0 = personModel(0);
    this.personH = pm0.grid.ny * pm0.v;
    this._mouth = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._half = new THREE.Vector3();
    for (let i = 0; i < PERSON_LOOKS; i++) {
      const pm = personLook(i);
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
    // A floating green cross over each doctor, so the rare heal is easy to spot.
    const cross = new VoxelGrid(5, 5, 1);
    cross.box(2, 0, 0, 3, 5, 1, 0x4dff7a);
    cross.box(0, 2, 0, 5, 3, 1, 0x4dff7a);
    this.healMat = new THREE.MeshBasicMaterial({ color: 0x5dff88, toneMapped: false });
    this.crossGeo = toGeometry(meshGrid(cross, { v: 1, ox: 2.5, oz: 0.5 }));
    this.doctorMarks = [];
  }

  setKaiju(id) {
    if (this.kaiju) this.scene.remove(this.kaiju.root);
    const kmat = this.makeMat(0.3);
    const rig = partsGroup(KAIJU_MODELS[id](), kmat);
    rig.mat = kmat;
    rig.yaw = null;
    // Mouth: near the tip of the jaw, in the jaw part's own space.
    const jp = rig.model.parts.find((pp) => pp.name === 'jaw');
    rig.mouthLocal = jp ? new THREE.Vector3(jp.grid.nx * 0.65 - jp.pivot.x, jp.grid.ny - jp.pivot.y + 0.5, jp.grid.nz / 2 - jp.pivot.z) : new THREE.Vector3(6, 6, 0);
    // X-ray silhouette: drawn only where the kaiju is hidden behind buildings, so you never
    // lose sight of it under a roof.
    // It is drawn after the city but before the kaiju itself, so the kaiju's own body never
    // counts as cover (no ghost over its own tail or legs).
    const ghost = new THREE.MeshBasicMaterial({ color: 0x356f26, blending: THREE.AdditiveBlending, depthFunc: THREE.GreaterDepth, depthWrite: false });
    const meshes = [];
    rig.root.traverse((m) => m.isMesh && meshes.push(m));
    for (const m of meshes) {
      m.renderOrder = 10;
      const g = new THREE.Mesh(m.geometry, ghost);
      g.renderOrder = 5;
      g.castShadow = false;
      m.add(g);
    }
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
    for (const [, m] of this.allyMeshes) this.scene.remove(m);
    this.allyMeshes.clear();
  }

  // Brood Call hatchlings: little green kaiju scampering after enemies.
  updateAllies(game) {
    const live = new Set();
    const ug = this.unitGeometry('hatchling');
    for (const a of game.allies) {
      live.add(a);
      let m = this.allyMeshes.get(a);
      if (!m) {
        m = new THREE.Mesh(ug.geo, this.mat);
        m.castShadow = true;
        this.allyMeshes.set(a, m);
        this.scene.add(m);
      }
      const s = a.r / 1.6;
      m.scale.setScalar(s * Math.min(1, a.life * 2));
      m.position.set(a.x, Math.abs(Math.sin(a.phase)) * a.r * 0.4, a.y);
      m.rotation.y = -a.heading;
    }
    for (const [a, m] of this.allyMeshes) {
      if (live.has(a)) continue;
      this.scene.remove(m);
      this.allyMeshes.delete(a);
    }
  }

  update(game, dt, t, elev) {
    this.updateKaiju(game, t, elev);
    this.updateBoss(game, t);
    this.updateUnits(game, t);
    this.updateAllies(game);
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
    if (rig.nodes.body) rig.nodes.body.scale.set(1, 1, 1);
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
      case 'eat': {
        // Lunge with the jaw wide, track the toss upward, snap shut, then a swallow with a
        // throat bulge and a happy little head shake.
        const n0 = rig.nodes;
        let head = 0;
        let jaw = 0;
        let lean = 0;
        let lunge = 0;
        if (f < 0.3) {
          const u = f / 0.3;
          head = -0.35 * Math.sin(u * Math.PI * 0.5);
          jaw = -1.05;
          lean = -0.18 * u;
          lunge = Math.sin(u * Math.PI * 0.5);
        } else if (f < 0.62) {
          const u = (f - 0.3) / 0.32;
          head = -0.35 + 0.8 * u;
          jaw = -1.15;
          lean = -0.18 + 0.25 * u;
          lunge = 1 - u;
        } else if (f < 0.7) {
          const u = (f - 0.62) / 0.08;
          head = 0.45 - 0.15 * u;
          jaw = -1.15 * (1 - u);
          lean = 0.07;
        } else {
          const u = (f - 0.7) / 0.3;
          head = 0.3 * (1 - u) + Math.sin(t * 32) * 0.12 * (1 - u);
          jaw = 0;
          lean = 0.07 * (1 - u);
          if (n0.body) {
            const bulge = Math.sin(u * Math.PI);
            n0.body.scale.set(1 - 0.03 * bulge, 1 + 0.09 * bulge, 1 + 0.06 * bulge);
          }
        }
        if (n0.head) n0.head.rotation.z = head;
        if (n0.jaw) n0.jaw.rotation.z = jaw;
        if (n0.body) n0.body.rotation.z += lean;
        rig.root.position.x += k.facing.x * k.r * 0.18 * lunge;
        rig.root.position.z += k.facing.y * k.r * 0.18 * lunge;
        return [0, 0, 0];
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
    const id = b.model || 'coast';
    if (this.boss && this.boss.id !== id) {
      this.scene.remove(this.boss.root);
      this.boss = null;
    }
    if (!this.boss) {
      const bm = this.makeMat();
      this.boss = partsGroup(b.model ? GATE_BOSS_MODELS[b.model]() : bossModel(), bm);
      this.boss.mat = bm;
      this.boss.id = id;
      this.scene.add(this.boss.root);
    }
    const rig = this.boss;
    if (b.dead) {
      rig.root.position.y -= b.r * 0.004;
      rig.root.rotation.z += 0.004;
      if (rig.root.position.y < -b.r * 2) rig.root.visible = false;
      return;
    }
    rig.root.visible = true;
    rig.root.scale.setScalar(b.r / rig.model.radius);
    rig.root.position.set(b.x, 0, b.y);
    rig.root.rotation.y = -b.aim;
    const moving = !['break', 'speech', 'windup'].includes(b.state);
    animateRig(rig, b.walk * 4, moving, t, b.state === 'windup');
    // Boss-specific flourishes: the spinning cone, the crane's boom and ball, sitting down
    // for a union break, waving through a speech.
    const n = rig.nodes;
    if (n.cone) {
      n.cone.rotation.y = t * (b.state === 'donut' ? 9 : 2);
      n.cone.position.y = n.cone.userData.base.y + Math.abs(Math.sin(t * 6)) * 0.6;
    }
    if (n.boom) {
      const spin = b.swingT > 0 ? (1.9 - b.swingT) * 5.5 : 0;
      const lift = b.state === 'break' ? 0.05 : 0.6 + Math.sin(t * 1.5) * 0.05;
      n.boom.rotation.set(0, spin, lift);
      if (n.ball) n.ball.rotation.set(Math.sin(t * 2.2) * 0.25, 0, -lift + Math.sin(t * 2.6) * (b.swingT > 0 ? 0.6 : 0.15));
    }
    if (n.body && b.state === 'break') n.body.position.y = n.body.userData.base.y * 0.45;
    if (b.state === 'speech') {
      if (n.armL) n.armL.rotation.z = 1.3 + Math.sin(t * 5) * 0.4;
      if (n.armR) n.armR.rotation.z = 1.1 + Math.sin(t * 5 + 1) * 0.3;
    }
    if (b.flash > 0) rig.mat.emissive.setRGB(0.75, 0.75, 0.72);
    else if (b.shield) {
      const fl = 0.25 + 0.15 * Math.sin(t * 8);
      rig.mat.emissive.setRGB(fl * 0.3, fl * 0.6, fl);
    } else {
      const fl = b.state === 'windup' ? 0.25 + 0.25 * Math.sin(t * 30) : 0;
      rig.mat.emissive.setRGB(fl, fl * 0.4, fl * 0.2);
    }
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
        const ug = this.unitGeometry(u.def.model || u.type);
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
      else if (u.type === 'drone') y = Math.max(2, k.r * 0.9) + Math.sin(t * 5 + u.age) * 0.3;
      else if (u.def.mob || u.type === 'mech' || u.type === 'cop' || u.type === 'dog') y = Math.abs(Math.sin(u.age * (u.def.mob ? 9 : 6))) * u.r * 0.15;
      // Panic: trembling, running hunched away instead of facing the kaiju, cars fishtailing.
      const st = u.stress || 0;
      const shake = st > 0.2 ? Math.sin(t * 60 + u.id * 50) * u.r * 0.12 * st : 0;
      m.position.set(u.x + shake, y, u.y - shake * 0.6);
      const faceAim = st < 0.12 && (u.type === 'heli' || u.type === 'tank' || u.type === 'artillery' || u.type === 'mech' || u.type === 'cop' || u.type === 'roadblock');
      m.rotation.y = -(faceAim ? u.aim : u.heading) + (u.type === 'police' ? Math.sin(t * 9 + u.age) * 0.18 * st : 0);
      m.rotation.order = 'YXZ';
      m.rotation.z = u.type === 'heli' ? Math.sin(t * 3 + u.age) * 0.08 : u.type === 'cop' ? -st * 0.35 : 0;
      // Frozen units turn ice-white; hits flash white too.
      m.material = u.flash > 0 || u.frozen > 0 ? this.flashMat : this.mat;
      m.scale.setScalar((u.scale || 1) * (u.elite ? 1.5 : 1) * (u.flash > 0 ? 1.15 : 1));
    }
    for (const [u, m] of this.unitMeshes) {
      if (live.has(u)) continue;
      this.scene.remove(m);
      this.unitMeshes.delete(u);
    }
  }

  // World position of the kaiju's mouth this frame.
  mouthWorld(out = this._mouth) {
    const rig = this.kaiju;
    const jaw = rig && (rig.nodes.jaw || rig.nodes.head);
    if (!jaw) return out.set(0, 0, 0);
    rig.root.updateMatrixWorld(true);
    return jaw.localToWorld(out.copy(rig.mouthLocal));
  }

  // Snatch, toss, chomp, gulp: an eaten person flies from the ground into the actual mouth.
  placeEaten(p, k, t) {
    const f = Math.min(1, p.t / EAT_TIME);
    const mouth = this.mouthWorld();
    const fx = k.facing.x;
    const fz = k.facing.y;
    const apexX = mouth.x + fx * k.r * 0.4;
    const apexY = mouth.y + k.r * 1.5;
    const apexZ = mouth.z + fz * k.r * 0.4;
    let x;
    let y;
    let z;
    let rx = 0;
    let rz = 0;
    let s;
    if (f < 0.3) {
      // Snatch: yanked up off the ground, limbs flailing.
      const u = 1 - (1 - f / 0.3) * (1 - f / 0.3);
      x = p.x0 + (apexX - p.x0) * u;
      y = apexY * u;
      z = p.y0 + (apexZ - p.y0) * u;
      rx = Math.sin(t * 45 + p.phase) * 0.6;
      rz = Math.cos(t * 38 + p.phase) * 0.5;
      s = 1 - 0.35 * u;
    } else if (f < 0.62) {
      // Toss: flipped over the snout and dropped head-first into the open jaw.
      const u = (f - 0.3) / 0.32;
      const e = u * u;
      x = apexX + (mouth.x - apexX) * e;
      y = apexY + (mouth.y - apexY) * e + Math.sin(u * Math.PI) * k.r * 0.3;
      z = apexZ + (mouth.z - apexZ) * e;
      rx = Math.PI * 1.4 * u;
      rz = Math.sin(t * 30) * 0.3;
      s = 0.65 - 0.15 * u;
    } else {
      // Gulp: down the hatch, sliding back into the throat as it shrinks away.
      const u = (f - 0.62) / 0.38;
      x = mouth.x - fx * k.r * 0.35 * u;
      y = mouth.y - k.r * 0.12 * u;
      z = mouth.z - fz * k.r * 0.35 * u;
      rx = Math.PI * 1.4;
      s = 0.5 * (1 - u) * (1 - u);
    }
    // Spin about the body's middle rather than the feet.
    this._e.set(rx, -Math.atan2(fz, fx), rz);
    this._q.setFromEuler(this._e);
    this._half.set(0, this.personH * 0.5 * s, 0).applyQuaternion(this._q);
    this._v.set(x - this._half.x, y - this._half.y, z - this._half.z);
    this._s.setScalar(Math.max(0.001, s));
  }

  updatePeople(game, t) {
    const counts = new Array(PERSON_LOOKS).fill(0);
    let marks = 0;
    const m = this._m;
    const k = game.kaiju;
    for (const p of game.people) {
      const im = this.peopleMeshes[p.variant];
      const i = counts[p.variant]++;
      if (i >= 160) continue;
      if (p.state === 'eaten') {
        this.placeEaten(p, k, t);
        m.compose(this._v, this._q, this._s);
        im.setMatrixAt(i, m);
        continue;
      }
      const bob = p.state === 'flung' ? 0 : Math.abs(Math.sin(p.phase)) * 0.35;
      if (p.variant === DOCTOR && !p.taken) {
        let mk = this.doctorMarks[marks];
        if (!mk) {
          mk = new THREE.Mesh(this.crossGeo, this.healMat);
          this.scene.add(mk);
          this.doctorMarks.push(mk);
        }
        marks++;
        const sc = Math.max(0.7, k.r * 0.3);
        mk.visible = true;
        mk.scale.setScalar(sc);
        mk.position.set(p.x, this.personH + 2 + sc * 3 + Math.sin(t * 3) * 0.6, p.y);
        mk.rotation.y = t * 2;
      }
      this._v.set(p.x, p.z + bob, p.y);
      if (p.state === 'flung') this._e.set(p.spin, -p.heading, p.spin * 0.7);
      else this._e.set(0, -p.heading, p.state === 'flee' ? -0.25 : 0);
      this._q.setFromEuler(this._e);
      this._s.set(1, 1, 1);
      m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, m);
    }
    for (let i = marks; i < this.doctorMarks.length; i++) this.doctorMarks[i].visible = false;
    for (let v = 0; v < PERSON_LOOKS; v++) {
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
    let nf = 0;
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
      if (c.flash > 0) {
        // White copy over a car that was hit but is still driving.
        let fm = this.carFlash[nf];
        if (!fm) {
          fm = new THREE.Mesh(im.geometry, this.flashMat);
          this.scene.add(fm);
          this.carFlash.push(fm);
        }
        nf++;
        fm.geometry = im.geometry;
        fm.visible = true;
        fm.position.copy(this._v);
        fm.quaternion.copy(this._q);
        fm.scale.setScalar(1.2);
      }
    }
    for (let j = nf; j < this.carFlash.length; j++) this.carFlash[j].visible = false;
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
