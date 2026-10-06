// Views panel (project browser): floor plans per level, 3D views, saved
// viewpoints, elevations and sections.

import { h } from './form.js';
import { icon } from './icons.js';

export class ViewsPanel {
  constructor(app, el) {
    this.app = app;
    this.el = el;
  }

  row({ label, sub, iconName, active, onOpen, extra }) {
    const btn = h(
      'button',
      { type: 'button', class: `vrow ${active ? 'on' : ''}`, onclick: onOpen, 'aria-current': active ? 'true' : null },
      h('span', { class: 'vrow-ic', html: icon(iconName) }),
      h('span', { class: 'vrow-text' }, h('span', { class: 'vrow-label', text: label }), sub ? h('span', { class: 'vrow-sub', text: sub }) : null),
    );
    return h('div', { class: 'vrow-wrap' }, btn, extra || null);
  }

  iconBtn(name, title, run) {
    return h('button', { type: 'button', class: 'icon-btn sm', title, 'aria-label': title, html: icon(name), onclick: (e) => { e.stopPropagation(); run(); } });
  }

  render() {
    const app = this.app;
    const doc = app.model.doc;
    const cur = app.current3DView || {};
    const show3d = app.layout !== 'plan';
    const el = this.el;
    el.innerHTML = '';

    const sect = (title, ...kids) => h('section', { class: 'vsect' }, h('h3', { class: 'vsect-title', text: title }), ...kids);

    const levels = [...doc.levels].sort((a, b) => b.elevation - a.elevation);
    el.append(
      sect(
        'Floor plans',
        ...levels.map((l) =>
          this.row({
            label: l.name,
            sub: `Floor at ${app.fmt(l.elevation)} · walls ${app.fmt(l.height)}`,
            iconName: 'plan',
            active: l.id === app.activeLevel,
            onOpen: () => app.openView({ type: 'plan', level: l.id }),
            extra: doc.levels.length > 1 ? this.iconBtn('trash', `Delete ${l.name}`, () => this.confirmDeleteLevel(l)) : null,
          }),
        ),
        h(
          'div',
          { class: 'f-buttons' },
          h('button', { type: 'button', class: 'btn', onclick: () => app.addLevel(false) }, h('span', { html: icon('plus') }), h('span', { text: 'Add level' })),
          h('button', { type: 'button', class: 'btn', onclick: () => app.addLevel(true) }, h('span', { html: icon('copy') }), h('span', { text: 'Add level with walls' })),
        ),
      ),
    );

    el.append(
      sect(
        '3D views',
        this.row({ label: '3D model', sub: 'Orbit, pan and zoom', iconName: 'cube', active: show3d && cur.type === 'model', onOpen: () => app.openView({ type: 'model' }) }),
        this.row({ label: 'Walk through', sub: 'First person at eye height', iconName: 'walk', active: show3d && cur.type === 'walk', onOpen: () => app.openView({ type: 'walk' }) }),
        ...doc.views.map((v) =>
          this.row({
            label: v.name,
            sub: 'Saved viewpoint',
            iconName: 'camera',
            active: show3d && cur.type === 'saved' && cur.id === v.id,
            onOpen: () => app.openView({ type: 'saved', id: v.id }),
            extra: h('span', { class: 'vrow-tools' },
              this.iconBtn('props', `Edit ${v.name}`, () => { app.select([v.id]); app.ui.showPanel('props'); }),
              this.iconBtn('trash', `Delete ${v.name}`, () => app.deleteIds([v.id]))),
          }),
        ),
        h('div', { class: 'f-buttons' },
          h('button', { type: 'button', class: 'btn', onclick: () => app.saveCurrent3DView() }, h('span', { html: icon('plus') }), h('span', { text: 'Save current 3D view' })),
          h('button', { type: 'button', class: 'btn', onclick: () => app.setTool('camera') }, h('span', { html: icon('camera') }), h('span', { text: 'Place camera' })),
        ),
      ),
    );

    const elev = [
      ['N', 'North'],
      ['E', 'East'],
      ['S', 'South'],
      ['W', 'West'],
    ];
    el.append(
      sect(
        'Elevations',
        h('div', { class: 'vgrid' },
          ...elev.map(([d, name]) =>
            h('button', { type: 'button', class: `vtile ${show3d && cur.type === 'elevation' && cur.dir === d ? 'on' : ''}`, onclick: () => app.openView({ type: 'elevation', dir: d }) },
              h('span', { html: icon('elevation') }), h('span', { text: name })),
          ),
        ),
      ),
    );

    el.append(
      sect(
        'Sections',
        ...doc.sections.map((s) =>
          this.row({
            label: s.name,
            sub: s.depth ? `Depth ${app.fmt(s.depth)}` : 'Cut through the whole model',
            iconName: 'section',
            active: show3d && cur.type === 'section' && cur.id === s.id,
            onOpen: () => app.openView({ type: 'section', id: s.id }),
            extra: h('span', { class: 'vrow-tools' },
              this.iconBtn('flip', 'Look the other way', () => { s.flip = !s.flip; app.model.commit('Flip section'); }),
              this.iconBtn('trash', `Delete ${s.name}`, () => app.deleteIds([s.id]))),
          }),
        ),
        doc.sections.length ? null : h('p', { class: 'f-note', text: 'Draw a section line across the plan to cut the model.' }),
        h('div', { class: 'f-buttons' }, h('button', { type: 'button', class: 'btn', onclick: () => app.setTool('section') }, h('span', { html: icon('section') }), h('span', { text: 'Draw section line' }))),
      ),
    );
  }

  async confirmDeleteLevel(l) {
    const app = this.app;
    const n = app.model.doc.walls.filter((w) => w.level === l.id).length;
    const ok = await app.ui.dialogs.confirm(`Delete ${l.name}?`, n ? `Its ${n} wall${n === 1 ? '' : 's'} and everything else on it will be removed. You can undo this.` : 'This level is empty.', 'Delete level');
    if (ok) app.deleteLevel(l.id);
  }
}
