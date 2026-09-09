// Result screen: photo with overlaid contours, list of parts, part card with manual corrections,
// quality panel, identification (single mode), save as remnant, exports.
import { h, clear, toast, sheet, bigButton, numberStepper, fmtMm, fmtDate, badge, section, confirmDialog } from './components.js';

export const title = 'Результат замера';

const STATUS_COLORS = { ok: '#3ddc84', extra: '#ffb020', ambiguous: '#ff4d4f', none: '#4cc2ff', ignored: '#777' };

export function effectiveParts(m) {
  const parts = (m.result && m.result.parts) || [];
  return parts.map((p, i) => {
    const o = (m.overrides && m.overrides[p.index ?? i]) || {};
    const lengthMm = o.lengthMm ?? p.lengthMm;
    const widthMm = o.widthMm ?? p.widthMm;
    return { ...p, index: p.index ?? i, lengthMm, widthMm, planId: o.planId || null, ignored: !!o.ignored, edited: o.lengthMm !== undefined || o.widthMm !== undefined };
  });
}

export function statusOf(m, index) {
  const o = m.overrides && m.overrides[index];
  if (o && o.ignored) return 'ignored';
  if (!m.match) return 'none';
  if (m.match.ambiguous && m.match.ambiguous.some((a) => a.measuredIndex === index)) return 'ambiguous';
  if (m.match.matches.some((x) => x.measuredIndex === index)) return 'ok';
  if (m.match.extra.some((x) => x.measuredIndex === index)) return 'extra';
  return 'none';
}

export function labelOf(m, index) {
  const o = m.overrides && m.overrides[index];
  if (o && o.planId) return o.planId;
  if (m.match) {
    const x = m.match.matches.find((y) => y.measuredIndex === index);
    if (x) return x.planId;
  }
  return '';
}

// Re-run matching honouring manual plan assignments and ignored parts.
export async function recomputeMatch(ctx, m, order) {
  if (!order || !order.parts || order.parts.length === 0) { m.match = null; return null; }
  const { matchParts, partDiscrepancy } = await import('../match/assign.js');
  const parts = effectiveParts(m).filter((p) => !p.ignored);
  const plan = order.parts.map((p) => ({ ...p, qty: p.qty || 1 }));
  const manual = [];
  for (const p of parts) {
    if (!p.planId) continue;
    const pp = plan.find((x) => x.id === p.planId && x.qty > 0);
    if (pp) { pp.qty -= 1; const d = partDiscrepancy(p, pp); manual.push({ measuredIndex: p.index, planId: pp.id, planIndex: order.parts.indexOf(order.parts.find((x) => x.id === pp.id)), discrepancyMm: d.discrepancyMm, orientation: d.orientation, dL: d.dL, dW: d.dW, manual: true }); }
  }
  const auto = parts.filter((p) => !p.planId || !manual.some((x) => x.measuredIndex === p.index));
  const rest = plan.filter((p) => p.qty > 0);
  const res = matchParts(auto.map((p) => ({ lengthMm: p.lengthMm, widthMm: p.widthMm })), rest, ctx.settings.match);
  const idx = (i) => auto[i].index;
  const match = {
    matches: manual.concat(res.matches.map((x) => ({ ...x, measuredIndex: idx(x.measuredIndex) }))),
    missing: res.missing,
    extra: res.extra.map((x) => ({ ...x, measuredIndex: idx(x.measuredIndex) })),
    candidates: Object.fromEntries(Object.entries(res.candidates || {}).map(([k, v]) => [idx(Number(k)), v])),
    ambiguous: (res.ambiguous || []).map((a) => ({ ...a, measuredIndex: idx(a.measuredIndex) })),
  };
  m.match = match;
  return match;
}

