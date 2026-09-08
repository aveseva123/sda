// Settings screen: every value is persisted immediately through ctx.saveSettings(patch) with the
// changed key path only (deep merge). Also data backup / restore / wipe and the "about" block.
import { h, clear, toast, confirmDialog, bigButton, numberStepper, section, emptyState } from './components.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../settings.js';

export const title = 'Настройки';

export const APP_VERSION = '0.1.0';
const CURRENT_KEY = 'sda.currentOrderId';

function hintEl(text) {
  return h('div', { class: 'muted' }, text);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Stepper + one-line hint; `save(value)` receives the value already converted to the stored unit.
function stepperSetting({ id, label, hint, value, step, min = -Infinity, max = Infinity, digits = 1, unit = '', save }) {
  const st = numberStepper({
    id, label, value, step, min, max, digits, unit,
    onChange: async (v) => {
      try { await save(v); } catch (e) { console.warn(e); toast('Не удалось сохранить настройку: ' + (e.message || e), 'error'); }
    },
  });
  return h('div', { class: 'field' }, st, hint ? hintEl(hint) : null);
}

function toggleSetting({ id, label, hint, checked, onChange }) {
  const input = h('input', { type: 'checkbox', id, checked: checked ? true : null, style: { width: '44px', height: '44px', flex: '0 0 auto', accentColor: 'var(--accent)' } });
  input.addEventListener('change', async () => {
    try { await onChange(input.checked); } catch (e) { console.warn(e); toast('Не удалось сохранить настройку: ' + (e.message || e), 'error'); input.checked = !input.checked; }
  });
  return h('label', { class: 'card clickable', for: id },
    h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, label), hint ? h('div', { class: 'card-sub' }, hint) : null),
    input);
}

