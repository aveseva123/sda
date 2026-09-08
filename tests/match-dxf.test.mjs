import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { parseDxf, mtextToPlain, textToPlain } from '../src/match/dxf.js';
import { extractParts, entitiesToPolylines, buildLoops, normalizeParts } from '../src/match/parts.js';
import { parseCsv, rowsToParts, detectDelimiter, parseNumber } from '../src/match/csv.js';
import { parseXlsx } from '../src/match/xlsx.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const TOL = 0.05;
function assertDims(part, L, W, msg = part.id) {
  assert.ok(Math.abs(part.lengthMm - L) <= TOL, `${msg}: length ${part.lengthMm} != ${L}`);
  assert.ok(Math.abs(part.widthMm - W) <= TOL, `${msg}: width ${part.widthMm} != ${W}`);
}
function byId(parts, id) {
  const p = parts.find((x) => x.id === id);
  assert.ok(p, `part ${id} not found in [${parts.map((x) => x.id).join(', ')}]`);
  return p;
}
const hasCyrillic = (s) => /[А-Яа-яЁё]/.test(s);

// ---------- inline DXF builder ----------

function pairsToDxf(pairs, { crlf = false } = {}) {
  const nl = crlf ? '\r\n' : '\n';
  return pairs.map(([c, v]) => `${String(c).padStart(3, ' ')}${nl}${v}`).join(nl) + nl;
}
function section(name, body) { return [[0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC']]; }
function dxfDoc({ header = [], blocks = {}, entities = [], crlf = false } = {}) {
  const pairs = [];
  if (header.length) pairs.push(...section('HEADER', header));
  const blockPairs = [];
  for (const [name, ents] of Object.entries(blocks)) {
    blockPairs.push([0, 'BLOCK'], [8, '0'], [2, name], [70, '0'], [10, '0.0'], [20, '0.0'], [30, '0.0'], [3, name], ...ents.flat(), [0, 'ENDBLK'], [8, '0']);
  }
  pairs.push(...section('BLOCKS', blockPairs));
  pairs.push(...section('ENTITIES', entities.flat()));
  pairs.push([0, 'EOF']);
  return pairsToDxf(pairs, { crlf });
}
const insUnits = (u) => [[9, '$INSUNITS'], [70, String(u)]];
function lw(pts, { closed = true, layer = '0', bulges = {} } = {}) {
  const out = [[0, 'LWPOLYLINE'], [8, layer], [90, String(pts.length)], [70, closed ? '1' : '0']];
  pts.forEach(([x, y], i) => { out.push([10, String(x)], [20, String(y)]); if (bulges[i]) out.push([42, String(bulges[i])]); });
  return out;
}
const line = (x1, y1, x2, y2, layer = '0') => [[0, 'LINE'], [8, layer], [10, String(x1)], [20, String(y1)], [11, String(x2)], [21, String(y2)]];
const circle = (cx, cy, r) => [[0, 'CIRCLE'], [8, '0'], [10, String(cx)], [20, String(cy)], [40, String(r)]];
const arc = (cx, cy, r, a1, a2) => [[0, 'ARC'], [8, '0'], [10, String(cx)], [20, String(cy)], [40, String(r)], [50, String(a1)], [51, String(a2)]];
const text = (s, x, y) => [[0, 'TEXT'], [8, 'LABELS'], [10, String(x)], [20, String(y)], [40, '5'], [1, s]];
const mtext = (s, x, y) => [[0, 'MTEXT'], [8, 'LABELS'], [10, String(x)], [20, String(y)], [40, '5'], [1, s]];
function insert(name, x, y, { sx = null, sy = null, rot = null } = {}) {
  const out = [[0, 'INSERT'], [8, '0'], [2, name], [10, String(x)], [20, String(y)]];
  if (sx != null) out.push([41, String(sx)]);
  if (sy != null) out.push([42, String(sy)]);
  if (rot != null) out.push([50, String(rot)]);
  return out;
}
const rect = (x, y, w, h, opts) => lw([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opts);

// ---------- DXF parser ----------

test('parseDxf: nest_polylines.dxf (CRLF) header, entities, text', () => {
  const src = readFixture('nest_polylines.dxf');
  assert.ok(src.includes('\r\n'), 'fixture must be CRLF');
  const doc = parseDxf(src);
  assert.equal(doc.header.insUnits, 4);
  assert.deepEqual(doc.header.extMin, { x: 0, y: 0 });
  assert.deepEqual(doc.header.extMax, { x: 3000, y: 1500 });
  assert.deepEqual(doc.blocks, {});
  const types = doc.entities.map((e) => e.type);
  assert.deepEqual(types, ['LWPOLYLINE', 'LWPOLYLINE', 'TEXT', 'LWPOLYLINE', 'TEXT', 'LWPOLYLINE', 'CIRCLE', 'TEXT', 'LWPOLYLINE', 'MTEXT', 'LWPOLYLINE', 'TEXT', 'LINE']);
  const sheet = doc.entities[0];
  assert.equal(sheet.layer, 'SHEET');
  assert.equal(sheet.closed, true);
  assert.equal(sheet.vertices.length, 4);
  assert.deepEqual(sheet.vertices[2], { x: 3000, y: 1500, bulge: 0 });
  const t1 = doc.entities[2];
  assert.equal(t1.text, 'BRACKET-1', 'value must be trimmed');
  assert.deepEqual(t1.position, { x: 200, y: 200 });
  assert.equal(t1.height, 12);
  const mt = doc.entities[9];
  assert.equal(mt.type, 'MTEXT');
  assert.equal(mtextToPlain(mt.text), 'PLATE-A');
  const bulged = doc.entities[10];
  assert.equal(bulged.vertices.length, 5);
  assert.ok(Math.abs(bulged.vertices[1].bulge - Math.tan(Math.PI / 8)) < 1e-6);
  const c = doc.entities[6];
  assert.deepEqual(c, { type: 'CIRCLE', layer: 'HOLES', center: { x: 350, y: 560 }, radius: 10 });
  const l = doc.entities[12];
  assert.deepEqual(l, { type: 'LINE', layer: 'NOTES', start: { x: 2500, y: 200 }, end: { x: 2600, y: 300 } });
});

test('parseDxf: blocks section, INSERT attributes, POLYLINE/VERTEX, missing HEADER, BOM', () => {
  const doc = parseDxf(readFixture('nest_blocks.dxf'));
  assert.deepEqual(Object.keys(doc.blocks).sort(), ['*Model_Space', '*Paper_Space', 'PART_A', 'PART_B', 'PART_C']);
  assert.equal(doc.blocks.PART_B.length, 4);
  assert.ok(doc.blocks.PART_B.every((e) => e.type === 'LINE'));
  assert.deepEqual(doc.blocks.PART_C.map((e) => e.type), ['LWPOLYLINE', 'CIRCLE']);
  const inserts = doc.entities.filter((e) => e.type === 'INSERT');
  assert.equal(inserts.length, 6);
  assert.deepEqual(inserts[2], { type: 'INSERT', layer: 'PARTS', name: 'PART_A', position: { x: 1400, y: 100 }, scale: { x: 1, y: 1 }, rotationDeg: 90, columns: 1, rows: 1, columnSpacing: 0, rowSpacing: 0 });
  assert.deepEqual(inserts[3].scale, { x: 1, y: 1 });

  const pv = parseDxf('﻿' + readFixture('polyline_vertex.dxf'));
  assert.equal(pv.header.insUnits, null);
  assert.equal(pv.entities.length, 1);
  assert.equal(pv.entities[0].type, 'POLYLINE');
  assert.equal(pv.entities[0].closed, true);
  assert.deepEqual(pv.entities[0].vertices.map((v) => [v.x, v.y]), [[0, 0], [250, 0], [250, 100], [0, 100]]);

  const inch = parseDxf(readFixture('lines_inches.dxf'));
  assert.equal(inch.header.insUnits, 1);
  assert.equal(inch.entities.length, 8);
});

test('parseDxf: tolerant to garbage lines, unknown entities and padded codes', () => {
  const src = '  0\nSECTION\n  2\nENTITIES\n  0\nHATCH\n  8\n0\n  0\nLINE\n   8   \n  A \n 10\n1,5\n 20\n2\n 11\n3\n 21\n4\nJUNK LINE\n  0\nEOF\n';
  const doc = parseDxf(src);
  assert.equal(doc.entities.length, 1);
  assert.deepEqual(doc.entities[0], { type: 'LINE', layer: 'A', start: { x: 1.5, y: 2 }, end: { x: 3, y: 4 } });
  assert.deepEqual(parseDxf('').entities, []);
  assert.deepEqual(parseDxf('').header, { insUnits: null, extMin: null, extMax: null });
});

test('text helpers: MTEXT formatting codes and TEXT special codes are stripped', () => {
  assert.equal(mtextToPlain('\\A1;{\\fArial|b0|i0|c204|p34;PLATE-A}'), 'PLATE-A');
  assert.equal(mtextToPlain('\\pxqc;{\\H1.5x;SHELF}\\P04'), 'SHELF 04');
  assert.equal(mtextToPlain('{\\fISOCPEUR|b0|i1;\\C1;Деталь %%c20}'), 'Деталь Ø20');
  assert.equal(mtextToPlain('A\\{B\\}\\\\C'), 'A{B}\\C');
  assert.equal(textToPlain('  BRACKET-1  '), 'BRACKET-1');
  assert.equal(textToPlain('%%uSHELF%%d'), 'SHELF°');
});

// ---------- extractParts on fixtures ----------

test('extractParts: nest_polylines.dxf -> loops strategy, sheet, labels, bulge part', () => {
  const r = extractParts(parseDxf(readFixture('nest_polylines.dxf')));
  assert.equal(r.strategy, 'loops');
  assert.equal(r.unitsUsed, 'mm');
  assert.ok(r.sheet);
  assert.ok(Math.abs(r.sheet.lengthMm - 3000) <= TOL && Math.abs(r.sheet.widthMm - 1500) <= TOL, JSON.stringify(r.sheet));
  assert.deepEqual(r.parts.map((p) => p.id), ['BRACKET-1', 'SHELF-04', 'PLATE-A', 'P-01']);
  const br = byId(r.parts, 'BRACKET-1');
  assertDims(br, 380, 240); assert.equal(br.qty, 2);
  const sh = byId(r.parts, 'SHELF-04');
  assertDims(sh, 500, 120.5); assert.equal(sh.qty, 1);
  const pl = byId(r.parts, 'PLATE-A');
  assertDims(pl, 100, 100); assert.equal(pl.qty, 1);
  const rounded = byId(r.parts, 'P-01');
  assertDims(rounded, 300, 200); assert.equal(rounded.qty, 1);
  assert.ok(rounded.polygonMm.length > 6, 'bulge corner must be sampled');
  const cut = 50 * 50 - Math.PI * 50 * 50 / 4;
  assert.ok(Math.abs(rounded.areaMm2 - (60000 - cut)) < 40, `area ${rounded.areaMm2}`);
  for (const p of r.parts) {
    assert.equal(p.source, 'loop');
    assert.ok(Array.isArray(p.polygonMm) && p.polygonMm.length >= 4);
    assert.ok(p.polygonMm.every(([x, y]) => x >= -1e-9 && y >= -1e-9), 'polygon normalised to origin');
    assert.ok(p.lengthMm >= p.widthMm);
  }
  assert.equal(br.rectangular, true);
  assert.equal(sh.rectangular, true);
  assert.ok(Math.abs(br.areaMm2 - 380 * 240) < 1e-6);
  assert.ok(r.warnings.some((w) => /незамкнут/i.test(w)), 'stray LINE should be reported');
  assert.ok(r.warnings.every(hasCyrillic));
});

test('extractParts: nest_blocks.dxf -> blocks strategy, qty per block, rotation and scale 1', () => {
  const r = extractParts(parseDxf(readFixture('nest_blocks.dxf')));
  assert.equal(r.strategy, 'blocks');
  assert.equal(r.unitsUsed, 'mm');
  assert.deepEqual(r.parts.map((p) => p.id), ['PART_A', 'PART_B', 'PART_C']);
  const a = byId(r.parts, 'PART_A'); assertDims(a, 420, 260); assert.equal(a.qty, 3);
  const b = byId(r.parts, 'PART_B'); assertDims(b, 200, 150); assert.equal(b.qty, 2);
  const c = byId(r.parts, 'PART_C'); assertDims(c, 150, 150); assert.equal(c.qty, 1);
  assert.ok(Math.abs(c.areaMm2 - 22500) < 1e-6, 'hole must not reduce the outer area');
  assert.ok(r.parts.every((p) => p.source === 'block' && p.rectangular === true));
  assert.ok(r.sheet);
  assert.ok(Math.abs(r.sheet.lengthMm - 2500) <= TOL && Math.abs(r.sheet.widthMm - 1250) <= TOL);
  assert.deepEqual(r.warnings, []);
});

test('extractParts: lines_inches.dxf -> $INSUNITS 1 converts to mm; units option overrides', () => {
  const doc = parseDxf(readFixture('lines_inches.dxf'));
  const r = extractParts(doc);
  assert.equal(r.strategy, 'loops');
  assert.equal(r.unitsUsed, 'in');
  assert.equal(r.sheet, null);
  assert.deepEqual(r.parts.map((p) => p.id), ['P-01', 'P-02']);
  assertDims(r.parts[0], 254, 152.4); assert.equal(r.parts[0].qty, 1);
  assertDims(r.parts[1], 101.6, 101.6); assert.equal(r.parts[1].qty, 1);
  assert.ok(Math.abs(r.parts[0].areaMm2 - 254 * 152.4) < 1e-6);
  assert.ok(r.warnings.some((w) => /дюйм/i.test(w)));
  const mm = extractParts(doc, { units: 'mm' });
  assert.equal(mm.unitsUsed, 'mm');
  assertDims(mm.parts[0], 10, 6);
  assertDims(mm.parts[1], 4, 4);
  const asIn = extractParts(parseDxf(readFixture('polyline_vertex.dxf')), { units: 'in' });
  assert.equal(asIn.unitsUsed, 'in');
  assertDims(asIn.parts[0], 6350, 2540);
});

test('extractParts: polyline_vertex.dxf -> classic POLYLINE closed rectangle', () => {
  const r = extractParts(parseDxf(readFixture('polyline_vertex.dxf')));
  assert.equal(r.strategy, 'loops');
  assert.equal(r.unitsUsed, 'mm');
  assert.equal(r.sheet, null);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].id, 'P-01');
  assertDims(r.parts[0], 250, 100);
  assert.equal(r.parts[0].qty, 1);
  assert.equal(r.parts[0].rectangular, true);
});

// ---------- extractParts on inline documents ----------

test('extractParts: label inside, nearest within 20 mm, beyond 20 mm -> auto id; reading order', () => {
  const src = dxfDoc({
    header: insUnits(4),
    entities: [
      rect(0, 0, 100, 50), text('  INSIDE-1 ', 50, 25),
      rect(200, 0, 100, 50), text('NEAR-2', 210, 65),      // 15 mm above the bbox
      rect(400, 0, 100, 50), text('FAR-3', 410, 80),       // 30 mm above -> not associated
      rect(600, 0, 100, 50), mtext('\\A1;{\\fArial|b0;MT-4}', 650, 25),
    ],
  });
  const r = extractParts(parseDxf(src));
  assert.equal(r.strategy, 'loops');
  assert.equal(r.sheet, null);
  assert.deepEqual(r.parts.map((p) => p.id), ['INSIDE-1', 'NEAR-2', 'P-01', 'MT-4']);
  for (const p of r.parts) { assertDims(p, 100, 50); assert.equal(p.qty, 1); }
});

test('extractParts: unlabeled identical loops merge with qty, auto ids skip used names', () => {
  const src = dxfDoc({
    entities: [
      rect(0, 0, 100, 50), rect(200, 0, 50, 100), rect(400, 0, 100, 50.005),
      rect(0, 200, 80, 80), text('P-01', 40, 240),
    ],
  });
  const r = extractParts(parseDxf(src));
  assert.deepEqual(r.parts.map((p) => [p.id, p.qty]), [['P-02', 3], ['P-01', 1]]);
  assertDims(r.parts[0], 100, 50);
  assertDims(r.parts[1], 80, 80);
});

test('extractParts: sheet = largest loop containing >= 2 loops; holes ignored; sheetMode none', () => {
  const src = dxfDoc({
    entities: [
      rect(0, 0, 1000, 500, { layer: 'SHEET' }),
      rect(10, 10, 300, 200), circle(160, 110, 30), rect(50, 50, 40, 40),   // part with 2 holes
      rect(400, 10, 300, 200),
      rect(1200, 0, 100, 100),                                              // loose part outside the sheet
    ],
  });
  const r = extractParts(parseDxf(src));
  assert.ok(r.sheet);
  assert.ok(Math.abs(r.sheet.lengthMm - 1000) <= TOL && Math.abs(r.sheet.widthMm - 500) <= TOL);
  assert.deepEqual(r.parts.map((p) => [p.id, p.qty]), [['P-01', 2], ['P-02', 1]]);
  assertDims(r.parts[0], 300, 200);
  assertDims(r.parts[1], 100, 100);
  const none = extractParts(parseDxf(src), { sheetMode: 'none' });
  assert.equal(none.sheet, null);
  assert.deepEqual(none.parts.map((p) => [p.lengthMm, p.widthMm, p.qty]), [[1000, 500, 1], [100, 100, 1]]);
});

test('extractParts: drawing frame around the sheet does not hide the sheet', () => {
  const src = dxfDoc({
    entities: [
      rect(-100, -100, 1500, 800, { layer: 'FRAME' }),
      rect(0, 0, 1000, 500, { layer: 'SHEET' }),
      rect(10, 10, 300, 200), rect(400, 10, 300, 200), rect(10, 300, 120, 80),
    ],
  });
  const r = extractParts(parseDxf(src));
  assert.ok(r.sheet && Math.abs(r.sheet.lengthMm - 1000) <= TOL);
  assert.deepEqual(r.parts.map((p) => [p.lengthMm, p.widthMm, p.qty]), [[300, 200, 2], [120, 80, 1]]);
});

test('extractParts: LINE + ARC chained into a rounded rectangle; circle-only part keeps its diameter', () => {
  const src = dxfDoc({
    entities: [
      // 200 x 100 with R20 corners, segments in shuffled order and mixed directions
      arc(180, 80, 20, 0, 90), line(180, 0, 20, 0), line(200, 80, 200, 20), arc(20, 20, 20, 180, 270),
      line(20, 100, 180, 100), arc(180, 20, 20, 270, 360), line(0, 20, 0, 80), arc(20, 80, 20, 90, 180),
      circle(400, 50, 50),
      line(600, 0, 700, 0), line(700, 0, 700, 100), // dangling -> ignored
    ],
  });
  const r = extractParts(parseDxf(src));
  assert.equal(r.parts.length, 2, JSON.stringify(r.parts.map((p) => [p.lengthMm, p.widthMm])));
  assertDims(r.parts[0], 200, 100);
  const exactArea = 200 * 100 - 4 * (400 - Math.PI * 100);
  assert.ok(Math.abs(r.parts[0].areaMm2 - exactArea) < 15, `area ${r.parts[0].areaMm2}`);
  assertDims(r.parts[1], 100, 100);
  assert.equal(r.parts[1].rectangular, false);
  assert.ok(Math.abs(r.parts[1].areaMm2 - Math.PI * 2500) < 60);
  assert.ok(r.warnings.some((w) => /незамкнут/i.test(w)));
});

test('extractParts: nested INSERTs, scaled INSERT, sheet as a container block', () => {
  const blocks = {
    PANEL: [rect(0, 0, 100, 50), circle(50, 25, 5)],
    GROUP: [insert('PANEL', 0, 0), insert('PANEL', 150, 0, { rot: 90 })],
    SQ: [rect(0, 0, 100, 100)],
  };
  const r = extractParts(parseDxf(dxfDoc({
    blocks,
    entities: [insert('GROUP', 0, 0), insert('GROUP', 0, 300), insert('SQ', 500, 0, { sx: 2, sy: 2 }), insert('SQ', 800, 0)],
  })));
  assert.equal(r.strategy, 'blocks');
  assert.deepEqual(r.parts.map((p) => [p.id, p.qty]), [['PANEL', 4], ['SQ ×2', 1], ['SQ', 1]]);
  assertDims(r.parts[0], 100, 50);
  assertDims(r.parts[1], 200, 200);
  assertDims(r.parts[2], 100, 100);
  assert.ok(r.parts.every((p) => p.source === 'block'));

  // Sheet modelled as a block containing part inserts
  const r2 = extractParts(parseDxf(dxfDoc({
    blocks: {
      ...blocks,
      SHEET: [rect(0, 0, 1000, 500), insert('PANEL', 10, 10), insert('PANEL', 200, 10), insert('SQ', 400, 10)],
    },
    entities: [insert('SHEET', 0, 0)],
  })));
  assert.equal(r2.strategy, 'blocks');
  assert.ok(r2.sheet && Math.abs(r2.sheet.lengthMm - 1000) <= TOL && Math.abs(r2.sheet.widthMm - 500) <= TOL);
  assert.deepEqual(r2.parts.map((p) => [p.id, p.qty]), [['PANEL', 2], ['SQ', 1]]);

  // Missing block is reported, not fatal
  const r3 = extractParts(parseDxf(dxfDoc({ blocks: { SQ: blocks.SQ }, entities: [insert('SQ', 0, 0), insert('NOPE', 300, 0)] })));
  assert.deepEqual(r3.parts.map((p) => [p.id, p.qty]), [['SQ', 1]]);
  assert.ok(r3.warnings.some((w) => w.includes('NOPE') && hasCyrillic(w)));
});

test('extractParts: no closed geometry -> empty parts with a Russian warning', () => {
  const r = extractParts(parseDxf(dxfDoc({ entities: [line(0, 0, 100, 0), line(100, 0, 100, 50), text('X', 1, 1)] })));
  assert.deepEqual(r.parts, []);
  assert.equal(r.sheet, null);
  assert.equal(r.strategy, 'loops');
  assert.ok(r.warnings.length >= 1 && r.warnings.some((w) => /замкнут/i.test(w) && hasCyrillic(w)));
  const empty = extractParts(parseDxf(''));
  assert.deepEqual(empty.parts, []);
  assert.ok(empty.warnings.length >= 1);
});

// ---------- helpers ----------

test('entitiesToPolylines: INSERT applies scale, rotation, translation; circle sampled with arcSegments', () => {
  const blocks = { B: [{ type: 'LWPOLYLINE', layer: '0', closed: false, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }] }] };
  blocks.B.basePoint = { x: 0, y: 0 };
  const out = entitiesToPolylines([{ type: 'INSERT', layer: 'L', name: 'B', position: { x: 100, y: 50 }, scale: { x: 2, y: 2 }, rotationDeg: 90 }], blocks);
  assert.equal(out.length, 1);
  assert.equal(out[0].closed, false);
  assert.equal(out[0].layer, 'L');
  assert.ok(Math.abs(out[0].points[0][0] - 100) < 1e-9 && Math.abs(out[0].points[0][1] - 50) < 1e-9);
  assert.ok(Math.abs(out[0].points[1][0] - 100) < 1e-9 && Math.abs(out[0].points[1][1] - 70) < 1e-9);
  const c = entitiesToPolylines([{ type: 'CIRCLE', layer: '0', center: { x: 0, y: 0 }, radius: 10 }], {}, { arcSegments: 12 });
  assert.equal(c[0].points.length, 12);
  assert.equal(c[0].closed, true);
});

