// Freehand stroke recognition: turns a rough pen/finger stroke into clean wall
// segments (straight or curved), squared up to 90°/45° and aligned to the grid.

import { dist, sub, dot, cross, norm, lineLine, addScaled, lerp, roundTo, mid } from '../core/vec.js';
import { sagittaFrom3 } from './path.js';

function pathLen(pts, i0 = 0, i1 = pts.length - 1) {
  let s = 0;
  for (let i = i0 + 1; i <= i1; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function resample(pts, S) {
  if (pts.length < 2) return pts.slice();
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let D = 0;
  for (let i = 1; i < pts.length; i++) {
    let p0 = pts[i - 1];
    const p1 = pts[i];
    let d = dist(p0, p1);
    while (D + d >= S && d > 1e-9) {
      const t = (S - D) / d;
      const q = lerp(p0, p1, t);
      out.push(q);
      p0 = q;
      d = dist(p0, p1);
      D = 0;
    }
    D += d;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > S * 0.35) out.push({ x: last.x, y: last.y });
  else out[out.length - 1] = { x: last.x, y: last.y };
  return out;
}

function shortStraw(r) {
  const W = 3, N = r.length;
  if (N < 2 * W + 2) return [0, N - 1];
  const straws = new Array(N).fill(Infinity);
  for (let i = W; i < N - W; i++) straws[i] = dist(r[i - W], r[i + W]);
  const sorted = straws.slice(W, N - W).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const thr = median * 0.95;
  const corners = [0];
  let i = W;
  while (i < N - W) {
    if (straws[i] < thr) {
      let lo = straws[i], idx = i;
      while (i < N - W && straws[i] < thr) {
        if (straws[i] < lo) {
          lo = straws[i];
          idx = i;
        }
        i++;
      }
      corners.push(idx);
    }
    i++;
  }
  corners.push(N - 1);
  return corners;
}

/** Least-squares (Kåsa) circle fit. */
export function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    Suu += u * u;
    Suv += u * v;
    Svv += v * v;
    Suuu += u * u * u;
    Svvv += v * v * v;
    Suvv += u * v * v;
    Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = 0.5 * (Suuu + Suvv), b2 = 0.5 * (Svvv + Svuu);
  const uc = (b1 * Svv - b2 * Suv) / det;
  const vc = (Suu * b2 - Suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  return { c: { x: uc + mx, y: vc + my }, r };
}

function maxChordDeviation(pts, i0, i1) {
  const a = pts[i0], b = pts[i1];
  const d = norm(sub(b, a));
  let best = 0, idx = i0;
  for (let i = i0 + 1; i < i1; i++) {
    const dev = Math.abs(cross(d, sub(pts[i], a)));
    if (dev > best) {
      best = dev;
      idx = i;
    }
  }
  return { dev: best, idx };
}

function sweepAround(pts, c) {
  let total = 0;
  let prev = Math.atan2(pts[0].y - c.y, pts[0].x - c.x);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i].y - c.y, pts[i].x - c.x);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return total;
}

/**
 * Classify the stroke piece r[i0..i1] as a line, an arc, or split it further.
 * Pushes segment descriptors into `out`.
 */
function fitPiece(r, i0, i1, tol, allowCurves, out, depth = 0) {
  const a = r[i0], b = r[i1];
  const chord = dist(a, b);
  const { dev, idx } = maxChordDeviation(r, i0, i1);
  if (i1 - i0 < 2 || dev <= Math.max(tol.line, 0.035 * chord)) {
    out.push({ type: 'line', i0, i1 });
    return;
  }
  if (allowCurves && i1 - i0 >= 5) {
    const pts = r.slice(i0, i1 + 1);
    const fit = fitCircle(pts);
    if (fit && fit.r < chord * 40) {
      let resid = 0;
      for (const p of pts) resid = Math.max(resid, Math.abs(dist(p, fit.c) - fit.r));
      const sweep = Math.abs(sweepAround(pts, fit.c));
      const arcTol = Math.max(tol.arcMin, Math.min(tol.arcMax, 0.07 * fit.r));
      if (resid <= arcTol && sweep > (15 * Math.PI) / 180 && sweep < (345 * Math.PI) / 180) {
        out.push({ type: 'arc', i0, i1, mid: r[Math.round((i0 + i1) / 2)], fit, sweep });
        return;
      }
    }
  }
  if (depth > 12 || idx <= i0 || idx >= i1) {
    out.push({ type: 'line', i0, i1 });
    return;
  }
  fitPiece(r, i0, idx, tol, allowCurves, out, depth + 1);
  fitPiece(r, idx, i1, tol, allowCurves, out, depth + 1);
}

