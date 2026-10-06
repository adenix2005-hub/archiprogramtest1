// Weighted straight skeleton by kinetic simulation.
//
// Every polygon edge moves inward at its own speed (weight). A weight of 1 gives a
// sloped roof plane, 0 gives a vertical plane (a gable end). The wavefront is
// advanced from event to event (edge collapses and split events); after every step
// coincident vertices are merged, collapsed loops removed and split events applied.
// The swept area of every edge between two events is recorded as a quad, so the
// union of an edge's quads is that edge's roof face. Heights are time × tan(pitch).

import { sub, dot, cross, dist, perp, norm, addScaled, projectToSegment } from '../core/vec.js';

function loopArea(loop) {
  let a = 0;
  for (let i = 0, n = loop.length; i < n; i++) {
    const p = loop[i].p, q = loop[(i + 1) % n].p;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * @param {Array<{x,y}>} poly  counter-clockwise polygon (no repeated or collinear points)
 * @param {number[]} weights   per edge; edge i runs from poly[i] to poly[i+1]
 */
export function straightSkeleton(poly, weights) {
  const n = poly.length;
  const E = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = norm(sub(b, a));
    const nn = perp(d);
    E.push({ d, n: nn, c: dot(a, nn), w: weights ? weights[i] ?? 1 : 1, len: dist(a, b) });
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const epsMerge = size * 1e-7 + 1e-9;
  const epsSplit = size * 1e-6 + 1e-9;
  const epsArea = size * size * 1e-9;

  const quads = [];
  const arcs = [];
  const ridges = [];
  const rakes = [];
  const caps = [];

  function velocity(e0, e1) {
    const A = E[e0], B = E[e1];
    const det = A.n.x * B.n.y - A.n.y * B.n.x;
    if (Math.abs(det) > 1e-9) {
      return { x: (A.w * B.n.y - B.w * A.n.y) / det, y: (A.n.x * B.w - B.n.x * A.w) / det };
    }
    if (A.n.x * B.n.x + A.n.y * B.n.y > 0) {
      const w = Math.min(A.w, B.w);
      return { x: A.n.x * w, y: A.n.y * w };
    }
    return { x: 0, y: 0 };
  }

  function isReflex(V) {
    return cross(E[V.e0].d, E[V.e1].d) < -1e-9;
  }

  let T = 0;
  let loops = [poly.map((p, i) => ({ p: { x: p.x, y: p.y }, e0: (i - 1 + n) % n, e1: i, v: null }))];
  if (weights && weights.every((w) => !(w > 0))) {
    caps.push({ poly: poly.map((p) => ({ x: p.x, y: p.y })), t: 0 });
    return { quads, arcs, ridges, rakes, caps, maxT: 0, edges: E };
  }

  function finalizeLoop(L, allowCap) {
    const m = L.length;
    if (allowCap && m >= 3 && Math.abs(loopArea(L)) > epsArea) {
      caps.push({ poly: L.map((v) => ({ x: v.p.x, y: v.p.y })), t: T });
    }
    for (let k = 0; k < m; k++) {
      const A = L[k], B = L[(k + 1) % m];
      if (m < 2 || dist(A.p, B.p) <= epsMerge) continue;
      const id = A.e1;
      const seg = { a: { x: A.p.x, y: A.p.y, t: T }, b: { x: B.p.x, y: B.p.y, t: T } };
      if (E[id].w > 0) ridges.push({ ...seg, edge: id });
      else rakes.push({ ...seg, edge: id });
    }
  }

  function cleanup() {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 1000) {
      changed = false;
      const next = [];
      for (let L of loops) {
        // 1. Merge consecutive coincident vertices (collapsed edges).
        let k = 0;
        while (L.length > 1 && k < L.length) {
          const A = L[k], B = L[(k + 1) % L.length];
          const ell = dot(sub(B.p, A.p), E[A.e1].d);
          if (dist(A.p, B.p) <= epsMerge || (ell <= epsMerge && dist(A.p, B.p) <= epsSplit)) {
            const C = { p: { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2 }, e0: A.e0, e1: B.e1, v: null };
            const bi = (k + 1) % L.length;
            if (bi === 0) {
              L = [C, ...L.slice(1, L.length - 1)];
            } else {
              L = [...L.slice(0, k), C, ...L.slice(k + 2)];
            }
            changed = true;
            k = Math.max(0, k - 1);
          } else {
            k++;
          }
        }
        // 2. Remove collapsed loops.
        if (L.length < 3 || Math.abs(loopArea(L)) <= epsArea) {
          finalizeLoop(L, false);
          changed = true;
          continue;
        }
        next.push(L);
      }
      loops = next;
      if (changed) continue;
      // 3. Split events: a reflex vertex touching a non-adjacent edge of its loop.
      outer: for (let li = 0; li < loops.length; li++) {
        const L = loops[li];
        const m = L.length;
        for (let iv = 0; iv < m; iv++) {
          const V = L[iv];
          if (!isReflex(V)) continue;
          for (let ia = 0; ia < m; ia++) {
            if (ia === iv || ia === (iv - 1 + m) % m) continue;
            const A = L[ia], B = L[(ia + 1) % m];
            const pr = projectToSegment(V.p, A.p, B.p);
            if (pr.dist > epsSplit) continue;
            const eId = A.e1;
            // The vertex must be moving into this edge (or already on it).
            const V1 = { p: { ...V.p }, e0: V.e0, e1: eId, v: null };
            const V2 = { p: { ...V.p }, e0: eId, e1: V.e1, v: null };
            const loop1 = [V1];
            for (let j = (ia + 1) % m; j !== iv; j = (j + 1) % m) loop1.push(L[j]);
            const loop2 = [V2];
            for (let j = (iv + 1) % m; j !== (ia + 1) % m; j = (j + 1) % m) loop2.push(L[j]);
            loops.splice(li, 1, loop1, loop2);
            changed = true;
            break outer;
          }
        }
      }
    }
  }

  function computeVelocities() {
    for (const L of loops) {
      for (const V of L) V.v = velocity(V.e0, V.e1);
    }
  }

  function nextEvent() {
    let best = Infinity;
    for (const L of loops) {
      const m = L.length;
      for (let k = 0; k < m; k++) {
        const A = L[k], B = L[(k + 1) % m];
        const e = E[A.e1];
        const ell = dot(sub(B.p, A.p), e.d);
        const rate = dot(sub(B.v, A.v), e.d);
        if (rate < -1e-12) {
          const dt = Math.max(0, ell / -rate);
          if (dt < best) best = dt;
        }
      }
      for (let iv = 0; iv < m; iv++) {
        const V = L[iv];
        if (!isReflex(V)) continue;
        for (let ia = 0; ia < m; ia++) {
          if (ia === iv || ia === (iv - 1 + m) % m) continue;
          const A = L[ia], B = L[(ia + 1) % m];
          const e = E[A.e1];
          const gap = dot(V.p, e.n) - (e.c + e.w * T);
          const rate = dot(V.v, e.n) - e.w;
          if (rate >= -1e-12) continue;
          const dt = gap / -rate;
          if (dt < -epsSplit || dt >= best) continue;
          const t = Math.max(0, dt);
          const H = addScaled(V.p, V.v, t);
          const A2 = addScaled(A.p, A.v, t), B2 = addScaled(B.p, B.v, t);
          const ab = dot(sub(B2, A2), e.d);
          if (ab <= epsMerge) continue;
          const u = dot(sub(H, A2), e.d) / ab;
          if (u < -1e-7 || u > 1 + 1e-7) continue;
          best = t;
        }
      }
    }
    return best;
  }

  function advance(dt) {
    const T2 = T + dt;
    for (const L of loops) {
      const m = L.length;
      const newP = L.map((V) => addScaled(V.p, V.v, dt));
      for (let k = 0; k < m; k++) {
        const A = L[k], B = L[(k + 1) % m];
        const A2 = newP[k], B2 = newP[(k + 1) % m];
        const id = A.e1;
        quads.push({
          edge: id,
          p: [
            { x: A.p.x, y: A.p.y, t: T },
            { x: B.p.x, y: B.p.y, t: T },
            { x: B2.x, y: B2.y, t: T2 },
            { x: A2.x, y: A2.y, t: T2 },
          ],
          first: T === 0,
        });
        if (!(E[id].w > 0)) {
          if (dist(A.p, A2) > epsMerge) rakes.push({ a: { ...A.p, t: T }, b: { ...A2, t: T2 }, edge: id });
          if (dist(B.p, B2) > epsMerge) rakes.push({ a: { ...B.p, t: T }, b: { ...B2, t: T2 }, edge: id });
        }
      }
      for (let k = 0; k < m; k++) {
        const V = L[k];
        if (dist(V.p, newP[k]) > epsMerge) {
          arcs.push({ a: { x: V.p.x, y: V.p.y, t: T }, b: { x: newP[k].x, y: newP[k].y, t: T2 }, e0: V.e0, e1: V.e1 });
        }
        V.p = newP[k];
      }
    }
    T = T2;
  }

  const maxSteps = 40 * n + 200;
  let steps = 0;
  cleanup();
  while (loops.length && steps++ < maxSteps) {
    computeVelocities();
    const dt = nextEvent();
    if (!Number.isFinite(dt)) break;
    advance(dt);
    cleanup();
  }
  for (const L of loops) finalizeLoop(L, true);
  return { quads, arcs, ridges, rakes, caps, maxT: T, edges: E };
}
