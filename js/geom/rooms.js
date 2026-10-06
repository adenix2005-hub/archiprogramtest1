// Room detection: finds the closed regions bounded by wall centre-lines using
// planar-graph face traversal. Also returns the outer footprint of each building
// (used for automatic roofs).

import { wallPath } from './path.js';
import { segSeg, projectToSegment, dist, lerp } from '../core/vec.js';
import { signedArea, offsetPolygon, labelPoint, perimeter, cleanPolygon } from './polygon.js';

const TOL = 2; // mm

function bboxOfSeg(a, b) {
  return {
    minX: Math.min(a.x, b.x) - TOL,
    minY: Math.min(a.y, b.y) - TOL,
    maxX: Math.max(a.x, b.x) + TOL,
    maxY: Math.max(a.y, b.y) + TOL,
  };
}

function overlaps(p, q) {
  return p.minX <= q.maxX && q.minX <= p.maxX && p.minY <= q.maxY && q.minY <= p.maxY;
}

/** Build the planar graph of wall centre-lines (split at junctions). */
export function buildWallGraph(walls) {
  const segs = [];
  for (const w of walls) {
    const path = wallPath(w);
    if (!(path.length > 1)) continue;
    const pts = path.polyline(Math.PI / 24);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = dist(a, b);
      if (L < 0.01) continue;
      segs.push({ a, b, L, wall: w, splits: [], bb: bboxOfSeg(a, b) });
    }
  }

  for (let i = 0; i < segs.length; i++) {
    const S = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const T = segs[j];
      if (!overlaps(S.bb, T.bb)) continue;
      const hit = segSeg(S.a, S.b, T.a, T.b, 0);
      if (hit) {
        if (hit.t * S.L > TOL && (1 - hit.t) * S.L > TOL) S.splits.push(hit.t);
        if (hit.u * T.L > TOL && (1 - hit.u) * T.L > TOL) T.splits.push(hit.u);
      }
      for (const [P, Q] of [[S, T], [T, S]]) {
        for (const e of [P.a, P.b]) {
          const pr = projectToSegment(e, Q.a, Q.b);
          if (pr.dist <= TOL && pr.t * Q.L > TOL && (1 - pr.t) * Q.L > TOL) Q.splits.push(pr.t);
        }
      }
    }
  }

  const nodes = [];
  const grid = new Map();
  const cell = TOL * 4;
  function nodeAt(p) {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const id of list) if (dist(nodes[id], p) <= TOL) return id;
      }
    }
    const id = nodes.length;
    nodes.push({ x: p.x, y: p.y });
    const k = `${cx},${cy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(id);
    return id;
  }

  const edges = new Map();
  for (const S of segs) {
    const ts = [0, ...S.splits.sort((a, b) => a - b), 1];
    let prev = null;
    for (const t of ts) {
      const id = nodeAt(lerp(S.a, S.b, t));
      if (prev !== null && prev !== id) {
        const key = prev < id ? `${prev}-${id}` : `${id}-${prev}`;
        if (!edges.has(key)) edges.set(key, { u: prev, v: id, wall: S.wall });
      }
      prev = id;
    }
  }
  return { nodes, edges: [...edges.values()] };
}

/**
 * Detect rooms. Returns {rooms, outlines}.
 * room: {poly, walls (wall per edge), area (gross, centre-line), netPoly, netArea, perimeter, label}
 * outline: {poly (CCW centre-line), walls, area} for each building's outer boundary.
 */
export function detectRooms(walls, opts = {}) {
  const minArea = opts.minArea ?? 0.15e6;
  const { nodes, edges } = buildWallGraph(walls);
  const adj = nodes.map(() => []);
  for (const e of edges) {
    adj[e.u].push({ to: e.v, wall: e.wall });
    adj[e.v].push({ to: e.u, wall: e.wall });
  }
  // Prune dangling edges.
  const alive = adj.map((l) => l.length);
  const queue = [];
  alive.forEach((d, i) => d === 1 && queue.push(i));
  const removed = new Set();
  while (queue.length) {
    const n = queue.pop();
    if (removed.has(n)) continue;
    const live = adj[n].filter((e) => !removed.has(e.to));
    if (live.length !== 1) {
      if (live.length === 0) removed.add(n);
      continue;
    }
    removed.add(n);
    const other = live[0].to;
    const otherLive = adj[other].filter((e) => !removed.has(e.to)).length;
    if (otherLive <= 1) queue.push(other);
  }
  for (let i = 0; i < adj.length; i++) {
    adj[i] = removed.has(i) ? [] : adj[i].filter((e) => !removed.has(e.to));
    for (const e of adj[i]) e.ang = Math.atan2(nodes[e.to].y - nodes[i].y, nodes[e.to].x - nodes[i].x);
    adj[i].sort((a, b) => a.ang - b.ang);
  }

  const visited = new Set();
  const rooms = [];
  const outlines = [];
  for (let u = 0; u < adj.length; u++) {
    for (const start of adj[u]) {
      const key0 = `${u}>${start.to}`;
      if (visited.has(key0)) continue;
      const poly = [];
      const fwalls = [];
      let cu = u, cv = start.to, wall = start.wall;
      let guard = 0;
      let ok = true;
      while (true) {
        const k = `${cu}>${cv}`;
        if (visited.has(k)) {
          ok = cu === u && cv === start.to;
          break;
        }
        visited.add(k);
        poly.push(nodes[cu]);
        fwalls.push(wall);
        const list = adj[cv];
        const idx = list.findIndex((e) => e.to === cu);
        if (idx < 0) {
          ok = false;
          break;
        }
        const next = list[(idx - 1 + list.length) % list.length];
        cu = cv;
        cv = next.to;
        wall = next.wall;
        if (++guard > 100000) {
          ok = false;
          break;
        }
      }
      if (!ok || poly.length < 3) continue;
      const a = signedArea(poly);
      if (a > minArea) {
        rooms.push(makeRoom(poly, fwalls));
      } else if (a < -minArea) {
        const ccw = poly.slice().reverse();
        // Edge i of the reversed polygon runs from ccw[i] to ccw[i+1], which is
        // the original edge (n-2-i) mod n.
        const n = poly.length;
        const w2 = ccw.map((_, i) => fwalls[(2 * n - 2 - i) % n]);
        outlines.push({ poly: ccw, walls: w2, area: -a });
      }
    }
  }
  return { rooms, outlines };
}

function makeRoom(poly, fwalls) {
  const area = signedArea(poly);
  const dists = fwalls.map((w) => (w.thickness || 0) / 2);
  let netPoly = offsetPolygon(poly, dists);
  let netArea = signedArea(netPoly);
  if (!(netArea > 0) || netArea > area) {
    netPoly = poly;
    netArea = area;
  }
  const label = labelPoint(cleanPolygon(netPoly, 1));
  return {
    poly,
    walls: fwalls,
    area,
    netPoly,
    netArea,
    perimeter: perimeter(netPoly),
    label,
  };
}

/** Exterior-face footprint polygon of a building outline (offset outward by half wall thickness). */
export function outlineFootprint(outline) {
  const dists = outline.walls.map((w) => -(w.thickness || 0) / 2);
  return cleanPolygon(offsetPolygon(outline.poly, dists), 1);
}
