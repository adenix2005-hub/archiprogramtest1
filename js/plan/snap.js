// Snapping: object snaps (end points, wall corners, mid points, on-wall), polar
// tracking from the previous point, alignment guides through nearby points,
// length rounding and grid snap.

import { dist, sub, dot, addScaled, roundTo, niceStep, lineLine, lineCircle } from '../core/vec.js';
import { isMetric } from '../core/units.js';

const KIND_PRIORITY = { end: 0, corner: 1, mid: 2, center: 2 };

export function lengthStep(scale, units) {
  const px = 9 / scale;
  if (isMetric(units)) return niceStep(px, [1, 5]);
  const steps = [3.175, 6.35, 12.7, 25.4, 76.2, 152.4, 304.8, 609.6, 1524, 3048];
  return steps.find((s) => s >= px) || 3048;
}

export class Snapper {
  constructor(app) {
    this.app = app;
    this._cache = new Map();
    this._v = -1;
  }

  points(levelId) {
    const model = this.app.model;
    if (this._v !== model.version) {
      this._v = model.version;
      this._cache.clear();
    }
    let pts = this._cache.get(levelId);
    if (pts) return pts;
    pts = [];
    const lv = this.app.derived.level(levelId);
    for (const g of lv.geoms.values()) {
      const w = g.wall;
      pts.push({ p: w.a, kind: 'end', id: w.id, which: 'a' });
      pts.push({ p: w.b, kind: 'end', id: w.id, which: 'b' });
      pts.push({ p: g.path.midPoint(), kind: 'mid', id: w.id });
      for (const c of [g.start.left, g.start.right, g.end.left, g.end.right]) pts.push({ p: c, kind: 'corner', id: w.id });
      if (g.path.isArc) pts.push({ p: g.path.center, kind: 'center', id: w.id });
    }
    for (const [wid, list] of lv.openingsByWall) {
      const g = lv.geoms.get(wid);
      for (const { o, s0, s1 } of list) {
        for (const s of [s0, s1]) {
          pts.push({ p: g.path.offsetAt(s, g.half), kind: 'corner', id: o.id });
          pts.push({ p: g.path.offsetAt(s, -g.half), kind: 'corner', id: o.id });
        }
      }
    }
    const doc = model.doc;
    for (const r of doc.roofs) {
      if (r.level !== levelId) continue;
      for (const p of r.points) pts.push({ p, kind: 'end', id: r.id });
    }
    for (const d of doc.dims) {
      if (d.level !== levelId) continue;
      pts.push({ p: d.a, kind: 'end', id: d.id }, { p: d.b, kind: 'end', id: d.id });
    }
    for (const s of doc.sections) pts.push({ p: s.a, kind: 'end', id: s.id }, { p: s.b, kind: 'end', id: s.id });
    this._cache.set(levelId, pts);
    return pts;
  }

