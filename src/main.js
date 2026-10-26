import { Game } from './game.js';
import { Renderer3D } from './render3d.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadSave, writeSave, clearSave } from './storage.js';
import { KAIJU } from './config.js';
import { Sfx, Music } from './audio.js';
import { Hub } from './hub.js';
import { Platform } from './platform.js';
import { setupTitle, TITLE } from './title.js';
import { rollover, spendEnergy, runRewards, applyRun, loadout, grant, useAd, loginReady, ECONOMY } from './meta.js';

const canvas = document.getElementById('game');
const input = new Input(canvas, document.getElementById('stick'));
const ui = new UI();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const loading = document.getElementById('loading');

// The save holds the whole meta game (currencies, gear, quests...); see meta.js.
let save = loadSave();
let hub = null;
const now = () => Date.now() + (hub ? hub.timeShift || 0 : 0);
const persist = () => writeSave(save);
rollover(save, now());
const settings = save.settings;
const sfx = new Sfx();
ui.sfx = sfx;
sfx.setMuted(settings.sound === false);
const music = new Music(sfx);
music.setEnabled(settings.music !== false);

// Ads (CrazyGames, or a placeholder elsewhere). The game goes quiet and holds still while one plays.
const platform = new Platform();
platform.loadingStart();
let mutedBeforeAd = null;
platform.onAdStart = () => {
  mutedBeforeAd = sfx.muted;
  sfx.setMuted(true);
};
platform.onAdEnd = () => {
  if (mutedBeforeAd !== null) sfx.setMuted(mutedBeforeAd);
  mutedBeforeAd = null;
};

// How hard the soundtrack should hit right now: menu 0, then by size and threat, bosses 4.
function musicState() {
  const inRun = game && !ui.hud.classList.contains('hidden');
  if (titleActive) return { level: 2, bpm: 132 };
  if (!inRun) return { level: 0, bpm: 128 };
  if (game.state === 'won' || game.state === 'lost') return { level: -1, bpm: 128 };
  if (game.state === 'dead') return { level: 0, bpm: 120 };
  const k = game.kaiju;
  const boss = Boolean(game.boss && !game.boss.dead) || game.gateTimer !== null || game.bossTimer !== null;
  let level = k.stage <= 1 ? 1 : k.stage <= 3 ? 2 : 3;
  if (game.threat > 60) level++;
  if (boss) level = 4;
  if (game.frenzy > 0) level = Math.max(level, 3);
  return { level: Math.min(4, level), boss, bpm: (boss ? 164 : 140 + k.stage * 3), paused: paused || game.state === 'picking' || game.state === 'altar' };
}
// Audio can only start from a user gesture; any tap or key unlocks (and resumes) it.
for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'click', 'keydown', 'touchstart', 'touchend']) window.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
let renderer = null;
let game = null;
let paused = false;
let lastSettings = { kaijuId: 'rex', chapter: 1, mode: 'normal' };
let titleActive = false;
let title = null; // the title shot's kaiju, kept in frame
let runCtx = null;
let hintUntil = 0;
let movedFor = 0;
let pendingGrowBanner = null;

function defaultQuality() {
  const saved = settings.quality;
  if (saved) return saved;
  const mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return params.get('q') || (mobile ? 'medium' : 'high');
}

// A chapter run: costs energy (the very first run is free), carries the meta loadout in.
function startRun({ kaijuId, chapter = 1, mode = 'normal', firstRun = false }) {
  if (!firstRun && !spendEnergy(save, ECONOMY.energyPerRun, now())) {
    showHub();
    hub.openEnergy();
    return;
  }
  persist();
  lastSettings = { kaijuId, chapter, mode };
  runCtx = { chapter, mode, kaijuId };
  renderer.cinematic = null;
  titleActive = false;
  hub.hide();
  game = new Game({ kaijuId, difficulty: mode, firstRun, chapter, meta: loadout(save, kaijuId), seed: Number(params.get('seed')) || Date.now() });
  renderer.startRun(game);
  paused = false;
  ui.hideModals();
  ui.show('hud');
  ui.augSig = null;
  movedFor = 0;
  pendingGrowBanner = null;
  hintUntil = firstRun || save.runs < 2 ? performance.now() + 7000 : 0;
  ui.hint(hintUntil ? (window.matchMedia('(pointer: coarse)').matches ? 'Drag to move. You attack on your own. Eat people to grow.' : 'WASD or arrows to move. You attack on your own. Eat people to grow.') : '');
}

// The hub, with the city (or the wreckage of the last run) behind it.
function showHub(tab) {
  renderer.cinematic = null;
  titleActive = false;
  if (!game || game.state === 'playing' || game.state === 'dead' || game.state === 'picking') {
    game = new Game({ seed: 1, kaijuId: save.lastKaiju, meta: { skin: save.skins.equipped } });
    renderer.startRun(game);
  }
  ui.show('hud', false);
  ui.hint('');
  ui.hideModals();
  hub.show(tab);
  // Habby-style: the daily reward greets the player once a day.
  if (loginReady(save, now()) && save.tutorialDone) hub.openLogin();
}

