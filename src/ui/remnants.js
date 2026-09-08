// Remnants screen: "what fits here?" search on top, registry cards with thumbnails and status,
// detail sheet (note / status / delete / open measurement), manual add.
import { h, clear, toast, sheet, confirmDialog, bigButton, numberStepper, textField, section, emptyState, spinner, badge, fmtMm, fmtDate } from './components.js';

export const title = 'Остатки';

const STATUS_TEXT = { available: 'свободен', used: 'использован' };

function statusBadge(r) {
  return r.status === 'used' ? badge(STATUS_TEXT.used, 'neutral') : badge(STATUS_TEXT.available, 'ok');
}

function areaDm2(r) {
  const a = Number(r.areaMm2) > 0 ? Number(r.areaMm2) : (Number(r.lengthMm) || 0) * (Number(r.widthMm) || 0);
  return (a / 1e4).toFixed(2);
}

function remnantLine(r) {
  return `${areaDm2(r)} дм² · ${r.thicknessMm ? r.thicknessMm + ' мм' : 'толщина не задана'} · ${fmtDate(r.createdAt)}`;
}

function placementText(hit) {
  const p = hit.placement;
  if (!p) return 'поместится';
  const angle = Math.round(Number(p.angleDeg) || 0);
  const parts = [`угол ${angle}°`];
  if (p.rotated) parts.push('повёрнута');
  if (Number.isFinite(hit.wasteMm2)) parts.push(`отход ${(hit.wasteMm2 / 1e4).toFixed(2)} дм²`);
  return parts.join(', ');
}

