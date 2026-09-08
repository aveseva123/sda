// Rectification + segmentation + measurement on synthetic scenes (SPEC 5.4-5.6).
// The true homography comes from the synthetic renderer; ArUco detection is not involved here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { loadCv } from './helpers/cv.mjs';
import { standardScene, makeHomography, partCornersMm } from '../src/testing/synth.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { DEFAULT_TARGET, targetPolygonMm, targetBoundsMm, markerCornersMm } from '../src/vision/target.js';
import { applyHomography, dist } from '../src/vision/geometry.js';
import { planRaster, rectify } from '../src/vision/rectify.js';
import { segmentParts, otsuFromHistogram } from '../src/vision/segment.js';
import { measureContour, grayView, sampleBilinear, refineRectEdges, simplifyPolygon } from '../src/vision/measure.js';

const W = 1600;
const HPX = 1200;
const PX_PER_MM = 2.2;
const settings = DEFAULT_SETTINGS;
const target = DEFAULT_TARGET;
const exclusion = [targetPolygonMm(target, 10)];

const metrics = [];
function logMetric(line) { metrics.push(line); console.log('[metric] ' + line); }

// Scale at the target: mean projected side of marker id0 / markerSideMm (what assessGeometry would report).
function pxPerMmFromH(H) {
  const c = markerCornersMm(target, target.ids[0]).map(([x, y]) => applyHomography(H, x, y));
  let s = 0;
  for (let i = 0; i < 4; i++) s += dist(c[i], c[(i + 1) % 4]);
  return s / 4 / (target.markerSideMm * (target.printScale || 1));
}

function toMat(cv, img) {
  const m = new cv.Mat(img.height, img.width, cv.CV_8UC4);
  m.data.set(img.data);
  return m;
}

// Precondition for a meaningful test: every part corner projects well inside the photo.
function assertPartsVisible(H, parts) {
  for (const p of parts) {
    for (const [x, y] of partCornersMm(p)) {
      const [u, v] = applyHomography(H, x, y);
      assert.ok(u > 15 && u < W - 15 && v > 15 && v < HPX - 15, `part at (${p.x},${p.y}) leaves the frame: ${u.toFixed(0)},${v.toFixed(0)}`);
    }
  }
}

function analyze(cv, scene, { exclusionPolygonsMm = exclusion, raster = settings.raster } = {}) {
  const t0 = performance.now();
  const src = toMat(cv, scene.image);
  const plan = planRaster({ H: scene.H, imageWidth: scene.image.width, imageHeight: scene.image.height, target, pxPerMmAtTarget: pxPerMmFromH(scene.H), raster });
  const rasterMat = rectify(cv, src, plan);
  const t1 = performance.now();
  const gray = new cv.Mat();
  cv.cvtColor(rasterMat, gray, cv.COLOR_RGBA2GRAY);
  const gv = grayView(cv, gray);
  const seg = segmentParts(cv, rasterMat, plan, { params: settings.segmentation, exclusionPolygonsMm });
  const t2 = performance.now();
  const measured = seg.contours.map((c) => measureContour(gv, c.pointsRaster, plan, { edgeRefine: settings.edgeRefine }));
  const t3 = performance.now();
  assert.equal(seg.mask.type(), cv.CV_8UC1);
  assert.equal(seg.mask.rows, plan.height); assert.equal(seg.mask.cols, plan.width);
  src.delete(); rasterMat.delete(); gray.delete(); seg.mask.delete();
  const timings = { rectifyMs: t1 - t0, segmentMs: t2 - t1, measureMs: t3 - t2 };
  return { plan, contours: seg.contours, info: seg.info, measured, timings };
}

function fmtTimings(t) { return `rectify ${t.rectifyMs.toFixed(0)} ms, segment ${t.segmentMs.toFixed(0)} ms, measure ${t.measureMs.toFixed(0)} ms`; }

// Raw minAreaRect-only numbers (contour vertices are pixel centres; no half-pixel footprint).
function rawDims(m, plan) {
  const s = m.minAreaRectRaster.size;
  return { lengthMm: Math.max(s.width, s.height) / plan.pxPerMm, widthMm: Math.min(s.width, s.height) / plan.pxPerMm };
}

