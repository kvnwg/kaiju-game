/* global THREE */
// City ambience that doesn't affect gameplay: power cables between poles, metro trains,
// bird flocks that scatter, boats on the water, and an advertising blimp.
import { meshGrid } from './mesher.js';
import { trainCarModel, birdModel, blimpModel } from './models.js';
import { buildProp } from './props.js';
import { toGeometry } from './actors3d.js';
import { isWater } from './world.js';

const BIRDS_PER_FLOCK = 16;
const MAX_FLOCKS = 6;

export class Ambient {
  constructor(scene, mat) {
    this.scene = scene;
    this.mat = mat;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  build(city) {
    this.city = city;
    // Power cables
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x1e1e22 });
    this.wires = new THREE.LineSegments(new THREE.BufferGeometry(), this.wireMat);
    this.wires.frustumCulled = false;
    this.scene.add(this.wires);
    this.poles = new Set(city.powerLines.flat());
    this.brokenPoles = -1;
    // Metro cars
    const mk = (front) => {
      const tm = trainCarModel(front);
      return toGeometry(meshGrid(tm.grid, { v: tm.v, ox: tm.origin.x, oz: tm.origin.z }));
    };
    this.carGeo = { front: mk(true), mid: mk(false) };
    this.trainMeshes = new Map();
    // Birds
    const bm = birdModel();
    this.birdMesh = new THREE.InstancedMesh(toGeometry(meshGrid(bm.grid, { v: bm.v, ox: bm.origin.x, oz: bm.origin.z })), this.mat, BIRDS_PER_FLOCK * MAX_FLOCKS);
    this.birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birdMesh.frustumCulled = false;
    this.birdMesh.count = 0;
    this.scene.add(this.birdMesh);
    this.roosts = city.decals.filter((d) => d.kind === 'plaza' || d.kind === 'pond').map((d) => ({ x: d.x, y: d.y }));
    this.flocks = [];
    // Boats circling the lake and cruising the coast
    const boat = buildProp('boat', 1);
    this.boatMesh = new THREE.InstancedMesh(toGeometry(meshGrid(boat.grid, { v: boat.v * 1.6, ox: boat.origin.x, oz: boat.origin.z })), this.mat, 14);
    this.boatMesh.frustumCulled = false;
    this.boatMesh.castShadow = true;
    this.scene.add(this.boatMesh);
    this.boats = [];
    const L = city.lake;
    for (let i = 0; i < 8; i++) this.boats.push({ kind: 'lake', cx: L.cx, cy: L.cy, rx: L.rx * (0.35 + (i % 4) * 0.12), ry: L.ry * (0.35 + (i % 4) * 0.12), a: (i / 8) * Math.PI * 2, speed: 0.025 + (i % 3) * 0.01 });
    for (let i = 0; i < 6; i++) this.boats.push({ kind: 'sea', x: 200 + (i % 3) * 180, y: 600 + i * 900, dir: i % 2 ? 1 : -1, speed: 30 + i * 4 });
    // Blimp over downtown
    const blm = blimpModel();
    this.blimp = new THREE.Mesh(toGeometry(meshGrid(blm.grid, { v: blm.v, ox: blm.origin.x, oz: blm.origin.z, oy: 5 })), this.mat);
    this.blimp.castShadow = true;
    this.scene.add(this.blimp);
  }

  reset() {
    for (const [, group] of this.trainMeshes) this.scene.remove(group);
    this.trainMeshes.clear();
    this.flocks = [];
    this.brokenPoles = -1;
  }

  rebuildWires() {
    const pts = [];
    const sagSteps = 6;
    for (const chain of this.city.powerLines) {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        if (a.state !== 'intact' || b.state !== 'intact') continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        for (const off of [-3, 0, 3]) {
          for (let k = 0; k < sagSteps; k++) {
            for (const kk of [k, k + 1]) {
              const t = kk / sagSteps;
              const sag = Math.sin(t * Math.PI) * 3;
              pts.push(a.x + dx * t + px * off, 18.5 - sag - (off === 0 ? 1 : 0), a.y + dy * t + py * off);
            }
          }
        }
      }
    }
    this.wires.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wires.geometry = g;
  }

  update(game, dt, t, view) {
    // Cables drop when a pole on either end is knocked down.
    this.wireCheck = (this.wireCheck || 0) - dt;
    if (this.wireCheck <= 0) {
      this.wireCheck = 0.4;
      let broken = 0;
      for (const p of this.poles) if (p.state !== 'intact') broken++;
      if (broken !== this.brokenPoles) {
        this.brokenPoles = broken;
        this.rebuildWires();
      }
    }
    this.wires.visible = view.span < 2400;
    this.updateTrains(game);
    this.updateBirds(game, dt, t, view);
    this.updateBoats(dt, t, game);
    // Blimp: a slow loop over downtown, high above the towers.
    const a = t * 0.012;
    this.blimp.position.set(2900 + Math.cos(a) * 900, 380 + Math.sin(t * 0.3) * 6, 3500 + Math.sin(a) * 700);
    this.blimp.rotation.y = -(a + Math.PI / 2);
  }

  updateTrains(game) {
    const live = new Set();
    const metro = game.city.metro;
    if (!metro) return;
    for (const tr of game.trains) {
      live.add(tr);
      let group = this.trainMeshes.get(tr);
      if (!group) {
        group = new THREE.Group();
        for (let i = 0; i < tr.cars; i++) {
          const m = new THREE.Mesh(i === 0 ? this.carGeo.front : this.carGeo.mid, this.mat);
          m.castShadow = true;
          group.add(m);
        }
        this.scene.add(group);
        this.trainMeshes.set(tr, group);
      }
      group.children.forEach((m, i) => {
        const p = game.metroAt(tr.s - tr.dir * i * 36);
        m.position.set(p.x, metro.deck + 2.5, p.y);
        m.rotation.y = -(p.heading + (tr.dir < 0 ? Math.PI : 0));
      });
    }
    for (const [tr, group] of this.trainMeshes) {
      if (live.has(tr)) continue;
      this.scene.remove(group);
      this.trainMeshes.delete(tr);
    }
  }

  updateBirds(game, dt, t, view) {
    const k = game.kaiju;
    // Keep a few flocks around the nearest parks and plazas while the camera is low.
    if (view.span < 1600) {
      for (const f of this.flocks) if (Math.hypot(f.x - view.x, f.y - view.z) > view.span * 1.5) f.gone = true;
      this.flocks = this.flocks.filter((f) => !f.gone && f.life > 0);
      if (this.flocks.length < MAX_FLOCKS) {
        const near = this.roosts.filter((r) => Math.hypot(r.x - view.x, r.y - view.z) < view.span * 1.1 && !this.flocks.some((f) => f.roost === r));
        if (near.length) {
          const r = near[Math.floor(Math.random() * near.length)];
          this.flocks.push({ roost: r, x: r.x, y: r.y, h: 18 + Math.random() * 14, life: 999, scared: false, phase: Math.random() * 6, birds: Array.from({ length: BIRDS_PER_FLOCK }, () => ({ a: Math.random() * 6.28, r: 10 + Math.random() * 18, dh: Math.random() * 6, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0 })) });
        }
      }
    } else this.flocks = [];
    let n = 0;
    for (const f of this.flocks) {
      if (!f.scared && Math.hypot(k.x - f.x, k.y - f.y) < 40 + k.r * 4) {
        f.scared = true;
        f.life = 6;
        for (const b of f.birds) {
          b.px = f.x + Math.cos(b.a) * b.r;
          b.py = f.y + Math.sin(b.a) * b.r;
          b.pz = f.h + b.dh;
          const away = Math.atan2(b.py - k.y, b.px - k.x) + (Math.random() - 0.5);
          b.vx = Math.cos(away) * (40 + Math.random() * 30);
          b.vy = Math.sin(away) * (40 + Math.random() * 30);
          b.vz = 20 + Math.random() * 20;
        }
      }
      if (f.scared) f.life -= dt;
      for (const b of f.birds) {
        let x;
        let y;
        let z;
        let heading;
        if (f.scared) {
          b.px += b.vx * dt;
          b.py += b.vy * dt;
          b.pz += b.vz * dt;
          x = b.px;
          y = b.py;
          z = b.pz;
          heading = Math.atan2(b.vy, b.vx);
        } else {
          b.a += dt * (0.6 + b.r * 0.01);
          x = f.x + Math.cos(b.a) * b.r;
          y = f.y + Math.sin(b.a) * b.r;
          z = f.h + b.dh + Math.sin(t * 2 + b.a) * 2;
          heading = b.a + Math.PI / 2;
        }
        const flap = 0.6 + Math.abs(Math.sin(t * 14 + b.a * 3)) * 0.8;
        this._v.set(x, z, y);
        this._e.set(0, -heading, 0);
        this._q.setFromEuler(this._e);
        this._s.set(1, 1, flap);
        this._m.compose(this._v, this._q, this._s);
        this.birdMesh.setMatrixAt(n++, this._m);
      }
    }
    this.birdMesh.count = n;
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  updateBoats(dt, t, game) {
    let n = 0;
    for (const b of this.boats) {
      let x;
      let y;
      let heading;
      if (b.kind === 'lake') {
        b.a += dt * b.speed;
        x = b.cx + Math.cos(b.a) * b.rx;
        y = b.cy + Math.sin(b.a) * b.ry;
        heading = Math.atan2(Math.cos(b.a) * b.ry, -Math.sin(b.a) * b.rx);
      } else {
        b.y += b.dir * b.speed * dt;
        if (b.y < 200 || b.y > game.city.lake.cy * 2) b.dir *= -1;
        x = b.x;
        y = b.y;
        heading = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      if (!isWater(x, y)) continue;
      this._v.set(x, 0.6 + Math.sin(t * 2 + n) * 0.3, y);
      this._e.set(0, -heading, Math.sin(t * 1.5 + n) * 0.04);
      this._q.setFromEuler(this._e);
      this._s.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._s);
      this.boatMesh.setMatrixAt(n++, this._m);
    }
    this.boatMesh.count = n;
    this.boatMesh.instanceMatrix.needsUpdate = true;
  }
}
