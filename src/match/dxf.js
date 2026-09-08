// Minimal tolerant ASCII DXF parser (group-code / value pairs). Pure JS: no DOM, no OpenCV.
// Produces plain entity objects as described in docs/SPEC.md §6.1. Unknown entities are skipped,
// CRLF / padded codes / missing HEADER are tolerated. Only X/Y are kept (Z is ignored).

const ENTITY_TYPES = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'INSERT', 'TEXT', 'MTEXT', 'ATTRIB',
]);

function badInput(message) {
  return Object.assign(new Error(message), { code: 'BAD_INPUT' });
}

function num(v, fallback = 0) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = 0) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

// Split text into [code, value] pairs. Lines that cannot be parsed as a group code are skipped
// so that a slightly corrupted file still yields the readable part.
export function tokenizeDxf(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('AutoCAD Binary DXF')) throw badInput('Бинарный DXF не поддерживается — сохраните файл как ASCII DXF');
  const lines = s.split(/\r\n|\r|\n/);
  const pairs = [];
  let i = 0;
  while (i + 1 < lines.length) {
    const codeStr = lines[i].trim();
    if (codeStr === '' || !/^-?\d+$/.test(codeStr)) { i++; continue; }
    pairs.push([parseInt(codeStr, 10), lines[i + 1].trim()]);
    i += 2;
  }
  return pairs;
}

// ---------- special character handling for TEXT / MTEXT ----------

function decodeSpecialCodes(s) {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[uUoO]/g, '')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (m, d) => String.fromCharCode(parseInt(d, 10)));
}

// Plain text of a TEXT entity (removes %%d-style control codes).
export function textToPlain(raw) {
  return decodeSpecialCodes(String(raw ?? '')).trim();
}

