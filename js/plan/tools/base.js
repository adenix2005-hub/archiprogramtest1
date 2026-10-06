// Base class for plan tools.

import { dist, sub, mid, addScaled, norm, perp } from '../../core/vec.js';

export class Tool {
  constructor(app) {
    this.app = app;
    this.snap = null;
  }

  get model() {
    return this.app.model;
  }

  get doc() {
    return this.app.model.doc;
  }

  get settings() {
    return this.app.model.settings;
  }

  get level() {
    return this.app.activeLevel;
  }

  /** True while an operation is in progress (Esc ends it instead of leaving the tool). */
  get busy() {
    return false;
  }

  /** Status bar prompt. */
  get prompt() {
    return '';
  }

  /** Buttons for the floating action bar: [{id, label, icon, run, primary}] */
  get actions() {
    return [];
  }

  /** Label for typed values (e.g. 'Length'), or null when typing is not expected. */
  get inputLabel() {
    return null;
  }

  activate() {}

  deactivate() {
    this.reset();
  }

  reset() {
    this.snap = null;
  }

  onInput() {
    return false;
  }

  onKey() {
    return false;
  }

  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}

  onPointerCancel() {
    this.reset();
    this.app.refreshTool();
  }

  onDoubleClick() {}

  onContext() {
    if (this.busy) this.finish();
    else this.app.setTool('select');
  }

  /** Enter / Done. */
  finish() {
    this.reset();
    this.app.refreshTool();
  }

  /** Esc. Returns true when something was cancelled. */
  cancel() {
    if (!this.busy) return false;
    this.reset();
    this.app.refreshTool();
    return true;
  }

  snapAt(e, opts = {}) {
    return this.app.snapper.snap(e.world, { tolPx: e.tolPx, ortho: e.shift, ...opts });
  }

  drawOverlay(ctx, view) {
    if (this.snap) view.drawSnap(ctx, this.snap);
  }

  fmt(mm) {
    return this.app.fmt(mm);
  }

  /** Draw a live length label along a segment (screen space). */
  drawSegmentLabel(ctx, view, a, b, text) {
    const A = view.vp.w2s(a), B = view.vp.w2s(b);
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    if (L < 20) return;
    const M = mid(A, B);
    const d = norm(sub(B, A));
    const n = perp(d);
    let ang = Math.atan2(d.y, d.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    const P = addScaled(M, n, -18);
    view.drawPill(ctx, text, P.x, P.y, { angle: ang });
  }

  /** Small angle readout near a point. */
  drawAngleLabel(ctx, view, at, deg) {
    const P = view.vp.w2s(at);
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    view.drawPill(ctx, `${Math.round(a * 10) / 10}°`, P.x + 34, P.y + 26, { accent: false });
  }
}

export function segLen(a, b) {
  return dist(a, b);
}

/**
 * Parse typed drawing input relative to a point.
 * Accepts: "3600" (length along `dir`), "3600<90" (length at angle),
 * "@1200,3000" (relative x,y), "1200,3000" (absolute when no `from`).
 */
export function parseDrawInput(app, text, from, dir) {
  const t = text.trim();
  if (!t) return null;
  const parse = (s) => app.parse(s);
  let m = /^@\s*([^,]+),(.+)$/.exec(t);
  if (m) {
    const dx = parse(m[1]), dy = parse(m[2]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    const base = from || { x: 0, y: 0 };
    return { x: base.x + dx, y: base.y + dy };
  }
  m = /^([^<]+)<\s*(-?[\d.]+)\s*°?$/.exec(t);
  if (m && from) {
    const L = parse(m[1]);
    const a = (parseFloat(m[2]) * Math.PI) / 180;
    if (!Number.isFinite(L) || !Number.isFinite(a)) return null;
    return { x: from.x + Math.cos(a) * L, y: from.y + Math.sin(a) * L };
  }
  m = /^([^,]+),(.+)$/.exec(t);
  if (m) {
    const x = parse(m[1]), y = parse(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (from) return { x: from.x + x, y: from.y + y };
    return { x, y };
  }
  if (from) {
    const L = parse(t);
    if (!Number.isFinite(L)) return null;
    const d = dir && Math.hypot(dir.x, dir.y) > 1e-9 ? norm(dir) : { x: 1, y: 0 };
    return { x: from.x + d.x * L, y: from.y + d.y * L };
  }
  return null;
}
