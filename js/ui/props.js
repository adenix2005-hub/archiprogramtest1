// Properties panel: edits the selection, or shows tool options and project /
// level settings when nothing is selected.

import { buildFields } from './form.js';
import { wallPath } from '../geom/path.js';
import { setWallLength, setWallAngle, flipWall, splitWall } from '../core/ops.js';
import { DOOR_STYLES, WINDOW_STYLES } from '../plan/tools/opening.js';
import { ROOF_KINDS, roofFootprint, autoGableEdges, defaultShedEdge } from '../geom/roof.js';
import { UNITS, isMetric, pitchToRiseRun } from '../core/units.js';
import { dist } from '../core/vec.js';

export const ROOM_COLORS = ['#d9c7a7', '#cfc2b0', '#e3d3c4', '#c9d6dc', '#d6d9c5', '#bfcfc4', '#c8c2d6', '#e0c9c0', '#d0d0cc'];
export const WALL_COLORS = ['#f2f0eb', '#e8e1d5', '#d8cfc0', '#b8b8b4', '#9c5b45', '#7d8a93', '#e9e4cf'];
export const ROOF_COLORS = ['#55595e', '#8a4b3a', '#6b7b8c', '#9a9a90', '#4f5d4c', '#b08d6a', '#2f3337'];

const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));

function thicknessPresets(app) {
  return isMetric(app.units) ? [90, 110, 150, 200, 230, 250, 300] : [3.5, 4.5, 5.5, 6, 8, 10, 12].map((i) => i * 25.4);
}

