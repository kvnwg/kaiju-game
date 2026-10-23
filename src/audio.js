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

  // Browsers only start audio after a user gesture.
  unlock() {
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
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
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
    this.tone({ type: 'triangle', f0: 380, f1: 140, dur: 0.11, vol: 0.22 });
    this.tone({ type: 'square', f0: 900, f1: 600, dur: 0.03, vol: 0.05 });
  }

  squeak() {
    if (!this.ok('squeak', 0.08)) return;
    const f = 900 + Math.random() * 300;
    this.tone({ type: 'square', f0: f, f1: f * 1.5, dur: 0.07, vol: 0.05 });
  }

  chomp() {
    if (!this.ok('chomp', 0.06)) return;
    this.noise({ dur: 0.07, vol: 0.2, f0: 2600, f1: 700, type: 'bandpass', q: 1.6 });
    this.tone({ type: 'square', f0: 220, f1: 90, dur: 0.06, vol: 0.1 });
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
