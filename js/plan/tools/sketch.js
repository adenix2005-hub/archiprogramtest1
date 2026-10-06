// Sketch tool: draw freehand with the pen or a finger; the stroke is recognised
// and turned into straight or curved walls that join existing walls.

import { Tool } from './base.js';
import { recognizeStroke } from '../../geom/sketch.js';
import { addWallChain } from '../../core/ops.js';
import { dist } from '../../core/vec.js';

export class SketchTool extends Tool {
  constructor(app) {
    super(app);
    this.stroke = null;
    this.flash = null;
  }

  get id() {
    return 'sketch';
  }

  get wantsCoalesced() {
    return true;
  }

  get busy() {
    return !!this.stroke;
  }

  get prompt() {
    return 'Sketch walls freehand. Lines are straightened and squared; curves become curved walls. Close a shape to make a room.';
  }

  reset() {
    this.stroke = null;
  }

  onPointerDown(e) {
    this.stroke = { pts: [e.world], screen: [{ x: e.sx, y: e.sy }], pressure: [e.pressure || 0.5] };
  }

  onPointerMove(e) {
    if (!this.stroke) return;
    const last = this.stroke.screen[this.stroke.screen.length - 1];
    if (Math.hypot(e.sx - last.x, e.sy - last.y) < 1.2) return;
    this.stroke.pts.push(e.world);
    this.stroke.screen.push({ x: e.sx, y: e.sy });
    this.stroke.pressure.push(e.pressure || 0.5);
  }

  onPointerUp() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke || stroke.pts.length < 3) return;
    const app = this.app;
    const opts = app.toolOptions.sketch;
    const vp = app.plan.vp;
    const snapTol = 18;
    const res = recognizeStroke(stroke.pts, {
      scale: vp.scale,
      angleSnap: opts.angleSnap,
      allowCurves: opts.curves,
      grid: app.prefs.snap.grid ? app.model.settings.grid || 0 : opts.tidy ? Math.max(10, app.model.settings.grid / 2) : 0,
      snap: (p) => {
        const s = app.snapper.snap(p, { tolPx: snapTol, noGrid: true, align: false });
        return s.kind === 'end' || s.kind === 'onwall' || s.kind === 'corner' ? s.p : null;
      },
    });
    if (!res || !res.segments.length) {
      app.toast('Stroke too short to make a wall');
      return;
    }
    const segs = res.segments;
    const pts = [segs[0].a, ...segs.map((s) => s.b)];
    const closed = res.closed && dist(pts[0], pts[pts.length - 1]) < 1;
    const walls = addWallChain(this.model, this.level, closed ? pts.slice(0, -1) : pts, {
      closed,
      bulges: segs.map((s) => s.bulge),
      props: { thickness: app.toolOptions.wall.thickness, height: app.toolOptions.wall.height },
    });
    this.model.commit('Sketch walls');
    this.flash = { ids: walls.map((w) => w.id), until: performance.now() + 600 };
    const n = walls.length;
    app.toast(`${n} wall${n === 1 ? '' : 's'} created${closed ? ' · room closed' : ''}`);
    const tick = () => {
      app.plan.invalidateOverlay();
      if (this.flash && performance.now() < this.flash.until) requestAnimationFrame(tick);
      else this.flash = null;
    };
    requestAnimationFrame(tick);
    app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const T = view.theme;
    if (this.stroke && this.stroke.screen.length > 1) {
      const pts = this.stroke.screen;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = T.planAccent;
      ctx.globalAlpha = 0.85;
      for (let i = 1; i < pts.length; i++) {
        const pr = this.stroke.pressure[i] || 0.5;
        ctx.lineWidth = 1.5 + pr * 3;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (this.flash) {
      const k = Math.max(0, (this.flash.until - performance.now()) / 600);
      ctx.save();
      ctx.globalAlpha = k;
      for (const id of this.flash.ids) {
        const w = this.model.get(id);
        if (!w) continue;
        view.drawGhostWall(ctx, w.a, w.b, w.thickness, w.bulge || 0, { fill: T.planAccent });
      }
      ctx.restore();
    }
  }
}
