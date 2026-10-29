// When an ad break fits, and when a revive is on the house. Modelled on what a teardown of Block
// Blast's client reported (value-aware pacing, offers at high-value moments, extra generosity for
// players who look likely to drift away, server-tuned A/B arms), keeping only the parts that cost
// the player nothing. It never changes difficulty, never decides who loses, and never makes a
// loss more likely because an ad would pay well. CrazyGames' rules sit underneath all of it: its
// SDK enforces a 3-minute gap between ad breaks, no ad break follows a rewarded-revive offer at the
// same break, and nothing here can show an ad on its own.
//
// Everything is kept in the save under `adPace`, per player. The A/B arm and the counters stay in
// this browser: CrazyGames' SDK has no channel for custom metrics, so comparing arms across players
// needs a server of our own (see the ad-research report).

import { AD_PRESSURE } from './config.js';

const PACE_DAY = 86400000;

// Pacing arms: minutes between ad breaks and minutes of play before the first one in a session.
// (Block Blast's bandit tried never / 4 / 6 / 10 / ~17 / 30 minutes; CrazyGames' floor is 3.)
export const PACE_ARMS = [
  { id: 'a', gapMin: 3, firstMin: 3 },
  { id: 'b', gapMin: 4, firstMin: 4 },
  { id: 'c', gapMin: 6, firstMin: 5 },
];

// Ad-pressure arms: how close to their best damage a player's run must get before the surge
// (null: never, the control group). Block Blast's equivalent tested when its unwinnable hand could
// appear, with a "never" arm to compare against.
export const PRESSURE_ARMS = [
  { id: 'never', near: null },
  { id: 'near', near: 0.85 },
  { id: 'past', near: 1 },
];

export const PACE = {
  minPlaySinceAd: 90, // seconds of actual play between ad breaks, however long the menus took
  shortRun: 40, // a run shorter than this never ends on an ad break: the player wants straight back in
  justWatched: 60, // seconds after a rewarded video in which no ad break follows
  newPlayerExtraMin: 2, // the first session ever waits this much longer for its first ad break
  newPlayerRuns: 3, // the first few runs ever get a free revive
  awayDays: 3, // back after this long: no ad on the session's first break, and a free revive
  rough: 3, // this many quick losses in a row: the next knockdown's revive is free
  quickLoss: 150, // seconds; a run lost sooner than this counts towards a rough patch
  nearBest: 0.8, // knocked down at 80%+ of your best damage: the revive offer says how close you are
  reviveGapMin: 5, // minutes between ad-revive offers (CrazyGames: not every time a player loses a life)
};

const dayOf = (t) => Math.floor(t / PACE_DAY);

function paceHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The pacing state inside a save, created on first use. `arm` can be forced (?adarm=b) for testing.
export function paceState(save, now = Date.now(), arm = null) {
  if (!save.adPace) {
    const pick = PACE_ARMS[paceHash(String(save.created || now)) % PACE_ARMS.length].id;
    save.adPace = {
      arm: pick, sessions: 0, lastDay: null, lastAdAt: 0, lastRewardedAt: 0, rough: 0, runs: 0,
      stats: { sessions: 0, runs: 0, nextDay: 0, breaks: 0, skipped: {}, reviveOffers: 0, reviveAd: 0, reviveGift: 0, reviveGems: 0, reviveDeclined: 0, rewarded: 0 },
    };
  }
  const st = save.adPace;
  if (!st.pressureArm) st.pressureArm = PRESSURE_ARMS[paceHash(`p${save.created || now}`) % PRESSURE_ARMS.length].id;
  st.stats.pressure ||= { surges: 0, knockdowns: 0, adRevives: 0 };
  if (arm && PACE_ARMS.some((a) => a.id === arm)) st.arm = arm;
  return st;
}

export const armOf = (st) => PACE_ARMS.find((a) => a.id === st.arm) || PACE_ARMS[0];

// Once per page load.
export function startSession(st, now = Date.now()) {
  const day = dayOf(now);
  st.welcome = st.lastDay !== null && day - st.lastDay >= PACE.awayDays;
  if (st.lastDay !== null && day - st.lastDay === 1) st.stats.nextDay++;
  st.lastDay = day;
  st.sessions++;
  st.stats.sessions++;
  st.first = st.sessions === 1;
  st.play = 0; // seconds played this session
  st.playSinceAd = 0;
  st.welcomeSkipped = false;
  st.giftUsed = false;
}

// Seconds of actual play (a run on screen, not paused, no ad or newspaper up).
export function tickPlay(st, dt) {
  st.play = (st.play || 0) + dt;
  st.playSinceAd = (st.playSinceAd || 0) + dt;
}

