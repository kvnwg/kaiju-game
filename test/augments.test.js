import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUGMENTS, AUGMENT_BY_ID, MOVES, SYNERGY_SETS, offerAugments, applyPick, completedSets, rollTier } from '../src/augments.js';
import { createRng } from '../src/rng.js';

test('pool: unique ids, plenty of moves and mods, every mod points at a real move', () => {
  const ids = new Set(AUGMENTS.map((a) => a.id));
  assert.equal(ids.size, AUGMENTS.length);
  assert.ok(MOVES.length >= 8);
  const mods = AUGMENTS.filter((a) => a.kind === 'mod');
  assert.ok(mods.length >= 15);
  for (const m of mods) assert.ok(m.requires === 'any' || AUGMENT_BY_ID[m.requires]?.kind === 'move', m.id);
  // Every move can be upgraded by at least one mod.
  for (const mv of MOVES) assert.ok(mods.some((m) => m.requires === mv.id), mv.id);
  for (const tier of ['silver', 'gold', 'prismatic']) assert.ok(MOVES.some((m) => m.tier === tier), tier);
  for (const s of SYNERGY_SETS) for (const id of s.augments) assert.ok(AUGMENT_BY_ID[id], id);
});

test('with no move yet, every option is a move', () => {
  const rng = createRng(3);
  for (const tier of ['silver', 'gold', 'prismatic']) {
    for (let i = 0; i < 30; i++) {
      const offer = offerAugments({ held: new Map(), tier, rng });
      assert.equal(offer.length, 3);
      assert.equal(new Set(offer).size, 3);
      assert.ok(offer.every((id) => AUGMENT_BY_ID[id].kind === 'move'), offer.join());
    }
  }
});

test('mods only show up for moves you own, and one slot prefers them', () => {
  const rng = createRng(9);
  const held = new Map([['clawStrike', 1]]);
  for (let i = 0; i < 60; i++) {
    const offer = offerAugments({ held, tier: 'silver', rng });
    for (const id of offer) {
      const a = AUGMENT_BY_ID[id];
      if (a.kind === 'mod') assert.ok(a.requires === 'any' || a.requires === 'clawStrike', id);
    }
    assert.ok(offer.some((id) => AUGMENT_BY_ID[id].requires === 'clawStrike'), offer.join());
  }
});

test('held augments are not offered again unless upgradable', () => {
  const rng = createRng(5);
  const held = new Map([['clawStrike', 1], ['hairTrigger', 1], ['quickGrowth', 1]]);
  let sawHair = false;
  for (let i = 0; i < 80; i++) {
    const offer = offerAugments({ held, tier: 'silver', rng });
    assert.ok(!offer.includes('clawStrike'));
    assert.ok(!offer.includes('quickGrowth'));
    if (offer.includes('hairTrigger')) sawHair = true;
  }
  assert.ok(sawHair, 'upgradable mod comes back');
});

test('a dry tier falls back to the next tier down', () => {
  const offer = offerAugments({ held: new Map(), tier: 'prismatic', rng: createRng(1) });
  assert.equal(offer.length, 3);
  assert.ok(offer.includes('meteorCall'));
  assert.equal(offer.filter((id) => AUGMENT_BY_ID[id].tier === 'gold').length, 2);
});

test('guaranteed option is always offered (first-session Laser Eyes)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const offer = offerAugments({ held: new Map(), tier: 'gold', rng: createRng(seed), guarantee: 'laserEyes' });
    assert.ok(offer.includes('laserEyes'));
  }
});

test('reroll excludes the current options when it can', () => {
  const rng = createRng(4);
  const held = new Map([['tailSpin', 1]]);
  const first = offerAugments({ held, tier: 'silver', rng });
  const second = offerAugments({ held, tier: 'silver', rng, exclude: first });
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
});

test('applyPick levels upgradable augments and caps them', () => {
  const held = new Map();
  assert.equal(applyPick(held, 'thickHide'), 1);
  assert.equal(applyPick(held, 'thickHide'), 2);
  assert.equal(applyPick(held, 'thickHide'), 3);
  assert.throws(() => applyPick(held, 'thickHide'));
  applyPick(held, 'laserEyes');
  assert.throws(() => applyPick(held, 'laserEyes'));
});

test('completedSets detects a full set', () => {
  const held = new Map([['dominoEffect', 1], ['gasMain', 1]]);
  assert.equal(completedSets(held).length, 0);
  held.set('seismicSlam', 1);
  assert.deepEqual(completedSets(held).map((s) => s.id), ['demolition']);
});

test('rollTier respects the stage odds', () => {
  const rng = createRng(11);
  const counts = { gold: 0, prismatic: 0 };
  for (let i = 0; i < 2000; i++) counts[rollTier({ gold: 0.7, prismatic: 0.3 }, rng)]++;
  assert.ok(counts.prismatic > 450 && counts.prismatic < 750, JSON.stringify(counts));
});