test('sampleBilinear and refineRectEdges locate half-pixel edges exactly', () => {
  // Dark rectangle occupying pixel columns 11..60 and rows 21..50 -> true edges at 10.5/60.5 and 20.5/50.5.
  const width = 100; const height = 80;
  const data = new Uint8Array(width * height).fill(205);
  for (let y = 21; y <= 50; y++) for (let x = 11; x <= 60; x++) data[y * width + x] = 55;
  const gray = { data, width, height };
  assert.equal(sampleBilinear(gray, 10, 30), 205);
  assert.equal(sampleBilinear(gray, 11, 30), 55);
  assert.equal(sampleBilinear(gray, 10.5, 30), 130);
  assert.equal(sampleBilinear(gray, -5, -5), 205); // clamped
  // Start from a deliberately biased rectangle (pixel-centre contour of the mask).
  const corners = [[11, 21], [60, 21], [60, 50], [11, 50]];
  const r = refineRectEdges(gray, corners, { searchPx: 5, stepPx: 2, endTrimFrac: 0.1 });
  assert.ok(r.ok, `refine failed: ${r.reason}`);
  const exp = [[10.5, 20.5], [60.5, 20.5], [60.5, 50.5], [10.5, 50.5]];
  for (let i = 0; i < 4; i++) assert.ok(dist(r.corners[i], exp[i]) < 0.02, `corner ${i}: ${r.corners[i]} vs ${exp[i]}`);
  assert.ok(r.residualRmsPx < 0.02);
  assert.ok(r.pointsUsed >= 4 * 6);
  // Inverted contrast must fail with darkInside=true and succeed with darkInside=false.
  const inv = { data: data.map((v) => 255 - v), width, height };
  assert.equal(refineRectEdges(inv, corners, { searchPx: 5, stepPx: 2, endTrimFrac: 0.1 }).ok, false);
  assert.equal(refineRectEdges(inv, corners, { searchPx: 5, stepPx: 2, endTrimFrac: 0.1, darkInside: false }).ok, true);
});

test('simplifyPolygon keeps shape and caps vertex count; otsuFromHistogram splits two modes', () => {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push([100 + 50 * Math.cos(i / 400 * 2 * Math.PI), 100 + 50 * Math.sin(i / 400 * 2 * Math.PI)]);
  const s = simplifyPolygon(pts, 200);
  assert.ok(s.length <= 200 && s.length >= 8, `count ${s.length}`);
  const hist = new Float64Array(256);
  for (let i = 50; i < 60; i++) hist[i] = 100;
  for (let i = 140; i < 150; i++) hist[i] = 30;
  const o = otsuFromHistogram(hist);
  assert.ok(o.threshold >= 59 && o.threshold < 140, `threshold ${o.threshold}`);
  assert.ok(o.separation > 5);
});

