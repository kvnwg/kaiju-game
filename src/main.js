import { Game } from './game.js';
import { Renderer3D } from './render3d.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadProfile, saveProfile, recordRun } from './storage.js';
import { KAIJU } from './config.js';
import { Sfx, Music } from './audio.js';

const canvas = document.getElementById('game');
const input = new Input(canvas, document.getElementById('stick'));
const ui = new UI();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const loading = document.getElementById('loading');

let profile = loadProfile();
const sfx = new Sfx();
sfx.setMuted(profile.sound === false);
const music = new Music(sfx);
music.setEnabled(profile.music !== false);

// How hard the soundtrack should hit right now: menu 0, then by size and threat, bosses 4.
function musicState() {
  const inRun = game && !ui.hud.classList.contains('hidden');
  if (!inRun) return { level: 0, bpm: 128 };
  if (game.state === 'won' || game.state === 'lost') return { level: -1, bpm: 128 };
  if (game.state === 'dead') return { level: 0, bpm: 120 };
  const k = game.kaiju;
  const boss = Boolean(game.boss && !game.boss.dead) || game.gateTimer !== null || game.bossTimer !== null;
  let level = k.stage <= 1 ? 1 : k.stage <= 3 ? 2 : 3;
  if (game.threat > 60) level++;
  if (boss) level = 4;
  return { level: Math.min(4, level), boss, bpm: (boss ? 164 : 140 + k.stage * 3), paused: paused || game.state === 'picking' };
}
// Audio can only start from a user gesture; any tap or key unlocks (and resumes) it.
for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'click', 'keydown', 'touchstart', 'touchend']) window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
let renderer = null;
let game = null;
let paused = false;
let lastSettings = { kaijuId: 'rex', difficulty: 'normal' };
let hintUntil = 0;
let movedFor = 0;
let pendingGrowBanner = null;

function defaultQuality() {
  const saved = profile.quality;
  if (saved) return saved;
  const mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return params.get('q') || (mobile ? 'medium' : 'high');
}

function startRun({ kaijuId, difficulty, firstRun = false }) {
  lastSettings = { kaijuId, difficulty };
  game = new Game({ kaijuId, difficulty, firstRun, seed: Number(params.get('seed')) || Date.now() });
  renderer.startRun(game);
  paused = false;
  ui.hideModals();
  ui.show('hud');
  ui.augSig = null;
  movedFor = 0;
  pendingGrowBanner = null;
  hintUntil = firstRun || profile.runs < 2 ? performance.now() + 7000 : 0;
  ui.hint(hintUntil ? (window.matchMedia('(pointer: coarse)').matches ? 'Drag to move. You attack on your own. Eat people to grow.' : 'WASD or arrows to move. You attack on your own. Eat people to grow.') : '');
}

function showMenu() {
  // Keep the city on screen behind the menu.
  if (!game || game.state === 'playing') {
    game = new Game({ seed: 1 });
    renderer.startRun(game);
  }
  ui.show('hud', false);
  ui.hint('');
  ui.hideModals();
  ui.showMenu(profile, { onStart: (s) => startRun(s) });
}

const CALLOUTS = ['Smashing!', 'Rampage!', 'Unstoppable!', 'Kaiju-geddon!', 'Extinction event!'];