export class PropsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.fields = {};
  }

  focusField(key) {
    this.app.ui.showPanel('props');
    requestAnimationFrame(() => {
      const f = this.fields[key];
      const input = f?.querySelector('input,select,textarea');
      if (input) {
        input.focus();
        input.select?.();
      }
    });
  }

  commit(label) {
    this.app.model.commit(label);
  }

  render() {
    const app = this.app;
    if (document.activeElement && this.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') {
      // Don't rebuild under the user's caret; re-render after they finish.
      this.pending = true;
      return;
    }
    this.pending = false;
    const ids = [...app.selection];
    let fields;
    if (!ids.length) fields = this.noSelection();
    else if (ids.length === 1) fields = this.single(ids[0]);
    else fields = this.multi(ids);
    this.fields = buildFields(app, this.el, fields);
  }

  /* ---------- nothing selected ---------- */

  noSelection() {
    const app = this.app;
    const doc = app.model.doc;
    const lv = app.level;
    const F = [];
    F.push(...this.toolOptions());
    F.push({ type: 'header', label: 'Level', icon: 'level' });
    F.push({ type: 'text', key: 'levelName', label: 'Name', value: lv.name, onChange: (v) => { lv.name = v || lv.name; this.commit('Rename level'); } });
    F.push({ type: 'length', label: 'Floor height', value: lv.elevation, hint: 'Height of this floor above the ground floor', onChange: (v) => { lv.elevation = v; this.commit('Level elevation'); } });
    F.push({ type: 'length', label: 'Wall height', value: lv.height, min: 500, hint: 'Default height for walls and roofs on this level', onChange: (v) => {
      const old = lv.height;
      lv.height = v;
      for (const w of doc.walls) if (w.level === lv.id && Math.abs(w.height - old) < 1) w.height = v;
      this.commit('Level height');
    } });
    F.push({ type: 'header', label: 'Project', icon: 'folder' });
    F.push({ type: 'text', label: 'Name', value: doc.name, onChange: (v) => { doc.name = v || 'Untitled plan'; this.commit('Rename project'); } });
    F.push({ type: 'select', label: 'Units', value: doc.settings.units, options: Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label })), onChange: (v) => {
      doc.settings.units = v;
      this.commit('Units');
      app.plan.invalidate();
    } });
    const stats = this.stats();
    F.push({ type: 'readonly', label: 'Walls', value: String(stats.walls) });
    F.push({ type: 'readonly', label: 'Floor area (this level)', value: app.fmtArea(stats.area) });
    return F;
  }

  stats() {
    const app = this.app;
    const lv = app.derived.level(app.activeLevel);
    return { walls: lv.walls.length, area: lv.rooms.reduce((s, r) => s + r.netArea, 0) };
  }

  toolOptions() {
    const app = this.app;
    const t = app.toolName;
    const o = app.toolOptions;
    const F = [];
    const wallOpts = () => {
      F.push({ type: 'length', label: 'Wall thickness', value: o.wall.thickness, min: 20, onChange: (v) => { o.wall.thickness = v; app.refreshTool(); } });
      F.push({ type: 'length', label: 'Wall height', value: o.wall.height, min: 100, onChange: (v) => { o.wall.height = v; app.refreshTool(); } });
    };
    switch (t) {
      case 'wall':
      case 'arc':
        F.push({ type: 'header', label: t === 'arc' ? 'Curved wall tool' : 'Wall tool', icon: t });
        wallOpts();
        if (t === 'wall') {
          F.push({ type: 'segmented', label: 'Draw along', value: o.wall.location, options: [
            { value: 'center', label: 'Centre' },
            { value: 'left', label: 'Left face' },
            { value: 'right', label: 'Right face' },
          ], onChange: (v) => { o.wall.location = v; app.refreshTool(); } });
          F.push({ type: 'note', label: 'Type a length then Enter while drawing (3600, 3.6m, 3600<45, @1200,0). Hold Shift or press F8 for ortho.' });
        }
        break;
      case 'rect':
        F.push({ type: 'header', label: 'Room tool', icon: 'rect' });
        wallOpts();
        F.push({ type: 'segmented', label: 'Rectangle is', value: o.rect.location, options: [
          { value: 'center', label: 'Wall centres' },
          { value: 'inside', label: 'Inside faces' },
          { value: 'outside', label: 'Outside faces' },
        ], onChange: (v) => { o.rect.location = v; app.refreshTool(); } });
        break;
      case 'sketch':
        F.push({ type: 'header', label: 'Sketch tool', icon: 'sketch' });
        wallOpts();
        F.push({ type: 'segmented', label: 'Straighten angles to', value: o.sketch.angleSnap, options: [
          { value: 90, label: '90°' },
          { value: 45, label: '45°' },
          { value: 15, label: '15°' },
          { value: 0, label: 'Off' },
        ], onChange: (v) => { o.sketch.angleSnap = v; app.refreshTool(); } });
        F.push({ type: 'toggle', label: 'Recognise curves', value: o.sketch.curves, onChange: (v) => { o.sketch.curves = v; app.refreshTool(); } });
        F.push({ type: 'toggle', label: 'Tidy to round sizes', value: o.sketch.tidy, onChange: (v) => { o.sketch.tidy = v; app.refreshTool(); } });
        F.push({ type: 'note', label: 'Draw a whole room in one stroke and finish near the start to close it. Draw a circle for a round room.' });
        break;
      case 'door':
        F.push({ type: 'header', label: 'Door tool', icon: 'door' });
        F.push({ type: 'select', label: 'Style', value: o.door.style, options: opts(DOOR_STYLES), onChange: (v) => {
          o.door.style = v;
          if (v === 'double' && o.door.width < 1200) o.door.width = 1640;
          if (v === 'garage') {
            o.door.width = Math.max(o.door.width, 2400);
            o.door.height = Math.max(o.door.height, 2100);
          }
          app.refreshTool();
        } });
        F.push({ type: 'length', label: 'Width', value: o.door.width, min: 300, onChange: (v) => { o.door.width = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Height', value: o.door.height, min: 300, onChange: (v) => { o.door.height = v; app.refreshTool(); } });
        break;
      case 'window':
        F.push({ type: 'header', label: 'Window tool', icon: 'window' });
        F.push({ type: 'select', label: 'Style', value: o.window.style, options: opts(WINDOW_STYLES), onChange: (v) => { o.window.style = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Width', value: o.window.width, min: 200, onChange: (v) => { o.window.width = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Height', value: o.window.height, min: 200, onChange: (v) => { o.window.height = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Sill height', value: o.window.sill, min: 0, onChange: (v) => { o.window.sill = v; app.refreshTool(); } });
        break;
      case 'opening':
        F.push({ type: 'header', label: 'Opening tool', icon: 'opening' });
        F.push({ type: 'length', label: 'Width', value: o.opening.width, min: 200, onChange: (v) => { o.opening.width = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Height', value: o.opening.height, min: 300, onChange: (v) => { o.opening.height = v; app.refreshTool(); } });
        break;
      case 'roof':
        F.push({ type: 'header', label: 'Roof tool', icon: 'roof' });
        F.push({ type: 'segmented', label: 'Type', value: o.roof.kind, options: Object.keys(ROOF_KINDS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), onChange: (v) => { o.roof.kind = v; app.refreshTool(); } });
        F.push({ type: 'angle', label: 'Pitch', value: o.roof.pitch, min: 0, max: 75, hint: 'Degrees, or rise:run such as 6:12', onChange: (v) => { o.roof.pitch = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Overhang', value: o.roof.overhang, min: 0, onChange: (v) => { o.roof.overhang = v; app.refreshTool(); } });
        F.push({ type: 'length', label: 'Thickness', value: o.roof.thickness, min: 20, onChange: (v) => { o.roof.thickness = v; app.refreshTool(); } });
        F.push({ type: 'buttons', buttons: [{ label: 'Auto roof over walls', icon: 'roof', primary: true, run: () => app.runCommand('autoroof') }] });
        break;
      case 'offset':
        F.push({ type: 'header', label: 'Offset tool', icon: 'offset' });
        F.push({ type: 'length', label: 'Distance', value: o.offset.distance, min: 1, onChange: (v) => { o.offset.distance = v; app.refreshTool(); } });
        break;
      case 'mirror':
        F.push({ type: 'header', label: 'Mirror tool', icon: 'mirror' });
        F.push({ type: 'toggle', label: 'Keep the original', value: o.mirror.keep, onChange: (v) => { o.mirror.keep = v; app.refreshTool(); } });
        break;
      default:
        F.push({ type: 'header', label: 'Nothing selected', icon: 'select' });
        F.push({ type: 'note', label: 'Tap a wall, door, window, room or roof to edit it here. Double-tap a wall to select every wall joined to it.' });
    }
    return F;
  }

  /* ---------- single selection ---------- */

  single(id) {
    const app = this.app;
    const el = app.model.get(id);
    const kind = app.model.kind(id);
    if (!el) return [];
    switch (kind) {
      case 'wall':
        return this.wallFields([el]);
      case 'opening':
        return this.openingFields(el);
      case 'room':
        return this.roomFields(el);
      case 'roof':
        return this.roofFields(el);
      case 'dim':
        return this.dimFields(el);
      case 'text':
        return this.textFields(el);
      case 'section':
        return this.sectionFields(el);
      case 'view':
        return this.viewFields(el);
    }
    return [];
  }

  deleteButton(ids, label = 'Delete') {
    return { label, icon: 'trash', danger: true, run: () => this.app.deleteIds(ids) };
  }

  wallFields(walls) {
    const app = this.app;
    const doc = app.model.doc;
    const F = [];
    const single = walls.length === 1;
    const w = walls[0];
    F.push({ type: 'header', label: single ? 'Wall' : `${walls.length} walls`, icon: 'wall' });
    if (single) {
      const path = wallPath(w);
      F.push({ type: 'length', key: 'length', label: 'Length', value: path.length, min: 10, onChange: (v) => { setWallLength(doc, w, v); this.commit('Wall length'); } });
      const ang = (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
      F.push({ type: 'angle', label: 'Angle', value: ((ang % 360) + 360) % 360, hint: '0° points right (east), 90° up (north)', onChange: (v) => { setWallAngle(doc, w, v); this.commit('Wall angle'); } });
    }
    F.push({ type: 'length', label: 'Thickness', value: single ? w.thickness : null, placeholder: single ? '' : 'mixed', min: 20, onChange: (v) => { walls.forEach((x) => (x.thickness = v)); this.commit('Wall thickness'); } });
    const presets = thicknessPresets(app);
    F.push({
      type: 'buttons',
      buttons: presets.map((p) => ({ label: app.fmt(p), title: `Set thickness to ${app.fmt(p)}`, run: () => { walls.forEach((x) => (x.thickness = p)); this.commit('Wall thickness'); } })),
    });
    F.push({ type: 'length', label: 'Height', value: single ? w.height : null, placeholder: single ? '' : 'mixed', min: 100, onChange: (v) => { walls.forEach((x) => { x.height = v; if (x.heightEnd != null && single) return; }); this.commit('Wall height'); } });
    if (single) {
      const sloped = w.heightEnd != null;
      F.push({ type: 'toggle', label: 'Sloped (raked) top', value: sloped, onChange: (v) => { w.heightEnd = v ? w.height + 600 : null; this.commit('Raked wall'); } });
      if (sloped) F.push({ type: 'length', label: 'Height at end', value: w.heightEnd, min: 100, onChange: (v) => { w.heightEnd = v; this.commit('Raked wall'); } });
      const path = wallPath(w);
      F.push({ type: 'segmented', label: 'Shape', value: path.isArc ? 'curved' : 'straight', options: [
        { value: 'straight', label: 'Straight', icon: 'wall' },
        { value: 'curved', label: 'Curved', icon: 'arc' },
      ], onChange: (v) => {
        if (v === 'straight') w.bulge = 0;
        else w.bulge = Math.round(dist(w.a, w.b) * 0.2);
        this.commit(v === 'straight' ? 'Straighten wall' : 'Curve wall');
      } });
      if (path.isArc) {
        const chord = dist(w.a, w.b);
        F.push({ type: 'length', label: 'Curve depth', value: Math.abs(w.bulge), min: 1, hint: 'Distance from the straight line to the middle of the curve', onChange: (v) => { w.bulge = Math.sign(w.bulge || 1) * v; this.commit('Curve depth'); } });
        F.push({ type: 'length', label: 'Radius', value: path.radius, min: chord / 2, onChange: (r) => {
          const k = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
          w.bulge = Math.sign(w.bulge || 1) * (Math.abs(w.bulge) > chord / 2 ? r + k : r - k);
          this.commit('Wall radius');
        } });
        F.push({ type: 'buttons', buttons: [
          { label: 'Bulge other way', icon: 'flip', run: () => { w.bulge = -w.bulge; this.commit('Flip curve'); } },
          { label: 'Semicircle', icon: 'arc', run: () => { w.bulge = Math.sign(w.bulge || 1) * chord / 2; this.commit('Semicircle'); } },
        ] });
      }
      F.push({ type: 'length', label: 'Base offset', value: w.baseOffset || 0, hint: 'Raise the bottom of the wall above the floor', onChange: (v) => { w.baseOffset = v; this.commit('Wall base'); } });
    }
    F.push({ type: 'color', label: 'Colour (3D)', value: single ? w.color : null, swatches: WALL_COLORS, allowNone: true, onChange: (v) => { walls.forEach((x) => (x.color = v)); this.commit('Wall colour'); } });
    const buttons = [];
    if (single) {
      buttons.push({ label: 'Flip direction', icon: 'flip', run: () => { flipWall(doc, w); this.commit('Flip wall'); } });
      buttons.push({ label: 'Split in half', icon: 'split', run: () => {
        const w2 = splitWall(app.model, w, wallPath(w).length / 2);
        if (w2) {
          this.commit('Split wall');
          app.select([w.id, w2.id]);
        }
      } });
    }
    buttons.push(this.deleteButton(walls.map((x) => x.id)));
    F.push({ type: 'buttons', buttons });
    return F;
  }

  openingFields(o) {
    const app = this.app;
    const w = app.model.get(o.wall);
    const g = w ? app.derived.wallGeom(w) : null;
    const F = [];
    const title = o.kind === 'door' ? 'Door' : o.kind === 'window' ? 'Window' : 'Opening';
    F.push({ type: 'header', label: title, icon: o.kind === 'door' ? 'door' : o.kind === 'window' ? 'window' : 'opening' });
    F.push({ type: 'segmented', label: 'Type', value: o.kind, options: [
      { value: 'door', label: 'Door' },
      { value: 'window', label: 'Window' },
      { value: 'opening', label: 'Opening' },
    ], onChange: (v) => {
      o.kind = v;
      const s = app.model.settings;
      if (v === 'window') {
        o.style = 'casement';
        o.sill = s.windowSill;
        o.height = Math.min(o.height, s.windowHeight);
      } else {
        o.style = v === 'door' ? 'single' : 'opening';
        o.sill = 0;
        o.height = s.doorHeight;
      }
      this.commit('Change opening type');
    } });
    if (o.kind !== 'opening') {
      F.push({ type: 'select', label: 'Style', value: o.style, options: opts(o.kind === 'door' ? DOOR_STYLES : WINDOW_STYLES), onChange: (v) => { o.style = v; this.commit('Opening style'); } });
    }
    F.push({ type: 'length', label: 'Width', value: o.width, min: 100, onChange: (v) => { o.width = v; this.commit('Opening width'); } });
    F.push({ type: 'length', label: 'Height', value: o.height, min: 100, onChange: (v) => { o.height = v; this.commit('Opening height'); } });
    if (o.kind === 'window') F.push({ type: 'length', label: 'Sill height', value: o.sill || 0, min: 0, onChange: (v) => { o.sill = v; this.commit('Sill height'); } });
    if (g) {
      F.push({ type: 'length', label: 'From wall start', value: o.pos - o.width / 2 - g.sMin, min: 0, hint: 'Distance from the start of the wall to the edge of the opening', onChange: (v) => { o.pos = g.sMin + v + o.width / 2; this.commit('Opening position'); } });
      F.push({ type: 'buttons', buttons: [{ label: 'Centre on wall', icon: 'align', run: () => { o.pos = (g.sMin + g.sMax) / 2; this.commit('Centre opening'); } }] });
    }
    const buttons = [];
    if (o.kind !== 'opening') buttons.push({ label: o.kind === 'door' ? 'Swing other side' : 'Flip side', icon: 'flip', run: () => { o.swing = -(o.swing || 1); this.commit('Flip'); } });
    if (o.kind === 'door' && (o.style === 'single' || o.style === 'pocket' || !o.style)) buttons.push({ label: 'Flip hinge', icon: 'flip', run: () => { o.hinge = o.hinge === 'end' ? 'start' : 'end'; this.commit('Flip hinge'); } });
    buttons.push(this.deleteButton([o.id]));
    F.push({ type: 'buttons', buttons });
    return F;
  }

  roomFields(tag) {
    const app = this.app;
    const lv = app.derived.level(tag.level);
    const room = lv.rooms.find((r) => r.tag?.id === tag.id);
    const F = [];
    F.push({ type: 'header', label: 'Room', icon: 'rect' });
    F.push({ type: 'text', key: 'name', label: 'Name', value: tag.name, onChange: (v) => { tag.name = v || 'Room'; this.commit('Rename room'); } });
    F.push({ type: 'color', label: 'Floor colour', value: tag.color, swatches: ROOM_COLORS, allowNone: true, onChange: (v) => { tag.color = v; this.commit('Room colour'); } });
    if (room) {
      F.push({ type: 'readonly', label: 'Floor area', value: app.fmtArea(room.netArea) });
      F.push({ type: 'readonly', label: 'Area to wall centres', value: app.fmtArea(room.area) });
      F.push({ type: 'readonly', label: 'Perimeter', value: app.fmt(room.perimeter) });
    }
    F.push({ type: 'buttons', buttons: [
      { label: 'Select its walls', icon: 'wall', run: () => app.select([...new Set(room ? room.walls.map((w) => w.id) : [])]) },
      { label: 'Centre the label', icon: 'target', run: () => { tag.auto = true; this.commit('Centre label'); } },
    ] });
    F.push({ type: 'note', label: 'Rooms are found automatically from closed rings of walls.' });
    return F;
  }

  roofFields(roof) {
    const app = this.app;
    const F = [];
    F.push({ type: 'header', label: 'Roof', icon: 'roof' });
    F.push({ type: 'segmented', label: 'Type', value: roof.kind, options: Object.keys(ROOF_KINDS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), onChange: (v) => {
      roof.kind = v;
      roof.edges = null;
      this.commit('Roof type');
    } });
    if (roof.kind !== 'flat') {
      F.push({ type: 'angle', label: 'Pitch', value: roof.pitch, min: 1, max: 75, hint: 'Degrees, or rise:run such as 6:12', onChange: (v) => { roof.pitch = v; this.commit('Roof pitch'); } });
      if (!isMetric(app.units)) F.push({ type: 'readonly', label: 'Pitch (rise:run)', value: pitchToRiseRun(roof.pitch) });
    }
    F.push({ type: 'length', label: 'Overhang', value: roof.overhang, min: 0, onChange: (v) => { roof.overhang = v; this.commit('Roof overhang'); } });
    F.push({ type: 'length', label: 'Thickness', value: roof.thickness, min: 20, onChange: (v) => { roof.thickness = v; this.commit('Roof thickness'); } });
    const lv = app.model.level(roof.level);
    F.push({ type: 'length', label: 'Sits at height', value: roof.baseOffset ?? lv?.height, allowEmpty: true, hint: 'Height of the wall tops it sits on (empty = wall height of the level)', onChange: (v) => { roof.baseOffset = v; this.commit('Roof height'); } });
    const buttons = [];
    const pts = roofFootprint(roof.points);
    if (roof.kind === 'gable') buttons.push({ label: 'Rotate ridge', icon: 'rotate', run: () => {
      roof.rotate = !roof.rotate;
      roof.edges = null;
      if (!autoGableEdges(pts, roof.rotate).some(Boolean)) app.toast('No other ridge direction for this shape');
      this.commit('Rotate ridge');
    } });
    if (roof.kind === 'shed') buttons.push({ label: 'Next low side', icon: 'rotate', run: () => {
      const cur = Number.isInteger(roof.lowEdge) ? roof.lowEdge : defaultShedEdge(pts);
      roof.lowEdge = (cur + 1) % pts.length;
      roof.edges = null;
      this.commit('Shed direction');
    } });
    if (Array.isArray(roof.edges)) buttons.push({ label: 'Reset edges', icon: 'undo', run: () => { roof.edges = null; this.commit('Reset roof edges'); } });
    if (buttons.length) F.push({ type: 'buttons', buttons });
    if (roof.kind !== 'flat') F.push({ type: 'note', label: 'Tap the badges on the roof edges to switch each side between sloped and gable.' });
    F.push({ type: 'color', label: 'Colour', value: roof.color, swatches: ROOF_COLORS, allowNone: true, onChange: (v) => { roof.color = v; this.commit('Roof colour'); } });
    const g = app.derived.roof(roof);
    if (g) {
      const base = app.derived.roofBase(roof);
      F.push({ type: 'readonly', label: 'Ridge above wall tops', value: app.fmt(g.peak - base) });
    }
    F.push({ type: 'buttons', buttons: [this.deleteButton([roof.id])] });
    return F;
  }

  dimFields(d) {
    const F = [{ type: 'header', label: 'Dimension', icon: 'dim' }];
    F.push({ type: 'readonly', label: 'Measures', value: this.app.fmt(dist(d.a, d.b)) });
    F.push({ type: 'length', label: 'Offset', value: d.offset, onChange: (v) => { d.offset = v; this.commit('Dimension offset'); } });
    F.push({ type: 'buttons', buttons: [this.deleteButton([d.id])] });
    return F;
  }

  textFields(t) {
    const F = [{ type: 'header', label: 'Text', icon: 'text' }];
    F.push({ type: 'text', key: 'text', label: 'Text', value: t.text, onChange: (v) => { t.text = v; this.commit('Edit text'); } });
    F.push({ type: 'length', label: 'Text height', value: t.size || 250, min: 10, onChange: (v) => { t.size = v; this.commit('Text size'); } });
    F.push({ type: 'angle', label: 'Rotation', value: t.angle || 0, onChange: (v) => { t.angle = v; this.commit('Rotate text'); } });
    F.push({ type: 'buttons', buttons: [this.deleteButton([t.id])] });
    return F;
  }

  sectionFields(s) {
    const app = this.app;
    const F = [{ type: 'header', label: 'Section', icon: 'section' }];
    F.push({ type: 'text', key: 'name', label: 'Name', value: s.name, onChange: (v) => { s.name = v || 'Section'; this.commit('Rename section'); } });
    F.push({ type: 'length', label: 'View depth', value: s.depth || null, allowEmpty: true, placeholder: 'unlimited', hint: 'How far beyond the cut to show (empty = everything)', onChange: (v) => { s.depth = v || 0; this.commit('Section depth'); } });
    F.push({ type: 'buttons', buttons: [
      { label: 'Open view', icon: 'section', primary: true, run: () => app.openView({ type: 'section', id: s.id }) },
      { label: 'Look other way', icon: 'flip', run: () => { s.flip = !s.flip; this.commit('Flip section'); } },
      this.deleteButton([s.id]),
    ] });
    return F;
  }

  viewFields(v) {
    const app = this.app;
    const F = [{ type: 'header', label: 'Saved view', icon: 'camera' }];
    F.push({ type: 'text', key: 'name', label: 'Name', value: v.name, onChange: (x) => { v.name = x || 'View'; this.commit('Rename view'); } });
    if (v.pos) {
      F.push({ type: 'length', label: 'Eye height', value: v.pos.z, onChange: (x) => { const dz = x - v.pos.z; v.pos.z = x; v.target.z += dz; this.commit('Camera height'); } });
    }
    F.push({ type: 'number', label: 'Field of view', unit: '°', value: v.fov || 55, min: 15, max: 120, onChange: (x) => { v.fov = x; this.commit('Field of view'); } });
    F.push({ type: 'buttons', buttons: [
      { label: 'Open view', icon: 'cube', primary: true, run: () => app.openView({ type: 'saved', id: v.id }) },
      { label: 'Update from 3D', icon: 'camera', run: () => {
        const cam = app.view3d?.cameraState();
        if (!cam) {
          app.toast('Open the 3D model view first');
          return;
        }
        Object.assign(v, cam);
        this.commit('Update view');
      } },
      this.deleteButton([v.id]),
    ] });
    return F;
  }

  multi(ids) {
    const app = this.app;
    const walls = ids.map((id) => app.model.get(id)).filter((el, i) => el && app.model.kind(ids[i]) === 'wall');
    if (walls.length === ids.length) return this.wallFields(walls);
    const F = [{ type: 'header', label: `${ids.length} items selected`, icon: 'select' }];
    const counts = {};
    for (const id of ids) {
      const k = app.model.kind(id);
      counts[k] = (counts[k] || 0) + 1;
    }
    for (const [k, n] of Object.entries(counts)) F.push({ type: 'readonly', label: k[0].toUpperCase() + k.slice(1) + (n > 1 ? 's' : ''), value: String(n) });
    if (walls.length) {
      F.push({ type: 'length', label: 'Wall thickness', value: null, placeholder: 'mixed', min: 20, onChange: (v) => { walls.forEach((x) => (x.thickness = v)); this.commit('Wall thickness'); } });
      F.push({ type: 'length', label: 'Wall height', value: null, placeholder: 'mixed', min: 100, onChange: (v) => { walls.forEach((x) => (x.height = v)); this.commit('Wall height'); } });
    }
    F.push({ type: 'buttons', buttons: [
      { label: 'Move', icon: 'move', run: () => app.setTool('move') },
      { label: 'Copy', icon: 'copy', run: () => app.setTool('copy') },
      { label: 'Rotate', icon: 'rotate', run: () => app.setTool('rotate') },
      this.deleteButton(ids.filter((id) => app.model.kind(id) !== 'room')),
    ] });
    return F;
  }
}

