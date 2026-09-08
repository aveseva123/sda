// Orders screen: list with DXF/CSV/XLSX import and manual creation ('#/orders'),
// order detail with editable header, parts table, measurements by order ('#/orders/:id').
import { h, clear, toast, sheet, confirmDialog, bigButton, numberStepper, selectField, textField, section, emptyState, spinner, badge, fmtMm, fmtDate } from './components.js';

export const title = 'Заказы';

const THICKNESS_OPTIONS = [0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6];
const CURRENT_KEY = 'sda.currentOrderId';
const SOURCE_LABEL = { dxf: 'DXF', csv: 'CSV', xlsx: 'XLSX', manual: 'вручную' };

async function genId() {
  try {
    const mod = await import('../store/db.js');
    if (typeof mod.uid === 'function') return mod.uid();
  } catch { /* store module not available: fall back to a local id */ }
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function setCurrentOrder(ctx, id) {
  ctx.state.currentOrderId = id || null;
  try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY); } catch { /* ignore */ }
}

function partCount(order) {
  return (order.parts || []).reduce((a, p) => a + (Number(p.qty) > 0 ? Number(p.qty) : 1), 0);
}

function orderTitle(o) {
  return `${o.name || 'Заказ'}${o.number ? ' №' + o.number : ''}`;
}

function baseName(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '');
}

function thicknessOptions(current) {
  const list = THICKNESS_OPTIONS.slice();
  const v = Number(current);
  if (v > 0 && !list.includes(v)) { list.push(v); list.sort((a, b) => a - b); }
  return list.map((t) => ({ value: t, text: `${t} мм` }));
}

function defaultThickness(ctx) {
  const v = Number(ctx.settings?.thickness?.thicknessMm);
  return v > 0 ? v : 1;
}

