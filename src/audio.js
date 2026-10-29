// Synthesised sound effects (Web Audio, no files): crunches sized to what broke, thuds,
// gulps, coin blips that climb with the combo, booms, zaps, gunfire and fanfares. Every
// sound is throttled per kind so a rampage stays punchy instead of turning into noise.
// Phones that allow it also get short vibrations on heavy hits.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.userMuted = false; // the player's own sound setting
    this.holds = new Set(); // other reasons for silence (an ad playing, the platform's mute)
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

  // Silent when the player turns sound off, or while anything holds it off, whatever the
  // player's own setting says.
  get muted() {
    return this.userMuted || this.holds.size > 0;
  }

  setMuted(m) {
    this.userMuted = m;
    this.applyMute();
  }

  hold(reason, on) {
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    this.applyMute();
  }

  applyMute() {
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
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
        // A grunt in the crouch, the whoosh of the leap, and the rush of the drop.
        this.tone({ type: 'square', f0: 120, f1: 80, dur: 0.12, vol: 0.08 });
        this.noise({ dur: 0.36, vol: 0.14, f0: 300, f1: 1600, type: 'bandpass', q: 1.6, delay: 0.12 });
        this.noise({ dur: 0.12, vol: 0.16, f0: 2400, f1: 500, type: 'bandpass', q: 1.2, delay: 0.5 });
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

  // Seismic Slam impact: the boom, a crunch of rock, a sub-bass thump and a long rumble.
  slam() {
    this.boom(1.4);
    this.noise({ dur: 0.25, vol: 0.3, f0: 2500, f1: 400, type: 'bandpass', q: 0.9 });
    this.noise({ dur: 1.6, vol: 0.16, f0: 320, f1: 40, q: 0.7, delay: 0.08 });
    this.tone({ type: 'sine', f0: 58, f1: 24, dur: 0.9, vol: 0.5 });
    this.vibrate([80, 40, 40]);
  }

  // The size-up newspaper: a flutter as it spins in, then a slap and a thud as it lands.
  paper() {
    if (!this.ok('paper', 0.5)) return;
    for (let i = 0; i < 4; i++) this.noise({ dur: 0.1, vol: 0.07 + i * 0.03, f0: 4200, f1: 1500, type: 'bandpass', q: 1.4, delay: i * 0.13 });
    this.noise({ dur: 0.14, vol: 0.38, f0: 6500, f1: 700, type: 'bandpass', q: 0.8, delay: 0.55 });
    this.tone({ f0: 130, f1: 45, dur: 0.4, vol: 0.4, delay: 0.55 });
    this.vibrate([0, 550, 60]);
  }

  // A size-up: the kaiju roars over a boom and the level-up jingle.
  sizeUp() {
    this.boom(1.2);
    this.tone({ type: 'sawtooth', f0: 150, f1: 62, dur: 1.1, vol: 0.24, attack: 0.06, delay: 0.08 });
    this.noise({ dur: 1.1, vol: 0.22, f0: 1600, f1: 260, q: 0.8, attack: 0.06, delay: 0.08 });
    this.levelUp();
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
    if (e.type === 'grow') this.sizeUp();
    else if (e.type === 'slam') this.slam();
    else if (e.type === 'hop') this.hop();
    else if (e.type === 'comboTier') this.comboTier(e.tier);
    else if (e.type === 'dash') this.dash();
    else if (e.type === 'perfect') this.perfect();
    else if (e.type === 'multikill') this.comboTier(Math.min(3, e.tier));
    else if (e.type === 'warp') this.warp();
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

  // Zooming out to the next realm: a long rising whoosh and a falling chime.
  warp() {
    if (!this.ok('warp', 1)) return;
    this.noise({ dur: 2.4, vol: 0.22, f0: 300, f1: 5000, q: 1.5, type: 'bandpass', attack: 1.6 });
    this.tone({ type: 'triangle', f0: 220, f1: 1760, dur: 2.4, vol: 0.12, attack: 1.2 });
    [1760, 1320, 880, 660, 440].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f, dur: 0.18, vol: 0.05, delay: 2.5 + i * 0.12 }));
  }

  perfect() {
    if (!this.ok('perfect', 0.15)) return;
    this.tone({ type: 'triangle', f0: 880, f1: 1760, dur: 0.18, vol: 0.22 });
    this.tone({ type: 'sine', f0: 1320, f1: 2640, dur: 0.22, vol: 0.16, delay: 0.06 });
  }
}

