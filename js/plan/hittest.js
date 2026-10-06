// Hit testing for selection in the plan view.

import { dist, projectToSegment, sub } from '../core/vec.js';
import { pointInPolygon } from '../geom/polygon.js';
import { dimGeometry } from './render.js';

/**
 * Topmost element under world point p. tolMm is the pick tolerance in mm.
 * Returns {id, kind} or null.
 */
export function hitTest(app, p, tolMm, opts = {}) {
  const doc = app.model.doc;
  const levelId = app.activeLevel;
  const lv = app.derived.level(levelId);
  const layers = app.prefs.layers;
  const vp = app.plan.vp;

  // Openings: inside their gap (with tolerance).
  for (const [wid, list] of lv.openingsByWall) {
    const g = lv.geoms.get(wid);
    for (const { o, s0, s1 } of list) {
      const pr = g.path.project(p);
      const ext = Math.min(tolMm * 0.5, (s1 - s0) * 0.25);
      if (pr.s >= s0 - ext && pr.s <= s1 + ext && pr.dist <= g.half + tolMm) return { id: o.id, kind: 'opening' };
      if (o.kind === 'door') {
        // the door swing area on the opening side
        const w = s1 - s0;
        const sm = (s0 + s1) / 2;
        const side = (o.swing ?? 1) >= 0 ? 1 : -1;
        if (pr.s >= s0 && pr.s <= s1 && pr.side === side && pr.dist <= g.half + w * 0.9 && Math.abs(pr.s - sm) <= w / 2) {
          if (!opts.wallsOnly) return { id: o.id, kind: 'opening' };
        }
      }
    }
  }

  // Points inside a wall's thickness pick that wall first.
  for (const g of lv.geoms.values()) {
    const bb = g.bbox;
    if (p.x < bb.minX || p.x > bb.maxX || p.y < bb.minY || p.y > bb.maxY) continue;
    const pr = g.path.project(p);
    if (pr.dist <= g.half && pr.raw >= -1 && pr.raw <= g.path.length + 1) return { id: g.wall.id, kind: 'wall' };
  }

  // Dimensions.
  if (layers.dims) {
    for (const d of doc.dims) {
      if (d.level !== levelId) continue;
      const { a2, b2 } = dimGeometry(d);
      if (projectToSegment(p, a2, b2).dist <= tolMm) return { id: d.id, kind: 'dim' };
    }
  }
  // Texts.
  for (const t of doc.texts) {
    if (t.level !== levelId) continue;
    const size = t.size || 300;
    const w = Math.max(size, (t.text || '').length * size * 0.6);
    if (Math.abs(p.x - t.x) <= w / 2 + tolMm && Math.abs(p.y - t.y) <= size / 2 + tolMm) return { id: t.id, kind: 'text' };
  }
  // Sections (line and heads).
  if (layers.sections) {
    for (const s of doc.sections) {
      if (dist(p, s.a) <= 14 / vp.scale + tolMm || dist(p, s.b) <= 14 / vp.scale + tolMm) return { id: s.id, kind: 'section' };
      if (projectToSegment(p, s.a, s.b).dist <= tolMm * 0.8) return { id: s.id, kind: 'section' };
    }
  }
  // Cameras.
  if (layers.cameras) {
    for (const v of doc.views) {
      if (!v.pos) continue;
      if (dist(p, v.pos) <= 16 / vp.scale + tolMm) return { id: v.id, kind: 'view' };
    }
  }
  // Room labels (only where the label is drawn).
  if (layers.rooms) {
    for (const r of lv.rooms) {
      if (!r.tag) continue;
      const bb = r.poly.reduce(
        (b, q) => ({ minX: Math.min(b.minX, q.x), maxX: Math.max(b.maxX, q.x), minY: Math.min(b.minY, q.y), maxY: Math.max(b.maxY, q.y) }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      if ((bb.maxX - bb.minX) * vp.scale < 40 || (bb.maxY - bb.minY) * vp.scale < 26) continue;
      const P = vp.w2s(r.tag), Q = vp.w2s(p);
      const halfW = Math.max(30, ((r.tag.name || 'Room').length * 7.5) / 2 + 6);
      if (Math.abs(P.x - Q.x) <= halfW && Math.abs(P.y - Q.y) <= 18) return { id: r.tag.id, kind: 'room' };
    }
  }
  // Walls.
  let best = null;
  for (const g of lv.geoms.values()) {
    const bb = g.bbox;
    if (p.x < bb.minX - tolMm || p.x > bb.maxX + tolMm || p.y < bb.minY - tolMm || p.y > bb.maxY + tolMm) continue;
    const pr = g.path.project(p);
    const d = pr.dist - g.half;
    if (d <= tolMm && (!best || d < best.d)) best = { id: g.wall.id, kind: 'wall', d };
  }
  if (best) return { id: best.id, kind: 'wall' };
  if (opts.wallsOnly) return null;

  // Roofs: near their outline or ridge lines.
  if (layers.roofs) {
    for (const roof of doc.roofs) {
      if (roof.level !== levelId) continue;
      const g = app.derived.roof(roof);
      if (!g) continue;
      const o = g.outline;
      for (let i = 0; i < o.length; i++) {
        if (projectToSegment(p, o[i], o[(i + 1) % o.length]).dist <= tolMm) return { id: roof.id, kind: 'roof' };
      }
      for (const [a, b] of g.lines.ridges) if (projectToSegment(p, a, b).dist <= tolMm) return { id: roof.id, kind: 'roof' };
    }
  }
  // Rooms: anywhere inside.
  if (layers.rooms) {
    for (const r of lv.rooms) if (r.tag && pointInPolygon(p, r.poly)) return { id: r.tag.id, kind: 'room' };
  }
  // Roof interior as a last resort (e.g. roof drawn over an empty area).
  if (layers.roofs) {
    for (const roof of doc.roofs) {
      if (roof.level !== levelId) continue;
      const g = app.derived.roof(roof);
      if (g && pointInPolygon(p, g.outline)) return { id: roof.id, kind: 'roof' };
    }
  }
  return null;
}

function segRectIntersects(a, b, r) {
  const inside = (p) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
  if (inside(a) || inside(b)) return true;
  const corners = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    const c = corners[i], d = corners[(i + 1) % 4];
    const r1 = sub(b, a), s = sub(d, c);
    const den = r1.x * s.y - r1.y * s.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(c, a);
    const t = (w.x * s.y - w.y * s.x) / den, u = (w.x * r1.y - w.y * r1.x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

/**
 * Elements in a rectangle. window=true selects only fully enclosed elements,
 * otherwise anything touching the rectangle (crossing selection).
 */
export function hitRect(app, rect, window = true) {
  const doc = app.model.doc;
  const levelId = app.activeLevel;
  const layers = app.prefs.layers;
  const inside = (p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  const ids = [];
  const lv = app.derived.level(levelId);
  for (const g of lv.geoms.values()) {
    const pts = g.path.polyline();
    let ok;
    if (window) ok = pts.every(inside);
    else {
      ok = false;
      for (let i = 0; i < pts.length - 1 && !ok; i++) ok = segRectIntersects(pts[i], pts[i + 1], rect);
    }
    if (ok) ids.push(g.wall.id);
  }
  for (const [wid, list] of lv.openingsByWall) {
    const g = lv.geoms.get(wid);
    for (const { o } of list) if (inside(g.path.pointAt(o.pos))) ids.push(o.id);
  }
  if (layers.rooms) for (const r of lv.rooms) if (r.tag && inside(r.tag)) ids.push(r.tag.id);
  if (layers.roofs) {
    for (const roof of doc.roofs) {
      if (roof.level !== levelId) continue;
      const ok = window ? roof.points.every(inside) : roof.points.some(inside);
      if (ok) ids.push(roof.id);
    }
  }
  if (layers.dims) {
    for (const d of doc.dims) {
      if (d.level !== levelId) continue;
      if (window ? inside(d.a) && inside(d.b) : segRectIntersects(d.a, d.b, rect)) ids.push(d.id);
    }
  }
  for (const t of doc.texts) if (t.level === levelId && inside(t)) ids.push(t.id);
  if (layers.sections) {
    for (const s of doc.sections) if (window ? inside(s.a) && inside(s.b) : segRectIntersects(s.a, s.b, rect)) ids.push(s.id);
  }
  if (layers.cameras) for (const v of doc.views) if (v.pos && inside(v.pos)) ids.push(v.id);
  return ids;
}

/** Walls connected to a wall through shared end points. */
export function connectedWalls(app, wallId) {
  const doc = app.model.doc;
  const start = doc.walls.find((w) => w.id === wallId);
  if (!start) return [];
  const out = new Set([wallId]);
  const queue = [start];
  while (queue.length) {
    const w = queue.pop();
    for (const o of doc.walls) {
      if (out.has(o.id) || o.level !== w.level) continue;
      if ([o.a, o.b].some((p) => dist(p, w.a) < 1 || dist(p, w.b) < 1)) {
        out.add(o.id);
        queue.push(o);
      }
    }
  }
  return [...out];
}

