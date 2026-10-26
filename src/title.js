// The title shot. A camera planted among the towers looks out across the skyline at a colossal
// kaiju wrecking the city in the distance. The camera never moves with it: the kaiju is steered
// so it stays in frame, standing to smash whatever is in reach, then lumbering to a fresh spot.
import { FOV, MAX_STAGE, WORLD } from './config.js';
import { isWater } from './world.js';

export const TITLE = {
  r: 220, // the kaiju's radius here: it stands about 530 tall, so the tallest towers reach its hips
  dist: 2500, // from the camera to the kaiju: far enough for the city to stack up in between
  eyeH: [110, 170], // camera heights to try: rooftops about twenty and thirty storeys up
  frameX: 0.22, // where the kaiju stands across a wide screen (-1 left edge, 1 right): clear of the logo
  bite: 1.1, // seconds between bites: one tower at a time, so the city lasts
  gunships: 3, // at most this many in the air at once
};

const WIDE = 16 / 9;

// The camera's vertical field of view for a screen shape. A tall phone screen gets a taller
// view, wide enough across to hold the kaiju head to tail.
export function titleFov(aspect) {
  const across = Math.tan((17 * Math.PI) / 180);
  const tall = Math.tan((FOV * Math.PI) / 360);
  return tall * aspect >= across ? FOV : Math.min(62, (Math.atan(across / aspect) * 360) / Math.PI);
}

// How far the kaiju may roam across the view, either side of its anchor, and stay whole in
// frame (head to tail it is about four radii long), clear of the logo on a wide screen.
export function roamRange(d, aspect) {
  const half = d * Math.tan((titleFov(aspect) * Math.PI) / 360) * aspect; // half the view's width out at the kaiju
  const at = aspect > 1 ? TITLE.frameX : 0;
  const [left, right] = aspect > 1 ? [-0.2, 0.95] : [-0.95, 0.95];
  const body = TITLE.r * 1.8;
  let lo = (left - at) * half + body;
  let hi = (right - at) * half - body;
  if (lo > hi) lo = hi = (lo + hi) / 2;
  return { lo, hi };
}

// Sets up the title's game: downtown among the towers, the kaiju at full size and then some,
// heavy on its feet, with no army after it but a few gunships, and the towers around the camera
// spared. Returns the rampage that steers it.
export function setupTitle(game) {
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
  // Full size at once: growing would flatten the block around it and call in the final boss.
  k.stage = MAX_STAGE;
  k.maxHp = k.hp = game.maxHpFor();
  k.r = TITLE.r;
  k.level = 999;
  game.def = { ...game.def, speedMult: 0.45, attack: { ...game.def.attack, cooldown: TITLE.bite } };
  game.diff = { ...game.diff, enemyDmg: 0 };
  // No squads, jets or city events: the gunships below are the only ones who show up.
  game.director.spawnT = Infinity;
  game.director.jetT = Infinity;
  game.eventT = Infinity;
  game.streamWorld(true);
  const shot = planTitleShot(game);
  // The towers around the camera stay standing: the wreckage stays out by the kaiju.
  game.spare = (o) => Math.hypot(o.x - shot.ax, o.y - shot.ay) > shot.d * 0.55;
  return new TitleRampage(game, shot);
}

// Where the camera stands: about TITLE.dist from the kaiju, on a rooftop in the middle of the
// city (never inside a tower, never over a park or the water), with the kaiju's body in clear
// view over the rooftops and as much skyline around it as possible. Returns the eye (ex, ey, eh),
// the kaiju's anchor (ax, ay), the view direction (ux, uy) and the distance d between them.
export function planTitleShot(game) {
  const k = game.kaiju;
  const blds = game.city.objects.filter((o) => o.kind === 'building' && o.state === 'intact');
  let best = null;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    for (const d of [TITLE.dist * 0.9, TITLE.dist, TITLE.dist * 1.1]) {
      for (const eh of TITLE.eyeH) {
        const shot = { ax: k.x, ay: k.y, ux: Math.cos(a), uy: Math.sin(a), d, eh };
        shot.ex = k.x - shot.ux * d;
        shot.ey = k.y - shot.uy * d;
        shot.score = rateShot(game, blds, shot);
        if (!best || shot.score > best.score) best = shot;
      }
    }
  }
  return best;
}

const OPEN = new Set(['park', 'forest', 'garden', 'water']);
const URBAN = new Set(['neon', 'brick']);

