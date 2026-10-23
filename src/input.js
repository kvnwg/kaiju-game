// One-thumb controls: drag anywhere for a floating virtual stick; WASD / arrows on desktop.
export class Input {
  constructor(surface, stickEl) {
    this.surface = surface;
    this.stickEl = stickEl;
    this.knob = stickEl.querySelector('.knob');
    this.keys = new Set();
    this.pointer = null;
    this.vec = { x: 0, y: 0 };
    this.radius = 56;
    this.touchedAt = 0;

    surface.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });
  }

  onDown(e) {
    if (this.pointer) return;
    this.pointer = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    this.vec = { x: 0, y: 0 };
    this.stickEl.style.left = `${e.clientX}px`;
    this.stickEl.style.top = `${e.clientY}px`;
    this.stickEl.classList.add('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.touchedAt = performance.now();
  }

  onMove(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    let dx = e.clientX - p.ox;
    let dy = e.clientY - p.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    this.vec = d < 6 ? { x: 0, y: 0 } : { x: dx / this.radius, y: dy / this.radius };
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  onUp(e) {
    if (this.pointer && e.pointerId === this.pointer.id) this.release();
  }

  release() {
    this.pointer = null;
    this.vec = { x: 0, y: 0 };
    this.stickEl.classList.remove('active');
  }

  get() {
    const k = this.keys;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const ky = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (kx || ky) return { x: kx, y: ky };
    return this.vec;
  }
}
