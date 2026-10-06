// UI shell: top bar, toolbar, plan/3D panes, side panel, status bar with the
// command line, toasts, action bar and keyboard shortcuts.

import { h } from './form.js';
import { icon, iconSprite } from './icons.js';
import { COMMAND_BY_ID, commandForKey, searchCommands, shortcutLabel } from '../commands.js';
import { PropsPanel } from './props.js';
import { ViewsPanel } from './views.js';
import { Dialogs } from './dialogs.js';
import { beginTransform, applyTranslate } from '../core/ops.js';
import { isMetric } from '../core/units.js';
import { DOOR_STYLES, WINDOW_STYLES } from '../plan/tools/opening.js';
import { ROOF_KINDS } from '../geom/roof.js';

const TOOLBAR = [
  ['select'],
  ['sketch', 'wall', 'arc', 'rect'],
  ['door', 'window'],
  ['roof'],
  ['dim', 'section', 'camera'],
  ['erase'],
];
const MORE_TOOLS = ['move', 'copy', 'rotate', 'mirror', 'offset', 'split', 'opening', 'measure', 'text', 'autoroof', 'pan'];

const LAYERS = [
  ['grid', 'Grid'],
  ['rooms', 'Room names and colours'],
  ['wallDims', 'Wall lengths'],
  ['dims', 'Dimensions'],
  ['roofs', 'Roof lines'],
  ['sections', 'Section marks'],
  ['cameras', 'Cameras'],
  ['underlay', 'Level below (faded)'],
];

const TOGGLES = [
  ['snap.object', 'SNAP', 'Object snap (F3)'],
  ['snap.grid', 'GRID', 'Snap to grid (F9)'],
  ['snap.ortho', 'ORTHO', 'Ortho (F8, or hold Shift)'],
  ['snap.polar', 'POLAR', 'Polar tracking (F10)'],
  ['snap.align', 'ALIGN', 'Alignment guides (F11)'],
];

