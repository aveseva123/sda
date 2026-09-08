// Target screen: the printable ArUco target (same SVG as target.html), print / download, calibration steps.
import { h, bigButton, section, toast, numberStepper, fmtMm } from './components.js';
import { targetSvg, CONTROL_SEGMENT_MM } from '../testing/targetSvg.js';
import { DEFAULT_TARGET } from '../vision/target.js';

export const title = 'Мишень';

const PRINT_CSS = `
.target-sheet { background: #fff; border-radius: 6px; overflow: hidden; }
.target-sheet svg { display: block; width: 100%; max-width: 100%; height: auto; }
.target-steps { margin: 0; padding-left: 24px; display: flex; flex-direction: column; gap: 8px; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; }
  #screen .page > :not(.target-sheet) { display: none !important; }
  #screen .page { padding: 0 !important; margin: 0 !important; max-width: none !important; gap: 0 !important; }
  .target-sheet { border-radius: 0; }
  .target-sheet svg { width: 210mm !important; height: 297mm !important; max-width: none !important; }
}`;

async function downloadSvg(svgText, fileName) {
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  try {
    const { saveOrShare } = await import('../export/share.js');
    await saveOrShare(blob, fileName);
    return;
  } catch (e) {
    console.warn('share.js unavailable, falling back to <a download>', e);
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

export async function mount(root, ctx) {
  // Always print the nominal design: printScale describes the printer's distortion of this very sheet.
  const target = { ...DEFAULT_TARGET, ...((ctx && ctx.settings && ctx.settings.target) || {}), printScale: 1 };
  const svgText = targetSvg({ target });
  const style = h('style', { id: 'target-print-style' }, PRINT_CSS);
  document.head.appendChild(style);

  const sheet = h('div', { class: 'target-sheet', html: svgText });

  const currentScale = Number((ctx && ctx.settings && ctx.settings.target && ctx.settings.target.printScale) || 1);
  let controlMm = currentScale * CONTROL_SEGMENT_MM;
  const scaleInfo = h('div', { class: 'muted' }, `Сейчас в настройках: контрольный отрезок ${fmtMm(controlMm)} мм (масштаб ${currentScale.toFixed(4)})`);
  const stepper = numberStepper({ label: 'Контрольный отрезок после печати, мм', value: controlMm, step: 0.5, min: 50, max: 150, digits: 1, unit: 'мм', onChange: (v) => { controlMm = v; } });
  const saveBtn = bigButton('Сохранить масштаб', async () => {
    const scale = controlMm / CONTROL_SEGMENT_MM;
    if (!(scale > 0.5 && scale < 1.5)) { toast('Введите длину отрезка от 50 до 150 мм', 'error'); return; }
    try {
      const s = await ctx.saveSettings({ target: { printScale: Number(scale.toFixed(4)) } });
      const ps = Number((s && s.target && s.target.printScale) || scale);
      scaleInfo.textContent = `Сейчас в настройках: контрольный отрезок ${fmtMm(ps * CONTROL_SEGMENT_MM)} мм (масштаб ${ps.toFixed(4)})`;
      toast(`Масштаб печати сохранён: ${ps.toFixed(4)}`, 'ok');
    } catch (e) { toast('Не удалось сохранить: ' + (e.message || e), 'error'); }
  }, { kind: 'secondary' });

  const page = h('div', { class: 'page' },
    h('div', { class: 'btn-row no-print' },
      bigButton('Печать', () => window.print(), { kind: 'primary', icon: '🖨' }),
      bigButton('Скачать SVG', () => downloadSvg(svgText, 'target-a4.svg').catch((e) => toast('Не удалось сохранить файл: ' + (e.message || e), 'error')), { kind: 'secondary' })),
    sheet,
    section('Как откалибровать',
      h('ol', { class: 'target-steps' },
        h('li', {}, 'Распечатайте лист на A4 в масштабе 100 % («фактический размер», без «подогнать под страницу»). Можно открыть файл target.html или скачать SVG и напечатать из любой программы.'),
        h('li', {}, `Измерьте линейкой контрольный отрезок внизу листа (между штрихами). Должно быть ${CONTROL_SEGMENT_MM} мм. Если нет — введите фактическую длину ниже, приложение учтёт масштаб принтера.`),
        h('li', {}, 'Наклейте лист на жёсткую ровную подложку (пластик, фанера). Ламинировать можно только матовой плёнкой — глянец даёт блики.'),
        h('li', {}, 'При съёмке мишень лежит на той же плоскости, что и детали, целиком в кадре, не ближе 3 см к деталям. Метки должны быть чистыми и не закрытыми.')),
      h('div', { class: 'muted' }, `Мишень: ${target.dictionary}, метки id ${target.ids.join(', ')}, сторона метки ${fmtMm(target.markerSideMm)} мм, расстояние между центрами ${fmtMm(target.spacingXMm)} × ${fmtMm(target.spacingYMm)} мм.`)),
    section('Масштаб печати', scaleInfo, stepper, saveBtn));
  root.appendChild(page);

  return () => { style.remove(); };
}