export function drawResult(canvas, photo, m, { selected = -1 } = {}) {
  const r = m.result;
  canvas.width = photo.width; canvas.height = photo.height;
  const g = canvas.getContext('2d');
  g.drawImage(photo, 0, 0);
  const s = photo.width / (r.image?.width || photo.width);
  const lw = Math.max(2, Math.round(photo.width / 400));
  g.font = `bold ${Math.max(14, Math.round(photo.width / 45))}px sans-serif`;
  g.textBaseline = 'middle'; g.textAlign = 'center';
  if (r.target && r.target.markers) {
    g.strokeStyle = 'rgba(76,194,255,0.9)'; g.lineWidth = Math.max(1, lw / 2);
    for (const mk of r.target.markers) {
      g.beginPath(); mk.corners.forEach(([x, y], i) => { if (i === 0) g.moveTo(x * s, y * s); else g.lineTo(x * s, y * s); }); g.closePath(); g.stroke();
    }
  }
  for (const p of effectiveParts(m)) {
    const poly = (p.cornersPx && p.cornersPx.length >= 3 ? p.cornersPx : p.polygonPx) || [];
    if (poly.length < 3) continue;
    const st = statusOf(m, p.index);
    const color = STATUS_COLORS[st] || STATUS_COLORS.none;
    g.beginPath(); poly.forEach(([x, y], i) => { if (i === 0) g.moveTo(x * s, y * s); else g.lineTo(x * s, y * s); }); g.closePath();
    g.fillStyle = color.replace(')', ',0.18)').replace('#', 'rgba(').replace(/rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i, (_, a, b, c) => `rgba(${parseInt(a, 16)},${parseInt(b, 16)},${parseInt(c, 16)}`);
    g.fill();
    g.lineWidth = selected === p.index ? lw * 2 : lw; g.strokeStyle = color; g.stroke();
    let cx = 0; let cy = 0; poly.forEach(([x, y]) => { cx += x; cy += y; }); cx = cx / poly.length * s; cy = cy / poly.length * s;
    const label = `${p.index + 1}  ${fmtMm(p.lengthMm)}×${fmtMm(p.widthMm)}`;
    const id = labelOf(m, p.index);
    const text = id ? `${label}  ${id}` : label;
    const tw = g.measureText(text).width + 16; const th = Math.round(photo.width / 30);
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(cx - tw / 2, cy - th / 2, tw, th);
    g.fillStyle = st === 'ignored' ? '#aaa' : '#fff'; g.fillText(text, cx, cy);
  }
}

export function hitTest(m, photoW, x, y) {
  const s = photoW / (m.result.image?.width || photoW);
  const pip = (pt, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0] * s; const yi = poly[i][1] * s; const xj = poly[j][0] * s; const yj = poly[j][1] * s;
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  const parts = effectiveParts(m).slice().sort((a, b) => (a.areaMm2 || 0) - (b.areaMm2 || 0));
  for (const p of parts) {
    const poly = (p.cornersPx && p.cornersPx.length >= 3 ? p.cornersPx : p.polygonPx) || [];
    if (poly.length >= 3 && pip([x, y], poly)) return p.index;
  }
  return -1;
}

async function loadPhotoBitmap(ctx, m) {
  if (ctx.state.lastPhoto && ctx.state.lastMeasurementId === m.id) return ctx.state.lastPhoto;
  if (m.photo) { try { return await createImageBitmap(m.photo); } catch (e) { console.warn(e); } }
  return null;
}