  /**
   * Snap a world point.
   * opts: {from, ortho, tolPx, exclude:Set(ids), excludePts:[{x,y}], onWall, level, noGrid}
   * Returns {p, kind, guides:[{a,b}], ref, polar}
   */
  snap(p, opts = {}) {
    const app = this.app;
    const vp = app.plan.vp;
    const prefs = app.prefs.snap;
    const units = app.model.settings.units;
    const levelId = opts.level || app.activeLevel;
    const tol = (opts.tolPx || 12) / vp.scale;
    const exclude = opts.exclude || new Set();
    const excludePts = opts.excludePts || [];
    const from = opts.from || null;
    const isExcluded = (c) => exclude.has(c.id) || excludePts.some((e) => dist(e, c.p) < 0.5);
    const res = { p: { x: p.x, y: p.y }, kind: null, guides: [], ref: null, polar: null };

    if (prefs.object && opts.points !== false) {
      let best = null, bestScore = Infinity;
      for (const c of this.points(levelId)) {
        if (isExcluded(c)) continue;
        const d = dist(c.p, p);
        if (d > tol) continue;
        const score = d + (KIND_PRIORITY[c.kind] ?? 3) * tol * 0.25;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) {
        res.p = { x: best.p.x, y: best.p.y };
        res.kind = best.kind;
        res.ref = best;
        if (from) res.guides.push({ a: from, b: res.p, kind: 'rubber' });
        return res;
      }
    }

    let q = { x: p.x, y: p.y };
    const ortho = opts.ortho || prefs.ortho;
    if (from && (ortho || prefs.polar)) {
      const v = sub(q, from);
      const L = Math.hypot(v.x, v.y);
      if (L > 1e-6) {
        const step = ortho ? 90 : prefs.polarStep || 15;
        const ang = (Math.atan2(v.y, v.x) * 180) / Math.PI;
        const sa = Math.round(ang / step) * step;
        const off = L * Math.abs(Math.sin(((ang - sa) * Math.PI) / 180));
        if (ortho || off <= tol) {
          const dir = { x: Math.cos((sa * Math.PI) / 180), y: Math.sin((sa * Math.PI) / 180) };
          if (Math.abs(dir.x) < 1e-12) dir.x = 0;
          if (Math.abs(dir.y) < 1e-12) dir.y = 0;
          let Lp = dot(v, dir);
          if (prefs.lengthRound !== false && !opts.noRound) Lp = roundTo(Lp, lengthStep(vp.scale, units));
          q = addScaled(from, dir, Lp);
          res.polar = { angle: ((sa % 360) + 360) % 360, dir, length: Lp };
          res.kind = 'polar';
          res.guides.push({ a: from, b: addScaled(from, dir, Math.max(Lp, 0) + 3000 / Math.max(vp.scale * 30, 1)), kind: 'polar' });
        }
      }
    }

    // Alignment guides through nearby end points.
    if (prefs.align && opts.align !== false) {
      let bx = null, by = null, bdx = tol, bdy = tol;
      const view = vp.visibleBounds(50);
      for (const c of this.points(levelId)) {
        if (c.kind === 'corner' || c.kind === 'center' || isExcluded(c)) continue;
        if (c.p.x < view.minX || c.p.x > view.maxX || c.p.y < view.minY || c.p.y > view.maxY) continue;
        const dx = Math.abs(q.x - c.p.x), dy = Math.abs(q.y - c.p.y);
        if (dx < bdx && dist(c.p, q) > tol) {
          bdx = dx;
          bx = c.p;
        }
        if (dy < bdy && dist(c.p, q) > tol) {
          bdy = dy;
          by = c.p;
        }
      }
      if (from && dist(from, q) > tol) {
        // also track the drawing start point
        const dx = Math.abs(q.x - from.x), dy = Math.abs(q.y - from.y);
        if (dx < bdx) {
          bdx = dx;
          bx = from;
        }
        if (dy < bdy) {
          bdy = dy;
          by = from;
        }
      }
      if (res.polar) {
        const d = res.polar.dir;
        let hit = null;
        if (bx && Math.abs(d.x) > 1e-6) {
          const h = lineLine(from, d, bx, { x: 0, y: 1 });
          if (h && h.t > 0 && dist(h.point, q) <= tol) hit = { point: h.point, ref: bx, dir: 'v' };
        }
        if (!hit && by && Math.abs(d.y) > 1e-6) {
          const h = lineLine(from, d, by, { x: 1, y: 0 });
          if (h && h.t > 0 && dist(h.point, q) <= tol) hit = { point: h.point, ref: by, dir: 'h' };
        }
        if (hit) {
          q = hit.point;
          res.kind = 'align';
          res.polar.length = dist(from, q);
          res.guides.push({ a: hit.ref, b: q, kind: 'align' });
        }
      } else if (bx || by) {
        const step = prefs.lengthRound !== false && !opts.noRound ? lengthStep(vp.scale, units) / 2 : 0;
        if (bx) q.x = bx.x;
        else if (step) q.x = roundTo(q.x, step);
        if (by) q.y = by.y;
        else if (step) q.y = roundTo(q.y, step);
        if (bx) res.guides.push({ a: bx, b: { x: bx.x, y: q.y }, kind: 'align' });
        if (by) res.guides.push({ a: by, b: { x: q.x, y: by.y }, kind: 'align' });
        res.kind = 'align';
      }
    }

    // On-wall (nearest point on a wall centre-line) for T-junctions.
    if (prefs.object && opts.onWall !== false) {
      const lv = app.derived.level(levelId);
      let best = null;
      for (const g of lv.geoms.values()) {
        if (exclude.has(g.wall.id)) continue;
        const bb = g.bbox;
        if (q.x < bb.minX - tol || q.x > bb.maxX + tol || q.y < bb.minY - tol || q.y > bb.maxY + tol) continue;
        const pr = g.path.project(q);
        if (pr.dist <= tol && (!best || pr.dist < best.pr.dist)) best = { g, pr };
      }
      if (best) {
        let target = best.pr.point;
        if (res.polar) {
          const path = best.g.path;
          const d = res.polar.dir;
          let cands = [];
          if (!path.isArc) {
            const h = lineLine(from, d, path.a, path.dir);
            if (h) cands.push(h.point);
          } else {
            cands = lineCircle(from, d, path.center, path.radius).map((t) => addScaled(from, d, t));
          }
          cands = cands.filter((c) => dist(c, q) <= tol * 1.5);
          if (cands.length) target = cands.sort((a, b) => dist(a, q) - dist(b, q))[0];
          else target = null;
        }
        if (target) {
          q = { x: target.x, y: target.y };
          res.kind = 'onwall';
          res.ref = { id: best.g.wall.id, kind: 'onwall' };
          if (res.polar) res.polar.length = dist(from, q);
        }
      }
    }

    if (!res.kind && prefs.grid && !opts.noGrid) {
      const g = app.model.settings.grid || 100;
      q = { x: roundTo(q.x, g), y: roundTo(q.y, g) };
      res.kind = 'grid';
    } else if (!res.kind && !opts.noRound && prefs.lengthRound !== false) {
      // Free points are rounded to a step that is invisible at this zoom level,
      // which keeps coordinates and lengths tidy.
      const step = lengthStep(vp.scale, units) / 2;
      q = { x: roundTo(q.x, step), y: roundTo(q.y, step) };
    }
    res.p = q;
    return res;
  }
}

/** Nearest wall to a point within tolerance (mm). */
export function nearestWall(derived, levelId, p, tolMm, exclude = null) {
  const lv = derived.level(levelId);
  let best = null;
  for (const g of lv.geoms.values()) {
    if (exclude && exclude.has(g.wall.id)) continue;
    const bb = g.bbox;
    if (p.x < bb.minX - tolMm || p.x > bb.maxX + tolMm || p.y < bb.minY - tolMm || p.y > bb.maxY + tolMm) continue;
    const pr = g.path.project(p);
    const d = Math.max(0, pr.dist - g.half);
    if (d <= tolMm && (!best || pr.dist < best.pr.dist)) best = { g, pr, d };
  }
  return best;
}

