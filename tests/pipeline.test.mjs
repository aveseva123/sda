import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCv } from './helpers/cv.mjs';
import { standardScene, partCornersMm, makeHomography, renderScene } from '../src/testing/synth.js';
import { createPipeline } from '../src/vision/pipeline.js';
import { defaultSettings } from '../src/settings.js';
import { applyHomography, polygonCentroid } from '../src/vision/geometry.js';

const W = 1600; const H = 1200; const PXMM = 2.2;
// Layouts fit inside a 1600x1200 frame at 2.2 px/mm with the given scene centres (no part leaves the photo).
const SIX = [
  { x: 295, y: 60, w: 210, h: 120, angleDeg: 0 }, { x: 295, y: 230, w: 100, h: 50, angleDeg: 30 },
  { x: -135, y: 40, w: 140, h: 150, angleDeg: 0 }, { x: -150, y: 230, w: 180, h: 80, angleDeg: -15 },
  { x: 65, y: 345, w: 380, h: 90, angleDeg: 5 }, { x: 315, y: 340, w: 80, h: 40, angleDeg: 60 },
];
const SIX_CENTER = [80, 180];
const A4_CENTER = [230, 105];
const A4 = { x: 330, y: 105, w: 297, h: 210, angleDeg: 12 };

let cv; let pipe;
test.before(async () => { cv = await loadCv(); pipe = createPipeline(cv); });
test.after(() => { if (pipe) pipe.dispose(); });

function nearestPart(parts, truth) {
  const tc = polygonCentroid(partCornersMm(truth));
  let best = null; let bd = Infinity;
  for (const p of parts) { const c = polygonCentroid(p.cornersMm); const d = Math.hypot(c[0] - tc[0], c[1] - tc[1]); if (d < bd) { bd = d; best = p; } }
  return { part: best, distMm: bd };
}

test('A4 sheet at tilt 0 / 20 / 30 measures 297x210 within 0.6-0.8 mm', async () => {
  for (const tiltDeg of [0, 20, 30]) {
    const { H: Ht, image } = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg, rollDeg: 7, centerMm: A4_CENTER, parts: [A4], shadows: true, glare: [{ x: 330, y: 105, rx: 40, ry: 20 }], noise: 3 });
    const r = pipe.analyze(image, defaultSettings());
    assert.ok(r.ok, `ok at tilt ${tiltDeg}: ${JSON.stringify(r.error)}`);
    assert.equal(r.parts.length, 1, `one part at tilt ${tiltDeg}`);
    const p = r.parts[0];
    const tol = tiltDeg >= 30 ? 0.8 : 0.6;
    assert.ok(Math.abs(p.lengthMm - 297) <= tol && Math.abs(p.widthMm - 210) <= tol, `dims ${p.lengthMm.toFixed(2)}x${p.widthMm.toFixed(2)} at tilt ${tiltDeg}`);
    assert.ok(p.refined, 'refined');
    assert.equal(r.target.markersFound, 4);
    assert.ok(Math.abs(r.quality.tiltDeg - tiltDeg) < 1.5, `tilt ${r.quality.tiltDeg} vs ${tiltDeg}`);
    assert.ok(r.quality.reprojRmsPx < 0.5, `reproj rms ${r.quality.reprojRmsPx}`);
    if (tiltDeg >= 20) assert.ok(Math.abs(r.quality.focalPx - 0.75 * W) / (0.75 * W) < 0.05, `focal ${r.quality.focalPx}`);
    if (tiltDeg <= 20) assert.deepEqual(r.quality.warnings.map((w) => w.code), [], `no warnings at tilt ${tiltDeg}: ${JSON.stringify(r.quality.warnings)}`);
    // cornersPx must agree with the true homography
    const truthPx = partCornersMm(A4).map(([x, y]) => applyHomography(Ht, x, y));
    for (const c of p.cornersPx) {
      const d = Math.min(...truthPx.map((t) => Math.hypot(t[0] - c[0], t[1] - c[1])));
      assert.ok(d < 1.5, `cornerPx off by ${d.toFixed(2)} px`);
    }
    console.log(`# [metric] tilt ${tiltDeg}: L=${p.lengthMm.toFixed(2)} W=${p.widthMm.toFixed(2)} tilt=${r.quality.tiltDeg.toFixed(2)} f=${r.quality.focalPx.toFixed(0)} (${r.quality.focalSource}) sharp=${r.quality.sharpness.normalized.toFixed(4)} glare=${r.quality.glareFraction.toFixed(4)} frac=${r.quality.targetFraction.toFixed(3)} timings=${JSON.stringify(r.timingsMs)}`);
  }
});