function downloadFallback(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

async function shareBlob(blob, fileName) {
  try {
    const { saveOrShare } = await import('../export/share.js');
    await saveOrShare(blob, fileName);
  } catch (e) {
    console.warn('share module unavailable, using download fallback', e);
    downloadFallback(blob, fileName);
  }
}

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function mount(root, ctx) {
  const page = h('div', { class: 'page', dataset: { view: 'settings' } });
  root.appendChild(page);
  const save = (patch) => ctx.saveSettings(patch);

  function render() {
    clear(page);
    const s = ctx.settings || mergeSettings(DEFAULT_SETTINGS, {});
    const t = s.target || DEFAULT_SETTINGS.target;
    const q = s.quality || DEFAULT_SETTINGS.quality;
    const seg = s.segmentation || DEFAULT_SETTINGS.segmentation;
    const m = s.match || DEFAULT_SETTINGS.match;
    const th = s.thickness || DEFAULT_SETTINGS.thickness;
    const ras = s.raster || DEFAULT_SETTINGS.raster;

    // --- Target ---
    page.appendChild(section('Мишень',
      hintEl('Размеры печатной мишени с четырьмя метками ArUco. Менять только если печатаете свою мишень.'),
      stepperSetting({ id: 'set-target-side', label: 'Сторона метки, мм', hint: 'Чёрный квадрат метки по внешнему краю. Задаёт масштаб мм/пиксель.', value: num(t.markerSideMm, 40), step: 1, min: 10, max: 200, digits: 0, unit: 'мм', save: (v) => save({ target: { markerSideMm: v } }) }),
      stepperSetting({ id: 'set-target-sx', label: 'Расстояние между центрами по X, мм', hint: 'От центра левой верхней метки до центра правой верхней.', value: num(t.spacingXMm, 130), step: 1, min: 20, max: 2000, digits: 0, unit: 'мм', save: (v) => save({ target: { spacingXMm: v } }) }),
      stepperSetting({ id: 'set-target-sy', label: 'Расстояние между центрами по Y, мм', hint: 'От центра левой верхней метки до центра левой нижней.', value: num(t.spacingYMm, 210), step: 1, min: 20, max: 2000, digits: 0, unit: 'мм', save: (v) => save({ target: { spacingYMm: v } }) }),
      stepperSetting({ id: 'set-target-scale', label: 'Контрольный отрезок, факт мм', hint: 'На мишени напечатан отрезок «100 мм». Измерьте его линейкой и введите фактическую длину — так компенсируется масштаб принтера. Все размеры мишени умножаются на факт/100.', value: 100 * num(t.printScale, 1), step: 0.1, min: 50, max: 150, digits: 1, unit: 'мм', save: (v) => save({ target: { printScale: v / 100 } }) }),
      bigButton('Печать мишени', () => ctx.navigate('#/target'), { kind: 'secondary', icon: '🖨' })));

    // --- Matching ---
    page.appendChild(section('Сопоставление',
      stepperSetting({ id: 'set-match-tolerance', label: 'Допуск совпадения, мм', hint: 'Деталь считается найденной, если длина и ширина отличаются от плана не больше этого значения.', value: num(m.toleranceMm, 3), step: 0.5, min: 0.5, max: 50, digits: 1, unit: 'мм', save: (v) => save({ match: { toleranceMm: v } }) }),
      stepperSetting({ id: 'set-match-ambiguity', label: 'Порог неоднозначности, мм', hint: 'Если две позиции плана подходят и отличаются меньше, чем на это значение, деталь помечается «неоднозначно».', value: num(m.ambiguityMm, 5), step: 0.5, min: 0, max: 50, digits: 1, unit: 'мм', save: (v) => save({ match: { ambiguityMm: v } }) })));

    // --- Thickness ---
    page.appendChild(section('Толщина партии',
      hintEl('Деталь на стопке лежит выше мишени и кажется крупнее. Проще всего положить мишень на такой же лист; иначе укажите толщину и высоту съёмки.'),
      stepperSetting({ id: 'set-thickness', label: 'Толщина деталей, мм', hint: '0 = поправка выключена. Иначе размеры умножаются на (H − t) / H.', value: num(th.thicknessMm, 0), step: 0.1, min: 0, max: 50, digits: 1, unit: 'мм', save: (v) => save({ thickness: { thicknessMm: v } }) }),
      stepperSetting({ id: 'set-shoot-height', label: 'Высота съёмки, мм', hint: '0 = авто по мишени (высота камеры считается из геометрии кадра).', value: num(th.shootHeightMm, 0), step: 50, min: 0, max: 5000, digits: 0, unit: 'мм', save: (v) => save({ thickness: { shootHeightMm: v } }) })));

    // --- Frame quality ---
    page.appendChild(section('Качество кадра',
      stepperSetting({ id: 'set-q-tilt', label: 'Максимальный наклон, °', hint: 'Больше — появится предупреждение «Держите телефон ровнее». Наклон снижает точность у дальних кромок.', value: num(q.tiltMaxDeg, 35), step: 1, min: 5, max: 80, digits: 0, unit: '°', save: (v) => save({ quality: { tiltMaxDeg: v } }) }),
      stepperSetting({ id: 'set-q-target-frac', label: 'Минимальная доля мишени в кадре, %', hint: 'Меньше — подсказка «Подойдите ближе». Крупнее мишень — точнее масштаб.', value: 100 * num(q.targetMinFraction, 0.05), step: 0.5, min: 0.5, max: 100, digits: 1, unit: '%', save: (v) => save({ quality: { targetMinFraction: v / 100 } }) }),
      stepperSetting({ id: 'set-q-sharp', label: 'Минимальная резкость', hint: 'Нормированная дисперсия лапласиана. Ниже — подсказка «кадр смазан».', value: num(q.sharpnessMin, 0.02), step: 0.005, min: 0, max: 1, digits: 3, save: (v) => save({ quality: { sharpnessMin: v } }) }),
      stepperSetting({ id: 'set-q-glare', label: 'Максимум пересвета, %', hint: 'Доля почти белых пикселей. Выше — подсказка «блики мешают».', value: 100 * num(q.glareMaxFraction, 0.1), step: 1, min: 0, max: 100, digits: 0, unit: '%', save: (v) => save({ quality: { glareMaxFraction: v / 100 } }) })));

    // --- Raster ---
    page.appendChild(section('Растр',
      stepperSetting({ id: 'set-raster-ppm', label: 'Максимум пикселей на мм', hint: 'Разрешение выпрямленного кадра. Больше — точнее кромки, но дольше расчёт и больше памяти.', value: num(ras.maxPxPerMm, 4), step: 0.5, min: 0.5, max: 20, digits: 1, unit: 'px/мм', save: (v) => save({ raster: { maxPxPerMm: v } }) })));

    // --- Segmentation (advanced, collapsed) ---
    const segBody = h('div', { class: 'page', style: { padding: '8px 0 0' } },
      hintEl('Как отделяются тёмные детали от светлого фона. Менять, только если детали не находятся или сливаются.'),
      stepperSetting({ id: 'set-seg-bgminv', label: 'Фон: минимальная яркость V', hint: 'Пиксель считается фоном, если ярче этого (0–255). Ниже — темнее фон ещё считается фоном.', value: num(seg.bgMinV, 140), step: 5, min: 0, max: 255, digits: 0, save: (v) => save({ segmentation: { bgMinV: v } }) }),
      stepperSetting({ id: 'set-seg-bgmaxs', label: 'Фон: максимальная насыщенность S', hint: 'Фон должен быть бесцветным: насыщенность не выше этого (0–255).', value: num(seg.bgMaxS, 70), step: 5, min: 0, max: 255, digits: 0, save: (v) => save({ segmentation: { bgMaxS: v } }) }),
      stepperSetting({ id: 'set-seg-close', label: 'Замыкание разрывов, мм', hint: 'Дырки и щели меньше этого размера заливаются. Больше — соседние детали могут слипнуться.', value: num(seg.closeKernelMm, 12), step: 1, min: 0, max: 100, digits: 0, unit: 'мм', save: (v) => save({ segmentation: { closeKernelMm: v } }) }),
      stepperSetting({ id: 'set-seg-minarea', label: 'Минимальная площадь детали, мм²', hint: 'Пятна меньше этой площади отбрасываются (мусор, тени).', value: num(seg.minAreaMm2, 400), step: 50, min: 0, max: 100000, digits: 0, unit: 'мм²', save: (v) => save({ segmentation: { minAreaMm2: v } }) }),
      stepperSetting({ id: 'set-seg-minside', label: 'Минимальная сторона детали, мм', hint: 'Полосы уже этого размера отбрасываются (обрезки, провода).', value: num(seg.minSideMm, 15), step: 1, min: 0, max: 1000, digits: 0, unit: 'мм', save: (v) => save({ segmentation: { minSideMm: v } }) }),
      toggleSetting({ id: 'set-seg-otsu', label: 'Порог Оцу', hint: 'Дополнительно отделять тёмное автоматическим порогом по яркости. Выключите, если детали светлые.', checked: seg.useOtsu !== false, onChange: (v) => save({ segmentation: { useOtsu: v } }) }));
    const segSummary = h('summary', { class: 'section-title', style: { cursor: 'pointer', minHeight: '48px', display: 'flex', alignItems: 'center', listStyle: 'none' } }, '▸ Сегментация (дополнительно)');
    const segDetails = h('details', { id: 'set-seg-details' }, segSummary, segBody);
    segDetails.addEventListener('toggle', () => { segSummary.textContent = (segDetails.open ? '▾ ' : '▸ ') + 'Сегментация (дополнительно)'; });
    page.appendChild(h('section', { class: 'section' }, segDetails));

    // --- UI ---
    page.appendChild(section('Интерфейс',
      toggleSetting({ id: 'set-ui-vibrate', label: 'Вибрация', hint: 'Короткая вибрация после успешного замера.', checked: s.ui?.vibrate !== false, onChange: (v) => save({ ui: { vibrate: v } }) })));

    // --- Data ---
    const importInput = h('input', { type: 'file', id: 'settings-import-input', accept: '.json,application/json', style: { display: 'none' } });
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
      let obj;
      try { obj = JSON.parse(await file.text()); } catch (e) { toast('Файл не похож на резервную копию: ' + (e.message || e), 'error'); return; }
      const ok = await confirmDialog('Объединить с текущими данными?', { okText: 'Объединить', cancelText: 'Отмена' });
      if (!ok) return;
      try {
        const r = await ctx.db.importAll(obj, { merge: true });
        const cnt = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
        toast(`Импортировано: заказов ${cnt(r?.orders)}, замеров ${cnt(r?.measurements)}, остатков ${cnt(r?.remnants)}`, 'ok', 4000);
        try { ctx.settings = await ctx.db.getSettings(); } catch { /* keep current */ }
        render();
      } catch (e) { console.error(e); toast('Импорт не удался: ' + (e.message || e), 'error'); }
    });
    page.appendChild(section('Данные',
      hintEl('Все заказы, замеры (с фото) и остатки хранятся только на этом телефоне. Делайте резервную копию.'),
      bigButton('Экспорт всей базы', async () => {
        if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
        try {
          const obj = await ctx.db.exportAll();
          const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
          await shareBlob(blob, `zamer-backup-${todayStamp()}.json`);
          toast('Резервная копия подготовлена', 'ok');
        } catch (e) { console.error(e); toast('Экспорт не удался: ' + (e.message || e), 'error'); }
      }, { kind: 'primary', icon: '💾' }),
      bigButton('Импорт базы', () => importInput.click(), { kind: 'secondary', icon: '📥' }),
      importInput,
      bigButton('Очистить всё', async () => {
        if (!ctx.db) { toast('База данных недоступна', 'error'); return; }
        const ok = await confirmDialog('Удалить все заказы, замеры и остатки? Это действие нельзя отменить.', { okText: 'Удалить всё', danger: true });
        if (!ok) return;
        try {
          await ctx.db.clearAll();
          ctx.state.currentOrderId = null; ctx.state.lastMeasurementId = null; ctx.state.lastMeasurement = null; ctx.state.lastResult = null;
          try { localStorage.removeItem(CURRENT_KEY); } catch { /* ignore */ }
          toast('База очищена', 'ok');
        } catch (e) { console.error(e); toast('Не удалось очистить: ' + (e.message || e), 'error'); }
      }, { kind: 'danger', icon: '🗑' })));

    // --- About ---
    const rs = ctx.readyState || {};
    const cvText = rs.opencvVersion ? String(rs.opencvVersion) : (rs.vision === 'loading' ? 'загружается…' : rs.vision === 'error' ? 'не загрузился' : '—');
    page.appendChild(section('О приложении',
      h('dl', { class: 'kv' },
        h('dt', {}, 'Версия'), h('dd', {}, APP_VERSION),
        h('dt', {}, 'OpenCV'), h('dd', { id: 'about-opencv' }, cvText),
        h('dt', {}, 'База данных'), h('dd', {}, ctx.db ? 'работает' : 'недоступна')),
      h('div', { class: 'btn-row' },
        bigButton('Справка', () => ctx.navigate('#/help'), { kind: 'secondary', icon: '❓' }),
        bigButton('Тест-режим', () => ctx.navigate('#/test'), { kind: 'secondary', icon: '🧪' })),
      bigButton('Сбросить настройки', async () => {
        const ok = await confirmDialog('Вернуть все настройки к значениям по умолчанию?', { okText: 'Сбросить', danger: true });
        if (!ok) return;
        try {
          await save(mergeSettings(DEFAULT_SETTINGS, {}));
          toast('Настройки сброшены', 'ok');
          render();
        } catch (e) { toast('Не удалось сбросить: ' + (e.message || e), 'error'); }
      }, { kind: 'danger' })));
  }

  if (!ctx.settings) page.appendChild(emptyState('Настройки недоступны'));
  render();
  const onReady = () => { const el = page.querySelector('#about-opencv'); if (el && ctx.readyState?.opencvVersion) el.textContent = String(ctx.readyState.opencvVersion); };
  if (ctx.vision && ctx.vision.ready) ctx.vision.ready.then(onReady).catch(() => {});
  return () => {};
}
