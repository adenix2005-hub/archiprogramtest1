// Roof geometry: hip, gable, shed and flat roofs over any simple polygon footprint,
// with overhangs, slab thickness, fascia and gable-end infill walls.

import { straightSkeleton } from './skeleton.js';
import { offsetPolygon, signedArea } from './polygon.js';
import { sub, dot, cross, dist, norm } from '../core/vec.js';

export const ROOF_KINDS = {
  hip: 'Hip',
  gable: 'Gable',
  shed: 'Shed (mono-pitch)',
  flat: 'Flat',
};

/**
 * Make a roof record's footprint counter-clockwise, remapping per-edge settings.
 * Edge i of the reversed polygon is edge (n-2-i) mod n of the original.
 */
export function ensureRoofCCW(roof) {
  const pts = roof.points || [];
  const n = pts.length;
  if (n < 3 || signedArea(pts) >= 0) return roof;
  roof.points = pts.slice().reverse();
  if (Array.isArray(roof.edges) && roof.edges.length === n) {
    const e = roof.edges;
    roof.edges = e.map((_, i) => e[(2 * n - 2 - i) % n]);
  }
  if (Number.isInteger(roof.lowEdge)) roof.lowEdge = (2 * n - 2 - roof.lowEdge) % n;
  return roof;
}

/** Footprint with duplicate points removed, CCW. */
export function roofFootprint(points) {
  const out = [];
  for (const p of points) {
    if (!out.length || dist(out[out.length - 1], p) > 0.5) out.push({ x: p.x, y: p.y });
  }
  if (out.length > 2 && dist(out[0], out[out.length - 1]) <= 0.5) out.pop();
  return out;
}

function edgeInfo(poly) {
  const n = poly.length;
  const L = [], D = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    L.push(dist(a, b));
    D.push(norm(sub(b, a)));
  }
  return { n, L, D };
}

/**
 * Pick gable-end edges for a gable roof: "cap" edges whose neighbours turn back
 * (a U-turn) with convex corners at both ends, preferring the shortest. With
 * `alt` the other family of cap edges is used (rotating the ridges by 90°).
 */
export function autoGableEdges(poly, alt = false) {
  const { n, L, D } = edgeInfo(poly);
  const prev = (i) => (i - 1 + n) % n;
  const next = (i) => (i + 1) % n;
  const convexAt = (i) => cross(D[prev(i)], D[i]) > 1e-6; // vertex i
  const cand = [];
  for (let i = 0; i < n; i++) {
    const uturn = dot(D[prev(i)], D[next(i)]) < -0.85;
    if (uturn && convexAt(i) && convexAt(next(i))) cand.push(i);
  }
  const pickGreedy = (list) => {
    const sorted = list.slice().sort((a, b) => L[a] - L[b] || Math.abs(D[a].x) - Math.abs(D[b].x) || a - b);
    const chosen = new Set();
    for (const i of sorted) {
      if (chosen.has(prev(i)) || chosen.has(next(i))) continue;
      chosen.add(i);
    }
    return chosen;
  };
  const primary = pickGreedy(cand.filter((i) => L[i] <= Math.min(L[prev(i)], L[next(i)]) + 1));
  let chosen = primary;
  if (alt) chosen = pickGreedy(cand.filter((i) => !primary.has(i)));
  if (!chosen.size && cand.length) chosen = pickGreedy(cand);
  return Array.from({ length: n }, (_, i) => chosen.has(i));
}

/** Default low (eave) edge for a shed roof: the longest edge, southern-most on ties. */
export function defaultShedEdge(poly) {
  const { n, L } = edgeInfo(poly);
  let best = 0;
  for (let i = 1; i < n; i++) {
    const my = (poly[i].y + poly[(i + 1) % n].y) / 2;
    const by = (poly[best].y + poly[(best + 1) % n].y) / 2;
    if (L[i] > L[best] + 1 || (Math.abs(L[i] - L[best]) <= 1 && my < by)) best = i;
  }
  return best;
}

/** Per-edge slope flags (true = sloped plane, false = vertical gable / wall). */
export function roofEdgeSlopes(roof, poly) {
  const n = poly.length;
  if (Array.isArray(roof.edges) && roof.edges.length === n) return roof.edges.map(Boolean);
  switch (roof.kind) {
    case 'gable':
      return autoGableEdges(poly, !!roof.rotate).map((g) => !g);
    case 'shed': {
      const low = Number.isInteger(roof.lowEdge) && roof.lowEdge < n ? roof.lowEdge : defaultShedEdge(poly);
      return Array.from({ length: n }, (_, i) => i === low);
    }
    case 'flat':
      return Array.from({ length: n }, () => false);
    case 'hip':
    default:
      return Array.from({ length: n }, () => true);
  }
}

function lift(p, z) {
  return { x: p.x, y: p.y, z };
}

