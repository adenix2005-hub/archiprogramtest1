// Annotation and view tools: dimensions, measure, text, section lines and cameras.

import { Tool } from './base.js';
import { dist, sub, dot, norm, perp, mid } from '../../core/vec.js';
import { drawDimension } from '../render.js';

export class DimensionTool extends Tool {
  constructor(app, measureOnly = false) {
    super(app);
    this.measureOnly = measureOnly;
    this.reset();
  }

  get id() {
    return this.measureOnly ? 'measure' : 'dim';
  }

  reset() {
    this.a = null;
    this.b = null;
    this.cursor = null;
    this.snap = null;
    this.press = null;
  }

  get busy() {
    return !!this.a;
  }

  get prompt() {
    if (this.measureOnly) return this.a && !this.b ? 'Tap the second point to measure.' : 'Measure: tap two points.';
    if (!this.a) return 'Dimension: tap the first point (wall corners and ends snap).';
    if (!this.b) return 'Tap the second point.';
    return 'Move to set the dimension line offset, then tap.';
  }

  onPointerDown(e) {
    this.press = { sx: e.sx, sy: e.sy };
    if (!this.b) {
      this.snap = this.snapAt(e, { from: this.a, onWall: true });
      this.cursor = this.snap.p;
    }
  }

  onPointerMove(e) {
    if (this.b && !this.measureOnly) {
      this.snap = null;
      this.cursor = e.world;
      return;
    }
    this.snap = this.snapAt(e, { from: this.a, onWall: true });
    this.cursor = this.snap.p;
    if (this.press && !this.a && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > 12) {
      this.a = this.cursor;
    }
  }

  onPointerUp(e) {
    this.press = null;
    if (this.b && !this.measureOnly) {
      this.place();
      return;
    }
    const p = this.snapAt(e, { from: this.a, onWall: true }).p;
    if (!this.a) {
      this.a = p;
    } else if (!this.b || this.measureOnly) {
      if (dist(p, this.a) < 1) return;
      this.b = p;
      if (this.measureOnly) {
        const d = dist(this.a, this.b);
        const dx = Math.abs(this.b.x - this.a.x), dy = Math.abs(this.b.y - this.a.y);
        this.app.toast(`Distance ${this.fmt(d)}  ·  Δx ${this.fmt(dx)}  ·  Δy ${this.fmt(dy)}`);
        this.measured = { a: this.a, b: this.b };
        this.a = null;
        this.b = null;
      }
    }
    this.app.refreshTool();
  }

  offsetFor(p) {
    const d = norm(sub(this.b, this.a));
    return dot(sub(p, this.a), perp(d));
  }

  place() {
    if (!this.a || !this.b) return;
    const offset = this.cursor ? this.offsetFor(this.cursor) : 600;
    const d = this.model.add('dims', { level: this.level, a: { ...this.a }, b: { ...this.b }, offset: Math.round(offset) });
    this.model.commit('Dimension');
    this.reset();
    this.app.select([d.id]);
    this.app.refreshTool();
  }