export async function mount(root, ctx, params) {
  const id = params.id;
  let m = (ctx.state.lastMeasurement && ctx.state.lastMeasurement.id === id) ? ctx.state.lastMeasurement : null;
  if (!m && ctx.db) { try { m = await ctx.db.getMeasurement(id); } catch (e) { console.warn(e); } }
  if (!m || !m.result) { root.appendChild(h('div', { class: 'empty' }, 'Замер не найден')); return; }
  let order = null;
  if (m.orderId && ctx.db) { try { order = await ctx.db.getOrder(m.orderId); } catch { order = null; } }
  const photo = await loadPhotoBitmap(ctx, m);
  const q = m.result.quality || {};
  let selected = -1;

  async function persist() {
    if (!ctx.db) return;
    try { await ctx.db.putMeasurement(m); } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'error'); }
    if (ctx.state.lastMeasurementId === m.id) ctx.state.lastMeasurement = m;
  }

  const canvas = h('canvas', { class: 'result-canvas' });
  const canvasWrap = h('div', { class: 'result-canvas-wrap' }, canvas);
  const redraw = () => { if (photo) drawResult(canvas, photo, m, { selected }); };
  if (photo) redraw(); else canvasWrap.appendChild(h('div', { class: 'empty' }, 'Фото недоступно'));
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * canvas.width / rect.width;
    const y = (e.clientY - rect.top) * canvas.height / rect.height;
    const idx = hitTest(m, canvas.width, x, y);
    if (idx >= 0) openPart(idx);
  });

  const listEl = h('div', { class: 'list' });
  function renderList() {
    clear(listEl);
    for (const p of effectiveParts(m)) {
      const st = statusOf(m, p.index);
      const lab = labelOf(m, p.index);
      const stText = { ok: 'совпадает', extra: 'лишняя', ambiguous: 'неоднозначно', ignored: 'исключена', none: '' }[st];
      listEl.appendChild(h('div', { class: 'card clickable', 'on:click': () => openPart(p.index) },
        h('div', { class: `part-index status-${st}` }, String(p.index + 1)),
        h('div', { class: 'card-main' },
          h('div', { class: 'dims' }, `${fmtMm(p.lengthMm)} × ${fmtMm(p.widthMm)} мм`, p.edited ? h('span', { class: 'muted' }, ' (испр.)') : null),
          h('div', { class: 'card-sub' }, [lab ? `ID ${lab} · ` : '', stText, p.rectangularity !== undefined && p.rectangularity < 0.9 ? ' · непрямоугольная' : '', !p.refined ? ' · кромки не уточнены' : ''].join(''))),
        h('span', {}, '›')));
    }
  }
  renderList();

  async function openPart(index) {
    selected = index; redraw();
    const p = effectiveParts(m).find((x) => x.index === index);
    if (!p) return;
    const ov = (m.overrides[index] = m.overrides[index] || {});
    const body = h('div', { class: 'page', style: { padding: '0' } });
    // Steppers are stacked: two side by side do not fit a 360-412 px phone width with 64 px buttons.
    const dimsRow = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      numberStepper({ label: 'Длина, мм', value: p.lengthMm, step: 0.5, min: 0, digits: 1, onChange: async (v) => { ov.lengthMm = v; await afterEdit(); } }),
      numberStepper({ label: 'Ширина, мм', value: p.widthMm, step: 0.5, min: 0, digits: 1, onChange: async (v) => { ov.widthMm = v; await afterEdit(); } }));
    body.appendChild(dimsRow);
    body.appendChild(h('dl', { class: 'kv' },
      h('dt', {}, 'Площадь'), h('dd', {}, `${fmtMm((p.areaMm2 || 0) / 100, 1)} см²`),
      h('dt', {}, 'Прямоугольность'), h('dd', {}, p.rectangularity !== undefined ? (p.rectangularity * 100).toFixed(0) + ' %' : '—'),
      h('dt', {}, 'Кромки уточнены'), h('dd', {}, p.refined ? 'да' : 'нет'),
      h('dt', {}, 'Угол на столе'), h('dd', {}, p.angleDeg !== undefined ? p.angleDeg.toFixed(1) + '°' : '—')));
    if (order && order.parts && order.parts.length) {
      const cands = (m.match && m.match.candidates && m.match.candidates[index]) || [];
      const opts = [{ value: '', text: 'Не назначено (авто)' }];
      const seen = new Set();
      for (const c of cands) { if (!seen.has(c.planId)) { seen.add(c.planId); opts.push({ value: c.planId, text: `${c.planId} · ±${fmtMm(c.discrepancyMm)} мм${c.orientation === 'rotated' ? ' (повёрнута)' : ''}` }); } }
      for (const pp of order.parts) { if (!seen.has(pp.id)) { seen.add(pp.id); opts.push({ value: pp.id, text: `${pp.id} · ${fmtMm(pp.lengthMm)}×${fmtMm(pp.widthMm)}` }); } }
      const sel = h('select', { class: 'select' }, opts.map((o) => h('option', { value: o.value, selected: (ov.planId || '') === o.value }, o.text)));
      sel.addEventListener('change', async () => { ov.planId = sel.value || undefined; if (!sel.value) delete ov.planId; await afterEdit(); });
      body.appendChild(h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Деталь из заказа'), sel));
    }
    const ignoreBtn = bigButton(ov.ignored ? 'Вернуть в результат' : 'Исключить из результата', async () => { ov.ignored = !ov.ignored; await afterEdit(); s.close(); }, { kind: 'secondary' });
    const remnantBtn = bigButton('Сохранить как остаток', async () => { await saveAsRemnant(p); s.close(); }, { kind: 'secondary' });
    body.appendChild(h('div', { class: 'btn-row' }, ignoreBtn, remnantBtn));
    const s = sheet({ title: `Деталь ${index + 1}`, content: body, onClose: () => { selected = -1; redraw(); } });
    async function afterEdit() {
      if (order) { try { await recomputeMatch(ctx, m, order); } catch (e) { console.warn(e); } }
      await persist(); renderList(); redraw();
    }
  }

  async function saveAsRemnant(p) {
    if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
    const rid = await ctx.db.nextRemnantId();
    const remnant = {
      id: rid, createdAt: new Date().toISOString(), lengthMm: p.lengthMm, widthMm: p.widthMm, areaMm2: p.areaMm2 || p.lengthMm * p.widthMm,
      polygonMm: p.polygonMm || null, thicknessMm: (order && order.thicknessMm) || ctx.settings.thickness?.thicknessMm || 0,
      photo: m.photo || null, status: 'available', note: '', measurementId: m.id, usedFor: null,
    };
    await ctx.db.putRemnant(remnant);
    ctx.vibrate(60);
    toast(`Остаток ${rid} сохранён (${fmtMm(p.lengthMm)}×${fmtMm(p.widthMm)} мм)`, 'ok');
  }

  // Identification (single mode)
  const identEl = h('div');
  if (m.mode === 'single') {
    const tol = ctx.settings.match?.toleranceMm ?? 3;
    const best = (m.identification || [])[0];
    if (best && best.discrepancyMm <= tol) {
      identEl.appendChild(h('div', { class: 'ident' }, `Это деталь ${best.planId} из заказа «${best.orderName}» (расхождение ${fmtMm(best.discrepancyMm)} мм${best.orientation === 'rotated' ? ', повёрнута' : ''})`));
      const alts = (m.identification || []).slice(1, 4).filter((c) => c.discrepancyMm <= tol);
      if (alts.length) identEl.appendChild(h('div', { class: 'warn-item' }, 'Похожие: ' + alts.map((c) => `${c.planId} (${c.orderName}, ±${fmtMm(c.discrepancyMm)})`).join('; ')));
    } else {
      identEl.appendChild(h('div', { class: 'ident none' }, 'Подходящей детали в заказах не найдено'));
      const alts = (m.identification || []).slice(0, 3);
      if (alts.length) identEl.appendChild(h('div', { class: 'muted' }, 'Ближайшие: ' + alts.map((c) => `${c.planId} (${c.orderName}, ±${fmtMm(c.discrepancyMm)} мм)`).join('; ')));
    }
  }

  // Quality panel
  const warnList = h('div', { class: 'warn-list' }, (q.warnings || []).map((w) => h('div', { class: `warn-item ${w.severity === 'fatal' ? 'fatal' : ''}` }, w.message)));
  const qualityEl = section('Качество кадра',
    h('dl', { class: 'kv' },
      h('dt', {}, 'Меток найдено'), h('dd', {}, String(m.result.target?.markersFound ?? '—')),
      h('dt', {}, 'Ошибка репроекции'), h('dd', {}, q.reprojMaxPx !== undefined ? `${q.reprojMaxPx.toFixed(2)} px (max)` : '—'),
      h('dt', {}, 'Наклон камеры'), h('dd', {}, q.tiltDeg !== undefined ? `${q.tiltDeg.toFixed(1)}°` : '—'),
      h('dt', {}, 'Мишень в кадре'), h('dd', {}, q.targetFraction !== undefined ? `${(q.targetFraction * 100).toFixed(1)} %` : '—'),
      h('dt', {}, 'Разрешение у мишени'), h('dd', {}, q.pxPerMmAtTarget !== undefined ? `${q.pxPerMmAtTarget.toFixed(2)} px/мм` : '—'),
      h('dt', {}, 'Резкость'), h('dd', {}, q.sharpness?.normalized !== undefined ? q.sharpness.normalized.toFixed(3) : '—'),
      h('dt', {}, 'Пересвет'), h('dd', {}, q.glareFraction !== undefined ? `${(q.glareFraction * 100).toFixed(1)} %` : '—'),
      h('dt', {}, 'Высота съёмки'), h('dd', {}, q.cameraHeightMm ? `≈${Math.round(q.cameraHeightMm)} мм${q.focalSource === 'assumed' ? ' (оценка)' : ''}` : '—'),
      h('dt', {}, 'Поправка на толщину'), h('dd', {}, m.result.correction && m.result.correction.factor !== 1 ? `×${m.result.correction.factor.toFixed(4)} (t=${m.result.correction.thicknessMm} мм)` : 'нет'),
      h('dt', {}, 'Время замера'), h('dd', {}, m.elapsedMs ? `${(m.elapsedMs / 1000).toFixed(1)} с` : '—')),
    warnList);

  const actions = h('div', { class: 'page', style: { padding: '0' } });
  if (m.mode !== 'single') {
    actions.appendChild(bigButton(order ? 'Сверка с заказом' : 'Сверка: выберите заказ', async () => {
      if (!order) {
        if (!ctx.db) return;
        const orders = await ctx.db.listOrders();
        const list = h('div', { class: 'list' });
        let s;
        for (const o of orders) list.appendChild(h('div', { class: 'card clickable', 'on:click': async () => { m.orderId = o.id; order = o; await recomputeMatch(ctx, m, order); await persist(); s.close(); ctx.navigate(`#/compare/${m.id}`); } }, h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, `${o.name || 'Заказ'}${o.number ? ' №' + o.number : ''}`), h('div', { class: 'card-sub' }, `${(o.parts || []).length} позиций`))));
        if (!orders.length) list.appendChild(h('div', { class: 'empty' }, 'Заказов нет — импортируйте DXF в разделе «Заказы»'));
        s = sheet({ title: 'Выберите заказ', content: list });
        return;
      }
      if (!m.match) { await recomputeMatch(ctx, m, order); await persist(); }
      ctx.navigate(`#/compare/${m.id}`);
    }, { kind: 'primary' }));
  }
  actions.appendChild(h('div', { class: 'btn-row' },
    bigButton('Экспорт JSON', async () => {
      try {
        const [{ measurementToJson }, { saveOrShare }] = await Promise.all([import('../export/json.js'), import('../export/share.js')]);
        await saveOrShare(new Blob([measurementToJson(m, order)], { type: 'application/json' }), `zamer-${m.id.slice(0, 8)}.json`);
      } catch (e) { toast('Экспорт недоступен: ' + (e.message || e), 'error'); }
    }, { kind: 'secondary' }),
    bigButton('Фото с разметкой', async () => {
      try {
        if (!photo) throw new Error('нет фото');
        const { saveOrShare } = await import('../export/share.js');
        const c = document.createElement('canvas');
        drawResult(c, photo, m, {});
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        await saveOrShare(blob, `zamer-${m.id.slice(0, 8)}.jpg`);
      } catch (e) { toast('Экспорт недоступен: ' + (e.message || e), 'error'); }
    }, { kind: 'secondary' })));
  actions.appendChild(h('div', { class: 'btn-row' },
    bigButton('Переснять', () => ctx.navigate('#/camera'), { kind: 'secondary' }),
    bigButton('Удалить замер', async () => {
      if (!ctx.db) return;
      if (await confirmDialog('Удалить этот замер?', { okText: 'Удалить', danger: true })) { await ctx.db.deleteMeasurement(m.id); toast('Замер удалён', 'ok'); ctx.navigate('#/camera'); }
    }, { kind: 'danger' })));

  const header = h('div', { class: 'section' },
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'big' }, `Деталей: ${m.result.parts.length}`), h('div', { class: 'muted' }, `${fmtDate(m.createdAt)} · ${{ batch: 'приёмка партии', single: 'одна деталь', remnant: 'остаток' }[m.mode] || m.mode}${order ? ' · ' + (order.name || '') + (order.number ? ' №' + order.number : '') : ''}`))),
    m.match ? h('div', { class: 'row' }, badge(`найдено ${m.match.matches.length}`, 'ok'), badge(`не хватает ${m.match.missing.reduce((a, x) => a + x.qtyMissing, 0)}`, m.match.missing.length ? 'warn' : 'neutral'), badge(`лишних ${m.match.extra.length}`, m.match.extra.length ? 'err' : 'neutral')) : null);

  root.appendChild(h('div', { class: 'page' }, canvasWrap, identEl, header, actions, section('Детали', listEl), qualityEl));
  return () => {};
}
