// 2D vector helpers. Points are plain {x, y} objects in millimetres, Y axis up.

export const EPS = 1e-9;
export const TAU = Math.PI * 2;

export const v = (x = 0, y = 0) => ({ x, y });
export const copy = (a) => ({ x: a.x, y: a.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Left normal (rotate +90°). */
export const perp = (a) => ({ x: -a.y, y: a.x });
export const neg = (a) => ({ x: -a.x, y: -a.y });
export const angleOf = (a) => Math.atan2(a.y, a.x);
export const fromAngle = (t, l = 1) => ({ x: Math.cos(t) * l, y: Math.sin(t) * l });
/** Add a scaled vector: a + d * s */
export const addScaled = (a, d, s) => ({ x: a.x + d.x * s, y: a.y + d.y * s });

export function norm(a) {
  const l = Math.hypot(a.x, a.y);
  return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function eq(a, b, eps = 1e-6) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

export function rotate(p, ang, c = { x: 0, y: 0 }) {
  const s = Math.sin(ang), co = Math.cos(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

/** Normalise an angle into (-PI, PI]. */
export function normAngle(a) {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Positive modulo into [0, m). */
export function posMod(a, m) {
  const r = a % m;
  return r < 0 ? r + m : r;
}

export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Closest point on segment ab to p. Returns {t, point, dist}. */
export function projectToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > EPS ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, dist: dist(p, point) };
}

/** Distance from p to the infinite line through a with direction d (unit). */
export function distToLine(p, a, d) {
  return Math.abs(cross(d, sub(p, a)));
}

/**
 * Intersection of lines p + t*d and q + u*e. Returns {t, u, point} or null when parallel.
 */
export function lineLine(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(q, p);
  const t = cross(w, e) / den;
  const u = cross(w, d) / den;
  return { t, u, point: { x: p.x + d.x * t, y: p.y + d.y * t } };
}

/** Segment-segment intersection (a-b with c-d). Returns {t, u, point} or null. */
export function segSeg(a, b, c, d, eps = 1e-9) {
  const r = sub(b, a), s = sub(d, c);
  const hit = lineLine(a, r, c, s);
  if (!hit) return null;
  if (hit.t < -eps || hit.t > 1 + eps || hit.u < -eps || hit.u > 1 + eps) return null;
  return hit;
}

/** Intersections of the line p + t*d (d unit) with a circle. Returns array of t values. */
export function lineCircle(p, d, c, r) {
  const f = sub(p, c);
  const b = dot(f, d);
  const cc = dot(f, f) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [-b - sq, -b + sq];
}

/** Intersection points of two circles. */
export function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const px = c1.x + ux * a, py = c1.y + uy * a;
  return [
    { x: px - uy * h, y: py + ux * h },
    { x: px + uy * h, y: py - ux * h },
  ];
}

export function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxUnion(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxValid(b) {
  return b && Number.isFinite(b.minX) && Number.isFinite(b.maxX) && b.maxX >= b.minX && b.maxY >= b.minY;
}

/** Round to the nearest multiple of step. */
export function roundTo(x, step) {
  return step > 0 ? Math.round(x / step) * step : x;
}

/** A "nice" step (1, 2, 5 x 10^n) at least as big as x. */
export function niceStep(x, steps = [1, 2, 5]) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const s of steps) if (s * p >= x - 1e-12) return s * p;
  return 10 * p;
}
