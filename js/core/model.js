// Project document, undo/redo history and commit-time normalisation.
//
// The document is plain JSON so it can be snapshotted for undo, autosaved and
// exported. Tools mutate it directly for live previews and call touch(); a
// finished edit calls commit(label), which normalises the document (room tags,
// opening clamps) and records an undo step. revert() drops uncommitted edits.

import { Emitter } from './emitter.js';
import { computeWallGeoms } from '../geom/joins.js';
import { detectRooms } from '../geom/rooms.js';
import { pointInPolygon, distToPolygonEdge } from '../geom/polygon.js';
import { ensureRoofCCW } from '../geom/roof.js';

export const COLLECTIONS = ['walls', 'openings', 'rooms', 'roofs', 'dims', 'sections', 'views', 'texts'];
export const KIND_OF = {
  walls: 'wall',
  openings: 'opening',
  rooms: 'room',
  roofs: 'roof',
  dims: 'dim',
  sections: 'section',
  views: 'view',
  texts: 'text',
};
const PREFIX = { walls: 'w', openings: 'o', rooms: 'r', roofs: 'f', dims: 'd', sections: 's', views: 'v', texts: 't', levels: 'L' };

export const DEFAULT_SETTINGS = {
  units: 'mm',
  grid: 100,
  wallThickness: 200,
  wallHeight: 2700,
  doorWidth: 820,
  doorHeight: 2040,
  windowWidth: 1200,
  windowHeight: 1200,
  windowSill: 900,
  roofPitch: 25,
  roofOverhang: 450,
  roofThickness: 250,
  slabThickness: 150,
};

const MAX_HISTORY = 200;

export function newDoc(name = 'Untitled plan') {
  return {
    app: 'lintel',
    version: 1,
    name,
    seq: 1,
    settings: { ...DEFAULT_SETTINGS },
    levels: [{ id: 'L1', name: 'Ground floor', elevation: 0, height: DEFAULT_SETTINGS.wallHeight }],
    walls: [],
    openings: [],
    rooms: [],
    roofs: [],
    dims: [],
    sections: [],
    views: [],
    texts: [],
    created: Date.now(),
    modified: Date.now(),
  };
}

/** Upgrade/repair a loaded document. */
export function migrate(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Not a plan file');
  const base = newDoc(doc.name || 'Untitled plan');
  const out = { ...base, ...doc };
  out.settings = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
  for (const c of COLLECTIONS) out[c] = Array.isArray(doc[c]) ? doc[c] : [];
  if (!Array.isArray(doc.levels) || !doc.levels.length) out.levels = base.levels;
  const levelIds = new Set(out.levels.map((l) => l.id));
  const firstLevel = out.levels[0].id;
  for (const c of COLLECTIONS) {
    for (const o of out[c]) {
      if ('level' in o && !levelIds.has(o.level)) o.level = firstLevel;
    }
  }
  for (const w of out.walls) {
    w.bulge = Number.isFinite(w.bulge) ? w.bulge : 0;
    if (!(w.thickness > 0)) w.thickness = out.settings.wallThickness;
    if (!(w.height > 0)) w.height = out.settings.wallHeight;
  }
  // Keep the id sequence ahead of every existing id.
  let max = out.seq || 1;
  const bump = (id) => {
    const m = /^[a-zA-Z]+([0-9a-z]+)$/.exec(String(id));
    if (m) {
      const v = parseInt(m[1], 36);
      if (Number.isFinite(v) && v > max) max = v;
    }
  };
  for (const c of COLLECTIONS) out[c].forEach((o) => bump(o.id));
  out.levels.forEach((l) => bump(l.id));
  out.seq = max + 1;
  return out;
}

export class Model extends Emitter {
  constructor(doc) {
    super();
    this.version = 0;
    this._index = null;
    this._indexVersion = -1;
    this.load(doc || newDoc());
  }

  load(doc) {
    this.doc = migrate(doc);
    normalize(this.doc);
    this.history = [JSON.stringify(this.doc)];
    this.hIndex = 0;
    this.dirtyLive = false;
    this.version++;
    this.emit('load');
    this.emit('change', { type: 'load' });
  }

  get settings() {
    return this.doc.settings;
  }

  nextId(coll) {
    const p = PREFIX[coll] || 'x';
    let id;
    do {
      id = p + (this.doc.seq++).toString(36);
    } while (this.get(id));
    return id;
  }

  _rebuildIndex() {
    const idx = new Map();
    for (const c of COLLECTIONS) for (const o of this.doc[c]) idx.set(o.id, { coll: c, obj: o });
    for (const l of this.doc.levels) idx.set(l.id, { coll: 'levels', obj: l });
    this._index = idx;
    this._indexVersion = this.version;
    this._indexSize = this._countAll();
  }

  _countAll() {
    let n = this.doc.levels.length;
    for (const c of COLLECTIONS) n += this.doc[c].length;
    return n;
  }

  _entry(id) {
    if (!this._index || this._indexVersion !== this.version || this._indexSize !== this._countAll()) this._rebuildIndex();
    let e = this._index.get(id);
    if (e && !this.doc[e.coll].includes(e.obj)) {
      this._rebuildIndex();
      e = this._index.get(id);
    }
    return e;
  }

  get(id) {
    return this._entry(id)?.obj || null;
  }

  kind(id) {
    const e = this._entry(id);
    return e ? KIND_OF[e.coll] || e.coll : null;
  }

  collectionOf(id) {
    return this._entry(id)?.coll || null;
  }

  level(id) {
    return this.doc.levels.find((l) => l.id === id) || null;
  }

