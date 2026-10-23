// A simple autopilot used by tests (and handy for tuning): chases nearby military,
// otherwise walks toward the most valuable thing it can break, steps out of telegraphed
// attacks, and takes the first augment offered.
import { canDamage } from '../src/config.js';
import { distToSegment } from '../src/game.js';

export function botStep(game) {
  const k = game.kaiju;
  if (game.state === 'picking') {
    game.choose(game.pick.options[0]);
    return;
  }
  if (game.state === 'dead') {
    if (!game.revive()) game.giveUp();
    return;
  }
  for (const h of game.hazards) {
    if (h.friendly) continue;
    if (h.kind === 'circle' && Math.hypot(k.x - h.x, k.y - h.y) < h.r + k.r) {
      game.setInput(k.x - h.x || 1, k.y - h.y);
      return;
    }
    if (h.kind === 'line' && distToSegment(k.x, k.y, h.x1, h.y1, h.x2, h.y2) < h.w / 2 + k.r) {
      // Step sideways out of the line.
      const dx = h.x2 - h.x1;
      const dy = h.y2 - h.y1;
      const side = (k.x - h.x1) * -dy + (k.y - h.y1) * dx > 0 ? 1 : -1;
      game.setInput(-dy * side, dx * side);
      return;
    }
  }
  const b = game.boss;
  if (b && !b.dead && b.state !== 'enter') {
    const d = Math.hypot(b.x - k.x, b.y - k.y);
    if (d > b.r + k.r * 1.4) game.setInput(b.x - k.x, b.y - k.y);
    else game.setInput(-(b.y - k.y), b.x - k.x); // circle the boss
    return;
  }
  let chase = null;
  let chaseD = game.viewSpan() * 0.35;
  for (const u of game.units) {
    if (u.dead || u.type === 'jet') continue;
    const d = Math.hypot(u.x - k.x, u.y - k.y);
    if (d < chaseD) {
      chase = u;
      chaseD = d;
    }
  }
  if (chase) {
    game.setInput(chase.x - k.x, chase.y - k.y);
    return;
  }
  const reach = Math.max(600, game.viewSpan() * 0.7);
  let best = null;
  let bestScore = -Infinity;
  for (const o of game.objectsNear(k.x, k.y, reach)) {
    if (!canDamage(o.tier, k.stage, o.landmark) || o.tier < k.stage) continue;
    const d = Math.hypot(o.x - k.x, o.y - k.y);
    const score = Math.pow(4, o.tier) / (o.tier > k.stage ? 4 : 1) - d / (k.r * 2);
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  if (best) game.setInput(best.x - k.x, best.y - k.y);
  else game.setInput(-1, Math.sin(game.time));
}

export function simulate(game, { maxTime = 900, dt = 1 / 30, onTick } = {}) {
  while (game.state !== 'won' && game.state !== 'lost' && game.time < maxTime) {
    botStep(game);
    game.update(dt);
    game.drainEvents();
    if (onTick) onTick(game);
  }
  return game;
}
