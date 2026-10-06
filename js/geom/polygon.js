// Polygon utilities. Polygons are arrays of {x, y}; CCW = positive area.

import { sub, cross, dist, lineLine, perp, norm, addScaled, projectToSegment, EPS } from '../core/vec.js';

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(poly) {
  return Math.abs(signedArea(poly));
}

export function perimeter(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) s += dist(poly[i], poly[(i + 1) % n]);
  return s;
}

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a += f;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0, sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the polygon boundary. */
export function distToPolygonEdge(p, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const d = projectToSegment(p, poly[i], poly[(i + 1) % n]).dist;
    if (d < best) best = d;
  }
  return best;
}

export function ensureCCW(poly) {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

/** Remove consecutive duplicates and (near) collinear vertices. */
export function cleanPolygon(poly, eps = 0.5, angleEps = 1e-4) {
  let pts = [];
  for (const p of poly) {
    if (!pts.length || dist(pts[pts.length - 1], p) > eps) pts.push(p);
  }
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= eps) pts.pop();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
      if (Math.abs(cross(d1, d2)) < angleEps && d1.x * d2.x + d1.y * d2.y > 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/**
 * Offset a polygon. Positive distances move edges to the left of each edge
 * (inward for a CCW polygon). `dists` can be a number or an array per edge.
 */
export function offsetPolygon(poly, dists) {
  const n = poly.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = norm(sub(b, a));
    const off = typeof dists === 'number' ? dists : dists[i];
    lines.push({ p: addScaled(a, perp(d), off), d, off });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i - 1 + n) % n], L1 = lines[i];
    const hit = lineLine(L0.p, L0.d, L1.p, L1.d);
    const v = poly[i];
    if (!hit || dist(hit.point, v) > 50 * Math.max(Math.abs(L0.off), Math.abs(L1.off), 1)) {
      // Parallel (or nearly so): move the vertex along the averaged normal.
      out.push(addScaled(v, perp(L1.d), L1.off));
    } else {
      out.push(hit.point);
    }
  }
  return out;
}

/**
 * Pole of inaccessibility: an interior point far from the edges, good for labels.
 * Coarse grid search with refinement.
 */
export function labelPoint(poly) {
  const c = centroid(poly);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let best = c;
  let bestD = pointInPolygon(c, poly) ? distToPolygonEdge(c, poly) : -1;
  let cell = Math.max(maxX - minX, maxY - minY) / 12;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let span = Math.max(maxX - minX, maxY - minY) / 2;
  for (let iter = 0; iter < 4 && cell > 1; iter++) {
    for (let x = cx - span; x <= cx + span + 1e-6; x += cell) {
      for (let y = cy - span; y <= cy + span + 1e-6; y += cell) {
        const p = { x, y };
        if (!pointInPolygon(p, poly)) continue;
        // Prefer points near the centroid when distances are similar.
        const d = distToPolygonEdge(p, poly) - 0.05 * dist(p, c);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    cx = best.x;
    cy = best.y;
    span = cell;
    cell /= 4;
  }
  return best;
}

/** Sutherland–Hodgman clip of a polygon by the half-plane dot(p, n) >= c. */
export function clipHalfPlane(poly, n, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a.x * n.x + a.y * n.y - c, db = b.x * n.x + b.y * n.y - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

export function polygonBBox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** True when the polygon has no self intersections (O(n²)). */
export function isSimple(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      const r = sub(b, a), s = sub(d, c);
      const den = cross(r, s);
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(c, a);
      const t = cross(w, s) / den, u = cross(w, r) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return false;
    }
  }
  return true;
}
