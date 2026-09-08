// CSV part lists (docs/SPEC.md §6.3). Pure JS: no DOM, no OpenCV.
import { normalizeParts } from './parts.js';

const DELIMITERS = [';', ',', '\t'];

// Count occurrences of each candidate delimiter outside quotes, per line.
function countOutsideQuotes(line) {
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch in counts) counts[ch]++;
  }
  return counts;
}

// Pick the delimiter with the most consistent non-zero count over the first lines.
export function detectDelimiter(text) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/).filter((l) => l.trim() !== '').slice(0, 30);
  let best = ';'; let bestScore = -1; let bestTotal = -1;
  for (const d of DELIMITERS) {
    const hist = new Map();
    let total = 0;
    for (const line of lines) {
      const c = countOutsideQuotes(line)[d];
      if (c > 0) { hist.set(c, (hist.get(c) || 0) + 1); total += c; }
    }
    let score = 0;
    for (const v of hist.values()) if (v > score) score = v;
    if (score > bestScore || (score === bestScore && total > bestTotal)) { best = d; bestScore = score; bestTotal = total; }
  }
  return best;
}

/**
 * Parse CSV text into rows of strings. Delimiter auto-detected (; , tab), quotes with "" escapes,
 * newlines inside quotes, CRLF and UTF-8 BOM tolerated. Fully empty rows are dropped.
 */
export function parseCsv(text, { delimiter = null } = {}) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const d = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;
  const n = s.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
  while (i < n) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === d) { endField(); i++; continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) endRow();
  return rows.map((r) => r.map((c) => c.trim()));
}

// ---------- rows -> parts ----------

// Header words are matched as token prefixes ("Длина, мм" -> "длина"; "кол-во" -> "кол"), single letters exactly.
// Order matters: length/width/qty are tested before id so that e.g. "width" is never taken for "id".
const HEADER_PATTERNS = [
  ['length', { words: ['длина', 'length', 'len', 'long'], letters: ['l', 'a'] }],
  ['width', { words: ['ширина', 'width', 'wid'], letters: ['w', 'b'] }],
  ['qty', { words: ['кол', 'штук', 'количество', 'qty', 'quantity', 'count', 'pcs', 'шт'], letters: ['q'], weak: ['n'] }],
  ['id', { words: ['артикул', 'деталь', 'наименование', 'название', 'обозначение', 'позиция', 'name', 'part', 'label', 'код', 'ident'], letters: ['id'], weak: ['№', 'no', 'п/п'] }],
];
const UNIT_TOKENS = new Set(['мм', 'mm', 'см', 'дюйм', 'дюймы', 'in', 'inch', 'inches']);

function headerTokens(cell) {
  const h = String(cell ?? '').toLowerCase().trim();
  if (!h) return [];
  return h.split(/[^\p{L}\p{N}№/]+/u).filter((t) => t && !UNIT_TOKENS.has(t));
}

// -> { kind, weak } | null
function headerKind(cell) {
  const tokens = headerTokens(cell);
  if (!tokens.length) return null;
  for (const [kind, pat] of HEADER_PATTERNS) {
    if (tokens.some((t) => pat.letters.includes(t) || pat.words.some((w) => t.startsWith(w)))) return { kind, weak: false };
  }
  for (const [kind, pat] of HEADER_PATTERNS) {
    if (pat.weak && tokens.some((t) => pat.weak.includes(t))) return { kind, weak: true };
  }
  return null;
}

// Detect a header row: returns { id, length, width, qty } column indexes (or -1) when the row looks
// like a header (has both length and width or at least two recognised columns), else null.
function detectHeader(row) {
  const cols = { id: -1, length: -1, width: -1, qty: -1 };
  const weak = { id: -1, length: -1, width: -1, qty: -1 };
  row.forEach((cell, i) => {
    const k = headerKind(cell);
    if (!k) return;
    if (k.weak) { if (weak[k.kind] === -1) weak[k.kind] = i; } else if (cols[k.kind] === -1) cols[k.kind] = i;
  });
  let hits = 0;
  for (const kind of Object.keys(cols)) {
    if (cols[kind] === -1 && weak[kind] !== -1 && !Object.values(cols).includes(weak[kind])) cols[kind] = weak[kind];
    if (cols[kind] !== -1) hits++;
  }
  if (cols.length !== -1 && cols.width !== -1) return cols;
  if (hits >= 2) return cols;
  return null;
}