test('six parts at tilt 15 are all found within 1 mm', async () => {
  const { image } = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 15, centerMm: SIX_CENTER, parts: SIX, shadows: true, noise: 3 });
  const r = pipe.analyze(image, defaultSettings());
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.parts.length, 6);
  for (const t of SIX) {
    const { part, distMm } = nearestPart(r.parts, t);
    assert.ok(distMm < 5, `centroid off ${distMm}`);
    const L = Math.max(t.w, t.h); const Wd = Math.min(t.w, t.h);
    assert.ok(Math.abs(part.lengthMm - L) <= 1 && Math.abs(part.widthMm - Wd) <= 1, `${t.w}x${t.h}: got ${part.lengthMm.toFixed(2)}x${part.widthMm.toFixed(2)}`);
  }
  assert.ok(r.parts.every((p, i) => p.index === i));
  assert.ok(r.parts[0].areaMm2 >= r.parts[1].areaMm2);
  console.log(`# [metric] six parts: timings=${JSON.stringify(r.timingsMs)}`);
});

test('blurred frame warns BLUR while a sharp one does not', async () => {
  const sharpScene = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 10, centerMm: A4_CENTER, parts: [A4], noise: 3 });
  const blurScene = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 10, centerMm: A4_CENTER, parts: [A4], noise: 3, blurSigma: 3 });
  const rs = pipe.analyze(sharpScene.image, defaultSettings());
  const rb = pipe.analyze(blurScene.image, defaultSettings());
  console.log(`# [metric] sharpness sharp=${rs.quality.sharpness.normalized.toFixed(4)} blurred=${rb.quality.sharpness.normalized.toFixed(4)} (threshold ${defaultSettings().quality.sharpnessMin})`);
  assert.ok(rs.ok && !rs.quality.warnings.some((w) => w.code === 'BLUR'), 'sharp has no BLUR');
  assert.ok(rb.quality && rb.quality.warnings.some((w) => w.code === 'BLUR'), `blurred has BLUR: ${JSON.stringify(rb.quality?.warnings)}`);
  assert.ok(rs.quality.sharpness.normalized > 3 * rb.quality.sharpness.normalized, 'sharp >> blurred');
});

test('no target in frame -> NO_TARGET; glare and tilt warnings; two markers only', async () => {
  const Hfar = makeHomography({ widthPx: W, heightPx: H, pxPerMm: PXMM, centerMm: [3000, 3000] });
  const none = renderScene({ widthPx: W, heightPx: H, H: Hfar, parts: [{ x: 3000, y: 3000, w: 200, h: 100, angleDeg: 0 }], paper: false });
  const r0 = pipe.analyze(none, defaultSettings());
  assert.equal(r0.ok, false);
  assert.equal(r0.error.code, 'NO_TARGET');

  const glareScene = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 5, centerMm: A4_CENTER, parts: [A4], glare: [{ x: 330, y: 105, rx: 140, ry: 100 }] });
  const rg = pipe.analyze(glareScene.image, defaultSettings());
  assert.ok(rg.quality.glareFraction > 0.005, `glare fraction ${rg.quality.glareFraction}`);

  const tiltScene = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 45, centerMm: A4_CENTER, parts: [A4] });
  const rt = pipe.analyze(tiltScene.image, defaultSettings());
  assert.ok(rt.quality && rt.quality.warnings.some((w) => w.code === 'TILT'), `TILT warning: ${JSON.stringify(rt.quality?.warnings)}`);

  // Only markers id0 and id1 visible: shift the target so the lower markers fall outside the frame
  const two = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 0, parts: [{ x: 330, y: 0, w: 200, h: 100, angleDeg: 0 }], centerMm: [65, -150] });
  const r2 = pipe.analyze(two.image, defaultSettings());
  assert.ok(r2.ok, JSON.stringify(r2.error));
  assert.equal(r2.target.markersFound, 2);
  assert.ok(r2.quality.warnings.some((w) => w.code === 'FEW_MARKERS'));
  assert.equal(r2.parts.length, 1);
  assert.ok(Math.abs(r2.parts[0].lengthMm - 200) < 3 && Math.abs(r2.parts[0].widthMm - 100) < 3, `two-marker dims (reduced accuracy expected) ${r2.parts[0].lengthMm}x${r2.parts[0].widthMm}`);
});

