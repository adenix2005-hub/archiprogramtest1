// Modify tools: erase, move / copy, rotate, mirror, offset, pan.

import { Tool, parseDrawInput } from './base.js';
import { dist, sub, norm, angleOf, roundTo } from '../../core/vec.js';
import { hitTest } from '../hittest.js';
import { beginTransform, applyTranslate, applyRotate, applyMirror, duplicate, offsetWallCopy, splitWall } from '../../core/ops.js';
import { nearestWall } from '../snap.js';
import { pathPoly } from '../render.js';

export class EraseTool extends Tool {
  constructor(app) {
    super(app);
    this.trail = null;
    this.marked = new Set();
  }

  get id() {
    return 'erase';
  }

  get prompt() {
    return 'Erase: tap an item, or swipe across several items to delete them.';
  }

  reset() {
    this.trail = null;
    this.marked = new Set();
  }

  mark(e) {
    const tol = e.tolPx / this.app.plan.vp.scale;
    const hit = hitTest(this.app, e.world, tol);
    if (hit) this.marked.add(hit.id);
  }

  onPointerDown(e) {
    this.trail = [{ x: e.sx, y: e.sy }];
    this.marked = new Set();
    this.mark(e);
  }

  onPointerMove(e) {
    if (!this.trail) {
      const tol = e.tolPx / this.app.plan.vp.scale;
      this.hover = hitTest(this.app, e.world, tol)?.id || null;
      return;
    }
    this.trail.push({ x: e.sx, y: e.sy });
    this.mark(e);
  }

  onPointerUp() {
    const ids = [...this.marked];
    this.reset();
    if (!ids.length) return;
    this.app.deleteIds(ids);
  }