test('buildLoops: chains open segments by endpoints within tolerance, drops dangling ones', () => {
  const seg = (a, b) => ({ points: [a, b], closed: false, layer: '0' });
  const pl = [
    seg([0, 0], [100, 0]),
    seg([100, 50], [100, 0.03]),      // reversed and 0.03 mm off
    seg([0, 50], [100, 50]),
    seg([0, 0.02], [0, 50]),
    seg([300, 0], [400, 0]),          // dangling
    { points: [[200, 0], [250, 0], [250, 30]], closed: true, layer: 'X' },
  ];
  const loops = buildLoops(pl, 0.05);
  assert.equal(loops.length, 2);
  assert.equal(loops[0].points.length, 4);
  assert.equal(loops[1].layer, 'X');
  assert.equal(loops.droppedSegments, 1);
  assert.equal(buildLoops(pl, 0.001).length, 1, 'tight tolerance breaks the chain');
});

test('normalizeParts: merges by id, merges unlabeled by dims, length >= width, auto ids', () => {
  const parts = normalizeParts([
    { id: 'A', lengthMm: 100, widthMm: 200, qty: 2 },
    { id: 'A', lengthMm: 200, widthMm: 100, qty: 3, source: 'list' },
    { id: '', lengthMm: 50, widthMm: 30 },
    { id: null, lengthMm: 30.005, widthMm: 50.005, qty: 4 },
    { id: 'B', lengthMm: 10, widthMm: 10, qty: 0 },
    { id: ' ', lengthMm: 50, widthMm: 30.5 },
  ]);
  assert.deepEqual(parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['A', 200, 100, 5], ['P-01', 50, 30, 5], ['B', 10, 10, 1], ['P-02', 50, 30.5, 1]]);
  assert.equal(parts[0].source, 'list');
  assert.equal(parts[1].polygonMm, null);
  assert.equal(parts[1].areaMm2, 1500);
  assert.equal(parts[1].rectangular, true);
});