/**
 * Build roof geometry.
 * @param roof  {points, kind, pitch (deg), overhang, thickness, edges?, rotate?, lowEdge?}
 * @param base  absolute height (mm) of the wall plate where the roof sits
 * @returns {
 *   footprint, outline, slopes, peak,
 *   surfaces: [poly3] (roof soffit polygons, CCW from above),
 *   tops: [poly3], fascia: [{pts: poly3, out: {x, y}}], gables: [{edge, pts: poly3, n}] (infill walls),
 *   lines: {outline: [pts], ridges: [[a,b]...]}
 * }
 */
export function buildRoofGeometry(roof, base) {
  let poly = roofFootprint(roof.points || []);
  if (poly.length < 3 || Math.abs(signedArea(poly)) < 1e4) return null;
  if (signedArea(poly) < 0) {
    const r2 = { ...roof, points: poly };
    ensureRoofCCW(r2);
    roof = r2;
    poly = r2.points;
  }
  const slopes = roofEdgeSlopes(roof, poly);
  const pitch = Math.min(80, Math.max(0, roof.kind === 'flat' ? 0 : roof.pitch ?? 30));
  const tanP = Math.tan((pitch * Math.PI) / 180);
  const o = Math.max(0, roof.overhang ?? 0);
  const th = Math.max(10, roof.thickness ?? 200);
  const outline = o > 0 ? offsetPolygon(poly, -o) : poly.map((p) => ({ ...p }));
  const res = {
    footprint: poly,
    outline,
    slopes,
    surfaces: [],
    tops: [],
    fascia: [],
    gables: [],
    lines: { outline, ridges: [] },
    peak: base,
  };

  const flat = roof.kind === 'flat' || pitch < 0.5 || slopes.every((s) => !s);
  if (flat) {
    res.surfaces.push(outline.map((p) => lift(p, base)));
    res.tops.push(outline.map((p) => lift(p, base + th)));
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      res.fascia.push({ pts: [lift(a, base), lift(b, base), lift(b, base + th), lift(a, base + th)], out: { x: dy / L, y: -dx / L } });
    }
    res.peak = base + th;
    return res;
  }

  const weights = slopes.map((s) => (s ? 1 : 0));
  const thV = th / Math.cos((pitch * Math.PI) / 180);
  const z = (t) => base + (t - o) * tanP;
  const sk = straightSkeleton(outline, weights);

  for (const q of sk.quads) {
    if (!weights[q.edge]) continue;
    const pts = q.p;
    // Skip degenerate quads (zero area in plan).
    const ar = Math.abs(
      cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])) + cross(sub(pts[2], pts[0]), sub(pts[3], pts[0])),
    );
    if (ar < 1) continue;
    res.surfaces.push(pts.map((p) => lift(p, z(p.t))));
    res.tops.push(pts.map((p) => lift(p, z(p.t) + thV)));
    if (q.first) {
      // Eave fascia along the original (expanded) edge.
      const a = pts[0], b = pts[1];
      const n = sk.edges[q.edge].n;
      if (dist(a, b) > 1) res.fascia.push({ pts: [lift(a, z(0)), lift(b, z(0)), lift(b, z(0) + thV), lift(a, z(0) + thV)], out: { x: -n.x, y: -n.y } });
    }
  }
  for (const c of sk.caps) {
    res.surfaces.push(c.poly.map((p) => lift(p, z(c.t))));
    res.tops.push(c.poly.map((p) => lift(p, z(c.t) + thV)));
  }
  // Rake / high-edge fascia along vertical (gable) edges.
  for (const r of sk.rakes) {
    if (weights[r.edge]) continue;
    const a = r.a, b = r.b;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) continue;
    const n = sk.edges[r.edge].n;
    res.fascia.push({ pts: [lift(a, z(a.t)), lift(b, z(b.t)), lift(b, z(b.t) + thV), lift(a, z(a.t) + thV)], out: { x: -n.x, y: -n.y } });
  }
  // Plan lines: hips, valleys and ridges between two sloped planes.
  for (const a of sk.arcs) {
    if (weights[a.e0] && weights[a.e1]) res.lines.ridges.push([a.a, a.b]);
  }
  for (const r of sk.ridges) {
    if (weights[r.edge]) res.lines.ridges.push([r.a, r.b]);
  }
  res.peak = z(sk.maxT) + thV;

  // Gable-end infill walls: vertical faces of the un-expanded footprint.
  if (weights.some((w) => !w)) {
    const sk0 = straightSkeleton(poly, weights);
    const z0 = (t) => base + t * tanP;
    for (const q of sk0.quads) {
      if (weights[q.edge]) continue;
      const pts = q.p;
      const h = Math.max(...pts.map((p) => p.t)) * tanP;
      if (h < 1) continue;
      // Order the face so its normal points out of the footprint.
      res.gables.push({ edge: q.edge, pts: pts.map((p) => lift(p, z0(p.t))), n: sk0.edges[q.edge].n });
    }
  }
  return res;
}

/** Peak height of a gable profile along a footprint edge (used for labels). */
export function roofPeakAbove(geom, base) {
  return geom ? geom.peak - base : 0;
}