test('planRaster respects pxPerMm cap and maxPixels, and its mapping is consistent with H', () => {
  const H = makeHomography({ widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 0, centerMm: [230, 105] });
  const pxAt = pxPerMmFromH(H);
  assert.ok(Math.abs(pxAt - PX_PER_MM) < 1e-6);
  const p1 = planRaster({ H, imageWidth: W, imageHeight: HPX, target, pxPerMmAtTarget: pxAt, raster: { maxPxPerMm: 1.5, maxPixels: 10e6, maxExtentMm: 3000 } });
  assert.ok(Math.abs(p1.pxPerMm - 1.5) < 1e-9, `pxPerMm ${p1.pxPerMm}`);
  const p2 = planRaster({ H, imageWidth: W, imageHeight: HPX, target, pxPerMmAtTarget: pxAt, raster: { maxPxPerMm: 4, maxPixels: 200000, maxExtentMm: 3000 } });
  assert.ok(p2.width * p2.height <= 200000, `${p2.width}x${p2.height}`);
  assert.ok(p2.pxPerMm < PX_PER_MM && p2.pxPerMm > 0.3, `pxPerMm ${p2.pxPerMm}`);
  const p3 = planRaster({ H, imageWidth: W, imageHeight: HPX, target, pxPerMmAtTarget: pxAt, raster: settings.raster });
  assert.ok(Math.abs(p3.pxPerMm - PX_PER_MM) < 1e-6);
  // Working area: the whole frontal frame (~727 x 545 mm) plus nothing beyond, and it contains the target.
  const tb = targetBoundsMm(target, 20);
  assert.ok(p3.boundsMm.minX <= tb.minX && p3.boundsMm.minY <= tb.minY && p3.boundsMm.maxX >= tb.maxX && p3.boundsMm.maxY >= tb.maxY);
  assert.ok(Math.abs((p3.boundsMm.maxX - p3.boundsMm.minX) - W / PX_PER_MM) < 1);
  assert.ok(Math.abs((p3.boundsMm.maxY - p3.boundsMm.minY) - HPX / PX_PER_MM) < 1);
  // Photo px -> raster px via M must agree with H and mmToRaster; rasterToMm inverts mmToRaster.
  for (const [x, y] of [[0, 0], [130, 210], [-100, 300], [400, -50]]) {
    const [u, v] = applyHomography(H, x, y);
    const viaM = applyHomography(p3.M, u, v);
    const direct = p3.mmToRaster(x, y);
    assert.ok(dist(viaM, direct) < 1e-6, `M mismatch at ${x},${y}`);
    const back = p3.rasterToMm(direct[0], direct[1]);
    assert.ok(Math.abs(back[0] - x) < 1e-9 && Math.abs(back[1] - y) < 1e-9);
    const photo = applyHomography(p3.Minv, direct[0], direct[1]);
    assert.ok(dist(photo, [u, v]) < 1e-6);
  }
  // Extent clipping: a strongly tilted view reaches the horizon; the plan must stay within +-maxExtentMm.
  const H2 = makeHomography({ widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 70, centerMm: [65, 105] });
  const p4 = planRaster({ H: H2, imageWidth: W, imageHeight: HPX, target, pxPerMmAtTarget: pxPerMmFromH(H2), raster: { maxPxPerMm: 4, maxPixels: 10e6, maxExtentMm: 500 } });
  assert.ok(p4.boundsMm.minY >= tb.minY - 500 - 1e-9 && p4.boundsMm.maxY <= tb.maxY + 500 + 1e-9);
  assert.ok(p4.width * p4.height <= 10e6);
  assert.throws(() => planRaster({ H: [0, 0, 0, 0, 0, 0, 0, 0, 0], imageWidth: W, imageHeight: HPX, target, pxPerMmAtTarget: 2, raster: settings.raster }), /BAD_INPUT|Вырожденная|Некорректная/);
});

for (const tiltDeg of [0, 20, 30]) {
  test(`297x210 part, tilt ${tiltDeg} / roll 7, shadows + glare + noise`, async () => {
    const cv = await loadCv();
    const parts = [{ x: 330, y: 105, w: 297, h: 210, angleDeg: 12 }];
    const t0 = performance.now();
    const scene = standardScene({
      widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg, rollDeg: 7, centerMm: [230, 105], parts,
      shadows: true, glare: [{ x: 330, y: 105, rx: 40, ry: 20 }], noise: 3,
    });
    const renderMs = performance.now() - t0;
    assertPartsVisible(scene.H, parts);
    const r = analyze(cv, scene);
    assert.equal(r.contours.length, 1, `contours: ${r.contours.length} (info ${JSON.stringify(r.info)})`);
    const m = r.measured[0];
    const tol = tiltDeg >= 30 ? 0.8 : 0.6;
    const raw = rawDims(m, r.plan);
    logMetric(`tilt ${tiltDeg}: raster ${r.plan.width}x${r.plan.height} @ ${r.plan.pxPerMm.toFixed(3)} px/mm; refined L=${m.lengthMm.toFixed(2)} W=${m.widthMm.toFixed(2)} (err ${(m.lengthMm - 297).toFixed(2)}/${(m.widthMm - 210).toFixed(2)} mm, rms ${m.refine ? m.refine.residualRmsPx.toFixed(2) : '-'} px, pts ${m.refine ? m.refine.pointsUsed : 0}); minAreaRect-only L=${raw.lengthMm.toFixed(2)} W=${raw.widthMm.toFixed(2)} (err ${(raw.lengthMm - 297).toFixed(2)}/${(raw.widthMm - 210).toFixed(2)} mm); angle ${m.angleDeg.toFixed(2)} deg; rect ${m.rectangularity.toFixed(3)}; render ${renderMs.toFixed(0)} ms, ${fmtTimings(r.timings)}`);
    assert.ok(m.refined, 'edge refinement must succeed');
    assert.ok(Math.abs(m.lengthMm - 297) <= tol, `length ${m.lengthMm}`);
    assert.ok(Math.abs(m.widthMm - 210) <= tol, `width ${m.widthMm}`);
    assert.ok(Math.abs(m.angleDeg - 12) < 0.5, `angle ${m.angleDeg}`);
    assert.ok(m.rectangularity > 0.97 && m.rectangularity < 1.03, `rectangularity ${m.rectangularity}`);
    assert.ok(Math.abs(m.areaMm2 - 297 * 210) < 0.03 * 297 * 210, `area ${m.areaMm2}`);
    assert.ok(m.polygonMm.length <= 200 && m.polygonMm.length >= 4);
    assert.equal(m.cornersMm.length, 4);
    // Corners in mm must match the true part corners (cyclic order may differ).
    const truth = partCornersMm(parts[0]);
    for (const c of m.cornersMm) {
      const best = Math.min(...truth.map((t) => dist(t, c)));
      assert.ok(best <= 1.0, `corner ${c} off by ${best.toFixed(2)} mm`);
    }
    // Centre of the measured polygon vs. the true centre.
    const cx = m.cornersMm.reduce((s, c) => s + c[0], 0) / 4; const cy = m.cornersMm.reduce((s, c) => s + c[1], 0) / 4;
    assert.ok(Math.hypot(cx - 330, cy - 105) < 1.0, `centre ${cx},${cy}`);
  });
}

