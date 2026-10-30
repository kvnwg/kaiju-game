// Films the preview video's shots from the game itself, at the High graphics setting with the HUD
// hidden, one frame at a time on a manual clock (60 steps a game second, so slow motion has real
// frames to show). Each shot is staged: a size, a district, a set of moves, sometimes a camera of
// its own and a few buildings timed to fall. tools/trailer-edit.py cuts the result together.
//
//   node tools/trailer.mjs <out dir> <width> <height> [shot,shot,...]
//
// Needs Playwright with Chromium (PLAYWRIGHT=/path/to/playwright/index.mjs if it isn't installed
// in this project). Writes <out dir>/<shot>/f0000.jpg and on.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [outDir, W = '1920', H = '1080', only = ''] = process.argv.slice(2);
if (!outDir) throw new Error('usage: node tools/trailer.mjs <out dir> <width> <height> [shots]');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

// ---------------------------------------------------------------- the shots
// stage: the kaiju's size; where: a district to stand in; moves: [id, level]; frames: how many to
// keep (at 60 a second); warm: frames to run first; rig: a camera of its own (null: the game's);
// drive: how the kaiju moves; events: what happens on which kept frame (negative: during warm-up);
// cued: the moves only fire on those events.
const SHOTS = {
  hatch: { stage: 1, where: 'spawn', moves: [['clawStrike', 3]], frames: 110, warm: 150, drive: 'prey', seed: 11,
    rig: { yaw: 0.2, pitch: 0.72, dist: 0.36, lookUp: 0.6, spin: 0.05 } },
  prowl: { stage: 2, where: 'neon', road: true, moves: [['carToss', 5]], frames: 100, warm: 120, drive: 'slow', speed: 0.8, seed: 11,
    rig: { yaw: -0.5, pitch: 0.6, dist: 0.45, spin: 0.05 }, events: [[6, 'cast', 'carToss'], [40, 'cast', 'carToss']] },
  brute: { stage: 3, where: 'suburb', moves: [['seismicSlam', 4], ['tailSpin', 3]], frames: 110, warm: 150, drive: 'prey', seed: 5,
    rig: { yaw: 0.4, pitch: 0.62, dist: 0.38, spin: 0.06 }, events: [[20, 'cast', 'seismicSlam']] },
  titan: { stage: 4, where: 'brick', moves: [['tailSpin', 5], ['spineMissiles', 4], ['clawStrike', 4]], frames: 120, warm: 180, drive: 'prey', seed: 5,
    events: [[10, 'topple', 2, 1.6, 8], [25, 'cast', 'tailSpin']], rig: { yaw: 0.9, pitch: 0.55, dist: 0.32, spin: 0.08, lookUp: 0.6 } },
  towerfall: { stage: 5, where: 'neon', moves: [], frames: 110, warm: 180, drive: 'still', seed: 7, dusk: 0.3,
    rig: { focus: 'tower', yaw: 0.55, pitch: 0.28, dist: 1.7, lookUp: 0.45, push: -0.1 }, events: [[16, 'fell']] },
  laser: { stage: 5, where: 'neon', moves: [['laserEyes', 5], ['spineMissiles', 4], ['tailSpin', 4]], frames: 110, warm: 100, drive: 'prey', seed: 7,
    events: [[5, 'cast', 'laserEyes'], [12, 'topple', 4, 2.2, 6]] },
  boss: { stage: 4, where: 'brick', moves: [['clawStrike', 5], ['spineMissiles', 4], ['laserEyes', 3]], frames: 110, warm: 200, drive: 'boss', seed: 9, boss: true },
  breath: { stage: 6, where: 'neon', moves: [['atomicBreath', 5], ['tailSpin', 4]], frames: 130, warm: 180, drive: 'slow', seed: 7, dusk: 0.62,
    rig: { yaw: -1.1, pitch: 0.38, dist: 0.22, spin: 0.15, lookUp: 0.9 }, events: [[6, 'cast', 'atomicBreath'], [20, 'topple', 6, 3, 5]] },
  meteor: { stage: 6, where: 'neon', moves: [['meteorCall', 5], ['atomicBreath', 3]], frames: 150, warm: 150, drive: 'slow', seed: 3, dusk: 0.6,
    rig: { yaw: 0.8, pitch: 0.7, dist: 0.32, spin: 0.1 },
    events: [[-50, 'cast', 'meteorCall'], [30, 'cast', 'meteorCall'], [20, 'topple', 5, 3.5, 7]] },
  finale: { stage: 6, where: 'neon', moves: [['roar', 5], ['tailSpin', 4]], frames: 150, warm: 180, drive: 'still', seed: 7, dusk: 0.62,
    rig: { yaw: 0.35, pitch: 0.22, dist: 0.2, spin: 0.08, push: -0.12, lookUp: 1.2, fov: 40 }, events: [[10, 'cast', 'roar'], [14, 'topple', 7, 2.4, 9]] },
};