// The title: a fixed shot from among the towers, looking out across the skyline at a colossal
// kaiju wrecking the city in the distance. The camera never follows it.
function showTitle() {
  game = new Game({ seed: 11, kaijuId: 'rex' });
  title = setupTitle(game);
  renderer.startRun(game);
  renderer.cinematic = title.view;
  titleActive = true;
  ui.show('hud', false);
  hub.showTitle(() => {
    titleActive = false;
    title = null;
    renderer.cinematic = null;
    if (!save.tutorialDone) startRun({ kaijuId: 'rex', firstRun: true });
    else showHub('battle');
  });
}

const CALLOUTS = ['Smashing!', 'Rampage!', 'Unstoppable!', 'Kaiju-geddon!', 'Extinction event!'];
const appEl = document.getElementById('app');
const classTimers = {};
// Briefly adds a class to the app (letterbox bars on a size-up, red edges in a frenzy).
function flashClass(name, ms) {
  appEl.classList.add(name);
  clearTimeout(classTimers[name]);
  classTimers[name] = setTimeout(() => appEl.classList.remove(name), ms);
}

function handleEvents(events) {
  for (const e of events) {
    sfx.handleEvent(e);
    switch (e.type) {
      case 'comboTier':
        ui.callout(CALLOUTS[Math.min(CALLOUTS.length, e.tier) - 1], e.tier);
        break;
      case 'grow':
        flashClass('cine', 1700);
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
        showPick();
        break;
      case 'picked':
        ui.show('pick', false);
        if (pendingGrowBanner) ui.growBanner(pendingGrowBanner);
        pendingGrowBanner = null;
        break;
      case 'altar':
        ui.showAltar(game, (c) => game.altarChoose(c));
        break;
      case 'altarDone':
        ui.show('pick', false);
        break;
      case 'frenzy':
        ui.callout('Feeding frenzy!', 4);
        flashClass('frenzy', 4000);
        break;
      case 'vault':
        ui.banner('A golden vault!', 'Smash the glowing gold building for gems', 'synergy');
        break;
      case 'vaultCracked':
        ui.callout(`Vault cracked! +${e.gems} gems`, 4);
        sfx.cash();
        break;
      case 'objective':
        ui.banner('Bonus objective done!', `${e.text}: a Supply Crate is yours`, 'synergy');
        sfx.ding(3);
        break;
      case 'cityEvent':
        ui.banner(e.name, e.sub, 'warning');
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
      case 'dead': {
        const paid = game.revives - (game.reviveAvailable ? 0 : 1) - (game.meta.revives - game.freeRevives) || 0;
        const price = ECONOMY.reviveGems[Math.max(0, paid)] || null;
        hub.showRevive({
          free: game.freeRevives > 0, ad: game.reviveAvailable, gems: price,
          onRevive: (how) => game.revive(how === 'gems'),
          onGiveUp: () => game.giveUp(),
        });
        break;
      }
      case 'revived':
        hub.closeModal();
        break;
      case 'end':
        onRunEnd(e.results);
        break;
      default:
        break;
    }
  }
}

// The run is booked the moment it ends (so closing the tab loses nothing); the doubling ad adds
// the second half on top.
function onRunEnd(results) {
  ui.show('revive', false);
  ui.hint('');
  hub.closeModal();
  const ctx = runCtx || { chapter: 1, mode: 'normal' };
  const rewards = runRewards(save, results, ctx);
  const levelsBefore = save.account.level;
  applyRun(save, results, ctx, rewards, {}, now());
  persist();
  if (results.won) platform.happytime();
  let doubled = false;
  const show = () => hub.showRunResults(results, rewards, ctx, {
    doubled,
    onDouble: () => {
      if (doubled || !useAd(save, 'double', now())) return;
      doubled = true;
      grant(save, { scrap: rewards.scrap, dna: rewards.dna, passXp: rewards.passXp });
      persist();
      sfx.cash();
      show();
    },
    onContinue: () => {
      showHub('battle');
      if (save.account.level > levelsBefore) hub.toast(`Account level ${save.account.level}! +${ECONOMY.levelUpEnergy} energy, +${ECONOMY.levelUpGems} gems`);
    },
    onAgain: () => startRun(lastSettings),
  });
  // An ad break after every match, then the results.
  platform.showAd('midgame').then(show);
}

// The augment pick, with the extra reroll behind a rewarded ad.
function showPick() {
  ui.showPick(game, {
    onChoose: (id) => game.choose(id),
    onReroll: (ad) => {
      if (!ad) {
        if (game.reroll(false)) showPick();
        return;
      }
      hub.watchAd('reroll', () => {
        if (game.reroll(true)) showPick();
      });
    },
  });
}

