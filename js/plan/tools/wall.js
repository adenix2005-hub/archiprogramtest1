// Wall drawing tools: polyline walls (with typed lengths and location line),
// curved (arc) walls and rectangular rooms.

import { Tool, parseDrawInput } from './base.js';
import { dist, sub, norm, perp, addScaled, lineLine, mid, roundTo } from '../../core/vec.js';
import { sagittaFrom3, makePath } from '../../geom/path.js';
import { addWallChain } from '../../core/ops.js';
import { lengthStep } from '../snap.js';

const DRAG_PX = 12;

/** Offset a reference polyline to wall centre-lines (for face-based drawing). */
function offsetChain(pts, d, closed) {
  const n = pts.length;
  if (!d || n < 2) return pts.map((p) => ({ ...p }));
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dir = norm(sub(b, a));
    const nn = perp(dir);
    segs.push({ p: addScaled(a, nn, d), dir });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? segs[(i - 1 + count) % count] : segs[i - 1];
    const next = closed ? segs[i % count] : segs[i];
    if (prev && next) {
      const hit = lineLine(prev.p, prev.dir, next.p, next.dir);
      out.push(hit && Math.abs(prev.dir.x * next.dir.y - prev.dir.y * next.dir.x) > 1e-6 ? hit.point : addScaled(pts[i], perp(next.dir), d));
    } else if (next) {
      out.push(addScaled(pts[i], perp(next.dir), d));
    } else {
      out.push(addScaled(pts[i], perp(prev.dir), d));
    }
  }
  return out;
}

function locationOffset(app) {
  const loc = app.toolOptions.wall.location;
  const t = app.toolOptions.wall.thickness;
  if (loc === 'left') return -t / 2;
  if (loc === 'right') return t / 2;
  return 0;
}

