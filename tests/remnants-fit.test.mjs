import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsInRemnant, findFittingRemnants, rasterizePolygon, placementCorners } from '../src/remnants/fit.js';
import { pointInPolygon, polygonArea } from '../src/vision/geometry.js';

const L_SHAPE = [[0, 0], [1000, 0], [1000, 300], [400, 300], [400, 800], [0, 800]];
// Area: wide leg 1000x300 + tall leg 400x500 = 500000 mm² (bbox 1000x800 = 800000, ratio 0.625 -> raster).
const L_AREA = 500000;
const L_REMNANT = { id: 'R-L', lengthMm: 1000, widthMm: 800, areaMm2: L_AREA, polygonMm: L_SHAPE, status: 'available' };

function rotatePoly(poly, deg, dx = 0, dy = 0) {
  const c = Math.cos(deg * Math.PI / 180); const s = Math.sin(deg * Math.PI / 180);
  return poly.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy]);
}

// Every corner and edge midpoint of the placed part must be inside the polygon (with a small inset
// so that boundary-touching placements are not rejected by floating point noise).
function assertPlacementInside(poly, need, placement, insetMm = 0.5) {
  const w = placement.rotated ? need.widthMm : need.lengthMm;
  const h = placement.rotated ? need.lengthMm : need.widthMm;
  const shrunk = { lengthMm: w - 2 * insetMm, widthMm: h - 2 * insetMm };
  const corners = placementCorners(shrunk, { ...placement, rotated: false });
  const pts = corners.slice();
  for (let i = 0; i < 4; i++) {
    const a = corners[i]; const b = corners[(i + 1) % 4];
    pts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  pts.push([placement.xMm, placement.yMm]);
  for (const p of pts) assert.ok(pointInPolygon(p, poly), `point ${p.map((v) => v.toFixed(1))} outside polygon`);
}

test('fitsInRemnant: rectangular remnant 600x400, bbox method in both orientations with margin 5', () => {
  const remnant = { id: 'R-001', lengthMm: 600, widthMm: 400, areaMm2: 240000, polygonMm: null };
  const a = fitsInRemnant(remnant, { lengthMm: 380, widthMm: 240 });
  assert.equal(a.fits, true);
  assert.equal(a.method, 'bbox');
  assert.equal(a.placement.rotated, false);
  assert.equal(a.placement.angleDeg, 0);
  assert.deepEqual([a.placement.xMm, a.placement.yMm], [5 + 190, 5 + 120]);

  const b = fitsInRemnant(remnant, { lengthMm: 390, widthMm: 590 });
  assert.equal(b.fits, true);
  assert.equal(b.method, 'bbox');
  assert.equal(b.placement.rotated, true);

  const c = fitsInRemnant(remnant, { lengthMm: 420, widthMm: 400 }, { marginMm: 5 });
  assert.equal(c.fits, false);
  assert.equal(c.method, 'bbox');
  assert.equal(c.placement, null);

  // Exact fit with margin: 590 + 2*5 = 600, 390 + 2*5 = 400.
  const d = fitsInRemnant(remnant, { lengthMm: 590, widthMm: 390 }, { marginMm: 5 });
  assert.equal(d.fits, true);
  const e = fitsInRemnant(remnant, { lengthMm: 590.1, widthMm: 390 }, { marginMm: 5 });
  assert.equal(e.fits, false);
  // Without margin 600x400 fits exactly.
  assert.equal(fitsInRemnant(remnant, { lengthMm: 600, widthMm: 400 }, { marginMm: 0 }).fits, true);
});

test('fitsInRemnant: remnant with a rectangular polygon (area ratio >= 0.97) uses bbox', () => {
  const poly = rotatePoly([[0, 0], [600, 0], [600, 400], [0, 400]], 30, 100, 50);
  const remnant = { id: 'R-002', lengthMm: 600, widthMm: 400, areaMm2: polygonArea(poly), polygonMm: poly };
  const r = fitsInRemnant(remnant, { lengthMm: 380, widthMm: 240 });
  assert.equal(r.method, 'bbox');
  assert.equal(r.fits, true);
  // Missing lengthMm/widthMm/areaMm2 are derived from the polygon.
  const r2 = fitsInRemnant({ id: 'R-003', polygonMm: poly }, { lengthMm: 390, widthMm: 590 });
  assert.equal(r2.method, 'bbox');
  assert.equal(r2.fits, true);
  assert.equal(r2.placement.rotated, true);
  // A slightly chamfered rectangle (ratio just below 0.97) goes to the raster method.
  const chamfered = [[0, 0], [600, 0], [600, 400], [200, 400], [0, 300]];
  const r3 = fitsInRemnant({ id: 'R-004', lengthMm: 600, widthMm: 400, areaMm2: polygonArea(chamfered), polygonMm: chamfered }, { lengthMm: 380, widthMm: 240 });
  assert.equal(r3.method, 'raster');
  assert.equal(r3.fits, true);
});

test('rasterizePolygon: cell centres agree with pointInPolygon', () => {
  assert.equal(polygonArea(L_SHAPE), L_AREA);
  for (const angle of [0, 15, 37.5]) {
    const poly = rotatePoly(L_SHAPE, angle);
    const r = rasterizePolygon(poly, 5);
    let inside = 0;
    for (let j = 0; j < r.rows; j++) {
      for (let i = 0; i < r.cols; i++) {
        const p = [r.minX + (i + 0.5) * r.res, r.minY + (j + 0.5) * r.res];
        const expected = pointInPolygon(p, poly) ? 1 : 0;
        assert.equal(r.grid[j * r.cols + i], expected, `angle ${angle} cell ${i},${j}`);
        inside += expected;
      }
    }
    // Cell count approximates the polygon area (500000 mm² / 25 mm² per cell = 20000).
    assert.ok(Math.abs(inside * 25 - L_AREA) < 0.02 * L_AREA, `area at ${angle}: ${inside * 25}`);
  }
});

test('fitsInRemnant: L-shaped polygon rejects what the bbox would accept', () => {
  const r = fitsInRemnant(L_REMNANT, { lengthMm: 700, widthMm: 600 });
  assert.equal(r.method, 'raster');
  assert.equal(r.fits, false);
  assert.equal(r.placement, null);
  // Sanity: the same need would pass a pure bbox check on 1000x800.
  const bbox = fitsInRemnant({ id: 'R-box', lengthMm: 1000, widthMm: 800 }, { lengthMm: 700, widthMm: 600 });
  assert.equal(bbox.fits, true);
  // Larger than the wide leg's height in both orientations and wider than the tall leg.
  assert.equal(fitsInRemnant(L_REMNANT, { lengthMm: 500, widthMm: 450 }).fits, false);
  // Area larger than the polygon area is rejected too.
  assert.equal(fitsInRemnant(L_REMNANT, { lengthMm: 900, widthMm: 700 }).fits, false);
});

test('fitsInRemnant: L-shaped polygon accepts parts in either leg, either orientation', () => {
  const cases = [
    { lengthMm: 900, widthMm: 250 }, // wide leg
    { lengthMm: 350, widthMm: 700 }, // tall leg
    { lengthMm: 250, widthMm: 900 }, // wide leg, rotated relative to need
    { lengthMm: 700, widthMm: 350 }, // tall leg, rotated relative to need
    { lengthMm: 990, widthMm: 290 }, // wide leg, tight (margin 5)
    { lengthMm: 790, widthMm: 390 }, // tall leg, tight
  ];
  for (const need of cases) {
    const r = fitsInRemnant(L_REMNANT, need);
    assert.equal(r.method, 'raster');
    assert.equal(r.fits, true, `${need.lengthMm}x${need.widthMm} must fit`);
    assert.ok(r.placement && Number.isFinite(r.placement.xMm) && Number.isFinite(r.placement.yMm));
    assert.ok(r.placement.angleDeg >= 0 && r.placement.angleDeg < 180);
    assertPlacementInside(L_SHAPE, need, r.placement);
  }
  // 900x250: length must lie along X in the wide leg.
  const wide = fitsInRemnant(L_REMNANT, { lengthMm: 900, widthMm: 250 });
  assert.equal(wide.placement.angleDeg, 0);
  assert.equal(wide.placement.rotated, false);
  assert.ok(wide.placement.yMm < 300 && wide.placement.xMm > 400);
  // 250x900: only the wide leg is long enough, so it is placed rotated (or at 90 degrees).
  const tallNeed = fitsInRemnant(L_REMNANT, { lengthMm: 250, widthMm: 900 });
  assert.ok(tallNeed.placement.rotated === true || tallNeed.placement.angleDeg === 90);
  // Too wide for the wide leg's height and too long for the tall leg: 810x310 must not fit.
  assert.equal(fitsInRemnant(L_REMNANT, { lengthMm: 810, widthMm: 310 }).fits, false);
});

test('fitsInRemnant: rotated L-shape is found at a matching angle step', () => {
  const rotated = rotatePoly(L_SHAPE, 30, 250, -120);
  const remnant = { id: 'R-rot', lengthMm: 1000, widthMm: 800, areaMm2: polygonArea(rotated), polygonMm: rotated };
  const ok = fitsInRemnant(remnant, { lengthMm: 900, widthMm: 250 });
  assert.equal(ok.method, 'raster');
  assert.equal(ok.fits, true);
  assertPlacementInside(rotated, { lengthMm: 900, widthMm: 250 }, ok.placement);
  // The found orientation must be (close to) 30 degrees modulo 90.
  const a = ((ok.placement.angleDeg % 90) + 90) % 90;
  assert.ok(Math.abs(a - 30) < 1e-6, `angle ${ok.placement.angleDeg}`);
  const bad = fitsInRemnant(remnant, { lengthMm: 700, widthMm: 600 });
  assert.equal(bad.fits, false);
  // With a coarse angle step that never aligns (40 deg), the tight part cannot be found.
  const coarse = fitsInRemnant(remnant, { lengthMm: 900, widthMm: 250 }, { angleStepDeg: 40 });
  assert.equal(coarse.fits, false);
});

test('fitsInRemnant: performance on the L-shape with default options < 300 ms', () => {
  // Warm up once, then time the worst case (no fit -> all angles and orientations scanned).
  fitsInRemnant(L_REMNANT, { lengthMm: 700, widthMm: 600 });
  const t0 = performance.now();
  const r1 = fitsInRemnant(L_REMNANT, { lengthMm: 700, widthMm: 600 });
  const t1 = performance.now();
  const r2 = fitsInRemnant(L_REMNANT, { lengthMm: 350, widthMm: 700 });
  const t2 = performance.now();
  assert.equal(r1.fits, false);
  assert.equal(r2.fits, true);
  assert.ok(t1 - t0 < 300, `reject took ${(t1 - t0).toFixed(1)} ms`);
  assert.ok(t2 - t1 < 300, `accept took ${(t2 - t1).toFixed(1)} ms`);
});

test('fitsInRemnant: invalid inputs do not throw', () => {
  assert.equal(fitsInRemnant({ id: 'x' }, { lengthMm: 10, widthMm: 10 }).fits, false);
  assert.equal(fitsInRemnant({ id: 'x', lengthMm: 100, widthMm: 50 }, { lengthMm: 0, widthMm: 10 }).fits, false);
  assert.equal(fitsInRemnant({ id: 'x', lengthMm: 100, widthMm: 50 }, null).fits, false);
  assert.equal(fitsInRemnant(null, { lengthMm: 10, widthMm: 10 }).fits, false);
  assert.equal(fitsInRemnant({ id: 'x', polygonMm: [[0, 0], [1, 0]] }, { lengthMm: 10, widthMm: 10 }).fits, false);
});

test('findFittingRemnants: filters by status and sorts by waste ascending', () => {
  const remnants = [
    { id: 'R-001', lengthMm: 600, widthMm: 400, areaMm2: 240000, polygonMm: null, status: 'available' },
    { id: 'R-002', lengthMm: 1000, widthMm: 800, areaMm2: 800000, polygonMm: null, status: 'available' },
    { id: 'R-003', lengthMm: 300, widthMm: 250, areaMm2: 75000, polygonMm: null, status: 'available' },
    { id: 'R-004', lengthMm: 500, widthMm: 300, areaMm2: 150000, polygonMm: null, status: 'used' },
    { id: 'R-005', lengthMm: 450, widthMm: 260, areaMm2: 117000, polygonMm: null }, // no status field -> considered
    L_REMNANT,
  ];
  const need = { lengthMm: 380, widthMm: 240 };
  const res = findFittingRemnants(remnants, need);
  assert.deepEqual(res.map((r) => r.remnant.id), ['R-005', 'R-001', 'R-L', 'R-002']);
  for (let k = 1; k < res.length; k++) assert.ok(res[k - 1].wasteMm2 <= res[k].wasteMm2);
  assert.equal(res[0].wasteMm2, 117000 - 380 * 240);
  assert.ok(res.every((r) => r.placement && typeof r.placement.rotated === 'boolean'));
  assert.equal(res.find((r) => r.remnant.id === 'R-L').wasteMm2, L_AREA - 380 * 240);
  // Options are passed through: with a margin of 40 the 450x260 remnant no longer fits.
  const strict = findFittingRemnants(remnants, need, { marginMm: 40 });
  assert.ok(!strict.some((r) => r.remnant.id === 'R-005'));
  assert.deepEqual(findFittingRemnants([], need), []);
  assert.deepEqual(findFittingRemnants(remnants, { lengthMm: 5000, widthMm: 5000 }), []);
});
