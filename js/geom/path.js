// Wall centre-line paths: straight lines and circular arcs, parameterised by arc length s.
//
// A curved wall is stored as its two end points plus a signed sagitta ("bulge" in mm):
// the distance from the chord midpoint to the arc's apex, positive when the arc bulges
// to the left of the a→b direction.

import {
  EPS, sub, mul, dot, cross, len, dist, mid, perp, addScaled, normAngle, clamp, lineCircle,
} from '../core/vec.js';

export class LinePath {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    const d = sub(b, a);
    this.length = len(d);
    this.dir = this.length > EPS ? mul(d, 1 / this.length) : { x: 1, y: 0 };
    this.nrm = perp(this.dir);
  }

  get isArc() {
    return false;
  }

  pointAt(s) {
    return addScaled(this.a, this.dir, s);
  }

  tangentAt() {
    return this.dir;
  }

  /** Left-hand unit normal. */
  normalAt() {
    return this.nrm;
  }

  /** Point at parameter s, offset d to the left (negative = right). */
  offsetAt(s, d) {
    return {
      x: this.a.x + this.dir.x * s + this.nrm.x * d,
      y: this.a.y + this.dir.y * s + this.nrm.y * d,
    };
  }

  /** Unclamped parameter of the projection of p. */
  paramOf(p) {
    return dot(sub(p, this.a), this.dir);
  }

  project(p) {
    const raw = this.paramOf(p);
    const s = clamp(raw, 0, this.length);
    const point = this.pointAt(s);
    const off = cross(this.dir, sub(p, point));
    return { s, raw, point, dist: dist(p, point), side: off >= 0 ? 1 : -1, offset: off };
  }

  /** The offset curve as a primitive used for join intersections. */
  offsetPrim(d) {
    return { kind: 'line', p: this.offsetAt(0, d), d: this.dir };
  }

  /** Parameters at which to sample between s0 and s1 (inclusive). */
  samples(s0, s1) {
    return [s0, s1];
  }

  polyline() {
    return [this.a, this.b];
  }

  midPoint() {
    return this.pointAt(this.length / 2);
  }

  bbox() {
    return {
      minX: Math.min(this.a.x, this.b.x),
      minY: Math.min(this.a.y, this.b.y),
      maxX: Math.max(this.a.x, this.b.x),
      maxY: Math.max(this.a.y, this.b.y),
    };
  }
}

export class ArcPath {
  constructor(a, b, sagitta) {
    this.a = a;
    this.b = b;
    this.sagitta = sagitta;
    const ch = sub(b, a);
    const c = len(ch);
    const h = c / 2;
    const dir = mul(ch, 1 / c);
    const nL = perp(dir);
    const s = sagitta;
    const r = (s * s + h * h) / (2 * Math.abs(s));
    const m = mid(a, b);
    this.chord = c;
    this.chordDir = dir;
    this.radius = r;
    this.apex = addScaled(m, nL, s);
    this.center = addScaled(m, nL, s - Math.sign(s) * r);
    const theta = 4 * Math.atan(Math.abs(s) / h);
    // Positive sagitta bulges left, which travels clockwise around the centre.
    this.sweep = s > 0 ? -theta : theta;
    this.a0 = Math.atan2(a.y - this.center.y, a.x - this.center.x);
    this.length = r * theta;
  }

  get isArc() {
    return true;
  }

  angleAt(s) {
    return this.a0 + this.sweep * (s / this.length);
  }

  pointAt(s) {
    const t = this.angleAt(s);
    return { x: this.center.x + this.radius * Math.cos(t), y: this.center.y + this.radius * Math.sin(t) };
  }

  tangentAt(s) {
    const t = this.angleAt(s);
    return this.sweep < 0 ? { x: Math.sin(t), y: -Math.cos(t) } : { x: -Math.sin(t), y: Math.cos(t) };
  }

  normalAt(s) {
    return perp(this.tangentAt(s));
  }

  /** Radius of the curve offset d to the left of the travel direction. */
  offsetRadius(d) {
    return this.radius + (this.sweep < 0 ? d : -d);
  }

  offsetAt(s, d) {
    const t = this.angleAt(s);
    const rr = this.offsetRadius(d);
    return { x: this.center.x + rr * Math.cos(t), y: this.center.y + rr * Math.sin(t) };
  }

