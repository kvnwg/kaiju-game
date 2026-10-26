// A simple autopilot used by tests (and handy for tuning): chases nearby military,
// otherwise walks toward the most valuable thing it can break, steps out of telegraphed
// attacks, and takes the first augment offered.
import { canDamage } from '../src/config.js';
import { AUGMENT_BY_ID, MOVES } from '../src/augments.js';
import { distToSegment } from '../src/game.js';
import { HOSPITAL_TYPES } from '../src/buildings.js';

export function botStep(game) {
  const k = game.kaiju;
  if (game.state === 'picking') {
    // Pick like a sensible player: evolutions, then attack moves until there are a few,
    // then upgrades of what is held; Glass Cannon only as a last resort.
    const moves = MOVES.filter((m) => game.has(m.id)).length;
    const score = (id) => {
      const a = AUGMENT_BY_ID[id];
      if (a.kind === 'evolution') return 10;
      if (a.kind === 'filler') return 0;
      if (id === 'glassCannon') return 0.5;
      if (a.kind === 'move') return game.has(id) ? 3 : moves < 3 ? 4 : 1.5;
      const survival = ['toughness', 'thickHide', 'magneticHide'];
      const offense = ['might', 'area', 'adrenaline', 'rageMode', 'echo', 'bloodlust', 'longLegs'];
      const base = survival.includes(id) ? 3.2 : offense.includes(id) ? 2.4 : 1.4;
      return base + (game.has(id) ? 0.3 : 0);
    };
    const opts = [...game.pick.options].sort((x, y) => score(y) - score(x));
    game.choose(opts[0]);
    return;
  }
  if (game.state === 'altar') {
    game.altarChoose('angel');
    return;
  }
  if (game.state === 'dead') {
    if (!game.revive()) game.giveUp();
    return;
  }
  // Charge out of trouble: through an incoming round, or out of a blast that is about to land.
  if (k.dashCd <= 0) {
    for (const p of game.projectiles) {
      if (p.friendly) continue;
      const dx = k.x - p.x;
      const dy = k.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < k.r * 2.5 + p.r && dx * p.vx + dy * p.vy > 0) {
        game.setInput(-p.vy, p.vx);
        game.tryDash();
        break;
      }
    }
    for (const h of game.hazards) {
      if (h.friendly || h.visualOnly || h.delay - h.t > 0.35) continue;
      if (h.kind === 'circle' && Math.hypot(k.x - h.x, k.y - h.y) < h.r + k.r) {
        game.setInput(k.x - h.x || 1, k.y - h.y);
        game.tryDash();
        break;
      }
      if (h.kind === 'line' && distToSegment(k.x, k.y, h.x1, h.y1, h.x2, h.y2) < h.w / 2 + k.r) {
        const dx = h.x2 - h.x1;
        const dy = h.y2 - h.y1;
        const side = (k.x - h.x1) * -dy + (k.y - h.y1) * dx > 0 ? 1 : -1;
        game.setInput(-dy * side, dx * side);
        game.tryDash();
        break;
      }
    }
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
  // Wedged against something too big to break: sidestep for a moment.
  const bs = game.bot || (game.bot = { x: k.x, y: k.y, t: 0, esc: 0, dir: null });
  bs.t += 1 / 30;
  if (bs.esc > 0) {
    bs.esc -= 1 / 30;
    game.setInput(bs.dir.x, bs.dir.y);
    return;
  }
  if (bs.t > 1.5) {
    const moved = Math.hypot(k.x - bs.x, k.y - bs.y);
    if (moved < k.r * 0.5 && (game.input.x || game.input.y)) {
      const side = Math.sin(game.time * 7.3) > 0 ? 1 : -1;
      bs.dir = { x: -game.input.y * side - game.input.x * 0.3, y: game.input.x * side - game.input.y * 0.3 };
      bs.esc = 1.2;
    }
    bs.x = k.x;
    bs.y = k.y;
    bs.t = 0;
  }
  const b = game.boss;
  if (b && !b.dead && b.state !== 'enter') {
    const d = Math.hypot(b.x - k.x, b.y - k.y);
    if (d > b.r + k.r * 1.4) game.setInput(b.x - k.x, b.y - k.y);
    else game.setInput(-(b.y - k.y), b.x - k.x); // circle the boss
    return;
  }
  // Hurt: go smash a hospital, or eat a doctor, if one is in sight.
  if (k.hp < k.maxHp * 0.6) {
    let heal = null;
    let healD = game.viewSpan() * (k.hp < k.maxHp * 0.35 ? 1.2 : 0.7);
    for (const p of game.people) {
      if (p.variant !== 8 || p.taken) continue;
      const d = Math.hypot(p.x - k.x, p.y - k.y);
      if (d < healD) {
        heal = p;
        healD = d;
      }
    }
    for (const o of game.objectsNear(k.x, k.y, healD)) {
      if (!HOSPITAL_TYPES.has(o.type) || o.state !== 'intact' || !canDamage(o.tier, k.stage, o.landmark)) continue;
      const d = Math.hypot(o.x - k.x, o.y - k.y);
      if (d < healD) {
        heal = o;
        healD = d;
      }
    }
    if (heal) {
      game.setInput(heal.x - k.x, heal.y - k.y);
      return;
    }
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
  // Small kaiju hunt people and cars before buildings are worth it.
  const prey = [];
  if (k.stage === 1) prey.push(...game.people.filter((p) => !p.taken));
  if (k.stage <= 2) prey.push(...game.traffic.filter((c) => !c.dead));
  let best0 = null;
  let bestD0 = game.viewSpan() * 0.6;
  for (const p of prey) {
    const d = Math.hypot(p.x - k.x, p.y - k.y);
    if (d < bestD0) {
      best0 = p;
      bestD0 = d;
    }
  }
  if (best0) {
    game.setInput(best0.x - k.x, best0.y - k.y);
    return;
  }
  const reach = Math.max(60, game.viewSpan() * 0.7);
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
  else if (game.prey) game.setInput(game.prey.x - k.x, game.prey.y - k.y);
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