export function sortRemnants(list) {
  const rank = (r) => (r.status === 'used' ? 1 : 0);
  return list.slice().sort((a, b) => rank(a) - rank(b) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function mount(root, ctx) {
  const urls = [];
  let remnants = [];
  let search = null; // { need, marginMm, results }
  let alive = true;

  const page = h('div', { class: 'page', dataset: { view: 'remnants' } });
  root.appendChild(page);

  const lenS = numberStepper({ id: 'rem-search-length', label: 'Длина детали, мм', value: 300, step: 10, min: 10, digits: 0 });
  const widS = numberStepper({ id: 'rem-search-width', label: 'Ширина детали, мм', value: 200, step: 10, min: 10, digits: 0 });
  const marS = numberStepper({ id: 'rem-search-margin', label: 'Запас на рез с каждой стороны, мм', value: 5, step: 1, min: 0, max: 100, digits: 0 });
  const findBtn = bigButton('Найти', runSearch, { kind: 'primary', icon: '🔍', className: 'rem-search-btn' });
  const resetBtn = bigButton('Сбросить', () => { search = null; renderList(); }, { kind: 'secondary', className: 'rem-search-reset' });
  page.appendChild(section('Что сюда поместится?', h('div', { class: 'muted' }, 'Введите размер нужной детали — покажем свободные остатки, из которых её можно вырезать.'), lenS, widS, marS, h('div', { class: 'btn-row' }, findBtn, resetBtn)));

  page.appendChild(bigButton('Добавить вручную', addManual, { kind: 'secondary', icon: '＋', className: 'rem-add-btn' }));
  const listTitle = h('h2', { class: 'section-title' }, 'Остатки');
  const listEl = h('div', { class: 'list' });
  page.appendChild(h('section', { class: 'section' }, listTitle, listEl));

  function revokeAll() { urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); }

  async function load() {
    if (!ctx.db) { remnants = []; return; }
    try { remnants = sortRemnants(await ctx.db.listRemnants()); } catch (e) { console.warn(e); toast('Не удалось загрузить остатки: ' + (e.message || e), 'error'); remnants = []; }
  }

  function thumb(r) {
    if (r.photo instanceof Blob) {
      const u = URL.createObjectURL(r.photo); urls.push(u);
      return h('img', { class: 'card-thumb', src: u, alt: '' });
    }
    return h('div', { class: 'card-thumb', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' } }, '🧩');
  }

  function card(r, hit = null) {
    return h('div', { class: 'card clickable', dataset: { remnantId: r.id }, 'on:click': () => openRemnant(r) },
      thumb(r),
      h('div', { class: 'card-main' },
        h('div', { class: 'card-title' }, `${r.id} · ${fmtMm(r.lengthMm)} × ${fmtMm(r.widthMm)} мм`),
        h('div', { class: 'card-sub' }, remnantLine(r)),
        r.note ? h('div', { class: 'card-sub' }, r.note) : null,
        r.status === 'used' && r.usedFor ? h('div', { class: 'card-sub' }, 'Использован: ' + r.usedFor) : null,
        hit ? h('div', { class: 'card-sub', style: { color: 'var(--ok)' } }, placementText(hit)) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flex: '0 0 auto' } },
        hit ? badge('поместится', 'ok') : statusBadge(r)));
  }

  function renderList() {
    revokeAll();
    clear(listEl);
    if (!ctx.db) { listTitle.textContent = 'Остатки'; listEl.appendChild(emptyState('База данных недоступна — остатки не сохраняются')); return; }
    if (search) {
      const free = remnants.filter((r) => r.status !== 'used').length;
      listTitle.textContent = `Подходят под ${fmtMm(search.need.lengthMm, 0)} × ${fmtMm(search.need.widthMm, 0)} мм: ${search.results.length} из ${free} свободных`;
      if (!search.results.length) { listEl.appendChild(emptyState('Ничего не подходит. Попробуйте меньший запас на рез или другой размер.')); return; }
      for (const hit of search.results) listEl.appendChild(card(hit.remnant, hit));
      return;
    }
    listTitle.textContent = `Остатки (${remnants.length})`;
    if (!remnants.length) { listEl.appendChild(emptyState('Остатков пока нет. Снимите остаток в режиме «Остаток» на камере или добавьте вручную.')); return; }
    for (const r of remnants) listEl.appendChild(card(r));
  }

  async function runSearch() {
    const need = { lengthMm: lenS.getValue(), widthMm: widS.getValue() };
    const marginMm = marS.getValue();
    let mod;
    try { mod = await import('../remnants/fit.js'); } catch (e) { console.warn(e); toast('Модуль подбора остатков недоступен: ' + (e.message || e), 'error'); return; }
    let results = [];
    try { results = mod.findFittingRemnants(remnants, need, { marginMm }); } catch (e) { console.warn(e); toast('Ошибка подбора: ' + (e.message || e), 'error'); return; }
    search = { need, marginMm, results };
    renderList();
    if (results.length) toast(`Подходит остатков: ${results.length}`, 'ok'); else toast('Подходящих остатков нет', 'info');
  }

  async function persist(r) {
    try { await ctx.db.putRemnant(r); } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'error'); throw e; }
  }

  function openRemnant(r) {
    const body = h('div', { class: 'page', style: { padding: '0' } });
    let s;
    const rerender = () => {
      clear(body);
      body.appendChild(h('dl', { class: 'kv' },
        h('dt', {}, 'Размер'), h('dd', {}, `${fmtMm(r.lengthMm)} × ${fmtMm(r.widthMm)} мм`),
        h('dt', {}, 'Площадь'), h('dd', {}, `${areaDm2(r)} дм²`),
        h('dt', {}, 'Толщина'), h('dd', {}, r.thicknessMm ? `${r.thicknessMm} мм` : '—'),
        h('dt', {}, 'Форма'), h('dd', {}, Array.isArray(r.polygonMm) && r.polygonMm.length >= 3 ? 'по контуру замера' : 'прямоугольник'),
        h('dt', {}, 'Добавлен'), h('dd', {}, fmtDate(r.createdAt)),
        h('dt', {}, 'Статус'), h('dd', {}, statusBadge(r))));
      const noteArea = h('textarea', { class: 'input', id: 'rem-note', placeholder: 'например: царапина у кромки, лежит на стеллаже 3' }, r.note || '');
      noteArea.addEventListener('change', async () => { r.note = noteArea.value.trim(); await persist(r); toast('Примечание сохранено', 'ok'); });
      body.appendChild(h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'rem-note' }, 'Примечание'), noteArea));
      if (r.status === 'used') {
        const usedF = textField({ label: 'На что использован (необязательно)', value: r.usedFor || '', placeholder: 'например: заказ 2026-118, деталь SHELF-04', id: 'rem-used-for', onChange: async (v) => { r.usedFor = v.trim() || null; await persist(r); toast('Сохранено', 'ok'); } });
        body.appendChild(usedF);
        body.appendChild(bigButton('Вернуть в свободные', async () => { r.status = 'available'; r.usedFor = null; await persist(r); toast(`${r.id} снова свободен`, 'ok'); rerender(); }, { kind: 'secondary', icon: '↩' }));
      } else {
        body.appendChild(bigButton('Отметить использованным', async () => { r.status = 'used'; await persist(r); toast(`${r.id} отмечен как использованный`, 'ok'); rerender(); }, { kind: 'primary', icon: '✓' }));
      }
      const rowBtns = [];
      if (r.measurementId) rowBtns.push(bigButton('Открыть замер', () => { s.close(); ctx.navigate(`#/result/${encodeURIComponent(r.measurementId)}`); }, { kind: 'secondary', icon: '📷' }));
      rowBtns.push(bigButton('Удалить', async () => {
        const ok = await confirmDialog(`Удалить остаток ${r.id}?`, { okText: 'Удалить', danger: true });
        if (!ok) return;
        try { await ctx.db.deleteRemnant(r.id); } catch (e) { toast('Не удалось удалить: ' + (e.message || e), 'error'); return; }
        remnants = remnants.filter((x) => x.id !== r.id);
        if (search) search.results = search.results.filter((x) => x.remnant.id !== r.id);
        toast(`Остаток ${r.id} удалён`, 'ok');
        s.close();
      }, { kind: 'danger', icon: '🗑' }));
      body.appendChild(h('div', { class: 'btn-row' }, rowBtns));
    };
    rerender();
    s = sheet({ title: `${r.id} · ${fmtMm(r.lengthMm)} × ${fmtMm(r.widthMm)} мм`, content: body, onClose: () => { if (alive) { remnants = sortRemnants(remnants); renderList(); } } });
  }

  function addManual() {
    if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
    const defThick = Number(ctx.settings?.thickness?.thicknessMm) > 0 ? Number(ctx.settings.thickness.thicknessMm) : 1;
    const lS = numberStepper({ id: 'rem-add-length', label: 'Длина, мм', value: 500, step: 10, min: 10, digits: 0 });
    const wS = numberStepper({ id: 'rem-add-width', label: 'Ширина, мм', value: 300, step: 10, min: 10, digits: 0 });
    const tS = numberStepper({ id: 'rem-add-thickness', label: 'Толщина, мм', value: defThick, step: 0.1, min: 0, max: 50, digits: 1 });
    const noteF = textField({ label: 'Примечание (необязательно)', value: '', placeholder: 'например: стеллаж 3, полка сверху', id: 'rem-add-note' });
    sheet({
      title: 'Новый остаток',
      content: h('div', { class: 'page', style: { padding: '0' } }, h('div', { class: 'muted' }, 'Прямоугольный остаток по габаритам. Остаток сложной формы лучше снять камерой в режиме «Остаток».'), lS, wS, tS, noteF),
      actions: [
        { text: 'Отмена', kind: 'secondary' },
        {
          text: 'Сохранить',
          kind: 'primary',
          onClick: async () => {
            const a = lS.getValue(); const b = wS.getValue();
            const L = Math.max(a, b); const W = Math.min(a, b);
            if (!(L > 0 && W > 0)) throw new Error('Укажите длину и ширину');
            const id = await ctx.db.nextRemnantId();
            const r = {
              id, createdAt: new Date().toISOString(), lengthMm: L, widthMm: W, areaMm2: L * W, polygonMm: null,
              thicknessMm: tS.getValue(), photo: null, status: 'available', note: noteF.querySelector('input').value.trim(),
              measurementId: null, usedFor: null,
            };
            await ctx.db.putRemnant(r);
            ctx.vibrate(60);
            toast(`Остаток ${id} добавлен: ${fmtMm(L)} × ${fmtMm(W)} мм`, 'ok');
            await load();
            if (search) await runSearch(); else renderList();
          },
        },
      ],
    });
  }

  listEl.appendChild(spinner('Загрузка…'));
  await load();
  if (!alive) return () => {};
  renderList();
  return () => { alive = false; revokeAll(); };
}