// Plain text of an MTEXT entity: strips inline formatting codes (\P, {\fArial;...}, \A1; \H2.5x; ...).
export function mtextToPlain(raw) {
  let s = String(raw ?? '');
  // protect escaped literals before stripping codes
  s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  s = s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+[0-9A-Fa-f]{5}/g, '')
    .replace(/\\[fF][^;]*;/g, '')
    .replace(/\\S([^;]*);/g, (m, g) => g.replace(/[\^#]/g, '/'))
    .replace(/\\[HWQCTAcpX][^;]*;/g, '')
    .replace(/\\P/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  return decodeSpecialCodes(s).replace(/\s+/g, ' ').trim();
}

// ---------- entity builders ----------

function buildLine(g) {
  const e = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
  for (const [c, v] of g) {
    if (c === 10) e.start.x = num(v); else if (c === 20) e.start.y = num(v);
    else if (c === 11) e.end.x = num(v); else if (c === 21) e.end.y = num(v);
  }
  return e;
}

function buildLwPolyline(g) {
  const vertices = [];
  let flags = 0;
  for (const [c, v] of g) {
    if (c === 10) vertices.push({ x: num(v), y: 0, bulge: 0 });
    else if (c === 20) { if (vertices.length) vertices[vertices.length - 1].y = num(v); }
    else if (c === 42) { if (vertices.length) vertices[vertices.length - 1].bulge = num(v); }
    else if (c === 70) flags = int(v);
  }
  return { closed: (flags & 1) === 1, vertices };
}

function buildVertex(g) {
  const v = { x: 0, y: 0, bulge: 0, flags: 0 };
  for (const [c, val] of g) {
    if (c === 10) v.x = num(val); else if (c === 20) v.y = num(val);
    else if (c === 42) v.bulge = num(val); else if (c === 70) v.flags = int(val);
  }
  return v;
}

function buildCircle(g) {
  const e = { center: { x: 0, y: 0 }, radius: 0 };
  for (const [c, v] of g) {
    if (c === 10) e.center.x = num(v); else if (c === 20) e.center.y = num(v); else if (c === 40) e.radius = num(v);
  }
  return e;
}

function buildArc(g) {
  const e = { center: { x: 0, y: 0 }, radius: 0, startAngleDeg: 0, endAngleDeg: 360 };
  for (const [c, v] of g) {
    if (c === 10) e.center.x = num(v); else if (c === 20) e.center.y = num(v);
    else if (c === 40) e.radius = num(v); else if (c === 50) e.startAngleDeg = num(v); else if (c === 51) e.endAngleDeg = num(v);
  }
  return e;
}

function buildEllipse(g) {
  const e = { center: { x: 0, y: 0 }, majorAxis: { x: 1, y: 0 }, ratio: 1, startParam: 0, endParam: Math.PI * 2 };
  for (const [c, v] of g) {
    if (c === 10) e.center.x = num(v); else if (c === 20) e.center.y = num(v);
    else if (c === 11) e.majorAxis.x = num(v); else if (c === 21) e.majorAxis.y = num(v);
    else if (c === 40) e.ratio = num(v, 1); else if (c === 41) e.startParam = num(v); else if (c === 42) e.endParam = num(v, Math.PI * 2);
  }
  return e;
}

function buildSpline(g) {
  const e = { closed: false, degree: 3, knots: [], controlPoints: [], fitPoints: [], weights: [] };
  let flags = 0;
  for (const [c, v] of g) {
    if (c === 70) flags = int(v);
    else if (c === 71) e.degree = int(v, 3);
    else if (c === 40) e.knots.push(num(v));
    else if (c === 41) e.weights.push(num(v, 1));
    else if (c === 10) e.controlPoints.push({ x: num(v), y: 0 });
    else if (c === 20) { if (e.controlPoints.length) e.controlPoints[e.controlPoints.length - 1].y = num(v); }
    else if (c === 11) e.fitPoints.push({ x: num(v), y: 0 });
    else if (c === 21) { if (e.fitPoints.length) e.fitPoints[e.fitPoints.length - 1].y = num(v); }
  }
  e.closed = (flags & 1) === 1;
  return e;
}

function buildInsert(g) {
  const e = { name: '', position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotationDeg: 0, columns: 1, rows: 1, columnSpacing: 0, rowSpacing: 0 };
  for (const [c, v] of g) {
    if (c === 2) e.name = v;
    else if (c === 10) e.position.x = num(v); else if (c === 20) e.position.y = num(v);
    else if (c === 41) e.scale.x = num(v, 1); else if (c === 42) e.scale.y = num(v, 1);
    else if (c === 50) e.rotationDeg = num(v);
    else if (c === 70) e.columns = Math.max(1, int(v, 1)); else if (c === 71) e.rows = Math.max(1, int(v, 1));
    else if (c === 44) e.columnSpacing = num(v); else if (c === 45) e.rowSpacing = num(v);
  }
  return e;
}

function buildText(g) {
  const e = { text: '', position: { x: 0, y: 0 }, height: 0, rotationDeg: 0 };
  let p2 = null; let hAlign = 0; let vAlign = 0;
  for (const [c, v] of g) {
    if (c === 1) e.text = v;
    else if (c === 10) e.position.x = num(v); else if (c === 20) e.position.y = num(v);
    else if (c === 11) { p2 = p2 || { x: 0, y: 0 }; p2.x = num(v); } else if (c === 21) { p2 = p2 || { x: 0, y: 0 }; p2.y = num(v); }
    else if (c === 40) e.height = num(v); else if (c === 50) e.rotationDeg = num(v);
    else if (c === 72) hAlign = int(v); else if (c === 73) vAlign = int(v);
  }
  // For non-default justification the second alignment point is the anchor actually used
  // (except 'aligned' (3) and 'fit' (5), where both points are the baseline ends).
  if (p2 && (hAlign !== 0 || vAlign !== 0) && !(hAlign === 3 || hAlign === 5)) e.position = p2;
  return e;
}

function buildMtext(g) {
  const e = { text: '', position: { x: 0, y: 0 }, height: 0 };
  let chunks = '';
  let last = '';
  for (const [c, v] of g) {
    if (c === 3) chunks += v;
    else if (c === 1) last = v;
    else if (c === 10) e.position.x = num(v); else if (c === 20) e.position.y = num(v);
    else if (c === 40) e.height = num(v);
  }
  e.text = chunks + last;
  return e;
}

function layerOf(groups) {
  for (const [c, v] of groups) if (c === 8) return v;
  return '0';
}

function makeEntity(type, groups) {
  let e;
  switch (type) {
    case 'LINE': e = buildLine(groups); break;
    case 'LWPOLYLINE': e = buildLwPolyline(groups); break;
    case 'CIRCLE': e = buildCircle(groups); break;
    case 'ARC': e = buildArc(groups); break;
    case 'ELLIPSE': e = buildEllipse(groups); break;
    case 'SPLINE': e = buildSpline(groups); break;
    case 'INSERT': e = buildInsert(groups); break;
    case 'TEXT': case 'ATTRIB': e = buildText(groups); type = 'TEXT'; break;
    case 'MTEXT': e = buildMtext(groups); break;
    default: return null;
  }
  return { type, layer: layerOf(groups), ...e };
}

// Collect group pairs starting at index i (which must be the pair after a 0/<TYPE>) until the next code 0.
function collectGroups(pairs, i) {
  const groups = [];
  while (i < pairs.length && pairs[i][0] !== 0) { groups.push(pairs[i]); i++; }
  return { groups, next: i };
}

const ENTITY_TERMINATORS = new Set(['ENDSEC', 'ENDBLK', 'EOF', 'SECTION', 'BLOCK']);

// Parse entities starting at pairs[i] (a 0/<TYPE> pair) until a terminator (ENDSEC / ENDBLK / EOF / ...).
// Returns the index of the terminator pair (not consumed).
function parseEntities(pairs, i, out) {
  const n = pairs.length;
  while (i < n) {
    const [code, value] = pairs[i];
    if (code !== 0) { i++; continue; }
    const type = value.toUpperCase();
    if (ENTITY_TERMINATORS.has(type)) return i;
    const { groups, next } = collectGroups(pairs, i + 1);
    i = next;
    if (type === 'POLYLINE') {
      const head = buildLwPolyline(groups); // closed flag via code 70; vertices come from VERTEX children
      const vertices = [];
      while (i < n && pairs[i][0] === 0) {
        const t = pairs[i][1].toUpperCase();
        if (t === 'VERTEX') {
          const r = collectGroups(pairs, i + 1);
          const v = buildVertex(r.groups);
          // skip polyface-mesh faces (128) and spline-frame control points (16) — keep drawn vertices
          if ((v.flags & 128) === 0 && (v.flags & 16) === 0) vertices.push({ x: v.x, y: v.y, bulge: v.bulge });
          i = r.next;
        } else if (t === 'SEQEND') {
          i = collectGroups(pairs, i + 1).next;
          break;
        } else break;
      }
      out.push({ type: 'POLYLINE', layer: layerOf(groups), closed: head.closed, vertices });
      continue;
    }
    if (type === 'SEQEND') continue;
    const e = makeEntity(type, groups);
    if (e) out.push(e);
  }
  return i;
}

function parseHeader(pairs, i, header) {
  const n = pairs.length;
  let varName = null;
  let acc = {};
  const flush = () => {
    if (!varName) return;
    if (varName === '$INSUNITS' && acc[70] !== undefined) header.insUnits = int(acc[70], null);
    else if (varName === '$EXTMIN' && acc[10] !== undefined) header.extMin = { x: num(acc[10]), y: num(acc[20] ?? 0) };
    else if (varName === '$EXTMAX' && acc[10] !== undefined) header.extMax = { x: num(acc[10]), y: num(acc[20] ?? 0) };
    else if (varName === '$ACADVER' && acc[1] !== undefined) header.version = acc[1];
    else if (varName === '$MEASUREMENT' && acc[70] !== undefined) header.measurement = int(acc[70], null);
    varName = null; acc = {};
  };
  while (i < n) {
    const [code, value] = pairs[i];
    if (code === 0) { flush(); return i; }
    if (code === 9) { flush(); varName = value.toUpperCase(); }
    else if (varName) acc[code] = value;
    i++;
  }
  flush();
  return i;
}

function parseBlocks(pairs, i, blocks) {
  const n = pairs.length;
  while (i < n) {
    const [code, value] = pairs[i];
    if (code !== 0) { i++; continue; }
    const t = value.toUpperCase();
    if (t === 'ENDSEC' || t === 'EOF' || t === 'SECTION') return i;
    if (t === 'BLOCK') {
      const { groups, next } = collectGroups(pairs, i + 1);
      let name = ''; const base = { x: 0, y: 0 }; let layer = '0';
      for (const [c, v] of groups) {
        if (c === 2 && !name) name = v; else if (c === 3 && !name) name = v;
        else if (c === 10) base.x = num(v); else if (c === 20) base.y = num(v); else if (c === 8) layer = v;
      }
      const ents = [];
      i = parseEntities(pairs, next, ents);
      // consume ENDBLK and its groups
      if (i < n && pairs[i][0] === 0 && pairs[i][1].toUpperCase() === 'ENDBLK') i = collectGroups(pairs, i + 1).next;
      ents.basePoint = base;
      ents.layer = layer;
      if (name) blocks[name] = ents;
      continue;
    }
    i++;
  }
  return i;
}

function skipSection(pairs, i) {
  const n = pairs.length;
  while (i < n) {
    const [code, value] = pairs[i];
    if (code === 0) {
      const t = value.toUpperCase();
      if (t === 'ENDSEC' || t === 'EOF' || t === 'SECTION') return i;
    }
    i++;
  }
  return i;
}

/**
 * Parse a DXF document.
 * @param {string} text
 * @returns {{ header:{ insUnits:number|null, extMin:{x,y}|null, extMax:{x,y}|null }, blocks:Object<string,Array>, entities:Array }}
 */
export function parseDxf(text) {
  const pairs = tokenizeDxf(text);
  const doc = { header: { insUnits: null, extMin: null, extMax: null }, blocks: {}, entities: [] };
  const n = pairs.length;
  let i = 0;
  while (i < n) {
    const [code, value] = pairs[i];
    if (code !== 0) { i++; continue; }
    const t = value.toUpperCase();
    if (t === 'EOF') break;
    if (t === 'SECTION') {
      i++;
      let name = null;
      // The section name is the 2/<NAME> pair right after 0/SECTION. Do not scan further:
      // HEADER variables use code 9 and would otherwise be swallowed here.
      if (i < n && pairs[i][0] === 2) { name = pairs[i][1].toUpperCase(); i++; }
      if (name === 'HEADER') i = parseHeader(pairs, i, doc.header);
      else if (name === 'BLOCKS') i = parseBlocks(pairs, i, doc.blocks);
      else if (name === 'ENTITIES') i = parseEntities(pairs, i, doc.entities);
      else i = skipSection(pairs, i);
      continue;
    }
    if (t === 'ENDSEC') { i++; continue; }
    if (ENTITY_TYPES.has(t)) {
      // Entities outside any section (truncated or hand-made files): parse them tolerantly.
      i = parseEntities(pairs, i, doc.entities);
      continue;
    }
    i++;
  }
  return doc;
}