// Whether the break at the end of a run should be an ad break, and if not, why not.
export function breakDecision(st, { now = Date.now(), runSec = 0, reviveOffered = false } = {}) {
  const arm = armOf(st);
  let why = null;
  if (reviveOffered) why = 'revive-offer'; // CrazyGames: never an ad break and a rewarded continue at one break
  else if (runSec < PACE.shortRun) why = 'short-run';
  else if (st.play < (arm.firstMin + (st.first ? PACE.newPlayerExtraMin : 0)) * 60) why = 'warm-up';
  else if (st.lastAdAt && now - st.lastAdAt < arm.gapMin * 60000) why = 'gap';
  else if (st.playSinceAd < PACE.minPlaySinceAd) why = 'too-little-play';
  else if (st.lastRewardedAt && now - st.lastRewardedAt < PACE.justWatched * 1000) why = 'just-watched';
  else if (st.welcome && !st.welcomeSkipped) {
    st.welcomeSkipped = true;
    why = 'welcome-back';
  }
  if (why) st.stats.skipped[why] = (st.stats.skipped[why] || 0) + 1;
  return { show: !why, why };
}

// An ad actually played to the end ('midgame' or 'rewarded').
export function adShown(st, kind, now = Date.now()) {
  if (kind === 'midgame') {
    st.lastAdAt = now;
    st.playSinceAd = 0;
    st.stats.breaks++;
  } else {
    st.lastRewardedAt = now;
    st.stats.rewarded++;
  }
}

// How the revive offer should look for this knockdown: free ("on the house") for players who look
// likely to drift away, whether an ad revive may be offered (not on every knockdown), and how close
// the run is to the player's best, to say so honestly.
export function reviveOffer(st, { damage = 0, bestDamage = 0, now = Date.now() } = {}) {
  st.stats.reviveOffers++;
  let gift = null;
  if (!st.giftUsed) {
    if (st.runs < PACE.newPlayerRuns) gift = 'new';
    else if (st.welcome) gift = 'welcome';
    else if (st.rough >= PACE.rough) gift = 'rough';
  }
  const near = bestDamage > 0 && damage >= bestDamage * PACE.nearBest ? damage / bestDamage : 0;
  const ad = !st.lastReviveAdAt || now - st.lastReviveAdAt >= PACE.reviveGapMin * 60000;
  return { gift, ad, near, damage, bestDamage };
}

export const pressureArmOf = (st) => PRESSURE_ARMS.find((a) => a.id === st.pressureArm) || PRESSURE_ARMS[0];

// Whether this run should get its ad-pressure surge now: ads can be watched and an ad revive could
// be offered, the player is past their first runs (and not on a welcome-back session or a losing
// streak), and the run's damage has reached their arm's share of their best.
export function pressureDue(st, { damage = 0, bestDamage = 0, adReady = false, now = Date.now() } = {}) {
  const arm = pressureArmOf(st);
  if (!AD_PRESSURE.enabled || arm.near === null || !adReady) return false;
  if (st.runs < AD_PRESSURE.minRuns || st.welcome || st.rough >= PACE.rough) return false;
  if (st.lastReviveAdAt && now - st.lastReviveAdAt < PACE.reviveGapMin * 60000) return false;
  return bestDamage > 0 && damage >= bestDamage * arm.near;
}

export function pressureStarted(st) {
  st.stats.pressure.surges++;
}

// An ad revive was actually offered (its button shown).
export function markReviveAd(st, now = Date.now()) {
  st.lastReviveAdAt = now;
}

export function reviveTaken(st, how, { pressured = false } = {}) {
  if (pressured) {
    st.stats.pressure.knockdowns++;
    if (how === 'ad') st.stats.pressure.adRevives++;
  }
  if (how === 'gift') {
    st.giftUsed = true;
    st.stats.reviveGift++;
  } else if (how === 'ad') st.stats.reviveAd++;
  else if (how === 'gems') st.stats.reviveGems++;
  else if (how === 'quit') st.stats.reviveDeclined++;
}

export function runEnded(st, { won = false, runSec = 0 } = {}) {
  st.runs++;
  st.stats.runs++;
  st.rough = !won && runSec < PACE.quickLoss ? st.rough + 1 : 0;
}

// A readable summary for balancing sessions (window.kaijuRampage.adPace()).
export function paceReport(st) {
  const s = st.stats;
  return {
    arm: armOf(st), sessions: s.sessions, runs: s.runs, runsPerSession: s.sessions ? +(s.runs / s.sessions).toFixed(2) : 0,
    adBreaks: s.breaks, adBreaksPerRun: s.runs ? +(s.breaks / s.runs).toFixed(2) : 0, skipped: { ...s.skipped },
    revive: { offers: s.reviveOffers, ad: s.reviveAd, free: s.reviveGift, gems: s.reviveGems, declined: s.reviveDeclined },
    rewardedVideos: s.rewarded, cameBackNextDay: s.nextDay,
    pressure: { arm: pressureArmOf(st).id, ...s.pressure },
  };
}
