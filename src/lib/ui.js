// Small DOM helpers. No framework: the app is a handful of screens that each
// re-render themselves, and a 60-line hyperscript is enough for that.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, cls = '') => h('span', { class: `msym ${cls}`, 'aria-hidden': 'true' }, name);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function card(title, subtitle, ...body) {
  return h(
    'section',
    { class: 'card' },
    title ? h('header', { class: 'card-head' }, h('h2', {}, title), subtitle ? h('p', { class: 'sub' }, subtitle) : null) : null,
    h('div', { class: 'card-body' }, ...body)
  );
}

/** Labelled number input that reports parsed values. */
export function numberField({ label, value, min, max, step = 1, suffix, onInput, hint, id }) {
  const input = h('input', {
    type: 'number',
    value: value ?? '',
    min,
    max,
    step,
    id,
    dataset: { k: String(label) },
    onInput: (e) => onInput(e.target.value === '' ? null : Number(e.target.value)),
  });
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('span', { class: 'field-input' }, input, suffix ? h('span', { class: 'suffix' }, suffix) : null),
    hint ? h('span', { class: 'hint' }, hint) : null
  );
}

export function selectField({ label, value, options, onChange, hint, groups }) {
  const sel = h('select', { dataset: { k: String(label) }, onChange: (e) => onChange(e.target.value) });
  if (groups) {
    for (const g of groups) {
      const og = h('optgroup', { label: g.label });
      for (const o of g.options) og.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label));
      sel.appendChild(og);
    }
  } else {
    for (const o of options) sel.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label));
  }
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-input' }, sel), hint ? h('span', { class: 'hint' }, hint) : null);
}

export function sliderField({ label, value, min, max, step = 1, onInput, format }) {
  const out = h('output', {}, format ? format(value) : String(value));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    dataset: { k: String(label) },
    // Dragging only moves the readout. Committing on release means the screen
    // is not rebuilt under the thumb, which would end the drag.
    onInput: (e) => {
      out.textContent = format ? format(Number(e.target.value)) : e.target.value;
    },
    onChange: (e) => onInput(Number(e.target.value)),
  });
  return h('label', { class: 'field slider' }, h('span', { class: 'field-label' }, label, out), input);
}

export function textField({ label, value, onInput, placeholder, rows, autocapitalize }) {
  const key = { k: String(label) };
  const input = rows
    ? h('textarea', { rows, placeholder, dataset: key, autocapitalize, onInput: (e) => onInput(e.target.value) }, value || '')
    : h('input', { type: 'text', value: value || '', placeholder, dataset: key, autocapitalize, onInput: (e) => onInput(e.target.value) });
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-input' }, input));
}

export function chip(label, active, onClick) {
  return h('button', { class: `chip${active ? ' active' : ''}`, type: 'button', onClick }, label);
}

export function pill(text, tone = 'neutral') {
  return h('span', { class: `pill ${tone}` }, text);
}

export function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub ? h('span', { class: 'stat-sub' }, sub) : null);
}

export function note(tone, text) {
  return h('p', { class: `note ${tone}` }, text);
}

let toastTimer = null;
export function toast(message) {
  let el = $('#toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function confirmDialog(message, onConfirm, confirmLabel = 'Confirm') {
  const dlg = h(
    'div',
    { class: 'modal-backdrop', onClick: (e) => e.target.classList.contains('modal-backdrop') && dlg.remove() },
    h(
      'div',
      { class: 'modal' },
      h('p', {}, message),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onClick: () => dlg.remove() }, 'Cancel'),
        h(
          'button',
          {
            class: 'btn danger',
            onClick: () => {
              dlg.remove();
              onConfirm();
            },
          },
          confirmLabel
        )
      )
    )
  );
  document.body.appendChild(dlg);
}

/** Format a minutes-from-launch offset against a launch Date. */
export function clockAt(launchDate, offsetMin) {
  return new Date(launchDate.getTime() + offsetMin * 60000);
}

export function fmtClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDay(d) {
  return d.toLocaleDateString([], { weekday: 'short' });
}

export function fmtDateTime(d) {
  return `${fmtDay(d)} ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtClock(d)}`;
}
