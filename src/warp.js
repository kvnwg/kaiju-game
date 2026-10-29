// The zoom-out between realms, drawn over the game in chunky pixels while the camera pulls back:
// stars streaking past on the way out into space; the multiverse shrinking to a speck until
// everything goes green (it was a dewdrop on a blade of grass); and climbing out of the flower
// bed, back to where it all began. A title card names where the kaiju has landed.
import { STAGES, REALMS } from './config.js';

const TAGLINE = {
  solar: 'You outgrew the Earth. Out here, everything is food.',
  galaxy: 'You outgrew the Solar System. Stars are snacks now.',
  cosmos: 'You outgrew the galaxy. Whole universes, for dessert.',
  garden: 'The whole multiverse was a dewdrop on a blade of grass. You are ant-sized now.',
  city: 'Back where it all began. Every universe is a speck in somebody’s garden.',
};
const STREAK = {
  solar: ['#ffffff', '#bfe6ff', '#ffe9b8'],
  galaxy: ['#ffffff', '#ffb8e8', '#bfe6ff', '#fff2b0'],
  cosmos: ['#ffffff', '#9fd8ff', '#ffb8e8', '#d6b8ff'],
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class WarpOverlay {
  constructor(el) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.card = el.querySelector('.warp-card');
    this.text = el.querySelector('.warp-text');
    this.active = null;
    this.parts = [];
  }

  cancel() {
    this.active = null;
    this.el.classList.add('hidden');
    this.card.classList.remove('show');
  }

  start(e) {
    const kind = e.to === 'garden' ? 'green' : e.to === 'city' ? 'home' : 'space';
    this.active = { ...e, kind, cardShown: false, doneAt: 0 };
    this.parts = [];
    for (let i = 0; i < 240; i++) {
      this.parts.push({ a: Math.random() * Math.PI * 2, r: Math.pow(Math.random(), 0.6), s: 0.5 + Math.random(), c: Math.floor(Math.random() * 4), w: Math.random() });
    }
    this.el.classList.remove('hidden', 'out');
    this.card.classList.remove('show');
    this.text.textContent = '';
    this.resize();
  }

  resize() {
    // A third of the screen's resolution, blown up with crisp pixels.
    const w = Math.max(160, Math.round(window.innerWidth / 3));
    const h = Math.max(120, Math.round(window.innerHeight / 3));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // warp: the game's warp state (null once it is over); called every frame.
  update(warp) {
    const A = this.active;
    if (!A) return;
    if (!warp) {
      // The card lingers a moment over the new realm, then everything fades away.
      if (!A.doneAt) {
        A.doneAt = performance.now();
        this.draw(1);
      }
      if (performance.now() - A.doneAt > 2200) {
        this.el.classList.add('out');
        this.card.classList.remove('show');
        if (performance.now() - A.doneAt > 2800) {
          this.el.classList.add('hidden');
          this.active = null;
        }
      }
      return;
    }
    const f = Math.min(1, warp.t / warp.dur);
    this.resize();
    this.draw(f);
    if (f >= 0.55 && !A.cardShown) {
      A.cardShown = true;
      this.showCard();
    }
  }

  showCard() {
    const A = this.active;
    const st = STAGES[A.stage];
    const loop = A.to === 'city';
    this.card.innerHTML = `<small>${loop ? `Size ${A.stage} · ${st.name}` : REALMS[A.to].name}</small><b>${loop ? `Loop ${A.loop}` : `Size ${A.stage} · ${st.name}`}</b><span>${TAGLINE[A.to] || ''}</span>`;
    this.card.classList.add('show');
  }

  draw(f) {
    const A = this.active;
    const x = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.hypot(W, H) / 2;
    x.clearRect(0, 0, W, H);
    // How much the overlay covers the game: it closes in on the way out and opens on the way in.
    const cover = f < 0.5 ? smooth(0.1, 0.42, f) : 1 - smooth(0.58, 0.86, f);
    if (A.kind === 'space') {
      const cols = STREAK[A.to] || STREAK.solar;
      x.globalAlpha = cover;
      const bg = x.createRadialGradient(cx, cy, 0, cx, cy, R);
      bg.addColorStop(0, '#000000');
      bg.addColorStop(1, A.to === 'galaxy' ? '#2a0e46' : A.to === 'cosmos' ? '#081632' : '#100c2c');
      x.fillStyle = bg;
      x.fillRect(0, 0, W, H);
      // Stars rushing past, streaks stretching as the speed builds.
      const speed = f < 0.5 ? smooth(0, 0.5, f) : 1 - smooth(0.5, 1, f) * 0.85;
      x.globalAlpha = Math.min(1, cover * 1.4);
      for (const p of this.parts) {
        const r0 = ((p.r + f * p.s * 2.2) % 1) * R;
        const len = 2 + speed * R * 0.35 * p.s * (r0 / R);
        x.strokeStyle = cols[p.c % cols.length];
        x.lineWidth = p.w < 0.8 ? 1 : 2;
        x.beginPath();
        x.moveTo(Math.round(cx + Math.cos(p.a) * r0), Math.round(cy + Math.sin(p.a) * r0));
        x.lineTo(Math.round(cx + Math.cos(p.a) * (r0 + len)), Math.round(cy + Math.sin(p.a) * (r0 + len)));
        x.stroke();
      }
      // A white flash at the hand-over.
      const flash = 1 - Math.min(1, Math.abs(f - 0.5) / 0.06);
      if (flash > 0) {
        x.globalAlpha = flash;
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, W, H);
      }
    } else if (A.kind === 'green') {
      // Everything shrinks into the middle... and the green comes in from the edges.
      x.globalAlpha = cover;
      x.fillStyle = '#05040f';
      x.fillRect(0, 0, W, H);
      if (f < 0.5) {
        const shrink = 1 - smooth(0.05, 0.47, f);
        for (const p of this.parts) {
          const r = p.r * R * shrink;
          x.fillStyle = ['#ffffff', '#9fd8ff', '#ffb8e8', '#d6b8ff'][p.c];
          x.fillRect(Math.round(cx + Math.cos(p.a) * r), Math.round(cy + Math.sin(p.a) * r), 1, 1);
        }
      }
      const green = smooth(0.22, 0.48, f) * (f < 0.5 ? 1 : 1);
      if (green > 0) {
        const gr = x.createRadialGradient(cx, cy, R * (1 - green) * 0.9, cx, cy, R * (1.05 - green * 0.6));
        gr.addColorStop(0, 'rgba(79,138,56,0)');
        gr.addColorStop(1, 'rgba(79,138,56,1)');
        x.fillStyle = gr;
        x.fillRect(0, 0, W, H);
        if (f > 0.4) {
          // Full green: blades of grass, and a dewdrop with a speck of light in it.
          x.globalAlpha = cover * smooth(0.4, 0.48, f);
          x.fillStyle = '#4f8a38';
          x.fillRect(0, 0, W, H);
          for (let i = 0; i < 70; i++) {
            const bx = (i * 37) % W;
            const bh = H * (0.25 + ((i * 53) % 40) / 100);
            x.fillStyle = ['#5f9a44', '#6cab4a', '#7cbc52', '#467d30'][i % 4];
            x.fillRect(bx, H - bh, 2 + (i % 3), bh);
          }
          const dr = Math.min(W, H) * 0.16;
          x.fillStyle = 'rgba(200,240,255,0.55)';
          x.beginPath();
          x.arc(cx, cy, dr, 0, Math.PI * 2);
          x.fill();
          x.fillStyle = 'rgba(255,255,255,0.8)';
          x.fillRect(Math.round(cx - dr * 0.45), Math.round(cy - dr * 0.5), 3, 3);
          x.fillStyle = '#ffffff';
          x.fillRect(Math.round(cx), Math.round(cy), 1, 1);
        }
      }
      this.say(f < 0.22 ? '' : f < 0.38 ? 'Wait...' : f < 0.535 ? '...is that GRASS?' : '');
    } else {
      // Climbing out of the flower bed: blades rushing up past, into the light.
      x.globalAlpha = cover;
      const sky = x.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#ffe6b8');
      sky.addColorStop(1, '#f6a8c8');
      x.fillStyle = sky;
      x.fillRect(0, 0, W, H);
      if (f < 0.5) {
        const up = smooth(0, 0.5, f);
        for (let i = 0; i < 60; i++) {
          const bx = (i * 41) % W;
          const bh = H * (1.2 - up * 1.4) + ((i * 29) % 30);
          if (bh <= 0) continue;
          x.fillStyle = ['#5f9a44', '#6cab4a', '#7cbc52', '#467d30'][i % 4];
          x.fillRect(bx, H - bh, 3 + (i % 3), bh);
        }
      }
      const flash = 1 - Math.min(1, Math.abs(f - 0.5) / 0.07);
      if (flash > 0) {
        x.globalAlpha = flash;
        x.fillStyle = '#fffaf0';
        x.fillRect(0, 0, W, H);
      }
      this.say(f < 0.18 ? '' : f < 0.46 ? 'Climbing out of the flower bed...' : '');
    }
    x.globalAlpha = 1;
  }

  say(text) {
    if (this.text.textContent !== text) this.text.textContent = text;
  }
}
