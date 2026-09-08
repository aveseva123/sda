// CSV export (SPEC section 9). Pure JS, no DOM: runs in Node and in the browser.
// Excel (RU locale) conventions: UTF-8 BOM, ';' separator, decimal comma, CRLF line ends.

export const BOM = '\uFEFF';
export const SEP = ';';
export const EOL = '\r\n';

export const COMPARE_HEADER = ['Статус', 'ID', 'План L, мм', 'План W, мм', 'Факт L, мм', 'Факт W, мм', 'Расхождение, мм', 'Ориентация'];
export const MEASUREMENT_HEADER = ['№', 'Длина, мм', 'Ширина, мм', 'Площадь, мм²', 'Прямоугольность', 'ID'];

export const STATUS_TEXT = { found: 'Найдено', missing: 'Не хватает', extra: 'Лишнее' };
export const ORIENTATION_TEXT = { same: 'как в плане', rotated: 'повёрнута на 90°' };

// Quote a field when it contains the separator, quotes or line breaks; double inner quotes.
export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Number with a fixed number of decimals and a comma as the decimal separator; '' for non-numbers.
export function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  let s = n.toFixed(digits);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace('.', ',');
}

export function toCsv(rows) {
  return BOM + rows.map((r) => r.map(csvEscape).join(SEP)).join(EOL) + EOL;
}

// Measured parts with manual overrides applied: { index, lengthMm, widthMm, areaMm2, rectangularity,
// planId, ignored }. planId comes from the override first, then from the match.
export function effectiveParts(measurement) {
  const m = measurement || {};
  const parts = (m.result && Array.isArray(m.result.parts)) ? m.result.parts : [];
  const overrides = m.overrides && typeof m.overrides === 'object' ? m.overrides : {};
  const matches = (m.match && Array.isArray(m.match.matches)) ? m.match.matches : [];
  return parts.map((p, i) => {
    const index = Number.isInteger(p.index) ? p.index : i;
    const o = overrides[index] || {};
    const hit = matches.find((x) => x.measuredIndex === index);
    return {
      ...p,
      index,
      lengthMm: o.lengthMm !== undefined && o.lengthMm !== null ? o.lengthMm : p.lengthMm,
      widthMm: o.widthMm !== undefined && o.widthMm !== null ? o.widthMm : p.widthMm,
      planId: o.planId || (hit ? hit.planId : null) || null,
      ignored: !!o.ignored,
      edited: (o.lengthMm !== undefined && o.lengthMm !== null) || (o.widthMm !== undefined && o.widthMm !== null),
    };
  });
}

function findPlanPart(order, planIndex, planId) {
  const parts = (order && Array.isArray(order.parts)) ? order.parts : [];
  if (Number.isInteger(planIndex) && parts[planIndex] && (planId === undefined || planId === null || parts[planIndex].id === planId)) return parts[planIndex];
  if (planId !== undefined && planId !== null) return parts.find((p) => p.id === planId) || null;
  return null;
}

/**
 * Comparison table: one row per matched part ("Найдено"), per missing plan item ("Не хватает",
 * ID column carries the missing quantity as "ID ×N", fact columns empty) and per unexplained
 * measured part ("Лишнее", ID column shows the nearest plan item as "≈ID" when known).
 */
export function compareToCsv({ order = null, measurement = null, match = null } = {}) {
  const mt = match || (measurement && measurement.match) || null;
  const rows = [COMPARE_HEADER];
  if (!mt) return toCsv(rows);
  const eff = effectiveParts(measurement);
  const measured = (i) => eff.find((p) => p.index === i) || null;

  for (const x of (Array.isArray(mt.matches) ? mt.matches : [])) {
    const plan = findPlanPart(order, x.planIndex, x.planId);
    const mp = measured(x.measuredIndex);
    rows.push([
      STATUS_TEXT.found,
      x.planId !== undefined && x.planId !== null ? String(x.planId) : (plan ? String(plan.id) : ''),
      fmtNum(plan ? plan.lengthMm : x.planLengthMm),
      fmtNum(plan ? plan.widthMm : x.planWidthMm),
      fmtNum(mp ? mp.lengthMm : null),
      fmtNum(mp ? mp.widthMm : null),
      fmtNum(x.discrepancyMm),
      ORIENTATION_TEXT[x.orientation] || (x.orientation ? String(x.orientation) : ''),
    ]);
  }
  for (const x of (Array.isArray(mt.missing) ? mt.missing : [])) {
    const plan = findPlanPart(order, x.planIndex, x.planId);
    const qty = Number.isFinite(Number(x.qtyMissing)) ? Number(x.qtyMissing) : 1;
    const id = x.planId !== undefined && x.planId !== null ? String(x.planId) : (plan ? String(plan.id) : '');
    rows.push([
      STATUS_TEXT.missing,
      `${id} ×${qty}`,
      fmtNum(x.lengthMm !== undefined ? x.lengthMm : (plan ? plan.lengthMm : null)),
      fmtNum(x.widthMm !== undefined ? x.widthMm : (plan ? plan.widthMm : null)),
      '', '', '', '',
    ]);
  }
  for (const x of (Array.isArray(mt.extra) ? mt.extra : [])) {
    const mp = measured(x.measuredIndex);
    const nearest = x.nearest && x.nearest.planId !== undefined && x.nearest.planId !== null ? x.nearest : null;
    rows.push([
      STATUS_TEXT.extra,
      nearest ? `≈${nearest.planId}` : '',
      '', '',
      fmtNum(mp ? mp.lengthMm : x.lengthMm),
      fmtNum(mp ? mp.widthMm : x.widthMm),
      nearest ? fmtNum(nearest.discrepancyMm) : '',
      '',
    ]);
  }
  return toCsv(rows);
}

// One row per measured part (overrides applied; parts excluded by the user are skipped).
export function measurementsToCsv(measurement) {
  const rows = [MEASUREMENT_HEADER];
  for (const p of effectiveParts(measurement)) {
    if (p.ignored) continue;
    rows.push([
      String(p.index + 1),
      fmtNum(p.lengthMm),
      fmtNum(p.widthMm),
      fmtNum(p.areaMm2, 0),
      fmtNum(p.rectangularity, 2),
      p.planId || '',
    ]);
  }
  return toCsv(rows);
}
