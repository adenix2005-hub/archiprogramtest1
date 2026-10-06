// Door and window placement on walls.

import { Tool } from './base.js';
import { nearestWall } from '../snap.js';
import { drawOpening } from '../render.js';
import { roundTo } from '../../core/vec.js';
import { isMetric } from '../../core/units.js';

export const DOOR_STYLES = {
  single: 'Single swing',
  double: 'Double swing',
  sliding: 'Sliding',
  pocket: 'Pocket',
  bifold: 'Bi-fold',
  garage: 'Garage (overhead)',
};

export const WINDOW_STYLES = {
  casement: 'Casement',
  sliding: 'Sliding',
  fixed: 'Fixed',
  awning: 'Awning',
  'double-hung': 'Double hung',
};

export class OpeningTool extends Tool {
  constructor(app, kind) {
    super(app);
    this.kind = kind; // 'door' | 'window' | 'opening'
    this.preview = null;
    this.hinge = 'start';
  }

  get id() {
    return this.kind;
  }

  get prompt() {
    const what = this.kind === 'door' ? 'door' : this.kind === 'window' ? 'window' : 'opening';
    return `Tap a wall to place a ${what}. The side you tap is the side it opens to. Space flips the hinge.`;
  }

  get actions() {
    return this.kind === 'door' ? [{ id: 'hinge', label: 'Flip hinge', icon: 'flip', run: () => this.flipHinge() }] : [];
  }

  reset() {
    this.preview = null;
  }

  flipHinge() {
    this.hinge = this.hinge === 'start' ? 'end' : 'start';
    this.app.plan.invalidateOverlay();
  }

  onKey(e) {
    if (e.key === ' ' && this.kind === 'door') {
      this.flipHinge();
      return true;
    }
    return false;
  }

  spec() {
    const o = this.app.toolOptions[this.kind];
    return o;
  }

  compute(e) {
    const app = this.app;
    const vp = app.plan.vp;
    const tol = Math.max(e.tolPx, 16) / vp.scale;
    const hit = nearestWall(app.derived, app.activeLevel, e.world, tol);
    if (!hit) return null;
    const { g, pr } = hit;
    const spec = this.spec();
    let width = spec.width;
    const lo = g.sMin + 20, hi = g.sMax - 20;
    if (hi - lo < 200) return { g, invalid: 'Wall too short' };
    width = Math.min(width, hi - lo);
    let pos = pr.s;
    const centre = (g.sMin + g.sMax) / 2;
    const step = isMetric(app.model.settings.units) ? 50 : 25.4;
    if (Math.abs(pos - centre) * vp.scale < 10) pos = centre;
    else {
      // snap the distance from the nearest wall end to a round value
      const fromStart = pos - width / 2 - g.sMin;
      const fromEnd = g.sMax - (pos + width / 2);
      if (fromStart < fromEnd) pos = g.sMin + roundTo(fromStart, step) + width / 2;
      else pos = g.sMax - roundTo(fromEnd, step) - width / 2;
    }
    pos = Math.min(hi - width / 2, Math.max(lo + width / 2, pos));
    const s0 = pos - width / 2, s1 = pos + width / 2;
    // overlap check
    const lv = app.derived.level(app.activeLevel);
    const others = lv.openingsByWall.get(g.wall.id) || [];
    const overlap = others.some((x) => s0 < x.s1 - 1 && s1 > x.s0 + 1);
    const swing = pr.side >= 0 ? 1 : -1;
    const o = {
      kind: this.kind,
      style: this.kind === 'opening' ? 'opening' : spec.style,
      pos,
      width,
      height: spec.height,
      sill: this.kind === 'window' ? spec.sill : 0,
      swing,
      hinge: this.hinge,
      wall: g.wall.id,
    };
    return { g, o, s0, s1, invalid: overlap ? 'Overlaps another opening' : null, fromStart: s0 - g.sMin, fromEnd: g.sMax - s1 };
  }

  onPointerDown(e) {
    this.preview = this.compute(e);
  }

  onPointerMove(e) {
    this.preview = this.compute(e);
  }

  onPointerUp(e) {
    const p = this.compute(e);
    this.preview = p;
    if (!p) return;
    if (p.invalid) {
      this.app.toast(p.invalid);
      return;
    }
    const o = this.model.add('openings', { ...p.o });
    this.model.commit(this.kind === 'door' ? 'Door' : this.kind === 'window' ? 'Window' : 'Opening');
    this.app.lastPlaced = o.id;
    this.app.refreshTool();
  }

  onLeave() {
    this.preview = null;
  }

  drawOverlay(ctx, view) {
    const p = this.preview;
    if (!p || !p.o) return;
    const T = view.theme;
    view.vp.applyWorld(ctx, view.dpr);
    const g = p.g;
    // gap
    ctx.save();
    ctx.beginPath();
    const ss = g.path.samples(p.s0, p.s1);
    ss.forEach((s, i) => {
      const q = g.path.offsetAt(s, g.half);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    for (let i = ss.length - 1; i >= 0; i--) {
      const q = g.path.offsetAt(ss[i], -g.half);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fillStyle = p.invalid ? 'rgba(200,60,40,0.35)' : T.planBg;
    ctx.fill();
    ctx.restore();
    drawOpening(ctx, view.vp, g, p.o, p.s0, p.s1, T, true);
    view.vp.applyScreen(ctx, view.dpr);
    // distances to the wall ends
    const a = g.path.offsetAt(g.sMin, -g.half - view.vp.px(16));
    const b = g.path.offsetAt(p.s0, -g.half - view.vp.px(16));
    const c = g.path.offsetAt(p.s1, -g.half - view.vp.px(16));
    const d = g.path.offsetAt(g.sMax, -g.half - view.vp.px(16));
    if (p.fromStart > 1) this.drawSegmentLabel(ctx, view, a, b, this.fmt(p.fromStart));
    if (p.fromEnd > 1) this.drawSegmentLabel(ctx, view, c, d, this.fmt(p.fromEnd));
    const m = view.vp.w2s(g.path.offsetAt(p.o.pos, g.half + view.vp.px(30)));
    view.drawPill(ctx, `${this.fmt(p.o.width)} wide`, m.x, m.y, { accent: false });
  }
}
