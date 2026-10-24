import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUGMENTS, AUGMENT_BY_ID, MOVES, PASSIVES, SYNERGY_SETS, MOVE_SLOTS, PASSIVE_SLOTS,
  offerAugments, applyPick, completedSets, maxLevel, moveStats, levelText, readyEvolutions, EVOLUTIONS, movesHeld,
} from '../src/augments.js';
import { createRng } from '../src/rng.js';

test('pool: moves level to 8 with short texts, passives to 3-5, sets reference real augments', () => {
  const ids = new Set(AUGMENTS.map((a) => a.id));
  assert.equal(ids.size, AUGMENTS.length);
  assert.ok(MOVES.length >= 8);
  assert.ok(PASSIVES.length >= 12);
  for (const m of MOVES) {
    assert.equal(maxLevel(m), 8, m.id);
    for (let l = 1; l < 8; l++) {
      const t = levelText(m.id, l);
      assert.ok(t.length > 0 && t.length <= 30, `${m.id} L${l + 1}: "${t}"`);
    }
  }
  for (const a of AUGMENTS) assert.ok(a.text.length <= 32, `${a.id}: "${a.text}"`);
  for (const p of PASSIVES) assert.ok(maxLevel(p) >= 3 && maxLevel(p) <= 5, p.id);
  for (const s of SYNERGY_SETS) for (const id of s.augments) assert.ok(AUGMENT_BY_ID[id], id);
});

test('move levels stack: Claw strikes twice at Lv3, Spines gain missiles, Laser splits at Lv5', () => {
  assert.ok(!moveStats('clawStrike', 2).twice);
  assert.ok(moveStats('clawStrike', 3).twice);
  assert.equal(moveStats('spineMissiles', 1).count, 4);
  assert.equal(moveStats('spineMissiles', 8).count, 12);
  assert.ok(moveStats('laserEyes', 5).split);
  assert.ok(Math.abs(moveStats('clawStrike', 8).dmg - 1.7) < 1e-9);
});

test('with no move yet, the offer leans on moves', () => {
  const rng = createRng(3);
  for (let i = 0; i < 50; i++) {
    const offer = offerAugments({ held: new Map(), rng });
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3);
    assert.ok(offer.filter((id) => AUGMENT_BY_ID[id].kind === 'move').length >= 2, offer.join());
  }
});

test('slots: with 6 moves and 6 passives, only upgrades are offered', () => {
  const held = new Map();
  MOVES.slice(0, MOVE_SLOTS).forEach((m) => held.set(m.id, 1));
  PASSIVES.slice(0, PASSIVE_SLOTS).forEach((p) => held.set(p.id, 1));
  const rng = createRng(7);
  for (let i = 0; i < 60; i++) {
    for (const id of offerAugments({ held, rng })) assert.ok(held.has(id), id);
  }
});

test('maxed augments are not offered; everything maxed falls back to Growth Spurt and Scrap Pile', () => {
  const held = new Map();
  MOVES.slice(0, MOVE_SLOTS).forEach((m) => held.set(m.id, maxLevel(m)));
  PASSIVES.slice(0, PASSIVE_SLOTS).forEach((p) => held.set(p.id, maxLevel(p)));
  // Tail Spin maxed plus Long Legs: its evolution is ready and always offered.
  assert.ok(readyEvolutions(held).some((e) => e.id === 'cycloneKing'));
  assert.ok(offerAugments({ held, rng: createRng(1) }).includes('cycloneKing'));
  for (const e of readyEvolutions(held)) applyPick(held, e.id);
  const offer = offerAugments({ held, rng: createRng(1) });
  assert.ok(offer.includes('growthSpurt') && offer.includes('scrapPile'));
});

test('evolutions need their move maxed and their partner passive, and take no slot', () => {
  const held = new Map([['laserEyes', 7], ['might', 1]]);
  assert.equal(readyEvolutions(held).length, 0);
  held.set('laserEyes', 8);
  assert.deepEqual(readyEvolutions(held).map((e) => e.id), ['omegaBeam']);
  applyPick(held, 'omegaBeam');
  assert.equal(readyEvolutions(held).length, 0);
  assert.equal(movesHeld(held), 1);
  for (const e of EVOLUTIONS) assert.ok(AUGMENT_BY_ID[e.move] && AUGMENT_BY_ID[e.passive], e.id);
});

test('guaranteed option is always offered (first-session Laser Eyes)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const offer = offerAugments({ held: new Map(), rng: createRng(seed), guarantee: 'laserEyes' });
    assert.ok(offer.includes('laserEyes'));
  }
});

test('reroll excludes the current options when it can', () => {
  const rng = createRng(4);
  const held = new Map([['tailSpin', 2]]);
  const first = offerAugments({ held, rng });
  const second = offerAugments({ held, rng, exclude: first });
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
});

test('applyPick levels augments and caps them', () => {
  const held = new Map();
  for (let l = 1; l <= 5; l++) assert.equal(applyPick(held, 'thickHide'), l);
  assert.throws(() => applyPick(held, 'thickHide'));
  for (let l = 1; l <= 8; l++) applyPick(held, 'laserEyes');
  assert.throws(() => applyPick(held, 'laserEyes'));
  assert.equal(applyPick(held, 'growthSpurt'), 0);
});

test('completedSets detects a full set', () => {
  const held = new Map([['gasMain', 1], ['seismicSlam', 1]]);
  assert.equal(completedSets(held).length, 0);
  held.set('meteorCall', 1);
  assert.deepEqual(completedSets(held).map((s) => s.id), ['demolition']);
});
