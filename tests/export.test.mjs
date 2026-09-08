import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareToCsv, measurementsToCsv, csvEscape, fmtNum, effectiveParts, BOM, COMPARE_HEADER, MEASUREMENT_HEADER } from '../src/export/csv.js';
import { measurementToJson } from '../src/export/json.js';
import { hitTest, renderOverlay, STATUS_COLORS, hexToRgba } from '../src/export/image.js';
import { saveOrShare, sanitizeFileName } from '../src/export/share.js';
import * as db from '../src/store/db.js';

// ---------------------------------------------------------------------------------------------
// Fixtures (hand-built, deterministic)

function makeOrder() {
  return {
    id: 'o1', name: 'Полки', number: '1287', createdAt: '2026-09-08T10:00:00.000Z',
    source: { type: 'dxf', fileName: 'nest.dxf' }, thicknessMm: 2, sheet: { lengthMm: 1250, widthMm: 2500 },
    parts: [
      { id: 'SHELF-04', lengthMm: 400, widthMm: 250, qty: 2, polygonMm: null, areaMm2: 100000, rectangular: true, source: 'block' },
      { id: 'A;B', lengthMm: 300.4, widthMm: 200, qty: 1, polygonMm: null, areaMm2: 60080, rectangular: true, source: 'block' },
      { id: 'Q"1', lengthMm: 120, widthMm: 80, qty: 3, polygonMm: null, areaMm2: 9600, rectangular: true, source: 'block' },
    ],
  };
}

function rect(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function makeMeasurement({ withPhoto = true } = {}) {
  const parts = [
    { index: 0, lengthMm: 401.2, widthMm: 249.6, areaMm2: 100139.5, rectangularity: 0.986, angleDeg: 3, refined: true, cornersMm: rect(0, 0, 401.2, 249.6), cornersPx: rect(100, 100, 400, 250), polygonMm: [], polygonPx: [] },
    { index: 1, lengthMm: 300.4, widthMm: 199.9, areaMm2: 60050, rectangularity: 0.97, angleDeg: 0, refined: true, cornersMm: rect(0, 0, 300.4, 199.9), cornersPx: rect(600, 100, 300, 200), polygonMm: [], polygonPx: [] },
    { index: 2, lengthMm: 500, widthMm: 100, areaMm2: 50000, rectangularity: 0.99, angleDeg: 0, refined: false, cornersMm: rect(0, 0, 500, 100), cornersPx: rect(100, 500, 500, 100), polygonMm: [], polygonPx: [] },
  ];
  const photo = withPhoto ? new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }) : null;
  return {
    id: 'm-0001', createdAt: '2026-09-08T11:00:00.000Z', mode: 'batch', orderId: 'o1',
    photo, photoWidth: 1600, photoHeight: 1200,
    result: {
      ok: true,
      image: { width: 1600, height: 1200 },
      target: { markersFound: 4, ids: [0, 1, 2, 3], markers: [{ id: 0, corners: rect(10, 10, 40, 40) }] },
      quality: { reprojMaxPx: 0.4, tiltDeg: 5, warnings: [], ok: true },
      parts,
    },
    overrides: { 1: { lengthMm: 301.0 } },
    match: null,
    notes: '',
  };
}

function makeMatch() {
  return {
    matches: [
      { measuredIndex: 0, planId: 'SHELF-04', planIndex: 0, discrepancyMm: 1.2, orientation: 'same', dL: 1.2, dW: -0.4 },
      { measuredIndex: 1, planId: 'A;B', planIndex: 1, discrepancyMm: 0.7, orientation: 'rotated', dL: 0.6, dW: -0.1 },
    ],
    missing: [
      { planId: 'SHELF-04', planIndex: 0, lengthMm: 400, widthMm: 250, qtyPlanned: 2, qtyFound: 1, qtyMissing: 1 },
      { planId: 'Q"1', planIndex: 2, lengthMm: 120, widthMm: 80, qtyPlanned: 3, qtyFound: 0, qtyMissing: 3 },
    ],
    extra: [
      { measuredIndex: 2, lengthMm: 500, widthMm: 100, nearest: { planId: 'SHELF-04', discrepancyMm: 150 } },
    ],
    candidates: {},
    ambiguous: [],
  };
}