// ---------------------------------------------------------------- music
// An 8-bit soundtrack in the style of the NES sound chip, played live: two pulse channels (lead
// and fast arpeggio "chords", with the chip's 12.5%, 25% and 50% duty cycles), a triangle bass
// and a noise channel for drums. Three themes: a bouncy menu tune, the rampage theme, whose
// layers come in as the rampage escalates (size, threat), and a faster boss theme. Changes land
// on bar lines so it never stumbles.

// One bar is 16 sixteenth-note steps: a note name starts a note, "." holds it, "-" is a rest.
const SONGS = {
  menu: {
    chords: [['A2', 'm'], ['F2', ''], ['C3', ''], ['G2', ''], ['A2', 'm'], ['F2', ''], ['C3', ''], ['G2', '']],
    lead: [
      'E5 . . . A5 . . . C6 . B5 . A5 . . .',
      'A5 . G5 . F5 . . . C5 . F5 . A5 . . .',
      'G5 . . . E5 . C5 . E5 . G5 . C6 . . .',
      'B5 . . . . . A5 . G5 . . . D5 . . .',
      'E5 . A5 . C6 . E6 . D6 . C6 . B5 . A5 .',
      'C6 . . . A5 . F5 . A5 . C6 . F6 . . .',
      'E6 . D6 . C6 . G5 . E5 . G5 . C6 . . .',
      'B5 . . . D6 . . . G5 . . . - - - -',
    ],
  },
  rampage: {
    chords: [['E2', 'm'], ['C2', ''], ['D2', ''], ['B1', ''], ['E2', 'm'], ['C2', ''], ['D2', ''], ['B1', '']],
    lead: [
      'B4 . E5 . G5 . B5 . A5 . G5 . F#5 . E5 .',
      'G5 . . . E5 . C5 . E5 . G5 . C6 . . .',
      'A5 . . . F#5 . D5 . F#5 . A5 . D6 . C6 .',
      'B5 . . . . . - - D#5 . F#5 . B5 . A5 .',
      'G5 . . . E5 . B4 . E5 . G5 . B5 . . .',
      'C6 . B5 . A5 . G5 . E5 . G5 . A5 . . .',
      'F#5 . A5 . D6 . A5 . F#5 . E5 . D5 . F#5 .',
      'E5 . . . . . . . D#5 . . . . . - -',
    ],
  },
  boss: {
    chords: [['E2', 'm'], ['F2', ''], ['E2', 'm'], ['B1', ''], ['E2', 'm'], ['F2', ''], ['G2', ''], ['B1', '']],
    lead: [
      'E5 E5 - E5 G5 . E5 - F5 . E5 - D5 . E5 .',
      'F5 . A5 . C6 . A5 . F5 . A5 . C6 . F6 .',
      'E6 . D6 . B5 . G5 . E5 . G5 . B5 . D6 .',
      'D#6 . . . B5 . . . F#5 . . . D#5 . F#5 .',
      'E5 E5 - E5 G5 . E5 - B5 . G5 - E5 . G5 .',
      'A5 . F5 . C6 . F5 . A5 . C6 . F6 . E6 .',
      'D6 . B5 . G5 . D6 . B5 . G5 . D5 . G5 .',
      'F#5 . A5 . B5 . D#6 . F#6 . . . - - - -',
    ],
  },
  // Out in space: slow and floaty, half-time drums.
  space: {
    chords: [['D2', 'm'], ['A#1', ''], ['F2', ''], ['C2', ''], ['D2', 'm'], ['G2', 'm'], ['A#1', ''], ['A1', '']],
    lead: [
      'A5 . . . D6 . . . F6 . E6 . D6 . . .',
      'D6 . . . C6 . A#5 . A5 . . . F5 . . .',
      'A5 . . . C6 . . . F6 . . . E6 . C6 .',
      'G5 . . . . . . . E5 . G5 . C6 . . .',
      'D6 . F6 . A6 . F6 . D6 . A5 . F5 . A5 .',
      'G5 . . . A#5 . D6 . G6 . F6 . D6 . . .',
      'F6 . E6 . D6 . A#5 . F5 . A#5 . D6 . . .',
      'C#6 . . . E6 . . . A5 . . . - - - -',
    ],
  },
  // The back garden: a bouncy, sunny tune.
  garden: {
    chords: [['G2', ''], ['C3', ''], ['D3', ''], ['G2', ''], ['E2', 'm'], ['C3', ''], ['A2', 'm'], ['D3', '']],
    lead: [
      'D5 . G5 . B5 . G5 . D6 . B5 . G5 . . .',
      'E5 . G5 . C6 . . . E6 . C6 . G5 . . .',
      'F#5 . A5 . D6 . . . A5 . F#5 . D5 . . .',
      'G5 . B5 . D6 . G6 . - . D6 . B5 . . .',
      'E5 . . . G5 . B5 . E6 . . . B5 . G5 .',
      'C6 . . . E6 . C6 . G5 . E5 . G5 . C6 .',
      'A5 . C6 . E6 . C6 . A5 . E5 . A5 . C6 .',
      'D6 . . . F#6 . . . A5 . . . - - - -',
    ],
  },
};
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
// Bars of 16 steps -> per step: a midi note to start, null to hold, -1 for a rest.
function parseBar(text) {
  return text.split(/\s+/).map((tok) => (tok === '.' ? null : tok === '-' ? -1 : midiOf(tok)));
}
for (const song of Object.values(SONGS)) {
  song.steps = song.lead.map(parseBar);
  song.roots = song.chords.map(([n, q]) => ({ root: midiOf(n), minor: q === 'm' }));
}
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.enabled = true;
    this.want = { theme: 'menu', level: 0, bpm: 126, paused: false };
    this.cur = { theme: 'menu', level: 0, bpm: 126 };
    this.step = 0;
    this.bar = 0;
    this.next = 0;
    this.timer = null;
  }

  // Build the music bus and the chip's pulse waves the first time audio is running.
  ensure() {
    const c = this.sfx.ctx;
    if (!c || c.state !== 'running') return false;
    if (this.bus) return true;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.tone = c.createBiquadFilter(); // muffled while paused
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    this.bus.connect(this.tone).connect(c.destination);
    // Pulse waves at the NES duty cycles: thin (12.5%), hollow (25%) and square (50%).
    this.pulse = {};
    for (const duty of [0.125, 0.25, 0.5]) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = ((2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty));
      this.pulse[duty] = c.createPeriodicWave(real, imag);
    }
    // The triangle channel (bass and kick).
    const n = 64;
    const tri = new Float32Array(n);
    const triIm = new Float32Array(n);
    for (let k = 1; k < n; k += 2) triIm[k] = (8 / (Math.PI * Math.PI)) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k);
    this.triWave = c.createPeriodicWave(tri, triIm);
    this.next = c.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
    return true;
  }

  // Called every frame with what the game is doing.
  update({ theme = 'rampage', level, bpm = 140, paused = false }) {
    this.want = { theme, level, bpm, paused };
    if (!this.ensure()) return;
    const c = this.sfx.ctx;
    const vol = this.sfx.muted || !this.enabled || level < 0 ? 0 : 0.3;
    this.bus.gain.setTargetAtTime(vol, c.currentTime, 0.4);
    this.tone.frequency.setTargetAtTime(paused ? 900 : 18000, c.currentTime, 0.15);
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
        // New bar: take on the wanted theme, intensity and tempo. A new theme starts from its
        // top, with a drum roll in.
        const w = this.want;
        const newTheme = w.theme !== this.cur.theme;
        if (newTheme || w.level > this.cur.level) this.roll(this.next);
        this.cur = { theme: w.theme, level: w.level, bpm: w.bpm };
        this.bar = newTheme ? 0 : (this.bar + 1) % 8;
      }
      if (this.cur.level >= 0 && !this.sfx.muted && this.enabled) this.play(this.step % 16, this.next);
      this.next += this.stepDur();
      this.step++;
    }
  }

  play(s, t) {
    const { theme, level } = this.cur;
    const song = SONGS[theme] || SONGS.rampage;
    const { root, minor } = song.roots[this.bar];
    const sd = this.stepDur();
    const menu = theme === 'menu';
    const boss = theme === 'boss';
    const space = theme === 'space';
    const garden = theme === 'garden';
    // Layers: the menu, space and the garden always have their tunes; a city run builds from bass
    // and drums, adds the arpeggios, then the melody; the boss theme has everything.
    const tuneful = menu || boss || space || garden;
    const drums = space ? level >= 2 : level >= 1;
    const arps = tuneful || level >= 2;
    const melody = tuneful || level >= 3;
    // Noise-channel drums (half time out in space).
    if (drums) {
      const heavy = boss || (!space && level >= 4);
      const kicks = heavy ? [0, 3, 6, 8, 10, 11, 14] : space ? [0, 10] : menu || garden ? [0, 8] : level >= 3 ? [0, 6, 8, 10] : [0, 8];
      if (kicks.includes(s)) this.kick(t);
      if (space ? s === 8 : s === 4 || s === 12) this.snare(t, space ? 0.16 : 0.22);
      if (!menu && !space && this.bar % 4 === 3 && level >= 2 && s >= 12) this.snare(t, 0.09 + (s - 12) * 0.04); // fill
      if (space ? s % 4 === 2 : menu || garden ? s % 4 === 2 : level >= 2 || s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.08 : 0.045);
    } else if ((menu || space) && s % 4 === 2) this.hat(t, 0.035);
    // Triangle bass: bouncing octaves, a gallop for the boss, long low notes in space.
    const pattern = boss ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15] : space ? [0, 6, 8, 14] : menu ? [0, 3, 6, 8, 11, 14] : garden ? [0, 4, 6, 8, 12, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
    if (pattern.includes(s)) {
      const up = boss ? s % 4 === 3 : space ? s === 14 : garden ? s % 8 === 6 : s % 4 === 2 || (menu && s % 8 === 3);
      this.bass(root + 12 + (up ? 12 : 0), t, sd * (boss ? 0.9 : space ? 3 : 1.6));
    }
    // Pulse 2: the chord as a fast arpeggio, the classic chip-tune "chord".
    if (arps && (boss || s % 2 === 0)) {
      const chord = [0, minor ? 3 : 4, 7].map((n) => root + 24 + n);
      this.arp(chord, t, sd * (boss ? 1 : 2), boss ? 0.15 : space ? 0.13 : 0.17);
    }
    // Pulse 1: the melody (rounder, on the 50% wave, out in space).
    if (melody) {
      const steps = song.steps[this.bar];
      const n = steps[s];
      if (n !== null && n > 0) {
        let len = 1;
        while (s + len < 16 && steps[s + len] === null) len++;
        this.lead(n, t, sd * len, boss || garden ? 0.125 : space ? 0.5 : 0.25, menu ? 0.34 : space ? 0.3 : 0.38);
      }
    }
  }

  // ---- the chip's channels
  // A pulse or triangle note with the chip's stepped volume envelope (a quick attack, then a
  // decay in four steps), and vibrato on long notes.
  chip(wave, f, t, dur, vol, { decay = 0.6, vibrato = false } = {}) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(f, t);
    if (vibrato && dur > 0.3) {
      // A wobble that starts after the note has sounded for a moment.
      for (let x = t + 0.18, up = true; x < t + dur; x += 1 / 12, up = !up) o.detune.setValueAtTime(up ? 18 : -18, x);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    for (let i = 1; i <= 4; i++) g.gain.setValueAtTime(vol * (1 - (i / 4) * (1 - decay)), t + (dur * i) / 5);
    g.gain.setValueAtTime(0, t + dur);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  lead(m, t, dur, duty, vol) {
    this.chip(this.pulse[duty], midiHz(m), t, dur * 0.92, vol, { vibrato: true });
  }

  // Cycles the chord's notes every 1/60 s, like a chip arpeggio.
  arp(chord, t, dur, vol) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    o.setPeriodicWave(this.pulse[0.125]);
    for (let x = t, i = 0; x < t + dur; x += 1 / 60, i++) o.frequency.setValueAtTime(midiHz(chord[i % chord.length]), x);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol * 0.6, t + dur * 0.5);
    g.gain.setValueAtTime(0, t + dur * 0.95);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur);
  }

  bass(m, t, dur) {
    this.chip(this.triWave, midiHz(m), t, dur, 0.22, { decay: 1 });
  }

  noiseHit(t, dur, vol, type, f) {
    const c = this.sfx.ctx;
    const s = c.createBufferSource();
    s.buffer = this.sfx.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = c.createGain();
    // Stepped decay, like the chip's envelope.
    g.gain.setValueAtTime(vol, t);
    for (let i = 1; i <= 3; i++) g.gain.setValueAtTime(vol * (1 - i / 4), t + (dur * i) / 4);
    g.gain.setValueAtTime(0, t + dur);
    s.connect(fl).connect(g).connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // A chip kick: the triangle swept down fast, with a tick of noise.
  kick(t) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    o.setPeriodicWave(this.triWave);
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.setValueAtTime(0, t + 0.11);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.12);
    this.noiseHit(t, 0.03, 0.12, 'lowpass', 2500);
  }

  snare(t, vol) {
    this.noiseHit(t, 0.13, vol, 'bandpass', 2200);
  }

  hat(t, vol) {
    this.noiseHit(t, 0.035, vol, 'highpass', 7000);
  }

  // A noise-drum roll into the next bar when the music steps up or changes theme.
  roll(t) {
    const sd = this.stepDur();
    const c = this.sfx.ctx;
    for (let i = 4; i >= 1; i--) {
      const x = t - (sd / 2) * i;
      if (x > c.currentTime) this.noiseHit(x, sd * 0.4, 0.06 + (4 - i) * 0.03, 'bandpass', 2600);
    }
  }
}
