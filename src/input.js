// One-thumb controls: drag anywhere for a floating virtual stick; WASD / arrows on desktop.
// Charge: Space or Shift, or the on-screen button. Keys are read by position (KeyboardEvent.code),
// so WASD stays under the same fingers on any layout (ZQSD on AZERTY).
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
    this.dashQueued = false;
    window.addEventListener('keydown', (e) => {
      // Arrows and Space would scroll the page around the game.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.key === 'Shift') this.dashQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
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

  // True once per press of the charge button.
  takeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  get() {
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || ky) return { x: kx, y: ky };
    return this.vec;
  }
}