function csvLines(csv) {
  assert.ok(csv.startsWith(BOM), 'starts with UTF-8 BOM');
  assert.ok(csv.endsWith('\r\n'), 'CRLF terminated');
  return csv.slice(1).split('\r\n').filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------------------------
// csv.js

test('csv helpers: escaping and RU number formatting', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a;b'), '"a;b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(fmtNum(401.25), '401,3');
  assert.equal(fmtNum(400), '400,0');
  assert.equal(fmtNum(-0.04), '0,0');
  assert.equal(fmtNum(-1.26), '-1,3');
  assert.equal(fmtNum(0.986, 2), '0,99');
  assert.equal(fmtNum(0.984, 2), '0,98');
  assert.equal(fmtNum(null), '');
  assert.equal(fmtNum(NaN), '');
  assert.equal(fmtNum('12.34'), '12,3');
});

test('compareToCsv: header, row counts, statuses, decimal comma, escaping', () => {
  const order = makeOrder();
  const measurement = makeMeasurement();
  const match = makeMatch();
  const csv = compareToCsv({ order, measurement, match });
  const lines = csvLines(csv);
  assert.equal(lines.length, 1 + 2 + 2 + 1);
  assert.equal(lines[0], 'Статус;ID;План L, мм;План W, мм;Факт L, мм;Факт W, мм;Расхождение, мм;Ориентация');
  assert.equal(lines[0], COMPARE_HEADER.join(';'));
  assert.equal(lines[1], 'Найдено;SHELF-04;400,0;250,0;401,2;249,6;1,2;как в плане');
  // override lengthMm=301.0 applied; id with ';' quoted; rotated orientation text
  assert.equal(lines[2], 'Найдено;"A;B";300,4;200,0;301,0;199,9;0,7;повёрнута на 90°');
  assert.equal(lines[3], 'Не хватает;SHELF-04 ×1;400,0;250,0;;;;');
  assert.equal(lines[4], 'Не хватает;"Q""1 ×3";120,0;80,0;;;;');
  assert.equal(lines[5], 'Лишнее;≈SHELF-04;;;500,0;100,0;150,0;');
  // every row has exactly 8 columns (count separators outside quotes)
  for (const line of lines) {
    let cols = 1; let inQ = false;
    for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ';' && !inQ) cols++; }
    assert.equal(cols, 8, `columns in: ${line}`);
  }
  // no dots used as decimal separators in numeric cells
  assert.ok(!/\d\.\d/.test(csv), 'no decimal points');
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('compareToCsv: falls back to measurement.match and tolerates missing order / no match', () => {
  const measurement = makeMeasurement();
  measurement.match = makeMatch();
  const withOrder = csvLines(compareToCsv({ order: makeOrder(), measurement }));
  assert.equal(withOrder.length, 6);
  // No order: plan dims for matches unknown -> empty, missing rows keep their own dims
  const noOrder = csvLines(compareToCsv({ order: null, measurement, match: makeMatch() }));
  assert.equal(noOrder.length, 6);
  assert.equal(noOrder[1], 'Найдено;SHELF-04;;;401,2;249,6;1,2;как в плане');
  assert.equal(noOrder[3], 'Не хватает;SHELF-04 ×1;400,0;250,0;;;;');
  // Nothing to compare: header only
  const none = csvLines(compareToCsv({ order: makeOrder(), measurement: makeMeasurement(), match: null }));
  assert.equal(none.length, 1);
  const empty = csvLines(compareToCsv({ order: makeOrder(), measurement: makeMeasurement(), match: { matches: [], missing: [], extra: [] } }));
  assert.equal(empty.length, 1);
});

test('compareToCsv: extra without nearest and missing qty defaults', () => {
  const match = { matches: [], missing: [{ planId: 'X', planIndex: 0, lengthMm: 10, widthMm: 5 }], extra: [{ measuredIndex: 2, lengthMm: 500, widthMm: 100, nearest: null }] };
  const lines = csvLines(compareToCsv({ order: makeOrder(), measurement: makeMeasurement(), match }));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], 'Не хватает;X ×1;10,0;5,0;;;;');
  assert.equal(lines[2], 'Лишнее;;;;500,0;100,0;;');
});

test('measurementsToCsv: header, overrides, ids from match/override, ignored parts skipped', () => {
  const m = makeMeasurement();
  m.match = makeMatch();
  m.overrides = { 1: { lengthMm: 301.0 }, 2: { planId: 'MANUAL-7' } };
  const lines = csvLines(measurementsToCsv(m));
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '№;Длина, мм;Ширина, мм;Площадь, мм²;Прямоугольность;ID');
  assert.equal(lines[0], MEASUREMENT_HEADER.join(';'));
  assert.equal(lines[1], '1;401,2;249,6;100140;0,99;SHELF-04');
  assert.equal(lines[2], '2;301,0;199,9;60050;0,97;"A;B"');
  assert.equal(lines[3], '3;500,0;100,0;50000;0,99;MANUAL-7');

  m.overrides[0] = { ignored: true };
  const lines2 = csvLines(measurementsToCsv(m));
  assert.equal(lines2.length, 3);
  assert.equal(lines2[1].slice(0, 2), '2;');

  // No parts at all -> header only; no result -> header only
  assert.equal(csvLines(measurementsToCsv({ result: { parts: [] } })).length, 1);
  assert.equal(csvLines(measurementsToCsv({})).length, 1);
});