function handleEvents(events) {
  for (const e of events) {
    sfx.handleEvent(e);
    switch (e.type) {
      case 'comboTier':
        ui.callout(CALLOUTS[Math.min(CALLOUTS.length, e.tier) - 1], e.tier);
        break;
      case 'grow':
        ui.flash(1);
        hintUntil = 0;
        ui.hint('');
        // If a pick is on screen, announce the new size once it closes.
        if (game.state === 'picking') pendingGrowBanner = e.stage;
        else ui.growBanner(e.stage);
        break;
      case 'levelUp':
        ui.levelUp(e.level);
        break;
      case 'pick':
        if (game.state !== 'picking') break;
        hintUntil = 0;
        ui.hint('');
        ui.showPick(game, { onChoose: (id) => game.choose(id), onReroll: (ad) => game.reroll(ad) });
        break;
      case 'picked':
        ui.show('pick', false);
        if (pendingGrowBanner) ui.growBanner(pendingGrowBanner);
        pendingGrowBanner = null;
        break;
      case 'synergy':
        ui.banner(`Synergy: ${e.set.name}`, e.set.bonus, 'synergy');
        break;
      case 'multikill':
        if (e.tier >= 2) ui.callout(`Multi-kill x${e.n}!`, Math.min(5, e.tier + 1));
        break;
      case 'wave':
        ui.banner('Strike incoming!', 'The military is closing in from all sides', 'warning');
        break;
      case 'elite':
        ui.banner(`Elite: ${e.name}`, 'Take it down for a free level-up', 'warning');
        break;
      case 'eliteDown':
        ui.banner(`${e.name} destroyed`, '+1 level and a pile of scrap', 'synergy');
        break;
      case 'gateWarning':
        ui.banner('Size-up blocked', `${e.name} has been sent to stop you`, 'warning');
        break;
      case 'gateBoss':
        ui.banner(e.name, e.title, 'warning');
        break;
      case 'gateBossDefeated':
        ui.banner(`${e.name} defeated`, e.text, 'grow');
        break;
      case 'bossWarning':
        ui.banner('Warning', `${e.name} approaching from the harbor`, 'warning');
        break;
      case 'banner':
        ui.banner(e.text, '', 'warning');
        break;
      case 'landmark':
        ui.banner(`${e.name} destroyed`, '+1 rare material', 'synergy');
        break;
      case 'bossDefeated':
        ui.banner('City claimed!', `${e.name} defeated`, 'grow');
        break;
      case 'dead':
        ui.showRevive({ onRevive: () => game.revive(), onGiveUp: () => game.giveUp() });
        break;
      case 'revived':
        ui.show('revive', false);
        break;
      case 'end':
        onRunEnd(e.results);
        break;
      default:
        break;
    }
  }
}

function onRunEnd(results) {
  ui.show('revive', false);
  ui.hint('');
  const { newBest, unlocked } = recordRun(profile, results);
  saveProfile(profile);
  const showIt = () =>
    ui.showResults(game.results, {
      best: profile.best[`${results.cityId}:${results.difficulty}`] || 0,
      newBest,
      unlocked,
      onDouble: () => {
        if (game.doubleLoot()) showIt();
      },
      onAgain: () => startRun(lastSettings),
      onMenu: () => showMenu(),
    });
  showIt();
}

function setQuality(q) {
  renderer.setQuality(q);
  profile.quality = q;
  saveProfile(profile);
}

function togglePause(force) {
  if (!game || game.state !== 'playing' || ui.hud.classList.contains('hidden')) return;
  paused = force ?? !paused;
  if (paused) {
    input.release();
    ui.showPause({
      quality: renderer.qualityName,
      pixelArt: renderer.pixelArt,
      sound: !sfx.muted,
      musicOn: music.enabled,
      onMusic: (on) => {
        music.setEnabled(on);
        profile.music = on;
        saveProfile(profile);
      },
      onSound: (on) => {
        sfx.setMuted(!on);
        profile.sound = on;
        saveProfile(profile);
        showSound();
      },
      onQuality: (q) => setQuality(q),
      onPixelArt: (on) => {
        renderer.setPixelArt(on);
        profile.pixelArt = on;
        saveProfile(profile);
      },
      onResume: () => togglePause(false),
      onQuit: () => {
        paused = false;
        showMenu();
      },
    });
  } else ui.show('pause', false);
}