// ---------- CSV ----------

test('parseCsv: parts_ru.csv (BOM, ;, decimal comma, quoted delimiter)', () => {
  const src = readFixture('parts_ru.csv');
  assert.equal(src.charCodeAt(0), 0xFEFF);
  assert.equal(detectDelimiter(src), ';');
  const rows = parseCsv(src);
  assert.deepEqual(rows[0], ['Деталь', 'Длина', 'Ширина', 'Кол-во']);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[1], ['Полка-1', '500', '120,5', '2']);
  assert.deepEqual(rows[3], ['Уголок; малый', '150', '50,25', '3']);
  assert.deepEqual(rows[5], ['Планка', '60', '200', '1']);
});

test('parseCsv: parts_en.csv (comma) and tab / quotes / CRLF edge cases', () => {
  const rows = parseCsv(readFixture('parts_en.csv'));
  assert.deepEqual(rows[0], ['id', 'length', 'width', 'qty']);
  assert.equal(rows.length, 5, 'trailing empty line dropped');
  assert.deepEqual(rows[4], ['BRACKET-1', '380', '240', '1']);
  const tsv = parseCsv('a\tb\tc\r\n1\t"x ""y"" z"\t"multi\nline"\r\n\r\n');
  assert.deepEqual(tsv, [['a', 'b', 'c'], ['1', 'x "y" z', 'multi\nline']]);
  assert.deepEqual(parseCsv('"A,B",1\n"C",2'), [['A,B', '1'], ['C', '2']]);
  assert.deepEqual(parseCsv(''), []);
  assert.equal(parseNumber('1 200,5 мм'), 1200.5);
  assert.equal(parseNumber('120.5'), 120.5);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('rowsToParts: Russian header with decimal comma', () => {
  const { parts, warnings } = rowsToParts(parseCsv(readFixture('parts_ru.csv')));
  assert.deepEqual(parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [
    ['Полка-1', 500, 120.5, 2], ['Кронштейн', 380, 240, 4], ['Уголок; малый', 150, 50.25, 3], ['Пластина', 100, 100, 1], ['Планка', 200, 60, 1],
  ]);
  assert.ok(parts.every((p) => p.source === 'list' && p.polygonMm === null && p.rectangular === true));
  assert.equal(parts[0].areaMm2, 500 * 120.5);
  assert.deepEqual(warnings, []);
});

test('rowsToParts: English header, duplicate ids merged; headerless and bad rows', () => {
  const { parts } = rowsToParts(parseCsv(readFixture('parts_en.csv')));
  assert.deepEqual(parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['SHELF-04', 500, 120.5, 1], ['BRACKET-1', 380, 240, 3], ['PLATE-A', 100, 100, 1]]);
  const alt = rowsToParts([['Артикул', 'A, мм', 'B, мм', 'N'], ['X-1', '10', '20', '2'], ['X-2', 'oops', '20', '1'], ['X-3', '30x40', '', '']]);
  assert.deepEqual(alt.parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['X-1', 20, 10, 2], ['X-3', 40, 30, 1]]);
  assert.ok(alt.warnings.some(hasCyrillic));
  const numbered = rowsToParts([['№', 'Наименование', 'Длина', 'Ширина', 'Кол-во, шт'], ['1', 'Полка', '300', '200', '2']]);
  assert.deepEqual(numbered.parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['Полка', 300, 200, 2]]);
  const weakId = rowsToParts([['№', 'Длина', 'Ширина'], ['7', '300', '200']]);
  assert.deepEqual(weakId.parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['7', 300, 200, 1]]);
  const noHeader = rowsToParts([['100', '50', '3'], ['70', '70']]);
  assert.deepEqual(noHeader.parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['P-01', 100, 50, 3], ['P-02', 70, 70, 1]]);
  const noHeaderIds = rowsToParts([['K-1', '100', '50', '3']]);
  assert.deepEqual(noHeaderIds.parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [['K-1', 100, 50, 3]]);
  const empty = rowsToParts([]);
  assert.deepEqual(empty.parts, []);
  assert.ok(empty.warnings.length && hasCyrillic(empty.warnings[0]));
});