  drawOverlay(ctx, view) {
    const T = view.theme;
    if (this.measureOnly && this.measured && !this.a) {
      const A = view.vp.w2s(this.measured.a), B = view.vp.w2s(this.measured.b);
      ctx.save();
      ctx.strokeStyle = T.planSnap;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
      this.drawSegmentLabel(ctx, view, this.measured.a, this.measured.b, this.fmt(dist(this.measured.a, this.measured.b)));
    }
    if (this.a && !this.b && this.cursor) {
      const A = view.vp.w2s(this.a), B = view.vp.w2s(this.cursor);
      ctx.save();
      ctx.strokeStyle = T.planAccent;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
      this.drawSegmentLabel(ctx, view, this.a, this.cursor, this.fmt(dist(this.a, this.cursor)));
    }
    if (this.a && this.b && this.cursor) {
      const d = { a: this.a, b: this.b, offset: this.offsetFor(this.cursor) };
      drawDimension(ctx, view.vp, d, T, this.settings.units, true, T.planBg);
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class TextTool extends Tool {
  get id() {
    return 'text';
  }

  get prompt() {
    return 'Tap where the text should go.';
  }

  onPointerUp(e) {
    const p = this.snapAt(e, { onWall: false }).p;
    const t = this.model.add('texts', { level: this.level, x: p.x, y: p.y, text: 'Note', size: 250, angle: 0 });
    this.model.commit('Text');
    this.app.select([t.id]);
    this.app.setTool('select');
    this.app.ui.props.focusField('text');
  }
}

export class SectionTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'section';
  }

  reset() {
    this.a = null;
    this.cursor = null;
    this.snap = null;
    this.press = null;
  }

  get busy() {
    return !!this.a;
  }

  get prompt() {
    return this.a ? 'Tap the end of the section line. It looks toward the arrow side (flip it later).' : 'Section: tap or drag across the plan where you want to cut.';
  }

  onPointerDown(e) {
    this.snap = this.snapAt(e, { from: this.a, onWall: false });
    this.cursor = this.snap.p;
    this.press = { sx: e.sx, sy: e.sy, p: this.cursor };
  }

  onPointerMove(e) {
    this.snap = this.snapAt(e, { from: this.a || this.press?.p, onWall: false });
    this.cursor = this.snap.p;
    if (this.press && !this.a && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > 12) this.a = this.press.p;
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    const p = this.snapAt(e, { from: this.a, onWall: false }).p;
    if (!this.a) {
      this.a = press ? press.p : p;
      this.app.refreshTool();
      return;
    }
    if (dist(p, this.a) < 300) return;
    const n = this.doc.sections.length;
    const letter = String.fromCharCode(65 + (n % 26));
    const s = this.model.add('sections', { name: `Section ${letter}`, a: { ...this.a }, b: { ...p }, flip: false, depth: 0 });
    this.model.commit('Section');
    this.reset();
    this.app.select([s.id]);
    this.app.refreshTool();
    this.app.toast(`${s.name} added. Open it from Views, or tap Open view.`);
  }

  drawOverlay(ctx, view) {
    if (this.a && this.cursor) {
      const A = view.vp.w2s(this.a), B = view.vp.w2s(this.cursor);
      const T = view.theme;
      ctx.save();
      ctx.strokeStyle = T.planSection;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([18, 5, 3, 5]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
      // look direction arrow
      const d = norm(sub(B, A));
      const n = { x: d.y, y: -d.x };
      const M = mid(A, B);
      ctx.setLineDash([]);
      ctx.fillStyle = T.planSection;
      ctx.beginPath();
      ctx.moveTo(M.x - n.x * 26, M.y - n.y * 26);
      ctx.lineTo(M.x - n.x * 12 + d.x * 8, M.y - n.y * 12 + d.y * 8);
      ctx.lineTo(M.x - n.x * 12 - d.x * 8, M.y - n.y * 12 - d.y * 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (this.snap) view.drawSnap(ctx, this.snap);
  }
}

export class CameraTool extends Tool {
  constructor(app) {
    super(app);
    this.reset();
  }

  get id() {
    return 'camera';
  }

  reset() {
    this.pos = null;
    this.cursor = null;
    this.press = null;
  }

  get busy() {
    return !!this.pos;
  }

  get prompt() {
    return this.pos ? 'Tap the point the camera looks at.' : 'Camera: tap where you stand (eye height 1.6 m), then where you look.';
  }

  onPointerDown(e) {
    this.press = { sx: e.sx, sy: e.sy, p: e.world };
    if (!this.pos) this.cursor = e.world;
  }

  onPointerMove(e) {
    this.cursor = e.world;
    if (this.press && !this.pos && Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) > 12) this.pos = this.press.p;
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (!this.pos) {
      this.pos = press ? press.p : e.world;
      this.app.refreshTool();
      return;
    }
    if (dist(e.world, this.pos) < 200) return;
    const lv = this.model.level(this.level);
    const eye = (lv?.elevation || 0) + 1600;
    const n = this.doc.views.length + 1;
    const v = this.model.add('views', {
      name: `Camera ${n}`,
      pos: { x: this.pos.x, y: this.pos.y, z: eye },
      target: { x: e.world.x, y: e.world.y, z: eye - 100 },
      fov: 60,
    });
    this.model.commit('Camera');
    this.reset();
    this.app.select([v.id]);
    this.app.refreshTool();
    this.app.openView({ type: 'saved', id: v.id });
  }

  drawOverlay(ctx, view) {
    if (this.pos && this.cursor) {
      const P = view.vp.w2s(this.pos), Q = view.vp.w2s(this.cursor);
      const T = view.theme;
      const ang = Math.atan2(Q.y - P.y, Q.x - P.x);
      ctx.save();
      ctx.fillStyle = T.planGuide;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.moveTo(P.x, P.y);
      ctx.arc(P.x, P.y, Math.hypot(Q.x - P.x, Q.y - P.y), ang - 0.52, ang + 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.planGuide;
      ctx.stroke();
      ctx.restore();
    }
  }
}
