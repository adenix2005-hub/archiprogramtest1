// Wall join engine. Computes the plan outline of every wall on a level with clean
// mitred corners where wall ends meet, star-shaped joins at 3+ way nodes and
// trimmed T-junctions where a wall ends against the side of another wall.

import { wallPath, intersectPrims } from './path.js';
import { dot, dist, perp, neg, addScaled, posMod, TAU } from '../core/vec.js';

export const NODE_TOL = 1.0; // mm: wall ends closer than this are joined
export const TEE_TOL = 2.0; // mm: an end this close to another wall's centre-line forms a T
const MITER_LIMIT = 6; // × half thickness

function endInfo(g, which) {
  const { path, half } = g;
  const atStart = which === 'a';
  const p = atStart ? g.wall.a : g.wall.b;
  const t = path.tangentAt(atStart ? 0 : path.length);
  const dir = atStart ? t : neg(t);
  // Boundaries relative to the outgoing direction (pointing into the wall body).
  const leftPrim = path.offsetPrim(atStart ? half : -half);
  const rightPrim = path.offsetPrim(atStart ? -half : half);
  const n = perp(dir);
  return {
    g,
    which,
    p,
    dir,
    ang: Math.atan2(dir.y, dir.x),
    half,
    leftPrim,
    rightPrim,
    leftPerp: addScaled(p, n, half),
    rightPerp: addScaled(p, n, -half),
    cornerL: null,
    cornerR: null,
    kind: 'free',
    node: null,
    host: null,
  };
}

function clusterEnds(ends) {
  const cell = NODE_TOL * 4;
  const grid = new Map();
  const nodes = [];
  const key = (x, y) => `${x},${y}`;
  for (const e of ends) {
    const cx = Math.floor(e.p.x / cell), cy = Math.floor(e.p.y / cell);
    let found = null;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) {
        const list = grid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const n of list) {
          if (dist(n.p, e.p) <= NODE_TOL) {
            found = n;
            break;
          }
        }
      }
    }
    if (!found) {
      found = { p: e.p, ends: [] };
      nodes.push(found);
      const k = key(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(found);
    }
    found.ends.push(e);
    e.node = found;
  }
  return nodes;
}

/**
 * Compute joined wall geometry for the walls of one level.
 * Returns {geoms: Map<id, WallGeom>, nodes}.
 *
 * WallGeom: {wall, path, half, start, end, sMin, sMax, bbox}
 *   start/end: {left, right, center|null, sLeft, sRight, kind: 'free'|'node'|'tee', host}
 *   left/right are relative to the wall's own a→b direction.
 */
