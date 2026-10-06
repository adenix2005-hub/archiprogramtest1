// Derived geometry cache: wall joins, rooms and roofs are recomputed lazily
// whenever the model version changes.

import { computeWallGeoms, wallOutline } from '../geom/joins.js';
import { detectRooms, outlineFootprint } from '../geom/rooms.js';
import { buildRoofGeometry } from '../geom/roof.js';
import { pointInPolygon } from '../geom/polygon.js';
import { wallPath } from '../geom/path.js';
import { bboxUnion } from './vec.js';

export class Derived {
  constructor(model) {
    this.model = model;
    this._v = -1;
    this._levels = new Map();
    this._roofs = new Map();
    this._bounds = null;
  }

  _sync() {
    if (this._v !== this.model.version) {
      this._v = this.model.version;
      this._levels.clear();
      this._roofs.clear();
      this._bounds = null;
    }
  }

  level(levelId) {
    this._sync();
    let d = this._levels.get(levelId);
    if (d) return d;
    const doc = this.model.doc;
    const walls = doc.walls.filter((w) => w.level === levelId);
    const { geoms, nodes } = computeWallGeoms(walls);
    const { rooms, outlines } = detectRooms(walls);
    const tags = doc.rooms.filter((t) => t.level === levelId);
    for (const r of rooms) {
      r.tag = tags.find((t) => pointInPolygon(t, r.poly)) || null;
    }
    const openingsByWall = new Map();
    for (const o of doc.openings) {
      const g = geoms.get(o.wall);
      if (!g) continue;
      const s0 = Math.max(g.sMin, o.pos - o.width / 2);
      const s1 = Math.min(g.sMax, o.pos + o.width / 2);
      if (s1 - s0 < 1) continue;
      if (!openingsByWall.has(o.wall)) openingsByWall.set(o.wall, []);
      openingsByWall.get(o.wall).push({ o, s0, s1 });
    }
    for (const list of openingsByWall.values()) list.sort((a, b) => a.s0 - b.s0);
    const outlinesByWall = new Map();
    for (const [id, g] of geoms) {
      const cuts = mergeCuts((openingsByWall.get(id) || []).map((x) => ({ s0: x.s0, s1: x.s1 })));
      outlinesByWall.set(id, wallOutline(g, cuts));
    }
    d = { levelId, walls, geoms, nodes, rooms, outlines, openingsByWall, outlinesByWall };
    this._levels.set(levelId, d);
    return d;
  }

  wallGeom(wall) {
    return this.level(wall.level).geoms.get(wall.id) || null;
  }

  roofBase(roof) {
    const lv = this.model.level(roof.level) || this.model.doc.levels[0];
    const plate = roof.baseOffset ?? lv.height;
    return lv.elevation + plate;
  }

  roof(roof) {
    this._sync();
    let g = this._roofs.get(roof.id);
    if (g === undefined) {
      try {
        g = buildRoofGeometry(roof, this.roofBase(roof));
      } catch (err) {
        console.error('Roof geometry failed', err);
        g = null;
      }
      this._roofs.set(roof.id, g);
    }
    return g;
  }

  /** Exterior footprint polygons of the buildings on a level (for automatic roofs). */
  footprints(levelId) {
    return this.level(levelId).outlines.map((o) => outlineFootprint(o)).filter((p) => p.length >= 3);
  }

  /** Bounding box of everything in the project (mm), or null when empty. */
  bounds(levelId = null) {
    this._sync();
    if (!levelId && this._bounds !== null) return this._bounds;
    const doc = this.model.doc;
    let bb = null;
    const addPt = (p, pad = 0) => {
      bb = bboxUnion(bb, { minX: p.x - pad, minY: p.y - pad, maxX: p.x + pad, maxY: p.y + pad });
    };
    for (const w of doc.walls) {
      if (levelId && w.level !== levelId) continue;
      const b = wallPath(w).bbox();
      bb = bboxUnion(bb, { minX: b.minX - w.thickness, minY: b.minY - w.thickness, maxX: b.maxX + w.thickness, maxY: b.maxY + w.thickness });
    }
    for (const r of doc.roofs) {
      if (levelId && r.level !== levelId) continue;
      for (const p of r.points) addPt(p, r.overhang || 0);
    }
    for (const d of doc.dims) {
      if (levelId && d.level !== levelId) continue;
      addPt(d.a);
      addPt(d.b);
    }
    for (const t of doc.texts) if (!levelId || t.level === levelId) addPt(t, 500);
    if (!levelId) {
      for (const s of doc.sections) {
        addPt(s.a);
        addPt(s.b);
      }
      this._bounds = bb;
    }
    return bb;
  }
}

/** Merge overlapping cut ranges. */
export function mergeCuts(cuts) {
  const sorted = cuts.slice().sort((a, b) => a.s0 - b.s0);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.s0 <= last.s1 + 0.5) last.s1 = Math.max(last.s1, c.s1);
    else out.push({ ...c });
  }
  return out;
}
