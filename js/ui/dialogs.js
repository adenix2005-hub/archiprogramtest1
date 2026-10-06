// Modal dialogs: projects, export, settings, help, confirm and value prompts.

import { h, buildFields } from './form.js';
import { icon } from './icons.js';
import * as storage from '../core/storage.js';
import { newDoc, migrate } from '../core/model.js';
import { sampleHouse } from '../core/sample.js';
import { COMMANDS } from '../commands.js';
import { UNITS } from '../core/units.js';
import { exportJSON, exportPlanPNG, exportDXF, exportSVG, downloadBlob, readProjectFile, safeName } from '../io/export.js';

export class Dialogs {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.stack = [];
  }

  open({ title, body, actions = [], wide = false, onClose }) {
    const close = () => {
      wrap.remove();
      this.stack = this.stack.filter((x) => x !== entry);
      onClose?.();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
    const prevFocus = document.activeElement;
    const titleId = `dlg-${Date.now().toString(36)}`;
    const foot = actions.length
      ? h('footer', { class: 'modal-foot' }, ...actions.map((a) => h('button', { type: 'button', class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`, onclick: () => (a.run ? a.run(close) : close()) }, a.label)))
      : null;
    const card = h(
      'div',
      { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('header', { class: 'modal-head' }, h('h2', { id: titleId, text: title }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: icon('x'), onclick: close })),
      h('div', { class: 'modal-body' }, body),
      foot,
    );
    const wrap = h('div', { class: 'modal-backdrop', onclick: (e) => e.target === wrap && close() }, card);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });
    this.host.append(wrap);
    const entry = { close, wrap };
    this.stack.push(entry);
    requestAnimationFrame(() => {
      const f = card.querySelector('[autofocus], input, select, button.btn-primary, button');
      f?.focus({ preventScroll: true });
    });
    return entry;
  }

  get isOpen() {
    return this.stack.length > 0;
  }

  closeTop() {
    this.stack[this.stack.length - 1]?.close();
  }

  confirm(title, message, okLabel = 'OK') {
    return new Promise((resolve) => {
      let answered = false;
      this.open({
        title,
        body: h('p', { class: 'modal-text', text: message }),
        actions: [
          { label: 'Cancel', run: (close) => { answered = true; close(); resolve(false); } },
          { label: okLabel, primary: true, danger: /delete|remove/i.test(okLabel), run: (close) => { answered = true; close(); resolve(true); } },
        ],
        onClose: () => !answered && resolve(false),
      });
    });
  }

  /** Ask for a typed value (used on touch devices while drawing). */
  promptValue(label, onValue, initial = '') {
    const input = h('input', { class: 'f-input big', type: 'text', value: initial, inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': label });
    const hint = h('p', { class: 'f-note', text: 'Examples: 3600, 3.6m, 12\'6", 3600<90, @1200,0' });
    let entry;
    const submit = () => {
      const v = input.value.trim();
      if (!v) return entry.close();
      const ok = onValue(v);
      if (ok === false) {
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        return;
      }
      entry.close();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') entry.close();
    });
    entry = this.open({
      title: label,
      body: h('div', {}, input, hint),
      actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, run: submit }],
    });
    setTimeout(() => input.focus(), 50);
  }

  /* ---------- projects ---------- */

  projects() {
    const app = this.app;
    const list = h('div', { class: 'proj-list' });
    let entry;
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const data = await readProjectFile(f);
        const doc = migrate(data);
        app.openDocument(doc);
        entry.close();
        app.toast(`Opened "${doc.name}"`);
      } catch (err) {
        app.toast(err.message || 'Could not open that file');
      }
    });
    const render = () => {
      list.innerHTML = '';
      const items = storage.listProjects();
      if (!items.length) list.append(h('p', { class: 'f-note', text: 'Projects you work on are kept on this device.' }));
      for (const p of items) {
        const current = p.id === app.projectId;
        const when = p.modified ? new Date(p.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
        list.append(
          h(
            'div',
            { class: `proj ${current ? 'on' : ''}` },
            h(
              'button',
              {
                type: 'button',
                class: 'proj-open',
                onclick: () => {
                  if (current) return entry.close();
                  const doc = storage.loadProject(p.id);
                  if (!doc) return app.toast('That project could not be read');
                  app.openDocument(doc, p.id);
                  entry.close();
                },
              },
              h('span', { class: 'proj-name', text: p.name }),
              h('span', { class: 'proj-meta', text: `${current ? 'Open now · ' : ''}${p.walls ?? 0} walls · ${when}` }),
            ),
            h('button', {
              type: 'button',
              class: 'icon-btn sm',
              title: 'Duplicate',
              'aria-label': `Duplicate ${p.name}`,
              html: icon('copy'),
              onclick: () => {
                const doc = current ? app.model.doc : storage.loadProject(p.id);
                if (!doc) return;
                const copy = JSON.parse(JSON.stringify(doc));
                copy.name = `${doc.name} copy`;
                copy.modified = Date.now();
                storage.saveProject(storage.newProjectId(), copy);
                render();
              },
            }),
            current
              ? null
              : h('button', {
                  type: 'button',
                  class: 'icon-btn sm',
                  title: 'Delete',
                  'aria-label': `Delete ${p.name}`,
                  html: icon('trash'),
                  onclick: async () => {
                    if (await this.confirm(`Delete "${p.name}"?`, 'This removes it from this device. Export it first if you want to keep a copy.', 'Delete')) {
                      storage.deleteProject(p.id);
                      render();
                    }
                  },
                }),
          ),
        );
      }
    };
    render();
    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'f-buttons' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { app.openDocument(newDoc('Untitled plan')); entry.close(); app.toast('New blank plan. Pick Sketch or Wall to start drawing.'); } }, h('span', { html: icon('plus') }), h('span', { text: 'New blank plan' })),
        h('button', { type: 'button', class: 'btn', onclick: () => { app.openDocument(sampleHouse()); entry.close(); } }, h('span', { html: icon('home') }), h('span', { text: 'New from sample house' })),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, h('span', { html: icon('import') }), h('span', { text: 'Open file…' })),
        fileInput,
      ),
      h('h3', { class: 'vsect-title', text: 'On this device' }),
      list,
    );
    entry = this.open({ title: 'Projects', body, wide: true });
  }

  /* ---------- export ---------- */

  exportDialog() {
    const app = this.app;
    let entry;
    const run = async (fn, label) => {
      try {
        await fn();
        app.toast(`${label} exported`);
      } catch (err) {
        console.error(err);
        app.toast(`Export failed: ${err.message || err}`);
      }
    };
    const item = (iconName, title, desc, fn) =>
      h('button', { type: 'button', class: 'exp-item', onclick: () => run(fn, title) }, h('span', { class: 'exp-ic', html: icon(iconName) }), h('span', { class: 'exp-text' }, h('strong', { text: title }), h('span', { text: desc })));
    const name = safeName(app.model.doc.name);
    const body = h(
      'div',
      { class: 'exp-grid' },
      item('plan', 'Plan image (PNG)', `${app.level.name} on a white sheet`, async () => {
        const blob = await exportPlanPNG(app);
        if (!blob) throw new Error('nothing to export');
        downloadBlob(blob, `${name}-${safeName(app.level.name)}.png`);
      }),
      item('plan', 'Plan drawing (DXF)', 'Open in AutoCAD, Revit, SketchUp or LibreCAD', () => exportDXF(app)),
      item('plan', 'Plan vector (SVG)', 'Scalable drawing for print or Illustrator', () => exportSVG(app)),
      item('cube', '3D image (PNG)', 'The current 3D view', async () => {
        const v = await app.ensure3D();
        if (!v) throw new Error('3D is not available');
        const blob = await v.screenshot();
        downloadBlob(blob, `${name}-3d.png`);
      }),
      item('cube', '3D model (GLB)', 'For Blender, SketchUp (with importer) or web viewers', async () => {
        const v = await app.ensure3D();
        if (!v) throw new Error('3D is not available');
        const blob = await v.exportGLB();
        downloadBlob(blob, `${name}.glb`);
      }),
      item('cube', '3D model (OBJ)', 'Widely supported mesh format', async () => {
        const v = await app.ensure3D();
        if (!v) throw new Error('3D is not available');
        const blob = v.exportOBJ();
        downloadBlob(blob, `${name}.obj`);
      }),
      item('save', 'Project file (JSON)', 'Full backup you can open here again', () => exportJSON(app)),
    );
    entry = this.open({ title: 'Export', body, wide: true });
    void entry;
  }

  /* ---------- settings ---------- */

  settings() {
    const app = this.app;
    const body = h('div', { class: 'settings' });
    const render = () => {
      const p = app.prefs;
      buildFields(app, body, [
        { type: 'header', label: 'Drawing', icon: 'plan' },
        { type: 'select', label: 'Units', value: app.units, options: Object.entries(UNITS).map(([value, u]) => ({ value, label: u.label })), onChange: (v) => { app.model.doc.settings.units = v; app.model.commit('Units'); render(); } },
        { type: 'length', label: 'Grid snap spacing', value: app.model.settings.grid, min: 1, onChange: (v) => { app.model.doc.settings.grid = v; app.model.commit('Grid'); } },
        { type: 'segmented', label: 'Polar tracking every', value: p.snap.polarStep, options: [15, 30, 45, 90].map((v) => ({ value: v, label: `${v}°` })), onChange: (v) => { p.snap.polarStep = v; app.savePrefs(); render(); } },
        { type: 'toggle', label: 'Round lengths while drawing', value: p.snap.lengthRound !== false, onChange: (v) => { p.snap.lengthRound = v; app.savePrefs(); } },
        { type: 'header', label: 'Pen and touch', icon: 'pen' },
        { type: 'toggle', label: 'Pen draws, fingers only pan and zoom', value: p.penOnly, onChange: (v) => { p.penOnly = v; app.savePrefs(); } },
        { type: 'note', label: 'Turn this on when using the S Pen so your palm and fingers never draw by accident.' },
        { type: 'toggle', label: 'Offset cursor above finger', value: p.touchOffset, onChange: (v) => { p.touchOffset = v; app.savePrefs(); } },
        { type: 'note', label: 'Draws a crosshair a little above your fingertip so you can see exactly where a wall starts.' },
        { type: 'header', label: 'Appearance', icon: 'theme' },
        { type: 'segmented', label: 'Theme', value: p.theme, options: [
          { value: 'auto', label: 'Auto' },
          { value: 'light', label: 'Vellum' },
          { value: 'dark', label: 'Blueprint' },
        ], onChange: (v) => { p.theme = v; app.savePrefs(); app.onThemeChanged(); render(); } },
        { type: 'toggle', label: '3D shadows', value: p.view3d.shadows, onChange: (v) => { p.view3d.shadows = v; app.savePrefs(); app.view3d?.applyPrefs(); } },
        { type: 'toggle', label: '3D outline edges', value: p.view3d.edges, onChange: (v) => { p.view3d.edges = v; app.savePrefs(); app.view3d?.applyPrefs(); } },
        { type: 'header', label: 'New walls', icon: 'wall' },
        { type: 'length', label: 'Default thickness', value: app.model.settings.wallThickness, min: 20, onChange: (v) => { app.model.doc.settings.wallThickness = v; app.toolOptions.wall.thickness = v; app.model.commit('Defaults'); } },
        { type: 'length', label: 'Default height', value: app.model.settings.wallHeight, min: 100, onChange: (v) => { app.model.doc.settings.wallHeight = v; app.toolOptions.wall.height = v; app.model.commit('Defaults'); } },
      ]);
    };
    render();
    this.open({ title: 'Settings', body });
  }

  /* ---------- help ---------- */

  help() {
    const groups = [
      ['draw', 'Draw'],
      ['annotate', 'Annotate and views'],
      ['modify', 'Modify'],
      ['edit', 'Edit'],
      ['view', 'View'],
      ['toggle', 'Drafting aids'],
      ['level', 'Levels'],
      ['file', 'File'],
    ];
    const kbd = (k) => h('kbd', { text: k.replace('Ctrl', navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl') });
    const tables = groups.map(([g, title]) => {
      const rows = COMMANDS.filter((c) => c.group === g);
      return h(
        'section',
        { class: 'help-sect' },
        h('h3', { class: 'vsect-title', text: title }),
        h(
          'table',
          { class: 'help-table' },
          h('tbody', {}, ...rows.map((c) => h('tr', {}, h('td', {}, c.label), h('td', { class: 'keys' }, ...c.keys.flatMap((k, i) => (i ? [' ', kbd(k)] : [kbd(k)]))), h('td', { class: 'alias' }, c.aliases.slice(0, 3).join(', '))))),
        ),
      );
    });
    const gestures = h(
      'section',
      { class: 'help-sect' },
      h('h3', { class: 'vsect-title', text: 'Touch, S Pen and mouse' }),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, h('strong', { text: 'Two fingers' }), ' pinch to zoom and drag to pan, in 2D and 3D.'),
        h('li', {}, h('strong', { text: 'One finger on empty space' }), ' pans the plan while the Select tool is active.'),
        h('li', {}, h('strong', { text: 'Sketch tool' }), ': draw rooms freehand; strokes become straight or curved walls.'),
        h('li', {}, h('strong', { text: 'Wall tool' }), ': tap point to point, or drag each wall. Tap the first point to close the room.'),
        h('li', {}, h('strong', { text: 'Typed lengths' }), ': while drawing, type 3600 (or 3.6m, 11\'6") and press Enter. 3600<90 sets the angle; @1200,300 is relative.'),
        h('li', {}, h('strong', { text: 'Mouse' }), ': wheel zooms, middle button or Space+drag pans, right-click finishes the current command.'),
        h('li', {}, h('strong', { text: 'Command line' }), ': press Enter or / and type AutoCAD or Revit style names such as L, REC, WA, DR, WN, CO, RO, MI, O.'),
        h('li', {}, h('strong', { text: 'Exact sizes' }), ': select a wall or door and tap the blue measurement to type a value.'),
        h('li', {}, h('strong', { text: '3D view' }), ': one finger or left mouse orbits, two fingers or right mouse pans, double-tap focuses.'),
      ),
    );
    this.open({ title: 'Shortcuts and help', body: h('div', { class: 'help' }, gestures, ...tables), wide: true });
  }
}
