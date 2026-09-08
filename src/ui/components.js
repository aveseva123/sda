// Tiny DOM helpers shared by all screens. Designed for big touch targets (gloves) and dark theme.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k.startsWith('on:')) el.addEventListener(k.slice(3), v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function toast(text, kind = 'info', ms = 2500) {
  let root = document.getElementById('toasts');
  if (!root) { root = h('div', { id: 'toasts' }); document.body.appendChild(root); }
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, text);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

export function fmtMm(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function bigButton(text, onClick, { kind = 'primary', icon = null, className = '', disabled = false } = {}) {
  const btn = h('button', { class: `btn btn-${kind} ${className}`.trim(), type: 'button', disabled }, icon ? h('span', { class: 'btn-icon' }, icon) : null, h('span', {}, text));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

// Bottom sheet. Returns { close }.
export function sheet({ title = '', content = null, actions = [], onClose = null, closable = true } = {}) {
  let root = document.getElementById('sheet-root');
  if (!root) { root = h('div', { id: 'sheet-root' }); document.body.appendChild(root); }
  const panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' });
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const wrap = h('div', { class: 'sheet' }, backdrop, panel);
  const api = {
    close() {
      wrap.classList.remove('show');
      setTimeout(() => { wrap.remove(); if (onClose) onClose(); }, 200);
      document.removeEventListener('keydown', onKey);
    },
    panel,
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable) api.close(); };
  document.addEventListener('keydown', onKey);
  if (closable) backdrop.addEventListener('click', () => api.close());
  panel.appendChild(h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-grip' }), title ? h('h2', { class: 'sheet-title' }, title) : null,
    closable ? h('button', { class: 'icon-btn sheet-close', type: 'button', 'aria-label': 'Закрыть', 'on:click': () => api.close() }, '✕') : null));
  const body = h('div', { class: 'sheet-body' });
  if (content) body.appendChild(content);
  panel.appendChild(body);
  if (actions.length) {
    panel.appendChild(h('div', { class: 'sheet-actions' }, actions.map((a) => bigButton(a.text, async () => {
      try { const r = await a.onClick?.(api); if (r !== false && a.closeAfter !== false) api.close(); } catch (e) { toast(e?.message || String(e), 'error'); }
    }, { kind: a.kind || 'secondary' }))));
  }
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  return api;
}

export function confirmDialog(text, { okText = 'Да', cancelText = 'Отмена', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title: '',
      content: h('p', { class: 'confirm-text' }, text),
      actions: [
        { text: cancelText, kind: 'secondary', onClick: () => { done = true; resolve(false); } },
        { text: okText, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return s;
  });
}

// Big +/- stepper for numeric input without a keyboard. onChange(value).
export function numberStepper({ value = 0, step = 1, min = -Infinity, max = Infinity, digits = 1, label = '', unit = '', onChange = null, id = null } = {}) {
  let v = Number(value) || 0;
  const input = h('input', { class: 'stepper-input', type: 'number', inputmode: 'decimal', step: String(step), value: v.toFixed(digits), id });
  const set = (nv, fire = true) => {
    v = Math.min(max, Math.max(min, Number(nv)));
    if (Number.isNaN(v)) v = 0;
    input.value = v.toFixed(digits);
    if (fire && onChange) onChange(v);
  };
  input.addEventListener('change', () => set(input.value));
  const dec = h('button', { class: 'stepper-btn', type: 'button', 'aria-label': 'Меньше', 'on:click': () => set(v - step) }, '−');
  const inc = h('button', { class: 'stepper-btn', type: 'button', 'aria-label': 'Больше', 'on:click': () => set(v + step) }, '+');
  const el = h('div', { class: 'stepper' }, label ? h('label', { class: 'stepper-label', for: id }, label) : null,
    h('div', { class: 'stepper-row' }, dec, input, unit ? h('span', { class: 'stepper-unit' }, unit) : null, inc));
  el.getValue = () => v;
  el.setValue = (nv) => set(nv, false);
  return el;
}

export function selectField({ label = '', options = [], value = null, onChange = null, id = null } = {}) {
  const sel = h('select', { class: 'select', id }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.text)));
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, label ? h('label', { class: 'field-label', for: id }, label) : null, sel);
}

export function textField({ label = '', value = '', placeholder = '', onChange = null, id = null, type = 'text' } = {}) {
  const input = h('input', { class: 'input', type, value, placeholder, id });
  if (onChange) input.addEventListener('change', () => onChange(input.value));
  return h('div', { class: 'field' }, label ? h('label', { class: 'field-label', for: id }, label) : null, input);
}

export function section(title, ...children) {
  return h('section', { class: 'section' }, title ? h('h2', { class: 'section-title' }, title) : null, ...children);
}

export function emptyState(text) {
  return h('div', { class: 'empty' }, text);
}

export function spinner(text = '') {
  return h('div', { class: 'spinner-wrap' }, h('div', { class: 'spinner' }), text ? h('div', { class: 'spinner-text' }, text) : null);
}

export function badge(text, kind = 'neutral') {
  return h('span', { class: `badge badge-${kind}` }, text);
}

export function vibrate(ms = 60) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}