// ---------- XLSX (tiny zip writer) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// files: [{ name, data:string|Uint8Array, method:0|8|number }]
function writeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  for (const f of files) {
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const method = f.method ?? 8;
    const stored = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = crc32(raw);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(stored.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...name,
    ]);
    parts.push(local, stored);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(stored.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]));
    offset += local.length + stored.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...parts, ...central, eocd]) { out.set(c, p); p += c.length; }
  return out.buffer;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Детали" sheetId="1" r:id="rId7"/><sheet name="Другой" sheetId="2" r:id="rId8"/></sheets></workbook>`;
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet7.xml"/>'
  + '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst ${NS} count="6" uniqueCount="6"><si><t>Деталь</t></si><si><t>Длина, мм</t></si>`
  + '<si><r><rPr><b/></rPr><t>Шир</t></r><r><t>ина</t></r></si><si><t xml:space="preserve">Кол-во </t></si><si><t>SHELF-04</t></si><si><t>Уголок &amp; планка</t></si></sst>';
const SHEET7 = `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}><sheetData>`
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>500</v></c><c r="C2" s="1"><v>120.5</v></c><c r="D2"><v>1</v></c></row>'
  + '<row r="3"><c r="A3" t="inlineStr"><is><t>BRACKET-1</t></is></c><c r="B3"><v>380</v></c><c r="C3"><v>240</v></c><c r="D3"><f>1+1</f><v>2</v></c></row>'
  + '<row r="5"><c r="A5" t="s"><v>5</v></c><c r="C5"><v>60</v></c><c r="B5"><v>200</v></c><c r="D5" t="str"><v>3</v></c><c r="E5" t="b"><v>1</v></c></row>'
  + '<row r="6"><c r="A6" t="inlineStr"><is><r><t>PL</t></r><r><t>ATE-A</t></r></is></c><c r="B6"><v>100</v></c><c r="C6"><v>100</v></c><c r="D6"/></row>'
  + '<row r="7"><c r="A7" s="2"/></row></sheetData></worksheet>';
