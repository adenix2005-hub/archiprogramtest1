// The 2D plan view: two stacked canvases (model layer + interaction overlay),
// unified pointer handling for mouse, pen and touch, pinch zoom and panning.

import { Viewport } from './viewport.js';
import { renderPlan, pathPoly } from './render.js';
import { readTheme } from './theme.js';
import { makePath } from '../geom/path.js';
import { computeWallGeoms, wallOutline } from '../geom/joins.js';

const TAP_MOVE_PX = 10;
const DOUBLE_TAP_MS = 380;

export class PlanView {
  constructor(app, container) {
    this.app = app;
    this.el = container;
    this.base = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.base.className = 'plan-canvas';
    this.overlay.className = 'plan-canvas plan-overlay';
    this.overlay.setAttribute('aria-label', 'Floor plan drawing area');
    this.overlay.tabIndex = 0;
    container.append(this.base, this.overlay);
    this.bctx = this.base.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.vp = new Viewport();
    this.dpr = 1;
    this.theme = readTheme();
    this._needBase = true;
    this._needOverlay = true;
    this._raf = 0;
    this.pointers = new Map();
    this.pinch = null;
    this.pan = null;
    this.toolPointer = null;
    this.navOnly = new Set();
    this.lastTap = null;
    this.hoverWorld = null;
    this.cursorScreen = null;
    this.penActive = false;
    this.lastPenTime = 0;
    this.spaceDown = false;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    const o = this.overlay;
    o.addEventListener('pointerdown', (e) => this._down(e));
    o.addEventListener('pointermove', (e) => this._move(e));
    o.addEventListener('pointerup', (e) => this._up(e));
    o.addEventListener('pointercancel', (e) => this._cancel(e));
    o.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && !this.pointers.size) {
        this.hoverWorld = null;
        this.cursorScreen = null;
        this.app.tool?.onLeave?.();
        this.invalidateOverlay();
      }
    });
    o.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    o.addEventListener('contextmenu', (e) => e.preventDefault());
    o.addEventListener('dblclick', (e) => e.preventDefault());
  }

  refreshTheme() {
    this.theme = readTheme();
    this.invalidate();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w === this.vp.w && h === this.vp.h && dpr === this.dpr) return;
    const refit = !this.userAdjusted && this.vp.w > 1 && this.app.derived;
    this.vp.w = w;
    this.vp.h = h;
    this.dpr = dpr;
    if (refit) {
      const bb = this.app.derived.bounds(this.app.activeLevel) || this.app.derived.bounds();
      if (bb) this.vp.fit(bb, Math.min(80, Math.min(w, h) * 0.12));
    }
    for (const c of [this.base, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.invalidate();
  }

  invalidate() {
    this._needBase = true;
    this._needOverlay = true;
    this._schedule();
  }

  invalidateOverlay() {
    this._needOverlay = true;
    this._schedule();
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this.el.offsetParent && this.el.getClientRects().length === 0) return;
      if (this._needBase) {
        this._needBase = false;
        this.renderBase();
      }
      if (this._needOverlay) {
        this._needOverlay = false;
        this.renderOverlay();
      }
    });
  }

  renderState() {
    const app = this.app;
    return {
      model: app.model,
      derived: app.derived,
      levelId: app.activeLevel,
      layers: app.prefs.layers,
      theme: this.theme,
      units: app.model.settings.units,
      selection: app.selection,
    };
  }

  renderBase() {
    try {
      renderPlan(this.bctx, this.vp, this.dpr, this.renderState());
    } catch (err) {
      console.error('Plan render failed', err);
    }
  }

  renderOverlay() {
    const ctx = this.octx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.vp.applyScreen(ctx, this.dpr);
    try {
      this.app.tool?.drawOverlay(ctx, this);
    } catch (err) {
      console.error('Overlay render failed', err);
    }
    const typed = this.app.ui?.typedValue;
    if (typed && this.cursorScreen) this.drawPill(ctx, typed, this.cursorScreen.x + 48, this.cursorScreen.y + 30);
    if (this.touchCursor) {
      const { fx, fy, sx, sy } = this.touchCursor;
      ctx.save();
      ctx.strokeStyle = this.theme.planGuide;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.moveTo(sx - 16, sy);
      ctx.lineTo(sx + 16, sy);
      ctx.moveTo(sx, sy - 16);
      ctx.lineTo(sx, sy + 16);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- drawing helpers for tools ---------- */

  drawSnap(ctx, snap) {
    if (!snap) return;
    const T = this.theme;
    const P = this.vp.w2s(snap.p);
    ctx.save();
    for (const g of snap.guides || []) {
      const A = this.vp.w2s(g.a), B = this.vp.w2s(g.b);
      ctx.strokeStyle = T.planGuide;
      ctx.lineWidth = 1;
      ctx.setLineDash(g.kind === 'rubber' ? [] : [6, 4]);
      ctx.globalAlpha = g.kind === 'rubber' ? 0 : 0.9;
      ctx.beginPath();
      if (g.kind === 'polar' || g.kind === 'align') {
        // extend guides across the view
        const dx = B.x - A.x, dy = B.y - A.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const far = Math.max(this.vp.w, this.vp.h) * 2;
        ctx.moveTo(A.x - (g.kind === 'align' ? ux * far : 0), A.y - (g.kind === 'align' ? uy * far : 0));
        ctx.lineTo(A.x + ux * far, A.y + uy * far);
      } else {
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = T.planSnap;
    ctx.fillStyle = T.planSnap;
    ctx.lineWidth = 2;
    const r = 6;
    ctx.beginPath();
    switch (snap.kind) {
      case 'end':
        ctx.rect(P.x - r, P.y - r, 2 * r, 2 * r);
        break;
      case 'corner':
        ctx.rect(P.x - r + 1, P.y - r + 1, 2 * r - 2, 2 * r - 2);
        ctx.moveTo(P.x - r + 1, P.y - r + 1);
        ctx.lineTo(P.x + r - 1, P.y + r - 1);
        break;
      case 'mid':
        ctx.moveTo(P.x, P.y - r - 1);
        ctx.lineTo(P.x + r + 1, P.y + r);
        ctx.lineTo(P.x - r - 1, P.y + r);
        ctx.closePath();
        break;
      case 'center':
        ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
        ctx.moveTo(P.x - 3, P.y);
        ctx.lineTo(P.x + 3, P.y);
        break;
      case 'onwall':
        ctx.moveTo(P.x - r, P.y - r);
        ctx.lineTo(P.x + r, P.y + r);
        ctx.moveTo(P.x + r, P.y - r);
        ctx.lineTo(P.x - r, P.y + r);
        ctx.moveTo(P.x - r, P.y - r);
        ctx.lineTo(P.x + r, P.y - r);
        ctx.moveTo(P.x - r, P.y + r);
        ctx.lineTo(P.x + r, P.y + r);
        break;
      case 'align':
      case 'polar':
        ctx.moveTo(P.x - r, P.y);
        ctx.lineTo(P.x + r, P.y);
        ctx.moveTo(P.x, P.y - r);
        ctx.lineTo(P.x, P.y + r);
        break;
      case 'grid':
        ctx.lineWidth = 1.5;
        ctx.moveTo(P.x - 4, P.y);
        ctx.lineTo(P.x + 4, P.y);
        ctx.moveTo(P.x, P.y - 4);
        ctx.lineTo(P.x, P.y + 4);
        break;
      default:
        ctx.arc(P.x, P.y, 3, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** A pill label (live dimensions while drawing). */
  drawPill(ctx, text, sx, sy, { accent = true, angle = 0 } = {}) {
    const T = this.theme;
    ctx.save();
    ctx.translate(sx, sy);
    if (angle) ctx.rotate(angle);
    ctx.font = `600 12px ${T.fontDim}`;
    const w = ctx.measureText(text).width + 12;
    const h = 20;
    ctx.fillStyle = accent ? T.planAccent : T.planBg;
    ctx.strokeStyle = accent ? T.planAccent : T.planDim;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 10);
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    if (!accent) ctx.stroke();
    ctx.fillStyle = accent ? T.planPaper : T.planInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0.5);
    ctx.restore();
    return { x: sx - w / 2, y: sy - h / 2, w, h };
  }

  /** Preview a wall (outline) in the overlay. */
  drawGhostWall(ctx, a, b, thickness, bulge = 0, opts = {}) {
    const path = makePath(a, b, bulge);
    if (!(path.length > 1)) return;
    const fake = { id: '__ghost', a, b, bulge, thickness, height: 1 };
    const { geoms } = computeWallGeoms([fake]);
    const g = geoms.get('__ghost');
    if (!g) return;
    const polys = wallOutline(g);
    this.vp.applyWorld(ctx, this.dpr);
    ctx.beginPath();
    for (const p of polys) pathPoly(ctx, p);
    ctx.fillStyle = opts.fill || this.theme.planAccentFill;
    ctx.fill();
    ctx.strokeStyle = opts.stroke || this.theme.planAccent;
    ctx.lineWidth = this.vp.px(1.5);
    ctx.stroke();
    this.vp.applyScreen(ctx, this.dpr);
  }

  /* ---------- input ---------- */

  _local(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _toolEvent(e) {
    const L = this._local(e);
    const isTouch = e.pointerType === 'touch';
    const offset = isTouch && this.app.prefs.touchOffset ? 64 : 0;
    const sy = L.y - offset;
    const world = this.vp.s2w(L.x, sy);
    return {
      sx: L.x,
      sy,
      world,
      pointerType: e.pointerType,
      button: e.button,
      buttons: e.buttons,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      pressure: e.pressure,
      isTouch,
      tolPx: isTouch ? 22 : e.pointerType === 'pen' ? 13 : 10,
      time: e.timeStamp,
      original: e,
    };
  }

  _down(e) {
    const app = this.app;
    this.overlay.focus({ preventScroll: true });
    app.setFocusView('plan');
    const L = this._local(e);
    this.lastPointerType = e.pointerType;
    this.pointers.set(e.pointerId, { x: L.x, y: L.y, sx: L.x, sy: L.y, type: e.pointerType, t0: e.timeStamp, moved: false });
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (e.pointerType === 'pen') {
      this.penActive = true;
      this.lastPenTime = e.timeStamp;
    }
    // Palm rejection: ignore touches while the pen is on the screen.
    if (e.pointerType === 'touch' && this.penActive) {
      this.navOnly.add(e.pointerId);
      return;
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown) || (e.button === 0 && app.toolName === 'pan'))) {
      this.pan = { id: e.pointerId, x: L.x, y: L.y };
      this.overlay.classList.add('panning');
      return;
    }
    if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && e.button === 2) {
      app.tool.onContext?.(this._toolEvent(e));
      return;
    }
    if (e.pointerType === 'touch') {
      const touches = [...this.pointers.entries()].filter(([, p]) => p.type === 'touch');
      if (touches.length >= 2) {
        if (this.toolPointer !== null) {
          app.tool.onPointerCancel?.();
          this.toolPointer = null;
        }
        this.pan = null;
        const [[ia, pa], [ib, pb]] = touches.slice(-2);
        this._startPinch(ia, pa, ib, pb);
        for (const [id] of touches) this.navOnly.add(id);
        this.touchCursor = null;
        return;
      }
      const penOnly = app.prefs.penOnly && e.timeStamp - this.lastPenTime < 10 * 60 * 1000 && this.lastPenTime > 0;
      const tev = this._toolEvent(e);
      if (penOnly || app.toolName === 'pan' || app.tool.touchPans?.(tev)) {
        this.pan = { id: e.pointerId, x: L.x, y: L.y };
        return;
      }
      this.toolPointer = e.pointerId;
      this._updateTouchCursor(L, tev);
      app.tool.onPointerDown(tev);
      this.invalidateOverlay();
      return;
    }
    this.toolPointer = e.pointerId;
    const tev = this._toolEvent(e);
    this.hoverWorld = tev.world;
    app.tool.onPointerDown(tev);
    this.invalidateOverlay();
  }

  _updateTouchCursor(L, tev) {
    if (this.app.prefs.touchOffset && tev.isTouch) this.touchCursor = { fx: L.x, fy: L.y, sx: tev.sx, sy: tev.sy };
    else this.touchCursor = null;
  }

  _startPinch(ia, pa, ib, pb) {
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    this.pinch = {
      ids: [ia, ib],
      d0: Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1,
      scale0: this.vp.scale,
      world0: this.vp.s2w(mx, my),
    };
  }

  _move(e) {
    const app = this.app;
    const L = this._local(e);
    if (e.pointerType !== 'touch') this.lastPointerType = e.pointerType;
    const rec = this.pointers.get(e.pointerId);
    if (rec) {
      rec.x = L.x;
      rec.y = L.y;
      if (Math.hypot(L.x - rec.sx, L.y - rec.sy) > TAP_MOVE_PX) rec.moved = true;
    }
    if (this.pinch && this.pinch.ids.includes(e.pointerId)) {
      const pa = this.pointers.get(this.pinch.ids[0]), pb = this.pointers.get(this.pinch.ids[1]);
      this.userAdjusted = true;
      if (pa && pb) {
        const d = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const vp = this.vp;
        vp.scale = Math.min(8, Math.max(0.002, (this.pinch.scale0 * d) / this.pinch.d0));
        vp.cx = this.pinch.world0.x - (mx - vp.w / 2) / vp.scale;
        vp.cy = this.pinch.world0.y + (my - vp.h / 2) / vp.scale;
        app.onViewChanged();
        this.invalidate();
      }
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.userAdjusted = true;
      this.vp.panBy(L.x - this.pan.x, L.y - this.pan.y);
      this.pan.x = L.x;
      this.pan.y = L.y;
      app.onViewChanged();
      this.invalidate();
      return;
    }
    if (this.navOnly.has(e.pointerId)) return;
    const tev = this._toolEvent(e);
    if (e.pointerType !== 'touch' || this.toolPointer === e.pointerId) {
      this.hoverWorld = tev.world;
      this.cursorScreen = { x: tev.sx, y: tev.sy };
      app.onCursor(tev.world);
    }
    if (this.toolPointer === e.pointerId) {
      if (e.pointerType === 'touch') this._updateTouchCursor(L, tev);
      // Coalesced events give smoother freehand strokes.
      if (app.tool.wantsCoalesced && e.getCoalescedEvents) {
        const list = e.getCoalescedEvents();
        if (list.length > 1) for (const ce of list.slice(0, -1)) app.tool.onPointerMove(this._toolEvent(ce));
      }
      app.tool.onPointerMove(tev);
    } else if (this.toolPointer === null && e.pointerType !== 'touch') {
      app.tool.onPointerMove(tev);
    }
    this.invalidateOverlay();
  }

  _up(e) {
    const app = this.app;
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (e.pointerType === 'pen') this.penActive = false;
    if (this.pinch && this.pinch.ids.includes(e.pointerId)) {
      this.pinch = null;
      this.navOnly.delete(e.pointerId);
      return;
    }
    if (this.navOnly.has(e.pointerId)) {
      this.navOnly.delete(e.pointerId);
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.pan = null;
      this.overlay.classList.remove('panning');
      app.saveViewState();
      return;
    }
    if (this.toolPointer !== e.pointerId) return;
    this.toolPointer = null;
    const tev = this._toolEvent(e);
    tev.wasTap = rec && !rec.moved && e.timeStamp - rec.t0 < 450;
    app.tool.onPointerUp(tev);
    this.touchCursor = null;
    if (tev.wasTap) {
      const now = e.timeStamp;
      if (this.lastTap && now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(tev.sx - this.lastTap.x, tev.sy - this.lastTap.y) < 24) {
        this.lastTap = null;
        app.tool.onDoubleClick?.(tev);
      } else {
        this.lastTap = { t: now, x: tev.sx, y: tev.sy };
      }
    } else {
      this.lastTap = null;
    }
    this.invalidateOverlay();
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    this.navOnly.delete(e.pointerId);
    if (e.pointerType === 'pen') this.penActive = false;
    if (this.pinch && this.pinch.ids.includes(e.pointerId)) this.pinch = null;
    if (this.pan && this.pan.id === e.pointerId) this.pan = null;
    if (this.toolPointer === e.pointerId) {
      this.toolPointer = null;
      this.app.tool.onPointerCancel?.();
    }
    this.touchCursor = null;
    this.invalidateOverlay();
  }

  _wheel(e) {
    e.preventDefault();
    this.userAdjusted = true;
    const L = this._local(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;
    else if (e.deltaMode === 2) dy *= 400;
    if (e.shiftKey && !e.ctrlKey) {
      this.vp.panBy(-dy, 0);
    } else {
      const k = e.ctrlKey ? 0.01 : 0.0018;
      this.vp.zoomAt(Math.exp(-dy * k), L.x, L.y);
    }
    this.app.onViewChanged();
    this.invalidate();
    this.app.saveViewStateSoon();
  }

  zoomBy(f) {
    this.userAdjusted = true;
    this.vp.zoomAt(f, this.vp.w / 2, this.vp.h / 2);
    this.app.onViewChanged();
    this.invalidate();
  }

  fitTo(bb) {
    if (!bb) return;
    this.userAdjusted = false;
    this.vp.fit(bb, Math.min(80, Math.min(this.vp.w, this.vp.h) * 0.12));
    this.app.onViewChanged();
    this.invalidate();
  }
}