document.getElementById('pauseBtn').addEventListener('click', () => togglePause());
// Sound on/off right on the HUD (the same setting as in the pause menu).
const soundBtn = document.getElementById('soundBtn');
const showSound = () => soundBtn.classList.toggle('muted', sfx.muted);
showSound();
soundBtn.addEventListener('click', () => {
  sfx.setMuted(!sfx.muted);
  profile.sound = !sfx.muted;
  saveProfile(profile);
  showSound();
  if (!sfx.muted) sfx.click();
});
// The charge button must not start a stick drag on the canvas underneath.
const dashBtn = document.getElementById('dashBtn');
dashBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  input.dashQueued = true;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p') togglePause();
  if (!debug || !game) return;
  if (e.key === 'g') game.debugGrow();
  if (e.key === 'l') game.debugLevel();
  if (e.key === 'b' && game.bossTimer !== null) game.bossTimer = 0.1;
  if (e.key === 'n' && game.kaiju.stage < 6) game.addBiomass(game.stage.biomassToNext);
  if (e.key === 'k' && game.boss) game.damageBoss(game.boss.hp + 1);
  if (e.key === 'h') game.kaiju.hp = game.kaiju.maxHp;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) togglePause(true);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game && renderer) {
    const inRun = !ui.hud.classList.contains('hidden');
    if (inRun && !paused) {
      const v = input.get();
      const w = renderer.worldDir(v.x, v.y);
      game.setInput(w.x, w.y);
      if (input.takeDash()) game.tryDash();
      if (v.x || v.y) movedFor += dt;
      game.update(dt);
      handleEvents(game.drainEvents());
      if (hintUntil && (now > hintUntil || movedFor > 3)) {
        hintUntil = 0;
        ui.hint('');
      }
    }
    renderer.render(game, inRun && !paused ? dt : dt * 0.25);
    music.update(musicState());
    if (inRun) {
      ui.updateHud(game);
      updatePreyArrow();
    }
  }
  requestAnimationFrame(frame);
}

const preyArrow = document.getElementById('preyArrow');
function updatePreyArrow() {
  const p = game.prey;
  const k = game.kaiju;
  const far = p && Math.hypot(p.x - k.x, p.y - k.y) > game.viewSpan() * 0.55;
  if (!far || game.state !== 'playing' || game.boss) {
    preyArrow.classList.add('hidden');
    return;
  }
  const s = renderer.project(p.x, p.y, 0);
  const cx = renderer.w / 2;
  const cy = renderer.h / 2;
  const a = Math.atan2(s.y - cy, s.x - cx);
  const rx = cx - 40;
  const ry = cy - 90;
  const t = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
  preyArrow.classList.remove('hidden');
  preyArrow.style.transform = `translate(${cx + Math.cos(a) * t}px, ${cy + Math.sin(a) * t}px) rotate(${a}rad)`;
}

function boot() {
  try {
    if (!window.THREE) throw new Error('three.js did not load');
    renderer = new Renderer3D(canvas, { quality: defaultQuality(), pixelArt: params.get('look') === 'pixel' || profile.pixelArt === true, floaterLayer: document.getElementById('floaters') });
    renderer.onVfx = (list, g) => sfx.handleVfx(list, g);
    renderer.onQualityChange = (q) => {
      profile.quality = q;
      saveProfile(profile);
    };
  } catch (err) {
    loading.innerHTML = `<div class="panel small"><h2>3D isn't available</h2><p class="muted">This browser couldn't start WebGL (${err.message}). Try a recent Chrome, Safari or Firefox.</p></div>`;
    return;
  }
  // The very first session drops straight into the suburbs as Rex: no login, no menus.
  if (!profile.tutorialDone || params.has('play')) startRun({ kaijuId: KAIJU[params.get('kaiju')] ? params.get('kaiju') : 'rex', difficulty: 'normal', firstRun: !profile.tutorialDone });
  else showMenu();
  loading.classList.add('hidden');
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer && renderer.resize());
// Let the loading screen paint before generating the city.
setTimeout(boot, 30);

// Exposed for automated smoke tests and balancing sessions.
window.kaijuRampage = { get game() { return game; }, get renderer() { return renderer; }, sfx, startRun, showMenu, profile: () => profile };
