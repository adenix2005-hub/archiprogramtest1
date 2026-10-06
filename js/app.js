// Application controller: owns the model, selection, tools, views and UI.

import { Emitter } from './core/emitter.js';
import { Model, newDoc } from './core/model.js';
import { Derived } from './core/derived.js';
import * as storage from './core/storage.js';
import { sampleHouse } from './core/sample.js';
import { formatLength, formatArea, parseLength, parseAngle } from './core/units.js';
import { duplicate, flipWall, wallEndsAt } from './core/ops.js';
import { wallPath } from './geom/path.js';
import { PlanView } from './plan/planview.js';
import { pathPoly, dimGeometry } from './plan/render.js';
import { Snapper } from './plan/snap.js';
import { SelectTool } from './plan/tools/select.js';
import { WallTool, ArcWallTool, RectTool } from './plan/tools/wall.js';
import { SketchTool } from './plan/tools/sketch.js';
import { OpeningTool } from './plan/tools/opening.js';
import { RoofTool } from './plan/tools/roof.js';
import { DimensionTool, TextTool, SectionTool, CameraTool } from './plan/tools/annotate.js';
import { EraseTool, MoveTool, RotateTool, MirrorTool, OffsetTool, PanTool, SplitTool } from './plan/tools/modify.js';
import { COMMAND_BY_ID } from './commands.js';
import { UI } from './ui/ui.js';

const DEFAULT_PREFS = {
  theme: 'auto',
  layout: 'split',
  splitRatio: 0.55,
  layers: { grid: true, rooms: true, wallDims: true, dims: true, roofs: true, sections: true, cameras: true, underlay: true },
  snap: { object: true, grid: false, polar: true, polarStep: 15, align: true, ortho: false, lengthRound: true },
  penOnly: false,
  touchOffset: false,
  panelOpen: true,
  panelTab: 'props',
  view3d: { shadows: true, edges: true, style: 'shaded', sun: 0.35 },
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (k in base) out[k] = over[k];
  }
  return out;
}

export class App extends Emitter {
  constructor() {
    super();
    this.prefs = merge(DEFAULT_PREFS, storage.loadPrefs());
    this.selection = new Set();
    this.focusView = 'plan';
    this.view3d = null;
    this.view3dLoading = null;
    this.current3DView = { type: 'model' };
    this.firstRun = false;

    const currentId = storage.getCurrentId();
    let doc = currentId ? storage.loadProject(currentId) : null;
    if (doc) {
      this.projectId = currentId;
    } else {
      this.projectId = storage.newProjectId();
      doc = sampleHouse();
      this.firstRun = true;
    }
    try {
      this.model = new Model(doc);
    } catch (err) {
      console.error('Could not load project, starting fresh', err);
      this.model = new Model(newDoc());
    }
    this.derived = new Derived(this.model);
    this.activeLevel = this.model.doc.levels[0].id;
    this.initToolOptions();
  }

  initToolOptions() {
    const s = this.model.settings;
    this.toolOptions = {
      wall: { thickness: s.wallThickness, height: s.wallHeight, location: 'center' },
      rect: { location: 'center' },
      door: { style: 'single', width: s.doorWidth, height: s.doorHeight },
      window: { style: 'casement', width: s.windowWidth, height: s.windowHeight, sill: s.windowSill },
      opening: { style: 'opening', width: 900, height: s.doorHeight },
      roof: { kind: 'hip', pitch: s.roofPitch, overhang: s.roofOverhang, thickness: s.roofThickness },
      sketch: { angleSnap: 45, curves: true, tidy: true },
      offset: { distance: 1000 },
      mirror: { keep: true },
    };
  }

