// Plan view transform: world millimetres (Y up) <-> screen CSS pixels (Y down).

export const MIN_SCALE = 0.002; // px per mm (≈ 1:200000 on screen)
export const MAX_SCALE = 8;

export class Viewport {
  constructor() {
    this.cx = 6000;
    this.cy = 4000;
    this.scale = 0.06;
    this.w = 800;
    this.h = 600;
  }

  w2s(p) {
    return { x: (p.x - this.cx) * this.scale + this.w / 2, y: (this.cy - p.y) * this.scale + this.h / 2 };
  }

  s2w(x, y) {
    return { x: (x - this.w / 2) / this.scale + this.cx, y: this.cy - (y - this.h / 2) / this.scale };
  }

  /** Pixels to millimetres. */
  px(n = 1) {
    return n / this.scale;
  }

  zoomAt(factor, sx, sy) {
    const before = this.s2w(sx, sy);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const after = this.s2w(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panBy(dx, dy) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  fit(bb, marginPx = 60) {
    if (!bb) return;
    const w = Math.max(bb.maxX - bb.minX, 500);
    const h = Math.max(bb.maxY - bb.minY, 500);
    const sx = (this.w - 2 * marginPx) / w;
    const sy = (this.h - 2 * marginPx) / h;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(sx, sy)));
    this.cx = (bb.minX + bb.maxX) / 2;
    this.cy = (bb.minY + bb.maxY) / 2;
  }

  /** Set a 2D context transform so drawing happens in world units. */
  applyWorld(ctx, dpr) {
    const s = this.scale * dpr;
    ctx.setTransform(s, 0, 0, -s, dpr * (this.w / 2 - this.cx * this.scale), dpr * (this.h / 2 + this.cy * this.scale));
  }

  applyScreen(ctx, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  visibleBounds(pad = 0) {
    const a = this.s2w(-pad, this.h + pad), b = this.s2w(this.w + pad, -pad);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  toJSON() {
    return { cx: this.cx, cy: this.cy, scale: this.scale };
  }

  restore(o) {
    if (!o) return;
    if (Number.isFinite(o.cx)) this.cx = o.cx;
    if (Number.isFinite(o.cy)) this.cy = o.cy;
    if (Number.isFinite(o.scale)) this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, o.scale));
  }
}
