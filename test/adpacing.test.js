import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACE, PACE_ARMS, PRESSURE_ARMS, paceState, armOf, startSession, tickPlay, breakDecision, adShown, reviveOffer, markReviveAd, reviveTaken, runEnded, pressureDue } from '../src/adpacing.js';
import { AD_PRESSURE } from '../src/config.js';

const MIN = 60000;
const fresh = (arm = 'a', created = 1) => {
  const save = { created };
  const st = paceState(save, 0, arm);
  startSession(st, 0);
  return { save, st };
};
// A returning player: past the first session and the first runs.
const veteran = (arm = 'a') => {
  const { save, st } = fresh(arm);
  st.runs = 20;
  startSession(st, 1000);
  return { save, st };
};

test('every player lands in one of the pacing arms, and keeps it', () => {
  const ids = new Set();
  for (let c = 1; c < 200; c++) ids.add(paceState({ created: c * 7919 }, 0).arm);
  assert.deepEqual([...ids].sort(), PACE_ARMS.map((a) => a.id).sort());
  const save = { created: 42 };
  assert.equal(paceState(save, 0).arm, paceState(save, 99).arm);
});

test('no ad break straight after a rewarded-revive offer (one ad offer per break)', () => {
  const { st } = veteran();
  tickPlay(st, 30 * 60);
  assert.deepEqual(breakDecision(st, { now: 60 * MIN, runSec: 300, reviveOffered: true }), { show: false, why: 'revive-offer' });
});

test('no ad break before a few minutes of play, nor after a very short run', () => {
  const { st } = veteran();
  tickPlay(st, 60);
  assert.equal(breakDecision(st, { now: 5 * MIN, runSec: 60 }).why, 'warm-up');
  tickPlay(st, 10 * 60);
  assert.equal(breakDecision(st, { now: 15 * MIN, runSec: PACE.shortRun - 1 }).why, 'short-run');
  assert.equal(breakDecision(st, { now: 15 * MIN, runSec: 120 }).show, true);
});

test("a brand-new player's first ad break waits longer", () => {
  const { st } = fresh('a');
  tickPlay(st, armOf(st).firstMin * 60 + 10);
  assert.equal(breakDecision(st, { now: 10 * MIN, runSec: 200 }).why, 'warm-up');
  tickPlay(st, PACE.newPlayerExtraMin * 60);
  assert.equal(breakDecision(st, { now: 10 * MIN, runSec: 200 }).show, true);
});

test('ad breaks keep their arm\'s gap and need real play in between', () => {
  for (const arm of PACE_ARMS) {
    const { st } = veteran(arm.id);
    tickPlay(st, 20 * 60);
    const t0 = 100 * MIN;
    assert.equal(breakDecision(st, { now: t0, runSec: 300 }).show, true);
    adShown(st, 'midgame', t0);
    tickPlay(st, 20 * 60);
    assert.equal(breakDecision(st, { now: t0 + (arm.gapMin - 0.5) * MIN, runSec: 300 }).why, 'gap');
    assert.equal(breakDecision(st, { now: t0 + (arm.gapMin + 0.5) * MIN, runSec: 300 }).show, true);
    adShown(st, 'midgame', t0 + 10 * MIN);
    tickPlay(st, PACE.minPlaySinceAd - 5);
    assert.equal(breakDecision(st, { now: t0 + 30 * MIN, runSec: 300 }).why, 'too-little-play');
  }
});

test('no ad break right after the player chose to watch a rewarded video', () => {
  const { st } = veteran();
  tickPlay(st, 20 * 60);
  adShown(st, 'rewarded', 50 * MIN);
  assert.equal(breakDecision(st, { now: 50 * MIN + 20000, runSec: 300 }).why, 'just-watched');
});

test('a player back after a few days away skips the first ad break and gets a free revive', () => {
  const { st } = veteran();
  startSession(st, (PACE.awayDays + 1) * 86400000);
  tickPlay(st, 20 * 60);
  const now = (PACE.awayDays + 1) * 86400000 + 30 * MIN;
  assert.equal(breakDecision(st, { now, runSec: 300 }).why, 'welcome-back');
  assert.equal(breakDecision(st, { now, runSec: 300 }).show, true);
  assert.equal(reviveOffer(st, {}).gift, 'welcome');
});

test('free revives: the first runs, and after a rough patch, but only once a session', () => {
  const { st } = fresh();
  assert.equal(reviveOffer(st, {}).gift, 'new');
  reviveTaken(st, 'gift');
  assert.equal(reviveOffer(st, {}).gift, null);
  const v = veteran().st;
  assert.equal(reviveOffer(v, {}).gift, null);
  for (let i = 0; i < PACE.rough; i++) runEnded(v, { won: false, runSec: 60 });
  assert.equal(reviveOffer(v, {}).gift, 'rough');
  runEnded(v, { won: false, runSec: PACE.quickLoss + 60 });
  assert.equal(reviveOffer(v, {}).gift, null);
});

test('the revive offer says how close the run is to your best, only when it is close', () => {
  const { st } = veteran();
  assert.equal(reviveOffer(st, { damage: 500, bestDamage: 1000 }).near, 0);
  assert.equal(reviveOffer(st, { damage: 900, bestDamage: 1000 }).near, 0.9);
  assert.ok(reviveOffer(st, { damage: 1500, bestDamage: 1000 }).near > 1);
  assert.equal(reviveOffer(st, { damage: 900, bestDamage: 0 }).near, 0);
});

test('an ad revive is not offered on every knockdown: offers keep a gap', () => {
  const { st } = veteran();
  assert.equal(reviveOffer(st, { now: 10 * MIN }).ad, true);
  markReviveAd(st, 10 * MIN);
  assert.equal(reviveOffer(st, { now: 12 * MIN }).ad, false);
  assert.equal(reviveOffer(st, { now: (10 + PACE.reviveGapMin) * MIN }).ad, true);
});

test('ad pressure: only with ads ready, past the first runs, near the best, per arm', () => {
  const near = (arm) => {
    const { st } = veteran();
    st.pressureArm = arm;
    return st;
  };
  const ok = { damage: 900, bestDamage: 1000, adReady: true, now: 100 * MIN };
  assert.equal(pressureDue(near('near'), ok), AD_PRESSURE.enabled);
  assert.equal(pressureDue(near('never'), ok), false, 'the control arm never gets it');
  assert.equal(pressureDue(near('past'), ok), false, 'not yet past the best');
  assert.equal(pressureDue(near('past'), { ...ok, damage: 1100 }), AD_PRESSURE.enabled);
  assert.equal(pressureDue(near('near'), { ...ok, adReady: false }), false, 'never without an ad to offer');
  assert.equal(pressureDue(near('near'), { ...ok, damage: 500 }), false, 'not far from the best');
  assert.equal(pressureDue(near('near'), { ...ok, bestDamage: 0 }), false, 'no best yet');
  const fresh1 = fresh().st;
  fresh1.pressureArm = 'near';
  assert.equal(pressureDue(fresh1, ok), false, 'not in the first runs');
  const rough = near('near');
  for (let i = 0; i < PACE.rough; i++) runEnded(rough, { won: false, runSec: 30 });
  assert.equal(pressureDue(rough, ok), false, 'not on a losing streak');
  const ids = new Set();
  for (let c = 1; c < 200; c++) ids.add(paceState({ created: c * 7919 }, 0).pressureArm);
  assert.deepEqual([...ids].sort(), PRESSURE_ARMS.map((a) => a.id).sort());
});