test('six parts of different sizes at tilt 15 are all found within 1 mm', async () => {
  const cv = await loadCv();
  const parts = [
    { x: 295, y: 60, w: 210, h: 120, angleDeg: 0 },
    { x: 295, y: 230, w: 100, h: 50, angleDeg: 30 },
    { x: -135, y: 40, w: 140, h: 150, angleDeg: 0 },
    { x: -150, y: 230, w: 180, h: 80, angleDeg: -15 },
    { x: 65, y: 345, w: 380, h: 90, angleDeg: 5 },
    { x: 315, y: 340, w: 80, h: 40, angleDeg: 60 },
  ];
  const scene = standardScene({ widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 15, centerMm: [80, 180], parts, shadows: true, noise: 3 });
  assertPartsVisible(scene.H, parts);
  const r = analyze(cv, scene);
  assert.equal(r.contours.length, 6, `contours: ${r.contours.length}`);
  // Sorted by area descending.
  for (let i = 1; i < r.contours.length; i++) assert.ok(r.contours[i - 1].areaRaster >= r.contours[i].areaRaster);
  const used = new Set();
  let maxErr = 0;
  for (const m of r.measured) {
    const cx = m.cornersMm.reduce((s, c) => s + c[0], 0) / 4; const cy = m.cornersMm.reduce((s, c) => s + c[1], 0) / 4;
    let bi = -1; let bd = Infinity;
    parts.forEach((p, i) => { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; bi = i; } });
    assert.ok(bd < 3, `no part near measured centre ${cx.toFixed(1)},${cy.toFixed(1)}`);
    assert.ok(!used.has(bi), `part ${bi} matched twice`);
    used.add(bi);
    const p = parts[bi];
    const eL = m.lengthMm - Math.max(p.w, p.h); const eW = m.widthMm - Math.min(p.w, p.h);
    maxErr = Math.max(maxErr, Math.abs(eL), Math.abs(eW));
    const raw = rawDims(m, r.plan);
    logMetric(`six/tilt15 part ${bi} ${p.w}x${p.h}@${p.angleDeg}: refined L=${m.lengthMm.toFixed(2)} W=${m.widthMm.toFixed(2)} (err ${eL.toFixed(2)}/${eW.toFixed(2)} mm, refined=${m.refined}); minAreaRect-only err ${(raw.lengthMm - Math.max(p.w, p.h)).toFixed(2)}/${(raw.widthMm - Math.min(p.w, p.h)).toFixed(2)} mm`);
    assert.ok(m.refined, `part ${bi} not refined`);
    assert.ok(Math.abs(eL) <= 1.0, `part ${bi} length err ${eL}`);
    assert.ok(Math.abs(eW) <= 1.0, `part ${bi} width err ${eW}`);
  }
  assert.equal(used.size, 6);
  logMetric(`six/tilt15: max |err| ${maxErr.toFixed(2)} mm; raster ${r.plan.width}x${r.plan.height}; ${fmtTimings(r.timings)}`);
});