const VALUE_RE = /^[\s\d.\-+@<(,'"]/;

export class UI {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.build();
    this.dialogs = new Dialogs(app, this.modalHost);
    this.props = new PropsPanel(app, this.propsEl);
    this.views = new ViewsPanel(app, this.viewsEl);
  }

  /* ---------- DOM ---------- */

  build() {
    const app = this.app;
    this.root.innerHTML = iconSprite();
    const btn = (cls, title, iconName, onclick, extra = {}) =>
      h('button', { type: 'button', class: cls, title, 'aria-label': title, html: icon(iconName), onclick, ...extra });

    // Top bar
    this.undoBtn = btn('icon-btn', 'Undo (Ctrl+Z)', 'undo', () => app.undo());
    this.redoBtn = btn('icon-btn', 'Redo (Ctrl+Y)', 'redo', () => app.redo());
    this.nameInput = h('input', {
      class: 'proj-input',
      id: 'projectName',
      'aria-label': 'Project name',
      spellcheck: 'false',
      onchange: (e) => {
        app.model.doc.name = e.target.value.trim() || 'Untitled plan';
        app.model.commit('Rename project');
      },
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.target.blur();
      },
    });
    this.saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });
    this.layoutSeg = h(
      'div',
      { class: 'seg layout-seg', role: 'radiogroup', 'aria-label': 'Layout' },
      ...[
        ['plan', 'plan', '2D plan (1)'],
        ['split', 'split-view', 'Plan and 3D side by side (3)'],
        ['3d', 'cube', '3D view (2)'],
      ].map(([mode, ic, title]) => h('button', { type: 'button', class: 'seg-btn', 'data-layout': mode, title, 'aria-label': title, role: 'radio', html: icon(ic), onclick: () => (mode === '3d' ? app.openView(app.current3DView || { type: 'model' }) : app.setLayout(mode)) })),
    );
    this.levelBtn = h('button', { type: 'button', class: 'level-btn', onclick: (e) => this.levelMenu(e.currentTarget) }, h('span', { html: icon('level') }), h('span', { class: 'level-name' }), h('span', { html: icon('chevron-down', 'ic sm') }));
    this.panelBtn = btn('icon-btn panel-toggle', 'Show or hide the side panel', 'props', () => this.togglePanel());
    const topbar = h(
      'header',
      { class: 'topbar' },
      btn('icon-btn', 'Menu', 'menu', (e) => this.mainMenu(e.currentTarget)),
      h('div', { class: 'brand', 'aria-hidden': 'true' }, h('span', { class: 'brand-mark' }), h('span', { text: 'Lintel' })),
      this.nameInput,
      this.saveState,
      h('div', { class: 'spacer' }),
      h('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      this.layoutSeg,
      this.levelBtn,
      btn('icon-btn layers-btn', 'Layers', 'layers', (e) => this.layersMenu(e.currentTarget)),
      this.panelBtn,
    );

    // Toolbar
    this.toolbar = h('nav', { class: 'toolbar', 'aria-label': 'Tools' });
    for (const group of TOOLBAR) {
      const g = h('div', { class: 'tool-group' });
      for (const id of group) g.append(this.toolButton(id));
      this.toolbar.append(g);
    }
    this.moreBtn = h('button', { type: 'button', class: 'tool', title: 'More tools: move, copy, rotate, mirror, offset, split…', 'aria-label': 'More tools', onclick: (e) => this.moreMenu(e.currentTarget) }, h('span', { html: icon('more') }), h('span', { class: 'tool-label', text: 'More' }));
    this.toolbar.append(h('div', { class: 'tool-group' }, this.moreBtn));

    // Stage
    this.planHost = h('div', { class: 'plan-host' });
    this.ctxStrip = h('div', { class: 'ctx-strip', hidden: true });
    this.actionBar = h('div', { class: 'action-bar', role: 'toolbar', 'aria-label': 'Actions' });
    const zoom = h(
      'div',
      { class: 'zoom-ctrls' },
      btn('icon-btn', 'Zoom in', 'zoom-in', () => app.plan.zoomBy(1.4)),
      btn('icon-btn', 'Zoom out', 'zoom-out', () => app.plan.zoomBy(1 / 1.4)),
      btn('icon-btn', 'Zoom to fit (Z)', 'zoom-fit', () => {
        app.setFocusView('plan');
        app.zoomExtents();
      }),
    );
    this.planPane = h('section', { class: 'pane plan-pane', 'aria-label': 'Floor plan' }, this.planHost, this.ctxStrip, zoom, this.actionBar);
    this.viewHost = h('div', { class: 'view-host' });
    this.viewHud = h('div', { class: 'view-hud' });
    this.viewMsg = h('div', { class: 'view-msg', hidden: true });
    this.viewPane = h('section', { class: 'pane view-pane', 'aria-label': '3D view' }, this.viewHost, this.viewHud, this.viewMsg);
    this.divider = h('div', { class: 'divider', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', title: 'Drag to resize' });
    this.stage = h('main', { class: 'stage' }, this.planPane, this.divider, this.viewPane);
    this.installDivider();

    // Side panel
    this.propsEl = h('div', { class: 'panel-body', 'data-tab': 'props' });
    this.viewsEl = h('div', { class: 'panel-body', 'data-tab': 'views', hidden: true });
    this.tabBtns = {
      props: h('button', { type: 'button', class: 'tab on', role: 'tab', 'aria-selected': 'true', onclick: () => this.showPanel('props') }, h('span', { html: icon('props') }), h('span', { text: 'Properties' })),
      views: h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false', onclick: () => this.showPanel('views') }, h('span', { html: icon('views') }), h('span', { text: 'Views' })),
    };
    this.panel = h(
      'aside',
      { class: 'panel', 'aria-label': 'Side panel' },
      h('div', { class: 'tabs', role: 'tablist' }, this.tabBtns.props, this.tabBtns.views, btn('icon-btn sm panel-close', 'Close panel', 'x', () => this.togglePanel(false))),
      this.propsEl,
      this.viewsEl,
    );

    // Status bar
    this.promptEl = h('div', { class: 'prompt', 'aria-live': 'polite' });
    this.cmdLabel = h('span', { class: 'cmd-label', hidden: true });
    this.cmdInput = h('input', { class: 'cmd-input', id: 'cmdInput', type: 'text', placeholder: 'Command or value…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Command line' });
    this.cmdSuggest = h('ul', { class: 'cmd-suggest', role: 'listbox', hidden: true });
    this.cmdWrap = h('div', { class: 'cmd' }, h('span', { class: 'cmd-caret', text: '›' }), this.cmdLabel, this.cmdInput, this.cmdSuggest);
    this.toggleEls = {};
    const toggles = h('div', { class: 'toggles' });
    for (const [path, label, title] of TOGGLES) {
      const el = h('button', { type: 'button', class: 'chip', title, 'aria-pressed': 'false', onclick: () => app.togglePref(path) }, label);
      this.toggleEls[path] = el;
      toggles.append(el);
    }
    this.coordsEl = h('div', { class: 'coords', 'aria-hidden': 'true' });
    const status = h('footer', { class: 'statusbar' }, this.promptEl, this.cmdWrap, toggles, this.coordsEl);
    this.installCmd();

    this.toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    this.modalHost = h('div', { class: 'modal-host' });
    this.popHost = h('div', { class: 'pop-host' });

    this.appEl = h('div', { class: 'app' }, topbar, this.toolbar, this.stage, this.panel, status);
    this.root.append(this.appEl, this.toastHost, this.modalHost, this.popHost);
  }

  toolButton(id) {
    const c = COMMAND_BY_ID[id];
    const key = shortcutLabel(c);
    const b = h(
      'button',
      {
        type: 'button',
        class: 'tool',
        'data-tool': c.tool || id,
        title: `${c.label}${key ? ` (${key})` : ''}`,
        'aria-label': c.label,
        onclick: () => this.app.runCommand(id),
      },
      h('span', { html: icon(c.icon) }),
      h('span', { class: 'tool-label', text: c.label.split(' (')[0].replace('Sketch walls', 'Sketch').replace('Curved wall', 'Curve').replace('Room (rectangle)', 'Room') }),
      key && key.length <= 2 ? h('span', { class: 'tool-key', text: key }) : null,
    );
    return b;
  }

  mount() {
    this.showPanel(this.app.prefs.panelTab || 'props');
    this.togglePanel(this.app.prefs.panelOpen !== false && window.innerWidth >= 1000, true);
    this.refreshToggles();
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.pop && !this.pop.contains(e.target) && !e.target.closest?.('[data-pop-owner]')) this.closePop();
    });
    window.addEventListener('resize', () => this.closePop());
  }

  /* ---------- layout ---------- */

  applyLayout(mode) {
    this.stage.dataset.layout = mode;
    for (const b of this.layoutSeg.children) {
      const on = b.dataset.layout === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    this.applySplit();
    this.views.render();
  }

  applySplit() {
    const r = Math.min(0.8, Math.max(0.2, this.app.prefs.splitRatio || 0.55));
    this.stage.style.setProperty('--split', `${r * 100}%`);
  }

  installDivider() {
    let drag = null;
    this.divider.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId };
      this.divider.setPointerCapture(e.pointerId);
      this.divider.classList.add('dragging');
    });
    this.divider.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = this.stage.getBoundingClientRect();
      const portrait = getComputedStyle(this.stage).getPropertyValue('--portrait').trim() === '1';
      const ratio = portrait ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      this.app.prefs.splitRatio = Math.min(0.8, Math.max(0.2, ratio));
      this.applySplit();
      this.app.plan.resize();
      this.app.view3d?.resize();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      this.divider.classList.remove('dragging');
      this.app.savePrefs();
    };
    this.divider.addEventListener('pointerup', end);
    this.divider.addEventListener('pointercancel', end);
    this.divider.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        this.app.prefs.splitRatio += e.key === 'ArrowLeft' ? -0.05 : 0.05;
        this.applySplit();
        this.app.plan.resize();
        this.app.view3d?.resize();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  togglePanel(force, initial = false) {
    const open = force ?? !this.appEl.classList.contains('panel-open');
    this.appEl.classList.toggle('panel-open', open);
    this.panelBtn.classList.toggle('on', open);
    this.panelBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (!initial) {
      this.app.prefs.panelOpen = open;
      this.app.savePrefs();
    }
    requestAnimationFrame(() => {
      this.app.plan?.resize();
      this.app.view3d?.resize();
    });
  }

  showPanel(tab) {
    for (const [k, b] of Object.entries(this.tabBtns)) {
      b.classList.toggle('on', k === tab);
      b.setAttribute('aria-selected', k === tab ? 'true' : 'false');
    }
    this.propsEl.hidden = tab !== 'props';
    this.viewsEl.hidden = tab !== 'views';
    this.app.prefs.panelTab = tab;
    if (!this.appEl.classList.contains('panel-open')) this.togglePanel(true);
    if (tab === 'props') this.props.render();
    else this.views.render();
  }

  /* ---------- popovers ---------- */

  closePop() {
    if (this.pop) {
      this.pop.remove();
      this.popOwner?.removeAttribute('data-pop-owner');
      this.pop = null;
    }
  }

  openPop(anchor, content, { align = 'left' } = {}) {
    if (this.pop && this.popOwner === anchor) {
      this.closePop();
      return null;
    }
    this.closePop();
    const r = anchor.getBoundingClientRect();
    const pop = h('div', { class: 'pop', role: 'menu' }, content);
    this.popHost.append(pop);
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = align === 'right' ? r.right - pw : r.left;
    let y = r.bottom + 6;
    if (anchor.closest('.toolbar')) {
      x = r.right + 8;
      y = r.top;
    }
    x = Math.max(8, Math.min(window.innerWidth - pw - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - ph - 8, y));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    this.pop = pop;
    this.popOwner = anchor;
    anchor.setAttribute('data-pop-owner', '1');
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closePop();
        anchor.focus();
      }
    });
    requestAnimationFrame(() => pop.querySelector('button')?.focus({ preventScroll: true }));
    return pop;
  }

  menuItem(label, iconName, run, extra = '') {
    return h(
      'button',
      {
        type: 'button',
        class: 'menu-item',
        role: 'menuitem',
        onclick: () => {
          this.closePop();
          run();
        },
      },
      h('span', { html: icon(iconName) }),
      h('span', { class: 'menu-label', text: label }),
      extra ? h('span', { class: 'menu-extra', text: extra }) : null,
    );
  }

  mainMenu(anchor) {
    const app = this.app;
    const fs = document.fullscreenElement;
    this.openPop(
      anchor,
      h(
        'div',
        { class: 'menu' },
        this.menuItem('Projects…', 'folder', () => this.dialogs.projects(), 'Ctrl+O'),
        this.menuItem('Save on this device', 'save', () => app.saveNow(true), 'Ctrl+S'),
        this.menuItem('Export…', 'export', () => this.dialogs.exportDialog(), 'Ctrl+E'),
        window.innerWidth < 760 ? this.menuItem('Layers…', 'layers', () => this.layersMenu(anchor)) : null,
        h('hr'),
        this.menuItem('Settings…', 'settings', () => this.dialogs.settings()),
        this.menuItem('Switch theme', 'theme', () => app.cycleTheme()),
        document.fullscreenEnabled ? this.menuItem(fs ? 'Exit full screen' : 'Full screen', 'fullscreen', () => this.toggleFullscreen()) : null,
        h('hr'),
        this.menuItem('Shortcuts and help', 'help', () => this.dialogs.help(), 'F1'),
      ),
    );
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => this.toast('Full screen is not available here'));
  }

  moreMenu(anchor) {
    const items = MORE_TOOLS.map((id) => {
      const c = COMMAND_BY_ID[id];
      return this.menuItem(c.label, c.icon, () => this.app.runCommand(id), shortcutLabel(c));
    });
    this.openPop(anchor, h('div', { class: 'menu' }, ...items));
  }

  levelMenu(anchor) {
    const app = this.app;
    const levels = [...app.model.doc.levels].sort((a, b) => b.elevation - a.elevation);
    this.openPop(
      anchor,
      h(
        'div',
        { class: 'menu' },
        ...levels.map((l) => this.menuItem(l.name, l.id === app.activeLevel ? 'check' : 'level', () => app.setLevel(l.id), app.fmt(l.elevation))),
        h('hr'),
        this.menuItem('Add level above', 'plus', () => app.addLevel(false)),
        this.menuItem('Add level, copy walls', 'copy', () => app.addLevel(true)),
        this.menuItem('Manage levels…', 'views', () => this.showPanel('views')),
      ),
      { align: 'right' },
    );
  }

  layersMenu(anchor) {
    const app = this.app;
    const content = h('div', { class: 'menu layers-menu' });
    for (const [k, label] of LAYERS) {
      const id = `layer-${k}`;
      content.append(
        h(
          'label',
          { class: 'menu-check', for: id },
          h('input', {
            type: 'checkbox',
            id,
            checked: app.prefs.layers[k],
            onchange: (e) => {
              app.prefs.layers[k] = e.target.checked;
              app.savePrefs();
              app.plan.invalidate();
            },
          }),
          h('span', { text: label }),
        ),
      );
    }
    this.openPop(anchor, content, { align: 'right' });
  }

  /* ---------- state updates ---------- */

  onToolChange() {
    const app = this.app;
    for (const b of this.toolbar.querySelectorAll('.tool[data-tool]')) {
      const on = b.dataset.tool === app.toolName;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const inMore = MORE_TOOLS.some((id) => COMMAND_BY_ID[id].tool === app.toolName);
    this.moreBtn.classList.toggle('on', inMore);
    this.promptEl.textContent = app.tool.prompt;
    this.renderActionBar();
    this.renderCtxStrip();
    if (!app.selection.size) this.props.render();
    this.updateCmdLabel();
  }

  onSelectionChange() {
    this.props.render();
    this.renderActionBar();
    this.promptEl.textContent = this.app.tool.prompt;
  }

  onModelChange(info) {
    const app = this.app;
    this.undoBtn.disabled = !app.model.canUndo && !app.model.dirtyLive;
    this.redoBtn.disabled = !app.model.canRedo;
    if (document.activeElement !== this.nameInput) this.nameInput.value = app.model.doc.name;
    document.title = `${app.model.doc.name} · Lintel`;
    if (!info.live) {
      this.setSaveState('saving');
      if (this.props.pending || !this.propsEl.hidden) this.props.render();
      if (!this.viewsEl.hidden) this.views.render();
      this.onLevelChange(true);
    }
  }

  onLevelChange(quiet = false) {
    const lv = this.app.level;
    this.levelBtn.querySelector('.level-name').textContent = lv?.name || '';
    this.levelBtn.title = `Level: ${lv?.name}`;
    if (!quiet) {
      this.props.render();
      this.views.render();
    }
  }

  onViewChange() {
    if (!this.viewsEl.hidden) this.views.render();
  }

  setSaveState(state) {
    this.saveState.dataset.state = state;
    this.saveState.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Not saved';
  }

  setCoords(p) {
    if (!p) return;
    const app = this.app;
    this.coordsEl.textContent = `X ${app.fmt(p.x)}  Y ${app.fmt(p.y)}`;
  }

  refreshToggles() {
    const p = this.app.prefs;
    for (const [path, el] of Object.entries(this.toggleEls)) {
      const [a, b] = path.split('.');
      const on = !!p[a][b];
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  set3DLoading(loading, error) {
    this.viewMsg.hidden = !loading && !error;
    this.viewMsg.textContent = error || 'Loading 3D…';
    this.viewMsg.classList.toggle('error', !!error);
  }

  toast(msg, ms = 2600) {
    const t = h('div', { class: 'toast', role: 'status', text: msg });
    this.toastHost.append(t);
    while (this.toastHost.children.length > 3) this.toastHost.firstChild.remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  /* ---------- action bar & context strip ---------- */

  renderActionBar() {
    const app = this.app;
    const bar = this.actionBar;
    bar.innerHTML = '';
    let actions = app.tool.actions || [];
    if (app.toolName === 'select' && app.selection.size && !actions.length) {
      const ids = [...app.selection];
      const kinds = new Set(ids.map((id) => app.model.kind(id)));
      actions = [];
      if ([...kinds].some((k) => k === 'wall' || k === 'opening' || k === 'section')) actions.push({ id: 'flip', label: 'Flip', icon: 'flip', run: () => app.flipSelection() });
      if (!kinds.has('room') || kinds.size > 1) {
        actions.push({ id: 'dup', label: 'Duplicate', icon: 'copy', run: () => app.duplicateSelection() });
        actions.push({ id: 'move', label: 'Move', icon: 'move', run: () => app.setTool('move') });
        actions.push({ id: 'rot', label: 'Rotate', icon: 'rotate', run: () => app.setTool('rotate') });
        actions.push({ id: 'del', label: 'Delete', icon: 'trash', danger: true, run: () => app.deleteSelection() });
      }
      if (ids.length === 1 && (kinds.has('section') || kinds.has('view'))) {
        const id = ids[0];
        actions.unshift({ id: 'open', label: 'Open view', icon: 'cube', primary: true, run: () => app.openView(kinds.has('section') ? { type: 'section', id } : { type: 'saved', id }) });
      }
      actions.push({ id: 'edit', label: 'Edit', icon: 'props', run: () => this.showPanel('props') });
    }
    bar.hidden = !actions.length;
    for (const a of actions) {
      bar.append(
        h('button', { type: 'button', class: `act ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, onclick: a.run, title: a.label }, h('span', { html: icon(a.icon || 'check') }), h('span', { text: a.label })),
      );
    }
  }

  renderCtxStrip() {
    const app = this.app;
    const t = app.toolName;
    const o = app.toolOptions;
    const strip = this.ctxStrip;
    strip.innerHTML = '';
    const chips = [];
    const chip = (label, on, run, title) => h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, onclick: run, title: title || label }, label);
    if (['wall', 'arc', 'rect', 'sketch'].includes(t)) {
      const presets = isMetric(app.units) ? [90, 110, 150, 200, 230, 250, 300] : [3.5, 4.5, 6, 8, 10, 12].map((x) => x * 25.4);
      chips.push(h('span', { class: 'ctx-label', text: 'Thickness' }));
      for (const p of presets) chips.push(chip(app.fmt(p), Math.abs(o.wall.thickness - p) < 0.5, () => { o.wall.thickness = p; app.refreshTool(); }));
      if (t === 'sketch') {
        chips.push(h('span', { class: 'ctx-sep' }));
        chips.push(chip(o.sketch.curves ? 'Curves on' : 'Curves off', o.sketch.curves, () => { o.sketch.curves = !o.sketch.curves; app.refreshTool(); }));
      }
    } else if (t === 'door' || t === 'window') {
      const styles = t === 'door' ? DOOR_STYLES : WINDOW_STYLES;
      for (const [k, label] of Object.entries(styles)) chips.push(chip(label.split(' (')[0], o[t].style === k, () => {
        o[t].style = k;
        if (t === 'door' && k === 'double' && o.door.width < 1200) o.door.width = 1640;
        if (t === 'door' && k === 'garage') o.door.width = Math.max(o.door.width, 2400);
        app.refreshTool();
      }));
      chips.push(h('span', { class: 'ctx-sep' }));
      chips.push(chip(`W ${app.fmt(o[t].width)}`, false, () => this.promptValue('Width', (v) => {
        const x = app.parse(v);
        if (!(x > 100)) return false;
        o[t].width = x;
        app.refreshTool();
        return true;
      }), 'Change width'));
    } else if (t === 'roof') {
      for (const k of Object.keys(ROOF_KINDS)) chips.push(chip(k[0].toUpperCase() + k.slice(1), o.roof.kind === k, () => { o.roof.kind = k; app.refreshTool(); }));
      chips.push(h('span', { class: 'ctx-sep' }));
      chips.push(chip(`${Math.round(o.roof.pitch)}°`, false, () => this.promptValue('Roof pitch (degrees or 6:12)', (v) => {
        const x = app.parseAngle(v);
        if (!(x > 0 && x < 80)) return false;
        o.roof.pitch = x;
        app.refreshTool();
        return true;
      }), 'Change pitch'));
    }
    strip.hidden = !chips.length;
    strip.append(...chips);
  }

  promptValue(label, cb, initial = '') {
    this.dialogs.promptValue(label, cb, initial);
  }

  /** Inline editor over a canvas pill (temporary dimensions). */
  inlineEdit(rect, value, onCommit) {
    this.closeInline();
    const input = h('input', { class: 'inline-edit', type: 'text', value, inputmode: isMetric(this.app.units) ? 'decimal' : 'text', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Exact value' });
    const host = this.planPane;
    const pr = this.planHost.getBoundingClientRect(), hr = host.getBoundingClientRect();
    input.style.left = `${rect.x + pr.left - hr.left - 10}px`;
    input.style.top = `${rect.y + pr.top - hr.top - 4}px`;
    input.style.minWidth = `${Math.max(90, rect.w + 20)}px`;
    host.append(input);
    this.inline = input;
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply && input.value.trim() !== value) {
        const ok = onCommit(input.value.trim());
        if (ok === false) this.toast('That value could not be used');
      }
      this.closeInline();
      this.app.plan.overlay.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  closeInline() {
    if (this.inline) {
      const el = this.inline;
      this.inline = null;
      el.remove();
    }
  }

  /* ---------- command line ---------- */

  installCmd() {
    const input = this.cmdInput;
    let sel = 0;
    let items = [];
    const renderSuggest = () => {
      const text = input.value;
      const app = this.app;
      if (!text.trim() || (app.tool.inputLabel && VALUE_RE.test(text))) {
        this.cmdSuggest.hidden = true;
        items = [];
        return;
      }
      items = searchCommands(text);
      this.cmdSuggest.innerHTML = '';
      items.forEach((c, i) => {
        this.cmdSuggest.append(
          h('li', { role: 'option', class: i === sel ? 'on' : '', 'aria-selected': i === sel ? 'true' : 'false', onpointerdown: (e) => { e.preventDefault(); this.execCommand(c); } },
            h('span', { html: icon(c.icon) }), h('span', { class: 'cs-label', text: c.label }), h('span', { class: 'cs-alias', text: c.aliases[0] || '' }), h('span', { class: 'cs-key', text: shortcutLabel(c) })),
        );
      });
      this.cmdSuggest.hidden = !items.length;
    };
    input.addEventListener('input', () => {
      sel = 0;
      renderSuggest();
      this.app.plan.invalidateOverlay();
    });
    input.addEventListener('focus', () => this.updateCmdLabel());
    input.addEventListener('blur', () => {
      setTimeout(() => {
        this.cmdSuggest.hidden = true;
        this.updateCmdLabel();
      }, 120);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length) {
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          renderSuggest();
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Escape') {
        input.value = '';
        input.blur();
        this.app.plan.overlay.focus({ preventScroll: true });
        this.app.plan.invalidateOverlay();
        return;
      }
      const isEnter = e.key === 'Enter' || e.key === 'Tab';
      const isSpaceCmd = e.key === ' ' && items.length && !VALUE_RE.test(input.value) && searchCommands(input.value)[0]?.aliases.includes(input.value.trim().toLowerCase());
      if (isEnter || isSpaceCmd) {
        e.preventDefault();
        this.submitCmd(items[sel]);
      }
    });
  }

  submitCmd(suggested) {
    const app = this.app;
    const input = this.cmdInput;
    const text = input.value.trim();
    input.value = '';
    this.cmdSuggest.hidden = true;
    if (!text) {
      input.blur();
      app.plan.overlay.focus({ preventScroll: true });
      if (app.tool.busy) app.tool.finish();
      return;
    }
    if (app.tool.inputLabel && VALUE_RE.test(text)) {
      const ok = app.tool.onInput(text);
      if (!ok) app.toast(`Could not read "${text}" as ${app.tool.inputLabel.toLowerCase()}`);
      app.plan.invalidateOverlay();
      if (ok) {
        input.blur();
        app.plan.overlay.focus({ preventScroll: true });
      }
      return;
    }
    const c = suggested || searchCommands(text)[0];
    if (!c) {
      app.toast(`Unknown command "${text}". Press F1 for the list.`);
      return;
    }
    this.execCommand(c);
  }

  execCommand(c) {
    this.cmdInput.value = '';
    this.cmdSuggest.hidden = true;
    this.cmdInput.blur();
    this.app.plan.overlay.focus({ preventScroll: true });
    this.app.runCommand(c.id);
    this.lastCommand = c.id;
  }

  focusCmd(initial = '', valueMode = false) {
    this.cmdInput.value = initial;
    this.cmdInput.focus();
    const n = initial.length;
    this.cmdInput.setSelectionRange(n, n);
    this.cmdValueMode = valueMode;
    this.updateCmdLabel();
    this.app.plan.invalidateOverlay();
  }

  updateCmdLabel() {
    const label = this.app.tool.inputLabel;
    const focused = document.activeElement === this.cmdInput;
    this.cmdLabel.hidden = !(label && focused);
    this.cmdLabel.textContent = label ? `${label}:` : '';
    this.cmdInput.placeholder = label ? `${label} or command…` : 'Command or value…';
  }

  /** Text being typed as a value (shown next to the cursor). */
  get typedValue() {
    const v = this.cmdInput.value;
    return document.activeElement === this.cmdInput && this.app.tool.inputLabel && VALUE_RE.test(v) ? v : '';
  }

  /* ---------- keyboard ---------- */

  onKeyDown(e) {
    const app = this.app;
    if (this.dialogs.isOpen) {
      if (e.key === 'Escape') this.dialogs.closeTop();
      return;
    }
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) return;
    if (this.pop && e.key === 'Escape') {
      this.closePop();
      return;
    }
    if (app.focusView === '3d' && app.layout !== 'plan' && app.view3d?.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (app.tool.cancel()) return;
      if (app.selection.size) app.clearSelection();
      else if (app.toolName !== 'select') app.setTool('select');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (app.tool.busy) app.tool.finish();
      else if (this.lastCommand && e.shiftKey) app.runCommand(this.lastCommand);
      else this.focusCmd('');
      return;
    }
    if (!e.ctrlKey && !e.metaKey && app.tool.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        app.plan.spaceDown = true;
        this.spaceAt = performance.now();
        this.spacePanned = false;
      }
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && app.tool.inputLabel && /^[0-9.\-@<]$/.test(e.key)) {
      e.preventDefault();
      this.focusCmd(e.key, true);
      return;
    }
    if (e.key === '/' || e.key === ':') {
      e.preventDefault();
      this.focusCmd('');
      return;
    }
    if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey) {
      if (app.selection.size && app.toolName === 'select') {
        e.preventDefault();
        this.nudge(e);
        return;
      }
      e.preventDefault();
      const d = e.shiftKey ? 200 : 60;
      const map = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
      const [dx, dy] = map[e.key];
      app.plan.vp.panBy(dx, dy);
      app.plan.invalidate();
      return;
    }
    const cmd = commandForKey(e);
    if (cmd) {
      e.preventDefault();
      app.runCommand(cmd.id);
      this.lastCommand = cmd.id;
    }
  }

  onKeyUp(e) {
    if (e.key === ' ') {
      const app = this.app;
      app.plan.spaceDown = false;
      const short = performance.now() - (this.spaceAt || 0) < 250;
      if (short && !app.plan.pan && !app.tool.busy && app.toolName !== 'select') app.setTool('select');
    }
  }

  nudge(e) {
    const app = this.app;
    const step = isMetric(app.units) ? (e.shiftKey ? 100 : 10) : e.shiftKey ? 304.8 : 25.4;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const [dx, dy] = map[e.key];
    const ctx = beginTransform(app.model.doc, [...app.selection]);
    applyTranslate(app.model.doc, ctx, { x: dx, y: dy });
    app.model.commit('Nudge');
  }
}