  paramOf(p) {
    const ang = Math.atan2(p.y - this.center.y, p.x - this.center.x);
    const midAng = this.a0 + this.sweep / 2;
    const dd = normAngle(ang - midAng);
    return ((this.sweep / 2 + dd) / this.sweep) * this.length;
  }

  project(p) {
    const raw = this.paramOf(p);
    let s;
    if (raw >= 0 && raw <= this.length) s = raw;
    else s = dist(p, this.a) <= dist(p, this.b) ? 0 : this.length;
    const point = this.pointAt(s);
    const n = this.normalAt(s);
    const off = dot(sub(p, point), n);
    return { s, raw, point, dist: dist(p, point), side: off >= 0 ? 1 : -1, offset: off };
  }

  offsetPrim(d) {
    return { kind: 'circle', c: this.center, r: this.offsetRadius(d) };
  }

  /** Sample parameters between s0 and s1 with at most ~6° per segment. */
  samples(s0, s1, maxStep = Math.PI / 30) {
    const span = Math.abs(((s1 - s0) / this.length) * this.sweep);
    const n = Math.max(1, Math.ceil(span / maxStep));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(s0 + ((s1 - s0) * i) / n);
    return out;
  }

  polyline(maxStep = Math.PI / 30) {
    return this.samples(0, this.length, maxStep).map((s) => this.pointAt(s));
  }

  midPoint() {
    return this.apex;
  }

  bbox() {
    const pts = this.polyline(Math.PI / 36);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }
}

/** Build the centre-line path for a wall record {a, b, bulge}. */
export function makePath(a, b, bulge = 0) {
  const chord = dist(a, b);
  if (!bulge || Math.abs(bulge) < 0.5 || chord < 1) return new LinePath(a, b);
  return new ArcPath(a, b, bulge);
}

export function wallPath(w) {
  return makePath(w.a, w.b, w.bulge || 0);
}

/**
 * Sagitta of the arc from p0 to p1 passing through q. Returns 0 if collinear.
 */
export function sagittaFrom3(p0, q, p1) {
  const ax = p0.x, ay = p0.y, bx = q.x, by = q.y, cx = p1.x, cy = p1.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return 0;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const center = {
    x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  };
  const r = dist(center, p0);
  const chord = sub(p1, p0);
  const c = len(chord);
  if (c < EPS) return 0;
  const dir = mul(chord, 1 / c);
  const nL = perp(dir);
  const side = Math.sign(cross(dir, sub(q, p0))) || 1;
  const apex = addScaled(center, nL, side * r);
  return dot(sub(apex, mid(p0, p1)), nL);
}

/** Sagitta for an arc of radius r over the chord, on the given side (+1 left, -1 right). */
export function sagittaFromRadius(chord, r, side = 1, major = false) {
  const h = chord / 2;
  if (r < h) r = h;
  const k = Math.sqrt(Math.max(0, r * r - h * h));
  return side * (major ? r + k : r - k);
}

/**
 * Intersect two offset primitives (lines or circles); returns the solution
 * closest to `near`, or null.
 */
export function intersectPrims(p1, p2, near) {
  let candidates = [];
  if (p1.kind === 'line' && p2.kind === 'line') {
    const den = cross(p1.d, p2.d);
    if (Math.abs(den) < 1e-9) return null;
    const w = sub(p2.p, p1.p);
    const t = cross(w, p2.d) / den;
    candidates = [addScaled(p1.p, p1.d, t)];
  } else if (p1.kind === 'line' || p2.kind === 'line') {
    const L = p1.kind === 'line' ? p1 : p2;
    const C = p1.kind === 'line' ? p2 : p1;
    candidates = lineCircle(L.p, L.d, C.c, C.r).map((t) => addScaled(L.p, L.d, t));
  } else {
    candidates = circleCircleSafe(p1.c, p1.r, p2.c, p2.r);
  }
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = dist(c, near);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function circleCircleSafe(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-9 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const px = c1.x + ux * a, py = c1.y + uy * a;
  return [
    { x: px - uy * h, y: py + ux * h },
    { x: px + uy * h, y: py - ux * h },
  ];
}
