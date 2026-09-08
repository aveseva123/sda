// Test mode helpers (pure, no DOM): reference lists, measured-vs-reference evaluation, synthetic scenes.
// Works in Node and in the browser. The Hungarian assignment is loaded lazily from src/match/hungarian.js;
// if that module is unavailable a greedy nearest-pair assignment is used instead.

let assignerPromise = null;

function loadAssigner() {
  if (!assignerPromise) {
    assignerPromise = import('../match/hungarian.js')
      .then((m) => (typeof m.hungarian === 'function' ? m.hungarian : null))
      .catch(() => null);
  }
  return assignerPromise;
}

// Greedy fallback: repeatedly take the cheapest unused (row, col) pair.
export function greedyAssign(cost) {
  const rows = cost.length; const cols = rows ? cost[0].length : 0;
  const usedR = new Uint8Array(rows); const usedC = new Uint8Array(cols);
  const pairs = [];
  const n = Math.min(rows, cols);
  for (let k = 0; k < n; k++) {
    let best = Infinity; let bi = -1; let bj = -1;
    for (let i = 0; i < rows; i++) {
      if (usedR[i]) continue;
      for (let j = 0; j < cols; j++) {
        if (usedC[j]) continue;
        const v = cost[i][j];
        if (v < best) { best = v; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    usedR[bi] = 1; usedC[bj] = 1;
    pairs.push([bi, bj]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs;
}

function toNumber(token) {
  if (typeof token !== 'string') return NaN;
  const t = token.trim().replace(/\s+/g, '').replace(',', '.').replace(/(мм|mm)$/i, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

// Split one line into tokens: separators ; , tab, and x/×/х between numbers; decimal comma is preserved.
function tokenize(line) {
  // Decimal comma: digit,1-2 digits not followed by another digit -> decimal point.
  let s = line.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  // 'LxW', 'L x W', 'L×W' (Latin x, X, Cyrillic х, Х, ×) between numbers -> separator.
  s = s.replace(/(\d)\s*[x×хХX]\s*(?=\d)/g, '$1;');
  let tokens = s.split(/[;,\t]/).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length < 2) tokens = s.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens;
}

/**
 * Parse a reference list. Accepted line formats: 'id;L;W', 'L;W', 'LxW', 'L;W;id'; separators ; , tab x ×;
 * decimal comma allowed; '#' starts a comment; header lines without numbers are skipped.
 * Returns [{ id, lengthMm, widthMm }] with lengthMm >= widthMm.
 */
export function referenceFromText(text) {
  const out = [];
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n|\r/);
  let auto = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const tokens = tokenize(line);
    if (tokens.length < 2) continue;
    const nums = tokens.map(toNumber);
    let id = null; let a = NaN; let b = NaN;
    if (tokens.length >= 3 && !Number.isNaN(nums[1]) && !Number.isNaN(nums[2])) {
      id = tokens[0]; a = nums[1]; b = nums[2];
    } else if (!Number.isNaN(nums[0]) && !Number.isNaN(nums[1])) {
      a = nums[0]; b = nums[1];
      if (tokens.length >= 3 && Number.isNaN(nums[2])) id = tokens[2];
    } else {
      continue; // header or garbage
    }
    if (!(a > 0) || !(b > 0)) continue;
    auto += 1;
    if (!id) id = `P-${String(auto).padStart(2, '0')}`;
    out.push({ id, lengthMm: Math.max(a, b), widthMm: Math.min(a, b) });
  }
  return out;
}

// Discrepancy of a measured part vs a reference in the best of two orientations.
export function pairError(m, r) {
  const mL = Number(m.lengthMm); const mW = Number(m.widthMm);
  const same = { dL: mL - r.lengthMm, dW: mW - r.widthMm, orientation: 'same' };
  const rot = { dL: mW - r.lengthMm, dW: mL - r.widthMm, orientation: 'rotated' };
  const cs = Math.max(Math.abs(same.dL), Math.abs(same.dW));
  const cr = Math.max(Math.abs(rot.dL), Math.abs(rot.dW));
  const best = cr < cs ? rot : same;
  return { ...best, errMax: Math.min(cs, cr) };
}

function round(v, d = 2) {
  return Number.isFinite(v) ? Number(v.toFixed(d)) : null;
}

/**
 * Compare measured parts with a reference list.
 * measuredParts: [{ lengthMm, widthMm, index? }], reference: [{ id, lengthMm, widthMm }].
 * Returns a Promise of { rows, summary } (the assignment module is loaded lazily).
 * rows: [{ id, refL, refW, measL, measW, errL, errW, errMax, ok, status:'ok'|'err'|'missing'|'extra', measuredIndex, orientation }]
 * summary: { n, matched, maxErrMm, meanErrMm, withinTol, withinTolPct, unmatchedRef, unmatchedMeasured, toleranceOkMm }
 */
export async function evaluate(measuredParts, reference, { toleranceOkMm = 2, maxPairErrMm = 50 } = {}) {
  const measured = (measuredParts || []).map((p, i) => ({ lengthMm: Number(p.lengthMm), widthMm: Number(p.widthMm), index: p.index ?? i }));
  const refs = (reference || []).map((r, i) => ({ id: r.id || `P-${String(i + 1).padStart(2, '0')}`, lengthMm: Number(r.lengthMm), widthMm: Number(r.widthMm) }));
  const cost = measured.map((m) => refs.map((r) => pairError(m, r).errMax));
  let pairs = [];
  if (measured.length && refs.length) {
    const hungarian = await loadAssigner();
    try { pairs = hungarian ? hungarian(cost) : greedyAssign(cost); } catch { pairs = greedyAssign(cost); }
  }
  const usedM = new Set(); const usedR = new Set();
  const rows = [];
  for (const [i, j] of pairs) {
    if (!measured[i] || !refs[j]) continue;
    const e = pairError(measured[i], refs[j]);
    if (!(e.errMax <= maxPairErrMm)) continue; // implausible pair: treat both as unmatched
    usedM.add(i); usedR.add(j);
    const ok = e.errMax <= toleranceOkMm;
    rows.push({
      id: refs[j].id, refL: refs[j].lengthMm, refW: refs[j].widthMm,
      measL: round(measured[i].lengthMm), measW: round(measured[i].widthMm),
      errL: round(e.dL), errW: round(e.dW), errMax: round(e.errMax), ok, status: ok ? 'ok' : 'err',
      measuredIndex: measured[i].index, refIndex: j, orientation: e.orientation,
    });
  }
  refs.forEach((r, j) => {
    if (usedR.has(j)) return;
    rows.push({ id: r.id, refL: r.lengthMm, refW: r.widthMm, measL: null, measW: null, errL: null, errW: null, errMax: null, ok: false, status: 'missing', measuredIndex: null, refIndex: j, orientation: null });
  });
  measured.forEach((m, i) => {
    if (usedM.has(i)) return;
    rows.push({ id: `лишняя ${m.index + 1}`, refL: null, refW: null, measL: round(m.lengthMm), measW: round(m.widthMm), errL: null, errW: null, errMax: null, ok: false, status: 'extra', measuredIndex: m.index, refIndex: null, orientation: null });
  });
  rows.sort((a, b) => {
    const ra = a.refIndex ?? Infinity; const rb = b.refIndex ?? Infinity;
    if (ra !== rb) return ra - rb;
    return (a.measuredIndex ?? Infinity) - (b.measuredIndex ?? Infinity);
  });
  const matchedRows = rows.filter((r) => r.status === 'ok' || r.status === 'err');
  const errs = matchedRows.map((r) => r.errMax);
  const n = refs.length;
  const withinTol = matchedRows.filter((r) => r.ok).length;
  const summary = {
    n,
    matched: matchedRows.length,
    maxErrMm: errs.length ? round(Math.max(...errs)) : null,
    meanErrMm: errs.length ? round(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
    withinTol,
    withinTolPct: n ? Math.round((withinTol / n) * 1000) / 10 : 0,
    unmatchedRef: n - matchedRows.length,
    unmatchedMeasured: measured.length - matchedRows.length,
    toleranceOkMm,
  };
  return { rows, summary };
}

// Reference entries for synthetic parts: S1, S2, ... with length = max(w, h), width = min(w, h).
export function referenceFromParts(parts) {
  return parts.map((p, i) => ({ id: `S${i + 1}`, lengthMm: Math.max(p.w, p.h), widthMm: Math.min(p.w, p.h) }));
}

// Six parts of different sizes around the target. S4 (y 215) and S5 (y 360) are spaced so that the
// rotated rectangles keep a >= 40 mm gap (at y 230 / 330 they touch and segment as one blob).
const SIX_PARTS = [
  { x: 330, y: 60, w: 250, h: 120, angleDeg: 0 },
  { x: 330, y: 230, w: 100, h: 50, angleDeg: 30 },
  { x: -140, y: 40, w: 150, h: 150, angleDeg: 0 },
  { x: -140, y: 215, w: 200, h: 80, angleDeg: -15 },
  { x: 65, y: 360, w: 400, h: 90, angleDeg: 5 },
  { x: 330, y: 330, w: 80, h: 40, angleDeg: 60 },
];

/**
 * Scenes for the in-app synthetic test. Each spec is the argument of standardScene() from './synth.js';
 * the camera centre (centerMm) is chosen so that every part is fully inside the 1600x1200 frame.
 * Returns [{ name, spec, reference }].
 */
export function syntheticScenes() {
  const base = { widthPx: 1600, heightPx: 1200, pxPerMm: 2.2, shadows: true, noise: 3 };
  const a4 = [{ x: 330, y: 105, w: 297, h: 210, angleDeg: 12 }];
  return [
    {
      name: 'A4 лист 297×210, наклон 0°',
      spec: { ...base, tiltDeg: 0, centerMm: [230, 105], parts: a4 },
      reference: referenceFromParts(a4),
    },
    {
      name: '6 деталей, наклон 15°',
      // 2.0 px/mm: the six-part layout is 670 mm wide and does not fit the frame at 2.2 px/mm.
      spec: { ...base, pxPerMm: 2.0, tiltDeg: 15, centerMm: [120, 175], parts: SIX_PARTS },
      reference: referenceFromParts(SIX_PARTS),
    },
  ];
}

// CSV (UTF-8 BOM, ';') of evaluation rows for export.
export function rowsToCsv(rows, { sceneName = '' } = {}) {
  const f = (v) => (v === null || v === undefined ? '' : String(typeof v === 'number' ? v.toFixed(2) : v).replace(/;/g, ','));
  const status = { ok: 'ок', err: 'ошибка', missing: 'не найдена', extra: 'лишняя' };
  const lines = ['\uFEFFСцена;ID;Эталон L;Эталон W;Факт L;Факт W;dL;dW;Макс. ошибка;Статус'];
  for (const r of rows) lines.push([sceneName, r.id, r.refL, r.refW, r.measL, r.measW, r.errL, r.errW, r.errMax, status[r.status] || r.status].map(f).join(';'));
  return lines.join('\r\n') + '\r\n';
}
