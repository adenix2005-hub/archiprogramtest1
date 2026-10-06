// Roof tool: drag a rectangle, tap out a polygon, or generate a roof over the
// building outline automatically.

import { Tool } from './base.js';
import { dist } from '../../core/vec.js';
import { pathPoly } from '../render.js';
import { signedArea } from '../../geom/polygon.js';
import { buildRoofGeometry } from '../../geom/roof.js';

const DRAG_PX = 12;

export function createRoof(app, points, levelId = app.activeLevel) {
  const o = app.toolOptions.roof;
  let pts = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  if (signedArea(pts) < 0) pts = pts.reverse();
  return app.model.add('roofs', {
    level: levelId,
    points: pts,
    kind: o.kind,
    pitch: o.pitch,
    overhang: o.overhang,
    thickness: o.thickness,
    baseOffset: null,
    edges: null,
    rotate: false,
    lowEdge: null,
    color: null,
  });
}

/** Generate roofs over every building outline on the level. */
export function autoRoof(app) {
  const fps = app.derived.footprints(app.activeLevel);
  if (!fps.length) {
    app.toast('Draw a closed ring of walls first, then use Auto roof');
    return [];
  }
  const ids = fps.map((fp) => createRoof(app, fp).id);
  app.model.commit('Auto roof');
  app.select(ids);
  app.toast(ids.length === 1 ? 'Roof added over the building' : `${ids.length} roofs added`);
  return ids;
}

export class RoofTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'roof';
  }

  reset() {
    this.pts = [];
    this.cursor = null;
    this.press = null;
    this.snap = null;
  }

  get busy() {
    return this.pts.length > 0;
  }

  get prompt() {
    if (!this.pts.length) return 'Roof: drag a rectangle over the walls, tap corners for any shape, or use Auto roof.';
    return 'Tap the next corner. Tap the first corner (or Done) to finish.';
  }

  get actions() {
    const a = [{ id: 'auto', label: 'Auto roof', icon: 'roof', primary: !this.pts.length, run: () => autoRoof(this.app) }];
    if (this.pts.length >= 3) a.push({ id: 'done', label: 'Done', icon: 'check', primary: true, run: () => this.finish() });
    if (this.pts.length) a.push({ id: 'cancel', label: 'Cancel', icon: 'x', run: () => this.cancel() });
    return a;
  }

  snapFor(e) {
    return this.snapAt(e, { from: this.pts.length ? this.pts[this.pts.length - 1] : null, onWall: false });
  }

  onPointerDown(e) {
    this.snap = this.snapFor(e);
    this.cursor = this.snap.p;
    this.press = { sx: e.sx, sy: e.sy, p: this.cursor, dragging: false, rect: !this.pts.length };
  }

  onPointerMove(e) {
    if (this.press && !this.press.dragging && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > DRAG_PX) this.press.dragging = true;
    this.snap = this.press?.dragging && this.press.rect ? this.snapAt(e, { onWall: false }) : this.snapFor(e);
    this.cursor = this.snap.p;
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (!press) return;
    if (press.dragging && press.rect) {
      const a = press.p, b = this.snapAt(e, { onWall: false }).p;
      if (Math.abs(a.x - b.x) > 100 && Math.abs(a.y - b.y) > 100) {
        this.place([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]);
      }
      return;
    }
    const p = this.snapFor(e).p;
    if (this.pts.length >= 3 && dist(p, this.pts[0]) * this.app.plan.vp.scale < 14) {
      this.finish();
      return;
    }
    if (!this.pts.length || dist(p, this.pts[this.pts.length - 1]) > 10) this.pts.push(p);
    this.app.refreshTool();
  }

  onDoubleClick() {
    if (this.pts.length >= 3) this.finish();
  }

  finish() {
    if (this.pts.length >= 3) this.place(this.pts);
    else this.reset();
    this.app.refreshTool();
  }

  place(pts) {
    const r = createRoof(this.app, pts);
    this.model.commit('Roof');
    this.reset();
    this.app.select([r.id]);
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const T = view.theme;
    let poly = null;
    if (this.press?.dragging && this.press.rect && this.cursor) {
      const a = this.press.p, b = this.cursor;
      poly = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
    } else if (this.pts.length) {
      poly = [...this.pts, ...(this.cursor ? [this.cursor] : [])];
    }
    if (poly && poly.length >= 2) {
      view.vp.applyWorld(ctx, view.dpr);
      ctx.save();
      ctx.strokeStyle = T.planAccent;
      ctx.lineWidth = view.vp.px(1.5);
      ctx.beginPath();
      pathPoly(ctx, poly, poly.length > 2);
      ctx.stroke();
      if (poly.length >= 3 && Math.abs(signedArea(poly)) > 1e5) {
        const o = this.app.toolOptions.roof;
        try {
          const g = buildRoofGeometry({ points: poly, kind: o.kind, pitch: o.pitch, overhang: o.overhang, thickness: o.thickness }, 0);
          if (g) {
            ctx.setLineDash([view.vp.px(8), view.vp.px(5)]);
            ctx.beginPath();
            pathPoly(ctx, g.outline);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            for (const [a, b] of g.lines.ridges) {
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
            ctx.stroke();
          }
        } catch {
          /* preview only */
        }
      }
      ctx.restore();
      view.vp.applyScreen(ctx, view.dpr);
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}
