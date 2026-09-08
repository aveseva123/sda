// Test screen: synthetic scenes through the real vision worker, and a photo with a known reference list.
// Exposes window.__testResult / window.__testRunning for the e2e test (tests/e2e/smoke-pwa.mjs).
import { h, clear, toast, bigButton, section, badge, fmtMm } from './components.js';
import { standardScene } from '../testing/synth.js';
import { referenceFromText, evaluate, syntheticScenes, rowsToCsv } from '../testing/testmode.js';
import { bitmapFromFile } from '../camera/capture.js';

export const title = 'Тест точности';

const TOL_MM = 2;
const STAGES = { aruco: 'поиск мишени', homography: 'геометрия', quality: 'качество', rectify: 'выпрямление', segment: 'поиск деталей', measure: 'замер кромок' };
const STATUS = { ok: ['ок', 'ok'], err: ['ошибка', 'err'], missing: ['не найдена', 'warn'], extra: ['лишняя', 'warn'] };

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function signed(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + Number(v).toFixed(2);
}

export function resultTable(rows) {
  const head = h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Эталон L×W'), h('th', {}, 'Факт L×W'), h('th', { class: 'num' }, 'ΔL'), h('th', { class: 'num' }, 'ΔW'), h('th', {}, 'Статус'));
  const body = rows.map((r) => {
    const [text, kind] = STATUS[r.status] || [r.status, 'neutral'];
    return h('tr', { dataset: { status: r.status } },
      h('td', {}, r.id),
      h('td', { class: 'num' }, r.refL === null ? '—' : `${fmtMm(r.refL)}×${fmtMm(r.refW)}`),
      h('td', { class: 'num' }, r.measL === null ? '—' : `${fmtMm(r.measL)}×${fmtMm(r.measW)}`),
      h('td', { class: 'num' }, signed(r.errL)),
      h('td', { class: 'num' }, signed(r.errW)),
      h('td', {}, badge(text, kind)));
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, head), h('tbody', {}, body)));
}

export function summaryLine(summary, { timeMs = null, renderMs = null } = {}) {
  const bits = [];
  bits.push(summary.maxErrMm === null ? 'ошибка: нет совпадений' : `макс. ошибка ${summary.maxErrMm.toFixed(2)} мм`);
  bits.push(`в допуске ±${summary.toleranceOkMm ?? TOL_MM} мм: ${summary.withinTolPct} % (${summary.withinTol} из ${summary.n})`);
  if (summary.unmatchedMeasured) bits.push(`лишних ${summary.unmatchedMeasured}`);
  if (timeMs !== null) bits.push(`анализ ${timeMs} мс`);
  if (renderMs !== null) bits.push(`рендер ${renderMs} мс`);
  const allOk = summary.n > 0 && summary.withinTolPct === 100 && !summary.unmatchedMeasured;
  return h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { class: 'muted' }, bits.join(' · ')), h('div', { style: { flex: '0 0 auto' } }, badge(allOk ? 'ПРОЙДЕН' : 'НЕ ПРОЙДЕН', allOk ? 'ok' : 'err')));
}

function warningsBlock(result) {
  const q = result && result.quality;
  const items = [];
  if (result && !result.ok && result.error) items.push(h('div', { class: 'warn-item fatal' }, `${result.error.message || 'Замер не удался'} (${result.error.code || 'ERROR'})`));
  for (const w of (q && q.warnings) || []) items.push(h('div', { class: `warn-item${w.severity === 'fatal' ? ' fatal' : ''}` }, w.message));
  if (!items.length) return null;
  return h('div', { class: 'warn-list' }, items);
}

function compactQuality(result) {
  const q = (result && result.quality) || {};
  return {
    ok: !!(result && result.ok), markersFound: result && result.target ? result.target.markersFound : null,
    reprojMaxPx: q.reprojMaxPx ?? null, tiltDeg: q.tiltDeg ?? null, pxPerMmAtTarget: q.pxPerMmAtTarget ?? null,
    sharpness: q.sharpness ? q.sharpness.normalized : null, glareFraction: q.glareFraction ?? null,
    warnings: (q.warnings || []).map((w) => w.code), timingsMs: (result && result.timingsMs) || null,
  };
}