  drawOverlay(ctx, view) {
    const T = view.theme;
    const ids = this.trail ? this.marked : new Set(this.hover ? [this.hover] : []);
    this.app.drawHighlights(ctx, view, ids, T.planSnap);
    if (this.trail && this.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = T.planSnap;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pathPoly(ctx, this.trail, false);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/**
 * Base for tools that act on a selection: if nothing is selected they first let
 * the user pick items (tap to add, Done to continue).
 */
class SelectionTool extends Tool {
  constructor(app) {
    super(app);
    this.picking = false;
  }

  activate() {
    this.reset();
    this.picking = this.app.selection.size === 0;
  }

  get selectionPrompt() {
    return 'Tap items to select them, then tap Done.';
  }

  pickAt(e) {
    const tol = e.tolPx / this.app.plan.vp.scale;
    const hit = hitTest(this.app, e.world, tol);
    if (hit) this.app.select([hit.id], 'toggle');
  }

  get actions() {
    if (this.picking) return [{ id: 'done', label: 'Done', icon: 'check', primary: true, run: () => this.endPicking() }];
    return this.busy ? [{ id: 'cancel', label: 'Cancel', icon: 'x', run: () => this.cancel() }] : [];
  }

  endPicking() {
    if (!this.app.selection.size) {
      this.app.toast('Select at least one item');
      return;
    }
    this.picking = false;
    this.app.refreshTool();
  }

  finish() {
    if (this.picking) this.endPicking();
    else super.finish();
  }
}

export class MoveTool extends SelectionTool {
  constructor(app, copy = false) {
    super(app);
    this.copy = copy;
    this.reset();
  }

  get id() {
    return this.copy ? 'copy' : 'move';
  }

  reset() {
    this.base = null;
    this.cursor = null;
    this.ctx = null;
    this.snap = null;
  }

  get busy() {
    return !!this.base || this.picking;
  }

  get prompt() {
    if (this.picking) return `${this.copy ? 'Copy' : 'Move'}: ${this.selectionPrompt}`;
    if (!this.base) return `${this.copy ? 'Copy' : 'Move'}: tap the base point.`;
    return 'Tap the destination, or type a distance (e.g. 1200, 1200<90, @600,0).';
  }

  get inputLabel() {
    return this.base ? 'Distance' : null;
  }

  onPointerDown(e) {
    if (this.picking) return;
    this.snap = this.snapAt(e, { from: this.base, exclude: this.base ? this.app.selection : undefined });
    this.cursor = this.snap.p;
  }

  onPointerMove(e) {
    if (this.picking) return;
    this.snap = this.snapAt(e, { from: this.base, exclude: this.base ? this.app.selection : undefined });
    this.cursor = this.snap.p;
    if (this.base && !this.copy) this.preview(this.cursor);
  }

  preview(p) {
    if (!this.ctx) this.ctx = beginTransform(this.doc, [...this.app.selection]);
    applyTranslate(this.doc, this.ctx, sub(p, this.base));
    this.model.touch();
  }

  onPointerUp(e) {
    if (this.picking) {
      this.pickAt(e);
      return;
    }
    const p = this.snapAt(e, { from: this.base, exclude: this.base ? this.app.selection : undefined }).p;
    if (!this.base) {
      this.base = p;
      this.app.refreshTool();
      return;
    }
    this.apply(p);
  }

  onInput(text) {
    if (!this.base) return false;
    const dir = this.cursor && dist(this.cursor, this.base) > 1 ? sub(this.cursor, this.base) : { x: 1, y: 0 };
    const p = parseDrawInput(this.app, text, this.base, dir);
    if (!p) return false;
    this.apply(p);
    return true;
  }

  apply(p) {
    const delta = sub(p, this.base);
    if (this.copy) {
      const ids = duplicate(this.model, [...this.app.selection], delta);
      this.model.commit('Copy');
      this.app.select(ids);
      this.app.toast(`Copied ${ids.length} item${ids.length === 1 ? '' : 's'}`);
      // keep copying from the same base point
      this.app.refreshTool();
      return;
    }
    if (!this.ctx) this.ctx = beginTransform(this.doc, [...this.app.selection]);
    applyTranslate(this.doc, this.ctx, delta);
    this.model.commit('Move');
    this.reset();
    this.app.setTool('select');
  }

  cancel() {
    if (this.ctx) this.model.revert();
    return super.cancel();
  }

  deactivate() {
    if (this.ctx && this.model.dirtyLive) this.model.revert();
    super.deactivate();
  }

  drawOverlay(ctx, view) {
    if (this.picking) {
      this.app.drawHighlights(ctx, view, this.app.selection, view.theme.planAccent);
      return;
    }
    if (this.base && this.cursor) {
      const A = view.vp.w2s(this.base), B = view.vp.w2s(this.cursor);
      ctx.save();
      ctx.strokeStyle = view.theme.planAccent;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
      this.drawSegmentLabel(ctx, view, this.base, this.cursor, this.fmt(dist(this.base, this.cursor)));
      if (this.copy) {
        const d = sub(this.cursor, this.base);
        this.app.drawHighlights(ctx, view, this.app.selection, view.theme.planGuide, d);
      }
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class RotateTool extends SelectionTool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'rotate';
  }

  reset() {
    this.center = null;
    this.refAngle = null;
    this.angle = 0;
    this.ctx = null;
    this.cursor = null;
    this.snap = null;
  }

  get busy() {
    return !!this.center || this.picking;
  }

  get prompt() {
    if (this.picking) return `Rotate: ${this.selectionPrompt}`;
    if (!this.center) return 'Rotate: tap the centre of rotation.';
    if (this.refAngle === null) return 'Tap a reference direction, or type an angle (e.g. 90).';
    return 'Tap to set the new direction (snaps to 15°), or type an angle.';
  }

  get inputLabel() {
    return this.center ? 'Angle °' : null;
  }

  get actions() {
    const a = super.actions;
    if (this.center && !this.picking) {
      a.unshift({ id: 'r90', label: '90°', icon: 'rotate', run: () => this.applyAngle(90) });
      a.unshift({ id: 'r-90', label: '-90°', icon: 'rotate-ccw', run: () => this.applyAngle(-90) });
    }
    return a;
  }

  onPointerMove(e) {
    if (this.picking) return;
    if (!this.center) {
      this.snap = this.snapAt(e);
      this.cursor = this.snap.p;
      return;
    }
    this.snap = null;
    this.cursor = e.world;
    if (this.refAngle !== null) {
      let a = angleOf(sub(e.world, this.center)) - this.refAngle;
      const step = (15 * Math.PI) / 180;
      if (!e.alt) a = roundTo(a, step);
      this.angle = a;
      if (!this.ctx) this.ctx = beginTransform(this.doc, [...this.app.selection]);
      applyRotate(this.doc, this.ctx, this.center, a);
      this.model.touch();
    }
  }

  onPointerUp(e) {
    if (this.picking) {
      this.pickAt(e);
      return;
    }
    if (!this.center) {
      this.center = this.snapAt(e).p;
    } else if (this.refAngle === null) {
      if (dist(e.world, this.center) * this.app.plan.vp.scale < 10) return;
      this.refAngle = angleOf(sub(e.world, this.center));
    } else {
      this.model.commit('Rotate');
      this.reset();
      this.app.setTool('select');
      return;
    }
    this.app.refreshTool();
  }

  applyAngle(deg) {
    if (!this.center) return;
    if (this.ctx) this.model.revert();
    const ctx = beginTransform(this.doc, [...this.app.selection]);
    applyRotate(this.doc, ctx, this.center, (deg * Math.PI) / 180);
    this.model.commit('Rotate');
    this.reset();
    this.app.setTool('select');
  }

  onInput(text) {
    const deg = parseFloat(text);
    if (!Number.isFinite(deg) || !this.center) return false;
    this.applyAngle(deg);
    return true;
  }

  cancel() {
    if (this.ctx) this.model.revert();
    return super.cancel();
  }

  deactivate() {
    if (this.ctx && this.model.dirtyLive) this.model.revert();
    super.deactivate();
  }

  drawOverlay(ctx, view) {
    if (this.picking) {
      this.app.drawHighlights(ctx, view, this.app.selection, view.theme.planAccent);
      return;
    }
    if (this.center) {
      const C = view.vp.w2s(this.center);
      ctx.save();
      ctx.strokeStyle = view.theme.planAccent;
      ctx.beginPath();
      ctx.arc(C.x, C.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      if (this.cursor) {
        const P = view.vp.w2s(this.cursor);
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(C.x, C.y);
        ctx.lineTo(P.x, P.y);
        ctx.stroke();
        if (this.refAngle !== null) {
          view.drawPill(ctx, `${Math.round((this.angle * 180) / Math.PI)}°`, P.x + 30, P.y - 20);
        }
      }
      ctx.restore();
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class MirrorTool extends SelectionTool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'mirror';
  }

  reset() {
    this.a = null;
    this.cursor = null;
    this.snap = null;
  }

  get busy() {
    return !!this.a || this.picking;
  }

  get prompt() {
    if (this.picking) return `Mirror: ${this.selectionPrompt}`;
    return this.a ? 'Tap the second point of the mirror line.' : 'Mirror: tap the first point of the mirror line.';
  }

  get actions() {
    const a = super.actions;
    if (!this.picking) {
      const keep = this.app.toolOptions.mirror.keep;
      a.unshift({ id: 'keep', label: keep ? 'Keep original: on' : 'Keep original: off', icon: 'copy', run: () => {
        this.app.toolOptions.mirror.keep = !keep;
        this.app.refreshTool();
      } });
    }
    return a;
  }

  onPointerMove(e) {
    if (this.picking) return;
    this.snap = this.snapAt(e, { from: this.a });
    this.cursor = this.snap.p;
  }

  onPointerUp(e) {
    if (this.picking) {
      this.pickAt(e);
      return;
    }
    const p = this.snapAt(e, { from: this.a }).p;
    if (!this.a) {
      this.a = p;
      this.app.refreshTool();
      return;
    }
    if (dist(p, this.a) < 10) return;
    let ids = [...this.app.selection];
    const keep = this.app.toolOptions.mirror.keep;
    if (keep) ids = duplicate(this.model, ids, { x: 0, y: 0 });
    // Copies sit on top of the originals; don't let the originals stretch with them.
    const ctx = beginTransform(this.doc, ids, { attach: !keep });
    applyMirror(this.doc, ctx, this.a, p);
    this.model.commit('Mirror');
    this.app.select(ids);
    this.reset();
    this.app.setTool('select');
  }

  drawOverlay(ctx, view) {
    if (this.picking) {
      this.app.drawHighlights(ctx, view, this.app.selection, view.theme.planAccent);
      return;
    }
    if (this.a && this.cursor) {
      const A = view.vp.w2s(this.a), B = view.vp.w2s(this.cursor);
      ctx.save();
      ctx.strokeStyle = view.theme.planAccent;
      ctx.setLineDash([12, 4, 2, 4]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class OffsetTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'offset';
  }

  reset() {
    this.wall = null;
    this.side = 1;
    this.cursor = null;
    this.free = null;
  }

  get busy() {
    return !!this.wall;
  }

  get prompt() {
    const d = this.app.toolOptions.offset.distance;
    return this.wall
      ? `Tap the side for the copy (${this.fmt(d)} away), or type a new distance.`
      : `Offset: tap a wall to copy it parallel (${this.fmt(d)}). Type a distance to change it.`;
  }

  get inputLabel() {
    return 'Offset distance';
  }

  onInput(text) {
    const d = this.app.parse(text);
    if (!(d > 0)) return false;
    this.app.toolOptions.offset.distance = d;
    this.app.refreshTool();
    return true;
  }

  onPointerMove(e) {
    this.cursor = e.world;
    if (this.wall) {
      const g = this.app.derived.wallGeom(this.wall);
      if (g) this.side = g.path.project(e.world).side;
    } else {
      const tol = e.tolPx / this.app.plan.vp.scale;
      this.free = nearestWall(this.app.derived, this.level, e.world, tol)?.g.wall || null;
    }
  }

  onPointerUp(e) {
    const tol = e.tolPx / this.app.plan.vp.scale;
    if (!this.wall) {
      const hit = nearestWall(this.app.derived, this.level, e.world, tol);
      if (hit) {
        this.wall = hit.g.wall;
        this.side = hit.pr.side;
      }
      this.app.refreshTool();
      return;
    }
    const g = this.app.derived.wallGeom(this.wall);
    if (!g) {
      this.reset();
      return;
    }
    const side = g.path.project(e.world).side;
    const w2 = offsetWallCopy(this.model, this.wall, side * this.app.toolOptions.offset.distance);
    this.model.commit('Offset');
    this.app.select([w2.id]);
    this.reset();
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const T = view.theme;
    const w = this.wall || this.free;
    if (!w) return;
    this.app.drawHighlights(ctx, view, new Set([w.id]), T.planAccent);
    if (this.wall) {
      const g = this.app.derived.wallGeom(this.wall);
      if (!g) return;
      const d = this.side * this.app.toolOptions.offset.distance;
      const a = g.path.offsetAt(0, d), b = g.path.offsetAt(g.path.length, d);
      const m = g.path.offsetAt(g.path.length / 2, d);
      let bulge = 0;
      if (g.path.isArc) {
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const n = norm({ x: -(b.y - a.y), y: b.x - a.x });
        bulge = (m.x - c.x) * n.x + (m.y - c.y) * n.y;
      }
      view.drawGhostWall(ctx, a, b, this.wall.thickness, bulge);
    }
  }
}

export class PanTool extends Tool {
  get id() {
    return 'pan';
  }

  get prompt() {
    return 'Pan: drag to move around the plan. Pinch or scroll to zoom.';
  }

  touchPans() {
    return true;
  }
}

export class SplitTool extends Tool {
  get id() {
    return 'split';
  }

  get prompt() {
    return 'Split: tap a wall where it should be cut in two.';
  }

  onPointerMove(e) {
    const tol = e.tolPx / this.app.plan.vp.scale;
    const hit = nearestWall(this.app.derived, this.level, e.world, tol);
    this.cursor = hit ? { g: hit.g, s: hit.pr.s } : null;
    if (this.cursor) {
      const snap = this.snapAt(e, { onWall: true });
      if (snap.kind === 'mid' || snap.kind === 'end' || snap.kind === 'onwall') {
        this.cursor.s = hit.g.path.project(snap.p).s;
      }
    }
  }

  onPointerUp(e) {
    this.onPointerMove(e);
    const c = this.cursor;
    if (!c) return;
    const w2 = splitWall(this.model, c.g.wall, c.s);
    if (!w2) {
      this.app.toast('Tap away from the wall ends to split it');
      return;
    }
    this.model.commit('Split wall');
    this.app.select([c.g.wall.id, w2.id]);
    this.app.toast('Wall split in two');
  }

  drawOverlay(ctx, view) {
    if (!this.cursor) return;
    const { g, s } = this.cursor;
    const a = view.vp.w2s(g.path.offsetAt(s, g.half + view.vp.px(8)));
    const b = view.vp.w2s(g.path.offsetAt(s, -g.half - view.vp.px(8)));
    ctx.save();
    ctx.strokeStyle = view.theme.planSnap;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}