  init(root) {
    this.root = root;
    this.watchHostTheme();
    this.applyTheme();
    this.ui = new UI(this, root);
    this.plan = new PlanView(this, this.ui.planHost);
    this.snapper = new Snapper(this);
    this.tools = {
      select: new SelectTool(this),
      sketch: new SketchTool(this),
      wall: new WallTool(this),
      arc: new ArcWallTool(this),
      rect: new RectTool(this),
      door: new OpeningTool(this, 'door'),
      window: new OpeningTool(this, 'window'),
      opening: new OpeningTool(this, 'opening'),
      roof: new RoofTool(this),
      dim: new DimensionTool(this),
      measure: new DimensionTool(this, true),
      text: new TextTool(this),
      section: new SectionTool(this),
      camera: new CameraTool(this),
      erase: new EraseTool(this),
      move: new MoveTool(this),
      copy: new MoveTool(this, true),
      rotate: new RotateTool(this),
      mirror: new MirrorTool(this),
      offset: new OffsetTool(this),
      split: new SplitTool(this),
      pan: new PanTool(this),
    };
    this.toolName = 'select';
    this.tool = this.tools.select;

    this.model.on('change', (info) => this.onModelChange(info));
    this.model.on('load', () => {
      this.selection.clear();
      if (!this.model.level(this.activeLevel)) this.activeLevel = this.model.doc.levels[0].id;
      this.initToolOptions();
    });

    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.prefs.theme === 'auto' && this.onThemeChanged());
    }

    this.ui.mount();
    if (this.firstRun && window.innerWidth < 760) this.prefs.layout = 'plan';
    this.setLayout(this.prefs.layout, { initial: true });
    requestAnimationFrame(() => {
      this.plan.resize();
      this.zoomExtents();
      if (this.prefs.layout !== 'plan') this.ensure3D();
    });
    this.refreshTool();
    this.ui.onModelChange({ type: 'load' });
    if (!storage.storageAvailable()) {
      this.ui.toast(window.__LINTEL_PREVIEW__ ? 'This page is not keeping data. Use Export, then Copy project, to keep your plan.' : 'This browser is not keeping data. Export your plan to keep it.', 6000);
    } else if (this.firstRun) {
      this.saveNow();
      storage.setCurrentId(this.projectId);
      setTimeout(() => this.ui.toast('This sample house is yours to edit. Start a blank plan from Projects.', 6500), 600);
    }
    if (document.fonts?.ready) document.fonts.ready.then(() => this.plan.invalidate());
  }

  /* ---------- formatting ---------- */

  get units() {
    return this.model.settings.units;
  }

  fmt(mm) {
    return formatLength(mm, this.units);
  }

  fmtInput(mm) {
    return formatLength(mm, this.units, { precision: 'input' });
  }

  fmtArea(mm2) {
    return formatArea(mm2, this.units);
  }

  parse(str) {
    return parseLength(str, this.units);
  }

  parseAngle(str) {
    return parseAngle(str);
  }

  toast(msg, ms) {
    this.ui?.toast(msg, ms);
  }

  /* ---------- theme ---------- */

  get effectiveTheme() {
    if (this.prefs.theme === 'light' || this.prefs.theme === 'dark') return this.prefs.theme;
    if (this.hostTheme === 'light' || this.hostTheme === 'dark') return this.hostTheme;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme() {
    const el = document.documentElement;
    const theme = this.prefs.theme === 'auto' ? this.hostTheme : this.prefs.theme;
    if (theme) el.setAttribute('data-theme', theme);
    else el.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.effectiveTheme === 'dark' ? '#0b1d33' : '#e8ecea');
  }

  /**
   * A page that embeds the app (such as the claude.ai artifact viewer) may set
   * data-theme on the root element itself. "Follow system" then follows that choice.
   */
  watchHostTheme() {
    const el = document.documentElement;
    this.hostTheme = el.getAttribute('data-theme');
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(() => {
      const theme = el.getAttribute('data-theme');
      if (theme === (this.prefs.theme === 'auto' ? this.hostTheme : this.prefs.theme)) return;
      this.hostTheme = theme;
      this.onThemeChanged();
    }).observe(el, { attributes: true, attributeFilter: ['data-theme'] });
  }

  onThemeChanged() {
    this.applyTheme();
    this.plan?.refreshTheme();
    this.view3d?.refreshTheme();
  }

  cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    this.prefs.theme = order[(order.indexOf(this.prefs.theme) + 1) % order.length];
    this.savePrefs();
    this.onThemeChanged();
    this.toast(`Theme: ${this.prefs.theme === 'auto' ? 'follow system' : this.prefs.theme === 'dark' ? 'Blueprint (dark)' : 'Vellum (light)'}`);
    this.ui.refreshToggles();
  }

  /* ---------- prefs ---------- */

  savePrefs() {
    storage.savePrefs(this.prefs);
  }

  togglePref(path) {
    const [a, b] = path.split('.');
    this.prefs[a][b] = !this.prefs[a][b];
    this.savePrefs();
    this.plan.invalidate();
    this.ui.refreshToggles();
    const labels = {
      'snap.object': 'Object snap',
      'layers.grid': 'Grid',
      'snap.ortho': 'Ortho',
      'snap.grid': 'Snap to grid',
      'snap.polar': 'Polar tracking',
      'snap.align': 'Alignment guides',
    };
    if (labels[path]) this.toast(`${labels[path]} ${this.prefs[a][b] ? 'on' : 'off'}`, 1400);
  }

  /* ---------- tools ---------- */

  setTool(name, opts = {}) {
    const next = this.tools[name];
    if (!next) return;
    if (this.tool && this.tool !== next) this.tool.deactivate();
    const changed = this.toolName !== name;
    this.toolName = name;
    this.tool = next;
    if (changed || opts.force) next.activate?.(opts);
    this.plan.overlay.style.cursor = name === 'pan' ? 'grab' : name === 'select' ? '' : 'crosshair';
    if (this.layout === '3d' && name !== 'select' && name !== 'pan') this.setLayout('split');
    this.refreshTool();
  }

  /** Called when tool state changes (prompt, actions, options). */
  refreshTool() {
    this.ui?.onToolChange();
    this.plan?.invalidateOverlay();
  }

  runCommand(id) {
    const c = COMMAND_BY_ID[id];
    if (!c) return false;
    if (c.tool) {
      if (this.toolName === c.tool && c.tool !== 'select') this.tool.activate?.();
      this.setTool(c.tool, { force: true });
    } else c.run?.(this);
    return true;
  }

  /* ---------- selection ---------- */

  select(ids, mode = 'replace') {
    if (mode === 'replace') this.selection = new Set(ids);
    else if (mode === 'add') ids.forEach((id) => this.selection.add(id));
    else if (mode === 'remove') ids.forEach((id) => this.selection.delete(id));
    else if (mode === 'toggle') ids.forEach((id) => (this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id)));
    this.onSelectionChange();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection = new Set();
    this.onSelectionChange();
  }

  onSelectionChange() {
    this.plan.invalidate();
    this.view3d?.setSelection(this.selection);
    this.ui.onSelectionChange();
    this.refreshTool();
  }

  selectAll() {
    const doc = this.model.doc;
    const ids = [
      ...doc.walls.filter((w) => w.level === this.activeLevel).map((w) => w.id),
      ...doc.roofs.filter((r) => r.level === this.activeLevel).map((r) => r.id),
      ...doc.dims.filter((d) => d.level === this.activeLevel).map((d) => d.id),
      ...doc.texts.filter((t) => t.level === this.activeLevel).map((t) => t.id),
    ];
    this.select(ids);
  }

  deleteIds(ids) {
    if (!ids.length) return;
    this.model.remove(ids);
    this.model.commit('Delete');
    ids.forEach((id) => this.selection.delete(id));
    this.onSelectionChange();
    this.toast(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, 1600);
  }

  deleteSelection() {
    const ids = [...this.selection].filter((id) => this.model.kind(id) !== 'room');
    if (!ids.length) {
      if (this.selection.size) this.toast('Rooms come from their walls; delete the walls to remove a room.');
      return;
    }
    this.deleteIds(ids);
  }

  duplicateSelection() {
    const ids = [...this.selection];
    if (!ids.length) return;
    const ids2 = duplicate(this.model, ids, { x: 500, y: -500 });
    this.model.commit('Duplicate');
    this.select(ids2);
  }

  clipboardCopy(cut = false) {
    const ids = [...this.selection].filter((id) => this.model.kind(id) !== 'room');
    if (!ids.length) return;
    const doc = this.model.doc;
    const set = new Set(ids);
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const items = {};
    for (const c of ['walls', 'roofs', 'dims', 'texts', 'sections', 'views']) items[c] = doc[c].filter((e) => set.has(e.id)).map(clone);
    const wallIds = new Set(items.walls.map((w) => w.id));
    items.openings = doc.openings.filter((o) => wallIds.has(o.wall)).map(clone);
    const pts = [
      ...items.walls.flatMap((w) => [w.a, w.b]),
      ...items.roofs.flatMap((r) => r.points),
      ...items.dims.flatMap((d) => [d.a, d.b]),
      ...items.texts.map((t) => ({ x: t.x, y: t.y })),
      ...items.sections.flatMap((x) => [x.a, x.b]),
      ...items.views.map((v) => v.pos),
    ];
    const cx = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length);
    const cy = pts.reduce((a, p) => a + p.y, 0) / Math.max(1, pts.length);
    this.clip = { items, anchor: { x: cx, y: cy }, count: 0 };
    if (cut) this.deleteIds(ids);
    else this.toast(`Copied ${ids.length} item${ids.length === 1 ? '' : 's'}`, 1400);
  }

  clipboardPaste() {
    if (!this.clip) {
      this.toast('Nothing copied yet');
      return;
    }
    const doc = this.model.doc;
    const clip = this.clip;
    clip.count++;
    const hover = this.plan.hoverWorld;
    const d = hover && this.plan.lastPointerType !== 'touch'
      ? { x: hover.x - clip.anchor.x, y: hover.y - clip.anchor.y }
      : { x: 500 * clip.count, y: -500 * clip.count };
    const shift = (p) => ({ ...p, x: p.x + d.x, y: p.y + d.y });
    const idMap = new Map();
    const newIds = [];
    for (const c of ['walls', 'roofs', 'dims', 'texts', 'sections', 'views']) {
      for (const el of clip.items[c]) {
        const copy = JSON.parse(JSON.stringify(el));
        copy.id = this.model.nextId(c);
        idMap.set(el.id, copy.id);
        if ('level' in copy) copy.level = this.activeLevel;
        if (copy.a) copy.a = shift(copy.a);
        if (copy.b) copy.b = shift(copy.b);
        if (copy.points) copy.points = copy.points.map(shift);
        if (c === 'texts') Object.assign(copy, shift({ x: copy.x, y: copy.y }));
        if (copy.pos) copy.pos = shift(copy.pos);
        if (copy.target) copy.target = shift(copy.target);
        doc[c].push(copy);
        newIds.push(copy.id);
      }
    }
    for (const o of clip.items.openings) {
      const copy = JSON.parse(JSON.stringify(o));
      copy.id = this.model.nextId('openings');
      copy.wall = idMap.get(o.wall);
      doc.openings.push(copy);
    }
    this.model.version++;
    this.model.commit('Paste');
    this.select(newIds);
  }

  flipSelection() {
    let n = 0;
    for (const id of this.selection) {
      const el = this.model.get(id);
      const k = this.model.kind(id);
      if (k === 'wall') {
        flipWall(this.model.doc, el);
        n++;
      } else if (k === 'opening') {
        el.swing = -(el.swing || 1);
        n++;
      } else if (k === 'section') {
        el.flip = !el.flip;
        n++;
      }
    }
    if (n) this.model.commit('Flip');
  }

  /* ---------- undo ---------- */

  undo() {
    if (this.tool.busy && this.tool.onUndo?.()) return;
    if (this.tool.busy) this.tool.cancel();
    if (!this.model.undo()) this.toast('Nothing to undo', 1200);
  }

  redo() {
    if (!this.model.redo()) this.toast('Nothing to redo', 1200);
  }

  /* ---------- model changes ---------- */

  onModelChange(info) {
    let selChanged = false;
    for (const id of [...this.selection]) {
      if (!this.model.get(id)) {
        this.selection.delete(id);
        selChanged = true;
      }
    }
    if (!this.model.level(this.activeLevel)) this.activeLevel = this.model.doc.levels[0].id;
    this.plan.invalidate();
    this.view3d?.markDirty(!!info.live);
    this.ui.onModelChange(info);
    if (selChanged) this.ui.onSelectionChange();
    if (!info.live) this.saveSoon();
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 700);
  }

  saveNow(explicit = false) {
    clearTimeout(this._saveTimer);
    const ok = storage.saveProject(this.projectId, this.model.doc);
    if (ok) storage.setCurrentId(this.projectId);
    this.ui?.setSaveState(ok ? 'saved' : 'unsaved');
    if (explicit) this.toast(ok ? 'Saved on this device' : 'Could not save here. Use Export to keep a copy.');
    return ok;
  }

  /** Replace the open project. */
  openDocument(doc, id = storage.newProjectId()) {
    this.saveNow();
    this.projectId = id;
    this.model.load(doc);
    this.activeLevel = this.model.doc.levels[0].id;
    this.selection = new Set();
    this.setTool('select');
    this.saveNow();
    storage.setCurrentId(id);
    this.zoomExtents();
    this.ui.onModelChange({ type: 'load' });
    this.ui.onSelectionChange();
    this.view3d?.markDirty(false, true);
  }

  /* ---------- levels ---------- */

  get level() {
    return this.model.level(this.activeLevel);
  }

  setLevel(id) {
    if (!this.model.level(id)) return;
    if (this.tool.busy) this.tool.cancel();
    this.activeLevel = id;
    this.selection = new Set();
    this.onSelectionChange();
    this.plan.invalidate();
    this.ui.onLevelChange();
    this.view3d?.onLevelChange();
  }

  stepLevel(dir) {
    const levels = [...this.model.doc.levels].sort((a, b) => a.elevation - b.elevation);
    const i = levels.findIndex((l) => l.id === this.activeLevel);
    const next = levels[i + dir];
    if (next) {
      this.setLevel(next.id);
      this.toast(next.name, 1200);
    }
  }

  addLevel(copyWalls = false) {
    const doc = this.model.doc;
    const levels = [...doc.levels].sort((a, b) => a.elevation - b.elevation);
    const top = levels[levels.length - 1];
    const slab = this.model.settings.slabThickness || 150;
    const id = this.model.nextId('levels');
    const n = doc.levels.length;
    const lv = { id, name: n === 1 ? 'First floor' : `Level ${n}`, elevation: top.elevation + top.height + slab, height: top.height };
    doc.levels.push(lv);
    if (copyWalls) {
      const below = this.derived.level(top.id);
      const outer = new Set(below.outlines.flatMap((o) => o.walls.map((w) => w.id)));
      const walls = doc.walls.filter((w) => w.level === top.id);
      const out = {};
      duplicate(this.model, walls.map((w) => w.id), { x: 0, y: 0 }, id, out);
      // Upstairs gets the windows and inside doors, but not the outside doors.
      const outerCopies = new Set([...out.wallMap].filter(([src]) => outer.has(src)).map(([, copy]) => copy));
      doc.openings = doc.openings.filter((o) => !(outerCopies.has(o.wall) && o.kind !== 'window'));
      // Keep room names and colours.
      for (const t of doc.rooms.filter((r) => r.level === top.id)) {
        doc.rooms.push({ ...t, id: this.model.nextId('rooms'), level: id });
      }
    }
    // Roofs on the level below move up to the new top level.
    for (const r of doc.roofs) if (r.level === top.id) r.level = id;
    this.model.version++;
    this.model.commit('Add level');
    this.setLevel(id);
    this.toast(`${lv.name} added${copyWalls ? ' with walls copied from below' : ''}`);
    return lv;
  }

  deleteLevel(id) {
    const doc = this.model.doc;
    if (doc.levels.length <= 1) {
      this.toast('A project needs at least one level');
      return;
    }
    const wallIds = doc.walls.filter((w) => w.level === id).map((w) => w.id);
    const others = [...doc.roofs, ...doc.dims, ...doc.texts, ...doc.rooms].filter((x) => x.level === id).map((x) => x.id);
    this.model.remove([...wallIds, ...others]);
    doc.levels = doc.levels.filter((l) => l.id !== id);
    this.model.version++;
    this.model.commit('Delete level');
    if (this.activeLevel === id) this.setLevel(doc.levels[0].id);
    this.ui.onLevelChange();
  }

  /* ---------- views ---------- */

  setFocusView(v) {
    this.focusView = v;
  }

  get layout() {
    return this.prefs.layout;
  }

  setLayout(mode, opts = {}) {
    if (!['plan', '3d', 'split'].includes(mode)) mode = 'split';
    this.prefs.layout = mode;
    this.ui.applyLayout(mode);
    if (!opts.initial) this.savePrefs();
    requestAnimationFrame(() => {
      this.plan.resize();
      this.plan.invalidate();
      if (mode !== 'plan') this.ensure3D().then((v) => v?.resize());
    });
    if (mode === '3d') this.focusView = '3d';
    else if (mode === 'plan') this.focusView = 'plan';
  }

  cycleLayout() {
    const order = ['plan', 'split', '3d'];
    this.setLayout(order[(order.indexOf(this.layout) + 1) % order.length]);
  }

  async ensure3D() {
    if (this.view3d) return this.view3d;
    if (!this.view3dLoading) {
      this.ui.set3DLoading(true);
      this.view3dLoading = import('./three/view3d.js')
        .then(({ View3D }) => {
          this.view3d = new View3D(this, this.ui.viewHost);
          this.view3d.setSelection(this.selection);
          this.view3d.show(this.current3DView);
          this.ui.set3DLoading(false);
          this.ui.onViewChange();
          return this.view3d;
        })
        .catch((err) => {
          console.error(err);
          this.ui.set3DLoading(false, '3D could not start on this device (WebGL unavailable).');
          return null;
        });
    }
    return this.view3dLoading;
  }

  /**
   * Open a view: {type:'model'} orbit 3D, {type:'walk'}, {type:'saved', id},
   * {type:'elevation', dir:'N'|'S'|'E'|'W'}, {type:'section', id}, {type:'plan', level}
   */
  async openView(def) {
    if (def.type === 'plan') {
      if (def.level) this.setLevel(def.level);
      this.setLayout(this.layout === '3d' ? 'split' : this.layout);
      return;
    }
    this.current3DView = def;
    if (this.layout === 'plan') this.setLayout(window.innerWidth < 900 ? '3d' : 'split');
    const v = await this.ensure3D();
    v?.show(def);
    this.ui.onViewChange();
  }

  saveCurrent3DView() {
    if (!this.view3d) {
      this.toast('Open the 3D view first');
      return;
    }
    const cam = this.view3d.cameraState();
    if (!cam) {
      this.toast('Switch to the 3D model or walk view to save a viewpoint');
      return;
    }
    const n = this.model.doc.views.length + 1;
    const v = this.model.add('views', { name: `View ${n}`, ...cam });
    this.model.commit('Save view');
    this.current3DView = { type: 'saved', id: v.id };
    this.ui.onViewChange();
    this.toast(`Saved "${v.name}" in Views`);
  }

  zoomExtents() {
    const bb = this.derived.bounds(this.activeLevel) || this.derived.bounds();
    if (bb) this.plan.fitTo(bb);
    else {
      this.plan.vp.cx = 5000;
      this.plan.vp.cy = 4000;
      this.plan.vp.scale = Math.min(this.plan.vp.w / 14000, this.plan.vp.h / 10000);
      this.plan.invalidate();
    }
    if (this.focusView === '3d') this.view3d?.fit();
  }

  zoomBy(f) {
    if (this.focusView === '3d' && this.view3d && this.layout !== 'plan') this.view3d.zoomBy(f);
    else this.plan.zoomBy(f);
  }

  onViewChanged() {
    this.ui.onZoom?.(this.plan.vp.scale);
  }

  saveViewState() {}

  saveViewStateSoon() {}

  onCursor(world) {
    this.ui.setCoords(world);
  }

  /* ---------- overlay helpers ---------- */

  /** Outline the given elements in the overlay (optionally shifted). */
  drawHighlights(ctx, view, ids, color, delta = null) {
    if (!ids || !ids.size) return;
    const vp = view.vp;
    const lv = this.derived.level(this.activeLevel);
    ctx.save();
    vp.applyWorld(ctx, view.dpr);
    if (delta) ctx.translate(delta.x, delta.y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = vp.px(2);
    for (const id of ids) {
      const el = this.model.get(id);
      const kind = this.model.kind(id);
      if (!el) continue;
      ctx.beginPath();
      if (kind === 'wall') {
        for (const poly of lv.outlinesByWall.get(id) || []) pathPoly(ctx, poly);
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      } else if (kind === 'opening') {
        const w = this.model.get(el.wall);
        if (!w) continue;
        const path = wallPath(w);
        const h = w.thickness / 2 + vp.px(3);
        const s0 = el.pos - el.width / 2, s1 = el.pos + el.width / 2;
        const ss = path.samples(s0, s1);
        ss.forEach((s, i) => {
          const q = path.offsetAt(s, h);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        for (let i = ss.length - 1; i >= 0; i--) {
          const q = path.offsetAt(ss[i], -h);
          ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (kind === 'room') {
        const r = lv.rooms.find((x) => x.tag?.id === id);
        if (r) {
          pathPoly(ctx, r.poly);
          ctx.globalAlpha = 0.12;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
      } else if (kind === 'roof') {
        const g = this.derived.roof(el);
        if (g) pathPoly(ctx, g.outline);
        ctx.stroke();
      } else if (kind === 'dim') {
        const g = dimGeometry(el);
        ctx.moveTo(g.a2.x, g.a2.y);
        ctx.lineTo(g.b2.x, g.b2.y);
        ctx.stroke();
      } else if (kind === 'section') {
        ctx.moveTo(el.a.x, el.a.y);
        ctx.lineTo(el.b.x, el.b.y);
        ctx.stroke();
      } else if (kind === 'view' && el.pos) {
        ctx.arc(el.pos.x, el.pos.y, vp.px(14), 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === 'text') {
        const s = el.size || 300;
        ctx.rect(el.x - s * 2, el.y - s * 0.6, s * 4, s * 1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Walls joined to a wall end (used by the properties panel). */
  joinedAt(wall, which) {
    return wallEndsAt(this.model.doc, wall.level, wall[which], 1, wall.id);
  }
}
