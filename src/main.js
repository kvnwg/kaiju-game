import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadProfile, saveProfile, recordRun } from './storage.js';
import { KAIJU } from './config.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas, document.getElementById('stick'));
const ui = new UI();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');

let profile = loadProfile();
let game = null;
let paused = false;
let lastSettings = { kaijuId: 'rex', difficulty: 'normal' };
let hintUntil = 0;
let movedFor = 0;
let pendingGrowBanner = null;

function startRun({ kaijuId, difficulty, firstRun = false }) {
  lastSettings = { kaijuId, difficulty };
  game = new Game({ kaijuId, difficulty, firstRun, seed: Number(params.get('seed')) || Date.now() });
  renderer.snapCamera(game);
  paused = false;
  ui.hideModals();
  ui.show('hud');
  ui.augSig = null;
  movedFor = 0;
  hintUntil = firstRun || profile.runs < 2 ? performance.now() + 9000 : 0;
  ui.hint(hintUntil ? 'Drag anywhere to move (or WASD). Attacks are automatic.' : '');
}

function showMenu() {
  // Keep a city on screen behind the menu.
  if (!game || game.state === 'playing') game = new Game({ seed: 1 });
  renderer.snapCamera(game);
  ui.show('hud', false);
  ui.hint('');
  ui.hideModals();
  ui.showMenu(profile, { onStart: (s) => startRun(s) });
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'grow':
        // Every grow opens a pick; announce the new stage once the pick is made.
        pendingGrowBanner = e.stage;
        break;
      case 'pick':
        if (game.state !== 'picking') break;
        hintUntil = 0;
        ui.hint('');
        ui.showPick(game, {
          onChoose: (id) => game.choose(id),
          onReroll: (ad) => game.reroll(ad),
        });
        break;
      case 'picked':
        ui.show('pick', false);
        if (pendingGrowBanner) ui.growBanner(pendingGrowBanner);
        pendingGrowBanner = null;
        break;
      case 'synergy':
        ui.banner(`Synergy: ${e.set.name}`, e.set.bonus, 'synergy');
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

function togglePause(force) {
  if (!game || game.state !== 'playing') return;
  paused = force ?? !paused;
  if (paused) {
    input.release();
    ui.showPause({
      onResume: () => togglePause(false),
      onQuit: () => {
        paused = false;
        showMenu();
      },
    });
  } else ui.show('pause', false);
}

document.getElementById('pauseBtn').addEventListener('click', () => togglePause());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'p') togglePause();
  if (!debug || !game) return;
  if (e.key === 'g') game.debugGrow();
  if (e.key === 'b' && game.bossTimer !== null) game.bossTimer = 0.1;
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
  if (game) {
    const inRun = !ui.hud.classList.contains('hidden');
    if (inRun && !paused) {
      const v = input.get();
      game.setInput(v.x, v.y);
      if (v.x || v.y) movedFor += dt;
      game.update(dt);
      handleEvents(game.drainEvents());
      if (hintUntil && (now > hintUntil || movedFor > 2.5)) {
        hintUntil = 0;
        ui.hint('');
      }
    }
    renderer.render(game, dt);
    if (inRun) ui.updateHud(game);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());

// The very first session drops straight into Harbor Town as Rex: no login, no menus.
if (!profile.tutorialDone || params.has('play')) startRun({ kaijuId: KAIJU[params.get('kaiju')] ? params.get('kaiju') : 'rex', difficulty: 'normal', firstRun: !profile.tutorialDone });
else showMenu();
requestAnimationFrame(frame);

// Exposed for automated smoke tests and balancing sessions.
window.kaijuRampage = { get game() { return game; }, startRun, showMenu, profile: () => profile };
