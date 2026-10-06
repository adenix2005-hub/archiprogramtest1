// 2D plan renderer (Canvas 2D). Geometry is drawn in world millimetres through
// the viewport transform; labels are drawn in screen space so they stay crisp.

import { formatLength, formatArea, isMetric } from '../core/units.js';
import { pointInPolygon } from '../geom/polygon.js';
import { dist, sub, norm, perp, addScaled, normAngle, mid } from '../core/vec.js';

export function pathPoly(ctx, pts, close = true) {
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}

function strokeRun(ctx, path, s0, s1, d) {
  const ss = path.samples(s0, s1);
  const p0 = path.offsetAt(ss[0], d);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < ss.length; i++) {
    const p = path.offsetAt(ss[i], d);
    ctx.lineTo(p.x, p.y);
  }
}

/** Upright screen angle for text along a direction. */
function uprightAngle(a) {
  let ang = a;
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  return ang;
}

/** Draw text at a screen position with a halo for legibility over drawings. */
export function haloText(ctx, text, x, y, { font, color, halo, align = 'center', baseline = 'middle', angle = 0 }) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (halo) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = halo;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function gridSpacing(scale, units) {
  const metric = isMetric(units);
  const majors = metric ? [100, 1000, 10000, 100000, 1000000] : [304.8, 3048, 30480, 304800];
  const major = majors.find((m) => m * scale >= 42) || majors[majors.length - 1];
  let minor = metric ? major / 10 : major === 304.8 ? 76.2 : major / 10;
  if (minor * scale < 7) minor = major / 2;
  if (minor * scale < 7) minor = 0;
  return { major, minor };
}