const SHEET1 = `<?xml version="1.0" encoding="UTF-8"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WRONG SHEET</t></is></c></row></sheetData></worksheet>`;

function buildXlsx({ sheetMethod = 0, otherMethod = 8 } = {}) {
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES, method: otherMethod },
    { name: 'xl/workbook.xml', data: WORKBOOK, method: otherMethod },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS, method: otherMethod },
    { name: 'xl/sharedStrings.xml', data: SHARED, method: otherMethod },
    { name: 'xl/worksheets/sheet7.xml', data: SHEET7, method: sheetMethod },
    { name: 'xl/worksheets/sheet1.xml', data: SHEET1, method: otherMethod },
  ]);
}

const EXPECTED_ROWS = [
  ['Деталь', 'Длина, мм', 'Ширина', 'Кол-во '],   // xml:space="preserve" keeps the trailing space
  ['SHELF-04', '500', '120.5', '1'],
  ['BRACKET-1', '380', '240', '2'],
  [],
  ['Уголок & планка', '200', '60', '3', 'TRUE'],
  ['PLATE-A', '100', '100', ''],
];

test('parseXlsx: stored sheet + deflated parts, shared/inline strings, numbers, formulas, gaps', async () => {
  const rows = await parseXlsx(buildXlsx({ sheetMethod: 0, otherMethod: 8 }));
  assert.deepEqual(rows, EXPECTED_ROWS);
  const rows2 = await parseXlsx(new Uint8Array(buildXlsx({ sheetMethod: 8, otherMethod: 0 })));
  assert.deepEqual(rows2, EXPECTED_ROWS);
  const { parts, warnings } = rowsToParts(rows);
  assert.deepEqual(parts.map((p) => [p.id, p.lengthMm, p.widthMm, p.qty]), [
    ['SHELF-04', 500, 120.5, 1], ['BRACKET-1', 380, 240, 2], ['Уголок & планка', 200, 60, 3], ['PLATE-A', 100, 100, 1],
  ]);
  assert.deepEqual(warnings, []);
});