test('exclusion zone removes the target: a scene without parts yields 0 contours', async () => {
  const cv = await loadCv();
  const scene = standardScene({ widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 10, centerMm: [65, 105], parts: [], shadows: true, noise: 3 });
  const r = analyze(cv, scene);
  assert.equal(r.contours.length, 0, `contours: ${r.contours.length}`);
  // Sanity: without the exclusion polygon the four marker blobs would pass the size filters.
  const r2 = analyze(cv, scene, { exclusionPolygonsMm: [] });
  assert.ok(r2.contours.length >= 1, 'markers should be detected as blobs without exclusion');
  logMetric(`no-parts: 0 contours with exclusion, ${r2.contours.length} marker blobs without; ${fmtTimings(r.timings)}`);
});

test('strong glare covering the part interior still yields one part within 1 mm', async () => {
  const cv = await loadCv();
  const parts = [{ x: 330, y: 105, w: 297, h: 210, angleDeg: 12 }];
  const scene = standardScene({
    widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 20, rollDeg: 7, centerMm: [230, 105], parts,
    shadows: true, glare: [{ x: 330, y: 105, rx: 100, ry: 60 }], noise: 3,
  });
  assertPartsVisible(scene.H, parts);
  const r = analyze(cv, scene);
  assert.equal(r.contours.length, 1, `contours: ${r.contours.length}`);
  const m = r.measured[0];
  logMetric(`glare 100x60: L=${m.lengthMm.toFixed(2)} W=${m.widthMm.toFixed(2)} (err ${(m.lengthMm - 297).toFixed(2)}/${(m.widthMm - 210).toFixed(2)} mm, refined=${m.refined}); rect ${m.rectangularity.toFixed(3)}; ${fmtTimings(r.timings)}`);
  assert.ok(Math.abs(m.lengthMm - 297) <= 1.0, `length ${m.lengthMm}`);
  assert.ok(Math.abs(m.widthMm - 210) <= 1.0, `width ${m.widthMm}`);
  assert.ok(m.rectangularity > 0.97, `rectangularity ${m.rectangularity}`);
});

test('measureContour falls back to minAreaRect when refinement is disabled or impossible', async () => {
  const cv = await loadCv();
  const parts = [{ x: 330, y: 105, w: 297, h: 210, angleDeg: 12 }];
  const scene = standardScene({ widthPx: W, heightPx: HPX, pxPerMm: PX_PER_MM, tiltDeg: 0, centerMm: [230, 105], parts, noise: 2 });
  const r = analyze(cv, scene);
  assert.equal(r.contours.length, 1);
  const gvBlank = { data: new Uint8Array(r.plan.width * r.plan.height).fill(128), width: r.plan.width, height: r.plan.height };
  const m1 = measureContour(gvBlank, r.contours[0].pointsRaster, r.plan, { edgeRefine: settings.edgeRefine });
  assert.equal(m1.refined, false); assert.equal(m1.refine, null);
  const m2 = measureContour(null, r.contours[0].pointsRaster, r.plan, { edgeRefine: { enabled: false } });
  assert.equal(m2.refined, false);
  logMetric(`fallback (mask footprint): L=${m2.lengthMm.toFixed(2)} W=${m2.widthMm.toFixed(2)} (err ${(m2.lengthMm - 297).toFixed(2)}/${(m2.widthMm - 210).toFixed(2)} mm)`);
  assert.ok(Math.abs(m2.lengthMm - 297) <= 1.0 && Math.abs(m2.widthMm - 210) <= 1.0);
  assert.throws(() => measureContour(null, [[0, 0]], r.plan, {}), /BAD_INPUT|Контур/);
});

test('summary of metrics', () => {
  console.log('\n=== metrics ===\n' + metrics.join('\n') + '\n');
});
