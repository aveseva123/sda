// Compare screen: found / missing / extra lists for a batch measurement against its order.
import { h, clear, toast, sheet, bigButton, fmtMm, badge, section } from './components.js';
import { effectiveParts, recomputeMatch } from './result.js';

export const title = 'Сверка с заказом';

export async function mount(root, ctx, params) {
  const id = params.id;
  let m = (ctx.state.lastMeasurement && ctx.state.lastMeasurement.id === id) ? ctx.state.lastMeasurement : null;
  if (!m && ctx.db) { try { m = await ctx.db.getMeasurement(id); } catch (e) { console.warn(e); } }
  if (!m || !m.result) { root.appendChild(h('div', { class: 'empty' }, 'Замер не найден')); return; }
  let order = null;
  if (m.orderId && ctx.db) { try { order = await ctx.db.getOrder(m.orderId); } catch { order = null; } }

  const page = h('div', { class: 'page' });
  root.appendChild(page);

  async function persist() {
    if (!ctx.db) return;
    try { await ctx.db.putMeasurement(m); } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'error'); }
    if (ctx.state.lastMeasurementId === m.id) ctx.state.lastMeasurement = m;
  }

  async function chooseOrder() {
    if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
    const orders = await ctx.db.listOrders();
    const list = h('div', { class: 'list' });
    let s;
    for (const o of orders) {
      list.appendChild(h('div', { class: 'card clickable', 'on:click': async () => { m.orderId = o.id; order = o; s.close(); await recompute(); } },
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, `${o.name || 'Заказ'}${o.number ? ' №' + o.number : ''}`), h('div', { class: 'card-sub' }, `${(o.parts || []).length} позиций`))));
    }
    if (!orders.length) list.appendChild(h('div', { class: 'empty' }, 'Заказов нет — импортируйте DXF в разделе «Заказы»'));
    s = sheet({ title: 'Выберите заказ', content: list });
  }

  async function recompute() {
    if (!order) { render(); return; }
    try { await recomputeMatch(ctx, m, order); await persist(); } catch (e) { toast('Сопоставление недоступно: ' + (e.message || e), 'error'); }
    render();
  }

  function render() {
    clear(page);
    if (!order) {
      page.appendChild(h('div', { class: 'empty' }, 'Для сверки нужен заказ'));
      page.appendChild(bigButton('Выбрать заказ', chooseOrder));
      page.appendChild(bigButton('К фото', () => ctx.navigate(`#/result/${m.id}`), { kind: 'secondary' }));
      return;
    }
    const match = m.match;
    if (!match) { page.appendChild(h('div', { class: 'spinner-wrap' }, h('div', { class: 'spinner' }))); recompute(); return; }
    const parts = effectiveParts(m);
    const byIndex = (i) => parts.find((p) => p.index === i) || {};
    const missingQty = match.missing.reduce((a, x) => a + (x.qtyMissing || 0), 0);
    page.appendChild(h('div', { class: 'section' },
      h('div', { class: 'card-title' }, `${order.name || 'Заказ'}${order.number ? ' №' + order.number : ''}`),
      h('div', { class: 'row' }, badge(`найдено ${match.matches.length}`, 'ok'), badge(`не хватает ${missingQty}`, missingQty ? 'warn' : 'neutral'), badge(`лишних ${match.extra.length}`, match.extra.length ? 'err' : 'neutral')),
      match.ambiguous && match.ambiguous.length ? h('div', { class: 'warn-item' }, `Неоднозначно: ${match.ambiguous.map((a) => `деталь ${a.measuredIndex + 1} → ${a.planIds.join(' / ')}`).join('; ')} — уточните вручную на экране результата`) : null));

    const foundList = h('div', { class: 'list' });
    for (const x of match.matches.slice().sort((a, b) => a.measuredIndex - b.measuredIndex)) {
      const p = byIndex(x.measuredIndex);
      foundList.appendChild(h('div', { class: 'card clickable', 'on:click': () => ctx.navigate(`#/result/${m.id}`) },
        h('div', { class: 'part-index status-ok' }, String(x.measuredIndex + 1)),
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, x.planId), h('div', { class: 'card-sub' }, `факт ${fmtMm(p.lengthMm)}×${fmtMm(p.widthMm)} · расхождение ${fmtMm(x.discrepancyMm)} мм${x.orientation === 'rotated' ? ' · повёрнута' : ''}${x.manual ? ' · вручную' : ''}`))));
    }
    if (!match.matches.length) foundList.appendChild(h('div', { class: 'empty' }, 'Совпадений нет'));
    page.appendChild(section(`Найдено (${match.matches.length})`, foundList));

    const missingList = h('div', { class: 'list' });
    for (const x of match.missing) {
      missingList.appendChild(h('div', { class: 'card' }, h('div', { class: 'part-index status-extra' }, `×${x.qtyMissing}`),
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, x.planId), h('div', { class: 'card-sub' }, `план ${fmtMm(x.lengthMm)}×${fmtMm(x.widthMm)} · найдено ${x.qtyFound} из ${x.qtyPlanned}`))));
    }
    if (!match.missing.length) missingList.appendChild(h('div', { class: 'empty' }, 'Все детали на месте'));
    page.appendChild(section(`Не хватает (${missingQty})`, missingList));

    const extraList = h('div', { class: 'list' });
    for (const x of match.extra) {
      const p = byIndex(x.measuredIndex);
      extraList.appendChild(h('div', { class: 'card clickable', 'on:click': () => ctx.navigate(`#/result/${m.id}`) },
        h('div', { class: 'part-index status-ambiguous' }, String(x.measuredIndex + 1)),
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, `${fmtMm(p.lengthMm)} × ${fmtMm(p.widthMm)} мм`), h('div', { class: 'card-sub' }, x.nearest ? `ближайшая ${x.nearest.planId} (±${fmtMm(x.nearest.discrepancyMm)} мм)` : 'нет похожих в заказе'))));
    }
    if (!match.extra.length) extraList.appendChild(h('div', { class: 'empty' }, 'Лишних деталей нет'));
    page.appendChild(section(`Лишнее (${match.extra.length})`, extraList));

    page.appendChild(h('div', { class: 'btn-row' },
      bigButton('Экспорт CSV', async () => {
        try {
          const [{ compareToCsv }, { saveOrShare }] = await Promise.all([import('../export/csv.js'), import('../export/share.js')]);
          const csv = compareToCsv({ order, measurement: m, match });
          await saveOrShare(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `sverka-${(order.number || order.name || 'zakaz').toString().replace(/[^\wа-яА-Я-]+/g, '_')}.csv`);
        } catch (e) { toast('Экспорт недоступен: ' + (e.message || e), 'error'); }
      }, { kind: 'primary' }),
      bigButton('Пересчитать', recompute, { kind: 'secondary' })));
    page.appendChild(h('div', { class: 'btn-row' }, bigButton('Сменить заказ', chooseOrder, { kind: 'secondary' }), bigButton('К фото', () => ctx.navigate(`#/result/${m.id}`), { kind: 'secondary' })));
  }
  render();
  return () => {};
}
