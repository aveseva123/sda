import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHomography, invertHomography, composeHomography, fitLineTLS, fitLineRobust, intersectLines,
  polygonArea, convexHull, minAreaRect, pointInPolygon, estimateFocalFromHomography, decomposePlaneHomography,
} from '../src/vision/geometry.js';
import { makeHomography, partCornersMm } from '../src/testing/synth.js';

test('homography invert/compose round-trip', () => {
  const H = makeHomography({ widthPx: 1600, heightPx: 1200, pxPerMm: 2, tiltDeg: 25, rollDeg: 10, yawDeg: 5 });
  const Hinv = invertHomography(H);
  const I = composeHomography(H, Hinv);
  const In = I.map((v) => v / I[8]);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(In[i] - (i % 4 === 0 ? 1 : 0)) < 1e-9, `I[${i}]`);
  const [u, v] = applyHomography(H, 100, 50);
  const [x, y] = applyHomography(Hinv, u, v);
  assert.ok(Math.abs(x - 100) < 1e-9 && Math.abs(y - 50) < 1e-9);
});

test('minAreaRect recovers a rotated rectangle', () => {
  const corners = partCornersMm({ x: 300, y: 120, w: 297, h: 210, angleDeg: 33 });
  // add interior/edge points to make sure hull handles them
  const pts = corners.concat([[300, 120], [301, 121]]);
  const rr = minAreaRect(pts);
  assert.ok(Math.abs(rr.size.width - 297) < 1e-6, `width ${rr.size.width}`);
  assert.ok(Math.abs(rr.size.height - 210) < 1e-6, `height ${rr.size.height}`);
  assert.ok(Math.abs(rr.center[0] - 300) < 1e-6 && Math.abs(rr.center[1] - 120) < 1e-6);
  assert.ok(Math.abs(Math.abs(rr.angleDeg) - 33) < 1e-6 || Math.abs(Math.abs(rr.angleDeg) - 147) < 1e-6, `angle ${rr.angleDeg}`);
  assert.equal(rr.corners.length, 4);
  // side 0-1 must be the long side
  const s01 = Math.hypot(rr.corners[1][0] - rr.corners[0][0], rr.corners[1][1] - rr.corners[0][1]);
  assert.ok(Math.abs(s01 - 297) < 1e-6);
  assert.ok(Math.abs(polygonArea(rr.corners) - 297 * 210) < 1e-6);
});

test('minAreaRect of a square-ish cloud and degenerate inputs', () => {
  const rr = minAreaRect([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.ok(Math.abs(rr.size.width - 10) < 1e-9 && Math.abs(rr.size.height - 10) < 1e-9);
  const one = minAreaRect([[3, 4]]);
  assert.equal(one.size.width, 0);
  const none = minAreaRect([]);
  assert.equal(none.corners.length, 0);
});

test('convexHull drops interior points', () => {
  const hull = convexHull([[0, 0], [5, 5], [10, 0], [10, 10], [0, 10], [2, 3]]);
  assert.equal(hull.length, 4);
  assert.ok(pointInPolygon([5, 5], hull));
  assert.ok(!pointInPolygon([11, 5], hull));
});

test('fitLineRobust rejects outliers', () => {
  const pts = [];
  for (let i = 0; i < 60; i++) pts.push([i, 0.5 * i + 3 + (i % 10 === 0 ? 8 : 0)]);
  const f = fitLineRobust(pts);
  assert.ok(f.ok);
  assert.equal(f.inliers, 54);
  const slope = f.dir[1] / f.dir[0];
  assert.ok(Math.abs(slope - 0.5) < 1e-9, `slope ${slope}`);
  assert.ok(f.rms < 1e-9);
  const tls = fitLineTLS(pts);
  assert.ok(tls.rms > 1);
});

test('intersectLines', () => {
  const p = intersectLines({ point: [0, 0], dir: [1, 1] }, { point: [10, 0], dir: [-1, 1] });
  assert.ok(Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 5) < 1e-9);
  assert.equal(intersectLines({ point: [0, 0], dir: [1, 0] }, { point: [0, 1], dir: [1, 0] }), null);
});

test('focal and tilt recovery from a plane homography', () => {
  const w = 1600; const h = 1200; const cx = (w - 1) / 2; const cy = (h - 1) / 2;
  for (const tilt of [15, 25, 35]) {
    const H = makeHomography({ widthPx: w, heightPx: h, pxPerMm: 2.2, tiltDeg: tilt, rollDeg: 12, yawDeg: 20 });
    const f = estimateFocalFromHomography(H, cx, cy);
    assert.ok(f && Math.abs(f - 1200) / 1200 < 0.01, `f=${f} at tilt ${tilt}`);
    const d = decomposePlaneHomography(H, { f, cx, cy });
    assert.ok(Math.abs(d.tiltDeg - tilt) < 0.1, `tilt ${d.tiltDeg} vs ${tilt}`);
    const D = 1200 / 2.2;
    assert.ok(Math.abs(d.cameraHeightMm - D * Math.cos(tilt * Math.PI / 180)) < 1, `height ${d.cameraHeightMm}`);
  }
  const H0 = makeHomography({ widthPx: w, heightPx: h, pxPerMm: 2.2, tiltDeg: 0 });
  const d0 = decomposePlaneHomography(H0, { f: 1200, cx, cy });
  assert.ok(d0.tiltDeg < 0.1);
  assert.ok(Math.abs(d0.cameraHeightMm - 1200 / 2.2) < 0.5);
});