test('effectiveParts applies overrides and resolves plan ids', () => {
  const m = makeMeasurement();
  m.match = makeMatch();
  m.overrides = { 1: { lengthMm: 301.0, widthMm: 198 }, 2: { planId: 'MANUAL-7', ignored: true } };
  const eff = effectiveParts(m);
  assert.equal(eff.length, 3);
  assert.equal(eff[0].planId, 'SHELF-04');
  assert.equal(eff[0].edited, false);
  assert.equal(eff[1].lengthMm, 301.0);
  assert.equal(eff[1].widthMm, 198);
  assert.equal(eff[1].edited, true);
  assert.equal(eff[1].planId, 'A;B');
  assert.equal(eff[2].planId, 'MANUAL-7');
  assert.equal(eff[2].ignored, true);
  // original untouched
  assert.equal(m.result.parts[1].lengthMm, 300.4);
});

// ---------------------------------------------------------------------------------------------
// json.js

test('measurementToJson: pretty, omits the photo blob, keeps dimensions, includes order summary', () => {
  const m = makeMeasurement();
  m.match = makeMatch();
  const json = measurementToJson(m, makeOrder());
  assert.ok(json.includes('\n  "'), 'pretty printed with 2-space indent');
  assert.ok(!json.includes('dataUrl'));
  assert.ok(!json.includes('base64'));
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.photo, { width: 1600, height: 1200 });
  assert.equal(parsed.id, 'm-0001');
  assert.equal(parsed.mode, 'batch');
  assert.equal(parsed.order.number, '1287');
  assert.equal(parsed.order.parts.length, 3);
  assert.equal(parsed.order.parts[0].id, 'SHELF-04');
  assert.equal(parsed.result.parts.length, 3);
  assert.equal(parsed.match.matches.length, 2);
  assert.equal(parsed.effectiveParts[1].lengthMm, 301);
  assert.equal(parsed.effectiveParts[1].planId, 'A;B');
  assert.equal(parsed.version, 1);
  assert.ok(typeof parsed.exportedAt === 'string' && !Number.isNaN(Date.parse(parsed.exportedAt)));
  // input not mutated
  assert.ok(m.photo instanceof Blob);
});

test('measurementToJson: no photo, no order, stray blobs and typed arrays are JSON-safe', () => {
  const m = makeMeasurement({ withPhoto: false });
  delete m.photoWidth; delete m.photoHeight;
  m.result.extraBlob = new Blob(['x']);
  m.result.typed = new Float32Array([1.5, 2.5]);
  const parsed = JSON.parse(measurementToJson(m, null));
  assert.equal(parsed.photo, null);
  assert.equal(parsed.order, null);
  assert.equal(parsed.result.extraBlob, null);
  assert.deepEqual(parsed.result.typed, [1.5, 2.5]);
  assert.equal(parsed.effectiveParts.length, 3);
});

// ---------------------------------------------------------------------------------------------
// image.js (pure parts) and share.js (importable, helpers)

test('hitTest: point in polygon by cornersPx, smallest part wins, -1 outside', () => {
  const result = makeMeasurement().result;
  assert.equal(hitTest(result, 300, 200), 0);
  assert.equal(hitTest(result, 700, 150), 1);
  assert.equal(hitTest(result, 350, 550), 2);
  assert.equal(hitTest(result, 5, 5), -1);
  assert.equal(hitTest(result, NaN, 5), -1);
  assert.equal(hitTest(null, 1, 1), -1);
  // nested: small part inside a big one is picked
  const nested = { parts: [
    { index: 0, areaMm2: 1e6, cornersPx: rect(0, 0, 1000, 1000) },
    { index: 1, areaMm2: 100, polygonPx: rect(400, 400, 50, 50) },
  ] };
  assert.equal(hitTest(nested, 420, 420), 1);
  assert.equal(hitTest(nested, 100, 100), 0);
  assert.equal(typeof renderOverlay, 'function');
  assert.equal(STATUS_COLORS.ok, '#3ddc84');
  assert.equal(STATUS_COLORS.extra, '#ffb020');
  assert.equal(STATUS_COLORS.ambiguous, '#ff4d4f');
  assert.equal(hexToRgba('#3ddc84', 0.18), 'rgba(61,220,132,0.18)');
});