function rateShot(game, blds, s) {
  const { r } = TITLE;
  const eyeH = s.eh;
  const vx = -s.uy; // screen right
  const vy = s.ux;
  const { lo, hi } = roamRange(s.d, WIDE);
  let hidden = 0; // how high the nearer buildings hide the kaiju, wherever it roams
  let skyline = 0;
  let framing = 0;
  let close = 0; // city right in front of the camera
  for (const o of blds) {
    const dx = o.x - s.ex;
    const dy = o.y - s.ey;
    const along = dx * s.ux + dy * s.uy;
    const side = dx * vx + dy * vy;
    const hl = (Math.abs(s.ux) * o.w + Math.abs(s.uy) * o.h) / 2;
    const hw = (Math.abs(vx) * o.w + Math.abs(vy) * o.h) / 2;
    // Never inside, or right against, a tower taller than the camera.
    if (Math.abs(along) < hl + 30 && Math.abs(side) < hw + 30 && o.height > eyeH - 20) return -Infinity;
    const near = along - hl;
    if (near < 40 || Math.abs(side) - hw > near * 0.55) continue; // behind, or out of a wide view
    if (near < s.d - r) {
      // Between the camera and the kaiju: how high up the kaiju does it reach?
      const from = ((side - hw) * s.d) / near;
      const to = ((side + hw) * s.d) / near;
      if (to > lo - r * 1.5 && from < hi + r * 1.5) hidden = Math.max(hidden, eyeH + ((o.height - eyeH) * s.d) / near);
    }
    if (o.height > 40) skyline += Math.min(1, (o.height / near) * 3);
    if (near < 700) close += Math.min(1, (o.height / near) * 2);
    // Towers a little way off at the edges of the view frame the shot.
    if (near > 200 && near < s.d * 0.45 && o.height > eyeH * 1.3 && Math.abs(side) / near > 0.18) framing += Math.min(1, ((o.height - eyeH) / near) * 2);
  }
  if (hidden > r * 0.75) return -Infinity; // more than its legs hidden
  // Parks and water underfoot mean the camera is outside the city looking in; downtown and
  // brick blocks all around mean it is deep in it.
  let open = 0;
  let urban = 0;
  for (const t of [0, 150, 350, 600, 900]) {
    for (const f of [-0.3, 0, 0.3]) {
      const x = s.ex + s.ux * t + vx * t * f;
      const y = s.ey + s.uy * t + vy * t * f;
      const style = game.city.cellAt(x, y).style;
      if (isWater(x, y) || OPEN.has(style)) open++;
      else if (URBAN.has(style)) urban++;
    }
  }
  let water = 0;
  for (let t = 0.05; t < 1; t += 0.1) if (isWater(s.ex + s.ux * s.d * t, s.ey + s.uy * s.d * t)) water++;
  // Best of all, its feet are lost among the buildings while its body towers over them.
  const depth = Math.min(hidden, r * 0.6) / (r * 0.6);
  return skyline + framing * 6 + close * 3 + depth * 25 + urban * 3 - open * 8 - water * 12;
}

// Steers the title's kaiju: stand and smash for a few seconds, then lumber a few steps to a
// fresh spot with towers still standing, never leaving the frame.
export class TitleRampage {
  constructor(game, shot) {
    this.g = game;
    this.shot = shot;
    this.walking = false;
    this.t = 2.5;
    this.goal = null;
    this.gunshipT = 1;
    // For the renderer: where the camera stands and what it frames.
    this.view = { eye: { x: shot.ex, y: shot.eh, z: shot.ey }, focus: { x: shot.ax, y: TITLE.r * 1.1, z: shot.ay }, frameX: TITLE.frameX, fov: titleFov, dusk: 0.92 };
  }

  // Each frame, before the game updates. aspect: the screen's width over its height.
  update(dt, aspect) {
    const g = this.g;
    const k = g.kaiju;
    k.r = TITLE.r;
    k.hp = k.maxHp;
    k.biomass = 0;
    this.t -= dt;
    if (!this.walking && this.t <= 0) {
      this.goal = this.pickGoal(aspect);
      this.walking = true;
      this.t = 5;
    }
    if (this.walking) {
      const dx = this.goal.x - k.x;
      const dy = this.goal.y - k.y;
      const d = Math.hypot(dx, dy);
      if (d < k.r * 0.25 || this.t <= 0) {
        this.walking = false;
        this.t = g.rng.range(3, 6);
      } else g.setInput(dx / d, dy / d);
    }
    if (!this.walking) g.setInput(0, 0);
    // Gunships keep coming at it from either side and beyond, never past the camera, and it
    // keeps swatting them out of the sky.
    this.gunshipT -= dt;
    if (this.gunshipT <= 0) {
      this.gunshipT = g.rng.range(3, 6);
      if (g.units.filter((u) => !u.dead).length < TITLE.gunships) {
        const s = this.shot;
        const side = (g.rng.chance(0.5) ? 1 : -1) * g.rng.range(900, 1300);
        const ahead = g.rng.range(-200, 900);
        g.spawnGroup('heli', { x: s.ax - s.uy * side + s.ux * ahead, y: s.ay + s.ux * side + s.uy * ahead }, 1);
      }
    }
  }

  // A spot in frame with as much building still standing around it as possible.
  pickGoal(aspect) {
    const g = this.g;
    const s = this.shot;
    const { r } = TITLE;
    const { lo, hi } = roamRange(s.d, aspect);
    let best = null;
    for (let i = 0; i < 8; i++) {
      const side = g.rng.range(lo, hi);
      const depth = g.rng.range(-r * 1.2, r * 0.8);
      const x = s.ax - s.uy * side + s.ux * depth;
      const y = s.ay + s.ux * side + s.uy * depth;
      if (isWater(x, y)) continue;
      let mass = 0;
      for (const o of g.objectsNear(x, y, r * 1.8)) if (o.kind === 'building') mass += o.height * o.w * o.h;
      if (!best || mass > best.mass) best = { x, y, mass };
    }
    return best || { x: s.ax, y: s.ay };
  }
}