function setQuality(q) {
  renderer.setQuality(q);
  settings.quality = q;
  persist();
}

function togglePause(force) {
  if (!game || game.state !== 'playing' || ui.hud.classList.contains('hidden')) return;
  paused = force ?? !paused;
  if (paused) {
    input.release();
    ui.showPause({
      held: game.held,
      quality: renderer.qualityName,
      pixelArt: renderer.pixelArt,
      sound: !sfx.muted,
      musicOn: music.enabled,
      onMusic: (on) => {
        music.setEnabled(on);
        settings.music = on;
        persist();
      },
      onSound: (on) => {
        sfx.setMuted(!on);
        settings.sound = on;
        persist();
        showSound();
      },
      onQuality: (q) => setQuality(q),
      onPixelArt: (on) => {
        renderer.setPixelArt(on);
        settings.pixelArt = on;
        persist();
      },
      onResume: () => togglePause(false),
      onQuit: () => {
        paused = false;
        showHub('battle');
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
  settings.sound = !sfx.muted;
  persist();
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
  if (game && renderer && titleActive) {
    // The title's kaiju rampages in frame, out in the distance.
    title.update(dt, renderer.w / renderer.h);
    if (game.state === 'playing') game.update(dt);
    game.kaiju.r = TITLE.r;
    game.drainEvents();
  }
  if (game && renderer) {
    const inRun = !ui.hud.classList.contains('hidden');
    platform.setPlaying(inRun && !paused && game.state === 'playing' && !platform.adPlaying);
    if (inRun && !paused && !platform.adPlaying) {
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
    // Behind the hub, wreckage settles in slow motion; the title and a run play at full speed.
    renderer.render(game, titleActive || (inRun && !paused) ? dt : dt * 0.25);
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
  // A golden vault outranks food: the arrow turns gold and points at it while it is off screen.
  const vault = game.vault && game.vault.state === 'intact' ? game.vault : null;
  const p = vault || game.prey;
  const k = game.kaiju;
  const far = p && Math.hypot(p.x - k.x, p.y - k.y) > game.viewSpan() * 0.55;
  if (!far || game.state !== 'playing' || game.boss) {
    preyArrow.classList.add('hidden');
    return;
  }
  preyArrow.classList.toggle('gold', Boolean(vault));
  const s = renderer.project(p.x, p.y, 0);
  // Ride an ellipse between the HUD at the top and the augment bar at the bottom.
  const top = 140;
  const bottom = renderer.h - 120;
  const cx = renderer.w / 2;
  const cy = (top + bottom) / 2;
  const a = Math.atan2(s.y - cy, s.x - cx);
  const rx = cx - 40;
  const ry = (bottom - top) / 2;
  const t = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
  preyArrow.classList.remove('hidden');
  preyArrow.style.transform = `translate(${cx + Math.cos(a) * t}px, ${cy + Math.sin(a) * t}px) rotate(${a}rad)`;
}

function boot() {
  try {
    if (!window.THREE) throw new Error('three.js did not load');
    renderer = new Renderer3D(canvas, { quality: defaultQuality(), pixelArt: params.get('look') === 'pixel' || settings.pixelArt === true, floaterLayer: document.getElementById('floaters') });
    renderer.onVfx = (list, g) => sfx.handleVfx(list, g);
    renderer.onQualityChange = (q) => {
      settings.quality = q;
      persist();
    };
  } catch (err) {
    loading.innerHTML = `<div class="panel small"><h2>3D isn't available</h2><p class="muted">This browser couldn't start WebGL (${err.message}). Try a recent Chrome, Safari or Firefox.</p></div>`;
    return;
  }
  // The very first session drops straight into the suburbs as Rex: no login, no menus.
  hub = new Hub({ app: document.getElementById('app'), getSave: () => save, persist, onPlay: (opts) => startRun(opts), sfx, platform, getNow: now });
  hub.debug = debug;
  hub.onReset = () => {
    clearSave();
    save = loadSave();
    location.reload();
  };
  // `?play` skips straight into a run; otherwise the cinematic title comes first.
  if (params.has('play')) startRun({ kaijuId: KAIJU[params.get('kaiju')] ? params.get('kaiju') : 'rex', firstRun: true });
  else if (params.has('hub')) showHub('battle');
  else showTitle();
  loading.classList.add('hidden');
  platform.loadingStop();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer && renderer.resize());
// Let the loading screen paint before generating the city.
setTimeout(boot, 30);

// Exposed for automated smoke tests and balancing sessions.
window.kaijuRampage = { get game() { return game; }, get renderer() { return renderer; }, get hub() { return hub; }, get title() { return title; }, sfx, platform, startRun, showHub, save: () => save, persist };