export function computeWallGeoms(walls) {
  const geoms = new Map();
  for (const w of walls) {
    const path = wallPath(w);
    if (!(path.length > 1)) continue;
    const half = Math.max(1, w.thickness || 0) / 2;
    const g = { wall: w, path, half, start: null, end: null, bbox: null };
    const bb = path.bbox();
    g.bbox = { minX: bb.minX - half, minY: bb.minY - half, maxX: bb.maxX + half, maxY: bb.maxY + half };
    geoms.set(w.id, g);
  }

  const ends = [];
  for (const g of geoms.values()) {
    g.endA = endInfo(g, 'a');
    g.endB = endInfo(g, 'b');
    ends.push(g.endA, g.endB);
  }
  const nodes = clusterEnds(ends);

  // Nodes: mitre between angularly adjacent wall ends.
  for (const node of nodes) {
    const k = node.ends.length;
    if (k < 2) continue;
    const sorted = node.ends.slice().sort((a, b) => a.ang - b.ang);
    node.sorted = sorted;
    for (let i = 0; i < k; i++) {
      const E = sorted[i];
      const F = sorted[(i + 1) % k];
      const gap = k === 1 ? TAU : posMod(F.ang - E.ang, TAU);
      let corner = null;
      if (gap > 0.01 && gap < TAU - 0.01 && Math.abs(gap - Math.PI) > 0.004) {
        corner = intersectPrims(E.leftPrim, F.rightPrim, node.p);
        if (corner && dist(corner, node.p) > MITER_LIMIT * Math.max(E.half, F.half)) corner = null;
      }
      E.cornerL = corner || E.leftPerp;
      F.cornerR = corner || F.rightPerp;
    }
    for (const e of node.ends) e.kind = 'node';
  }

  // T-junctions: a free end lying on another wall's centre-line.
  for (const e of ends) {
    if (e.node.ends.length > 1) continue;
    let best = null;
    for (const h of geoms.values()) {
      if (h === e.g) continue;
      const bb = h.bbox;
      if (e.p.x < bb.minX - TEE_TOL || e.p.x > bb.maxX + TEE_TOL || e.p.y < bb.minY - TEE_TOL || e.p.y > bb.maxY + TEE_TOL) continue;
      const pr = h.path.project(e.p);
      if (pr.dist > TEE_TOL) continue;
      if (pr.raw < -TEE_TOL || pr.raw > h.path.length + TEE_TOL) continue;
      if (!best || pr.dist < best.pr.dist) best = { h, pr };
    }
    if (best) {
      const { h, pr } = best;
      const n = h.path.normalAt(pr.s);
      const side = dot(e.dir, n);
      if (Math.abs(side) > 0.05) {
        const face = h.path.offsetPrim(Math.sign(side) * h.half);
        let cL = intersectPrims(e.leftPrim, face, e.p);
        let cR = intersectPrims(e.rightPrim, face, e.p);
        const lim = MITER_LIMIT * Math.max(e.half, h.half);
        if (cL && dist(cL, e.p) > lim) cL = null;
        if (cR && dist(cR, e.p) > lim) cR = null;
        e.cornerL = cL || e.leftPerp;
        e.cornerR = cR || e.rightPerp;
        e.kind = 'tee';
        e.host = h.wall.id;
        continue;
      }
    }
    e.cornerL = e.leftPerp;
    e.cornerR = e.rightPerp;
    e.kind = 'free';
  }

  // Assemble per-wall caps in the wall's own left/right terms.
  for (const g of geoms.values()) {
    const A = g.endA, B = g.endB;
    const path = g.path;
    g.start = {
      left: A.cornerL,
      right: A.cornerR,
      center: A.node.ends.length >= 3 ? A.node.p : null,
      kind: A.kind,
      host: A.host,
      degree: A.node.ends.length,
    };
    g.end = {
      left: B.cornerR,
      right: B.cornerL,
      center: B.node.ends.length >= 3 ? B.node.p : null,
      kind: B.kind,
      host: B.host,
      degree: B.node.ends.length,
    };
    g.start.sLeft = path.paramOf(g.start.left);
    g.start.sRight = path.paramOf(g.start.right);
    g.end.sLeft = path.paramOf(g.end.left);
    g.end.sRight = path.paramOf(g.end.right);
    g.sMin = Math.max(0, g.start.sLeft, g.start.sRight);
    g.sMax = Math.min(path.length, g.end.sLeft, g.end.sRight);
    if (g.sMax < g.sMin) g.sMax = g.sMin;
  }

  return { geoms, nodes };
}

function faceRun(path, d, sA, sB) {
  if (!path.isArc) return [];
  const ss = path.samples(sA, sB);
  const out = [];
  for (let i = 1; i < ss.length - 1; i++) out.push(path.offsetAt(ss[i], d));
  return out;
}

/**
 * Plan outline polygons of a wall, split by cut ranges [{s0, s1}] (sorted,
 * inside [sMin, sMax]). Each polygon is CCW.
 */
export function wallOutline(g, cuts = []) {
  const { path, half, start, end } = g;
  const ivs = [];
  let from = null;
  for (const c of cuts) {
    ivs.push([from, c.s0]);
    from = c.s1;
  }
  ivs.push([from, null]);
  const polys = [];
  for (const [s0, s1] of ivs) {
    if (s0 !== null && s1 !== null && s1 - s0 < 0.5) continue;
    const poly = [];
    const r0 = s0 === null ? start.right : path.offsetAt(s0, -half);
    const r1 = s1 === null ? end.right : path.offsetAt(s1, -half);
    const sr0 = s0 === null ? start.sRight : s0;
    const sr1 = s1 === null ? end.sRight : s1;
    poly.push(r0, ...faceRun(path, -half, sr0, sr1), r1);
    if (s1 === null && end.center) poly.push(end.center);
    const l1 = s1 === null ? end.left : path.offsetAt(s1, half);
    const l0 = s0 === null ? start.left : path.offsetAt(s0, half);
    const sl1 = s1 === null ? end.sLeft : s1;
    const sl0 = s0 === null ? start.sLeft : s0;
    poly.push(l1, ...faceRun(path, half, sl1, sl0), l0);
    if (s0 === null && start.center) poly.push(start.center);
    polys.push(poly);
  }
  return polys;
}

/** Distance from a point to a wall body (0 when inside its thickness). */
export function distToWall(g, p) {
  const pr = g.path.project(p);
  return Math.max(0, pr.dist - g.half);
}

/** Wall face corner points, useful as snap targets. */
export function wallCorners(g) {
  const pts = [g.start.left, g.start.right, g.end.left, g.end.right];
  return pts;
}

