// Camera screen: live preview with quality hints, capture, analysis, save, navigate to result.
import { h, clear, toast, sheet, bigButton } from './components.js';
import { startCamera, bitmapFromFile } from '../camera/capture.js';

export const title = 'Камера';

const MODES = [
  { id: 'batch', text: 'Приёмка партии' },
  { id: 'single', text: 'Одна деталь' },
  { id: 'remnant', text: 'Остаток' },
];
const STAGES = {
  aruco: 'Поиск мишени…', homography: 'Расчёт геометрии…', quality: 'Оценка качества…', rectify: 'Выпрямление кадра…',
  segment: 'Поиск деталей…', measure: 'Замер кромок…', match: 'Сопоставление…', save: 'Сохранение…',
};

export function genId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function downscaleToJpeg(bitmap, maxSidePx = 1600, quality = 0.85) {
  const s = Math.min(1, maxSidePx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s)); const hgt = Math.max(1, Math.round(bitmap.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hgt;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, hgt);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { blob, width: w, height: hgt, canvas };
}

// Identify a single measured part across all stored orders.
async function identifyPart(ctx, part) {
  if (!ctx.db) return [];
  let matchMod;
  try { matchMod = await import('../match/assign.js'); } catch { return []; }
  const orders = await ctx.db.listOrders();
  const out = [];
  for (const order of orders) {
    for (const [planIndex, p] of (order.parts || []).entries()) {
      const d = matchMod.partDiscrepancy(part, p);
      out.push({ orderId: order.id, orderName: order.name || order.number || order.id, planId: p.id, planIndex, discrepancyMm: d.discrepancyMm, orientation: d.orientation });
    }
  }
  out.sort((a, b) => a.discrepancyMm - b.discrepancyMm);
  return out.slice(0, 8);
}

export async function analyzeAndSave(ctx, bitmap, { source = 'camera', setStage = () => {} } = {}) {
  const settings = ctx.settings;
  const mode = ctx.state.mode || 'batch';
  // Keep a downscaled copy for history/display before the full-res bitmap is transferred to the worker.
  setStage('Подготовка фото…');
  const small = await downscaleToJpeg(bitmap, settings.history?.photoMaxPx || 1600);
  const fullW = bitmap.width; const fullH = bitmap.height;
  const t0 = performance.now();
  const result = await ctx.vision.analyze(bitmap, settings, { onProgress: (s) => setStage(STAGES[s] || s) });
  const elapsedMs = Math.round(performance.now() - t0);
  if (!result.ok) {
    const err = result.error || { code: 'ERROR', message: 'Замер не удался' };
    const e = new Error(err.message); e.code = err.code; e.result = result;
    throw e;
  }
  if (!result.parts || result.parts.length === 0) {
    const e = new Error('Детали не найдены. Проверьте, что детали тёмные на светлом фоне и лежат в кадре рядом с мишенью');
    e.code = 'NO_PARTS'; e.result = result;
    throw e;
  }
  setStage(STAGES.match);
  let match = null;
  let identification = null;
  let order = null;
  if (ctx.db && ctx.state.currentOrderId) {
    try { order = await ctx.db.getOrder(ctx.state.currentOrderId); } catch { order = null; }
  }
  if (mode === 'batch' && order && order.parts?.length) {
    try {
      const { matchParts } = await import('../match/assign.js');
      match = matchParts(result.parts.map((p) => ({ lengthMm: p.lengthMm, widthMm: p.widthMm })), order.parts, settings.match);
    } catch (e) { console.warn('match failed', e); toast('Сопоставление недоступно: ' + (e.message || e), 'error'); }
  } else if (mode === 'single') {
    const main = result.parts[0];
    identification = await identifyPart(ctx, main);
  }
  setStage(STAGES.save);
  const id = genId();
  const measurement = {
    id, createdAt: new Date().toISOString(), mode, orderId: order ? order.id : null,
    photo: small.blob, photoWidth: small.width, photoHeight: small.height,
    fullWidth: fullW, fullHeight: fullH, source, elapsedMs,
    result, overrides: {}, match, identification, notes: '',
  };
  if (ctx.db) {
    try { await ctx.db.putMeasurement(measurement); } catch (e) { console.error(e); toast('Не удалось сохранить замер: ' + (e.message || e), 'error'); }
  }
  ctx.state.lastMeasurementId = id;
  ctx.state.lastResult = result;
  ctx.state.lastMeasurement = measurement;
  try { ctx.state.lastPhoto = await createImageBitmap(small.canvas); } catch { ctx.state.lastPhoto = null; }
  return measurement;
}

