// Editing operations on the document. Walls that share an end point stay joined
// when one of them is edited, and walls that end against the side of another
// wall (T-junctions) slide along their own direction to stay attached.

import { wallPath, sagittaFrom3 } from '../geom/path.js';
import { NODE_TOL, TEE_TOL } from '../geom/joins.js';
import { dist, sub, dot, norm, lineLine, rotate, addScaled, lineCircle, clamp } from './vec.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const other = (which) => (which === 'a' ? 'b' : 'a');

/** Wall ends (on a level) within tol of p. */
export function wallEndsAt(doc, levelId, p, tol = NODE_TOL, excludeId = null) {
  const out = [];
  for (const w of doc.walls) {
    if (w.level !== levelId || w.id === excludeId) continue;
    if (dist(w.a, p) <= tol) out.push({ wall: w, which: 'a' });
    if (dist(w.b, p) <= tol) out.push({ wall: w, which: 'b' });
  }
  return out;
}

/** Ends of other walls lying on the body of `host` (T-junctions). */
export function teeWallsOn(doc, host, tol = TEE_TOL) {
  const path = wallPath(host);
  const out = [];
  for (const w of doc.walls) {
    if (w.level !== host.level || w.id === host.id) continue;
    for (const which of ['a', 'b']) {
      const p = w[which];
      if (dist(p, host.a) <= NODE_TOL || dist(p, host.b) <= NODE_TOL) continue;
      const pr = path.project(p);
      if (pr.dist <= tol && pr.raw > -tol && pr.raw < path.length + tol) out.push({ wall: w, which, s: pr.s });
    }
  }
  return out;
}

/** Intersect the ray from `origin` along `dir` with a wall centre-line; returns the point or null. */
export function intersectRayWall(origin, dir, wall, near) {
  const path = wallPath(wall);
  let cands = [];
  if (!path.isArc) {
    const hit = lineLine(origin, dir, path.a, path.dir);
    if (hit && hit.u >= -NODE_TOL && hit.u <= path.length + NODE_TOL) cands.push(hit.point);
  } else {
    for (const t of lineCircle(origin, dir, path.center, path.radius)) {
      const p = addScaled(origin, dir, t);
      const raw = path.paramOf(p);
      if (raw >= -NODE_TOL && raw <= path.length + NODE_TOL) cands.push(p);
    }
  }
  if (!cands.length) return null;
  const ref = near || origin;
  cands.sort((p, q) => dist(p, ref) - dist(q, ref));
  return cands[0];
}

function openingWorldPoint(doc, o) {
  const w = doc.walls.find((x) => x.id === o.wall);
  if (!w) return null;
  const path = wallPath(w);
  return path.pointAt(clamp(o.pos, 0, path.length));
}

/** Remember opening positions in world space so they can be re-projected after an edit. */
function captureOpenings(doc, wallIds) {
  return doc.openings
    .filter((o) => wallIds.has(o.wall))
    .map((o) => ({ o, pt: openingWorldPoint(doc, o) }))
    .filter((r) => r.pt);
}

function restoreOpenings(doc, recs) {
  for (const r of recs) {
    const w = doc.walls.find((x) => x.id === r.o.wall);
    if (!w) continue;
    r.o.pos = wallPath(w).project(r.pt).s;
  }
}

const translatePt = (p, d) => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * Prepare a transform (move / rotate / mirror) of the given elements.
 * Captures original geometry so that apply* can be called repeatedly while dragging.
 */
export function beginTransform(doc, ids) {
  const sel = new Set(ids);
  const orig = new Map();
  const all = [];
  for (const c of ['walls', 'openings', 'rooms', 'roofs', 'dims', 'sections', 'views', 'texts']) {
    for (const el of doc[c]) {
      if (sel.has(el.id)) {
        orig.set(el.id, clone(el));
        all.push({ c, el });
      }
    }
  }
  const walls = all.filter((x) => x.c === 'walls').map((x) => x.el);
  const wallSet = new Set(walls.map((w) => w.id));
  const stretch = [];
  const seen = new Set();
  for (const w of walls) {
    for (const which of ['a', 'b']) {
      for (const att of wallEndsAt(doc, w.level, w[which])) {
        if (wallSet.has(att.wall.id)) continue;
        const key = att.wall.id + att.which;
        if (seen.has(key)) continue;
        seen.add(key);
        stretch.push({ wall: att.wall, which: att.which, orig: { ...att.wall[att.which] }, host: w, hostWhich: which });
      }
    }
  }
  const tees = [];
  for (const w of walls) {
    for (const t of teeWallsOn(doc, w)) {
      if (wallSet.has(t.wall.id)) continue;
      const key = t.wall.id + t.which;
      if (seen.has(key)) continue;
      seen.add(key);
      tees.push({ wall: t.wall, which: t.which, orig: { ...t.wall[t.which] }, host: w });
    }
  }
  const neighbourIds = new Set([...stretch, ...tees].map((s) => s.wall.id));
  const openingRecs = captureOpenings(doc, neighbourIds);
  // Openings selected without their wall slide along the wall.
  const looseOpenings = all
    .filter((x) => x.c === 'openings' && !wallSet.has(x.el.wall))
    .map((x) => ({ o: x.el, pt: openingWorldPoint(doc, x.el) }))
    .filter((r) => r.pt);
  return { sel, all, orig, walls, wallSet, stretch, tees, openingRecs, looseOpenings };
}