// ---------------------------------------------------------------- in the page
// Sets the shot up: called once the run has started. Everything here runs inside the game's page.
function stage(shot) {
  const K = window.kaijuRampage;
  const g = K.game;
  const R = K.renderer;
  const k = g.kaiju;
  R.autoQuality = false;
  while (g.state === 'picking' || g.state === 'altar') {
    if (g.state === 'altar') g.altarChoose('angel');
    else g.choose(g.pick.options[0]);
  }
  if (shot.stage > 1) g.debugJump(shot.stage);
  k.r = g.stage.radius; // full size now, not easing up to it
  g.drainEvents();
  g.state = 'playing';
  g.held.clear();
  for (const [id, lv] of shot.moves) g.held.set(id, lv);
  k.level = 4 + shot.stage * 4;
  g.scheduled = [];
  g.bossTimer = null;
  g.slowmo = 0;
  g.blackoutT = 0;
  // The light: golden afternoon while it is small, sunset once it towers over the city.
  const dusk = shot.dusk ?? [0, 0.1, 0.12, 0.16, 0.3, 0.42, 0.5][shot.stage];
  Object.defineProperty(g, 'dusk', { get: () => dusk, configurable: true });
  window.__T.cfg.LIMITS.collapsing = 14;
  // Somewhere that fits the shot: the nearest block of the district, near its busy middle.
  if (shot.where !== 'spawn') {
    let best = null;
    for (let R2 = 1; R2 < 40 && !best; R2++) for (let r = -R2; r <= R2; r++) for (let c = -R2; c <= R2; c++) {
      if (Math.max(Math.abs(c), Math.abs(r)) !== R2) continue;
      const z = g.city.zoneFor(c, r);
      const dense = shot.where === 'neon' || shot.where === 'brick' ? z.density > (shot.road ? 0.35 : 0.55) : true;
      // A street shot needs a street, and not one under the elevated metro.
      if (shot.road && (g.city.isMetroRow(r) || g.city.isMetroRow(r + 1) || !g.city.edge(c, r, true) || !g.city.edge(c + 1, r, true))) continue;
      if (z.style === shot.where && dense && (!best || Math.hypot(c, r) < best.d)) best = { c, r, d: Math.hypot(c, r) };
    }
    if (best) {
      k.x = best.c * g.city.cell + 30;
      k.y = best.r * g.city.cell + 30 + (shot.stage >= 5 ? 0 : 60);
      // Or down the middle of the street along the block's top edge, heading east into traffic.
      if (shot.road) {
        k.x = best.c * g.city.cell + 40;
        k.y = best.r * g.city.cell;
        k.facing = { x: 1, y: 0 };
      }
    }
    g.streamWorld(true);
    g.populate && g.populate(true);
  }
  // A tower shot: the tallest skyscraper about, with the kaiju standing a couple of its widths off.
  if (shot.rig && shot.rig.focus === 'tower') {
    let tall = null;
    for (const o of g.city.objects) {
      if (o.kind !== 'building' || o.state !== 'intact' || o.tier < 5 || o.landmark || Math.hypot(o.x - k.x, o.y - k.y) > 1600) continue;
      if (!tall || o.height > tall.height) tall = o;
    }
    if (tall) {
      const R0 = g.stage.radius;
      k.x = tall.x - R0 * 2.3;
      k.y = tall.y + R0 * 0.6;
      g.streamWorld(true);
      window.__T.tower = tall;
    }
  }
  if (shot.boss) {
    g.gateCleared[shot.stage] = false;
    g.spawnGateBoss();
  }
  // No damage taken (and no blinking from being invulnerable): the kaiju just never runs low.
  const upd = g.update.bind(g);
  const T = window.__T;
  g.update = (dt) => {
    const prey = shot.drive === 'boss' && g.boss ? g.boss : g.prey;
    if (shot.drive === 'still') g.input = { x: 0, y: 0 };
    else if (shot.drive === 'slow') g.input = { x: Math.cos(T.heading) * (shot.speed || 0.35), y: Math.sin(T.heading) * (shot.speed || 0.35) };
    else if (prey && Math.hypot(prey.x - k.x, prey.y - k.y) > k.r * (shot.drive === 'boss' ? 4 : 1.6)) {
      const d = Math.hypot(prey.x - k.x, prey.y - k.y);
      g.input = { x: (prey.x - k.x) / d, y: (prey.y - k.y) / d };
    } else g.input = { x: Math.cos(g.time * 0.6), y: Math.sin(g.time * 0.6) };
    k.hp = Math.max(k.hp, k.maxHp * 0.9);
    k.biomass = Math.min(k.biomass, g.stage.biomassToNext * 0.5);
    g.pendingPicks = 0;
    g.diff = { ...g.diff, enemyDmg: 0 };
    // cued: moves only go off on the shot's own events, never on their own.
    if (shot.cued) for (const [id] of shot.moves) g.moves.timers[id] = 1e9;
    upd(dt);
    while (g.state === 'picking' || g.state === 'altar') {
      if (g.state === 'altar') g.altarChoose('angel');
      else g.choose(g.pick.options[0]);
    }
    if (g.state !== 'playing' && g.state !== 'won') g.state = 'playing';
  };
  T.heading = Math.atan2(k.facing.y, k.facing.x);
  if (R.tilt) R.tilt.enabled = !shot.rig;
  // No game markers over the picture: hospital crosses and the vault beacon.
  R.updateHospitalMarks = function hide() { if (this.hospitalMarks) for (const m of this.hospitalMarks.values()) m.visible = false; };
  R.updateVaultMark = function hide() { if (this.vaultMark) this.vaultMark.visible = false; };
  g.vault = null;
  if (shot.rig) {
    // Wide views need more of the city drawn than the game's own camera does.
    const span = g.viewSpan.bind(g);
    g.viewSpan = (r) => span(r) * 1.3;
    T.rig(shot.rig);
  }
}