function qualityLine(result) {
  const q = result && result.quality;
  if (!q) return null;
  const parts = [];
  if (result.target) parts.push(`меток ${result.target.markersFound}`);
  if (q.reprojMaxPx !== undefined) parts.push(`репроекция ${q.reprojMaxPx.toFixed(2)} px`);
  if (q.tiltDeg !== undefined && q.tiltDeg !== null) parts.push(`наклон ${q.tiltDeg.toFixed(1)}°`);
  if (q.pxPerMmAtTarget) parts.push(`${q.pxPerMmAtTarget.toFixed(2)} px/мм`);
  if (q.sharpness && q.sharpness.normalized !== undefined) parts.push(`резкость ${q.sharpness.normalized.toFixed(3)}`);
  if (result.timingsMs && result.timingsMs.total !== undefined) parts.push(`пайплайн ${result.timingsMs.total} мс`);
  return parts.length ? h('div', { class: 'muted' }, parts.join(' · ')) : null;
}

async function exportRows(rows, fileName, sceneName = '') {
  const csv = rowsToCsv(rows, { sceneName });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  try {
    const { saveOrShare } = await import('../export/share.js');
    await saveOrShare(blob, fileName);
    return;
  } catch (e) { console.warn('share.js unavailable, falling back to <a download>', e); }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName, style: { display: 'none' } });
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function thumbnail(image, maxW = 480) {
  const full = document.createElement('canvas');
  full.width = image.width; full.height = image.height;
  full.getContext('2d').putImageData(image, 0, 0);
  const s = Math.min(1, maxW / image.width);
  const c = h('canvas', { class: 'result-canvas', style: { borderRadius: '10px' } });
  c.width = Math.round(image.width * s); c.height = Math.round(image.height * s);
  c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
  c.__full = full;
  return c;
}