function updateNeighbours(doc, ctx, mapPoint) {
  for (const s of ctx.stretch) {
    s.wall[s.which] = { ...s.host[s.hostWhich] };
  }
  for (const t of ctx.tees) {
    const fixed = t.wall[other(t.which)];
    const dir = norm(sub(t.orig, fixed));
    const moved = mapPoint(t.orig);
    const hit = intersectRayWall(fixed, dir, t.host, moved);
    t.wall[t.which] = hit && dist(hit, moved) < 4 * dist(t.orig, moved) + 2000 ? hit : moved;
  }
  restoreOpenings(doc, ctx.openingRecs);
}

/** Apply a generic point mapping to the selection (used by move/rotate/mirror). */
function applyMapping(doc, ctx, mapPoint, { mirror = false, angle = 0 } = {}) {
  for (const { c, el } of ctx.all) {
    const o = ctx.orig.get(el.id);
    switch (c) {
      case 'walls':
        el.a = mapPoint(o.a);
        el.b = mapPoint(o.b);
        el.bulge = mirror ? -(o.bulge || 0) : o.bulge || 0;
        break;
      case 'openings':
        if (ctx.wallSet.has(el.wall)) {
          el.swing = mirror ? -(o.swing || 1) : o.swing;
        }
        break;
      case 'rooms':
      case 'texts': {
        const p = mapPoint({ x: o.x, y: o.y });
        el.x = p.x;
        el.y = p.y;
        if (c === 'rooms') el.auto = false;
        if (c === 'texts') el.angle = mirror ? -(o.angle || 0) : (o.angle || 0) + angle;
        break;
      }
      case 'roofs': {
        let pts = o.points.map(mapPoint);
        if (mirror) pts = pts.reverse();
        el.points = pts;
        if (mirror && Array.isArray(o.edges)) {
          const n = o.edges.length;
          el.edges = o.edges.map((_, i) => o.edges[(n - 2 - i + n) % n]);
        }
        break;
      }
      case 'dims':
      case 'sections':
        el.a = mapPoint(o.a);
        el.b = mapPoint(o.b);
        if (c === 'sections' && mirror) el.flip = !o.flip;
        break;
      case 'views': {
        const p = mapPoint(o.pos), t = mapPoint(o.target);
        el.pos = { ...el.pos, x: p.x, y: p.y };
        el.target = { ...el.target, x: t.x, y: t.y };
        break;
      }
    }
  }
  for (const r of ctx.looseOpenings) {
    const w = doc.walls.find((x) => x.id === r.o.wall);
    if (w) r.o.pos = wallPath(w).project(mapPoint(r.pt)).s;
  }
  updateNeighbours(doc, ctx, mapPoint);
}

export function applyTranslate(doc, ctx, delta) {
  applyMapping(doc, ctx, (p) => translatePt(p, delta));
}

export function applyRotate(doc, ctx, center, angle) {
  applyMapping(doc, ctx, (p) => rotate(p, angle, center), { angle });
}

export function applyMirror(doc, ctx, a, b) {
  const d = norm(sub(b, a));
  const map = (p) => {
    const v = sub(p, a);
    const t = dot(v, d);
    const proj = addScaled(a, d, t);
    return { x: 2 * proj.x - p.x, y: 2 * proj.y - p.y };
  };
  applyMapping(doc, ctx, map, { mirror: true });
}

/**
 * Duplicate elements (walls bring their openings). Returns the new ids.
 * The copies are placed with the given offset.
 */
