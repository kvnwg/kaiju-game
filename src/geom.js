// Small 2D geometry helpers shared by the simulation modules.
export function norm(x, y) {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export function distToRect(px, py, o) {
  const dx = Math.max(Math.abs(px - o.x) - o.w / 2, 0);
  const dy = Math.max(Math.abs(py - o.y) - o.h / 2, 0);
  return Math.hypot(dx, dy);
}

export function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / len2));
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

export function closestPoint(px, py, o) {
  return {
    x: Math.max(o.x - o.w / 2, Math.min(px, o.x + o.w / 2)),
    y: Math.max(o.y - o.h / 2, Math.min(py, o.y + o.h / 2)),
  };
}

// Smallest signed difference between two angles.
export function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