function snapAngleDeg(theta, mode) {
  // theta in degrees, returns snapped degrees or null
  const tryStep = (k, tolDeg) => {
    const s = Math.round(theta / k) * k;
    return Math.abs(theta - s) <= tolDeg ? s : null;
  };
  if (!mode) return null;
  let s = tryStep(90, 12);
  if (s !== null) return s;
  if (mode <= 45) {
    s = tryStep(45, 8);
    if (s !== null) return s;
  }
  if (mode <= 15) {
    s = tryStep(15, 4);
    if (s !== null) return s;
  }
  return null;
}

/**
 * Recognise a stroke.
 * @param raw   stroke points in world mm
 * @param opts  {scale (px per mm), angleSnap (0|15|45|90), allowCurves, grid (mm, 0 = off),
 *               snap(p) -> {x,y}|null (snap to existing geometry), closeTolPx}
 * @returns {segments: [{a, b, bulge}], closed} or null when the stroke is too small.
 */
export function recognizeStroke(raw, opts = {}) {
  const scale = opts.scale || 0.1;
  const px = 1 / scale; // mm per screen pixel
  const angleSnap = opts.angleSnap ?? 45;
  const allowCurves = opts.allowCurves !== false;
  const grid = opts.grid || 0;
  const pts = [];
  for (const p of raw) if (!pts.length || dist(pts[pts.length - 1], p) > 0.25 * px) pts.push(p);
  if (pts.length < 2) return null;
  const total = pathLen(pts);
  if (total < 24 * px) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const S = Math.min(Math.max(diag / 40, 3 * px), 14 * px);
  const r = resample(pts, S);
  const tol = { line: 7 * px, arcMin: 6 * px, arcMax: 16 * px };
  const closeTol = Math.max((opts.closeTolPx || 32) * px, 0.08 * total);
  let closed = r.length > 6 && dist(r[0], r[r.length - 1]) <= Math.min(closeTol, 0.3 * diag + 1);

  // Whole closed stroke that is a circle.
  if (closed && allowCurves) {
    const fit = fitCircle(r);
    if (fit) {
      let resid = 0;
      for (const p of r) resid = Math.max(resid, Math.abs(dist(p, fit.c) - fit.r));
      const sweep = Math.abs(sweepAround(r, fit.c));
      if (resid <= Math.max(8 * px, 0.12 * fit.r) && sweep > (300 * Math.PI) / 180) {
        let R = fit.r;
        let c = fit.c;
        if (grid) {
          R = Math.max(grid, roundTo(R, grid));
          c = { x: roundTo(c.x, grid), y: roundTo(c.y, grid) };
        }
        const q = [0, 1, 2, 3].map((k) => ({ x: c.x + R * Math.cos((k * Math.PI) / 2), y: c.y + R * Math.sin((k * Math.PI) / 2) }));
        const s = R * (1 - Math.cos(Math.PI / 4));
        // Counter-clockwise quarter arcs bulge to the right of travel.
        return {
          closed: true,
          circle: { c, r: R },
          segments: q.map((p, k) => ({ a: p, b: q[(k + 1) % 4], bulge: -s })),
        };
      }
    }
  }

  // 1. Corners, then classify each piece.
  const corners = shortStraw(r);
  let pieces = [];
  for (let k = 0; k < corners.length - 1; k++) {
    if (corners[k + 1] > corners[k]) fitPiece(r, corners[k], corners[k + 1], tol, allowCurves, pieces);
  }
  // 2. Merge consecutive near-collinear lines.
  const merged = [];
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === 'line' && p.type === 'line') {
      const d1 = norm(sub(r[prev.i1], r[prev.i0]));
      const d2 = norm(sub(r[p.i1], r[p.i0]));
      const span = { i0: prev.i0, i1: p.i1 };
      const { dev } = maxChordDeviation(r, span.i0, span.i1);
      if (dot(d1, d2) > Math.cos((14 * Math.PI) / 180) && dev <= Math.max(tol.line * 1.5, 0.05 * dist(r[span.i0], r[span.i1]))) {
        prev.i1 = p.i1;
        continue;
      }
    }
    merged.push({ ...p });
  }
  pieces = merged;
  // 3. Drop tiny pieces (hooks at the ends of a stroke, jitter).
  const minLen = Math.max(14 * px, 0.04 * total);
  pieces = pieces.filter((p, k) => {
    const L = dist(r[p.i0], r[p.i1]);
    if (L >= minLen) return true;
    return pieces.length === 1 || (k !== 0 && k !== pieces.length - 1 && L >= minLen * 0.5);
  });
  if (!pieces.length) return null;
  if (pieces.length === 1 && pieces[0].type === 'line') closed = false;
  if (closed && pieces.length === 2 && pieces.every((p) => p.type === 'line')) closed = false;

  // 4. Lines: fit direction, snap angles, anchor (with grid alignment for axis lines).
  let prevTheta = null;
  for (const p of pieces) {
    if (p.type !== 'line') {
      prevTheta = null;
      continue;
    }
    const a = r[p.i0], b = r[p.i1];
    let theta = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    let snapped = snapAngleDeg(theta, angleSnap);
    if (snapped === null && prevTheta !== null) {
      const rel = theta - prevTheta;
      const k = Math.round(rel / 90);
      if (Math.abs(rel - k * 90) <= 8) snapped = prevTheta + k * 90;
    }
    if (snapped !== null) theta = snapped;
    prevTheta = theta;
    const th = (theta * Math.PI) / 180;
    p.d = { x: Math.cos(th), y: Math.sin(th) };
    if (Math.abs(p.d.x) < 1e-12) p.d.x = 0;
    if (Math.abs(p.d.y) < 1e-12) p.d.y = 0;
    // Anchor through the mean of the stroke points of this piece.
    let sx = 0, sy = 0, cnt = 0;
    for (let i = p.i0; i <= p.i1; i++) {
      sx += r[i].x;
      sy += r[i].y;
      cnt++;
    }
    p.anchor = { x: sx / cnt, y: sy / cnt };
    if (grid && snapped !== null) {
      if (Math.abs(p.d.y) < 1e-9) p.anchor.y = roundTo(p.anchor.y, grid);
      else if (Math.abs(p.d.x) < 1e-9) p.anchor.x = roundTo(p.anchor.x, grid);
    }
  }

  const m = pieces.length;
  const rawJ = (k) => r[pieces[k].i0]; // raw junction at the start of piece k

  function projectOnLine(p, piece) {
    const t = dot(sub(p, piece.anchor), piece.d);
    return addScaled(piece.anchor, piece.d, t);
  }

  function junction(prev, next, rawPt) {
    if (prev.type === 'line' && next.type === 'line') {
      const hit = lineLine(prev.anchor, prev.d, next.anchor, next.d);
      const maxShift = Math.max(40 * px, 0.4 * Math.min(dist(r[prev.i0], r[prev.i1]), dist(r[next.i0], r[next.i1])));
      if (hit && Math.abs(cross(prev.d, next.d)) > 0.17 && dist(hit.point, rawPt) <= maxShift) return hit.point;
      return mid(projectOnLine(rawPt, prev), projectOnLine(rawPt, next));
    }
    if (prev.type === 'line') return projectOnLine(rawPt, prev);
    if (next.type === 'line') return projectOnLine(rawPt, next);
    return { x: rawPt.x, y: rawPt.y };
  }

  function computeVertices() {
    const V = [];
    if (closed) {
      for (let k = 0; k < m; k++) V.push(junction(pieces[(k - 1 + m) % m], pieces[k], k === 0 ? mid(r[0], r[r.length - 1]) : rawJ(k)));
      V.push(V[0]);
    } else {
      const first = pieces[0];
      V.push(first.type === 'line' ? projectOnLine(r[first.i0], first) : { ...r[first.i0] });
      for (let k = 1; k < m; k++) V.push(junction(pieces[k - 1], pieces[k], rawJ(k)));
      const last = pieces[m - 1];
      V.push(last.type === 'line' ? projectOnLine(r[last.i1], last) : { ...r[last.i1] });
    }
    return V;
  }

  let V = computeVertices();

  // 5. Snap vertices to existing geometry and re-anchor lines through snapped points.
  if (opts.snap) {
    let any = false;
    const count = closed ? m : m + 1;
    const snappedIdx = new Set();
    for (let k = 0; k < count; k++) {
      const s = opts.snap(V[k]);
      if (!s) continue;
      any = true;
      snappedIdx.add(k);
      const before = closed ? pieces[(k - 1 + m) % m] : k > 0 ? pieces[k - 1] : null;
      const after = k < m ? pieces[k] : null;
      for (const pc of [before, after]) {
        if (pc && pc.type === 'line' && !pc.reanchored) {
          pc.anchor = { x: s.x, y: s.y };
          pc.reanchored = true;
        }
      }
      V[k] = { x: s.x, y: s.y };
    }
    if (any) {
      const V2 = computeVertices();
      for (let k = 0; k < V2.length; k++) {
        const kk = closed && k === m ? 0 : k;
        if (!snappedIdx.has(kk)) continue;
        const openEnd = !closed && (k === 0 || k === V2.length - 1);
        // Open ends sit exactly on their snap target (the adjacent line was
        // re-anchored through it); junctions keep the target when both lines agree.
        if (openEnd || dist(V2[k], V[kk]) < 1) V2[k] = V[kk];
      }
      V = V2;
      V.snapped = snappedIdx;
    }
  }

  // 6. Tidy open ends to the grid.
  if (grid && !closed) {
    const tidyEnd = (k, piece, otherV) => {
      if (piece.type !== 'line' || (V.snapped && V.snapped.has(k))) return;
      const p = V[k];
      if (Math.abs(piece.d.y) < 1e-9) V[k] = { x: roundTo(p.x, grid), y: p.y };
      else if (Math.abs(piece.d.x) < 1e-9) V[k] = { x: p.x, y: roundTo(p.y, grid) };
      else {
        const L = dist(p, otherV);
        const Lr = Math.max(grid, roundTo(L, grid));
        const dir = norm(sub(p, otherV));
        V[k] = addScaled(otherV, dir, Lr);
      }
    };
    tidyEnd(0, pieces[0], V[1]);
    tidyEnd(V.length - 1, pieces[m - 1], V[V.length - 2]);
  }

  const segments = [];
  for (let k = 0; k < m; k++) {
    const a = V[k], b = V[k + 1];
    if (dist(a, b) < Math.max(10, 4 * px)) continue;
    const p = pieces[k];
    let bulge = 0;
    if (p.type === 'arc') {
      bulge = sagittaFrom3(a, p.mid, b);
      if (Math.abs(bulge) < 0.02 * dist(a, b)) bulge = 0;
    }
    segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, bulge });
  }
  if (!segments.length) return null;
  return { segments, closed: closed && segments.length >= 2 };
}

