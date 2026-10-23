import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUGMENTS, AUGMENT_BY_ID, SYNERGY_SETS, offerAugments, applyPick, completedSets, rollTier } from '../src/augments.js';
import { createRng } from '../src/rng.js';

test('MVP pool: tiers, unique ids, synergy sets reference real augments', () => {
  const ids = new Set(AUGMENTS.map((a) => a.id));
  assert.equal(ids.size, AUGMENTS.length);
  const count = (tier) => AUGMENTS.filter((a) => a.tier === tier).length;
  assert.equal(count('gold'), 5);
  assert.equal(count('prismatic'), 1);
  assert.ok(count('silver') >= 8);
  assert.equal(SYNERGY_SETS.length, 2);
  for (const s of SYNERGY_SETS) for (const id of s.augments) assert.ok(AUGMENT_BY_ID[id], id);
});

test('offers share a tier when the tier has enough options', () => {
  const rng = createRng(3);
  for (let i = 0; i < 50; i++) {
    const offer = offerAugments({ held: new Map(), tier: 'silver', rng });
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3);
    assert.ok(offer.every((id) => AUGMENT_BY_ID[id].tier === 'silver'));
  }
});

test('held augments are not offered again unless upgradable', () => {
  const rng = createRng(9);
  const held = new Map([['scavenger', 1], ['tailShockwave', 1], ['quickGrowth', 1], ['roar', 1], ['debrisToss', 1], ['snackAttack', 1]]);
  for (let i = 0; i < 50; i++) {
    const offer = offerAugments({ held, tier: 'silver', rng });
    assert.ok(!offer.includes('scavenger'));
    assert.ok(!offer.includes('roar'));
    // Only 3 silver options remain, and tailShockwave is one (it levels up instead).
    assert.deepEqual([...offer].sort(), ['heavyStomp', 'tailShockwave', 'thickHide']);
  }
});

test('a dry tier falls back to the next tier down', () => {
  const offer = offerAugments({ held: new Map(), tier: 'prismatic', rng: createRng(1) });
  assert.equal(offer.length, 3);
  assert.ok(offer.includes('meteorCall'));
  assert.equal(offer.filter((id) => AUGMENT_BY_ID[id].tier === 'gold').length, 2);
});

test('guaranteed option is always offered (first-session Domino Effect)', () => {
  for (let seed = 0; seed < 30; seed++) {
    const offer = offerAugments({ held: new Map(), tier: 'gold', rng: createRng(seed), guarantee: 'dominoEffect' });
    assert.ok(offer.includes('dominoEffect'));
  }
});

test('reroll excludes the current options when it can', () => {
  const rng = createRng(4);
  const first = offerAugments({ held: new Map(), tier: 'silver', rng });
  const second = offerAugments({ held: new Map(), tier: 'silver', rng, exclude: first });
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
});

test('applyPick levels upgradable augments and caps them', () => {
  const held = new Map();
  assert.equal(applyPick(held, 'thickHide'), 1);
  assert.equal(applyPick(held, 'thickHide'), 2);
  assert.equal(applyPick(held, 'thickHide'), 3);
  assert.throws(() => applyPick(held, 'thickHide'));
  applyPick(held, 'scavenger');
  assert.throws(() => applyPick(held, 'scavenger'));
});

test('completedSets detects a full set', () => {
  const held = new Map([['dominoEffect', 1], ['gasMain', 1]]);
  assert.equal(completedSets(held).length, 0);
  held.set('debrisToss', 1);
  assert.deepEqual(completedSets(held).map((s) => s.id), ['demolition']);
});

test('rollTier respects the stage odds', () => {
  const rng = createRng(11);
  const counts = { gold: 0, prismatic: 0 };
  for (let i = 0; i < 2000; i++) counts[rollTier({ gold: 0.7, prismatic: 0.3 }, rng)]++;
  assert.ok(counts.prismatic > 450 && counts.prismatic < 750, JSON.stringify(counts));
});
