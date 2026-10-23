import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_TYPES, buildBuilding, buildingDims, VARIANTS } from '../src/buildings.js';
import { PROP_TYPES, buildProp } from '../src/props.js';
import { KAIJU_MODELS, UNIT_MODELS, bossModel, personModel } from '../src/models.js';
import { VoxelGrid, E, W } from '../src/voxel.js';
import { meshGrid, fracture } from '../src/mesher.js';
import { ENEMIES } from '../src/config.js';

test('at least 50 placeable building types, each building real voxels in every variant', () => {
  const placeable = BUILDING_TYPES.filter((t) => t.weight > 0);
  assert.ok(placeable.length >= 50, `${placeable.length} types`);
  for (const t of BUILDING_TYPES) {
    for (let v = 0; v < VARIANTS; v++) {
      const b = buildBuilding(t.id, v);
      assert.ok(b.grid.count() > 20, `${t.id}:${v} has voxels`);
      const d = buildingDims(t.id, v);
      assert.ok(d.w > 0 && d.h > 0 && d.height > 0);
    }
  }
});

test('buildings carry lit windows or neon so the city glows at night', () => {
  let lit = 0;
  for (const t of BUILDING_TYPES.filter((x) => x.tier >= 4)) {
    const g = buildBuilding(t.id, 0).grid;
    let flags = 0;
    for (let i = 0; i < g.data.length; i++) if (g.data[i] >>> 24) flags++;
    if (flags > 0) lit++;
  }
  assert.ok(lit >= 25);
});

test('props and characters build', () => {
  assert.ok(PROP_TYPES.length >= 40);
  for (const p of PROP_TYPES) for (let v = 0; v < 3; v++) assert.ok(buildProp(p.id, v).grid.count() > 0, p.id);
  for (const id of Object.keys(KAIJU_MODELS)) {
    const m = KAIJU_MODELS[id]();
    assert.ok(m.parts.length >= 6, `${id} is a rig`);
    for (const p of m.parts) assert.ok(p.grid.count() > 0, `${id}.${p.name}`);
  }
  for (const [id, def] of Object.entries(ENEMIES)) assert.ok(UNIT_MODELS[def.model || id]().grid.count() > 0, id);
  assert.ok(bossModel().parts.length >= 4);
  assert.equal(personModel(0).grid.ny, 6);
});

test('mesher culls hidden faces and keeps flags', () => {
  const g = new VoxelGrid(2, 1, 1);
  g.set(0, 0, 0, 0xff0000, E);
  g.set(1, 0, 0, 0x00ff00, W);
  const m = meshGrid(g);
  assert.equal(m.faces, 10, 'two touching cubes share a hidden face pair');
  assert.equal(m.indices.length, 60);
  assert.ok(m.flags.includes(E) && m.flags.includes(W));
  const removed = new Uint8Array(2);
  removed[1] = 1;
  assert.equal(meshGrid(g, { removed }).faces, 6);
});

test('fracture assigns every voxel to exactly one chunk', () => {
  const b = buildBuilding('brick_tenement', 0);
  const f = fracture(b.grid, 4);
  let assigned = 0;
  for (let i = 0; i < b.grid.data.length; i++) {
    if (b.grid.data[i]) {
      assert.ok(f.chunkOf[i] >= 0);
      assigned++;
    } else assert.equal(f.chunkOf[i], -1);
  }
  assert.equal(assigned, f.chunks.reduce((s, c) => s + c.voxels.length, 0));
  assert.ok(f.chunks.length > 20);
});