// Helpers in the page: the camera rigs and the timed events.
function helpers() {
  const K = window.kaijuRampage;
  const T = { t: 0, frame: -1e9, events: [] };
  window.__T = T;
  const ease = (x) => x * x * (3 - 2 * x);
  // Cinematic versions of the game's own camera: the same look and level of detail, but turned
  // (yaw), lowered (pitch), pulled in (dist, a share of the game's distance), slowly orbiting
  // (spin) or pushing in (push). focus: 'tower' frames a tower in front of the kaiju from the far
  // side, for it to fall toward the camera.
  T.rig = (rig) => {
    const R = K.renderer;
    const g = K.game;
    const k = g.kaiju;
    if (rig.focus === 'tower' && !T.tower) {
      let best = null;
      for (const o of g.city.objects) {
        if (o.kind !== 'building' || o.state !== 'intact' || o.tier < 4 || o.landmark) continue;
        const d = Math.hypot(o.x - k.x, o.y - k.y);
        if (d < g.stage.radius * 1.4 || d > g.stage.radius * 5) continue;
        const score = o.height - d * 0.1;
        if (!best || score > best.score) best = { o, score };
      }
      T.tower = best && best.o;
    }
    if (rig.focus === 'tower') {
      const ux = T.tower ? T.tower.x - k.x : k.facing.x;
      const uy = T.tower ? T.tower.y - k.y : k.facing.y;
      const ul = Math.hypot(ux, uy) || 1;
      T.fallDir = { x: ux / ul, y: uy / ul };
      // Face the kaiju toward the tower.
      k.facing = { x: T.fallDir.x, y: T.fallDir.y };
    }
    R.cameraRig = (cam, game, R2) => {
      const p = ease(Math.min(1, Math.max(0, T.t / 2)));
      let fx = k.x;
      let fy = k.y;
      let fh = g.stage.radius * (rig.lookUp ?? 0.7);
      // The game's distance for this size (not its eased value, which is still settling).
      let base = R2.distFor(game.viewSpan(game.stage.radius));
      let yaw = 0.62 + (rig.yaw || 0) + T.t * (rig.spin || 0);
      if (rig.focus === 'tower' && T.tower) {
        const tw = T.tower;
        fx = k.x + (tw.x - k.x) * 0.6;
        fy = k.y + (tw.y - k.y) * 0.6;
        fh = tw.height * (rig.lookUp ?? 0.5);
        base = tw.height;
        yaw = Math.atan2(T.fallDir.x, T.fallDir.y) + (rig.yaw || 0) + T.t * (rig.spin || 0);
      }
      const pitch = rig.pitch ?? 0.5;
      const d = base * rig.dist * (1 + (rig.push || 0) * p);
      cam.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * d, fh + Math.sin(pitch) * d, fy + Math.cos(yaw) * Math.cos(pitch) * d);
      T.camDir = { x: Math.sin(yaw), y: Math.cos(yaw) };
      cam.lookAt(fx, fh, fy);
      cam.fov = rig.fov || 38;
      cam.near = Math.max(1, d * 0.08);
      cam.far = d * 7;
      cam.updateProjectionMatrix();
      R2.scene.fog.near = d * 1.1;
      R2.scene.fog.far = d * 4.5;
    };
  };
  // A kept frame's events: cast a move, drop the filmed tower, or topple n buildings near the kaiju
  // (within `reach` of its size), one every `gap` frames, each away from it.
  T.run = (ev) => {
    const g = K.game;
    const k = g.kaiju;
    if (ev[1] === 'cast') g.moves.cast(ev[2]);
    else if (ev[1] === 'fell' && T.tower) g.destroyObject(T.tower, T.fallDir, 'hit');
    else if (ev[1] === 'topple') {
      const [, , n, reach, gap] = ev;
      const near = g.city.objects
        .filter((o) => {
          if (o.kind !== 'building' || o.state !== 'intact' || o.landmark || o.tier < Math.max(3, k.stage - 2)) return false;
          const d = Math.hypot(o.x - k.x, o.y - k.y);
          if (d > g.stage.radius * reach || d < 1) return false;
          // On the camera's side of the kaiju, where the fall is seen (with a camera of the shot's own).
          return !T.camDir || ((o.x - k.x) * T.camDir.x + (o.y - k.y) * T.camDir.y) / d > -0.1;
        })
        .sort((a, b) => b.height - a.height)
        .slice(0, n);
      near.forEach((o, i) => T.events.push([T.frame + 1 + i * gap, 'drop', o]));
    } else if (ev[1] === 'drop' && ev[2].state === 'intact') {
      const o = ev[2];
      const d = Math.hypot(o.x - k.x, o.y - k.y) || 1;
      g.destroyObject(o, { x: (o.x - k.x) / d, y: (o.y - k.y) / d }, 'hit');
    }
  };
}

