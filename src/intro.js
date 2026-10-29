// The very first thing a new player does: a few seconds as the full-grown kaiju, wading through
// downtown with its best moves going off, before "every kaiju starts small" shrinks it down and
// the real first run begins in a backyard. It shows where the game goes before asking anyone to
// start at the bottom.
import { STAGES, MAX_STAGE, WORLD, FIRST_RUN } from './config.js';

// Moves the giant shows off, at these levels.
export const INTRO_MOVES = [['laserEyes', 3], ['seismicSlam', 3], ['tailSpin', 2], ['atomicBreath', 2]];
export const INTRO_SHRINK = 1.5; // seconds of shrinking before the cut to the backyard

// Downtown, full size, untouchable, its best moves held; no level-ups, bosses or city events.
export function setupIntro(game) {
  const k = game.kaiju;
  let best = null;
  for (let r = -12; r <= 12; r++) {
    for (let c = -12; c <= 12; c++) {
      const z = game.city.zoneFor(c, r);
      if (z.style === 'neon' && z.density > 0.6 && (!best || c * c + r * r < best.d)) best = { c, r, d: c * c + r * r };
    }
  }
  if (best) {
    k.x = (best.c + 0.5) * WORLD.cell;
    k.y = (best.r + 0.5) * WORLD.cell;
  }
  k.stage = MAX_STAGE;
  k.r = STAGES[MAX_STAGE].radius;
  k.maxHp = k.hp = game.maxHpFor();
  k.level = 999;
  k.invuln = 1e9;
  for (const [id, level] of INTRO_MOVES) game.held.set(id, level);
  game.diff = { ...game.diff, enemyDmg: 0 };
  game.bossTimer = null;
  game.eventT = Infinity;
  game.director.spawnT = 1.5;
  // Golden hour over the skyline, whatever this size would normally get.
  Object.defineProperty(game, 'dusk', { value: 0.38 });
  // A closer camera than this size normally gets, so the kaiju fills the screen and feels huge;
  // and no hospital pop-ups (it can't be hurt here anyway).
  game.viewSpan = (radius = STAGES[k.stage].radius) => 40 + radius * 9;
  game.bigHeal = () => {};
  game.streamWorld(true);
}

// Where the intro is: 'play' for FIRST_RUN.intro seconds, then 'shrink', then 'done'.
export function introPhase(t) {
  if (t < FIRST_RUN.intro) return 'play';
  if (t < FIRST_RUN.intro + INTRO_SHRINK) return 'shrink';
  return 'done';
}

// The kaiju's radius while it shrinks: from full size down to a sixth of it, quickly at first.
export function shrinkRadius(t) {
  const f = Math.min(1, Math.max(0, (t - FIRST_RUN.intro) / INTRO_SHRINK));
  const full = STAGES[MAX_STAGE].radius;
  return full * (1 - (5 / 6) * (1 - (1 - f) * (1 - f)));
}