// Parse a number with decimal comma, thousands spaces and trailing units ("1 200,5 мм" -> 1200.5).
export function parseNumber(cell) {
  if (cell == null) return NaN;
  if (typeof cell === 'number') return cell;
  let s = String(cell).trim().toLowerCase();
  if (!s) return NaN;
  s = s.replace(/(мм|mm|шт|pcs|pc)\.?$/g, '').trim();
  s = s.replace(/[\s ']/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const m = /^-?\d*\.?\d+(e[-+]?\d+)?/.exec(s);
  if (!m) return NaN;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : NaN;
}

// "380x240", "380 × 240", "380*240" -> [380, 240]
function parseDims(cell) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[x×X*хХ]\s*(\d+(?:[.,]\d+)?)\s*(мм|mm)?\s*$/.exec(String(cell ?? ''));
  if (!m) return null;
  return [parseNumber(m[1]), parseNumber(m[2])];
}

function isNumericCell(cell) {
  return Number.isFinite(parseNumber(cell)) || parseDims(cell) !== null;
}

/**
 * Convert rows (string[][]) into plan parts. Header detection by names (id|name|артикул|деталь|наименование,
 * length|длина|l|a, width|ширина|w|b, qty|кол|count|n); without a header the columns are taken by position:
 * [id, length, width, qty] or [length, width, qty]. Decimal comma accepted. "380x240" in the length column is split.
 * @returns {{ parts:Array, warnings:string[] }}
 */
export function rowsToParts(rows) {
  const warnings = [];
  const list = (rows || []).map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []))
    .filter((r) => r.some((c) => c.trim() !== ''));
  if (!list.length) {
    warnings.push('Файл пуст — деталей не найдено');
    return { parts: [], warnings };
  }
  let cols = null;
  let start = 0;
  for (let i = 0; i < Math.min(list.length, 5); i++) {
    const h = detectHeader(list[i]);
    if (h) { cols = h; start = i + 1; break; }
  }
  if (!cols) {
    const first = list[0];
    const firstNumeric = first.length > 0 && isNumericCell(first[0]);
    cols = firstNumeric ? { id: -1, length: 0, width: 1, qty: 2 } : { id: 0, length: 1, width: 2, qty: 3 };
    if (first.length < (firstNumeric ? 2 : 3)) {
      warnings.push('Не удалось распознать столбцы (нужны длина и ширина)');
      return { parts: [], warnings };
    }
    warnings.push('Заголовок не распознан — столбцы взяты по порядку: ' + (firstNumeric ? 'длина, ширина, кол-во' : 'деталь, длина, ширина, кол-во'));
  }
  const parts = [];
  let skipped = 0;
  for (let r = start; r < list.length; r++) {
    const row = list[r];
    const get = (idx) => (idx >= 0 && idx < row.length ? row[idx] : '');
    const idRaw = get(cols.id).trim();
    let L = parseNumber(get(cols.length));
    let W = parseNumber(get(cols.width));
    if (!Number.isFinite(W)) {
      const dims = parseDims(get(cols.length)) || (cols.id >= 0 ? parseDims(get(cols.id)) : null);
      if (dims) [L, W] = dims;
    }
    if (!Number.isFinite(L) && cols.id >= 0) {
      const dims = parseDims(get(cols.id));
      if (dims) [L, W] = dims;
    }
    if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) {
      skipped++;
      continue;
    }
    let qty = cols.qty >= 0 ? parseNumber(get(cols.qty)) : NaN;
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    qty = Math.round(qty);
    parts.push({ id: idRaw, lengthMm: L, widthMm: W, qty, polygonMm: null, areaMm2: L * W, rectangular: true, source: 'list' });
  }
  if (skipped) warnings.push(`Строк без размеров пропущено: ${skipped}`);
  if (!parts.length) warnings.push('Деталей не найдено — проверьте столбцы «Длина» и «Ширина»');
  return { parts: normalizeParts(parts), warnings };
}
