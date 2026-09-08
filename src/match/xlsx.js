// Minimal XLSX reader (docs/SPEC.md §6.3): first worksheet -> string[][]. Pure JS, no DOM, no dependencies.
// ZIP is read directly (stored + deflate entries; deflate via the global DecompressionStream('deflate-raw'),
// present in Node 22 and modern browsers). Shared strings, inline strings and numbers are supported.

function badInput(message) {
  return Object.assign(new Error(message), { code: 'BAD_INPUT' });
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
  throw badInput('Ожидался файл XLSX (ArrayBuffer)');
}

const utf8 = new TextDecoder('utf-8');

// ---------- ZIP ----------

function readZipDirectory(bytes) {
  const n = bytes.length;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (n < 22) throw badInput('Файл не является XLSX (ZIP-архив не распознан)');
  // End of central directory record: signature 0x06054b50, scan back over the comment (<= 64 KiB)
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw badInput('Файл не является XLSX (ZIP-архив не распознан)');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF || count === 0xFFFF) throw badInput('ZIP64-архивы XLSX не поддерживаются');
  if (cdOffset + cdSize > n) throw badInput('Файл XLSX повреждён (каталог архива вне файла)');
  const entries = new Map();
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) throw badInput('Файл XLSX повреждён (каталог архива)');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name.replace(/\\/g, '/'), { name, flags, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') throw badInput('Браузер не поддерживает распаковку XLSX (DecompressionStream)');
  const ds = new DecompressionStream('deflate-raw');
  const reader = ds.readable.getReader();
  const writer = ds.writable.getWriter();
  const chunks = [];
  let total = 0;
  const readAll = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value); total += value.length;
    }
  })();
  // Copy into a fresh buffer: some runtimes reject views over shared/detached buffers.
  const writeAll = (async () => {
    await writer.write(new Uint8Array(data));
    await writer.close();
  })();
  await Promise.all([readAll, writeAll]);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function readZipEntry(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (p + 30 > bytes.length || dv.getUint32(p, true) !== 0x04034b50) throw badInput('Файл XLSX повреждён (запись архива)');
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw badInput('Файл XLSX повреждён (данные вне файла)');
  const data = bytes.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    let out;
    try { out = await inflateRaw(data); } catch (e) {
      if (e && e.code === 'BAD_INPUT') throw e;
      throw badInput('Файл XLSX повреждён (ошибка распаковки)');
    }
    if (entry.uncompressedSize && out.length !== entry.uncompressedSize) throw badInput('Файл XLSX повреждён (размер после распаковки не совпадает)');
    return out;
  }
  throw badInput(`Неподдерживаемый метод сжатия в XLSX (${entry.method})`);
}

// ---------- XML helpers (regex based; enough for SpreadsheetML) ----------

function decodeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[code];
  });
}

function attrs(tag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tag))) out[m[1] || m[3]] = decodeXml(m[2] ?? m[4] ?? '');
  return out;
}

// Concatenate all <t> text of a fragment (rich text runs, phonetic runs excluded).
function textOf(fragment) {
  let s = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  const parts = [];
  const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let m;
  while ((m = re.exec(s))) parts.push(decodeXml(m[1] || ''));
  return parts.join('');
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
  let m;
  while ((m = re.exec(xml))) out.push(textOf(m[1] || ''));
  return out;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndex(ref) {
  const m = /(\d+)$/.exec(ref || '');
  return m ? parseInt(m[1], 10) - 1 : -1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let rm;
  let nextRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const ra = attrs(rm[1] || '');
    let r = ra.r ? parseInt(ra.r, 10) - 1 : nextRow;
    if (!Number.isFinite(r) || r < 0) r = nextRow;
    nextRow = r + 1;
    const cells = [];
    const body = rm[2] || '';
    let cm;
    let nextCol = 0;
    while ((cm = cellRe.exec(body))) {
      const ca = attrs(cm[1] || '');
      let c = ca.r ? colIndex(ca.r) : nextCol;
      if (c < 0) c = nextCol;
      nextCol = c + 1;
      const inner = cm[2] || '';
      const t = ca.t || 'n';
      let value = '';
      if (t === 'inlineStr') value = textOf(inner);
      else {
        const vm = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/.exec(inner);
        const v = vm ? decodeXml(vm[1] || '').trim() : '';
        if (t === 's') { const idx = parseInt(v, 10); value = Number.isFinite(idx) && idx >= 0 && idx < shared.length ? shared[idx] : ''; }
        else if (t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : v;
        else value = v; // n, str, e, d
      }
      while (cells.length < c) cells.push('');
      cells[c] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  // drop trailing empty rows
  while (rows.length && !rows[rows.length - 1].some((v) => v !== '')) rows.pop();
  return rows;
}

function resolvePath(baseDir, target) {
  let t = String(target || '').replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

// Locate the first worksheet: workbook.xml <sheet r:id> -> workbook.xml.rels Target; fallback sheet1.xml.
async function firstSheetPath(bytes, entries) {
  const wbEntry = entries.get('xl/workbook.xml');
  let firstRid = null;
  if (wbEntry) {
    const wb = utf8.decode(await readZipEntry(bytes, wbEntry));
    const m = /<(?:\w+:)?sheet\b([^>]*)\/?>/.exec(wb);
    if (m) {
      const a = attrs(m[1]);
      firstRid = a['r:id'] || Object.entries(a).find(([k]) => /:id$/.test(k))?.[1] || null;
    }
  }
  if (firstRid) {
    const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
    if (relsEntry) {
      const rels = utf8.decode(await readZipEntry(bytes, relsEntry));
      const re = /<(?:\w+:)?Relationship\b([^>]*)\/?>/g;
      let m;
      while ((m = re.exec(rels))) {
        const a = attrs(m[1]);
        if (a.Id === firstRid && a.Target) {
          const p = resolvePath('xl', a.Target);
          if (entries.has(p)) return p;
        }
      }
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  const any = Array.from(entries.keys()).filter((k) => /^xl\/worksheets\/sheet\d*\.xml$/i.test(k)).sort();
  return any[0] || null;
}

/**
 * Read the first worksheet of an .xlsx file as rows of strings (numbers as their text form).
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @returns {Promise<string[][]>}
 */
export async function parseXlsx(arrayBuffer) {
  const bytes = toBytes(arrayBuffer);
  const entries = readZipDirectory(bytes);
  if (!entries.has('[Content_Types].xml') && !Array.from(entries.keys()).some((k) => k.startsWith('xl/'))) {
    throw badInput('Файл не является XLSX (нет структуры книги Excel)');
  }
  const sheetPath = await firstSheetPath(bytes, entries);
  if (!sheetPath) throw badInput('В XLSX не найден лист');
  let shared = [];
  const ssEntry = entries.get('xl/sharedStrings.xml');
  if (ssEntry) shared = parseSharedStrings(utf8.decode(await readZipEntry(bytes, ssEntry)));
  const sheetXml = utf8.decode(await readZipEntry(bytes, entries.get(sheetPath)));
  return parseSheet(sheetXml, shared);
}