function nextPartId(order) {
  const used = new Set((order.parts || []).map((p) => String(p.id)));
  for (let i = 1; i < 1000; i++) {
    const id = `P-${String(i).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `P-${Date.now()}`;
}

function detectKind(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'dxf') return 'dxf';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (/csv/i.test(file.type || '')) return 'csv';
  if (/spreadsheet|excel/i.test(file.type || '')) return 'xlsx';
  return 'unknown';
}

function importErrorText(e) {
  const msg = e?.message || String(e);
  if (/dynamically imported module|Failed to fetch|import/i.test(msg)) return 'Модуль разбора файлов ещё не установлен: ' + msg;
  return 'Не удалось разобрать файл: ' + msg;
}

// Parse an uploaded nest / parts list into { type, parts, warnings, sheet, info }.
export async function parseOrderFile(file) {
  const kind = detectKind(file);
  if (kind === 'xlsx') {
    const [{ parseXlsx }, { rowsToParts }] = await Promise.all([import('../match/xlsx.js'), import('../match/csv.js')]);
    const rows = await parseXlsx(await file.arrayBuffer());
    const r = rowsToParts(rows);
    return { type: 'xlsx', parts: r.parts || [], warnings: r.warnings || [], sheet: null, info: `Таблица XLSX · строк: ${rows.length}` };
  }
  const text = await file.text();
  const looksDxf = /(^|\n)\s*SECTION\s*(\r?\n)/.test(text) && /ENTITIES/.test(text);
  if (kind === 'dxf' || (kind === 'unknown' && looksDxf)) {
    const [{ parseDxf }, { extractParts }] = await Promise.all([import('../match/dxf.js'), import('../match/parts.js')]);
    const doc = parseDxf(text);
    const r = extractParts(doc);
    const strategy = r.strategy === 'blocks' ? 'по блокам' : 'по замкнутым контурам';
    const units = r.unitsUsed === 'in' ? 'дюймы → мм' : 'мм';
    const sheetText = r.sheet ? ` · лист ${fmtMm(r.sheet.lengthMm, 0)}×${fmtMm(r.sheet.widthMm, 0)} мм` : ' · лист не найден';
    return { type: 'dxf', parts: r.parts || [], warnings: r.warnings || [], sheet: r.sheet || null, info: `DXF: детали ${strategy} · единицы: ${units}${sheetText}` };
  }
  const { parseCsv, rowsToParts } = await import('../match/csv.js');
  const rows = parseCsv(text);
  const r = rowsToParts(rows);
  return { type: 'csv', parts: r.parts || [], warnings: r.warnings || [], sheet: null, info: `Таблица CSV · строк: ${rows.length}` };
}

function partsTable(parts, { onRow = null } = {}) {
  const rows = parts.map((p, i) => {
    const tr = h('tr', { class: onRow ? 'clickable' : '', style: onRow ? { cursor: 'pointer' } : null },
      h('td', { style: { padding: '18px 6px', fontWeight: '700' } }, String(p.id ?? '')),
      h('td', { class: 'num', style: { padding: '18px 6px' } }, fmtMm(p.lengthMm)),
      h('td', { class: 'num', style: { padding: '18px 6px' } }, fmtMm(p.widthMm)),
      h('td', { class: 'num', style: { padding: '18px 6px' } }, String(p.qty || 1)),
      onRow ? h('td', { style: { padding: '18px 6px' } }, '›') : null);
    if (onRow) tr.addEventListener('click', () => onRow(i, p));
    return tr;
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table', dataset: { role: 'parts' } },
    h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', { class: 'num' }, 'L, мм'), h('th', { class: 'num' }, 'W, мм'), h('th', { class: 'num' }, 'Кол-во'), onRow ? h('th', {}, '') : null)),
    h('tbody', {}, rows)));
}

function orderMeta(ctx, order) {
  const src = order.source || {};
  const srcText = src.type ? `${SOURCE_LABEL[src.type] || src.type}${src.fileName ? ' ' + src.fileName : ''}` : '';
  return [`${partCount(order)} дет.`, order.thicknessMm ? `${order.thicknessMm} мм` : 'толщина не задана', fmtDate(order.createdAt), srcText].filter(Boolean).join(' · ');
}

// Preview sheet after a successful parse: parts table, warnings, editable name/number/thickness, save.
function showImportPreview(ctx, file, parsed, onSaved) {
  const nameF = textField({ label: 'Название заказа', value: baseName(file.name) || 'Заказ', id: 'order-import-name' });
  const numF = textField({ label: 'Номер заказа', value: '', placeholder: 'например 2026-118', id: 'order-import-number' });
  const thick = defaultThickness(ctx);
  const thickF = selectField({ label: 'Толщина, мм', options: thicknessOptions(thick), value: thick, id: 'order-import-thickness' });
  const total = parsed.parts.reduce((a, p) => a + (Number(p.qty) > 0 ? Number(p.qty) : 1), 0);
  const content = h('div', { class: 'page', style: { padding: '0' } },
    h('div', { class: 'big' }, `Позиций: ${parsed.parts.length} · деталей: ${total}`),
    h('div', { class: 'muted' }, parsed.info),
    parsed.warnings.length ? h('div', { class: 'warn-list' }, parsed.warnings.map((w) => h('div', { class: 'warn-item' }, String(w)))) : null,
    parsed.parts.length ? partsTable(parsed.parts) : emptyState('Детали в файле не найдены — можно сохранить пустой заказ и добавить их вручную'),
    nameF, numF, thickF);
  sheet({
    title: 'Импорт: ' + (file.name || 'файл'),
    content,
    actions: [
      { text: 'Отмена', kind: 'secondary' },
      {
        text: 'Сохранить',
        kind: 'primary',
        onClick: async () => {
          if (!ctx.db) throw new Error('База данных недоступна — заказ не сохранён');
          const name = nameF.querySelector('input').value.trim() || baseName(file.name) || 'Заказ';
          const number = numF.querySelector('input').value.trim();
          const thicknessMm = Number(thickF.querySelector('select').value) || thick;
          const order = {
            id: await genId(), name, number, createdAt: new Date().toISOString(),
            source: { type: parsed.type, fileName: file.name || '' }, thicknessMm,
            parts: parsed.parts.map((p) => ({ ...p, qty: Number(p.qty) > 0 ? Number(p.qty) : 1 })), sheet: parsed.sheet || null,
          };
          await ctx.db.putOrder(order);
          setCurrentOrder(ctx, order.id);
          ctx.vibrate(60);
          toast(`Заказ «${name}» сохранён: ${order.parts.length} позиций · теперь он текущий`, 'ok');
          if (onSaved) await onSaved(order);
        },
      },
    ],
  });
}

function showCreateManual(ctx, onSaved) {
  const nameF = textField({ label: 'Название заказа', value: '', placeholder: 'например Кронштейны для ООО «Вектор»', id: 'order-new-name' });
  const numF = textField({ label: 'Номер заказа', value: '', placeholder: 'например 2026-118', id: 'order-new-number' });
  const thick = defaultThickness(ctx);
  const thickF = selectField({ label: 'Толщина, мм', options: thicknessOptions(thick), value: thick, id: 'order-new-thickness' });
  const content = h('div', { class: 'page', style: { padding: '0' } },
    h('div', { class: 'muted' }, 'Пустой заказ — детали добавляются на экране заказа кнопкой «Добавить деталь».'),
    nameF, numF, thickF);
  sheet({
    title: 'Новый заказ',
    content,
    actions: [
      { text: 'Отмена', kind: 'secondary' },
      {
        text: 'Создать',
        kind: 'primary',
        onClick: async () => {
          if (!ctx.db) throw new Error('База данных недоступна — заказ не сохранён');
          const name = nameF.querySelector('input').value.trim() || 'Заказ';
          const number = numF.querySelector('input').value.trim();
          const order = {
            id: await genId(), name, number, createdAt: new Date().toISOString(),
            source: { type: 'manual', fileName: '' }, thicknessMm: Number(thickF.querySelector('select').value) || thick, parts: [], sheet: null,
          };
          await ctx.db.putOrder(order);
          setCurrentOrder(ctx, order.id);
          toast(`Заказ «${name}» создан`, 'ok');
          if (onSaved) await onSaved(order);
        },
      },
    ],
  });
}

// ---------- List screen ----------
async function mountList(root, ctx) {
  const page = h('div', { class: 'page', dataset: { view: 'orders-list' } });
  root.appendChild(page);
  const fileInput = h('input', { type: 'file', id: 'orders-file-input', accept: '.dxf,.csv,.xlsx,.xls,text/csv', style: { display: 'none' } });
  const importBtn = bigButton('Импорт DXF / CSV / XLSX', () => fileInput.click(), { kind: 'primary', icon: '📂', className: 'orders-import-btn' });
  const manualBtn = bigButton('Создать вручную', () => showCreateManual(ctx, async (o) => { await renderList(); ctx.navigate(`#/orders/${encodeURIComponent(o.id)}`); }), { kind: 'secondary', icon: '＋' });
  const listTitle = h('h2', { class: 'section-title' }, 'Список заказов');
  const listEl = h('div', { class: 'list' });
  page.appendChild(importBtn);
  page.appendChild(manualBtn);
  page.appendChild(fileInput);
  page.appendChild(h('section', { class: 'section' }, listTitle, listEl));

  async function renderList() {
    clear(listEl);
    if (!ctx.db) {
      listTitle.textContent = 'Список заказов';
      listEl.appendChild(emptyState('База данных недоступна — заказы не сохраняются'));
      return;
    }
    listEl.appendChild(spinner('Загрузка…'));
    let orders = [];
    try { orders = await ctx.db.listOrders(); } catch (e) { console.warn(e); toast('Не удалось загрузить заказы: ' + (e.message || e), 'error'); }
    orders = orders.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    clear(listEl);
    listTitle.textContent = `Список заказов (${orders.length})`;
    if (!orders.length) { listEl.appendChild(emptyState('Заказов пока нет. Импортируйте раскрой DXF или таблицу CSV/XLSX, либо создайте заказ вручную.')); return; }
    for (const o of orders) {
      const isCurrent = ctx.state.currentOrderId === o.id;
      listEl.appendChild(h('div', { class: 'card clickable', dataset: { orderId: o.id }, 'on:click': () => ctx.navigate(`#/orders/${encodeURIComponent(o.id)}`) },
        h('div', { class: 'card-main' },
          h('div', { class: 'card-title' }, orderTitle(o), isCurrent ? [' ', badge('текущий', 'info')] : null),
          h('div', { class: 'card-sub' }, orderMeta(ctx, o))),
        h('span', { class: 'big' }, '›')));
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const parsed = await parseOrderFile(file);
      showImportPreview(ctx, file, parsed, async () => { await renderList(); });
    } catch (e) {
      console.error(e);
      toast(importErrorText(e), 'error', 5000);
    }
  });

  await renderList();
  return () => {};
}