test('parseXlsx: bad input and unsupported compression -> BAD_INPUT with Russian message', async () => {
  for (const input of [new Uint8Array([1, 2, 3]).buffer, new TextEncoder().encode('id,length,width\nA,1,2\n').buffer, new ArrayBuffer(0)]) {
    await assert.rejects(parseXlsx(input), (e) => e.code === 'BAD_INPUT' && hasCyrillic(e.message));
  }
  await assert.rejects(parseXlsx(buildXlsx({ sheetMethod: 12 })), (e) => e.code === 'BAD_INPUT' && hasCyrillic(e.message));
  const corrupted = new Uint8Array(buildXlsx({ sheetMethod: 8 }));
  const marker = new TextEncoder().encode('xl/worksheets/sheet7.xml');
  const idx = corrupted.findIndex((_, i) => marker.every((b, j) => corrupted[i + j] === b));
  for (let i = 0; i < 40; i++) corrupted[idx + marker.length + i] ^= 0x5A;
  await assert.rejects(parseXlsx(corrupted), (e) => e.code === 'BAD_INPUT' && hasCyrillic(e.message));
  const noSheets = writeZip([{ name: '[Content_Types].xml', data: CONTENT_TYPES }, { name: 'xl/workbook.xml', data: `<workbook ${NS}><sheets/></workbook>` }]);
  await assert.rejects(parseXlsx(noSheets), (e) => e.code === 'BAD_INPUT' && hasCyrillic(e.message));
});
