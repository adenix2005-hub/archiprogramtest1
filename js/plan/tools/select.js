// Select tool: pick, box-select, move, grip handles (wall ends, parallel move,
// curvature, opening width, roof vertices and edge slopes, dimension offsets)
// and tap-to-edit temporary dimensions.

import { Tool } from './base.js';
import { hitTest, hitRect, connectedWalls } from '../hittest.js';
import { nearestWall, lengthStep } from '../snap.js';
import { dist, sub, dot, addScaled, roundTo, norm, perp, mid } from '../../core/vec.js';
import { wallPath } from '../../geom/path.js';
import { beginTransform, applyTranslate, beginEndDrag, applyEndDrag, beginParallelMove, applyParallelMove, setWallLength } from '../../core/ops.js';
import { dimGeometry } from '../render.js';
import { roofEdgeSlopes, roofFootprint } from '../../geom/roof.js';
import { isMetric } from '../../core/units.js';

const DRAG_PX = 7;
const DRAG_PX_TOUCH = 12;

export class SelectTool extends Tool {
  constructor(app) {
    super(app);
    this.press = null;
    this.drag = null;
    this.hover = null;
    this.hoverHandle = null;
    this.pills = [];
  }

  get id() {
    return 'select';
  }

  get busy() {
    return !!this.drag;
  }

  get prompt() {
    const n = this.app.selection.size;
    if (!n) return 'Tap to select. Drag an item to move it. Drag on empty space for a selection box (Shift adds).';
    if (n === 1) return 'Drag the round grips to reshape. Tap a blue measurement to type an exact size.';
    return `${n} items selected. Drag to move them; Delete removes them.`;
  }

  reset() {
    this.press = null;
    this.drag = null;
  }

  tol(e) {
    return e.tolPx / this.app.plan.vp.scale;
  }

  /* ---------- handles ---------- */

