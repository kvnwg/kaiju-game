// Synthesised sound effects (Web Audio, no files): crunches sized to what broke, thuds,
// gulps, coin blips that climb with the combo, booms, zaps, gunfire and fanfares. Every
// sound is throttled per kind so a rampage stays punchy instead of turning into noise.
// Phones that allow it also get short vibrations on heavy hits.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
    this.stage = 1;
  }

  // Browsers only start audio after a user gesture (inside the artifact frame, autoplay is off,
  // so every tap or key press tries again until it is running).
  unlock() {
    try {
      // iPhones: play through the ringer's silent switch, like a game should.
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch {
      // Not supported here.
    }
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 6;
        comp.connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(comp);
        const len = ctx.sampleRate;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
      }
      if (this.ctx.state !== 'running') {
        // A silent one-sample sound started inside the gesture unlocks older Safari too.
        const s = this.ctx.createBufferSource();
        s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        s.connect(this.ctx.destination);
        s.start(0);
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch {
      this.ctx = null;
    }
  }

  get running() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  ok(key, gap) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    if (now - (this.last[key] ?? -1) < gap) return false;
    this.last[key] = now;
    return true;
  }

  vibrate(ms) {
    try {
      if (!this.muted && navigator.vibrate) navigator.vibrate(ms);
    } catch {
      // Not allowed here.
    }
  }

  // ---- primitives
  env(g, t, vol, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.3, attack = 0.004, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, vol, attack, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.3, f0 = 2000, f1 = 300, q = 0.7, type = 'lowpass', attack = 0.003, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, vol, attack, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ---- sounds
  crunch(size) {
    // size 0 (pebble) .. 1 (bigger than you)
    if (!this.ok('crunch', 0.045 + size * 0.05)) return;
    const dur = 0.12 + size * 0.45;
    this.noise({ dur, vol: 0.18 + size * 0.3, f0: 3200 - size * 1800, f1: 220 - size * 120, q: 0.9 });
    this.noise({ dur: dur * 0.6, vol: 0.08 + size * 0.1, f0: 5000, f1: 1500, type: 'bandpass', q: 2, delay: 0.02 });
    if (size > 0.3) this.tone({ f0: 110 - size * 40, f1: 38, dur: 0.25 + size * 0.35, vol: 0.25 + size * 0.3 });
    if (size > 0.6) this.vibrate(25 + size * 30);
  }

  thud(size) {
    if (!this.ok('thud', 0.06)) return;
    this.tone({ f0: 160 - size * 60, f1: 60, dur: 0.09, vol: 0.12 + size * 0.15 });
    this.noise({ dur: 0.06, vol: 0.07, f0: 1800, f1: 400 });
  }

  boom(size = 1) {
    if (!this.ok('boom', 0.12)) return;
    this.noise({ dur: 0.6 + size * 0.5, vol: 0.4, f0: 1200, f1: 60, q: 0.5 });
    this.tone({ f0: 70, f1: 28, dur: 0.6 + size * 0.4, vol: 0.45 });
    this.vibrate(40);
  }

  gulp() {
    if (!this.ok('gulp', 0.06)) return;
    this.tone({ type: 'triangle', f0: 380, f1: 140, dur: 0.11, vol: 0.24 });
    this.tone({ type: 'sine', f0: 220, f1: 90, dur: 0.16, vol: 0.2, delay: 0.05 });
    this.noise({ dur: 0.06, vol: 0.08, f0: 1200, f1: 300, type: 'bandpass', q: 3, delay: 0.04 });
  }

  squeak() {
    if (!this.ok('squeak', 0.08)) return;
    const f = 900 + Math.random() * 300;
    this.tone({ type: 'square', f0: f, f1: f * 1.5, dur: 0.07, vol: 0.05 });
  }

  // A meaty chomp: teeth clack, a wet crunch in a few quick bites, and a low thump, all a
  // little deeper the bigger the kaiju is.
  chomp() {
    if (!this.ok('chomp', 0.06)) return;
    const deep = 1 - Math.min(0.6, (this.stage - 1) * 0.12);
    const jit = () => 0.85 + Math.random() * 0.3;
    this.noise({ dur: 0.025, vol: 0.32, f0: 4200 * deep * jit(), f1: 2600 * deep, type: 'bandpass', q: 4 });
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.05, vol: 0.24 - i * 0.05, f0: 2400 * deep * jit(), f1: 500 * deep, type: 'bandpass', q: 1.3, delay: 0.02 + i * 0.045 });
    }
    this.noise({ dur: 0.09, vol: 0.12, f0: 900 * deep, f1: 250, type: 'lowpass', q: 1, delay: 0.03 });
    this.tone({ type: 'sine', f0: 150 * deep, f1: 55 * deep, dur: 0.12, vol: 0.3 });
    this.tone({ type: 'square', f0: 260 * deep * jit(), f1: 90 * deep, dur: 0.05, vol: 0.07 });
  }

  // The kaiju's own swings: a jaw snap for bites, a heavy thump for pounds, a crackle for zaps.
  attack(kind) {
    if (!this.ok('attack', 0.07)) return;
    const deep = 1 - Math.min(0.6, (this.stage - 1) * 0.12);
    if (kind === 'bite') {
      this.noise({ dur: 0.03, vol: 0.28, f0: 5000 * deep, f1: 3000 * deep, type: 'bandpass', q: 5 });
      this.noise({ dur: 0.08, vol: 0.18, f0: 2200 * deep, f1: 600, type: 'bandpass', q: 1.4, delay: 0.015 });
      this.tone({ type: 'sine', f0: 130 * deep, f1: 50, dur: 0.1, vol: 0.22 });
    } else if (kind === 'pound') {
      this.tone({ type: 'sine', f0: 120 * deep, f1: 38, dur: 0.22, vol: 0.4 });
      this.noise({ dur: 0.16, vol: 0.2, f0: 1200, f1: 150, q: 0.7 });
    } else {
      this.noise({ dur: 0.12, vol: 0.14, f0: 7000, f1: 2500, type: 'highpass', q: 0.8 });
      this.tone({ type: 'sawtooth', f0: 1800, f1: 300, dur: 0.1, vol: 0.05 });
    }
  }

  burp() {
    if (!this.ok('burp', 0.4)) return;
    this.tone({ type: 'sawtooth', f0: 110, f1: 70, dur: 0.32, vol: 0.12, attack: 0.03 });
    this.tone({ type: 'sine', f0: 90, f1: 60, dur: 0.32, vol: 0.18, attack: 0.03 });
  }

  coin(combo) {
    if (!this.ok('coin', 0.035)) return;
    const step = Math.min(24, combo);
    const f = 880 * Math.pow(2, step / 24);
    this.tone({ type: 'square', f0: f, f1: f, dur: 0.05, vol: 0.06 });
    this.tone({ type: 'square', f0: f * 1.5, f1: f * 1.5, dur: 0.06, vol: 0.05, delay: 0.035 });
  }

  shot(kind) {
    if (kind === 'rocket' || kind === 'missile') {
      if (!this.ok('rocket', 0.15)) return;
      this.noise({ dur: 0.35, vol: 0.12, f0: 900, f1: 2400, type: 'bandpass', q: 1.5 });
      return;
    }
    if (!this.ok('shot', 0.07)) return;
    this.noise({ dur: 0.05, vol: 0.09, f0: 2600, f1: 900, type: 'bandpass', q: 1.2 });
  }

  hurt(amount) {
    if (!this.ok('hurt', 0.12)) return;
    this.tone({ type: 'square', f0: 240, f1: 110, dur: 0.12, vol: 0.08 + Math.min(0.15, amount) });
    if (amount > 0.05) this.vibrate(30);
  }

  step(stage) {
    if (stage < 3 || !this.ok('step', 0.1)) return;
    this.tone({ f0: 80 - stage * 6, f1: 34, dur: 0.18 + stage * 0.04, vol: 0.08 + stage * 0.05 });
    if (stage >= 5) this.vibrate(12);
  }

  hop() {
    if (!this.ok('hop', 0.1)) return;
    this.tone({ type: 'square', f0: 330, f1: 660, dur: 0.1, vol: 0.06 });
  }

  move(id) {
    if (!this.ok(`move-${id}`, 0.2)) return;
    switch (id) {
      case 'clawStrike':
        this.noise({ dur: 0.16, vol: 0.22, f0: 6000, f1: 900, type: 'bandpass', q: 1.4 });
        this.noise({ dur: 0.12, vol: 0.15, f0: 7000, f1: 1500, type: 'bandpass', q: 1.4, delay: 0.05 });
        break;
      case 'tailSpin':
        this.noise({ dur: 0.45, vol: 0.18, f0: 400, f1: 2500, type: 'bandpass', q: 2 });
        break;
      case 'spineMissiles':
        for (let i = 0; i < 4; i++) this.tone({ type: 'sawtooth', f0: 500 + i * 80, f1: 1400, dur: 0.12, vol: 0.05, delay: i * 0.07 });
        break;
      case 'carToss':
        this.noise({ dur: 0.3, vol: 0.15, f0: 300, f1: 1800, type: 'bandpass', q: 1 });
        break;
      case 'roar':
        this.tone({ type: 'sawtooth', f0: 120, f1: 70, dur: 0.9, vol: 0.22, attack: 0.05 });
        this.noise({ dur: 0.9, vol: 0.2, f0: 1400, f1: 300, q: 0.8, attack: 0.05 });
        this.vibrate(60);
        break;
      case 'laserEyes':
        this.tone({ type: 'sawtooth', f0: 1600, f1: 700, dur: 0.9, vol: 0.09 });
        this.tone({ type: 'square', f0: 1650, f1: 720, dur: 0.9, vol: 0.04 });
        break;
      case 'seismicSlam':
        this.tone({ type: 'sine', f0: 200, f1: 500, dur: 0.35, vol: 0.06 });
        break;
      case 'atomicBreath':
        this.tone({ type: 'sine', f0: 200, f1: 900, dur: 0.55, vol: 0.12 });
        this.noise({ dur: 1.4, vol: 0.2, f0: 3000, f1: 1200, type: 'bandpass', q: 0.8, delay: 0.55 });
        break;
      case 'meteorCall':
        this.tone({ type: 'sawtooth', f0: 1200, f1: 120, dur: 1.3, vol: 0.08 });
        break;
      default:
        break;
    }
  }

  slam() {
    this.boom(1.2);
    this.vibrate(70);
  }

  levelUp() {
    if (!this.ok('level', 0.5)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f, dur: 0.14, vol: 0.09, delay: i * 0.08 }));
    this.tone({ type: 'triangle', f0: 130, f1: 65, dur: 0.6, vol: 0.25 });
    this.vibrate([30, 40, 60]);
  }

  comboTier(tier) {
    if (!this.ok('ctier', 0.3)) return;
    const base = 440 * Math.pow(2, tier / 6);
    [1, 1.25, 1.5, 2].forEach((m, i) => this.tone({ type: 'square', f0: base * m, f1: base * m, dur: 0.09, vol: 0.07, delay: i * 0.05 }));
  }

  click() {
    if (!this.ok('click', 0.05)) return;
    this.tone({ type: 'square', f0: 1200, f1: 900, dur: 0.04, vol: 0.06 });
  }

  // ---- routing
  handleVfx(events, game) {
    if (!this.ctx) return;
    const k = game.kaiju;
    this.stage = k.stage;
    for (const e of events) {
      switch (e.t) {
        case 'destroy': {
          const o = e.obj;
          const size = o.landmark ? 1 : Math.max(0, Math.min(1, (o.tier - k.stage + 2) / 3));
          this.crunch(o.structure ? size : size * 0.6);
          break;
        }
        case 'hit':
          this.thud(0.6);
          break;
        case 'chip':
          this.thud(0.2);
          break;
        case 'explode':
          this.boom(Math.min(1.5, e.r / Math.max(4, k.r * 2)));
          break;
        case 'unitDie':
          this.crunch(e.u.def.vehicle ? 0.5 : 0.15);
          break;
        case 'carDie':
          this.crunch(0.35);
          break;
        case 'trainDie':
        case 'bossDie':
          this.boom(1.5);
          break;
        case 'eat':
          this.squeak();
          break;
        case 'chomp':
          this.chomp();
          break;
        case 'attack':
          this.attack(e.kind);
          break;
        case 'swallow':
          this.gulp();
          if (e.burp) this.burp();
          break;
        case 'orb':
          this.coin(e.combo || 0);
          break;
        case 'shot':
          this.shot(e.kind);
          break;
        case 'hurt':
          this.hurt(e.amount || 0);
          break;
        case 'step':
          this.step(e.stage);
          break;
        case 'move':
          this.move(e.id);
          break;
        default:
          break;
      }
    }
  }

  handleEvent(e) {
    if (!this.ctx) return;
    if (e.type === 'grow') this.levelUp();
    else if (e.type === 'slam') this.slam();
    else if (e.type === 'hop') this.hop();
    else if (e.type === 'comboTier') this.comboTier(e.tier);
    else if (e.type === 'dash') this.dash();
    else if (e.type === 'perfect') this.perfect();
    else if (e.type === 'multikill') this.comboTier(Math.min(3, e.tier));
  }

  // A bell ding that climbs with rarity (0 common .. 5 mythic): crate reveals, augment reels.
  ding(rarity = 0) {
    if (!this.ok('ding', 0.05)) return;
    const base = 660 * Math.pow(2, Math.min(5, rarity) / 6);
    this.tone({ type: 'triangle', f0: base, f1: base, dur: 0.5 + rarity * 0.08, vol: 0.16, attack: 0.002 });
    this.tone({ type: 'sine', f0: base * 2.01, f1: base * 2.01, dur: 0.35, vol: 0.08, attack: 0.002 });
    this.tone({ type: 'sine', f0: base * 3.02, f1: base * 3.02, dur: 0.2, vol: 0.04, attack: 0.002 });
    if (rarity >= 3) [1.25, 1.5, 2].forEach((m, i) => this.tone({ type: 'square', f0: base * m, f1: base * m, dur: 0.12, vol: 0.05, delay: 0.08 + i * 0.07 }));
  }

  // One reel click as a slot spins.
  tick() {
    if (!this.ok('tick', 0.03)) return;
    this.noise({ dur: 0.025, vol: 0.12, f0: 5000, f1: 3000, type: 'bandpass', q: 4 });
  }

  // Cash register: a purchase or a big payout.
  cash() {
    if (!this.ok('cash', 0.2)) return;
    [1320, 1760, 2640].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f, dur: 0.07, vol: 0.06, delay: i * 0.05 }));
    this.noise({ dur: 0.18, vol: 0.08, f0: 7000, f1: 4000, type: 'bandpass', q: 2, delay: 0.12 });
  }

  // Charge: a whoosh. Perfect dodge: a bright rising chime.
  dash() {
    if (!this.ok('dash', 0.1)) return;
    this.noise({ dur: 0.22, vol: 0.28, f0: 3000, f1: 600, q: 1.2, type: 'bandpass' });
  }

  perfect() {
    if (!this.ok('perfect', 0.15)) return;
    this.tone({ type: 'triangle', f0: 880, f1: 1760, dur: 0.18, vol: 0.22 });
    this.tone({ type: 'sine', f0: 1320, f1: 2640, dur: 0.22, vol: 0.16, delay: 0.06 });
  }
}