export async function mount(root, ctx) {
  let alive = true;
  let running = false;
  const readyState = ctx.readyState || { vision: 'loading' };

  // ---- Synthetic test -------------------------------------------------------------------------
  const runBtn = bigButton('Запустить', () => runSynthetic(), { kind: 'primary', icon: '▶' });
  const synthProgress = h('div', { class: 'muted' }, '');
  const synthResults = h('div', { class: 'list' });
  const synthSection = section('Синтетический тест',
    h('div', { class: 'muted' }, `Кадры с мишенью и деталями известных размеров строятся прямо в телефоне и проходят через тот же модуль зрения, что и фото. Допуск ±${TOL_MM} мм.`),
    runBtn, synthProgress, synthResults);

  function setProgress(text) { if (alive) synthProgress.textContent = text; }

  async function analyzeImage(image, onStage) {
    const t0 = performance.now();
    let result;
    try {
      result = await ctx.vision.analyze(image, ctx.settings, { onProgress: (s) => onStage(STAGES[s] || s) });
    } catch (e) {
      result = { ok: false, error: { code: e.code || 'ERROR', message: e.message || String(e) } };
    }
    return { result, timeMs: Math.round(performance.now() - t0) };
  }

  async function runSynthetic() {
    if (running || readyState.vision !== 'ready') return;
    running = true;
    window.__testRunning = true;
    window.__testResult = null;
    runBtn.disabled = true;
    clear(synthResults);
    const scenes = syntheticScenes();
    const out = [];
    try {
      for (const [i, sc] of scenes.entries()) {
        if (!alive) break;
        const label = `Сцена ${i + 1} из ${scenes.length}: ${sc.name}`;
        setProgress(`${label} — построение кадра…`);
        await nextFrame();
        const t0 = performance.now();
        const scene = standardScene(sc.spec);
        const renderMs = Math.round(performance.now() - t0);
        const image = new ImageData(scene.image.data, scene.image.width, scene.image.height);
        setProgress(`${label} — анализ…`);
        await nextFrame();
        const { result, timeMs } = await analyzeImage(image, (s) => setProgress(`${label} — ${s}…`));
        const parts = result.ok ? result.parts : [];
        const { rows, summary } = await evaluate(parts, sc.reference, { toleranceOkMm: TOL_MM });
        const entry = { name: sc.name, summary, rows, timeMs, renderMs, quality: compactQuality(result), error: result.ok ? null : result.error };
        out.push(entry);
        if (!alive) break;
        const thumb = thumbnail(image);
        const block = section(sc.name, thumb, warningsBlock(result), qualityLine(result), resultTable(rows), summaryLine(summary, { timeMs, renderMs }),
          h('div', { class: 'btn-row' },
            bigButton('Сохранить кадр PNG', async () => {
              try {
                const blob = await new Promise((r) => thumb.__full.toBlob(r, 'image/png'));
                try { const { saveOrShare } = await import('../export/share.js'); await saveOrShare(blob, `synthetic-${i + 1}.png`); } catch {
                  const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: `synthetic-${i + 1}.png` }); document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
                }
              } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'error'); }
            }, { kind: 'secondary' }),
            bigButton('Экспорт CSV', () => exportRows(rows, `test-synthetic-${i + 1}.csv`, sc.name).catch((e) => toast('Экспорт не удался: ' + (e.message || e), 'error')), { kind: 'secondary' })));
        synthResults.appendChild(block);
      }
      const allOk = out.length === scenes.length && out.every((s) => s.summary.withinTolPct === 100 && !s.summary.unmatchedMeasured);
      setProgress(allOk ? `Готово: все ${out.length} сцен(ы) в допуске ±${TOL_MM} мм` : 'Готово: есть отклонения — см. таблицы ниже');
      if (allOk) ctx.vibrate(60);
    } catch (e) {
      console.error(e);
      setProgress('Тест прерван: ' + (e.message || e));
      toast('Тест прерван: ' + (e.message || e), 'error');
    } finally {
      window.__testResult = { scenes: out, finishedAt: new Date().toISOString(), opencvVersion: readyState.opencvVersion || null };
      window.__testRunning = false;
      running = false;
      runBtn.disabled = readyState.vision !== 'ready';
    }
  }

  // ---- Photo with a reference list ------------------------------------------------------------
  let photoFile = null;
  let lastPhotoRows = null;
  const photoInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const csvInput = h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', style: { display: 'none' } });
  const photoName = h('div', { class: 'muted' }, 'Фото не выбрано');
  const pickPhotoBtn = bigButton('Выбрать фото', () => photoInput.click(), { kind: 'secondary', icon: '🖼' });
  const refArea = h('textarea', { class: 'input', rows: 5, placeholder: 'SHELF-04;380;240\n300x200\nid;длина;ширина — по одной детали в строке' });
  const csvBtn = bigButton('Список из CSV', () => csvInput.click(), { kind: 'secondary' });
  const checkBtn = bigButton('Проверить', () => runPhoto(), { kind: 'primary', icon: '✓' });
  const exportBtn = bigButton('Экспорт CSV', () => {
    if (!lastPhotoRows) { toast('Сначала выполните проверку', 'info'); return; }
    exportRows(lastPhotoRows, `test-photo-${new Date().toISOString().slice(0, 10)}.csv`, photoFile ? photoFile.name : 'фото').catch((e) => toast('Экспорт не удался: ' + (e.message || e), 'error'));
  }, { kind: 'secondary', disabled: true });
  const photoProgress = h('div', { class: 'muted' }, '');
  const photoResults = h('div', { class: 'list' });

  photoInput.addEventListener('change', () => {
    photoFile = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
    photoName.textContent = photoFile ? `${photoFile.name} (${Math.round(photoFile.size / 1024)} КБ)` : 'Фото не выбрано';
  });
  csvInput.addEventListener('change', async () => {
    const f = csvInput.files && csvInput.files[0];
    csvInput.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = referenceFromText(text);
      if (!parsed.length) { toast('В файле не найдено строк вида id;длина;ширина', 'error'); return; }
      refArea.value = parsed.map((r) => `${r.id};${r.lengthMm};${r.widthMm}`).join('\n');
      toast(`Загружено эталонов: ${parsed.length}`, 'ok');
    } catch (e) { toast('Не удалось прочитать файл: ' + (e.message || e), 'error'); }
  });

  async function runPhoto() {
    if (running || readyState.vision !== 'ready') return;
    if (!photoFile) { toast('Выберите фото с мишенью и деталями', 'error'); return; }
    const reference = referenceFromText(refArea.value);
    if (!reference.length) { toast('Введите список эталонных размеров: id;длина;ширина', 'error'); return; }
    running = true;
    checkBtn.disabled = true; runBtn.disabled = true;
    clear(photoResults);
    lastPhotoRows = null; exportBtn.disabled = true;
    try {
      photoProgress.textContent = 'Открытие фото…';
      const bitmap = await bitmapFromFile(photoFile);
      const w = bitmap.width; const hgt = bitmap.height;
      photoProgress.textContent = `Анализ ${w}×${hgt}…`;
      const { result, timeMs } = await analyzeImage(bitmap, (s) => { photoProgress.textContent = `Анализ ${w}×${hgt} — ${s}…`; });
      const parts = result.ok ? result.parts : [];
      const { rows, summary } = await evaluate(parts, reference, { toleranceOkMm: TOL_MM });
      lastPhotoRows = rows;
      if (!alive) return;
      photoResults.appendChild(section(`Результат: ${photoFile.name}`, warningsBlock(result), qualityLine(result), resultTable(rows), summaryLine(summary, { timeMs })));
      photoProgress.textContent = result.ok ? `Найдено деталей: ${parts.length}` : 'Замер не удался';
      exportBtn.disabled = false;
      if (summary.withinTolPct === 100 && summary.n > 0) ctx.vibrate(60);
    } catch (e) {
      console.error(e);
      photoProgress.textContent = 'Ошибка: ' + (e.message || e);
      toast('Не удалось проверить фото: ' + (e.message || e), 'error');
    } finally {
      running = false;
      checkBtn.disabled = readyState.vision !== 'ready';
      runBtn.disabled = readyState.vision !== 'ready';
    }
  }

  const photoSection = section('Фото с эталоном',
    h('div', { class: 'muted' }, 'Снимите мишень и детали, размеры которых известны (например, измерены штангенциркулем), и сравните.'),
    h('div', { class: 'btn-row' }, pickPhotoBtn, csvBtn), photoName,
    h('div', { class: 'field' }, h('label', { class: 'field-label' }, 'Эталонные размеры (id;длина;ширина — по строке на деталь)'), refArea),
    h('div', { class: 'btn-row' }, checkBtn, exportBtn),
    photoProgress, photoResults, photoInput, csvInput);

  // ---- Vision readiness ------------------------------------------------------------------------
  const visionNote = h('div', { class: 'warn-item' }, 'Модуль зрения загружается…');
  function applyReady() {
    const ready = readyState.vision === 'ready';
    runBtn.disabled = !ready || running;
    checkBtn.disabled = !ready || running;
    if (ready) { visionNote.hidden = true; visionNote.textContent = ''; }
    else if (readyState.vision === 'error') { visionNote.hidden = false; visionNote.className = 'warn-item fatal'; visionNote.textContent = 'Модуль зрения не загрузился — тест недоступен'; }
    else { visionNote.hidden = false; visionNote.textContent = 'Модуль зрения загружается…'; }
  }
  applyReady();
  ctx.vision.ready.then(() => { if (alive) { readyState.vision = 'ready'; applyReady(); } }).catch(() => { if (alive) { readyState.vision = 'error'; applyReady(); } });

  root.appendChild(h('div', { class: 'page' }, visionNote, synthSection, photoSection));
  return () => { alive = false; };
}