test('share.js is importable without a DOM and sanitises file names', () => {
  assert.equal(typeof saveOrShare, 'function');
  assert.equal(sanitizeFileName('sverka-Заказ №12/3:x?.csv'), 'sverka-Заказ №12_3_x_.csv');
  assert.equal(sanitizeFileName('  '), 'file');
  assert.equal(sanitizeFileName(null, 'x'), 'x');
  assert.equal(sanitizeFileName('a\u0000b.json'), 'a_b.json');
  const long = 'x'.repeat(200) + '.json';
  const s = sanitizeFileName(long);
  assert.ok(s.length <= 120 && s.endsWith('.json'));
});

// ---------------------------------------------------------------------------------------------
// db.js: importable in Node (no IndexedDB), pure helpers work

test('db.js is importable in Node and exposes the Db API', async () => {
  for (const name of ['openDb', 'uid', 'closeDb', 'deleteDatabase', 'serializeBlobs', 'restoreBlobs', 'blobToDataUrl', 'dataUrlToBlob', 'formatRemnantId', 'parseRemnantId']) {
    assert.equal(typeof db[name], 'function', name);
  }
  assert.equal(db.DB_NAME, 'sda-measure');
  assert.equal(db.DB_VERSION, 1);
  // openDb must reject (not throw synchronously) when IndexedDB is absent, and stay retryable
  const p = db.openDb();
  assert.ok(p instanceof Promise);
  await assert.rejects(p, (e) => e instanceof Error && e.code === 'DB' && /IndexedDB/.test(e.message));
  await assert.rejects(db.openDb(), (e) => e.code === 'DB');
});

test('uid() is unique and string; remnant ids are zero-padded and grow', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(db.uid());
  assert.equal(ids.size, 2000);
  assert.ok([...ids].every((s) => typeof s === 'string' && s.length >= 8));
  assert.equal(db.formatRemnantId(1), 'R-001');
  assert.equal(db.formatRemnantId(19), 'R-019');
  assert.equal(db.formatRemnantId(999), 'R-999');
  assert.equal(db.formatRemnantId(1000), 'R-1000');
  assert.equal(db.parseRemnantId('R-019'), 19);
  assert.equal(db.parseRemnantId('r-7'), 7);
  assert.equal(db.parseRemnantId('foo'), null);
  assert.equal(db.parseRemnantId(null), null);
});

test('blob serialisation round-trips through data URLs (export/import format)', async () => {
  const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const remnantPhoto = new Blob(['hello'], { type: 'text/plain' });
  const payload = {
    version: 1,
    measurements: [{ id: 'm1', photo: blob, result: { parts: [{ cornersPx: [[1, 2], [3, 4]] }] } }],
    remnants: [{ id: 'R-001', photo: remnantPhoto, polygonMm: null }],
    orders: [],
  };
  const ser = await db.serializeBlobs(payload);
  assert.notEqual(ser, payload);
  const ph = ser.measurements[0].photo;
  assert.equal(ph.__blob, true);
  assert.equal(ph.type, 'image/jpeg');
  assert.equal(ph.dataUrl, 'data:image/jpeg;base64,AAECA/r7/P3+/w==');
  assert.equal(ser.remnants[0].photo.dataUrl, 'data:text/plain;base64,aGVsbG8=');
  assert.deepEqual(ser.measurements[0].result.parts[0].cornersPx, [[1, 2], [3, 4]]);
  assert.equal(ser.remnants[0].polygonMm, null);
  // JSON-safe
  const text = JSON.stringify(ser);
  const back = db.restoreBlobs(JSON.parse(text));
  assert.ok(back.measurements[0].photo instanceof Blob);
  assert.equal(back.measurements[0].photo.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await back.measurements[0].photo.arrayBuffer()), bytes);
  assert.equal(await back.remnants[0].photo.text(), 'hello');
  assert.equal(back.remnants[0].polygonMm, null);
  // input untouched
  assert.ok(payload.measurements[0].photo instanceof Blob);
});

test('dataUrlToBlob handles base64 and percent-encoded payloads, rejects garbage', async () => {
  const b = db.dataUrlToBlob('data:text/plain,hello%20world');
  assert.equal(b.type, 'text/plain');
  assert.equal(await b.text(), 'hello world');
  const c = db.dataUrlToBlob('data:;base64,aGk=', 'application/octet-stream');
  assert.equal(c.type, 'application/octet-stream');
  assert.equal(await c.text(), 'hi');
  assert.throws(() => db.dataUrlToBlob('nope'), (e) => e.code === 'BAD_INPUT');
  const url = await db.blobToDataUrl(new Blob([Uint8Array.from([1, 2, 3])]));
  assert.equal(url, 'data:application/octet-stream;base64,AQID');
});