export function duplicate(model, ids, delta = { x: 0, y: 0 }, levelId = null) {
  const doc = model.doc;
  const sel = new Set(ids);
  const newIds = [];
  const wallMap = new Map();
  for (const w of doc.walls.filter((x) => sel.has(x.id))) {
    const c = clone(w);
    c.id = model.nextId('walls');
    c.a = translatePt(c.a, delta);
    c.b = translatePt(c.b, delta);
    if (levelId) c.level = levelId;
    wallMap.set(w.id, c.id);
    doc.walls.push(c);
    newIds.push(c.id);
  }
  for (const o of doc.openings.filter((x) => wallMap.has(x.wall))) {
    const c = clone(o);
    c.id = model.nextId('openings');
    c.wall = wallMap.get(o.wall);
    doc.openings.push(c);
  }
  for (const coll of ['roofs', 'dims', 'texts', 'sections', 'views', 'rooms']) {
    for (const el of doc[coll].filter((x) => sel.has(x.id))) {
      if (coll === 'rooms') continue; // rooms are derived from walls
      const c = clone(el);
      c.id = model.nextId(coll);
      if (levelId && 'level' in c) c.level = levelId;
      if (c.points) c.points = c.points.map((p) => translatePt(p, delta));
      if (c.a) c.a = translatePt(c.a, delta);
      if (c.b) c.b = translatePt(c.b, delta);
      if ('x' in c && 'y' in c) {
        c.x += delta.x;
        c.y += delta.y;
      }
      if (c.pos && c.target) {
        c.pos = { ...c.pos, x: c.pos.x + delta.x, y: c.pos.y + delta.y };
        c.target = { ...c.target, x: c.target.x + delta.x, y: c.target.y + delta.y };
      }
      if (coll === 'sections' || coll === 'views') c.name = `${c.name} copy`;
      doc[coll].push(c);
      newIds.push(c.id);
    }
  }
  model.version++;
  return newIds;
}

/* ---------- Wall end-point and shape edits ---------- */

/** Prepare dragging one end of a wall (joined ends follow, T walls stay attached). */
export function beginEndDrag(doc, wall, which, detach = false) {
  const p = wall[which];
  const joined = detach ? [] : wallEndsAt(doc, wall.level, p, NODE_TOL, wall.id);
  const hosts = [wall, ...joined.map((j) => j.wall)];
  const tees = [];
  for (const h of hosts) {
    for (const t of teeWallsOn(doc, h)) {
      if (hosts.includes(t.wall)) continue;
      tees.push({ wall: t.wall, which: t.which, orig: { ...t.wall[t.which] }, host: h });
    }
  }
  const affected = new Set([...hosts, ...tees.map((t) => t.wall)].map((w) => w.id));
  return { wall, which, joined, tees, openingRecs: captureOpenings(doc, affected), origin: { ...p } };
}

export function applyEndDrag(doc, ctx, p) {
  ctx.wall[ctx.which] = { x: p.x, y: p.y };
  for (const j of ctx.joined) j.wall[j.which] = { x: p.x, y: p.y };
  for (const t of ctx.tees) {
    const fixed = t.wall[other(t.which)];
    const dir = norm(sub(t.orig, fixed));
    const hit = intersectRayWall(fixed, dir, t.host, t.orig);
    t.wall[t.which] = hit || t.orig;
  }
  restoreOpenings(doc, ctx.openingRecs);
}

/**
 * Prepare moving a wall parallel to itself. Corner neighbours slide along their
 * own direction so their angles are kept (like Revit), T walls stay attached.
 */
export function beginParallelMove(doc, wall) {
  const ends = {};
  for (const which of ['a', 'b']) {
    const joined = wallEndsAt(doc, wall.level, wall[which], NODE_TOL, wall.id);
    ends[which] = { joined, orig: { ...wall[which] } };
  }
  const tees = teeWallsOn(doc, wall).map((t) => ({ wall: t.wall, which: t.which, orig: { ...t.wall[t.which] } }));
  const affected = new Set([wall.id, ...ends.a.joined.map((j) => j.wall.id), ...ends.b.joined.map((j) => j.wall.id), ...tees.map((t) => t.wall.id)]);
  return { wall, ends, tees, openingRecs: captureOpenings(doc, affected), path: wallPath(wall), bulge: wall.bulge || 0 };
}

export function applyParallelMove(doc, ctx, offset) {
  const { wall, path } = ctx;
  const n0 = path.normalAt(0), n1 = path.normalAt(path.length);
  const newA = addScaled(ctx.ends.a.orig, n0, offset);
  const newB = addScaled(ctx.ends.b.orig, n1, offset);
  // For arcs keep the curve concentric: scale the sagitta with the radius.
  if (path.isArc) {
    const mid = path.offsetAt(path.length / 2, offset);
    wall.a = newA;
    wall.b = newB;
    wall.bulge = sagittaFrom3(newA, mid, newB);
  } else {
    const dir = path.dir;
    for (const which of ['a', 'b']) {
      const end = ctx.ends[which];
      let target = which === 'a' ? newA : newB;
      if (end.joined.length === 1) {
        const nb = end.joined[0];
        const fixed = nb.wall[other(nb.which)];
        const ndir = norm(sub(end.orig, fixed));
        const hit = lineLine(fixed, ndir, target, dir);
        if (hit && Math.abs(dot(ndir, path.nrm)) > 0.2) target = hit.point;
      }
      wall[which] = target;
    }
  }
  for (const which of ['a', 'b']) {
    for (const j of ctx.ends[which].joined) j.wall[j.which] = { ...wall[which] };
  }
  for (const t of ctx.tees) {
    const fixed = t.wall[other(t.which)];
    const dir = norm(sub(t.orig, fixed));
    const hit = intersectRayWall(fixed, dir, wall, t.orig);
    if (hit) t.wall[t.which] = hit;
  }
  restoreOpenings(doc, ctx.openingRecs);
}