// ---------- Detail screen ----------
async function mountDetail(root, ctx, id) {
  if (!ctx.db) {
    root.appendChild(h('div', { class: 'page' }, emptyState('База данных недоступна'), bigButton('К списку заказов', () => ctx.navigate('#/orders'), { kind: 'secondary' })));
    return () => {};
  }
  let order = null;
  try { order = await ctx.db.getOrder(id); } catch (e) { console.warn(e); }
  if (!order) {
    root.appendChild(h('div', { class: 'page' }, emptyState('Заказ не найден'), bigButton('К списку заказов', () => ctx.navigate('#/orders'), { kind: 'secondary' })));
    return () => {};
  }
  order.parts = Array.isArray(order.parts) ? order.parts : [];
  const page = h('div', { class: 'page', dataset: { view: 'order-detail', orderId: order.id } });
  root.appendChild(page);
  const urls = [];
  let alive = true;

  async function persist() {
    try { await ctx.db.putOrder(order); } catch (e) { toast('Не удалось сохранить заказ: ' + (e.message || e), 'error'); throw e; }
  }

  function editHeader() {
    const nameF = textField({ label: 'Название заказа', value: order.name || '', id: 'order-edit-name' });
    const numF = textField({ label: 'Номер заказа', value: order.number || '', id: 'order-edit-number' });
    const thickF = selectField({ label: 'Толщина, мм', options: thicknessOptions(order.thicknessMm), value: order.thicknessMm || defaultThickness(ctx), id: 'order-edit-thickness' });
    sheet({
      title: 'Изменить заказ',
      content: h('div', { class: 'page', style: { padding: '0' } }, nameF, numF, thickF),
      actions: [
        { text: 'Отмена', kind: 'secondary' },
        {
          text: 'Сохранить',
          kind: 'primary',
          onClick: async () => {
            order.name = nameF.querySelector('input').value.trim() || 'Заказ';
            order.number = numF.querySelector('input').value.trim();
            order.thicknessMm = Number(thickF.querySelector('select').value) || order.thicknessMm;
            await persist();
            toast('Заказ обновлён', 'ok');
            render();
          },
        },
      ],
    });
  }

  function editPart(index) {
    const isNew = index < 0;
    const src = isNew ? { id: nextPartId(order), lengthMm: 100, widthMm: 100, qty: 1, polygonMm: null, areaMm2: 10000, rectangular: true, source: 'list' } : order.parts[index];
    const idF = textField({ label: 'ID детали', value: String(src.id ?? ''), id: 'part-edit-id' });
    const lS = numberStepper({ label: 'Длина, мм', value: src.lengthMm, step: 1, min: 1, digits: 1, id: 'part-edit-length' });
    const wS = numberStepper({ label: 'Ширина, мм', value: src.widthMm, step: 1, min: 1, digits: 1, id: 'part-edit-width' });
    const qS = numberStepper({ label: 'Количество, шт.', value: src.qty || 1, step: 1, min: 1, digits: 0, id: 'part-edit-qty' });
    const actions = [];
    if (!isNew) {
      actions.push({
        text: 'Удалить',
        kind: 'danger',
        onClick: async () => {
          const ok = await confirmDialog(`Удалить деталь ${src.id}?`, { okText: 'Удалить', danger: true });
          if (!ok) return false;
          order.parts.splice(index, 1);
          await persist();
          toast('Деталь удалена', 'ok');
          render();
          return true;
        },
      });
    }
    actions.push({
      text: 'Сохранить',
      kind: 'primary',
      onClick: async () => {
        const newId = idF.querySelector('input').value.trim() || src.id;
        let L = lS.getValue(); let W = wS.getValue();
        if (W > L) { const t = L; L = W; W = t; }
        const qty = Math.max(1, Math.round(qS.getValue()));
        const dimsChanged = isNew || Math.abs(L - src.lengthMm) > 1e-9 || Math.abs(W - src.widthMm) > 1e-9;
        const part = { ...src, id: newId, lengthMm: L, widthMm: W, qty };
        if (dimsChanged) { part.polygonMm = null; part.areaMm2 = L * W; part.rectangular = true; if (!isNew) part.source = 'list'; }
        if (isNew) order.parts.push(part); else order.parts[index] = part;
        await persist();
        toast(isNew ? `Деталь ${newId} добавлена` : 'Деталь сохранена', 'ok');
        render();
      },
    });
    sheet({ title: isNew ? 'Новая деталь' : `Деталь ${src.id}`, content: h('div', { class: 'page', style: { padding: '0' } }, idF, lS, wS, qS), actions });
  }

  function measurementSummary(m) {
    const n = (m.result && m.result.parts && m.result.parts.length) || 0;
    const out = [h('span', {}, `Деталей: ${n}`)];
    if (m.match) {
      const missing = (m.match.missing || []).reduce((a, x) => a + (x.qtyMissing || 0), 0);
      const extra = (m.match.extra || []).length;
      out.push(' ', badge(`найдено ${(m.match.matches || []).length}`, 'ok'), ' ', badge(`не хватает ${missing}`, missing ? 'warn' : 'neutral'), ' ', badge(`лишних ${extra}`, extra ? 'err' : 'neutral'));
    } else {
      out.push(' ', badge('без сверки', 'neutral'));
    }
    return out;
  }

  async function renderMeasurements(container) {
    clear(container);
    container.appendChild(spinner('Загрузка…'));
    let list = [];
    try { list = await ctx.db.listMeasurements({ orderId: order.id }); } catch (e) { console.warn(e); }
    if (!alive) return;
    clear(container);
    list = list.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!list.length) { container.appendChild(emptyState('Замеров по этому заказу ещё нет')); return; }
    for (const m of list) {
      let thumb = null;
      if (m.photo instanceof Blob) {
        const u = URL.createObjectURL(m.photo); urls.push(u);
        thumb = h('img', { class: 'card-thumb', src: u, alt: '' });
      }
      container.appendChild(h('div', { class: 'card clickable', dataset: { measurementId: m.id }, 'on:click': () => ctx.navigate(`#/result/${encodeURIComponent(m.id)}`) },
        thumb,
        h('div', { class: 'card-main' },
          h('div', { class: 'card-title' }, fmtDate(m.createdAt)),
          h('div', { class: 'card-sub' }, measurementSummary(m))),
        h('span', { class: 'big' }, '›')));
    }
  }

  function render() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    clear(page);
    const isCurrent = ctx.state.currentOrderId === order.id;
    const header = h('section', { class: 'section' },
      h('div', { class: 'row' },
        h('div', {},
          h('div', { class: 'big' }, orderTitle(order)),
          h('div', { class: 'muted' }, orderMeta(ctx, order))),
        h('div', { style: { flex: '0 0 auto', textAlign: 'right' } }, isCurrent ? badge('текущий заказ', 'info') : null)),
      order.sheet ? h('div', { class: 'muted' }, `Лист из раскроя: ${fmtMm(order.sheet.lengthMm, 0)} × ${fmtMm(order.sheet.widthMm, 0)} мм`) : null,
      bigButton(isCurrent ? 'Это текущий заказ' : 'Сделать текущим заказом', () => { setCurrentOrder(ctx, order.id); toast('Заказ выбран для новых замеров', 'ok'); render(); }, { kind: 'primary', icon: '✓', disabled: isCurrent, className: 'order-make-current' }),
      h('div', { class: 'btn-row' },
        bigButton('Новый замер', () => { setCurrentOrder(ctx, order.id); ctx.navigate('#/camera'); }, { kind: 'secondary', icon: '📷' }),
        bigButton('Изменить', editHeader, { kind: 'secondary', icon: '✎' })));
    page.appendChild(header);

    const partsEl = order.parts.length
      ? partsTable(order.parts, { onRow: (i) => editPart(i) })
      : emptyState('Деталей нет — добавьте вручную');
    page.appendChild(section(`Детали: ${order.parts.length} позиций · ${partCount(order)} шт.`, partsEl, bigButton('Добавить деталь', () => editPart(-1), { kind: 'secondary', icon: '＋' })));

    const measEl = h('div', { class: 'list' });
    page.appendChild(section('Замеры по заказу', measEl));
    renderMeasurements(measEl);

    page.appendChild(h('div', { class: 'btn-row' },
      bigButton('К списку заказов', () => ctx.navigate('#/orders'), { kind: 'secondary' }),
      bigButton('Удалить заказ', async () => {
        const ok = await confirmDialog(`Удалить заказ «${orderTitle(order)}»? Замеры останутся, но потеряют привязку к заказу.`, { okText: 'Удалить', danger: true });
        if (!ok) return;
        try { await ctx.db.deleteOrder(order.id); } catch (e) { toast('Не удалось удалить: ' + (e.message || e), 'error'); return; }
        if (ctx.state.currentOrderId === order.id) setCurrentOrder(ctx, null);
        toast('Заказ удалён', 'ok');
        ctx.navigate('#/orders');
      }, { kind: 'danger' })));
  }

  render();
  return () => { alive = false; urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); };
}

export async function mount(root, ctx, params = {}) {
  if (params && params.id) return mountDetail(root, ctx, params.id);
  return mountList(root, ctx);
}
