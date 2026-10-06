// Exporters: project JSON, plan PNG, plan SVG and plan DXF (AutoCAD R12 ASCII).

import { Viewport } from '../plan/viewport.js';
import { renderPlan, drawOpening, dimGeometry } from '../plan/render.js';
import { lightTheme } from '../plan/theme.js';
import { formatLength, formatArea } from '../core/units.js';
import { dist } from '../core/vec.js';

export function safeName(name) {
  return (name || 'plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'plan';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportJSON(app) {
  const doc = app.model.doc;
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(doc.name)}.lintel.json`);
}

/** Plan image on a white sheet. */
export function exportPlanPNG(app, { width = 1800, dpr = 2 } = {}) {
  const bb = app.derived.bounds(app.activeLevel) || app.derived.bounds();
  if (!bb) return Promise.resolve(null);
  const margin = 2500;
  const w = bb.maxX - bb.minX + 2 * margin, hgt = bb.maxY - bb.minY + 2 * margin;
  const vp = new Viewport();
  vp.w = width;
  vp.h = Math.round((width * hgt) / w);
  vp.scale = width / w;
  vp.cx = (bb.minX + bb.maxX) / 2;
  vp.cy = (bb.minY + bb.maxY) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = vp.w * dpr;
  canvas.height = vp.h * dpr;
  const ctx = canvas.getContext('2d');
  const theme = { ...lightTheme(), ...pickFonts(app), planBg: '#ffffff', planGrid: 'transparent' };
  renderPlan(ctx, vp, dpr, {
    model: app.model,
    derived: app.derived,
    levelId: app.activeLevel,
    layers: { ...app.prefs.layers, grid: false },
    theme,
    units: app.units,
    selection: new Set(),
    paper: true,
  });
  // title block
  vp.applyScreen(ctx, dpr);
  ctx.fillStyle = '#1d2427';
  ctx.font = `600 16px ${theme.fontUI}`;
  ctx.textBaseline = 'bottom';
  const lv = app.level;
  ctx.fillText(`${app.model.doc.name} · ${lv.name}`, 24, vp.h - 20);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function pickFonts(app) {
  const t = app.plan?.theme || {};
  return { fontUI: t.fontUI || 'sans-serif', fontDim: t.fontDim || 'sans-serif' };
}

/**
 * A tiny Canvas2D look-alike that records paths in world coordinates.
 * Used to reuse the door/window symbol drawing for SVG and DXF output.
 */
class PathRecorder {
  constructor() {
    this.items = [];
    this.cur = [];
    this.sub = null;
    this.lineDash = [];
    this.strokeStyle = '#000';
    this.fillStyle = '#000';
    this.lineWidth = 1;
    this.globalAlpha = 1;
  }
  save() {}
  restore() {}
  setLineDash(d) {
    this.lineDash = d;
  }
  beginPath() {
    this.cur = [];
    this.sub = null;
  }
  moveTo(x, y) {
    this.sub = { type: 'poly', pts: [{ x, y }], closed: false };
    this.cur.push(this.sub);
  }
  lineTo(x, y) {
    if (!this.sub || this.sub.type !== 'poly') this.moveTo(x, y);
    else this.sub.pts.push({ x, y });
  }
  closePath() {
    if (this.sub && this.sub.type === 'poly') this.sub.closed = true;
  }
  rect(x, y, w, h) {
    this.cur.push({ type: 'poly', pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true });
    this.sub = null;
  }
  arc(cx, cy, r, a0, a1, ccw) {
    this.cur.push({ type: 'arc', cx, cy, r, a0, a1, ccw: !!ccw });
    this.sub = null;
  }
  stroke() {
    for (const s of this.cur) this.items.push({ ...s, dashed: this.lineDash.length > 0, mode: 'stroke', layer: this.layer });
  }
  fill() {}
}

/** Collect the plan as primitive layers in world mm. */
function collectPlan(app) {
  const lv = app.derived.level(app.activeLevel);
  const doc = app.model.doc;
  const units = app.units;
  const out = { walls: [], symbols: [], texts: [], dims: [], roof: [], sections: [], rooms: [] };
  for (const polys of lv.outlinesByWall.values()) for (const p of polys) out.walls.push(p);
  const rec = new PathRecorder();
  const vpStub = { px: (n) => n * 8, scale: 1 / 8 };
  const theme = lightTheme();
  for (const [wid, list] of lv.openingsByWall) {
    const g = lv.geoms.get(wid);
    for (const { o, s0, s1 } of list) {
      rec.layer = o.kind === 'window' ? 'WINDOWS' : 'DOORS';
      drawOpening(rec, vpStub, g, o, s0, s1, theme, false);
    }
  }
  out.symbols = rec.items;
  for (const r of lv.rooms) {
    out.rooms.push(r.poly);
    if (r.tag) {
      out.texts.push({ x: r.tag.x, y: r.tag.y + 180, text: r.tag.name || 'Room', size: 250, layer: 'ROOMS' });
      out.texts.push({ x: r.tag.x, y: r.tag.y - 220, text: formatArea(r.netArea, units), size: 180, layer: 'ROOMS' });
    }
  }
  for (const d of doc.dims) {
    if (d.level !== app.activeLevel) continue;
    const g = dimGeometry(d);
    out.dims.push({ a: d.a, b: d.b, a2: g.a2, b2: g.b2, n: g.n, text: formatLength(dist(d.a, d.b), units) });
  }
  for (const t of doc.texts) if (t.level === app.activeLevel) out.texts.push({ x: t.x, y: t.y, text: t.text, size: t.size || 250, angle: t.angle || 0, layer: 'TEXT' });
  for (const r of doc.roofs) {
    if (r.level !== app.activeLevel) continue;
    const g = app.derived.roof(r);
    if (!g) continue;
    out.roof.push({ poly: g.outline, ridges: g.lines.ridges });
  }
  for (const s of doc.sections) out.sections.push(s);
  return out;
}

/* ---------- DXF ---------- */

export function exportDXF(app) {
  const P = collectPlan(app);
  const L = [];
  const add = (...pairs) => {
    for (let i = 0; i < pairs.length; i += 2) L.push(String(pairs[i]), String(pairs[i + 1]));
  };
  const n = (v) => (Math.round(v * 1000) / 1000).toString();
  const layers = [
    ['WALLS', 7],
    ['DOORS', 3],
    ['WINDOWS', 5],
    ['ROOMS', 2],
    ['DIMENSIONS', 1],
    ['ROOF', 30],
    ['TEXT', 7],
    ['SECTIONS', 1],
  ];
  add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
  add(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 2);
  add(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
  add(0, 'LTYPE', 2, 'DASHED', 70, 0, 3, 'Dashed', 72, 65, 73, 2, 40, 150, 49, 100, 49, -50);
  add(0, 'ENDTAB', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const [name, color] of layers) add(0, 'LAYER', 2, name, 70, 0, 62, color, 6, name === 'ROOF' ? 'DASHED' : 'CONTINUOUS');
  add(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');

  const poly = (pts, layer, closed = true, ltype = null) => {
    add(0, 'POLYLINE', 8, layer, 66, 1, 70, closed ? 1 : 0);
    if (ltype) add(6, ltype);
    for (const p of pts) add(0, 'VERTEX', 8, layer, 10, n(p.x), 20, n(p.y), 30, 0);
    add(0, 'SEQEND', 8, layer);
  };
  const line = (a, b, layer) => add(0, 'LINE', 8, layer, 10, n(a.x), 20, n(a.y), 30, 0, 11, n(b.x), 21, n(b.y), 31, 0);
  const text = (t, layer) => {
    add(0, 'TEXT', 8, layer, 10, n(t.x), 20, n(t.y), 30, 0, 40, n(t.size), 1, t.text.replace(/\n/g, ' '));
    if (t.angle) add(50, n(t.angle));
    add(72, 1, 11, n(t.x), 21, n(t.y), 31, 0);
  };

  for (const p of P.walls) poly(p, 'WALLS');
  for (const s of P.symbols) {
    const layer = s.layer || 'DOORS';
    if (s.type === 'poly') {
      if (s.pts.length >= 2) poly(s.pts, layer, s.closed, s.dashed ? 'DASHED' : null);
    } else {
      // DXF arcs are counter-clockwise from start to end angle (degrees).
      let a0 = (s.a0 * 180) / Math.PI, a1 = (s.a1 * 180) / Math.PI;
      if (s.ccw) [a0, a1] = [a1, a0];
      add(0, 'ARC', 8, layer, 10, n(s.cx), 20, n(s.cy), 30, 0, 40, n(s.r), 50, n(a0), 51, n(a1));
    }
  }
  for (const t of P.texts) text(t, t.layer);
  for (const d of P.dims) {
    line(d.a, d.a2, 'DIMENSIONS');
    line(d.b, d.b2, 'DIMENSIONS');
    line(d.a2, d.b2, 'DIMENSIONS');
    const mx = (d.a2.x + d.b2.x) / 2 + d.n.x * 120, my = (d.a2.y + d.b2.y) / 2 + d.n.y * 120;
    let ang = (Math.atan2(d.b2.y - d.a2.y, d.b2.x - d.a2.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    text({ x: mx, y: my, text: d.text, size: 180, angle: ang }, 'DIMENSIONS');
  }
  for (const r of P.roof) {
    poly(r.poly, 'ROOF', true, 'DASHED');
    for (const [a, b] of r.ridges) line(a, b, 'ROOF');
  }
  for (const s of P.sections) {
    line(s.a, s.b, 'SECTIONS');
    text({ x: s.a.x, y: s.a.y + 300, text: s.name, size: 250 }, 'SECTIONS');
  }
  add(0, 'ENDSEC', 0, 'EOF');
  const blob = new Blob([L.join('\r\n') + '\r\n'], { type: 'application/dxf' });
  downloadBlob(blob, `${safeName(app.model.doc.name)}-${safeName(app.level.name)}.dxf`);
}

/* ---------- SVG ---------- */

export function exportSVG(app) {
  const P = collectPlan(app);
  const bb = app.derived.bounds(app.activeLevel) || app.derived.bounds();
  if (!bb) return;
  const m = 1500;
  const x0 = bb.minX - m, w = bb.maxX - bb.minX + 2 * m, hh = bb.maxY - bb.minY + 2 * m;
  // SVG's Y axis points down; plans are Y-up.
  const X = (x) => (x - x0).toFixed(1);
  const Y = (y) => (bb.maxY + m - y).toFixed(1);
  const d = (pts, closed) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Y(p.y)}`).join('') + (closed ? 'Z' : '');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = [];
  // Printed size is 1:100 (1 mm on paper = 100 mm in the building).
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${hh.toFixed(0)}" width="${(w / 100).toFixed(1)}mm" height="${(hh / 100).toFixed(1)}mm">`);
  parts.push(`<title>${esc(app.model.doc.name)} · ${esc(app.level.name)}</title><desc>Floor plan, scale 1:100 when printed at the stated size. Drawing units are millimetres.</desc>`);
  parts.push('<rect width="100%" height="100%" fill="#fff"/>');
  parts.push(`<g fill="#d9d2c3" fill-opacity=".35" stroke="none">${P.rooms.map((p) => `<path d="${d(p, true)}"/>`).join('')}</g>`);
  parts.push(`<g fill="#3a3f44" stroke="#121518" stroke-width="12" stroke-linejoin="miter">${P.walls.map((p) => `<path d="${d(p, true)}"/>`).join('')}</g>`);
  parts.push(`<g fill="#3a3f44" stroke="none">${P.walls.map((p) => `<path d="${d(p, true)}"/>`).join('')}</g>`);
  const sym = [];
  for (const s of P.symbols) {
    const dash = s.dashed ? ' stroke-dasharray="40 30"' : '';
    if (s.type === 'poly') sym.push(`<path d="${d(s.pts, s.closed)}"${dash}/>`);
    else {
      const sx = s.cx + s.r * Math.cos(s.a0), sy = s.cy + s.r * Math.sin(s.a0);
      const ex = s.cx + s.r * Math.cos(s.a1), ey = s.cy + s.r * Math.sin(s.a1);
      let sweep = s.a1 - s.a0;
      if (s.ccw && sweep > 0) sweep -= 2 * Math.PI;
      if (!s.ccw && sweep < 0) sweep += 2 * Math.PI;
      const large = Math.abs(sweep) > Math.PI ? 1 : 0;
      const sweepFlag = sweep > 0 ? 0 : 1; // Y is flipped
      sym.push(`<path d="M${X(sx)} ${Y(sy)}A${s.r.toFixed(1)} ${s.r.toFixed(1)} 0 ${large} ${sweepFlag} ${X(ex)} ${Y(ey)}"/>`);
    }
  }
  parts.push(`<g fill="none" stroke="#121518" stroke-width="8">${sym.join('')}</g>`);
  parts.push(`<g fill="none" stroke="#8a5a2b" stroke-width="8">${P.roof.map((r) => `<path d="${d(r.poly, true)}" stroke-dasharray="80 40"/>${r.ridges.map(([a, b]) => `<path d="${d([a, b], false)}"/>`).join('')}`).join('')}</g>`);
  const dims = P.dims.map((dm) => {
    let ang = (Math.atan2(dm.b2.y - dm.a2.y, dm.b2.x - dm.a2.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const mx = (dm.a2.x + dm.b2.x) / 2 + dm.n.x * 120, my = (dm.a2.y + dm.b2.y) / 2 + dm.n.y * 120;
    return `<path d="${d([dm.a, dm.a2], false)}${d([dm.b, dm.b2], false)}${d([dm.a2, dm.b2], false)}"/><text x="${X(mx)}" y="${Y(my)}" transform="rotate(${(-ang).toFixed(2)} ${X(mx)} ${Y(my)})" text-anchor="middle" font-size="180" stroke="none" fill="#33424a">${esc(dm.text)}</text>`;
  });
  parts.push(`<g fill="none" stroke="#33424a" stroke-width="6" font-family="Barlow Semi Condensed, Arial Narrow, sans-serif">${dims.join('')}</g>`);
  parts.push(`<g font-family="Barlow, Arial, sans-serif" fill="#1d2427" text-anchor="middle">${P.texts.map((t) => `<text x="${X(t.x)}" y="${Y(t.y)}" font-size="${t.size}" dominant-baseline="middle"${t.angle ? ` transform="rotate(${-t.angle} ${X(t.x)} ${Y(t.y)})"` : ''}>${esc(t.text)}</text>`).join('')}</g>`);
  parts.push(`<text x="${(m / 2).toFixed(0)}" y="${(hh - m / 3).toFixed(0)}" font-family="Barlow, Arial, sans-serif" font-size="320" fill="#1d2427">${esc(app.model.doc.name)} · ${esc(app.level.name)} · 1:100</text>`);
  parts.push('</svg>');
  downloadBlob(new Blob([parts.join('\n')], { type: 'image/svg+xml' }), `${safeName(app.model.doc.name)}-${safeName(app.level.name)}.svg`);
}

/** Read a project file chosen by the user. */
export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        resolve(JSON.parse(String(r.result)));
      } catch {
        reject(new Error('That file is not a plan file (JSON).'));
      }
    };
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsText(file);
  });
}