  handles() {
    const app = this.app;
    if (app.selection.size !== 1) return [];
    const id = [...app.selection][0];
    const el = this.model.get(id);
    const kind = this.model.kind(id);
    if (!el) return [];
    const vp = app.plan.vp;
    const H = [];
    switch (kind) {
      case 'wall': {
        if (el.level !== app.activeLevel) return [];
        const path = wallPath(el);
        const L = path.length;
        H.push({ key: 'a', p: el.a, shape: 'circle', wall: el });
        H.push({ key: 'b', p: el.b, shape: 'circle', wall: el });
        H.push({ key: 'mid', p: path.pointAt(L / 2), shape: 'move', wall: el });
        const side = (el.bulge || 0) < 0 ? -1 : 1;
        const half = (el.thickness || 200) / 2;
        H.push({ key: 'curve', p: path.offsetAt(L / 2, side * (half + vp.px(28))), shape: 'curve', wall: el });
        break;
      }
      case 'opening': {
        const w = this.model.get(el.wall);
        if (!w || w.level !== app.activeLevel) return [];
        const path = wallPath(w);
        const half = w.thickness / 2;
        const s0 = el.pos - el.width / 2, s1 = el.pos + el.width / 2;
        const sig = (el.swing ?? 1) >= 0 ? 1 : -1;
        if (el.width * vp.scale >= 46) {
          H.push({ key: 'w0', p: path.offsetAt(s0, 0), shape: 'circle', o: el });
          H.push({ key: 'w1', p: path.offsetAt(s1, 0), shape: 'circle', o: el });
        }
        if (el.kind === 'door') {
          H.push({ key: 'swing', p: path.offsetAt(el.pos, sig * (half + vp.px(24))), shape: 'flip', o: el, tap: () => this.flipOpening(el, 'swing') });
          if ((el.style || 'single') === 'single' || el.style === 'pocket') {
            const sh = el.hinge === 'end' ? s1 : s0;
            H.push({ key: 'hinge', p: path.offsetAt(sh, -sig * (half + vp.px(22))), shape: 'hinge', o: el, tap: () => this.flipOpening(el, 'hinge') });
          }
        } else if (el.kind === 'window') {
          H.push({ key: 'swing', p: path.offsetAt(el.pos, sig * (half + vp.px(22))), shape: 'flip', o: el, tap: () => this.flipOpening(el, 'swing') });
        }
        break;
      }
      case 'roof': {
        if (el.level !== app.activeLevel) return [];
        const pts = roofFootprint(el.points);
        el.points.forEach((p, i) => H.push({ key: `v${i}`, p, shape: 'circle', roof: el, index: i }));
        if (pts.length === el.points.length && el.kind !== 'flat') {
          const slopes = roofEdgeSlopes(el, pts);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const d = norm(sub(b, a));
            const outward = { x: d.y, y: -d.x };
            const m = addScaled(mid(a, b), outward, vp.px(18) + (el.overhang || 0));
            H.push({ key: `e${i}`, p: m, shape: slopes[i] ? 'slope' : 'gable', roof: el, index: i, tap: () => this.toggleRoofEdge(el, i) });
          }
        }
        break;
      }
      case 'dim': {
        if (el.level !== app.activeLevel) return [];
        const g = dimGeometry(el);
        H.push({ key: 'a', p: el.a, shape: 'circle', dim: el });
        H.push({ key: 'b', p: el.b, shape: 'circle', dim: el });
        H.push({ key: 'off', p: mid(g.a2, g.b2), shape: 'move', dim: el });
        break;
      }
      case 'section': {
        H.push({ key: 'a', p: el.a, shape: 'circle', sec: el });
        H.push({ key: 'b', p: el.b, shape: 'circle', sec: el });
        const d = norm(sub(el.b, el.a));
        const look = perp(d);
        const k = el.flip ? -1 : 1;
        H.push({ key: 'flip', p: addScaled(mid(el.a, el.b), look, k * vp.px(26)), shape: 'flip', sec: el, tap: () => this.flipSection(el) });
        break;
      }
      case 'view': {
        if (!el.pos) return [];
        H.push({ key: 'pos', p: el.pos, shape: 'circle', view: el });
        H.push({ key: 'target', p: el.target, shape: 'target', view: el });
        break;
      }
    }
    return H;
  }

  handleAt(e) {
    const vp = this.app.plan.vp;
    const r = Math.max(e.tolPx, 14);
    let best = null, bestD = Infinity;
    for (const h of this.handles()) {
      const P = vp.w2s(h.p);
      const d = Math.hypot(P.x - e.sx, P.y - e.sy);
      if (d <= r && d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  pillAt(e) {
    const pad = e.isTouch ? 8 : 3;
    for (const p of this.pills) {
      const r = p.rect;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const a = -(r.angle || 0);
      const dx = e.sx - cx, dy = e.sy - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= r.w / 2 + pad && Math.abs(ly) <= r.h / 2 + pad) return p;
    }
    return null;
  }

  touchPans(e) {
    if (this.pillAt(e) || this.handleAt(e)) return false;
    return !hitTest(this.app, e.world, this.tol(e));
  }

  /* ---------- pointer ---------- */

  onPointerDown(e) {
    const handle = this.handleAt(e);
    if (handle) {
      this.press = { handle, sx: e.sx, sy: e.sy, world: e.world };
      return;
    }
    const pill = this.pillAt(e);
    if (pill) {
      this.press = { pill, sx: e.sx, sy: e.sy };
      return;
    }
    const hit = hitTest(this.app, e.world, this.tol(e));
    if (hit) {
      if (e.shift || e.ctrl) {
        this.app.select([hit.id], 'toggle');
        this.press = null;
        return;
      }
      const wasSelected = this.app.selection.has(hit.id);
      if (!wasSelected) this.app.select([hit.id]);
      this.press = { hit, wasSelected, sx: e.sx, sy: e.sy, world: e.world };
      return;
    }
    this.press = { box: true, sx: e.sx, sy: e.sy, world: e.world, shift: e.shift };
  }

  onPointerMove(e) {
    const app = this.app;
    if (!this.press) {
      const tol = this.tol(e);
      this.hoverHandle = this.handleAt(e);
      this.hoverPill = this.pillAt(e);
      this.hover = this.hoverHandle || this.hoverPill ? null : hitTest(app, e.world, tol)?.id || null;
      app.plan.overlay.style.cursor = this.hoverHandle || this.hoverPill ? 'pointer' : this.hover ? 'move' : '';
      return;
    }
    if (!this.drag) {
      const th = e.isTouch ? DRAG_PX_TOUCH : DRAG_PX;
      if (Math.hypot(e.sx - this.press.sx, e.sy - this.press.sy) < th) return;
      if (this.press.pill) return;
      if (this.press.handle) this.startHandle(this.press.handle, e);
      else if (this.press.hit) this.startMove(e);
      else if (this.press.box) this.drag = { kind: 'box', a: this.press.world, b: e.world, sa: { x: this.press.sx, y: this.press.sy }, sb: { x: e.sx, y: e.sy } };
    }
    if (this.drag) this.updateDrag(e);
  }

  onPointerUp(e) {
    const press = this.press;
    this.press = null;
    if (this.drag) {
      this.endDrag(e);
      return;
    }
    if (!press) return;
    if (press.pill) {
      press.pill.edit();
      return;
    }
    if (press.handle) {
      press.handle.tap?.();
      return;
    }
    if (press.box) {
      if (!press.shift) this.app.clearSelection();
      return;
    }
    if (press.hit && press.wasSelected && this.app.selection.size > 1) this.app.select([press.hit.id]);
  }

  onPointerCancel() {
    if (this.drag && this.drag.kind !== 'box') this.model.revert();
    this.reset();
    this.app.refreshTool();
  }

  onDoubleClick(e) {
    const hit = hitTest(this.app, e.world, this.tol(e));
    if (!hit) return;
    const app = this.app;
    switch (hit.kind) {
      case 'wall':
        app.select(connectedWalls(app, hit.id));
        break;
      case 'room':
        app.select([hit.id]);
        app.ui.props.focusField('name');
        break;
      case 'text':
        app.select([hit.id]);
        app.ui.props.focusField('text');
        break;
      case 'section':
        app.openView({ type: 'section', id: hit.id });
        break;
      case 'view':
        app.openView({ type: 'saved', id: hit.id });
        break;
      case 'roof':
        app.select([hit.id]);
        app.setLayout(app.layout === 'plan' ? 'split' : app.layout);
        break;
    }
  }

  cancel() {
    if (this.drag) {
      if (this.drag.kind !== 'box') this.model.revert();
      this.reset();
      this.app.refreshTool();
      return true;
    }
    return false;
  }

  /* ---------- dragging ---------- */

  gripFor(world, ids) {
    const pts = [];
    for (const id of ids) {
      const el = this.model.get(id);
      const k = this.model.kind(id);
      if (!el) continue;
      if (k === 'wall') pts.push(el.a, el.b);
      else if (k === 'roof') pts.push(...el.points);
      else if (k === 'dim' || k === 'section') pts.push(el.a, el.b);
      else if (k === 'view' && el.pos) pts.push(el.pos);
      else if ('x' in el && 'y' in el) pts.push({ x: el.x, y: el.y });
    }
    let best = null, bestD = 60 / this.app.plan.vp.scale;
    for (const p of pts) {
      const d = dist(p, world);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { ...best } : { ...world };
  }

  startMove(e) {
    const ids = [...this.app.selection];
    if (ids.length === 1 && this.model.kind(ids[0]) === 'opening') {
      this.drag = { kind: 'opening', o: this.model.get(ids[0]) };
      return;
    }
    const ctx = beginTransform(this.doc, ids);
    const exclude = new Set(ids);
    for (const s of [...ctx.stretch, ...ctx.tees]) exclude.add(s.wall.id);
    this.drag = { kind: 'move', ctx, grip: this.gripFor(this.press.world, ids), start: this.press.world, exclude };
  }

  startHandle(h, e) {
    const doc = this.doc;
    if (h.wall) {
      const w = h.wall;
      if (h.key === 'a' || h.key === 'b') {
        const ctx = beginEndDrag(doc, w, h.key, e.alt);
        const exclude = new Set([w.id, ...ctx.joined.map((j) => j.wall.id), ...ctx.tees.map((t) => t.wall.id)]);
        this.drag = { kind: 'wallEnd', ctx, w, which: h.key, exclude };
      } else if (h.key === 'mid') {
        const ctx = beginParallelMove(doc, w);
        const path = wallPath(w);
        this.drag = { kind: 'parallel', ctx, w, start: e.world, n: path.normalAt(path.length / 2), m0: path.pointAt(path.length / 2) };
      } else if (h.key === 'curve') {
        this.drag = { kind: 'curve', w };
      }
      return;
    }
    if (h.o) {
      this.drag = { kind: 'openingEdge', o: h.o, which: h.key };
      return;
    }
    if (h.roof) {
      if (h.key.startsWith('v')) this.drag = { kind: 'roofVertex', roof: h.roof, index: h.index };
      return;
    }
    if (h.dim) {
      this.drag = { kind: h.key === 'off' ? 'dimOffset' : 'dimEnd', dim: h.dim, which: h.key };
      return;
    }
    if (h.sec) {
      if (h.key === 'a' || h.key === 'b') this.drag = { kind: 'secEnd', sec: h.sec, which: h.key };
      return;
    }
    if (h.view) {
      this.drag = { kind: 'viewPt', view: h.view, which: h.key };
    }
  }

  updateDrag(e) {
    const d = this.drag;
    const app = this.app;
    const vp = app.plan.vp;
    switch (d.kind) {
      case 'box':
        d.b = e.world;
        d.sb = { x: e.sx, y: e.sy };
        return;
      case 'move': {
        const raw = { x: d.grip.x + e.world.x - d.start.x, y: d.grip.y + e.world.y - d.start.y };
        const s = app.snapper.snap(raw, { tolPx: e.tolPx, exclude: d.exclude, from: d.grip, ortho: e.shift, noRound: false });
        this.snap = s;
        applyTranslate(this.doc, d.ctx, sub(s.p, d.grip));
        this.model.touch();
        return;
      }
      case 'opening': {
        const o = d.o;
        const hit = nearestWall(app.derived, app.activeLevel, e.world, Math.max(e.tolPx, 30) / vp.scale);
        if (!hit) return;
        const g = hit.g;
        const lo = g.sMin + 20, hi = g.sMax - 20;
        if (hi - lo < o.width) return;
        let pos = hit.pr.s;
        const centre = (g.sMin + g.sMax) / 2;
        if (Math.abs(pos - centre) * vp.scale < 10) pos = centre;
        else {
          const step = isMetric(this.settings.units) ? 10 : 12.7;
          pos = g.sMin + roundTo(pos - o.width / 2 - g.sMin, step) + o.width / 2;
        }
        o.wall = g.wall.id;
        o.pos = Math.min(hi - o.width / 2, Math.max(lo + o.width / 2, pos));
        this.model.touch();
        return;
      }
      case 'wallEnd': {
        const other = d.w[d.which === 'a' ? 'b' : 'a'];
        const s = app.snapper.snap(e.world, { tolPx: e.tolPx, exclude: d.exclude, from: other, ortho: e.shift });
        this.snap = s;
        applyEndDrag(this.doc, d.ctx, s.p);
        this.model.touch();
        return;
      }
      case 'parallel': {
        let off = dot(sub(e.world, d.start), d.n);
        const target = addScaled(d.m0, d.n, off);
        const s = app.snapper.snap(target, { tolPx: e.tolPx, exclude: new Set([d.w.id]), from: d.m0, ortho: true });
        off = dot(sub(s.p, d.m0), d.n);
        this.snap = s;
        applyParallelMove(this.doc, d.ctx, off);
        this.model.touch();
        return;
      }
      case 'curve': {
        const w = d.w;
        const chord = dist(w.a, w.b);
        // pointer projected onto the chord normal is more predictable than a 3-point arc
        const nL = perp(norm(sub(w.b, w.a)));
        let s = dot(sub(e.world, mid(w.a, w.b)), nL);
        const half = (w.thickness || 200) / 2;
        s -= Math.sign(s) * (half + vp.px(28));
        if (Math.abs(s) < Math.max(0.03 * chord, 12 / vp.scale)) s = 0;
        else {
          s = roundTo(s, lengthStep(vp.scale, this.settings.units));
          if (Math.abs(Math.abs(s) - chord / 2) * vp.scale < 12) s = Math.sign(s) * chord / 2;
        }
        s = Math.max(-chord * 2, Math.min(chord * 2, s));
        w.bulge = s;
        this.model.touch();
        return;
      }
      case 'openingEdge': {
        const o = d.o;
        const w = this.model.get(o.wall);
        if (!w) return;
        const g = app.derived.wallGeom(w);
        if (!g) return;
        const s = g.path.project(e.world).s;
        const step = isMetric(this.settings.units) ? 10 : 12.7;
        let s0 = o.pos - o.width / 2, s1 = o.pos + o.width / 2;
        if (d.which === 'w0') s0 = Math.max(g.sMin + 20, Math.min(s1 - 200, s1 - roundTo(s1 - s, step)));
        else s1 = Math.min(g.sMax - 20, Math.max(s0 + 200, s0 + roundTo(s - s0, step)));
        o.pos = (s0 + s1) / 2;
        o.width = s1 - s0;
        this.model.touch();
        return;
      }
      case 'roofVertex': {
        const s = app.snapper.snap(e.world, { tolPx: e.tolPx, exclude: new Set([d.roof.id]), onWall: false });
        this.snap = s;
        d.roof.points[d.index] = { x: s.p.x, y: s.p.y };
        this.model.touch();
        return;
      }
      case 'dimEnd': {
        const s = app.snapper.snap(e.world, { tolPx: e.tolPx, exclude: new Set([d.dim.id]) });
        this.snap = s;
        d.dim[d.which] = { ...s.p };
        this.model.touch();
        return;
      }
      case 'dimOffset': {
        const g = dimGeometry(d.dim);
        d.dim.offset = Math.round(dot(sub(e.world, d.dim.a), g.n));
        this.model.touch();
        return;
      }
      case 'secEnd': {
        const s = app.snapper.snap(e.world, { tolPx: e.tolPx, exclude: new Set([d.sec.id]), onWall: false, from: d.sec[d.which === 'a' ? 'b' : 'a'] });
        this.snap = s;
        d.sec[d.which] = { ...s.p };
        this.model.touch();
        return;
      }
      case 'viewPt': {
        const v = d.view;
        v[d.which] = { ...v[d.which], x: e.world.x, y: e.world.y };
        this.model.touch();
        return;
      }
    }
  }

  endDrag(e) {
    const d = this.drag;
    this.drag = null;
    this.snap = null;
    const app = this.app;
    if (d.kind === 'box') {
      const rect = { minX: Math.min(d.a.x, d.b.x), maxX: Math.max(d.a.x, d.b.x), minY: Math.min(d.a.y, d.b.y), maxY: Math.max(d.a.y, d.b.y) };
      const windowMode = d.sb.x >= d.sa.x;
      const ids = hitRect(app, rect, windowMode);
      app.select(ids, e.shift ? 'add' : 'replace');
      return;
    }
    const labels = {
      move: 'Move',
      opening: 'Move opening',
      wallEnd: 'Move wall end',
      parallel: 'Move wall',
      curve: 'Curve wall',
      openingEdge: 'Resize opening',
      roofVertex: 'Edit roof',
      dimEnd: 'Edit dimension',
      dimOffset: 'Move dimension',
      secEnd: 'Edit section',
      viewPt: 'Edit camera',
    };
    this.model.commit(labels[d.kind] || 'Edit');
    app.refreshTool();
  }

  /* ---------- quick actions ---------- */

  flipOpening(o, what) {
    if (what === 'swing') o.swing = -(o.swing || 1);
    else o.hinge = o.hinge === 'end' ? 'start' : 'end';
    this.model.commit('Flip');
    this.app.refreshTool();
  }

  flipSection(s) {
    s.flip = !s.flip;
    this.model.commit('Flip section');
    this.app.refreshTool();
  }

  toggleRoofEdge(roof, i) {
    const pts = roofFootprint(roof.points);
    const slopes = roofEdgeSlopes(roof, pts);
    slopes[i] = !slopes[i];
    if (slopes.every((s) => !s)) {
      this.app.toast('At least one roof edge must slope');
      return;
    }
    roof.edges = slopes;
    this.model.commit('Roof edge');
    this.app.refreshTool();
  }

  /* ---------- temporary dimensions ---------- */

  buildPills(ctx, view) {
    this.pills = [];
    const app = this.app;
    if (app.selection.size !== 1 || this.drag) return;
    const id = [...app.selection][0];
    const el = this.model.get(id);
    const kind = this.model.kind(id);
    const vp = view.vp;
    if (kind === 'wall' && el.level === app.activeLevel) {
      const g = app.derived.wallGeom(el);
      if (!g) return;
      const L = g.path.length;
      const side = (el.bulge || 0) < 0 ? 1 : -1;
      const m = g.path.offsetAt(L / 2, side * (g.half + vp.px(20)));
      const P = vp.w2s(m);
      const t = g.path.tangentAt(L / 2);
      let ang = Math.atan2(-t.y, t.x);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const rect = view.drawPill(ctx, this.fmt(L), P.x, P.y, { angle: ang });
      this.pills.push({
        rect,
        edit: () =>
          app.ui.inlineEdit(rect, this.fmt(L), (txt) => {
            const v = app.parse(txt);
            if (!(v > 10)) return false;
            setWallLength(this.doc, el, v);
            this.model.commit('Wall length');
            return true;
          }),
      });
    } else if (kind === 'opening') {
      const w = this.model.get(el.wall);
      if (!w || w.level !== app.activeLevel) return;
      const g = app.derived.wallGeom(w);
      if (!g) return;
      const s0 = el.pos - el.width / 2, s1 = el.pos + el.width / 2;
      const sig = (el.swing ?? 1) >= 0 ? -1 : 1;
      const off = sig * (g.half + vp.px(20));
      const mk = (sa, sb, value, apply) => {
        if (sb - sa < 1) return;
        const P = vp.w2s(g.path.offsetAt((sa + sb) / 2, off));
        const rect = view.drawPill(ctx, this.fmt(value), P.x, P.y, { accent: true });
        this.pills.push({
          rect,
          edit: () =>
            app.ui.inlineEdit(rect, this.fmt(value), (txt) => {
              const v = app.parse(txt);
              if (!Number.isFinite(v) || v < 0) return false;
              apply(v);
              this.model.commit('Opening position');
              return true;
            }),
        });
      };
      mk(g.sMin, s0, s0 - g.sMin, (v) => (el.pos = g.sMin + v + el.width / 2));
      mk(s0, s1, el.width, (v) => {
        if (v >= 100) el.width = v;
      });
      mk(s1, g.sMax, g.sMax - s1, (v) => (el.pos = g.sMax - v - el.width / 2));
    }
  }

  drawHandle(ctx, view, h, hot) {
    const T = view.theme;
    const P = view.vp.w2s(h.p);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = T.planAccent;
    ctx.fillStyle = hot ? T.planAccent : T.planPaper;
    const r = hot ? 8 : 7;
    ctx.beginPath();
    switch (h.shape) {
      case 'move':
        ctx.rect(P.x - r, P.y - r, 2 * r, 2 * r);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = hot ? T.planPaper : T.planAccent;
        ctx.lineWidth = 1.4;
        ctx.moveTo(P.x - 4, P.y);
        ctx.lineTo(P.x + 4, P.y);
        ctx.moveTo(P.x, P.y - 4);
        ctx.lineTo(P.x, P.y + 4);
        ctx.stroke();
        break;
      case 'curve':
        ctx.arc(P.x, P.y, r + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = hot ? T.planPaper : T.planAccent;
        ctx.lineWidth = 1.6;
        ctx.arc(P.x, P.y + 7, 7, -Math.PI * 0.8, -Math.PI * 0.2);
        ctx.stroke();
        break;
      case 'flip':
      case 'hinge':
        ctx.arc(P.x, P.y, r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = hot ? T.planPaper : T.planAccent;
        ctx.lineWidth = 1.5;
        ctx.arc(P.x, P.y, 4, 0.3, Math.PI * 1.7);
        ctx.stroke();
        break;
      case 'slope':
      case 'gable':
        ctx.fillStyle = h.shape === 'slope' ? T.planRoof : T.planPaper;
        ctx.strokeStyle = T.planRoof;
        ctx.arc(P.x, P.y, r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = h.shape === 'slope' ? T.planPaper : T.planRoof;
        ctx.lineWidth = 1.6;
        if (h.shape === 'slope') {
          ctx.moveTo(P.x - 5, P.y + 3);
          ctx.lineTo(P.x, P.y - 3);
          ctx.lineTo(P.x + 5, P.y + 3);
        } else {
          ctx.moveTo(P.x - 5, P.y + 4);
          ctx.lineTo(P.x, P.y - 5);
          ctx.lineTo(P.x + 5, P.y + 4);
          ctx.closePath();
        }
        ctx.stroke();
        break;
      case 'target':
        ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(P.x, P.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = T.planAccent;
        ctx.fill();
        break;
      default:
        ctx.arc(P.x, P.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
  }

  drawOverlay(ctx, view) {
    const app = this.app;
    const T = view.theme;
    if (this.hover && !app.selection.has(this.hover) && !this.drag) {
      app.drawHighlights(ctx, view, new Set([this.hover]), T.planGuide);
    }
    if (this.drag?.kind === 'box') {
      const { sa, sb } = this.drag;
      const windowMode = sb.x >= sa.x;
      ctx.save();
      ctx.strokeStyle = windowMode ? T.planAccent : T.planGuide;
      ctx.fillStyle = T.planAccentFill;
      ctx.setLineDash(windowMode ? [] : [6, 4]);
      ctx.lineWidth = 1.2;
      const x = Math.min(sa.x, sb.x), y = Math.min(sa.y, sb.y), w = Math.abs(sb.x - sa.x), h = Math.abs(sb.y - sa.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.restore();
    }
    this.buildPills(ctx, view);
    if (!this.drag || this.drag.kind !== 'box') {
      for (const h of this.handles()) this.drawHandle(ctx, view, h, this.hoverHandle && this.hoverHandle.key === h.key);
    }
    if (this.drag?.kind === 'wallEnd' || this.drag?.kind === 'parallel') {
      const w = this.drag.w;
      const L = wallPath(w).length;
      const P = view.vp.w2s(wallPath(w).pointAt(L / 2));
      view.drawPill(ctx, this.fmt(L), P.x, P.y - 24);
    }
    if (this.drag?.kind === 'curve') {
      const w = this.drag.w;
      const path = wallPath(w);
      const P = view.vp.w2s(path.midPoint());
      view.drawPill(ctx, path.isArc ? `depth ${this.fmt(Math.abs(w.bulge))} · R ${this.fmt(path.radius)}` : 'straight', P.x, P.y - 28);
    }
    if (this.snap && this.drag) view.drawSnap(ctx, this.snap);
  }
}

