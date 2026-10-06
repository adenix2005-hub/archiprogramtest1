// Small declarative form builder used by the properties panel and dialogs.

import { icon } from './icons.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/**
 * Field spec:
 * {type:'length'|'angle'|'number'|'text'|'select'|'segmented'|'toggle'|'color'|'readonly'|'buttons'|'header'|'note',
 *  key, label, value, options:[{value,label,icon}], onChange(value), hint, placeholder, min, max, swatches}
 */
export function buildFields(app, container, fields) {
  container.innerHTML = '';
  const byKey = {};
  for (const f of fields) {
    if (!f) continue;
    const el = buildField(app, f);
    if (f.key) byKey[f.key] = el;
    container.append(el);
  }
  return byKey;
}

export function buildField(app, f) {
  const id = nextId('f');
  switch (f.type) {
    case 'header':
      return h('div', { class: 'f-header' }, f.icon ? h('span', { html: icon(f.icon) }) : null, h('span', { text: f.label }), f.extra || null);
    case 'note':
      return h('p', { class: 'f-note', text: f.label });
    case 'readonly':
      return h('div', { class: 'f-row' }, h('span', { class: 'f-label', text: f.label }), h('span', { class: 'f-value', text: f.value }));
    case 'buttons': {
      const row = h('div', { class: 'f-buttons' });
      for (const b of f.buttons) {
        if (!b) continue;
        row.append(
          h(
            'button',
            { class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`, type: 'button', onclick: b.run, title: b.title || b.label, disabled: b.disabled },
            b.icon ? h('span', { html: icon(b.icon) }) : null,
            h('span', { text: b.label }),
          ),
        );
      }
      return row;
    }
    case 'segmented': {
      const wrap = h('div', { class: 'f-row f-stack' });
      if (f.label) wrap.append(h('span', { class: 'f-label', text: f.label }));
      const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': f.label || '' });
      for (const o of f.options) {
        const btn = h(
          'button',
          {
            type: 'button',
            class: `seg-btn ${o.value === f.value ? 'on' : ''}`,
            role: 'radio',
            'aria-checked': o.value === f.value ? 'true' : 'false',
            title: o.title || o.label,
            onclick: () => {
              if (o.value === f.value) return;
              f.onChange(o.value);
            },
          },
          o.icon ? h('span', { html: icon(o.icon) }) : null,
          o.label ? h('span', { text: o.label }) : null,
        );
        seg.append(btn);
      }
      wrap.append(seg);
      return wrap;
    }
    case 'toggle': {
      const input = h('input', { type: 'checkbox', id, class: 'switch', checked: !!f.value, onchange: (e) => f.onChange(e.target.checked) });
      return h('label', { class: 'f-row f-toggle', for: id }, h('span', { class: 'f-label', text: f.label }), input);
    }
    case 'select': {
      const sel = h('select', { id, class: 'f-input', onchange: (e) => f.onChange(e.target.value) });
      for (const o of f.options) sel.append(h('option', { value: o.value, selected: o.value === f.value }, o.label));
      return h('label', { class: 'f-row', for: id }, h('span', { class: 'f-label', text: f.label }), sel);
    }
    case 'color': {
      const wrap = h('div', { class: 'f-row f-stack' }, h('span', { class: 'f-label', text: f.label }));
      const sw = h('div', { class: 'swatches' });
      for (const c of f.swatches || []) {
        sw.append(
          h('button', {
            type: 'button',
            class: `swatch ${c === f.value ? 'on' : ''}`,
            style: { background: c },
            title: c,
            'aria-label': `Colour ${c}`,
            onclick: () => f.onChange(c),
          }),
        );
      }
      const custom = h('input', { type: 'color', class: 'swatch-custom', value: /^#[0-9a-f]{6}$/i.test(f.value || '') ? f.value : '#cccccc', title: 'Custom colour', onchange: (e) => f.onChange(e.target.value) });
      sw.append(custom);
      if (f.allowNone) sw.append(h('button', { type: 'button', class: `swatch swatch-none ${!f.value ? 'on' : ''}`, title: 'Default', 'aria-label': 'Default colour', onclick: () => f.onChange(null) }));
      wrap.append(sw);
      return wrap;
    }
    default: {
      // text-like inputs: length, angle, number, text
      const isNum = f.type === 'length' || f.type === 'angle' || f.type === 'number';
      const metric = app.model.settings.units !== 'ftin' && app.model.settings.units !== 'in';
      const display = f.type === 'length' ? (Number.isFinite(f.value) ? app.fmtInput(f.value) : '') : f.type === 'angle' ? (Number.isFinite(f.value) ? String(Math.round(f.value * 100) / 100) : '') : f.value ?? '';
      const input = h('input', {
        id,
        class: 'f-input',
        type: 'text',
        value: display,
        inputmode: isNum && (metric || f.type !== 'length') ? 'decimal' : 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: f.placeholder || '',
        enterkeyhint: 'done',
      });
      let last = display;
      const commit = () => {
        const raw = input.value.trim();
        if (raw === last) return;
        let v;
        if (f.type === 'length') v = app.parse(raw);
        else if (f.type === 'angle') v = app.parseAngle(raw);
        else if (f.type === 'number') v = parseFloat(raw);
        else v = raw;
        if (isNum) {
          const bad = !Number.isFinite(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max);
          if (bad && !(f.allowEmpty && raw === '')) {
            shake(input);
            input.value = last;
            if (f.min != null && Number.isFinite(v) && v < f.min) app.toast(`Minimum is ${f.type === 'length' ? app.fmt(f.min) : f.min}`);
            return;
          }
          if (f.allowEmpty && raw === '') v = null;
        }
        last = raw;
        const res = f.onChange(v);
        if (res === false) {
          shake(input);
        }
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commit();
          input.blur();
        } else if (e.key === 'Escape') {
          input.value = last;
          input.blur();
        }
        e.stopPropagation();
      });
      input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
      const unit =
        f.type === 'length' ? (app.model.settings.units === 'ftin' ? '' : app.model.settings.units === 'in' ? 'in' : app.model.settings.units) : f.type === 'angle' ? '°' : f.unit || '';
      return h(
        'label',
        { class: 'f-row', for: id, title: f.hint || '' },
        h('span', { class: 'f-label', text: f.label }),
        h('span', { class: 'f-inputwrap' }, input, unit ? h('span', { class: 'f-unit', text: unit }) : null),
      );
    }
  }
}