function drawGrid(ctx, vp, dpr, T, units) {
  const { major, minor } = gridSpacing(vp.scale, units);
  const bb = vp.visibleBounds();
  vp.applyScreen(ctx, dpr);
  ctx.lineWidth = 1;
  const lines = (step, skipMajor) => {
    ctx.beginPath();
    const i0 = Math.ceil(bb.minX / step), i1 = Math.floor(bb.maxX / step);
    for (let i = i0; i <= i1; i++) {
      const x = i * step;
      if (skipMajor && Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
      const sx = Math.round(vp.w2s({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vp.h);
    }
    const j0 = Math.ceil(bb.minY / step), j1 = Math.floor(bb.maxY / step);
    for (let j = j0; j <= j1; j++) {
      const y = j * step;
      if (skipMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
      const sy = Math.round(vp.w2s({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(vp.w, sy);
    }
    ctx.stroke();
  };
  if (minor) {
    ctx.strokeStyle = T.planGrid;
    lines(minor, true);
  }
  ctx.strokeStyle = T.planGridMajor;
  lines(major, false);
  // origin marker
  const o = vp.w2s({ x: 0, y: 0 });
  if (o.x > -20 && o.x < vp.w + 20 && o.y > -20 && o.y < vp.h + 20) {
    ctx.strokeStyle = T.planGuide;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(o.x - 9, o.y);
    ctx.lineTo(o.x + 9, o.y);
    ctx.moveTo(o.x, o.y - 9);
    ctx.lineTo(o.x, o.y + 9);
    ctx.stroke();
  }
}

function levelBelow(doc, levelId) {
  const cur = doc.levels.find((l) => l.id === levelId);
  if (!cur) return null;
  let best = null;
  for (const l of doc.levels) {
    if (l.elevation < cur.elevation && (!best || l.elevation > best.elevation)) best = l;
  }
  return best;
}

export function drawWallsPass(ctx, vp, lv, T, opts = {}) {
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 6;
  ctx.beginPath();
  for (const polys of lv.outlinesByWall.values()) for (const poly of polys) pathPoly(ctx, poly);
  ctx.strokeStyle = opts.line || T.planWallLine;
  ctx.lineWidth = vp.px(opts.lineWidth || 2.4);
  ctx.stroke();
  ctx.fillStyle = opts.fill || T.planWall;
  ctx.fill();
}

export function drawOpening(ctx, vp, g, o, s0, s1, T, selected) {
  const { path, half } = g;
  const ink = selected ? T.planAccent : T.planInk;
  const thin = vp.px(1);
  const w = dist(path.pointAt(s0), path.pointAt(s1));
  const sigma = (o.swing ?? 1) >= 0 ? 1 : -1;
  ctx.strokeStyle = ink;
  ctx.lineWidth = thin;
  ctx.setLineDash([]);
  if (selected) {
    ctx.save();
    ctx.fillStyle = T.planAccentFill;
    ctx.beginPath();
    strokeRun(ctx, path, s0, s1, half);
    const p = path.offsetAt(s1, -half);
    ctx.lineTo(p.x, p.y);
    const ss = path.samples(s1, s0);
    for (const s of ss) {
      const q = path.offsetAt(s, -half);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (o.kind === 'window') {
    ctx.beginPath();
    strokeRun(ctx, path, s0, s1, half);
    strokeRun(ctx, path, s0, s1, -half);
    ctx.stroke();
    ctx.strokeStyle = selected ? T.planAccent : T.planGlass;
    ctx.lineWidth = vp.px(1.3);
    ctx.beginPath();
    const style = o.style || 'casement';
    if (style === 'sliding') {
      const k = 0.56 * (s1 - s0);
      strokeRun(ctx, path, s0, s0 + k, half * 0.22);
      strokeRun(ctx, path, s1 - k, s1, -half * 0.22);
    } else if (style === 'double-hung') {
      strokeRun(ctx, path, s0, s1, half * 0.15);
      strokeRun(ctx, path, s0, s1, -half * 0.15);
    } else {
      strokeRun(ctx, path, s0, s1, 0);
      if (style === 'casement' || style === 'awning') {
        ctx.stroke();
        ctx.strokeStyle = ink;
        ctx.lineWidth = thin * 0.8;
        ctx.beginPath();
        strokeRun(ctx, path, s0, s1, half * 0.45);
        strokeRun(ctx, path, s0, s1, -half * 0.45);
      }
    }
    ctx.stroke();
    // sill nibs at the jambs
    ctx.strokeStyle = ink;
    ctx.lineWidth = thin;
    return;
  }
  const style = o.kind === 'opening' ? 'opening' : o.style || 'single';
  if (style === 'opening') {
    ctx.setLineDash([vp.px(5), vp.px(4)]);
    ctx.beginPath();
    strokeRun(ctx, path, s0, s1, half);
    strokeRun(ctx, path, s0, s1, -half);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const leaf = (sh, so, width) => {
    const H = path.offsetAt(sh, sigma * half);
    const C = path.offsetAt(so, sigma * half);
    const n = path.normalAt(sh);
    const O = addScaled(H, n, sigma * width);
    ctx.lineWidth = vp.px(2.2);
    ctx.beginPath();
    ctx.moveTo(H.x, H.y);
    ctx.lineTo(O.x, O.y);
    ctx.stroke();
    const a0 = Math.atan2(C.y - H.y, C.x - H.x);
    const a1 = Math.atan2(O.y - H.y, O.x - H.x);
    const sweep = normAngle(a1 - a0);
    ctx.lineWidth = thin * 0.9;
    ctx.beginPath();
    ctx.arc(H.x, H.y, width, a0, a0 + sweep, sweep < 0);
    ctx.stroke();
  };
  switch (style) {
    case 'double': {
      const sm = (s0 + s1) / 2;
      leaf(s0, sm, w / 2);
      leaf(s1, sm, w / 2);
      break;
    }
    case 'sliding': {
      const k = 0.56 * (s1 - s0);
      const t = Math.max(vp.px(2), Math.min(30, half * 0.25));
      const panel = (a, b, off) => {
        const p0 = path.offsetAt(a, off + t), p1 = path.offsetAt(b, off + t), p2 = path.offsetAt(b, off - t), p3 = path.offsetAt(a, off - t);
        ctx.beginPath();
        pathPoly(ctx, [p0, p1, p2, p3]);
        ctx.stroke();
      };
      ctx.lineWidth = thin;
      panel(s0, s0 + k, half * 0.3);
      panel(s1 - k, s1, -half * 0.3);
      break;
    }
    case 'pocket': {
      const t = Math.max(vp.px(2), Math.min(25, half * 0.2));
      const pa = Math.max(g.sMin, s0 - w * 0.95);
      ctx.lineWidth = thin;
      ctx.setLineDash([vp.px(4), vp.px(3)]);
      ctx.beginPath();
      pathPoly(ctx, [path.offsetAt(pa, t), path.offsetAt(s0, t), path.offsetAt(s0, -t), path.offsetAt(pa, -t)]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      pathPoly(ctx, [path.offsetAt(s0, t), path.offsetAt(s0 + w * 0.12, t), path.offsetAt(s0 + w * 0.12, -t), path.offsetAt(s0, -t)]);
      ctx.stroke();
      break;
    }
    case 'bifold': {
      const sm = (s0 + s1) / 2;
      ctx.lineWidth = vp.px(1.8);
      for (const [a, b] of [[s0, sm], [s1, sm]]) {
        const A = path.offsetAt(a, sigma * half);
        const B = path.offsetAt(b, sigma * half);
        const q = (a + b) / 2;
        const n = path.normalAt(q);
        const P = addScaled(path.offsetAt(q, sigma * half), n, sigma * Math.abs(b - a) * 0.42);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(P.x, P.y);
        ctx.lineTo(addScaled(B, n, sigma * Math.abs(b - a) * 0.05).x, addScaled(B, n, sigma * Math.abs(b - a) * 0.05).y);
        ctx.stroke();
      }
      break;
    }
    case 'garage': {
      ctx.lineWidth = thin;
      ctx.setLineDash([vp.px(8), vp.px(5)]);
      ctx.beginPath();
      strokeRun(ctx, path, s0, s1, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      strokeRun(ctx, path, s0, s1, sigma * half * 0.7);
      ctx.stroke();
      break;
    }
    default: {
      const sh = o.hinge === 'end' ? s1 : s0;
      const so = o.hinge === 'end' ? s0 : s1;
      leaf(sh, so, w);
    }
  }
}

function drawSectionMarker(ctx, vp, s, T, selected, label) {
  const A = vp.w2s(s.a), B = vp.w2s(s.b);
  const d = norm(sub(s.b, s.a));
  const look = perp(d);
  const k = s.flip ? -1 : 1;
  const lookS = { x: look.x * k, y: -look.y * k }; // screen direction
  const color = selected ? T.planAccent : T.planSection;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([18, 5, 3, 5]);
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const P of [A, B]) {
    ctx.beginPath();
    ctx.arc(P.x, P.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = T.planBg;
    ctx.fill();
    ctx.stroke();
    // arrow pointing in the view direction
    ctx.fillStyle = color;
    ctx.beginPath();
    const tip = { x: P.x + lookS.x * 22, y: P.y + lookS.y * 22 };
    const side = { x: -lookS.y, y: lookS.x };
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(P.x + side.x * 11 + lookS.x * 6, P.y + side.y * 11 + lookS.y * 6);
    ctx.lineTo(P.x - side.x * 11 + lookS.x * 6, P.y - side.y * 11 + lookS.y * 6);
    ctx.closePath();
    ctx.fill();
    haloText(ctx, label, P.x, P.y + 0.5, { font: `600 12px ${T.fontUI}`, color });
  }
  ctx.restore();
}

function drawCamera(ctx, vp, v, T, selected) {
  const P = vp.w2s(v.pos), Q = vp.w2s(v.target);
  const dx = Q.x - P.x, dy = Q.y - P.y;
  const ang = Math.atan2(dy, dx);
  const fov = ((v.fov || 55) * Math.PI) / 180;
  const color = selected ? T.planAccent : T.planGuide;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.3;
  const r = 46;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(P.x, P.y);
  ctx.arc(P.x, P.y, r, ang - fov / 2, ang + fov / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.translate(P.x, P.y);
  ctx.rotate(ang);
  ctx.fillStyle = T.planBg;
  ctx.beginPath();
  ctx.rect(-14, -7, 16, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(2, -3);
  ctx.lineTo(9, -7);
  ctx.lineTo(9, 7);
  ctx.lineTo(2, 3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  haloText(ctx, v.name || 'View', P.x, P.y + 18, { font: `500 11px ${T.fontUI}`, color, halo: T.planBg, baseline: 'top' });
}

export function dimGeometry(d) {
  const dir = norm(sub(d.b, d.a));
  const n = perp(dir);
  const off = d.offset || 0;
  return { dir, n, a2: addScaled(d.a, n, off), b2: addScaled(d.b, n, off), length: dist(d.a, d.b) };
}

export function drawDimension(ctx, vp, d, T, units, selected, halo) {
  const { n, a2, b2, length } = dimGeometry(d);
  if (length < 1) return;
  const color = selected ? T.planAccent : T.planDim;
  const A = vp.w2s(d.a), B = vp.w2s(d.b), A2 = vp.w2s(a2), B2 = vp.w2s(b2);
  const ns = { x: n.x, y: -n.y };
  const sgn = Math.sign(d.offset || 1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // extension lines with a small gap at the object and overshoot past the dimension line
  const ext = (P, P2) => {
    const len = Math.hypot(P2.x - P.x, P2.y - P.y);
    if (len < 4) return;
    const ux = (P2.x - P.x) / len, uy = (P2.y - P.y) / len;
    ctx.moveTo(P.x + ux * 4, P.y + uy * 4);
    ctx.lineTo(P2.x + ux * 5, P2.y + uy * 5);
  };
  ext(A, A2);
  ext(B, B2);
  ctx.moveTo(A2.x, A2.y);
  ctx.lineTo(B2.x, B2.y);
  ctx.stroke();
  // architectural ticks
  const dx = B2.x - A2.x, dy = B2.y - A2.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const tx = (ux - uy) * 5, ty = (uy + ux) * 5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const P of [A2, B2]) {
    ctx.moveTo(P.x - tx, P.y - ty);
    ctx.lineTo(P.x + tx, P.y + ty);
  }
  ctx.stroke();
  ctx.restore();
  const M = mid(A2, B2);
  const ang = uprightAngle(Math.atan2(dy, dx));
  const off = 8 * sgn;
  haloText(ctx, formatLength(length, units), M.x + ns.x * off, M.y + ns.y * off, {
    font: `500 12px ${T.fontDim}`,
    color,
    halo,
    angle: ang,
  });
}

/**
 * Render the plan for one level.
 * S: {model, derived, levelId, layers, theme, units, selection: Set, paper}
 */
export function renderPlan(ctx, vp, dpr, S) {
  const T = S.theme;
  const doc = S.model.doc;
  const units = S.units;
  const layers = S.layers;
  const sel = S.selection || new Set();
  const lv = S.derived.level(S.levelId);
  const halo = T.planBg;

  vp.applyScreen(ctx, dpr);
  ctx.fillStyle = T.planBg;
  ctx.fillRect(0, 0, vp.w, vp.h);
  if (layers.grid && !S.paper) drawGrid(ctx, vp, dpr, T, units);

  vp.applyWorld(ctx, dpr);

  // Level below as a faint underlay.
  if (layers.underlay) {
    const below = levelBelow(doc, S.levelId);
    if (below) {
      const lb = S.derived.level(below.id);
      ctx.beginPath();
      for (const polys of lb.outlinesByWall.values()) for (const poly of polys) pathPoly(ctx, poly);
      ctx.strokeStyle = T.planUnderlay;
      ctx.lineWidth = vp.px(1);
      ctx.setLineDash([vp.px(6), vp.px(4)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Room fills.
  if (layers.rooms) {
    for (const r of lv.rooms) {
      const selected = sel.has(r.tag?.id);
      ctx.beginPath();
      pathPoly(ctx, r.poly);
      ctx.globalAlpha = selected ? 0.2 : parseFloat(T.planRoomAlpha) || 0.32;
      ctx.fillStyle = selected ? T.planAccent : r.tag?.color || T.planRoom;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Walls: stroke all outlines double width, then fill, so joined walls read as one mass.
  drawWallsPass(ctx, vp, lv, T);

  // Selected walls.
  const selWalls = lv.walls.filter((w) => sel.has(w.id));
  if (selWalls.length) {
    ctx.beginPath();
    for (const w of selWalls) for (const poly of lv.outlinesByWall.get(w.id) || []) pathPoly(ctx, poly);
    ctx.fillStyle = T.planAccentFill;
    ctx.fill();
    ctx.strokeStyle = T.planAccent;
    ctx.lineWidth = vp.px(1.6);
    ctx.stroke();
  }

  // Doors and windows.
  for (const [wid, list] of lv.openingsByWall) {
    const g = lv.geoms.get(wid);
    for (const { o, s0, s1 } of list) drawOpening(ctx, vp, g, o, s0, s1, T, sel.has(o.id));
  }

  // Roofs: dashed eave line and ridge/hip lines (they are above the cut plane).
  if (layers.roofs) {
    for (const roof of doc.roofs) {
      if (roof.level !== S.levelId) continue;
      const g = S.derived.roof(roof);
      if (!g) continue;
      const selected = sel.has(roof.id);
      ctx.save();
      ctx.globalAlpha = selected ? 1 : 0.75;
      ctx.strokeStyle = selected ? T.planAccent : T.planRoof;
      ctx.lineWidth = vp.px(selected ? 1.8 : 1.2);
      ctx.setLineDash([vp.px(10), vp.px(5)]);
      ctx.beginPath();
      pathPoly(ctx, g.outline);
      ctx.stroke();
      ctx.setLineDash(selected ? [] : [vp.px(3), vp.px(3)]);
      ctx.lineWidth = vp.px(selected ? 1.4 : 0.9);
      ctx.beginPath();
      for (const [a, b] of g.lines.ridges) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (selected) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = T.planAccent;
        ctx.beginPath();
        pathPoly(ctx, g.outline);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---- Screen-space annotations ----
  vp.applyScreen(ctx, dpr);

  // Wall length labels.
  if (layers.wallDims) {
    ctx.save();
    for (const g of lv.geoms.values()) {
      const path = g.path;
      const L = path.length;
      if (L * vp.scale < 46) continue;
      const m = path.pointAt(L / 2), n = path.normalAt(L / 2);
      const probeL = addScaled(m, n, g.half + 300), probeR = addScaled(m, n, -g.half - 300);
      const inL = lv.rooms.some((r) => pointInPolygon(probeL, r.poly));
      const inR = lv.rooms.some((r) => pointInPolygon(probeR, r.poly));
      const side = inL && !inR ? -1 : 1;
      const P = vp.w2s(addScaled(m, n, side * g.half));
      const ns = { x: n.x * side, y: -n.y * side };
      const t = path.tangentAt(L / 2);
      const ang = uprightAngle(Math.atan2(-t.y, t.x));
      const selected = sel.has(g.wall.id);
      haloText(ctx, formatLength(L, units), P.x + ns.x * 10, P.y + ns.y * 10, {
        font: `${selected ? 600 : 500} 11px ${T.fontDim}`,
        color: selected ? T.planAccent : T.planMuted,
        halo,
        angle: ang,
      });
    }
    ctx.restore();
  }

  // User dimensions.
  if (layers.dims) {
    for (const d of doc.dims) if (d.level === S.levelId) drawDimension(ctx, vp, d, T, units, sel.has(d.id), halo);
  }

  // Free text.
  for (const t of doc.texts) {
    if (t.level !== S.levelId) continue;
    const P = vp.w2s(t);
    const px = Math.max(6, (t.size || 300) * vp.scale);
    if (px < 5) continue;
    haloText(ctx, t.text || 'Text', P.x, P.y, {
      font: `500 ${px.toFixed(1)}px ${T.fontUI}`,
      color: sel.has(t.id) ? T.planAccent : T.planInk,
      halo,
      angle: -((t.angle || 0) * Math.PI) / 180,
    });
  }

  // Room names and areas.
  if (layers.rooms) {
    for (const r of lv.rooms) {
      const tag = r.tag;
      if (!tag) continue;
      const bb = r.poly.reduce(
        (b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      const wpx = (bb.maxX - bb.minX) * vp.scale, hpx = (bb.maxY - bb.minY) * vp.scale;
      if (wpx < 40 || hpx < 26) continue;
      const P = vp.w2s(tag);
      const selected = sel.has(tag.id);
      const big = wpx > 110 && hpx > 54;
      haloText(ctx, tag.name || 'Room', P.x, P.y - (big ? 8 : 0), {
        font: `600 ${big ? 13 : 11}px ${T.fontUI}`,
        color: selected ? T.planAccent : T.planInk,
        halo,
      });
      if (big) {
        haloText(ctx, formatArea(r.netArea, units), P.x, P.y + 9, {
          font: `500 11.5px ${T.fontDim}`,
          color: T.planMuted,
          halo,
        });
      }
    }
  }

  if (layers.sections) {
    doc.sections.forEach((s, i) => {
      const label = /\b([A-Z0-9]{1,3})$/.exec(s.name || '')?.[1] || String.fromCharCode(65 + (i % 26));
      drawSectionMarker(ctx, vp, s, T, sel.has(s.id), label);
    });
  }
  if (layers.cameras) {
    for (const v of doc.views) if (v.pos && v.target) drawCamera(ctx, vp, v, T, sel.has(v.id));
  }
}