// ---------------------------------------------------------------- music
// An adaptive soundtrack synthesised on the fly: E minor, driving drums, a gallop bass,
// arpeggios and a lead. Layers come in as the rampage escalates (size, threat) and a boss
// fight switches to a heavier Phrygian loop with stabs and a faster tempo. Changes land on
// bar lines so it never stumbles.
const PROGRESSIONS = {
  // [semitones from E, minor?] per bar
  rampage: [[0, true], [-4, false], [-2, false], [-5, false]], // Em C D B
  boss: [[0, true], [1, false], [0, true], [-5, false]], // Em F Em B
};
const RIFF = [0, null, 2, 1, null, 0, 2, null, 3, null, 2, 1, 0, null, 1, null];
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.enabled = true;
    this.level = 0;
    this.want = { level: 0, boss: false, bpm: 140, paused: false };
    this.cur = { level: 0, boss: false, bpm: 140 };
    this.step = 0;
    this.bar = 0;
    this.next = 0;
    this.timer = null;
  }

  // Build the music bus the first time audio is running.
  ensure() {
    const c = this.sfx.ctx;
    if (!c || c.state !== 'running') return false;
    if (this.bus) return true;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.tone = c.createBiquadFilter(); // muffled while paused
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.bus.connect(this.tone).connect(comp).connect(c.destination);
    // A dotted-eighth echo for the lead and arps.
    this.echo = c.createDelay(1);
    const fb = c.createGain();
    fb.gain.value = 0.28;
    const wet = c.createGain();
    wet.gain.value = 0.3;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.bus);
    // Grit for the bass once things get heavy.
    this.drive = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 3.5);
    this.drive.curve = curve;
    this.drive.connect(this.bus);
    this.next = c.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
    return true;
  }

  // Called every frame with what the game is doing.
  update({ level, boss = false, bpm = 140, paused = false }) {
    this.want = { level, boss, bpm, paused };
    if (!this.ensure()) return;
    const c = this.sfx.ctx;
    const vol = this.sfx.muted || !this.enabled || level < 0 ? 0 : 0.42;
    this.bus.gain.setTargetAtTime(vol, c.currentTime, 0.4);
    this.tone.frequency.setTargetAtTime(paused ? 700 : 18000, c.currentTime, 0.15);
  }

  setEnabled(on) {
    this.enabled = on;
  }

  stepDur() {
    return 60 / this.cur.bpm / 4;
  }

  tick() {
    const c = this.sfx.ctx;
    if (!c || c.state !== 'running') return;
    if (this.next < c.currentTime - 0.3) this.next = c.currentTime + 0.05; // the tab was asleep
    while (this.next < c.currentTime + 0.15) {
      if (this.step % 16 === 0) {
        // New bar: take on the wanted intensity, boss mode and tempo.
        const w = this.want;
        if (w.boss !== this.cur.boss || w.level > this.cur.level + 0) this.riser(this.next);
        this.cur = { level: w.level, boss: w.boss, bpm: w.bpm };
        this.bar = (this.bar + 1) % 4;
      }
      if (this.cur.level >= 0 && !this.sfx.muted && this.enabled) this.play(this.step % 16, this.next);
      this.next += this.stepDur();
      this.step++;
    }
  }

  play(s, t) {
    const { level, boss } = this.cur;
    const prog = PROGRESSIONS[boss ? 'boss' : 'rampage'];
    const [root, minor] = prog[this.bar];
    const chord = [0, minor ? 3 : 4, 7].map((n) => n + root);
    const lastBar = this.bar === 3;
    const beat = this.stepDur() * 4;
    // Drums
    if (level >= 1) {
      const kicks = level >= 4 ? [0, 3, 4, 8, 10, 11, 12, 14] : level >= 3 ? [0, 4, 8, 10, 12] : [0, 4, 8, 12];
      if (kicks.includes(s)) this.kick(t);
    }
    if (level >= 2) {
      if (s === 4 || s === 12) this.snare(t, 0.32);
      if (lastBar && level >= 3 && s >= 13) this.snare(t, 0.12 + (s - 13) * 0.06); // fill
      if (level >= 3 ? true : s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.11 : 0.05, s % 4 === 2 && level >= 3);
    }
    // Bass: eighths at first, a gallop when it gets heavy.
    if (level >= 1) {
      const gallop = level >= 3 ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15] : [0, 2, 4, 6, 8, 10, 12, 14];
      if (gallop.includes(s)) this.bass(28 + root + (level >= 3 && s % 4 === 3 ? 12 : 0), t, this.stepDur() * 1.6, level >= 3);
    }
    // Arpeggio over two octaves
    if (level >= 0 && (level >= 2 || s % 2 === 0)) {
      const n = chord[s % 3] + 12 * (Math.floor(s / 3) % 2) + 64;
      this.pluck(n, t, level >= 2 ? 0.045 : 0.035);
    }
    // Pad on each bar
    if (s === 0) this.pad(chord.map((n) => n + 52), t, beat * 4, level >= 3 ? 0.035 : 0.05);
    // Lead riff
    if (level >= 3) {
      const r = RIFF[(s + this.bar * 4) % 16];
      if (r !== null) {
        const n = (chord[r % 3] ?? chord[0]) + (r === 3 ? 12 : 0) + 76;
        this.lead(n, t, this.stepDur() * 1.8, boss ? 0.05 : 0.04);
      }
    }
    // Boss stabs on the off-beat accents
    if (boss && [0, 6, 12].includes(s)) this.stab(chord.map((n) => n + 64), t);
  }

  // ---- instruments
  voice(type, f, t, dur, vol, { attack = 0.005, dest = this.bus, filter = 0, detune = 0 } = {}) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(filter, t);
      fl.frequency.exponentialRampToValueAtTime(Math.max(80, filter * 0.25), t + dur);
      o.connect(fl);
      node = fl;
    }
    node.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  kick(t) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.32);
  }

  noiseHit(t, dur, vol, type, f, q = 0.8) {
    const c = this.sfx.ctx;
    const s = c.createBufferSource();
    s.buffer = this.sfx.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  snare(t, vol) {
    this.noiseHit(t, 0.18, vol, 'bandpass', 1900, 0.7);
    this.voice('triangle', 190, t, 0.1, vol * 0.6);
  }

  hat(t, vol, open) {
    this.noiseHit(t, open ? 0.14 : 0.04, vol, 'highpass', 8000);
  }

  bass(m, t, dur, heavy) {
    const f = midiHz(m);
    this.voice('sawtooth', f, t, dur, heavy ? 0.16 : 0.2, { filter: heavy ? 1600 : 900, dest: heavy ? this.drive : this.bus });
    this.voice('sine', f, t, dur, 0.22);
  }

  pluck(m, t, vol) {
    const g = this.voice('square', midiHz(m), t, this.stepDur() * 1.5, vol, { filter: 3200 });
    g.connect(this.echo);
  }

  pad(notes, t, dur, vol) {
    for (const n of notes) {
      for (const d of [-9, 9]) this.voice('sawtooth', midiHz(n), t, dur, vol, { attack: dur * 0.3, filter: 1400, detune: d });
    }
  }

  lead(m, t, dur, vol) {
    for (const d of [-7, 7]) {
      const g = this.voice('sawtooth', midiHz(m), t, dur, vol, { filter: 4200, detune: d });
      g.connect(this.echo);
    }
  }

  stab(notes, t) {
    for (const n of notes) this.voice('sawtooth', midiHz(n), t, 0.16, 0.06, { filter: 2600 });
  }

  // A noise sweep up into the next bar when the music steps up.
  riser(t) {
    const c = this.sfx.ctx;
    const s = c.createBufferSource();
    s.buffer = this.sfx.noiseBuf;
    s.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = 'bandpass';
    fl.Q.value = 3;
    const t0 = Math.max(c.currentTime, t - this.stepDur() * 8);
    if (t - t0 < 0.1) return;
    fl.frequency.setValueAtTime(400, t0);
    fl.frequency.exponentialRampToValueAtTime(6000, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    s.connect(fl).connect(g).connect(this.bus);
    s.start(t0);
    s.stop(t + 0.15);
    this.kick(t);
    this.noiseHit(t, 0.8, 0.12, 'lowpass', 3000);
  }
}