export async function mount(root, ctx) {
  const state = ctx.state;
  let cam = null;
  let running = true;
  let previewTimer = null;
  let lastPreview = null;

  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const overlay = h('canvas', { class: 'overlay' });
  const hint = h('div', { class: 'cam-hint' }, 'Запуск камеры…');
  const view = h('div', { class: 'cam-view' }, video, overlay, hint);

  const modeCtl = h('div', { class: 'segmented', role: 'tablist' });
  const renderModes = () => {
    clear(modeCtl);
    for (const m of MODES) {
      modeCtl.appendChild(h('button', { type: 'button', class: state.mode === m.id ? 'active' : '', 'on:click': () => { state.mode = m.id; try { localStorage.setItem('sda.mode', m.id); } catch { /* ignore */ } renderModes(); renderChip(); } }, m.text));
    }
  };
  renderModes();

  const chip = h('button', { class: 'order-chip', type: 'button' });
  let currentOrder = null;
  async function loadOrder() {
    currentOrder = null;
    if (ctx.db && state.currentOrderId) {
      try { currentOrder = await ctx.db.getOrder(state.currentOrderId); } catch { currentOrder = null; }
      if (!currentOrder) { state.currentOrderId = null; try { localStorage.removeItem('sda.currentOrderId'); } catch { /* ignore */ } }
    }
    renderChip();
  }
  function renderChip() {
    clear(chip);
    const label = state.mode === 'single' ? 'Поиск по всем заказам' : 'Заказ';
    chip.appendChild(h('span', { class: 'chip-label' }, label));
    chip.appendChild(h('span', { class: 'chip-value' }, currentOrder ? `${currentOrder.name || ''}${currentOrder.number ? ' №' + currentOrder.number : ''}` : 'Без заказа'));
    chip.appendChild(h('span', {}, '▾'));
    chip.disabled = state.mode === 'single';
  }
  chip.addEventListener('click', async () => {
    if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
    const orders = await ctx.db.listOrders();
    const list = h('div', { class: 'list' });
    const pick = (order, s) => {
      state.currentOrderId = order ? order.id : null;
      try { if (order) localStorage.setItem('sda.currentOrderId', order.id); else localStorage.removeItem('sda.currentOrderId'); } catch { /* ignore */ }
      currentOrder = order; renderChip(); s.close();
    };
    let s;
    list.appendChild(h('div', { class: 'card clickable', 'on:click': () => pick(null, s) }, h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, 'Без заказа'), h('div', { class: 'card-sub' }, 'Только замер, без сверки'))));
    for (const o of orders) {
      list.appendChild(h('div', { class: 'card clickable', 'on:click': () => pick(o, s) }, h('div', { class: 'card-main' },
        h('div', { class: 'card-title' }, `${o.name || 'Заказ'}${o.number ? ' №' + o.number : ''}`),
        h('div', { class: 'card-sub' }, `${(o.parts || []).reduce((a, p) => a + (p.qty || 1), 0)} дет. · ${o.thicknessMm ? o.thicknessMm + ' мм' : 'толщина не задана'}`))));
    }
    if (orders.length === 0) list.appendChild(h('div', { class: 'empty' }, 'Заказов пока нет — импортируйте DXF в разделе «Заказы»'));
    s = sheet({ title: 'Выберите заказ', content: list });
  });

  const captureBtn = h('button', { class: 'btn-capture', type: 'button', 'aria-label': 'Снять', disabled: true }, 'Снять');
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const galleryBtn = h('button', { class: 'cam-side', type: 'button', 'on:click': () => fileInput.click() }, h('span', { class: 'btn-icon' }, '🖼'), h('span', {}, 'Файл'));
  const torchBtn = h('button', { class: 'cam-side', type: 'button', hidden: true }, h('span', { class: 'btn-icon' }, '🔦'), h('span', {}, 'Фонарь'));
  let torchOn = false;
  torchBtn.addEventListener('click', async () => { if (!cam) return; torchOn = !torchOn; const ok = await cam.setTorch(torchOn); if (!ok) { torchOn = false; toast('Фонарь недоступен', 'error'); } torchBtn.classList.toggle('active', torchOn); });
  const bottom = h('div', { class: 'cam-bottom' }, galleryBtn, captureBtn, torchBtn);

  const stageEl = h('div', { class: 'muted', style: { fontSize: '18px' } }, '');
  const progress = h('div', { class: 'cam-progress', hidden: true }, h('div', { class: 'spinner' }), h('div', {}, 'Идёт замер…'), stageEl);

  const top = h('div', { class: 'cam-top' }, modeCtl, chip);
  const el = h('div', { class: 'cam' }, top, view, bottom, progress, fileInput);
  root.appendChild(el);

  function setHint(text, kind) {
    hint.textContent = text;
    hint.className = 'cam-hint' + (kind ? ' ' + kind : '');
  }

  function drawOverlay(pv, frameW, frameH) {
    const cw = view.clientWidth; const ch = view.clientHeight;
    if (overlay.width !== cw || overlay.height !== ch) { overlay.width = cw; overlay.height = ch; }
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, cw, ch);
    if (!pv || !pv.targetPolygonPx || !frameW || !frameH) return;
    const vw = video.videoWidth || frameW; const vh = video.videoHeight || frameH;
    const scale = Math.min(cw / vw, ch / vh);
    const offX = (cw - vw * scale) / 2; const offY = (ch - vh * scale) / 2;
    const s = vw / frameW; // frame -> video px
    g.strokeStyle = pv.ok ? '#3ddc84' : '#ffb020';
    g.lineWidth = 3;
    g.beginPath();
    pv.targetPolygonPx.forEach(([x, y], i) => { const px = offX + x * s * scale; const py = offY + y * s * scale; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
    g.closePath();
    g.stroke();
  }

  function showPreview(pv, frame) {
    lastPreview = pv;
    if (!pv) return;
    const fatal = pv.hints.find((x) => x.severity === 'fatal');
    const warn = pv.hints.find((x) => x.severity === 'warn');
    if (fatal) setHint(fatal.message, 'fatal');
    else if (warn) setHint(warn.message, 'warn');
    else setHint('Можно снимать', 'ok');
    drawOverlay(pv, frame.width, frame.height);
  }

  async function previewTick() {
    if (!running) return;
    try {
      if (cam && ctx.vision.isReady && !ctx.vision.busy && progress.hidden) {
        const frame = cam.grabFrame(640);
        if (frame) {
          const pv = await ctx.vision.preview(frame, ctx.settings);
          if (running && pv) showPreview(pv, frame);
        }
      } else if (cam && !ctx.vision.isReady) {
        setHint('Загрузка модуля зрения…', '');
      }
    } catch (e) { console.warn('preview failed', e); }
    if (running) previewTimer = setTimeout(previewTick, 350);
  }

  async function runAnalysis(bitmap, source) {
    progress.hidden = false;
    stageEl.textContent = '';
    captureBtn.disabled = true;
    try {
      const m = await analyzeAndSave(ctx, bitmap, { source, setStage: (s) => { stageEl.textContent = s; } });
      ctx.vibrate(80);
      toast(`Найдено деталей: ${m.result.parts.length}`, 'ok');
      ctx.navigate(`#/result/${m.id}`);
    } catch (e) {
      console.error(e);
      ctx.vibrate(30);
      const q = e.result?.quality;
      const extra = q && q.warnings?.length ? ' · ' + q.warnings.map((w) => w.message).join('; ') : '';
      toast((e.message || 'Замер не удался') + extra, 'error', 5000);
    } finally {
      progress.hidden = true;
      captureBtn.disabled = !ctx.vision.isReady;
    }
  }

  captureBtn.addEventListener('click', async () => {
    if (!cam) { toast('Камера не запущена — используйте кнопку «Файл»', 'error'); return; }
    captureBtn.disabled = true;
    try {
      const { bitmap, method } = await cam.capturePhoto();
      if (method === 'videoFrame') toast('Снимок в разрешении видео — точность ниже. Лучше снимать через «Файл» → камера телефона', 'info', 4000);
      await runAnalysis(bitmap, method);
    } catch (e) {
      console.error(e);
      toast('Не удалось сделать снимок: ' + (e.message || e), 'error');
      captureBtn.disabled = !ctx.vision.isReady;
    }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const bitmap = await bitmapFromFile(file);
      await runAnalysis(bitmap, 'file');
    } catch (e) { toast('Не удалось открыть файл: ' + (e.message || e), 'error'); }
  });

  // Enable capture once vision is ready
  ctx.vision.ready.then(() => { if (running) captureBtn.disabled = !cam; }).catch(() => { setHint('Модуль зрения не загрузился', 'fatal'); });

  loadOrder();
  (async () => {
    try {
      cam = await startCamera(video);
      if (!running) { cam.stop(); return; }
      torchBtn.hidden = !cam.hasTorch;
      if (!cam.isMainCameraGuess) toast('Похоже, выбрана не основная камера — переключите на 1×', 'info', 4000);
      setHint(ctx.vision.isReady ? 'Наведите на мишень' : 'Загрузка модуля зрения…', '');
      captureBtn.disabled = !ctx.vision.isReady;
    } catch (e) {
      console.warn(e);
      setHint('Камера недоступна — снимите через «Файл»', 'warn');
    }
    previewTick();
  })();

  return () => {
    running = false;
    if (previewTimer) clearTimeout(previewTimer);
    if (cam) cam.stop();
  };
}
