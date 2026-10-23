import { WORLD, MAX_STAGE } from './config.js';

const ZONE_COLORS = { suburb: '#a7c48a', commercial: '#c9c1ae', downtown: '#aeb3ba', docks: '#b5ab98' };
const shadeCache = new Map();

// Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour.
export function shade(hex, amt) {
  const key = hex + amt;
  let out = shadeCache.get(key);
  if (out) return out;
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  out = `rgb(${r},${g},${b})`;
  shadeCache.set(key, out);
  return out;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.t = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  snapCamera(game) {
    const k = game.kaiju;
    this.cam.x = k.x;
    this.cam.y = k.y;
    this.cam.zoom = Math.min(this.w, this.h) / game.viewSpan(k.r);
  }

  render(game, realDt) {
    const { ctx, cam } = this;
    this.t += realDt;
    const k = game.kaiju;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();

    const targetZoom = Math.min(this.w, this.h) / game.viewSpan(k.r);
    cam.zoom += (targetZoom - cam.zoom) * Math.min(1, realDt * 2.5);
    const lookX = k.x + k.facing.x * k.r * 1.5;
    const lookY = k.y + k.facing.y * k.r * 1.5;
    cam.x += (lookX - cam.x) * Math.min(1, realDt * 4);
    cam.y += (lookY - cam.y) * Math.min(1, realDt * 4);

    const z = cam.zoom;
    const shake = game.shake * game.shake * Math.min(this.w, this.h) * 0.02;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    const halfW = this.w / 2 / z;
    const halfH = this.h / 2 / z;
    const view = { x0: cam.x - halfW - 60, y0: cam.y - halfH - 260, x1: cam.x + halfW + 60, y1: cam.y + halfH + 60 };
    this.view = view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#6f8f5a'; // countryside around the city
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 - cam.x * z + sx), this.dpr * (this.h / 2 - cam.y * z + sy));

    this.drawGround(game, view, z);
    const objs = game.grid.query(view.x0, view.y0, view.x1, view.y1);
    for (const o of objs) if (o.state === 'rubble') this.drawRubble(o, z);
    this.drawFires(game);
    this.drawHazards(game, false);

    // Depth-sort standing things by their base line.
    const drawables = [];
    for (const o of objs) if (o.state !== 'rubble') drawables.push({ y: o.y + o.h / 2, o });
    for (const u of game.units) if (!u.flying) drawables.push({ y: u.y + u.r, u });
    drawables.push({ y: k.y + k.r * 0.6, kaiju: true });
    if (game.boss && !game.boss.dead) drawables.push({ y: game.boss.y + game.boss.r * 0.6, boss: true });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
      if (d.o) this.drawObject(d.o, z, game);
      else if (d.u) this.drawUnit(d.u, z, game);
      else if (d.kaiju) this.drawKaiju(game);
      else if (d.boss) this.drawBoss(game);
    }

    for (const u of game.units) if (u.flying) this.drawUnit(u, z, game);
    this.drawHazards(game, true);
    this.drawProjectiles(game);
    this.drawFx(game, z);
    this.drawIndicators(game);
  }

  // ---------------------------------------------------------------- ground
  drawGround(game, v, z) {
    const { ctx } = this;
    const sea = WORLD.seaWidth;
    ctx.fillStyle = '#2f6fb3';
    ctx.fillRect(Math.min(v.x0, 0), v.y0, sea - Math.min(v.x0, 0), v.y1 - v.y0);
    // Waves
    if (v.x0 < sea) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2 / z;
      const step = 90;
      for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) {
        for (let x = Math.floor(v.x0 / step) * step; x < Math.min(sea, v.x1); x += step) {
          const ox = Math.sin(this.t * 1.5 + y * 0.05 + x * 0.02) * 12;
          ctx.beginPath();
          ctx.moveTo(x + ox, y);
          ctx.quadraticCurveTo(x + ox + 15, y - 6, x + ox + 30, y);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = '#e3d29b';
    ctx.fillRect(sea - 36, 0, 40, WORLD.height);
    ctx.fillStyle = '#585c63';
    ctx.fillRect(sea, 0, WORLD.width - sea, WORLD.height);
    const p = game.city.pier;
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(p.x, p.y - p.h / 2, p.w, p.h);

    for (const b of game.city.blocks) {
      if (b.x > v.x1 || b.x + b.w < v.x0 || b.y > v.y1 || b.y + b.h < v.y0) continue;
      ctx.fillStyle = '#9a9a96';
      ctx.fillRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16); // sidewalk
      ctx.fillStyle = ZONE_COLORS[b.zone];
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    // Lane markings when close enough to read them.
    if (z * WORLD.cell > 160) {
      ctx.strokeStyle = 'rgba(255,230,140,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 14]);
      ctx.beginPath();
      for (let c = 0; c <= WORLD.cols; c++) {
        const x = sea + c * WORLD.cell;
        if (x < v.x0 || x > v.x1) continue;
        ctx.moveTo(x, Math.max(0, v.y0));
        ctx.lineTo(x, Math.min(WORLD.height, v.y1));
      }
      for (let r = 0; r <= WORLD.rows; r++) {
        const y = r * WORLD.cell;
        if (y < v.y0 || y > v.y1) continue;
        ctx.moveTo(Math.max(sea, v.x0), y);
        ctx.lineTo(Math.min(WORLD.width, v.x1), y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawRubble(o, z) {
    const { ctx } = this;
    if (o.w * z < 1.5) return;
    ctx.fillStyle = o.structure ? '#7d776d' : '#6d6a66';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(o.x - o.w * 0.45, o.y - o.h * 0.45, o.w * 0.9, o.h * 0.9);
    ctx.globalAlpha = 1;
    if (!o.structure || o.w * z < 8) return;
    let s = o.seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 6; i++) {
      const cw = o.w * (0.12 + rnd() * 0.18);
      ctx.fillStyle = i % 2 ? shade(o.color, -0.35) : '#5f5a52';
      ctx.fillRect(o.x - o.w * 0.4 + rnd() * o.w * 0.7, o.y - o.h * 0.4 + rnd() * o.h * 0.7, cw, cw * 0.7);
    }
  }

  drawFires(game) {
    const { ctx } = this;
    for (const f of game.fires) {
      const a = Math.min(1, f.t / 0.6) * 0.55;
      ctx.fillStyle = `rgba(255,${100 + Math.floor(60 * Math.sin(this.t * 20 + f.x))},20,${a})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.8 + 0.1 * Math.sin(this.t * 12 + f.y)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- objects
  drawObject(o, z, game) {
    const { ctx } = this;
    const size = Math.max(o.w, o.h);
    if (size * z < 1.2) return;
    if (!o.structure) return this.drawProp(o, z);

    let lift = o.height * 0.4;
    let ox = 0;
    let oy = 0;
    let alpha = 1;
    if (o.state === 'collapsing') {
      const p = Math.min(1, o.collapseT);
      lift *= Math.pow(1 - p, 1.6);
      ox = o.fallDir.x * size * 0.55 * p;
      oy = o.fallDir.y * size * 0.55 * p;
      alpha = 1 - Math.max(0, p - 0.7) / 0.3;
    }
    ctx.globalAlpha = alpha;
    const x = o.x - o.w / 2 + ox;
    const y = o.y - o.h / 2 + oy;

    // Shadow cast to the south-east.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + lift * 0.35, y + lift * 0.1, o.w, o.h);

    if (o.round) {
      this.drawRoundStructure(o, x + o.w / 2, y + o.h / 2, lift);
      ctx.globalAlpha = 1;
      return;
    }

    const wall = shade(o.color, -0.28);
    ctx.fillStyle = wall;
    ctx.fillRect(x, y + o.h - lift, o.w, lift);
    // Windows on the visible face of tall buildings.
    if (o.tier >= 3 && lift * z > 14 && o.kind !== 'garage') {
      ctx.fillStyle = 'rgba(255,240,180,0.55)';
      const rows = Math.max(1, Math.floor(lift / 12));
      const cols = Math.max(1, Math.floor(o.w / 14));
      const cw = o.w / cols;
      const rh = lift / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if ((r * 7 + c * 3 + o.seed) % 5 === 0) continue;
        ctx.fillRect(x + c * cw + cw * 0.25, y + o.h - lift + r * rh + rh * 0.25, cw * 0.5, rh * 0.45);
      }
    }
    const roofY = y - lift;
    ctx.fillStyle = o.roof || shade(o.color, 0.1);
    ctx.fillRect(x, roofY, o.w, o.h);
    this.drawRoofDetail(o, x, roofY, z);

    if (o.hp < o.maxHp * 0.5 && o.state === 'intact') {
      ctx.strokeStyle = 'rgba(20,20,20,0.7)';
      ctx.lineWidth = Math.max(1 / z, size * 0.02);
      ctx.beginPath();
      ctx.moveTo(x + o.w * 0.2, roofY + o.h * 0.1);
      ctx.lineTo(x + o.w * 0.45, roofY + o.h * 0.5);
      ctx.lineTo(x + o.w * 0.35, roofY + o.h * 0.9);
      ctx.moveTo(x + o.w * 0.45, roofY + o.h * 0.5);
      ctx.lineTo(x + o.w * 0.8, roofY + o.h * 0.6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x, roofY, o.w, o.h + lift);
    }
    if (o.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, roofY, o.w, o.h + lift);
    }
    // Health bar on tough targets being worked on.
    if (o.state === 'intact' && o.hp < o.maxHp && o.tier >= game.kaiju.stage) {
      const bw = o.w * 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(o.x - bw / 2, roofY - size * 0.12, bw, size * 0.06);
      ctx.fillStyle = '#ffcf3f';
      ctx.fillRect(o.x - bw / 2, roofY - size * 0.12, bw * (o.hp / o.maxHp), size * 0.06);
    }
    ctx.globalAlpha = 1;
  }

  drawRoofDetail(o, x, y, z) {
    const { ctx } = this;
    if (o.w * z < 10) return;
    ctx.fillStyle = shade(o.roof || o.color, -0.15);
    switch (o.kind) {
      case 'house':
        ctx.fillRect(x, y + o.h * 0.46, o.w, o.h * 0.08);
        break;
      case 'skyscraper':
        ctx.fillRect(x + o.w * 0.15, y + o.h * 0.15, o.w * 0.7, o.h * 0.7);
        ctx.fillStyle = shade(o.roof, 0.2);
        ctx.fillRect(x + o.w * 0.3, y + o.h * 0.3, o.w * 0.15, o.h * 0.15);
        ctx.fillRect(x + o.w * 0.55, y + o.h * 0.55, o.w * 0.12, o.h * 0.12);
        break;
      case 'apartment':
        ctx.fillRect(x + o.w * 0.1, y + o.h * 0.1, o.w * 0.2, o.h * 0.2);
        ctx.fillRect(x + o.w * 0.6, y + o.h * 0.55, o.w * 0.25, o.h * 0.25);
        break;
      case 'gasStation':
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + o.w * 0.05, y + o.h * 0.35, o.w * 0.9, o.h * 0.3);
        break;
      case 'stadium':
        ctx.fillStyle = '#6fbf4f';
        ctx.beginPath();
        ctx.ellipse(x + o.w / 2, y + o.h / 2, o.w * 0.35, o.h * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + o.w * 0.3, y + o.h * 0.3, o.w * 0.4, o.h * 0.4);
        break;
      case 'powerPlant':
        ctx.fillStyle = '#d7d2c8';
        for (const [cx, cy] of [[0.28, 0.35], [0.62, 0.35]]) {
          ctx.beginPath();
          ctx.arc(x + o.w * cx, y + o.h * cy, o.w * 0.14, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(x + o.w * 0.2, y + o.h * 0.72, o.w * 0.6, o.h * 0.08);
        break;
      case 'garage':
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        for (let i = 1; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(x + (o.w * i) / 6, y + o.h * 0.1);
          ctx.lineTo(x + (o.w * i) / 6, y + o.h * 0.4);
          ctx.stroke();
        }
        break;
      case 'crane':
        ctx.fillStyle = '#c98a17';
        ctx.fillRect(x - o.w * 0.8, y + o.h * 0.4, o.w * 2.6, o.h * 0.2);
        break;
      default:
        break;
    }
  }

  drawRoundStructure(o, cx, cy, lift) {
    const { ctx } = this;
    const r = o.w / 2;
    if (o.kind === 'lighthouse') {
      const topR = r * 0.55;
      const stripes = 6;
      for (let i = 0; i < stripes; i++) {
        const y0 = cy - (lift * i) / stripes;
        const rr = r - ((r - topR) * i) / stripes;
        ctx.fillStyle = i % 2 ? '#d23c3c' : '#f4f4f4';
        ctx.fillRect(cx - rr, y0 - lift / stripes, rr * 2, lift / stripes + 1);
      }
      ctx.fillStyle = '#f4f4f4';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(cx, cy - lift, topR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe680';
      ctx.beginPath();
      ctx.arc(cx, cy - lift, topR * 0.6, 0, Math.PI * 2);
      ctx.fill();
      // Rotating beam
      const a = this.t * 1.2;
      ctx.fillStyle = 'rgba(255,240,150,0.12)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - lift);
      ctx.arc(cx, cy - lift, r * 4, a - 0.12, a + 0.12);
      ctx.closePath();
      ctx.fill();
      if (o.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(cx - r, cy - lift, r * 2, lift);
      }
      return;
    }
    // Trees and other round things.
    ctx.fillStyle = shade(o.color, -0.3);
    ctx.fillRect(cx - r * 0.2, cy - lift, r * 0.4, lift);
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.arc(cx, cy - lift, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawProp(o, z) {
    const { ctx } = this;
    const x = o.x - o.w / 2;
    const y = o.y - o.h / 2;
    if (o.w * z < 4) {
      ctx.fillStyle = o.color;
      ctx.fillRect(x, y, o.w, o.h);
      return;
    }
    switch (o.kind) {
      case 'car': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 1.5, y + 1.5, o.w, o.h);
        ctx.fillStyle = o.color;
        ctx.fillRect(x, y, o.w, o.h);
        ctx.fillStyle = 'rgba(30,40,60,0.75)';
        if (o.w > o.h) ctx.fillRect(x + o.w * 0.3, y + 1, o.w * 0.4, o.h - 2);
        else ctx.fillRect(x + 1, y + o.h * 0.3, o.w - 2, o.h * 0.4);
        break;
      }
      case 'lamppost':
        ctx.fillStyle = '#6b7075';
        ctx.fillRect(x, y, o.w, o.h);
        ctx.fillStyle = 'rgba(255,240,170,0.9)';
        ctx.fillRect(x + 0.5, y - o.height * 0.5, 2, 2);
        break;
      case 'tree':
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.arc(o.x + 2, o.y + 2, o.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = o.color;
        ctx.beginPath();
        ctx.arc(o.x, o.y - 2, o.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shade(o.color, 0.18);
        ctx.beginPath();
        ctx.arc(o.x - o.w * 0.15, o.y - 2 - o.w * 0.15, o.w * 0.22, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'kiosk':
        ctx.fillStyle = o.color;
        ctx.fillRect(x, y - 3, o.w, o.h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y - 3, o.w, o.h * 0.3);
        break;
      default:
        ctx.fillStyle = o.color;
        ctx.fillRect(x, y, o.w, o.h);
        if (o.kind === 'container') {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          for (let i = 1; i < 4; i++) ctx.fillRect(x + (o.w * i) / 4, y, 0.8, o.h);
        }
    }
    if (o.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x, y, o.w, o.h);
    }
  }

  // ---------------------------------------------------------------- units
  drawUnit(u, z, game) {
    const { ctx } = this;
    if (u.type === 'jet' && u.warn > 0) return;
    if (u.r * 2 * z < 1.5) return;
    ctx.save();
    if (u.flying) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(u.x + u.r * 1.2, u.y + u.r * 1.8, u.r, u.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.translate(u.x, u.y);
    const r = u.r;
    const flash = u.flash > 0;
    switch (u.type) {
      case 'police': {
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#f2f2f2';
        ctx.fillRect(-r, -r * 0.55, r * 2, r * 1.1);
        ctx.fillStyle = '#1f3d8a';
        ctx.fillRect(-r * 0.4, -r * 0.55, r * 0.8, r * 1.1);
        ctx.fillStyle = Math.floor(this.t * 6) % 2 ? '#ff2a2a' : '#2a6bff';
        ctx.fillRect(-r * 0.15, -r * 0.5, r * 0.3, r);
        break;
      }
      case 'swat':
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#22293a';
        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        ctx.fillStyle = '#5c6a8a';
        ctx.fillRect(r * 0.3, -r * 0.5, r * 0.5, r);
        break;
      case 'dog':
        ctx.fillStyle = flash ? '#fff' : '#7a4f2a';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'roadblock':
        ctx.fillStyle = flash ? '#fff' : '#f08a24';
        ctx.fillRect(-r, -r * 0.3, r * 2, r * 0.6);
        ctx.fillStyle = '#fff';
        for (let i = -2; i <= 1; i += 2) ctx.fillRect(i * r * 0.4, -r * 0.3, r * 0.35, r * 0.6);
        ctx.fillStyle = '#2b2b2b';
        ctx.beginPath();
        ctx.arc(0, r * 0.6, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tank':
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#566b3a';
        ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
        ctx.fillStyle = '#2f3a20';
        ctx.fillRect(-r, -r * 0.8, r * 2, r * 0.22);
        ctx.fillRect(-r, r * 0.58, r * 2, r * 0.22);
        ctx.rotate(u.aim - u.heading);
        ctx.fillStyle = '#3e4f28';
        ctx.fillRect(0, -r * 0.12, r * 1.5, r * 0.24);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'infantry':
        ctx.fillStyle = flash ? '#fff' : '#4d5a32';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(u.aim);
        ctx.fillStyle = '#222';
        ctx.fillRect(0, -r * 0.25, r * 1.6, r * 0.5);
        break;
      case 'heli':
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#3d4d2e';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.8, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-r * 1.6, -r * 0.1, r, r * 0.2);
        ctx.strokeStyle = 'rgba(30,30,30,0.7)';
        ctx.lineWidth = r * 0.12;
        ctx.rotate(this.t * 25);
        ctx.beginPath();
        ctx.moveTo(-r * 1.2, 0);
        ctx.lineTo(r * 1.2, 0);
        ctx.moveTo(0, -r * 1.2);
        ctx.lineTo(0, r * 1.2);
        ctx.stroke();
        break;
      case 'jet':
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#9aa3ad';
        ctx.beginPath();
        ctx.moveTo(r * 1.3, 0);
        ctx.lineTo(-r, -r);
        ctx.lineTo(-r * 0.6, 0);
        ctx.lineTo(-r, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,170,60,0.8)';
        ctx.fillRect(-r * 1.6, -r * 0.15, r * 0.9, r * 0.3);
        break;
      case 'artillery':
        ctx.rotate(u.heading);
        ctx.fillStyle = flash ? '#fff' : '#6b6b4a';
        ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        ctx.rotate(u.aim - u.heading);
        ctx.fillStyle = '#3b3b28';
        ctx.fillRect(0, -r * 0.15, r * 2.2, r * 0.3);
        break;
      case 'mech': {
        const step = Math.sin(u.age * 6) * r * 0.3;
        ctx.rotate(u.heading);
        ctx.fillStyle = '#3a3f47';
        ctx.fillRect(-r * 0.5 + step, -r * 0.8, r * 0.6, r * 0.35);
        ctx.fillRect(-r * 0.5 - step, r * 0.45, r * 0.6, r * 0.35);
        ctx.rotate(u.aim - u.heading);
        ctx.fillStyle = flash ? '#fff' : '#8c939c';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(r * 0.3, -r * 0.15, r * 0.5, r * 0.3);
        break;
      }
      default:
        ctx.fillStyle = '#f0f';
        ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.restore();
    if (u.hp < u.maxHp && u.tier >= game.kaiju.stage) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(u.x - r, u.y - r * 1.8, r * 2, r * 0.3);
      ctx.fillStyle = '#ff5050';
      ctx.fillRect(u.x - r, u.y - r * 1.8, r * 2 * Math.max(0, u.hp / u.maxHp), r * 0.3);
    }
  }

  // ---------------------------------------------------------------- kaiju
  drawKaiju(game) {
    const { ctx } = this;
    const k = game.kaiju;
    const def = game.def;
    const r = k.r;
    const a = Math.atan2(k.facing.y, k.facing.x);
    const step = Math.sin(k.walkPhase) * (k.moving ? 1 : 0);
    if (k.invuln > 0 && Math.floor(this.t * 12) % 2) ctx.globalAlpha = 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(k.x + r * 0.15, k.y + r * 0.35, r * 1.15, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(a);

    // Tail
    if (def.id !== 'gorilla') {
      ctx.strokeStyle = def.color;
      ctx.lineCap = 'round';
      let px = -r * 0.7;
      let py = 0;
      for (let i = 0; i < 4; i++) {
        const nx = px - r * 0.42;
        const ny = Math.sin(this.t * 4 + i * 0.9 + k.walkPhase * 0.5) * r * 0.18 * (i + 1) * 0.5;
        ctx.lineWidth = r * (0.5 - i * 0.1);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        px = nx;
        py = ny;
      }
      if (def.id === 'ember') {
        ctx.fillStyle = `rgba(255,${140 + Math.floor(80 * Math.sin(this.t * 18))},40,0.9)`;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Legs
    ctx.fillStyle = def.dark;
    for (const [lx, ly, ph] of [[0.35, -0.7, 1], [0.35, 0.7, -1], [-0.4, -0.7, -1], [-0.4, 0.7, 1]]) {
      ctx.beginPath();
      ctx.ellipse(r * (lx + step * 0.18 * ph), r * ly, r * 0.28, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.05, r * 0.15, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Back plates / spikes / shell
    ctx.fillStyle = def.dark;
    if (def.id === 'volt') {
      ctx.globalAlpha *= 0.9;
      ctx.beginPath();
      ctx.ellipse(-r * 0.1, -r * 0.05, r * 0.75, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8fd8ff';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.05);
      ctx.lineTo(r * 0.6, -r * 0.05);
      ctx.stroke();
      ctx.globalAlpha = k.invuln > 0 && Math.floor(this.t * 12) % 2 ? 0.5 : 1;
    } else if (def.id === 'gorilla') {
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, 0, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 0; i < 4; i++) {
        const sx = r * (0.35 - i * 0.32);
        ctx.beginPath();
        ctx.moveTo(sx + r * 0.14, -r * 0.05);
        ctx.lineTo(sx, -r * 0.42);
        ctx.lineTo(sx - r * 0.14, -r * 0.05);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Arms / fists for the gorilla
    if (def.id === 'gorilla') {
      ctx.fillStyle = def.dark;
      const punch = k.lastAttack ? r * 0.25 : 0;
      ctx.beginPath();
      ctx.arc(r * 0.75 + punch, -r * 0.6, r * 0.28, 0, Math.PI * 2);
      ctx.arc(r * 0.75 + punch, r * 0.6, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head
    const bite = k.lastAttack && k.lastAttack.kind === 'bite' ? 1 : 0;
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.ellipse(r * 0.9, 0, r * 0.45, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    if (bite) {
      ctx.fillStyle = '#5a1a1a';
      ctx.beginPath();
      ctx.moveTo(r * 0.95, 0);
      ctx.lineTo(r * 1.4, -r * 0.22);
      ctx.lineTo(r * 1.4, r * 0.22);
      ctx.closePath();
      ctx.fill();
    }
    if (def.id === 'volt') {
      ctx.strokeStyle = def.dark;
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(r * 1.2, -r * 0.15);
      ctx.lineTo(r * 1.55, -r * 0.35);
      ctx.moveTo(r * 1.2, r * 0.15);
      ctx.lineTo(r * 1.55, r * 0.35);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(r * 1.05, s * r * 0.18, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = def.id === 'ember' ? '#ffcf3f' : '#111';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(r * 1.1, s * r * 0.18, r * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }

    if (k.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,80,80,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Debris shield (Magnetic Hide)
    if (k.shield > 0) {
      const n = Math.min(14, 3 + Math.floor((k.shield / k.maxHp) * 40));
      ctx.fillStyle = '#8b8478';
      for (let i = 0; i < n; i++) {
        const ang = this.t * 1.5 + (i / n) * Math.PI * 2;
        ctx.save();
        ctx.translate(k.x + Math.cos(ang) * r * 1.25, k.y + Math.sin(ang) * r * 1.0);
        ctx.rotate(ang * 2);
        ctx.fillRect(-r * 0.1, -r * 0.07, r * 0.2, r * 0.14);
        ctx.restore();
      }
    }

    // Ground pound / pound shock
    if (k.lastAttack && k.lastAttack.kind === 'pound') {
      ctx.strokeStyle = `rgba(255,240,200,${k.lastAttack.t * 3})`;
      ctx.lineWidth = r * 0.12;
      ctx.beginPath();
      ctx.arc(k.x, k.y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawBoss(game) {
    const { ctx } = this;
    const b = game.boss;
    const r = b.r;
    const step = Math.sin(b.walk * 3) * r * 0.15;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(b.x + r * 0.2, b.y + r * 0.4, r * 1.1, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.aim);
    // Legs
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(-r * 0.5 + step, -r * 0.85, r * 0.7, r * 0.35);
    ctx.fillRect(-r * 0.5 - step, r * 0.5, r * 0.7, r * 0.35);
    // Torso
    ctx.fillStyle = b.flash > 0 ? '#ffffff' : '#f2f2f2';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.75, r * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8611a';
    ctx.fillRect(-r * 0.15, -r * 0.65, r * 0.3, r * 1.3);
    ctx.fillStyle = '#1f3d8a';
    ctx.fillRect(r * 0.18, -r * 0.65, r * 0.08, r * 1.3);
    // Arm cannons
    ctx.fillStyle = '#5d6670';
    ctx.fillRect(r * 0.2, -r * 0.9, r * 0.9, r * 0.22);
    ctx.fillRect(r * 0.2, r * 0.68, r * 0.9, r * 0.22);
    // Missile pods
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(-r * 0.55, -r * 0.45, r * 0.3, r * 0.3);
    ctx.fillRect(-r * 0.55, r * 0.15, r * 0.3, r * 0.3);
    // Cockpit
    ctx.fillStyle = b.phase === 2 ? '#ff3b3b' : '#59c3ff';
    ctx.beginPath();
    ctx.arc(r * 0.45, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    if (b.state === 'windup' || b.state === 'charge') {
      ctx.fillStyle = 'rgba(255,80,40,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- hazards, projectiles, fx
  drawHazards(game, top) {
    const { ctx } = this;
    for (const h of game.hazards) {
      const p = Math.min(1, h.t / h.delay);
      const friendly = h.friendly;
      if (top !== Boolean(friendly)) continue;
      const base = friendly ? '255,170,40' : '255,40,40';
      if (h.kind === 'circle') {
        ctx.fillStyle = `rgba(${base},0.14)`;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${base},0.3)`;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * p, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${base},0.8)`;
        ctx.lineWidth = Math.max(2, h.r * 0.05);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
        if (friendly) {
          // Incoming meteor
          const fall = 1 - p;
          ctx.fillStyle = '#ff7a1a';
          ctx.beginPath();
          ctx.arc(h.x - fall * h.r * 3, h.y - fall * h.r * 6, h.r * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const dx = h.x2 - h.x1;
        const dy = h.y2 - h.y1;
        const len = Math.hypot(dx, dy);
        ctx.save();
        ctx.translate(h.x1, h.y1);
        ctx.rotate(Math.atan2(dy, dx));
        const jet = h.visualOnly && !h.onHit;
        ctx.fillStyle = jet ? 'rgba(255,200,40,0.16)' : `rgba(${base},0.14)`;
        ctx.fillRect(0, -h.w / 2, len, h.w);
        ctx.fillStyle = jet ? 'rgba(255,200,40,0.3)' : `rgba(${base},0.3)`;
        ctx.fillRect(0, -h.w / 2, len * p, h.w);
        ctx.strokeStyle = jet ? 'rgba(255,200,40,0.8)' : `rgba(${base},0.7)`;
        ctx.lineWidth = Math.max(2, h.w * 0.04);
        ctx.setLineDash([h.w * 0.4, h.w * 0.3]);
        ctx.strokeRect(0, -h.w / 2, len, h.w);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  drawProjectiles(game) {
    const { ctx } = this;
    for (const p of game.projectiles) {
      if (p.kind === 'bullet') {
        ctx.strokeStyle = '#ffe16b';
        ctx.lineWidth = p.r;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.kind === 'rock') {
        ctx.fillStyle = '#7d6a55';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,150,50,0.7)';
        ctx.lineWidth = p.r;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
        ctx.stroke();
        ctx.fillStyle = '#ddd';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawFx(game, z) {
    const { ctx } = this;
    const { particles, debris, orbs, floaters, rings, beams, bolts } = game.fx;
    for (const p of particles) {
      const a = p.life / p.max;
      ctx.globalAlpha = p.kind === 'dust' ? a * 0.6 : a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.kind === 'dust' ? p.size * (1.6 - a * 0.6) : p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const d of debris) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, d.life / 0.4);
      ctx.translate(d.x, d.y - d.z);
      ctx.rotate(d.rot);
      ctx.fillStyle = d.color;
      ctx.fillRect(-d.size / 2, -d.size / 2, d.size, d.size * 0.7);
      ctx.restore();
    }
    const orbR = Math.max(2.5, 4 / z);
    for (const o of orbs) {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(o.x, o.y, orbR, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of rings) {
      const p = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = r.width * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * p, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const b of beams) {
      const a = b.life / b.max;
      ctx.lineCap = 'round';
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = a * 0.6;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.width * 0.35;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const b of bolts) {
      ctx.strokeStyle = `rgba(160,220,255,${b.life / b.max})`;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      for (let i = 0; i < b.points.length - 1; i++) {
        const p0 = b.points[i];
        const p1 = b.points[i + 1];
        ctx.moveTo(p0.x, p0.y);
        const segs = 4;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const j = s === segs ? 0 : (Math.random() - 0.5) * Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.25;
          ctx.lineTo(p0.x + (p1.x - p0.x) * t + j, p0.y + (p1.y - p0.y) * t + j);
        }
      }
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 0.4);
      ctx.font = `bold ${Math.max(f.size, 12 / z)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(f.text, f.x + 1 / z, f.y + 1 / z);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // Edge arrows toward the boss, or toward the landmark once it can be broken.
  drawIndicators(game) {
    const { ctx, cam } = this;
    const targets = [];
    const b = game.boss;
    if (b && !b.dead) targets.push({ x: b.x, y: b.y, color: '#ff4d4d' });
    const lm = game.city.landmark;
    if (game.kaiju.stage >= MAX_STAGE && lm.state === 'intact') targets.push({ x: lm.x, y: lm.y, color: '#ffd84a' });
    if (!targets.length) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const t of targets) {
      const sx = (t.x - cam.x) * cam.zoom + this.w / 2;
      const sy = (t.y - cam.y) * cam.zoom + this.h / 2;
      if (sx > 0 && sx < this.w && sy > 0 && sy < this.h) continue;
      const a = Math.atan2(sy - this.h / 2, sx - this.w / 2);
      const m = 34;
      const ex = Math.max(m, Math.min(this.w - m, this.w / 2 + Math.cos(a) * this.w));
      const ey = Math.max(m + 70, Math.min(this.h - m - 40, this.h / 2 + Math.sin(a) * this.h));
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -11);
      ctx.lineTo(-10, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
