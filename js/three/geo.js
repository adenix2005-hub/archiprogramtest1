// Geometry helpers for the 3D model. Plan coordinates (x, y in mm, z = height)
// map to three.js metres as (x, z, -y).

import * as THREE from './lib.js';

export const M = 0.001;

/** Plan point + height (mm) -> three.js position array. */
export function V(p, z) {
  return [p.x * M, z * M, -p.y * M];
}

/** Plan direction -> three.js direction array (horizontal). */
export function D(n) {
  return [n.x, 0, -n.y];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Newell normal of a 3D polygon. */
export function polyNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm3([nx, ny, nz]);
}

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.idx = [];
  }

  get empty() {
    return this.idx.length === 0;
  }

  _v(p, n) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    return this.pos.length / 3 - 1;
  }

  /** Quad with a flat normal; vertex order is fixed up to face `hint`. */
  quad(p0, p1, p2, p3, hint) {
    let n = cross3(sub3(p1, p0), sub3(p3, p0));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) n = cross3(sub3(p2, p0), sub3(p3, p1));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-14) return;
    if (hint && dot3(n, hint) < 0) [p1, p3] = [p3, p1];
    const nn = hint ? norm3(hint) : norm3(n);
    const a = this._v(p0, nn), b = this._v(p1, nn), c = this._v(p2, nn), d = this._v(p3, nn);
    this.idx.push(a, b, c, a, c, d);
  }

  /** Quad with per-vertex normals (smooth curved faces). */
  quadN(p0, p1, p2, p3, n0, n1, n2, n3) {
    const n = cross3(sub3(p1, p0), sub3(p3, p0));
    const avg = [n0[0] + n1[0] + n2[0] + n3[0], n0[1] + n1[1] + n2[1] + n3[1], n0[2] + n1[2] + n2[2] + n3[2]];
    if (dot3(n, avg) < 0) {
      [p1, p3] = [p3, p1];
      [n1, n3] = [n3, n1];
    }
    const a = this._v(p0, n0), b = this._v(p1, n1), c = this._v(p2, n2), d = this._v(p3, n3);
    this.idx.push(a, b, c, a, c, d);
  }

  /** Convex polygon (fan) facing `hint`. */
  fan(pts, hint) {
    if (pts.length < 3) return;
    let n = polyNormal(pts);
    if (hint && dot3(n, hint) < 0) {
      pts = pts.slice().reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    const nn = hint && Math.abs(dot3(n, norm3(hint))) > 0.999 ? norm3(hint) : n;
    const base = this.pos.length / 3;
    for (const p of pts) this._v(p, nn);
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  /**
   * Arbitrary simple polygon given in plan coordinates with a height per vertex,
   * triangulated with ear clipping, facing up (+1) or down (-1).
   */
  planPolygon(pts2, heights, up = 1) {
    if (pts2.length < 3) return;
    const contour = pts2.map((p) => new THREE.Vector2(p.x, p.y));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      return;
    }
    const P = pts2.map((p, i) => V(p, typeof heights === 'number' ? heights : heights[i]));
    for (const [i, j, k] of tris) {
      let a = P[i], b = P[j], c = P[k];
      let n = cross3(sub3(b, a), sub3(c, a));
      if (n[1] * up < 0) {
        [b, c] = [c, b];
        n = [-n[0], -n[1], -n[2]];
      }
      const nn = norm3(n);
      const ia = this._v(a, nn), ib = this._v(b, nn), ic = this._v(c, nn);
      this.idx.push(ia, ib, ic);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** A horizontal slab from a plan polygon. */
export function slabGeometry(poly, zBottom, zTop) {
  const gb = new GeoBuilder();
  gb.planPolygon(poly, zTop, 1);
  gb.planPolygon(poly, zBottom, -1);
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  const ccw = area > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const out = ccw ? { x: dy, y: -dx } : { x: -dy, y: dx };
    gb.quad(V(a, zBottom), V(b, zBottom), V(b, zTop), V(a, zTop), D(out));
  }
  return gb.build();
}

export { sub3, cross3, dot3, norm3 };