export class WallTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'wall';
  }

  reset() {
    this.chain = []; // reference points
    this.wallIds = [];
    this.cursor = null;
    this.press = null;
    this.snap = null;
  }

  get busy() {
    return this.chain.length > 0;
  }

  get prompt() {
    if (!this.chain.length) return 'Wall: tap or drag to start. Type x,y for an exact start point.';
    return 'Next point: tap, drag or type a length (3600, 3600<90, @x,y). Enter or Done to finish; tap the start point to close.';
  }

  get inputLabel() {
    return this.chain.length ? 'Length' : 'Start x,y';
  }

  get actions() {
    const a = [];
    if (this.chain.length > 1) a.push({ id: 'undoseg', label: 'Undo segment', icon: 'undo', run: () => this.undoSegment() });
    if (this.chain.length > 2) a.push({ id: 'close', label: 'Close', icon: 'close-shape', run: () => this.addPoint(this.chain[0]) });
    if (this.chain.length) {
      a.push({ id: 'len', label: 'Type length', icon: 'keyboard', run: () => this.app.ui.promptValue(this.inputLabel, (v) => this.onInput(v)) });
      a.push({ id: 'done', label: 'Done', icon: 'check', primary: true, run: () => this.finish() });
    }
    return a;
  }

  get thickness() {
    return this.app.toolOptions.wall.thickness;
  }

  get height() {
    return this.app.toolOptions.wall.height;
  }

  last() {
    return this.chain[this.chain.length - 1];
  }

  snapFor(e) {
    return this.snapAt(e, { from: this.chain.length ? this.last() : null });
  }

  onPointerDown(e) {
    this.snap = this.snapFor(e);
    this.press = { p: this.snap.p, sx: e.sx, sy: e.sy, dragging: false, nearEnd: this.chain.length ? dist(e.world, this.last()) * this.app.plan.vp.scale < 30 : false };
    this.cursor = this.snap.p;
  }

  onPointerMove(e) {
    if (this.press && !this.press.dragging && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > DRAG_PX) {
      this.press.dragging = true;
      if (!this.chain.length || !this.press.nearEnd) {
        if (this.chain.length) this.finishChain();
        this.chain = [this.press.p];
      }
    }
    this.snap = this.snapFor(e);
    this.cursor = this.snap.p;
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (!press) return;
    this.snap = this.snapFor(e);
    const p = this.snap.p;
    if (press.dragging) {
      if (dist(p, this.last()) > 1) this.addPoint(p);
      return;
    }
    if (!this.chain.length) {
      this.chain = [press.p];
      this.app.refreshTool();
      return;
    }
    if (dist(p, this.last()) < 1) {
      this.finish();
      return;
    }
    this.addPoint(p);
  }

  onDoubleClick() {
    this.finish();
  }

  onInput(text) {
    const from = this.chain.length ? this.last() : null;
    let dir = null;
    if (from && this.cursor && dist(this.cursor, from) > 1) dir = sub(this.cursor, from);
    else if (this.chain.length > 1) dir = sub(this.last(), this.chain[this.chain.length - 2]);
    const p = parseDrawInput(this.app, text, from, dir);
    if (!p) return false;
    if (!from) {
      this.chain = [p];
      this.app.refreshTool();
    } else {
      this.addPoint(p);
    }
    return true;
  }

  onKey(e) {
    if (e.key === 'Backspace' && this.chain.length > 1) {
      this.undoSegment();
      return true;
    }
    if ((e.key === 'c' || e.key === 'C') && this.chain.length > 2 && !e.ctrlKey && !e.metaKey) {
      this.addPoint(this.chain[0]);
      return true;
    }
    return false;
  }

  /** Recompute centre-line walls of the chain (face-based drawing changes previous corners). */
  addPoint(p) {
    const app = this.app;
    const closing = this.chain.length > 2 && dist(p, this.chain[0]) < 1;
    const ref = closing ? this.chain : [...this.chain, p];
    const d = locationOffset(app);
    const centre = offsetChain(ref, d, closing);
    // update existing walls of this chain (if one was removed meanwhile, stop tracking)
    let walls = this.wallIds.map((id) => this.model.get(id));
    if (walls.some((w) => !w)) {
      walls = [];
      this.wallIds = [];
    }
    if (walls.length !== ref.length - 2 + (closing ? 1 : 0)) walls = [];
    for (let i = 0; i < walls.length; i++) {
      walls[i].a = { ...centre[i] };
      walls[i].b = { ...centre[i + 1] };
    }
    const n = centre.length;
    const a = closing ? centre[n - 1] : centre[n - 2];
    const b = closing ? centre[0] : centre[n - 1];
    if (closing && walls.length) walls[0].a = { ...centre[0] };
    const [w] = addWallChain(this.model, this.level, [a, b], { props: { thickness: this.thickness, height: this.height } });
    if (w) this.wallIds.push(w.id);
    this.model.commit(closing ? 'Close walls' : 'Wall');
    if (closing) {
      this.reset();
      app.toast('Room closed');
    } else {
      this.chain.push(p);
    }
    app.refreshTool();
  }

  /** Ctrl+Z while drawing removes the last segment. */
  onUndo() {
    if (this.chain.length > 1) {
      this.undoSegment();
      return true;
    }
    if (this.chain.length) {
      this.reset();
      this.app.refreshTool();
      return true;
    }
    return false;
  }

  undoSegment() {
    if (this.chain.length < 2) return;
    const id = this.wallIds.pop();
    if (id) this.model.remove([id]);
    this.chain.pop();
    const d = locationOffset(this.app);
    if (d && this.wallIds.length) {
      const centre = offsetChain(this.chain, d, false);
      const walls = this.wallIds.map((x) => this.model.get(x)).filter(Boolean);
      walls.forEach((w, i) => {
        w.a = { ...centre[i] };
        w.b = { ...centre[i + 1] };
      });
    }
    this.model.commit('Undo segment');
    this.app.refreshTool();
  }

  finishChain() {
    this.chain = [];
    this.wallIds = [];
  }

  finish() {
    this.finishChain();
    this.press = null;
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const app = this.app;
    const cur = this.cursor;
    if (this.chain.length && cur) {
      const from = this.last();
      if (dist(from, cur) > 1) {
        const d = locationOffset(app);
        const centre = offsetChain(this.chain.length > 1 ? [this.chain[this.chain.length - 2], from, cur] : [from, cur], d, false);
        const a = centre[centre.length - 2], b = centre[centre.length - 1];
        view.drawGhostWall(ctx, a, b, this.thickness);
        if (d) {
          // reference (face) line
          const A = view.vp.w2s(from), B = view.vp.w2s(cur);
          ctx.save();
          ctx.strokeStyle = view.theme.planGuide;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
          ctx.restore();
        }
        this.drawSegmentLabel(ctx, view, from, cur, this.fmt(dist(from, cur)));
        const ang = (Math.atan2(cur.y - from.y, cur.x - from.x) * 180) / Math.PI;
        this.drawAngleLabel(ctx, view, cur, ang);
      }
      // chain start marker (tap to close)
      if (this.chain.length > 2) {
        const S = view.vp.w2s(this.chain[0]);
        ctx.save();
        ctx.strokeStyle = view.theme.planAccent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(S.x, S.y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (cur && this.press && !this.chain.length) {
      // pressed but not dragging yet
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
    else if (cur) view.drawSnap(ctx, { p: cur, kind: null, guides: [] });
  }

  onLeave() {
    if (!this.press) this.cursor = null;
  }
}

export class ArcWallTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'arc';
  }

  reset() {
    this.a = null;
    this.b = null;
    this.cursor = null;
    this.press = null;
    this.snap = null;
  }

  get busy() {
    return !!this.a;
  }

  get prompt() {
    if (!this.a) return 'Curved wall: tap or drag from the start point.';
    if (!this.b) return 'Tap the end point of the curved wall.';
    return 'Move to bend the wall, tap to place. Type a curve depth (e.g. 600) or radius (r2500).';
  }

  get inputLabel() {
    if (this.a && this.b) return 'Curve depth or r=radius';
    if (this.a) return 'Chord length';
    return null;
  }

  get actions() {
    if (!this.a) return [];
    const acts = [];
    if (this.b) {
      acts.push({ id: 'semi', label: 'Semicircle', icon: 'arc', run: () => this.place(this.semicircleSagitta()) });
      acts.push({ id: 'len', label: 'Type depth', icon: 'keyboard', run: () => this.app.ui.promptValue(this.inputLabel, (v) => this.onInput(v)) });
    }
    acts.push({ id: 'cancel', label: 'Cancel', icon: 'x', run: () => this.cancel() });
    return acts;
  }

  semicircleSagitta() {
    const s = this.currentSagitta();
    return (Math.sign(s) || 1) * dist(this.a, this.b) / 2;
  }

  currentSagitta() {
    if (!this.a || !this.b || !this.cursor) return 0;
    let s = sagittaFrom3(this.a, this.cursor, this.b);
    if (!Number.isFinite(s)) s = 0;
    const step = lengthStep(this.app.plan.vp.scale, this.settings.units);
    s = roundTo(s, step);
    const half = dist(this.a, this.b) / 2;
    if (Math.abs(Math.abs(s) - half) < 14 / this.app.plan.vp.scale) s = Math.sign(s) * half;
    return s;
  }

  onPointerDown(e) {
    const from = this.a && !this.b ? this.a : null;
    this.snap = this.a && this.b ? null : this.snapAt(e, { from });
    this.cursor = this.snap ? this.snap.p : e.world;
    this.press = { sx: e.sx, sy: e.sy, p: this.cursor, dragging: false };
  }

  onPointerMove(e) {
    if (this.press && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > DRAG_PX && !this.press.dragging) {
      this.press.dragging = true;
      if (!this.a) this.a = this.press.p;
    }
    if (this.a && this.b) {
      this.snap = null;
      this.cursor = e.world;
    } else {
      this.snap = this.snapAt(e, { from: this.a });
      this.cursor = this.snap.p;
    }
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (!press) return;
    if (!this.a) {
      this.a = press.p;
    } else if (!this.b) {
      const p = this.snapAt(e, { from: this.a }).p;
      if (dist(p, this.a) > 10) this.b = p;
    } else {
      this.place(this.currentSagitta());
      return;
    }
    this.app.refreshTool();
  }

  onInput(text) {
    if (this.a && !this.b) {
      const dir = this.cursor && dist(this.cursor, this.a) > 1 ? sub(this.cursor, this.a) : null;
      const p = parseDrawInput(this.app, text, this.a, dir);
      if (!p) return false;
      this.b = p;
      this.app.refreshTool();
      return true;
    }
    if (this.a && this.b) {
      const t = text.trim();
      const side = Math.sign(this.currentSagitta()) || 1;
      const m = /^r\s*=?\s*(.+)$/i.exec(t);
      if (m) {
        const r = this.app.parse(m[1]);
        const c = dist(this.a, this.b);
        if (!(r >= c / 2)) {
          this.app.toast(`Radius must be at least ${this.fmt(c / 2)}`);
          return true;
        }
        this.place(side * (r - Math.sqrt(r * r - (c * c) / 4)));
        return true;
      }
      const s = this.app.parse(t);
      if (!Number.isFinite(s)) return false;
      this.place(s * (s < 0 ? 1 : side));
      return true;
    }
    return false;
  }

  place(sagitta) {
    if (!this.a || !this.b) return;
    addWallChain(this.model, this.level, [this.a, this.b], {
      bulges: [sagitta],
      props: { thickness: this.app.toolOptions.wall.thickness, height: this.app.toolOptions.wall.height },
    });
    this.model.commit('Curved wall');
    const end = this.b;
    this.reset();
    this.a = null;
    this.cursor = end;
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const t = this.app.toolOptions.wall.thickness;
    if (this.a && !this.b && this.cursor && dist(this.a, this.cursor) > 1) {
      view.drawGhostWall(ctx, this.a, this.cursor, t);
      this.drawSegmentLabel(ctx, view, this.a, this.cursor, this.fmt(dist(this.a, this.cursor)));
    }
    if (this.a && this.b) {
      const s = this.currentSagitta();
      view.drawGhostWall(ctx, this.a, this.b, t, s);
      const path = makePath(this.a, this.b, s);
      const apex = path.midPoint();
      const P = view.vp.w2s(apex);
      const r = path.isArc ? path.radius : Infinity;
      view.drawPill(ctx, path.isArc ? `depth ${this.fmt(Math.abs(s))} · R ${this.fmt(r)}` : 'straight', P.x, P.y - 22);
      const A = view.vp.w2s(this.a), B = view.vp.w2s(this.b);
      ctx.save();
      ctx.strokeStyle = view.theme.planGuide;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class RectTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'rect';
  }

  reset() {
    this.a = null;
    this.cursor = null;
    this.press = null;
    this.snap = null;
  }

  get busy() {
    return !!this.a;
  }

  get prompt() {
    return this.a ? 'Tap the opposite corner, or type width,depth (e.g. 4000,3000).' : 'Room: drag a rectangle, or tap the first corner.';
  }

  get inputLabel() {
    return this.a ? 'Width,depth' : null;
  }

  get actions() {
    return this.a
      ? [
          { id: 'len', label: 'Type size', icon: 'keyboard', run: () => this.app.ui.promptValue(this.inputLabel, (v) => this.onInput(v)) },
          { id: 'cancel', label: 'Cancel', icon: 'x', run: () => this.cancel() },
        ]
      : [];
  }

  onPointerDown(e) {
    this.snap = this.snapAt(e, { from: null });
    this.cursor = this.snap.p;
    this.press = { sx: e.sx, sy: e.sy, p: this.cursor, dragging: false };
  }

  onPointerMove(e) {
    if (this.press && !this.press.dragging && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > DRAG_PX) {
      this.press.dragging = true;
      if (!this.a) this.a = this.press.p;
    }
    this.snap = this.snapAt(e, { from: null });
    this.cursor = this.snap.p;
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const p = this.snapAt(e).p;
    if (!this.a) {
      this.a = press.p;
      this.app.refreshTool();
      return;
    }
    if (Math.abs(p.x - this.a.x) > 10 && Math.abs(p.y - this.a.y) > 10) this.place(this.a, p);
  }

  onInput(text) {
    if (!this.a) return false;
    const m = /^([^,x×]+)[,x×](.+)$/i.exec(text.trim());
    if (!m) return false;
    const w = this.app.parse(m[1]), h = this.app.parse(m[2]);
    if (!(Math.abs(w) > 10) || !(Math.abs(h) > 10)) return false;
    const sx = this.cursor && this.cursor.x < this.a.x ? -1 : 1;
    const sy = this.cursor && this.cursor.y < this.a.y ? -1 : 1;
    this.place(this.a, { x: this.a.x + sx * Math.abs(w), y: this.a.y + sy * Math.abs(h) });
    return true;
  }

  rectPoints(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    let pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const opt = this.app.toolOptions.wall;
    const loc = this.app.toolOptions.rect.location;
    if (loc === 'inside') {
      const t = opt.thickness / 2;
      pts = [{ x: x0 - t, y: y0 - t }, { x: x1 + t, y: y0 - t }, { x: x1 + t, y: y1 + t }, { x: x0 - t, y: y1 + t }];
    } else if (loc === 'outside') {
      const t = opt.thickness / 2;
      pts = [{ x: x0 + t, y: y0 + t }, { x: x1 - t, y: y0 + t }, { x: x1 - t, y: y1 - t }, { x: x0 + t, y: y1 - t }];
    }
    return pts;
  }

  place(a, b) {
    const pts = this.rectPoints(a, b);
    const opt = this.app.toolOptions.wall;
    addWallChain(this.model, this.level, pts, { closed: true, props: { thickness: opt.thickness, height: opt.height } });
    this.model.commit('Room');
    this.reset();
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    if (this.a && this.cursor && Math.abs(this.cursor.x - this.a.x) > 1 && Math.abs(this.cursor.y - this.a.y) > 1) {
      const pts = this.rectPoints(this.a, this.cursor);
      const t = this.app.toolOptions.wall.thickness;
      for (let i = 0; i < 4; i++) view.drawGhostWall(ctx, pts[i], pts[(i + 1) % 4], t);
      const x0 = Math.min(this.a.x, this.cursor.x), x1 = Math.max(this.a.x, this.cursor.x);
      const y0 = Math.min(this.a.y, this.cursor.y), y1 = Math.max(this.a.y, this.cursor.y);
      this.drawSegmentLabel(ctx, view, { x: x0, y: y1 }, { x: x1, y: y1 }, this.fmt(x1 - x0));
      this.drawSegmentLabel(ctx, view, { x: x1, y: y1 }, { x: x1, y: y0 }, this.fmt(y1 - y0));
      const c = view.vp.w2s(mid(this.a, this.cursor));
      view.drawPill(ctx, this.app.fmtArea((x1 - x0) * (y1 - y0)), c.x, c.y, { accent: false });
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}
