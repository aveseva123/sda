// Extraction of plan parts from a parsed DXF document (docs/SPEC.md §6.2). Pure JS: no DOM, no OpenCV.
// Coordinates inside this module are millimetres after unit conversion; the DXF Y axis is kept as-is
// (only sizes/shapes matter for matching and remnant fitting).
import {
  minAreaRect, polygonArea, polygonCentroid, pointInPolygon, convexHull, composeHomography, applyHomography, dist,
} from '../vision/geometry.js';
import { mtextToPlain, textToPlain } from './dxf.js';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const MAX_INSERT_DEPTH = 8;
const LABEL_DISTANCE_MM = 20;
const LOOP_TOL_MM = 0.05;
const DIM_MERGE_TOL_MM = 0.01;
const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// ---------- affine helpers (3x3 row-major, w = 1) ----------

function translation(tx, ty) { return [1, 0, tx, 0, 1, ty, 0, 0, 1]; }
function scaling(sx, sy) { return [sx, 0, 0, 0, sy, 0, 0, 0, 1]; }
function rotation(deg) {
  const c = Math.cos(deg * DEG); const s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function tp(M, x, y) {
  if (M === IDENTITY) return [x, y];
  return applyHomography(M, x, y);
}
function mapPts(M, pts) {
  if (M === IDENTITY) return pts;
  return pts.map((p) => applyHomography(M, p[0], p[1]));
}

// ---------- curve sampling ----------

// Number of chord segments for a sweep, proportional to the sweep angle (arcSegments per full circle).
function segmentsFor(sweepRad, arcSegments) {
  return Math.max(1, Math.ceil((Math.abs(sweepRad) / TWO_PI) * Math.max(4, arcSegments) - 1e-9));
}

// Circumscribed sampling of an arc (centre, radius, start angle, signed sweep in radians): the vertices are
// placed on the tangent polygon so that every chord touches the arc. Extents of the polyline then equal
// the true extents of the arc (an inscribed polygon would under-estimate a circle's diameter by
// r·(1 − cos(π/k)), ~0.9 mm for Ø100 at 24 segments). Endpoints (exact, on the arc) are optional.
function arcSamples(cx, cy, r, a1, sweep, arcSegments, { start = true, end = true } = {}) {
  const k = segmentsFor(sweep, arcSegments);
  const step = sweep / k;
  const R = r / Math.cos(step / 2);
  const pts = [];
  if (start) pts.push([cx + r * Math.cos(a1), cy + r * Math.sin(a1)]);
  for (let j = 0; j < k; j++) {
    const a = a1 + step * (j + 0.5);
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  if (end) { const a = a1 + sweep; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

// Points strictly between p1 and p2 along a bulge arc (bulge = tan(theta/4), positive = CCW).
function bulgePoints(p1, p2, bulge, arcSegments) {
  if (!bulge || !Number.isFinite(bulge)) return [];
  const dx = p2[0] - p1[0]; const dy = p2[1] - p1[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return [];
  const theta = 4 * Math.atan(bulge);           // signed included angle
  const t = Math.tan(theta / 2);
  if (Math.abs(t) < 1e-12) return [];
  const h = (d / 2) / t;                         // signed distance chord midpoint -> centre (along left normal)
  const mx = (p1[0] + p2[0]) / 2; const my = (p1[1] + p2[1]) / 2;
  const nx = -dy / d; const ny = dx / d;
  const cx = mx + nx * h; const cy = my + ny * h;
  const r = Math.hypot(p1[0] - cx, p1[1] - cy);
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  return arcSamples(cx, cy, r, a1, theta, arcSegments, { start: false, end: false });
}

function polylineToPoints(vertices, closed, arcSegments) {
  const pts = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const p = [v.x, v.y];
    pts.push(p);
    const isLast = i === n - 1;
    if (isLast && !closed) break;
    const w = vertices[(i + 1) % n];
    if (v.bulge) pts.push(...bulgePoints(p, [w.x, w.y], v.bulge, arcSegments));
  }
  return pts;
}

function circlePoints(cx, cy, r, arcSegments) {
  return arcSamples(cx, cy, r, 0, TWO_PI, Math.max(8, arcSegments), { start: false, end: false });
}

function arcPoints(cx, cy, r, startDeg, endDeg, arcSegments) {
  let sweep = ((endDeg - startDeg) % 360 + 360) % 360;
  if (sweep === 0) sweep = 360;
  const full = sweep >= 360 - 1e-9;
  if (full) return { points: circlePoints(cx, cy, r, arcSegments), closed: true };
  return { points: arcSamples(cx, cy, r, startDeg * DEG, sweep * DEG, arcSegments), closed: false };
}

// Ellipse sampled with the same tangent-polygon radial correction (exact for circles, close for ellipses).
function ellipsePoints(e, arcSegments) {
  const ax = e.majorAxis.x; const ay = e.majorAxis.y;
  const ratio = e.ratio || 1;
  const bx = -ay * ratio; const by = ax * ratio;
  const t0 = e.startParam || 0;
  let t1 = e.endParam == null ? TWO_PI : e.endParam;
  while (t1 <= t0 + 1e-12) t1 += TWO_PI;
  const sweep = t1 - t0;
  const full = sweep >= TWO_PI - 1e-9;
  const k = full ? Math.max(8, arcSegments) : segmentsFor(sweep, arcSegments);
  const step = sweep / k;
  const f = 1 / Math.cos(step / 2);
  const at = (t, s) => [e.center.x + s * (ax * Math.cos(t) + bx * Math.sin(t)), e.center.y + s * (ay * Math.cos(t) + by * Math.sin(t))];
  const pts = [];
  if (!full) pts.push(at(t0, 1));
  for (let j = 0; j < k; j++) pts.push(at(t0 + step * (j + 0.5), f));
  if (!full) pts.push(at(t1, 1));
  return { points: pts, closed: full };
}

// De Boor evaluation of a (possibly rational) B-spline at parameter u.
function deBoor(ctrl, weights, knots, degree, u) {
  const n = ctrl.length;
  let k = -1;
  for (let i = degree; i < n; i++) if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
  if (k < 0) k = u >= knots[n] ? n - 1 : degree;
  const d = [];
  for (let j = 0; j <= degree; j++) {
    const idx = Math.min(n - 1, Math.max(0, j + k - degree));
    const w = weights[idx] || 1;
    d.push([ctrl[idx].x * w, ctrl[idx].y * w, w]);
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + k - degree;
      const den = knots[i + degree - r + 1] - knots[i];
      const alpha = den > 1e-15 ? (u - knots[i]) / den : 0;
      d[j] = [
        (1 - alpha) * d[j - 1][0] + alpha * d[j][0],
        (1 - alpha) * d[j - 1][1] + alpha * d[j][1],
        (1 - alpha) * d[j - 1][2] + alpha * d[j][2],
      ];
    }
  }
  const w = d[degree][2] || 1;
  return [d[degree][0] / w, d[degree][1] / w];
}

function splinePoints(e, arcSegments) {
  const ctrl = e.controlPoints || [];
  const fit = e.fitPoints || [];
  const degree = Math.max(1, e.degree || 3);
  const knots = e.knots || [];
  let pts;
  if (ctrl.length >= degree + 1 && knots.length === ctrl.length + degree + 1) {
    const u0 = knots[degree]; const u1 = knots[ctrl.length];
    const samples = Math.max(8, (ctrl.length - 1) * Math.max(3, Math.round(arcSegments / 4)));
    pts = [];
    for (let j = 0; j <= samples; j++) {
      const u = j === samples ? u1 : u0 + (u1 - u0) * (j / samples);
      pts.push(deBoor(ctrl, e.weights || [], knots, degree, u));
    }
  } else if (fit.length >= 2) {
    pts = fit.map((p) => [p.x, p.y]);
  } else if (ctrl.length >= 2) {
    pts = ctrl.map((p) => [p.x, p.y]);
  } else return null;
  let closed = !!e.closed;
  if (!closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= LOOP_TOL_MM) closed = true;
  return { points: pts, closed };
}

// ---------- entity flattening ----------

function makeCtx(opts = {}) {
  return {
    arcSegments: opts.arcSegments || 24,
    transform: opts.transform || IDENTITY,
    depth: opts.depth || 0,
    warnings: opts.warnings || [],
    texts: opts.texts || null,          // if an array: TEXT/MTEXT collected here as { text, position:[x,y], height, layer }
    expandInserts: opts.expandInserts !== false,
    layer: opts.layer || null,
    missingBlocks: opts.missingBlocks || new Set(),
  };
}

function warnMissingBlock(ctx, name) {
  if (ctx.missingBlocks.has(name)) return;
  ctx.missingBlocks.add(name);
  ctx.warnings.push(`Блок «${name}» не найден в файле — вставка пропущена`);
}

function warnDepth(ctx, name) {
  ctx.warnings.push(`Слишком глубокая вложенность блоков (>${MAX_INSERT_DEPTH}) — блок «${name}» пропущен`);
}

// INSERT transform: block-local -> parent coordinates. Order applied to a point: base-point shift,
// scale, (column/row offset), rotation, translation to the insertion point.
function insertTransform(ins, block, col = 0, row = 0) {
  const base = (block && block.basePoint) || { x: 0, y: 0 };
  const sx = Number.isFinite(ins.scale?.x) && ins.scale.x !== 0 ? ins.scale.x : 1;
  const sy = Number.isFinite(ins.scale?.y) && ins.scale.y !== 0 ? ins.scale.y : 1;
  let M = translation(ins.position?.x || 0, ins.position?.y || 0);
  M = composeHomography(M, rotation(ins.rotationDeg || 0));
  if (col || row) M = composeHomography(M, translation(col * (ins.columnSpacing || 0), row * (ins.rowSpacing || 0)));
  M = composeHomography(M, scaling(sx, sy));
  M = composeHomography(M, translation(-(base.x || 0), -(base.y || 0)));
  return M;
}

function flatten(entities, blocks, ctx, out) {
  const M = ctx.transform;
  const A = ctx.arcSegments;
  for (const e of entities || []) {
    if (!e || !e.type) continue;
    // entities on layer "0" inside a block take the layer of the INSERT
    const layer = e.layer && e.layer !== '0' ? e.layer : (ctx.layer || e.layer || '0');
    switch (e.type) {
      case 'LINE': {
        out.push({ points: [tp(M, e.start.x, e.start.y), tp(M, e.end.x, e.end.y)], closed: false, layer });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = e.vertices || [];
        if (verts.length < 2) break;
        let closed = !!e.closed;
        let vs = verts;
        if (!closed && verts.length > 2) {
          const a = verts[0]; const b = verts[verts.length - 1];
          if (Math.hypot(a.x - b.x, a.y - b.y) <= LOOP_TOL_MM) { closed = true; vs = verts.slice(0, -1); }
        }
        out.push({ points: mapPts(M, polylineToPoints(vs, closed, A)), closed, layer });
        break;
      }
      case 'CIRCLE': {
        if (!(e.radius > 0)) break;
        out.push({ points: mapPts(M, circlePoints(e.center.x, e.center.y, e.radius, A)), closed: true, layer });
        break;
      }
      case 'ARC': {
        if (!(e.radius > 0)) break;
        const r = arcPoints(e.center.x, e.center.y, e.radius, e.startAngleDeg || 0, e.endAngleDeg == null ? 360 : e.endAngleDeg, A);
        out.push({ points: mapPts(M, r.points), closed: r.closed, layer });
        break;
      }
      case 'ELLIPSE': {
        const r = ellipsePoints(e, A);
        out.push({ points: mapPts(M, r.points), closed: r.closed, layer });
        break;
      }
      case 'SPLINE': {
        const r = splinePoints(e, A);
        if (r) out.push({ points: mapPts(M, r.points), closed: r.closed, layer });
        break;
      }
      case 'INSERT': {
        if (!ctx.expandInserts) break;
        const block = blocks ? blocks[e.name] : null;
        if (!block) { warnMissingBlock(ctx, e.name); break; }
        if (ctx.depth >= MAX_INSERT_DEPTH) { warnDepth(ctx, e.name); break; }
        const cols = Math.max(1, e.columns || 1); const rows = Math.max(1, e.rows || 1);
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const sub = { ...ctx, transform: composeHomography(M, insertTransform(e, block, c, r)), depth: ctx.depth + 1, layer };
            flatten(block, blocks, sub, out);
          }
        }
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        if (!ctx.texts) break;
        const text = e.type === 'MTEXT' ? mtextToPlain(e.text) : textToPlain(e.text);
        if (!text) break;
        ctx.texts.push({ text, position: tp(M, e.position?.x || 0, e.position?.y || 0), height: e.height || 0, layer });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Convert entities (expanding INSERTs) into flat polylines [{ points:[[x,y]...], closed, layer }].
 * opts: { arcSegments = 24, transform = identity 3x3, depth = 0, warnings = [], texts = null, expandInserts = true }
 */
export function entitiesToPolylines(entities, blocks = {}, opts = {}) {
  const ctx = makeCtx(opts);
  const out = flatten(entities, blocks || {}, ctx, []);
  return out.filter((pl) => pl.points.length >= 2);
}

// ---------- loop building ----------

function dedupePoints(points, tol) {
  const out = [];
  for (const p of points) {
    if (out.length && dist(out[out.length - 1], p) <= tol) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  return out;
}

class EndpointIndex {
  constructor(cell) { this.cell = Math.max(cell, 1e-6); this.map = new Map(); }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  add(p, ref) {
    const k = this.key(p[0], p[1]);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(ref);
  }
  near(p, tol, visit) {
    const cx = Math.floor(p[0] / this.cell); const cy = Math.floor(p[1] / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.map.get(`${cx + i},${cy + j}`);
        if (!arr) continue;
        for (const ref of arr) if (dist(ref.p, p) <= tol) visit(ref);
      }
    }
  }
}

/**
 * Build closed loops from polylines: closed polylines pass through, open ones are chained by
 * endpoint proximity (tolMm). Segments that cannot be closed are dropped.
 * Returns [{ points:[[x,y]...], layer }] in reading order (order of the first segment of each loop);
 * the array carries a non-enumerable `droppedSegments` count.
 */
export function buildLoops(polylines, tolMm = LOOP_TOL_MM) {
  const tol = Math.max(0, Number.isFinite(tolMm) ? tolMm : LOOP_TOL_MM);
  const loops = [];
  const open = [];
  let dropped = 0;
  for (let idx = 0; idx < (polylines || []).length; idx++) {
    const pl = polylines[idx];
    if (!pl || !Array.isArray(pl.points) || pl.points.length < 2) continue;
    const pts = dedupePoints(pl.points, tol);
    if (pl.closed) {
      if (pts.length >= 3 && polygonArea(pts) > 1e-9) loops.push({ points: pts, layer: pl.layer, order: idx });
      else dropped++;
      continue;
    }
    if (pts.length >= 2) open.push({ points: pts, layer: pl.layer, order: idx, used: false });
    else dropped++;
  }
  if (open.length) {
    const index = new EndpointIndex(Math.max(tol * 4, 0.5));
    for (const seg of open) {
      index.add(seg.points[0], { seg, end: 0, p: seg.points[0] });
      index.add(seg.points[seg.points.length - 1], { seg, end: 1, p: seg.points[seg.points.length - 1] });
    }
    for (const start of open) {
      if (start.used) continue;
      start.used = true;
      const chain = start.points.map((p) => p.slice());
      const first = chain[0];
      let guard = open.length + 1;
      let closed = false;
      while (guard-- > 0) {
        const tail = chain[chain.length - 1];
        if (chain.length >= 3 && dist(tail, first) <= tol) { closed = true; break; }
        let best = null; let bestD = Infinity;
        index.near(tail, tol, (ref) => {
          if (ref.seg.used) return;
          const d = dist(ref.p, tail);
          if (d < bestD) { bestD = d; best = ref; }
        });
        if (!best) break;
        best.seg.used = true;
        let pts = best.seg.points;
        if (best.end === 1) pts = pts.slice().reverse();
        for (let k = 1; k < pts.length; k++) chain.push(pts[k].slice());
      }
      if (closed) {
        const pts = dedupePoints(chain, tol);
        if (pts.length >= 3 && polygonArea(pts) > 1e-9) loops.push({ points: pts, layer: start.layer, order: start.order });
        else dropped++;
      } else dropped++;
    }
  }
  loops.sort((a, b) => a.order - b.order);
  const out = loops.map((l) => ({ points: l.points, layer: l.layer }));
  Object.defineProperty(out, 'droppedSegments', { value: dropped, enumerable: false });
  return out;
}

// ---------- hierarchy / sheet detection ----------

function bboxOf(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

function bboxInside(inner, outer, eps = 1e-6) {
  return inner.minX >= outer.minX - eps && inner.minY >= outer.minY - eps && inner.maxX <= outer.maxX + eps && inner.maxY <= outer.maxY + eps;
}

function polygonContains(outer, inner) {
  // majority of the inner vertices (and its centroid) inside the outer polygon
  let inside = 0;
  const n = inner.points.length;
  for (const p of inner.points) if (pointInPolygon(p, outer.points)) inside++;
  if (inside * 2 > n) return true;
  if (inside * 2 === n) return pointInPolygon(inner.centroid, outer.points);
  return false;
}

function makeShape(points, extra = {}) {
  return { points, area: polygonArea(points), bbox: bboxOf(points), centroid: polygonCentroid(points), parent: null, children: [], ...extra };
}

// Parent = smallest strictly larger shape that contains this one.
function buildHierarchy(shapes) {
  for (const s of shapes) { s.parent = null; s.children = []; }
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    let parent = null;
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      const o = shapes[j];
      if (o.area <= s.area) continue;
      if (parent && o.area >= parent.area) continue;
      if (!bboxInside(s.bbox, o.bbox, 1e-6)) continue;
      if (polygonContains(o, s)) parent = o;
    }
    s.parent = parent;
    if (parent) parent.children.push(s);
  }
  return shapes;
}

function isAncestor(a, s) {
  for (let p = s.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

// Sheet = the largest loop that contains >= 2 other loops (mode 'auto'); 'largest' = the largest loop
// as long as it contains anything; 'none' = no sheet. Returns { primary, sheets:Set } or null.
function pickSheets(shapes, sheetMode) {
  if (sheetMode === 'none' || !shapes.length) return null;
  let primary = null;
  if (sheetMode === 'largest') {
    const largest = shapes.reduce((a, b) => (b.area > a.area ? b : a));
    if (!largest.children.length) return null;
    primary = largest;
  } else {
    const candidates = shapes.filter((s) => s.children.length >= 2);
    if (!candidates.length) return null;
    primary = candidates.reduce((a, b) => (b.area > a.area ? b : a));
  }
  const sheets = new Set([primary]);
  // Several sheets of (almost) the same size side by side: treat each as a sheet.
  for (const s of shapes) {
    if (s === primary || s.parent !== primary.parent || s.children.length < 2) continue;
    if (s.area >= 0.9 * primary.area) sheets.add(s);
  }
  return { primary, sheets };
}

// Shapes that count as parts: children of the sheet(s) and siblings of the primary sheet
// (loose contours next to the sheet). Without a sheet: top-level shapes.
function selectPartShapes(shapes, sheetInfo) {
  if (!sheetInfo) return shapes.filter((s) => !s.parent);
  const { primary, sheets } = sheetInfo;
  return shapes.filter((s) => {
    if (sheets.has(s) || isAncestor(s, primary)) return false;
    if (s.parent && sheets.has(s.parent)) return true;
    return s.parent === primary.parent;
  });
}

// ---------- part construction ----------

function round6(v) { return Math.round(v * 1e6) / 1e6; }

function normalizePolygon(points) {
  const b = bboxOf(points);
  return points.map((p) => [round6(p[0] - b.minX), round6(p[1] - b.minY)]);
}

function partFromPolygon(points, { id = '', qty = 1, source = 'loop' } = {}) {
  const rr = minAreaRect(points);
  const lengthMm = rr.size.width; const widthMm = rr.size.height;
  const areaMm2 = polygonArea(points);
  const rectArea = lengthMm * widthMm;
  const rectangular = rectArea > 0 && areaMm2 / rectArea >= 0.98;
  return { id, lengthMm, widthMm, qty, polygonMm: normalizePolygon(points), areaMm2, rectangular, source };
}

function sheetDims(points) {
  const rr = minAreaRect(points);
  return { lengthMm: rr.size.width, widthMm: rr.size.height };
}

function bboxDistance(p, b) {
  const dx = p[0] < b.minX ? b.minX - p[0] : p[0] > b.maxX ? p[0] - b.maxX : 0;
  const dy = p[1] < b.minY ? b.minY - p[1] : p[1] > b.maxY ? p[1] - b.maxY : 0;
  return Math.hypot(dx, dy);
}

// One label per shape: a text whose insertion point lies inside the polygon first (closest to the
// centroid), then the nearest unused text within LABEL_DISTANCE_MM of the bounding box.
function assignLabels(shapes, texts) {
  const labels = new Map();
  const free = texts.map((t) => ({ ...t, used: false }));
  for (const s of shapes) {
    let best = null; let bestD = Infinity;
    for (const t of free) {
      if (t.used || !pointInPolygon(t.position, s.points)) continue;
      const d = dist(t.position, s.centroid);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) { best.used = true; labels.set(s, best.text); }
  }
  for (const s of shapes) {
    if (labels.has(s)) continue;
    let best = null; let bestD = Infinity;
    for (const t of free) {
      if (t.used) continue;
      const d = bboxDistance(t.position, s.bbox);
      if (d <= LABEL_DISTANCE_MM && d < bestD) { bestD = d; best = t; }
    }
    if (best) { best.used = true; labels.set(s, best.text); }
  }
  return labels;
}

// ---------- blocks strategy ----------

function outerPolygonOf(loops) {
  if (!loops.length) return null;
  const shapes = buildHierarchy(loops.map((l) => makeShape(l.points)));
  const outer = shapes.filter((s) => !s.parent);
  return outer.length === 1 ? outer[0].points : convexHull(outer.flatMap((s) => s.points));
}

// Geometry of a block in its own coordinates: own closed loops (without nested INSERTs) and the outer
// polygon of everything including nested INSERTs.
function blockGeometry(name, blocks, cache, base) {
  if (cache.has(name)) return cache.get(name);
  const block = blocks[name];
  const info = { ownLoops: [], ownPolygon: null, polygon: null, hasInserts: false };
  cache.set(name, info); // guards against recursive block references
  if (!block) return info;
  info.hasInserts = block.some((e) => e && e.type === 'INSERT');
  info.ownLoops = buildLoops(entitiesToPolylines(block, blocks, { arcSegments: base.arcSegments, expandInserts: false }), LOOP_TOL_MM);
  info.ownPolygon = outerPolygonOf(info.ownLoops);
  if (info.hasInserts) {
    const allLoops = buildLoops(entitiesToPolylines(block, blocks, { arcSegments: base.arcSegments, warnings: [] }), LOOP_TOL_MM);
    info.polygon = outerPolygonOf(allLoops);
  } else info.polygon = info.ownPolygon;
  return info;
}

// Walk INSERTs of model space. A block with closed geometry is a part instance; a block without own
// closed geometry but with nested INSERTs is a container (its inserts are collected recursively).
// A block with both is a container when its outline holds >= 2 nested instances (a sheet as a block),
// otherwise a part with nested features. Container outlines go to `loose` (candidate sheets).
function collectInstances(entities, blocks, ctx, cache, base, out, loose) {
  for (const e of entities || []) {
    if (!e || e.type !== 'INSERT') continue;
    const block = blocks[e.name];
    if (!block) { warnMissingBlock(ctx, e.name); continue; }
    const info = blockGeometry(e.name, blocks, cache, base);
    const cols = Math.max(1, e.columns || 1); const rows = Math.max(1, e.rows || 1);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const M = composeHomography(ctx.transform, insertTransform(e, block, c, r));
        const leaf = () => out.push({ name: e.name, transform: M, polygon: info.polygon, order: out.length });
        if (!info.hasInserts) { if (info.ownLoops.length) leaf(); continue; }
        if (ctx.depth >= MAX_INSERT_DEPTH) { warnDepth(ctx, e.name); continue; }
        const sub = { ...ctx, transform: M, depth: ctx.depth + 1 };
        if (!info.ownLoops.length) { collectInstances(block, blocks, sub, cache, base, out, loose); continue; }
        const nested = []; const nestedLoose = [];
        collectInstances(block, blocks, sub, cache, base, nested, nestedLoose);
        const outline = mapPts(M, info.ownPolygon);
        let inside = 0;
        for (const inst of nested) {
          const poly = mapPts(inst.transform, inst.polygon);
          if (pointInPolygon(polygonCentroid(poly), outline)) inside++;
        }
        if (inside >= 2) {
          for (const inst of nested) out.push({ ...inst, order: out.length });
          loose.push(...nestedLoose);
          for (const l of info.ownLoops) loose.push({ points: mapPts(M, l.points), layer: l.layer });
        } else leaf();
      }
    }
  }
  return out;
}

function scaleOf(M, unitScale) {
  const sx = Math.hypot(M[0], M[3]) / unitScale;
  const sy = Math.hypot(M[1], M[4]) / unitScale;
  return { sx, sy, key: `${sx.toFixed(4)}x${sy.toFixed(4)}` };
}

function fmtScale(v) { return String(Math.round(v * 1000) / 1000); }

// ---------- main entry ----------

/**
 * Extract plan parts from a parsed DXF document.
 * @param {ReturnType<import('./dxf.js').parseDxf>} doc
 * @param {{ units?:'auto'|'mm'|'in', arcSegments?:number, sheetMode?:'auto'|'none'|'largest' }} options
 * @returns {{ parts:Array, sheet:{lengthMm,widthMm}|null, strategy:'blocks'|'loops', unitsUsed:'mm'|'in', warnings:string[] }}
 */
export function extractParts(doc, { units = 'auto', arcSegments = 24, sheetMode = 'auto' } = {}) {
  const warnings = [];
  const header = (doc && doc.header) || {};
  const blocks = (doc && doc.blocks) || {};
  const entities = (doc && doc.entities) || [];
  let unitsUsed;
  if (units === 'in' || units === 'mm') unitsUsed = units;
  else unitsUsed = header.insUnits === 1 ? 'in' : 'mm';
  const unitScale = unitsUsed === 'in' ? 25.4 : 1;
  if (unitsUsed === 'in') {
    warnings.push(units === 'in'
      ? 'Единицы чертежа заданы вручную — дюймы, размеры пересчитаны в мм'
      : 'Единицы чертежа — дюймы ($INSUNITS = 1), размеры пересчитаны в мм');
  }
  const S = scaling(unitScale, unitScale);
  const base = { arcSegments, warnings };
  const missingBlocks = new Set();
  const segs = Math.max(4, Math.round(arcSegments) || 24);
  base.arcSegments = segs;

  // --- strategy 'blocks': INSERTs of blocks that own closed geometry
  const cache = new Map();
  const instances = []; const containerLoops = [];
  collectInstances(entities, blocks, makeCtx({ arcSegments: segs, warnings, transform: S, missingBlocks }), cache, base, instances, containerLoops);

  if (instances.length > 0) {
    // Model-space geometry outside blocks (sheet outline, loose contours, labels).
    const texts = [];
    const loose = entities.filter((e) => e && e.type !== 'INSERT');
    const loosePl = entitiesToPolylines(loose, blocks, { arcSegments: segs, warnings, transform: S, texts, missingBlocks });
    const looseLoops = buildLoops(loosePl, LOOP_TOL_MM);
    const shapes = [];
    for (const inst of instances) shapes.push(makeShape(mapPts(inst.transform, inst.polygon), { kind: 'instance', inst }));
    for (const l of looseLoops) shapes.push(makeShape(l.points, { kind: 'loop' }));
    for (const l of containerLoops) shapes.push(makeShape(l.points, { kind: 'loop' }));
    buildHierarchy(shapes);
    const sheetInfo = pickSheets(shapes, sheetMode);
    const partShapes = new Set(selectPartShapes(shapes, sheetInfo));
    const groups = new Map();
    const looseParts = [];
    for (const s of shapes) {
      if (sheetInfo && (sheetInfo.sheets.has(s) || isAncestor(s, sheetInfo.primary))) continue;
      if (s.kind === 'instance') {
        const { sx, sy, key } = scaleOf(s.inst.transform, unitScale);
        const unit = Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6;
        const gk = `${s.inst.name}|${key}`;
        let g = groups.get(gk);
        if (!g) {
          const anon = s.inst.name.startsWith('*');
          let id = anon ? '' : s.inst.name;
          if (id && !unit) id += Math.abs(sx - sy) < 1e-6 ? ` ×${fmtScale(sx)}` : ` ×${fmtScale(sx)}/${fmtScale(sy)}`;
          g = { part: partFromPolygon(s.points, { id, qty: 0, source: 'block' }), order: s.inst.order };
          groups.set(gk, g);
        }
        g.part.qty += 1;
      } else if (partShapes.has(s)) looseParts.push(s);
    }
    const parts = Array.from(groups.values()).sort((a, b) => a.order - b.order).map((g) => g.part);
    if (looseParts.length) {
      const labels = assignLabels(looseParts, texts);
      for (const s of looseParts) parts.push(partFromPolygon(s.points, { id: labels.get(s) || '', source: 'loop' }));
      warnings.push(`Контуры вне блоков учтены как детали: ${looseParts.length}`);
    }
    if (sheetInfo && sheetInfo.sheets.size > 1) warnings.push(`В файле несколько листов: ${sheetInfo.sheets.size}`);
    if (looseLoops.droppedSegments) warnings.push(`Незамкнутых сегментов пропущено: ${looseLoops.droppedSegments}`);
    const sheet = sheetInfo ? sheetDims(sheetInfo.primary.points) : null;
    return { parts: normalizeParts(parts), sheet, strategy: 'blocks', unitsUsed, warnings };
  }

  // --- strategy 'loops': closed contours in model space (INSERTs expanded as plain geometry)
  const texts = [];
  const allPl = entitiesToPolylines(entities, blocks, { arcSegments: segs, warnings, transform: S, texts, missingBlocks });
  const loops = buildLoops(allPl, LOOP_TOL_MM);
  if (loops.droppedSegments) warnings.push(`Незамкнутых сегментов пропущено: ${loops.droppedSegments}`);
  if (!loops.length) {
    warnings.push('В DXF не найдено замкнутых контуров — детали не извлечены');
    return { parts: [], sheet: null, strategy: 'loops', unitsUsed, warnings };
  }
  const shapes = buildHierarchy(loops.map((l) => makeShape(l.points, { kind: 'loop' })));
  const sheetInfo = pickSheets(shapes, sheetMode);
  const partShapes = selectPartShapes(shapes, sheetInfo);
  const labels = assignLabels(partShapes, texts);
  const parts = partShapes.map((s) => partFromPolygon(s.points, { id: labels.get(s) || '', source: 'loop' }));
  if (sheetInfo && sheetInfo.sheets.size > 1) warnings.push(`В файле несколько листов: ${sheetInfo.sheets.size}`);
  const sheet = sheetInfo ? sheetDims(sheetInfo.primary.points) : null;
  return { parts: normalizeParts(parts), sheet, strategy: 'loops', unitsUsed, warnings };
}

/**
 * Merge identical parts (same id, or no id and equal dims within 0.01 mm), sum qty, ensure length >= width,
 * assign auto ids P-01, P-02, ... in reading order to unlabeled parts. Does not mutate the input.
 */
export function normalizeParts(parts) {
  const out = [];
  const byId = new Map();
  for (const p of parts || []) {
    if (!p) continue;
    let L = Number(p.lengthMm); let W = Number(p.widthMm);
    if (!Number.isFinite(L)) L = 0; if (!Number.isFinite(W)) W = 0;
    if (W > L) [L, W] = [W, L];
    const qtyRaw = Number(p.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    const id = p.id == null ? '' : String(p.id).trim();
    const areaRaw = Number(p.areaMm2);
    const areaMm2 = p.areaMm2 != null && Number.isFinite(areaRaw) ? areaRaw : L * W;
    const q = {
      ...p,
      id,
      lengthMm: L,
      widthMm: W,
      qty,
      polygonMm: Array.isArray(p.polygonMm) ? p.polygonMm : null,
      areaMm2,
      rectangular: p.rectangular == null ? true : !!p.rectangular,
      source: p.source || 'list',
    };
    let target = null;
    if (id) target = byId.get(id) || null;
    else target = out.find((o) => !o.id && Math.abs(o.lengthMm - L) <= DIM_MERGE_TOL_MM && Math.abs(o.widthMm - W) <= DIM_MERGE_TOL_MM) || null;
    if (target) target.qty += qty;
    else { out.push(q); if (id) byId.set(id, q); }
  }
  const used = new Set(out.map((o) => o.id).filter(Boolean));
  let k = 1;
  for (const o of out) {
    if (o.id) continue;
    let id;
    do { id = `P-${String(k++).padStart(2, '0')}`; } while (used.has(id));
    o.id = id; used.add(id);
  }
  return out;
}