test('thickness correction scales dimensions by (H - t) / H', async () => {
  const { image } = standardScene({ widthPx: W, heightPx: H, pxPerMm: PXMM, tiltDeg: 10, centerMm: A4_CENTER, parts: [A4] });
  const base = pipe.analyze(image, defaultSettings());
  const s = defaultSettings(); s.thickness = { thicknessMm: 3, shootHeightMm: 600 };
  const corr = pipe.analyze(image, s);
  assert.ok(base.ok && corr.ok);
  assert.ok(Math.abs(corr.correction.factor - 597 / 600) < 1e-9);
  assert.ok(Math.abs(corr.parts[0].lengthMm - base.parts[0].lengthMm * 597 / 600) < 1e-6);
  assert.ok(Math.abs(corr.parts[0].areaMm2 - base.parts[0].areaMm2 * (597 / 600) ** 2) < 1e-3);
  // auto height from the homography when the focal was estimated (tilt 10 -> estimated)
  const s2 = defaultSettings(); s2.thickness = { thicknessMm: 3, shootHeightMm: 0 };
  const auto = pipe.analyze(image, s2);
  assert.ok(auto.ok);
  if (auto.quality.focalSource === 'estimated') {
    assert.equal(auto.correction.heightSource, 'estimated');
    assert.ok(auto.correction.factor < 1 && auto.correction.factor > 0.98);
  } else {
    assert.ok(auto.quality.warnings.some((w) => w.code === 'THICKNESS_UNKNOWN'));
  }
});

test('preview on a 640x480 frame is fast and finds the target', async () => {
  const { image } = standardScene({ widthPx: 640, heightPx: 480, pxPerMm: 0.88, tiltDeg: 12, centerMm: A4_CENTER, parts: [A4], noise: 3 });
  pipe.preview(image, defaultSettings()); // warm-up
  const t0 = performance.now();
  const pv = pipe.preview(image, defaultSettings());
  const dt = performance.now() - t0;
  assert.equal(pv.markersFound, 4);
  assert.ok(pv.targetPolygonPx && pv.targetPolygonPx.length >= 4);
  assert.ok(Math.abs(pv.tiltDeg - 12) < 3, `preview tilt ${pv.tiltDeg}`);
  assert.ok(pv.ok, `preview ok: ${JSON.stringify(pv.hints)}`);
  console.log(`# [metric] preview ${dt.toFixed(0)} ms, sharpness ${pv.sharpnessNormalized.toFixed(4)}`);
  assert.ok(dt < 400, `preview took ${dt} ms`);
  const empty = pipe.preview(renderScene({ widthPx: 640, heightPx: 480, H: makeHomography({ widthPx: 640, heightPx: 480, pxPerMm: 0.88, centerMm: [3000, 3000] }), paper: false, parts: [] }), defaultSettings());
  assert.equal(empty.markersFound, 0);
  assert.equal(empty.hints[0].code, 'NO_TARGET');
});
