// The 3D view: orbit, walk-through, elevations and sections (orthographic with
// clipping and poché), level cut, saved viewpoints, picking and exports.

import * as THREE from './lib.js';
import { GLTFExporter } from './lib.js';
import { Materials } from './materials.js';
import { buildModel, disposeTree } from './build.js';
import { OrbitController, WalkController } from './controls.js';
import { icon } from '../ui/icons.js';
import { h } from '../ui/form.js';

const M = 0.001;
const ELEV = {
  N: { dir: { x: 0, y: -1 }, name: 'North elevation' },
  S: { dir: { x: 0, y: 1 }, name: 'South elevation' },
  E: { dir: { x: -1, y: 0 }, name: 'East elevation' },
  W: { dir: { x: 1, y: 0 }, name: 'West elevation' },
};

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class View3D {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D view of the model');
    host.append(this.canvas);

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 2000);
    this.camera = this.persp;
    this.mats = new Materials();
    this.orbit = new OrbitController(this);
    this.walk = new WalkController(this);
    this.mode = 'orbit';
    this.viewDef = { type: 'model' };
    this.cut = { on: false, height: 1200 };
    this.selection = new Set();
    this.model = null;
    this.dirty = true;
    this.lastBuild = 0;
    this._raf = 0;
    this.pointers = new Map();
    this.orthoState = { center: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), halfW: 10, halfH: 6 };

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a80, 1.15);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xcfd5cc, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.012;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(1, 1, 0x000000, 0x000000);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.08;
    this.grid.position.y = -0.01;
    this.scene.add(this.grid);

    this.buildHud();
    this.installInput();
    this.refreshTheme();
    this.applyPrefs();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
    this.rebuild();
    this.firstFit = true;
  }

  /* ---------- HUD ---------- */

  buildHud() {
    const app = this.app;
    const hud = app.ui.viewHud;
    hud.innerHTML = '';
    const btn = (name, title, run) => h('button', { type: 'button', class: 'icon-btn sm', title, 'aria-label': title, html: icon(name), onclick: run });
    this.hudTitle = h('div', { class: 'hud-title' });
    this.btnOrbit = btn('cube', 'Orbit (3D model)', () => app.openView({ type: 'model' }));
    this.btnWalk = btn('walk', 'Walk through (4)', () => app.openView({ type: 'walk' }));
    this.btnTop = btn('top', 'Look straight down', () => this.topView());
    this.btnCut = btn('cut', 'Cut the model at a height (shows the floor plan in 3D)', () => this.toggleCut());
    this.btnSave = btn('camera', 'Save this viewpoint', () => app.saveCurrent3DView());
    this.btnFit = btn('zoom-fit', 'Fit the model', () => this.fit());
    this.btnEdges = btn('edges', 'Outline edges', () => {
      app.prefs.view3d.edges = !app.prefs.view3d.edges;
      app.savePrefs();
      this.applyPrefs();
    });
    this.btnSun = btn('sun', 'Shadows', () => {
      app.prefs.view3d.shadows = !app.prefs.view3d.shadows;
      app.savePrefs();
      this.applyPrefs();
    });
    this.btnMore = btn('more', 'More 3D options', (e) => this.moreMenu(e.currentTarget));
    this.tools = h('div', { class: 'hud-tools' }, this.btnOrbit, this.btnWalk, this.btnCut, this.btnFit, this.btnSave, this.btnMore);
    const top = h('div', { class: 'hud-top' }, this.hudTitle, this.tools);

    this.cutRange = h('input', { type: 'range', min: '200', max: '4000', step: '50', id: 'cutRange', 'aria-label': 'Cut height' });
    this.cutValue = h('span', { class: 'hud-value' });
    this.cutRange.addEventListener('input', () => {
      this.cut.height = parseFloat(this.cutRange.value);
      this.updateClipping();
      this.updateHud();
      this.requestRender();
    });
    this.cutCard = h('div', { class: 'hud-card', hidden: true }, h('label', { for: 'cutRange', text: 'Cut at' }), this.cutRange, this.cutValue);
    this.bottom = h('div', { class: 'hud-bottom' }, this.cutCard);

    this.stick = h('div', { class: 'joystick', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'joystick-knob' }));
    this.walkHint = h('div', { class: 'walk-hint', hidden: true, text: 'Drag to look around. Use the stick, or W A S D and arrow keys, to walk. Q and E go down and up; Shift runs.' });
    hud.append(top, this.bottom, this.stick, this.walkHint);
    this.installStick();
  }

  moreMenu(anchor) {
    const ui = this.app.ui;
    const p = this.app.prefs.view3d;
    const persp = this.mode !== 'ortho';
    ui.openPop(
      anchor,
      h(
        'div',
        { class: 'menu' },
        persp && this.mode !== 'walk' ? ui.menuItem('Look straight down', 'top', () => this.topView()) : null,
        ui.menuItem(p.edges ? 'Hide outline edges' : 'Show outline edges', 'edges', () => this.btnEdges.click()),
        ui.menuItem(p.shadows ? 'Turn shadows off' : 'Turn shadows on', 'sun', () => this.btnSun.click()),
        ui.menuItem('Export image or model…', 'export', () => ui.dialogs.exportDialog()),
      ),
      { align: 'right' },
    );
  }

  updateHud() {
    const def = this.viewDef;
    const doc = this.app.model.doc;
    let title = '3D model';
    if (def.type === 'walk') title = 'Walk through';
    else if (def.type === 'saved') title = doc.views.find((v) => v.id === def.id)?.name || 'Saved view';
    else if (def.type === 'elevation') title = ELEV[def.dir]?.name || 'Elevation';
    else if (def.type === 'section') title = doc.sections.find((s) => s.id === def.id)?.name || 'Section';
    this.hudTitle.textContent = title;
    const persp = this.mode !== 'ortho';
    this.btnOrbit.classList.toggle('on', this.mode === 'orbit' && def.type !== 'saved');
    this.btnWalk.classList.toggle('on', this.mode === 'walk');
    this.btnTop.hidden = !persp || this.mode === 'walk';
    this.btnCut.hidden = !persp;
    this.btnCut.classList.toggle('on', this.cut.on);
    this.btnSave.hidden = !persp;
    this.btnEdges.classList.toggle('on', !!this.app.prefs.view3d.edges);
    this.btnSun.classList.toggle('on', !!this.app.prefs.view3d.shadows);
    this.cutCard.hidden = !(this.cut.on && persp);
    const lv = this.app.level;
    this.cutRange.max = String(Math.round((lv?.height || 2700) + 1500));
    this.cutRange.value = String(this.cut.height);
    this.cutValue.textContent = this.app.fmt(this.cut.height);
    const walk = this.mode === 'walk';
    this.stick.hidden = !walk;
    this.walkHint.hidden = !walk || window.innerWidth < 700;
  }

  installStick() {
    const st = this.stick;
    const knob = st.firstChild;
    let id = null;
    const set = (e) => {
      const r = st.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      this.walk.stick = { x: dx, y: dy };
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      this.requestRender();
    };
    st.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      id = e.pointerId;
      st.setPointerCapture(id);
      set(e);
    });
    st.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) set(e);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.walk.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
  }

  /* ---------- theme & prefs ---------- */

  refreshTheme() {
    const top = css('--sky-top', '#a9c3d8'), bottom = css('--sky-bottom', '#eef1ee');
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    this.skyTex?.dispose();
    this.skyTex = new THREE.CanvasTexture(c);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.paperColor = new THREE.Color(css('--plan-bg', '#fbfcfa'));
    this.ground.material.color.set(css('--ground', '#cfd5cc'));
    this.mats.setCutColor(css('--model-cut', '#2b2f33'));
    const dark = this.app.effectiveTheme === 'dark';
    this.mats.setEdgeColor(dark ? '#0a1a2e' : '#1b2326', dark ? 0.45 : 0.38);
    this.grid.material.color.set(dark ? 0xbfd9ff : 0x000000);
    this.applyBackground();
    this.requestRender();
  }

  applyBackground() {
    const ortho = this.mode === 'ortho';
    this.scene.background = ortho ? this.paperColor : this.skyTex;
    // Drawings (sections, elevations) read best with even light and no cast shadows;
    // walking indoors needs more fill light because there is no bounced light.
    const shadows = !!this.app.prefs.view3d.shadows && !ortho;
    this.sun.castShadow = shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.hemi.intensity = ortho ? 2.1 : this.mode === 'walk' ? 1.9 : 1.15;
    this.sun.intensity = ortho ? 1.1 : this.mode === 'walk' ? 1.8 : 2.3;
    this.ground.visible = !ortho;
    this.grid.visible = !ortho;
  }

  applyPrefs() {
    const p = this.app.prefs.view3d;
    this.applyBackground();
    this.scene.traverse((o) => {
      if (o.material && o.isMesh) o.material.needsUpdate = true;
    });
    if (this.edgesOn !== !!p.edges) {
      this.edgesOn = !!p.edges;
      this.dirty = true;
      this.rebuild();
    }
    this.updateHud();
    this.requestRender();
  }

  /* ---------- model ---------- */

  markDirty(live = false, force = false) {
    this.dirty = true;
    if (force) {
      this.rebuild();
      return;
    }
    const now = performance.now();
    clearTimeout(this._rebuildTimer);
    if (live) {
      if (now - this.lastBuild > 160) this.rebuild();
      else this._rebuildTimer = setTimeout(() => this.rebuild(), 170);
    } else {
      this._rebuildTimer = setTimeout(() => this.rebuild(), 30);
    }
  }

  rebuild() {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastBuild = performance.now();
    if (this.model) {
      this.scene.remove(this.model.group);
      disposeTree(this.model.group);
    }
    try {
      this.model = buildModel(this.app, this.mats, { edges: !!this.app.prefs.view3d.edges });
    } catch (err) {
      console.error('3D build failed', err);
      this.model = { group: new THREE.Group(), meshesById: new Map(), pickables: [], bounds: new THREE.Box3() };
    }
    this.scene.add(this.model.group);
    this.applySelection();
    this.fitEnvironment();
    if (this.viewDef.type === 'section' || this.viewDef.type === 'elevation') this.show(this.viewDef, { keepCamera: true });
    this.requestRender();
  }

  get bounds() {
    const b = this.model?.bounds;
    if (!b || b.isEmpty()) return new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    return b;
  }

  fitEnvironment() {
    const b = this.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 10);
    this.ground.scale.set(span * 12, span * 12, 1);
    this.ground.position.x = c.x;
    this.ground.position.z = c.z;
    const g = Math.ceil(span * 3);
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const dark = this.app.effectiveTheme === 'dark';
    this.grid = new THREE.GridHelper(g * 2, g * 2, dark ? 0xbfd9ff : 0x000000, dark ? 0xbfd9ff : 0x000000);
    this.grid.material.transparent = true;
    this.grid.material.opacity = dark ? 0.08 : 0.06;
    this.grid.material.depthWrite = false;
    this.grid.position.set(Math.round(c.x), -0.01, Math.round(c.z));
    this.scene.add(this.grid);
    // Late-morning sun from the south-east of the plan.
    const r = Math.max(size.length(), 10);
    this.sun.position.set(c.x + r * 0.55, c.y + r * 0.9, c.z + r * 0.75);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.1;
    sc.far = r * 4;
    sc.updateProjectionMatrix();
  }

  setSelection(sel) {
    this.selection = new Set(sel);
    this.applySelection();
    this.requestRender();
  }

  applySelection() {
    if (!this.model) return;
    for (const [id, meshes] of this.model.meshesById) {
      const on = this.selection.has(id);
      for (const m of meshes) {
        if (m.material === this.mats.glass) continue;
        if (on) {
          if (!m.userData.mat) m.userData.mat = m.material;
          m.material = this.mats.highlight;
        } else if (m.userData.mat) {
          m.material = m.userData.mat;
          m.userData.mat = null;
        }
      }
    }
  }

  /* ---------- views ---------- */

  show(def, opts = {}) {
    const app = this.app;
    this.viewDef = def;
    const b = this.bounds;
    const center = b.getCenter(new THREE.Vector3());
    switch (def.type) {
      case 'walk': {
        this.mode = 'walk';
        this.camera = this.persp;
        this.persp.fov = 65;
        if (!opts.keepCamera) {
          const lv = app.level;
          const rooms = app.derived.level(app.activeLevel).rooms;
          let start = null;
          if (rooms.length) {
            const r = rooms.slice().sort((a, b2) => b2.netArea - a.netArea)[0];
            start = r.tag || r.label;
          }
          const eye = ((lv?.elevation || 0) + 1600) * M;
          const p = start ? new THREE.Vector3(start.x * M, eye, -start.y * M) : new THREE.Vector3(center.x, eye, center.z);
          this.walk.pos.copy(p);
          this.walk.yaw = this.orbit.theta + Math.PI;
          this.walk.pitch = 0;
        }
        break;
      }
      case 'saved': {
        const v = app.model.doc.views.find((x) => x.id === def.id);
        if (!v) return this.show({ type: 'model' });
        this.mode = 'orbit';
        this.camera = this.persp;
        this.persp.fov = v.fov || 55;
        const pos = new THREE.Vector3(v.pos.x * M, v.pos.z * M, -v.pos.y * M);
        const tgt = new THREE.Vector3(v.target.x * M, v.target.z * M, -v.target.y * M);
        this.orbit.setFromCamera(pos, tgt);
        this.orbit.anim = null;
        break;
      }
      case 'elevation': {
        this.mode = 'ortho';
        this.camera = this.ortho;
        const e = ELEV[def.dir] || ELEV.S;
        const dir = new THREE.Vector3(e.dir.x, 0, -e.dir.y);
        this.setupOrtho(center, dir, opts.keepCamera);
        break;
      }
      case 'section': {
        const s = app.model.doc.sections.find((x) => x.id === def.id);
        if (!s) return this.show({ type: 'model' });
        this.mode = 'ortho';
        this.camera = this.ortho;
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
        const L = Math.hypot(dx, dy) || 1;
        const k = s.flip ? -1 : 1;
        const look = { x: (-dy / L) * k, y: (dx / L) * k };
        const dir = new THREE.Vector3(look.x, 0, -look.y);
        const mid = new THREE.Vector3(((s.a.x + s.b.x) / 2) * M, center.y, (-(s.a.y + s.b.y) / 2) * M);
        this.setupOrtho(mid, dir, opts.keepCamera, (L * M) / 2);
        break;
      }
      default: {
        this.mode = 'orbit';
        this.camera = this.persp;
        this.persp.fov = 50;
        if (this.firstFit || def.fit) {
          this.firstFit = false;
          this.fit(false);
        }
      }
    }
    this.persp.updateProjectionMatrix();
    this.applyBackground();
    this.updateClipping();
    this.updateHud();
    this.canvas.style.cursor = this.mode === 'ortho' ? 'grab' : '';
    this.requestRender();
  }

  setupOrtho(center, dir, keep, halfWidth = null) {
    const st = this.orthoState;
    const b = this.bounds;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    let minR = Infinity, maxR = -Infinity;
    const corners = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
    for (const c of corners) {
      const r = c.clone().sub(center).dot(right);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    const hw = halfWidth ?? Math.max(Math.abs(minR), Math.abs(maxR));
    const cy = (b.min.y + b.max.y) / 2;
    const hh = Math.max(1.5, (b.max.y - Math.min(0, b.min.y)) / 2);
    st.dir.copy(dir);
    if (!keep) {
      st.center.set(center.x, cy, center.z);
      st.halfW = hw * 1.12 + 0.5;
      st.halfH = hh * 1.2 + 0.5;
      this.ortho.zoom = 1;
    }
    this.updateOrthoFrustum();
  }

  updateOrthoFrustum() {
    const st = this.orthoState;
    const w = this.host.clientWidth || 1, hgt = this.host.clientHeight || 1;
    const aspect = w / hgt;
    let halfH = Math.max(st.halfH, st.halfW / aspect);
    const halfW = halfH * aspect;
    const cam = this.ortho;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = 0.01;
    cam.far = 4000;
    cam.position.copy(st.center).addScaledVector(st.dir, -500);
    cam.up.set(0, 1, 0);
    cam.lookAt(st.center);
    cam.updateProjectionMatrix();
  }

  updateClipping() {
    const planes = [];
    const def = this.viewDef;
    if (this.mode === 'ortho' && def.type === 'section') {
      const s = this.app.model.doc.sections.find((x) => x.id === def.id);
      if (s) {
        const dir = this.orthoState.dir.clone();
        const a3 = new THREE.Vector3(s.a.x * M, 0, -s.a.y * M);
        planes.push(new THREE.Plane(dir.clone(), -dir.dot(a3)));
        if (s.depth > 0) planes.push(new THREE.Plane(dir.clone().negate(), dir.dot(a3) + s.depth * M));
      }
    } else if (this.mode !== 'ortho' && this.cut.on) {
      const lv = this.app.level;
      const y = ((lv?.elevation || 0) + this.cut.height) * M;
      planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), y));
    }
    this.mats.setClipping(planes);
  }

  toggleCut() {
    this.cut.on = !this.cut.on;
    if (this.cut.on && this.mode === 'orbit' && this.orbit.phi > 1.1) {
      this.orbit.animateTo(this.orbit.target, this.orbit.radius, this.orbit.theta, 0.75);
    }
    this.updateClipping();
    this.updateHud();
    this.requestRender();
  }

  topView() {
    if (this.mode !== 'orbit') this.show({ type: 'model' });
    const b = this.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const r = this.fitRadius();
    this.orbit.animateTo(c, r, 0, 0.02);
    this.requestRender();
  }

  fitRadius() {
    const s = this.bounds.getBoundingSphere(new THREE.Sphere());
    const fov = (this.persp.fov * Math.PI) / 180;
    const aspect = this.persp.aspect || 1;
    const f = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
    // The bounding sphere is generous vertically (houses are flat), so wide panes can sit closer.
    const k = aspect >= 1.2 ? 0.88 : aspect >= 0.8 ? 0.98 : 1.1;
    return Math.max(3, (s.radius / Math.sin(f / 2)) * k);
  }

  fit(animate = true) {
    if (this.mode === 'ortho') {
      this.setupOrtho(this.orthoState.center, this.orthoState.dir, false, this.viewDef.type === 'section' ? this.orthoState.halfW / 1.12 : null);
      this.requestRender();
      return;
    }
    if (this.mode === 'walk') this.show({ type: 'model' });
    const b = this.bounds;
    const c = b.getCenter(new THREE.Vector3());
    c.y = Math.min(c.y, (b.min.y + b.max.y) / 2);
    const r = this.fitRadius();
    if (animate) this.orbit.animateTo(c, r, -Math.PI / 4, 1.0);
    else {
      this.orbit.target.copy(c);
      this.orbit.radius = r;
      this.orbit.theta = -Math.PI / 4;
      this.orbit.phi = 1.0;
    }
    this.requestRender();
  }

  zoomBy(f) {
    if (this.mode === 'ortho') this.ortho.zoom = Math.min(50, Math.max(0.05, this.ortho.zoom * f));
    else if (this.mode === 'orbit') this.orbit.zoomAbout(1 / f, null, this.camera);
    else this.walk.pos.addScaledVector(new THREE.Vector3(Math.sin(this.walk.yaw), 0, Math.cos(this.walk.yaw)), (f - 1) * 2);
    this.ortho.updateProjectionMatrix();
    this.requestRender();
  }

  onLevelChange() {
    this.updateClipping();
    this.updateHud();
    this.requestRender();
  }

  /** Camera state in plan coordinates for saving a viewpoint. */
  cameraState() {
    if (this.mode === 'ortho') return null;
    const cam = this.persp;
    let tgt;
    if (this.mode === 'walk') {
      tgt = new THREE.Vector3();
      cam.getWorldDirection(tgt);
      tgt.multiplyScalar(5).add(cam.position);
    } else tgt = this.orbit.target.clone();
    const P = (v) => ({ x: Math.round(v.x / M), y: Math.round(-v.z / M), z: Math.round(v.y / M) });
    return { pos: P(cam.position), target: P(tgt), fov: Math.round(cam.fov) };
  }

  /* ---------- input ---------- */

  installInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.walk.keys.delete(k);
      if (k === 'shift') this.walk.keys.delete('shift');
    });
    window.addEventListener('blur', () => this.walk.keys.clear());
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  onDown(e) {
    this.userAdjusted = true;
    this.app.setFocusView('3d');
    this.canvas.focus({ preventScroll: true });
    const L = this.local(e);
    this.pointers.set(e.pointerId, { x: L.x, y: L.y, sx: L.x, sy: L.y, type: e.pointerType, button: e.button, t0: e.timeStamp, moved: false, shift: e.shiftKey });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.orbit.anim = null;
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length === 2) {
      const [a, b] = touches;
      this.pinch = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const L = this.local(e);
    const dx = L.x - p.x, dy = L.y - p.y;
    p.x = L.x;
    p.y = L.y;
    if (Math.hypot(L.x - p.sx, L.y - p.sy) > 6) p.moved = true;
    const touches = [...this.pointers.values()].filter((q) => q.type === 'touch');
    if (touches.length >= 2 && this.pinch) {
      const [a, b] = touches;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const f = this.pinch.d / d;
      const pdx = mx - this.pinch.mx, pdy = my - this.pinch.my;
      this.pinch = { d, mx, my };
      if (this.mode === 'ortho') {
        this.zoomOrthoAt(1 / f, mx, my, L.w, L.h);
        this.panOrtho(pdx, pdy, L.h);
      } else if (this.mode === 'orbit') {
        this.orbit.zoomAbout(f, this.pointAt(mx, my), this.camera);
        this.orbit.pan(pdx, pdy, this.camera, L.h);
      } else {
        this.walk.pos.addScaledVector(new THREE.Vector3(Math.sin(this.walk.yaw), 0, Math.cos(this.walk.yaw)), (1 - f) * 4);
      }
      this.requestRender();
      return;
    }
    if (touches.length >= 2) return;
    const panBtn = p.type === 'mouse' && (p.button === 1 || p.button === 2 || p.shift);
    if (this.mode === 'ortho') this.panOrtho(dx, dy, L.h);
    else if (this.mode === 'walk') this.walk.look(dx, dy, L.h);
    else if (panBtn) this.orbit.pan(dx, dy, this.camera, L.h);
    else this.orbit.rotate(dx, dy, L.h);
    this.requestRender();
  }

  onUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if ([...this.pointers.values()].filter((q) => q.type === 'touch').length < 2) this.pinch = null;
    if (!p || cancelled || p.moved || this.pointers.size) return;
    if (e.timeStamp - p.t0 > 500) return;
    const L = this.local(e);
    const now = e.timeStamp;
    if (this.lastTap && now - this.lastTap.t < 380 && Math.hypot(L.x - this.lastTap.x, L.y - this.lastTap.y) < 26) {
      this.lastTap = null;
      this.focusAt(L.x, L.y);
      return;
    }
    this.lastTap = { t: now, x: L.x, y: L.y };
    this.pickAt(L.x, L.y, e.shiftKey);
  }

  onWheel(e) {
    e.preventDefault();
    this.userAdjusted = true;
    const L = this.local(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;
    const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015));
    if (this.mode === 'ortho') this.zoomOrthoAt(1 / f, L.x, L.y, L.w, L.h);
    else if (this.mode === 'orbit') this.orbit.zoomAbout(f, this.pointAt(L.x, L.y), this.camera);
    else this.walk.pos.addScaledVector(new THREE.Vector3(Math.sin(this.walk.yaw), 0, Math.cos(this.walk.yaw)), -dy * 0.004);
    this.requestRender();
  }

  panOrtho(dx, dy, hgt) {
    const st = this.orthoState;
    const perPx = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / hgt;
    const right = new THREE.Vector3().crossVectors(st.dir, new THREE.Vector3(0, 1, 0)).normalize();
    st.center.addScaledVector(right, -dx * perPx);
    st.center.y += dy * perPx;
    this.updateOrthoFrustum();
  }

  zoomOrthoAt(f, x, y, w, hgt) {
    const st = this.orthoState;
    const before = this.orthoWorld(x, y, w, hgt);
    this.ortho.zoom = Math.min(60, Math.max(0.05, this.ortho.zoom * f));
    this.ortho.updateProjectionMatrix();
    const after = this.orthoWorld(x, y, w, hgt);
    st.center.add(before.sub(after));
    this.updateOrthoFrustum();
  }

  orthoWorld(x, y, w, hgt) {
    const ndc = new THREE.Vector3((x / w) * 2 - 1, -(y / hgt) * 2 + 1, 0);
    return ndc.unproject(this.ortho);
  }

  raycast(x, y) {
    if (!this.model) return null;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), this.camera);
    const hits = ray.intersectObjects(this.model.pickables, false);
    const planes = this.mats.planes;
    for (const hit of hits) {
      if (planes.every((pl) => pl.distanceToPoint(hit.point) >= -1e-4)) return hit;
    }
    return null;
  }

  /** World point under the cursor (model hit, or the ground / target plane). */
  pointAt(x, y) {
    const hit = this.raycast(x, y);
    if (hit) return hit.point;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.orbit.target.y);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, p) ? p : null;
  }

  pickAt(x, y, add) {
    const hit = this.raycast(x, y);
    const id = hit?.object?.userData?.id || null;
    const app = this.app;
    if (!id) {
      if (!add) app.clearSelection();
      return;
    }
    const kind = app.model.kind(id);
    if (kind && 'level' in (app.model.get(id) || {}) && app.model.get(id).level !== app.activeLevel && kind !== 'opening') {
      app.setLevel(app.model.get(id).level);
    }
    if (kind === 'opening') {
      const w = app.model.get(app.model.get(id).wall);
      if (w && w.level !== app.activeLevel) app.setLevel(w.level);
    }
    app.select([id], add ? 'toggle' : 'replace');
  }

  focusAt(x, y) {
    if (this.mode !== 'orbit') return;
    const hit = this.raycast(x, y);
    if (!hit) return;
    this.orbit.animateTo(hit.point, Math.max(2, this.orbit.radius * 0.6), this.orbit.theta, this.orbit.phi);
    this.requestRender();
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (this.mode === 'walk') {
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'pageup', 'pagedown'].includes(k)) {
        if (e.ctrlKey || e.metaKey) return false;
        this.walk.keys.add(k);
        this.requestRender();
        return true;
      }
      if (k === 'escape') {
        this.app.openView({ type: 'model' });
        return true;
      }
    }
    if (this.mode === 'orbit' && k.startsWith('arrow') && !e.ctrlKey) {
      const step = 0.08;
      if (k === 'arrowleft') this.orbit.theta += step;
      if (k === 'arrowright') this.orbit.theta -= step;
      if (k === 'arrowup') this.orbit.phi = Math.max(this.orbit.minPhi, this.orbit.phi - step);
      if (k === 'arrowdown') this.orbit.phi = Math.min(this.orbit.maxPhi, this.orbit.phi + step);
      this.requestRender();
      return true;
    }
    return false;
  }

  /* ---------- rendering ---------- */

  resize() {
    const w = Math.max(1, this.host.clientWidth), hgt = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, hgt, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
    this.persp.aspect = w / hgt;
    this.persp.updateProjectionMatrix();
    this.updateOrthoFrustum();
    // Until the user moves the camera, keep the whole model framed as the pane changes size.
    if (!this.userAdjusted && this.mode === 'orbit' && this.viewDef.type === 'model' && this.model) this.fit(false);
    this.requestRender();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    this._raf = 0;
    if (!this.host.isConnected || this.host.clientWidth === 0) return;
    const dt = Math.min(0.1, (t - (this._lastT || t)) / 1000);
    this._lastT = t;
    let more = false;
    if (this.mode === 'orbit') {
      if (this.orbit.step(t)) more = true;
      this.orbit.apply(this.persp);
    } else if (this.mode === 'walk') {
      if (this.walk.step(dt)) more = true;
      if (this.walk.moving) more = true;
      this.walk.apply(this.persp);
    }
    if (this.dirty && performance.now() - this.lastBuild > 200) this.rebuild();
    this.renderer.render(this.scene, this.camera);
    if (more) this.requestRender();
    else this._lastT = 0;
  }

  /* ---------- exports ---------- */

  screenshot() {
    return new Promise((resolve) => {
      const old = this.renderer.getPixelRatio();
      this.renderer.setPixelRatio(Math.max(2, old));
      this.resize();
      if (this.mode === 'orbit') this.orbit.apply(this.persp);
      this.renderer.render(this.scene, this.camera);
      this.canvas.toBlob((b) => {
        this.renderer.setPixelRatio(old);
        this.resize();
        resolve(b);
      }, 'image/png');
    });
  }

  withoutEdges(fn) {
    const hidden = [];
    this.model.group.traverse((o) => {
      if (o.isLineSegments && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    try {
      return fn();
    } finally {
      hidden.forEach((o) => (o.visible = true));
    }
  }

  exportGLB() {
    return new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      this.withoutEdges(() => {
        exporter.parse(
          this.model.group,
          (res) => resolve(new Blob([res], { type: 'model/gltf-binary' })),
          (err) => reject(err),
          { binary: true, onlyVisible: true },
        );
      });
    });
  }

  exportOBJ() {
    const lines = ['# Lintel Plan Studio export (metres, Y up)'];
    let vOff = 1, nOff = 1;
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    let count = 0;
    this.model.group.updateMatrixWorld(true);
    this.model.group.traverse((o) => {
      if (!o.isMesh || !o.visible || o.material === this.mats.glass) return;
      const g = o.geometry;
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      if (!pos) return;
      nm.getNormalMatrix(o.matrixWorld);
      lines.push(`o ${o.userData.id || 'part'}_${count++}`);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        lines.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`);
      }
      if (nor) {
        for (let i = 0; i < nor.count; i++) {
          n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
          lines.push(`vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}`);
        }
      }
      const idx = g.getIndex();
      const tri = (a, b, c) => {
        if (nor) lines.push(`f ${a + vOff}//${a + nOff} ${b + vOff}//${b + nOff} ${c + vOff}//${c + nOff}`);
        else lines.push(`f ${a + vOff} ${b + vOff} ${c + vOff}`);
      };
      if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
      vOff += pos.count;
      if (nor) nOff += nor.count;
    });
    return new Blob([lines.join('\n')], { type: 'text/plain' });
  }
}