/** Set the length of a wall by moving its b end (curved walls scale uniformly). */
export function setWallLength(doc, wall, length) {
  const path = wallPath(wall);
  if (!(length > 1) || !(path.length > 0)) return;
  const k = length / path.length;
  const ctx = beginEndDrag(doc, wall, 'b');
  const nb = { x: wall.a.x + (wall.b.x - wall.a.x) * k, y: wall.a.y + (wall.b.y - wall.a.y) * k };
  const keep = doc.openings.filter((o) => o.wall === wall.id).map((o) => [o, o.pos]);
  applyEndDrag(doc, ctx, nb);
  wall.bulge = (wall.bulge || 0) * k;
  for (const [o, pos] of keep) o.pos = pos; // openings keep their distance from the start
}

/** Set the direction of a wall (degrees, CCW from +x) by rotating b about a. */
export function setWallAngle(doc, wall, deg) {
  const L = dist(wall.a, wall.b);
  const t = (deg * Math.PI) / 180;
  const ctx = beginEndDrag(doc, wall, 'b');
  const keep = doc.openings.filter((o) => o.wall === wall.id).map((o) => [o, o.pos]);
  applyEndDrag(doc, ctx, { x: wall.a.x + Math.cos(t) * L, y: wall.a.y + Math.sin(t) * L });
  for (const [o, pos] of keep) o.pos = pos;
}

/** Reverse a wall's direction keeping its geometry and openings in place. */
export function flipWall(doc, wall) {
  const L = wallPath(wall).length;
  [wall.a, wall.b] = [wall.b, wall.a];
  wall.bulge = -(wall.bulge || 0);
  if (wall.heightEnd != null) [wall.height, wall.heightEnd] = [wall.heightEnd, wall.height];
  for (const o of doc.openings) {
    if (o.wall !== wall.id) continue;
    o.pos = L - o.pos;
    o.swing = -(o.swing || 1);
    o.hinge = o.hinge === 'end' ? 'start' : 'end';
  }
}

/** Split a wall at parameter s; returns the new (second) wall. */
export function splitWall(model, wall, s) {
  const doc = model.doc;
  const path = wallPath(wall);
  if (s <= 1 || s >= path.length - 1) return null;
  const P = path.pointAt(s);
  const w2 = clone(wall);
  w2.id = model.nextId('walls');
  if (path.isArc) {
    const m1 = path.pointAt(s / 2), m2 = path.pointAt((s + path.length) / 2);
    wall.bulge = sagittaFrom3(wall.a, m1, P);
    w2.bulge = sagittaFrom3(P, m2, w2.b);
  }
  if (wall.heightEnd != null) {
    const hAt = wall.height + ((wall.heightEnd - wall.height) * s) / path.length;
    w2.height = hAt;
    wall.heightEnd = hAt;
  }
  wall.b = { ...P };
  w2.a = { ...P };
  doc.walls.push(w2);
  for (const o of doc.openings) {
    if (o.wall !== wall.id) continue;
    if (o.pos > s) {
      o.wall = w2.id;
      o.pos -= s;
    }
  }
  model.version++;
  return w2;
}

/** A parallel copy of a wall at signed distance d (positive = left side). */
export function offsetWallCopy(model, wall, d) {
  const path = wallPath(wall);
  const w2 = clone(wall);
  w2.id = model.nextId('walls');
  w2.a = path.offsetAt(0, d);
  w2.b = path.offsetAt(path.length, d);
  w2.bulge = path.isArc ? sagittaFrom3(w2.a, path.offsetAt(path.length / 2, d), w2.b) : 0;
  model.doc.walls.push(w2);
  model.version++;
  return w2;
}

/** Create a chain of walls through points. Returns the new walls. */
export function addWallChain(model, level, points, { closed = false, bulges = [], props = {} } = {}) {
  const s = model.settings;
  const walls = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % n];
    if (dist(a, b) < 1) continue;
    walls.push(
      model.add('walls', {
        level,
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        bulge: bulges[i] || 0,
        thickness: props.thickness ?? s.wallThickness,
        height: props.height ?? model.level(level)?.height ?? s.wallHeight,
        heightEnd: null,
        baseOffset: 0,
      }),
    );
  }
  return walls;
}