// ---------------------------------------------------------------- the recording
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path = join(path, 'index.html');
    if (!path.startsWith(root)) throw new Error('outside');
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const names = only ? only.split(',') : Object.keys(SHOTS);
for (const name of names) {
  const shot = { name, ...SHOTS[name] };
  const dir = join(outDir, name);
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // Our own clock: once manual, frames (and performance.now) only move when we step them.
  await page.addInitScript(() => {
    const realRaf = window.requestAnimationFrame.bind(window);
    const realNow = performance.now.bind(performance);
    window.__manual = false;
    window.__q = [];
    window.__t = 0;
    window.requestAnimationFrame = (cb) => (window.__manual ? (window.__q.push(cb), 1) : realRaf(cb));
    performance.now = () => (window.__manual ? window.__t : realNow());
    window.__go = () => { window.__t = realNow(); window.__manual = true; };
    window.__step = (ms) => {
      const T = window.__T;
      T.frame++;
      T.t = T.frame / 60;
      for (const ev of T.events.filter((e) => e[0] === T.frame)) T.run(ev);
      const q = window.__q;
      window.__q = [];
      window.__t += ms;
      for (const cb of q) cb(window.__t);
    };
  });
  await page.goto(`http://localhost:${port}/?play&q=high&seed=${shot.seed || 7}`);
  await page.waitForFunction(() => window.kaijuRampage && window.kaijuRampage.game && ['playing', 'picking'].includes(window.kaijuRampage.game.state), null, { timeout: 180000 });
  await page.addStyleTag({ content: '#app > *:not(#game):not(#screenFlash), #warp, #news, #loading { display: none !important; }' });
  await page.evaluate(`(${helpers})()`);
  await page.evaluate(async () => { window.__T.cfg = await import('/src/config.js'); });
  await page.evaluate(`(${stage})(${JSON.stringify(shot)})`);
  console.log(name, 'staged', JSON.stringify(await page.evaluate(() => {
    const g = window.kaijuRampage.game;
    const k = g.kaiju;
    const T = window.__T;
    return { x: Math.round(k.x), y: Math.round(k.y), r: k.r, style: g.city.cellAt(k.x, k.y).style, tower: T.tower ? [T.tower.type, Math.round(T.tower.height)] : null, objects: g.city.objects.length };
  })));
  await page.evaluate((ev) => { window.__T.events.push(...ev); window.__T.frame = -1 - 0; }, shot.events || []);
  await page.evaluate((warm) => { window.__T.frame = -warm - 1; window.__go(); }, shot.warm);
  // Warm up (drawing every frame: the renderer builds the buildings it is missing a few at a
  // time, so the shot opens on a finished city), then keep every frame.
  await page.evaluate((warm) => {
    for (let i = 0; i < warm; i++) window.__step(1000 / 60);
  }, shot.warm);
  const keep = Number(process.env.FRAMES) || shot.frames;
  const every = Number(process.env.EVERY) || 1;
  for (let i = 0; i < keep; i++) {
    await page.evaluate(() => window.__step(1000 / 60));
    if (i % every === 0) await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93, timeout: 300000 });
  }
  const info = await page.evaluate(() => { const g = window.kaijuRampage.game; return { state: g.state, stage: g.kaiju.stage, boss: Boolean(g.boss), collapsing: g.collapsing }; });
  console.log(name, W, H, shot.frames, 'frames', JSON.stringify(info), errs.length ? `errors: ${errs.join(' | ')}` : 'no errors');
  await page.close();
}
await browser.close();
server.close();