  wallsOn(levelId) {
    return this.doc.walls.filter((w) => w.level === levelId);
  }

  openingsOf(wallId) {
    return this.doc.openings.filter((o) => o.wall === wallId);
  }

  add(coll, obj) {
    if (!obj.id) obj.id = this.nextId(coll);
    this.doc[coll].push(obj);
    this.version++;
    return obj;
  }

  /** Remove elements and their dependants (openings hosted by removed walls). */
  remove(ids) {
    const set = new Set(ids);
    const walls = new Set(this.doc.walls.filter((w) => set.has(w.id)).map((w) => w.id));
    for (const c of COLLECTIONS) {
      this.doc[c] = this.doc[c].filter((o) => !set.has(o.id) && !(c === 'openings' && walls.has(o.wall)));
    }
    this.version++;
  }

  /** A live (uncommitted) change. */
  touch() {
    this.version++;
    this.dirtyLive = true;
    this.emit('change', { live: true });
  }

  commit(label = 'Edit') {
    normalize(this.doc);
    this.doc.modified = Date.now();
    const json = JSON.stringify(this.doc);
    this.dirtyLive = false;
    this.version++;
    if (json !== this.history[this.hIndex]) {
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push(json);
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.hIndex = this.history.length - 1;
      this.lastLabel = label;
      this.emit('change', { label });
      this.emit('commit', { label });
    } else {
      this.emit('change', { label, noop: true });
    }
  }

  /** Discard uncommitted edits. */
  revert() {
    this.doc = JSON.parse(this.history[this.hIndex]);
    this.dirtyLive = false;
    this.version++;
    this.emit('change', { type: 'revert' });
  }

  get canUndo() {
    return this.hIndex > 0;
  }

  get canRedo() {
    return this.hIndex < this.history.length - 1;
  }

  undo() {
    if (this.dirtyLive) {
      this.revert();
      return true;
    }
    if (!this.canUndo) return false;
    this.hIndex--;
    this.doc = JSON.parse(this.history[this.hIndex]);
    this.version++;
    this.emit('change', { type: 'undo' });
    this.emit('commit', { type: 'undo' });
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.hIndex++;
    this.doc = JSON.parse(this.history[this.hIndex]);
    this.version++;
    this.emit('change', { type: 'redo' });
    this.emit('commit', { type: 'redo' });
    return true;
  }
}

function nextRoomName(existing) {
  const used = new Set(existing.map((t) => t.name));
  for (let i = 1; ; i++) if (!used.has(`Room ${i}`)) return `Room ${i}`;
}

/** Commit-time clean-up: dangling openings, opening clamps and room tags. */
export function normalize(doc) {
  for (const r of doc.roofs) ensureRoofCCW(r);
  const wallIds = new Set(doc.walls.map((w) => w.id));
  doc.openings = doc.openings.filter((o) => wallIds.has(o.wall));
  doc.walls = doc.walls.filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= 1);

  for (const level of doc.levels) {
    const walls = doc.walls.filter((w) => w.level === level.id);
    const { geoms } = computeWallGeoms(walls);

    // Clamp openings into the usable length of their walls, without overlaps.
    const byWall = new Map();
    for (const o of doc.openings) {
      if (!geoms.has(o.wall)) continue;
      if (!byWall.has(o.wall)) byWall.set(o.wall, []);
      byWall.get(o.wall).push(o);
    }
    for (const [wid, list] of byWall) {
      const g = geoms.get(wid);
      const lo = g.sMin + 20, hi = g.sMax - 20;
      const avail = Math.max(0, hi - lo);
      list.sort((a, b) => a.pos - b.pos);
      for (const o of list) {
        o.width = Math.max(100, Math.min(o.width, avail));
        const minPos = lo + o.width / 2, maxPos = hi - o.width / 2;
        o.pos = minPos > maxPos ? (lo + hi) / 2 : Math.min(maxPos, Math.max(minPos, o.pos));
        const wallH = g.wall.height;
        o.height = Math.max(100, Math.min(o.height, wallH - (o.sill || 0)));
      }
    }

    // Room tags: one per detected room; keep names when rooms change shape.
    const { rooms } = detectRooms(walls);
    const tags = doc.rooms.filter((t) => t.level === level.id);
    const used = new Set();
    const unmatched = [];
    rooms.sort((a, b) => b.area - a.area);
    for (const room of rooms) {
      const inside = tags.filter((t) => !used.has(t.id) && pointInPolygon(t, room.poly));
      if (inside.length) {
        inside.forEach((t) => used.add(t.id));
        const primary = inside[0];
        if (primary.auto !== false) {
          primary.x = Math.round(room.label.x);
          primary.y = Math.round(room.label.y);
        }
      } else {
        unmatched.push(room);
      }
    }
    for (const room of unmatched) {
      // Adopt a nearby orphaned tag (e.g. a wall moved past the label).
      let best = null, bestD = 1500;
      for (const t of tags) {
        if (used.has(t.id)) continue;
        const d = distToPolygonEdge(t, room.poly);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        best.x = Math.round(room.label.x);
        best.y = Math.round(room.label.y);
        best.auto = true;
        used.add(best.id);
      } else {
        const id = 'r' + (doc.seq++).toString(36);
        const tag = {
          id,
          level: level.id,
          x: Math.round(room.label.x),
          y: Math.round(room.label.y),
          name: nextRoomName(doc.rooms.filter((t) => t.level === level.id)),
          auto: true,
        };
        doc.rooms.push(tag);
        used.add(id);
      }
    }
    doc.rooms = doc.rooms.filter((t) => t.level !== level.id || used.has(t.id));
  }
  return doc;
}
