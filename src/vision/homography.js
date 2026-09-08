// Target-plane homography from ArUco corners and geometry assessment (SPEC 5.2). Pure module.
// H always maps target millimetres -> pixels of the source photo.
import { DEFAULT_TARGET, markerCornersMm, targetPolygonMm } from './target.js';
import {
  applyHomography, invertHomography, normalizeHomography, convexHull, polygonArea, transformPoints, dist,
  estimateFocalFromHomography, decomposePlaneHomography,
} from './geometry.js';
import { cvError } from './aruco.js';

/**
 * buildCorrespondences(markers, target) -> { srcMm, dstPx, ids }
 * Four corners per detected marker whose id belongs to the target; `ids` lists the marker ids
 * in the same order as the 4-point groups in srcMm/dstPx.
 */
export function buildCorrespondences(markers, target = DEFAULT_TARGET) {
  const srcMm = [];
  const dstPx = [];
  const ids = [];
  const seen = new Set();
  for (const m of markers || []) {
    if (!m || seen.has(m.id)) continue;
    const mm = markerCornersMm(target, m.id);
    if (!mm || !Array.isArray(m.corners) || m.corners.length !== 4) continue;
    seen.add(m.id);
    ids.push(m.id);
    for (let k = 0; k < 4; k++) {
      srcMm.push([mm[k][0], mm[k][1]]);
      dstPx.push([m.corners[k][0], m.corners[k][1]]);
    }
  }
  return { srcMm, dstPx, ids };
}

function reprojectionStats(H, srcMm, dstPx) {
  const perPointErrPx = new Array(srcMm.length);
  let ss = 0;
  let max = 0;
  for (let i = 0; i < srcMm.length; i++) {
    const [u, v] = applyHomography(H, srcMm[i][0], srcMm[i][1]);
    const e = Math.hypot(u - dstPx[i][0], v - dstPx[i][1]);
    perPointErrPx[i] = e;
    ss += e * e;
    if (e > max) max = e;
  }
  return { perPointErrPx, reprojRmsPx: srcMm.length ? Math.sqrt(ss / srcMm.length) : 0, reprojMaxPx: max };
}

/**
 * computeHomography(cv, corr, { ransacThreshPx }) ->
 *   { H, Hinv, inliers, reprojRmsPx, reprojMaxPx, perPointErrPx }
 * Throws Error{code:'FEW_MARKERS'} with fewer than 8 points (two markers).
 */
export function computeHomography(cv, corr, { ransacThreshPx = 2 } = {}) {
  const srcMm = (corr && corr.srcMm) || [];
  const dstPx = (corr && corr.dstPx) || [];
  const n = Math.min(srcMm.length, dstPx.length);
  if (n < 8) {
    throw Object.assign(new Error('Найдено меньше двух меток мишени — масштаб не определить'), { code: 'FEW_MARKERS' });
  }
  const srcFlat = new Array(n * 2);
  const dstFlat = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    srcFlat[2 * i] = srcMm[i][0]; srcFlat[2 * i + 1] = srcMm[i][1];
    dstFlat[2 * i] = dstPx[i][0]; dstFlat[2 * i + 1] = dstPx[i][1];
    if (!Number.isFinite(srcFlat[2 * i]) || !Number.isFinite(srcFlat[2 * i + 1])
      || !Number.isFinite(dstFlat[2 * i]) || !Number.isFinite(dstFlat[2 * i + 1])) {
      throw Object.assign(new Error('Некорректные координаты углов меток'), { code: 'BAD_INPUT' });
    }
  }
  let src = null;
  let dst = null;
  let mask = null;
  let Hmat = null;
  try {
    src = cv.matFromArray(n, 1, cv.CV_32FC2, srcFlat);
    dst = cv.matFromArray(n, 1, cv.CV_32FC2, dstFlat);
    mask = new cv.Mat();
    Hmat = cv.findHomography(src, dst, cv.RANSAC, ransacThreshPx, mask);
    let inliers = 0;
    if (!Hmat.empty() && !mask.empty()) {
      const md = mask.data;
      for (let i = 0; i < md.length; i++) if (md[i]) inliers++;
    }
    if (Hmat.empty() || inliers < 4) {
      // RANSAC could not find a consensus (e.g. degenerate configuration): fall back to plain least squares.
      Hmat.delete();
      Hmat = cv.findHomography(src, dst, 0);
      inliers = Hmat.empty() ? 0 : n;
    }
    if (Hmat.empty() || Hmat.rows !== 3 || Hmat.cols !== 3) {
      throw Object.assign(new Error('Мишень читается плохо — переснимите'), { code: 'REPROJ' });
    }
    const raw = Hmat.type() === cv.CV_64F ? Array.from(Hmat.data64F) : Array.from(Hmat.data32F);
    if (raw.some((v) => !Number.isFinite(v)) || Math.abs(raw[8]) < 1e-12) {
      throw Object.assign(new Error('Мишень читается плохо — переснимите'), { code: 'REPROJ' });
    }
    const H = normalizeHomography(raw);
    const Hinv = invertHomography(H);
    const stats = reprojectionStats(H, srcMm.slice(0, n), dstPx.slice(0, n));
    return { H, Hinv, inliers, ...stats };
  } catch (e) {
    throw cvError(cv, e, 'REPROJ', 'Не удалось вычислить гомографию');
  } finally {
    if (Hmat) Hmat.delete();
    if (mask) mask.delete();
    if (dst) dst.delete();
    if (src) src.delete();
  }
}

function collectCornerPx(markers, corr) {
  const pts = [];
  if (Array.isArray(markers) && markers.length) {
    for (const m of markers) {
      if (m && Array.isArray(m.corners)) for (const c of m.corners) pts.push([c[0], c[1]]);
    }
  } else if (corr && Array.isArray(corr.dstPx)) {
    for (const c of corr.dstPx) pts.push([c[0], c[1]]);
  }
  return pts;
}

function meanMarkerSidePx(markers, corr) {
  const groups = [];
  if (Array.isArray(markers) && markers.length) {
    for (const m of markers) if (m && Array.isArray(m.corners) && m.corners.length === 4) groups.push(m.corners);
  } else if (corr && Array.isArray(corr.dstPx)) {
    for (let i = 0; i + 4 <= corr.dstPx.length; i += 4) groups.push(corr.dstPx.slice(i, i + 4));
  }
  let sum = 0;
  let count = 0;
  for (const g of groups) {
    for (let k = 0; k < 4; k++) { sum += dist(g[k], g[(k + 1) % 4]); count++; }
  }
  return count ? sum / count : 0;
}

/**
 * assessGeometry({ H, corr, markers, imageWidth, imageHeight, target }) ->
 *   { tiltDeg, focalPx, focalSource, cameraHeightMm, targetFraction, pxPerMmAtTarget, targetPolygonPx }
 * Principal point is assumed at the image centre ((w-1)/2, (h-1)/2); focal length is self-calibrated
 * from H and falls back to 0.75·max(w, h) when the view is too frontal for a stable estimate.
 */
export function assessGeometry({ H, corr, markers, imageWidth, imageHeight, target = DEFAULT_TARGET }) {
  const w = Number(imageWidth) || 0;
  const h = Number(imageHeight) || 0;
  const cornerPx = collectCornerPx(markers, corr);
  const frameArea = w * h;
  let targetFraction = 0;
  if (cornerPx.length >= 3 && frameArea > 0) {
    const hull = convexHull(cornerPx);
    targetFraction = polygonArea(hull) / frameArea;
  }
  const sideMm = (target.markerSideMm || DEFAULT_TARGET.markerSideMm) * (target.printScale || 1);
  const markerSidePx = meanMarkerSidePx(markers, corr);
  const pxPerMmAtTarget = sideMm > 0 ? markerSidePx / sideMm : 0;

  const out = {
    tiltDeg: null,
    focalPx: null,
    focalSource: 'assumed',
    cameraHeightMm: null,
    targetFraction,
    pxPerMmAtTarget,
    markerSidePx,
    targetPolygonPx: null,
  };
  if (!Array.isArray(H) || H.length !== 9 || H.some((v) => !Number.isFinite(v)) || !(w > 0 && h > 0)) return out;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const assumedF = 0.75 * Math.max(w, h);
  let f = null;
  try { f = estimateFocalFromHomography(H, cx, cy); } catch { f = null; }
  let focalSource = 'estimated';
  if (!Number.isFinite(f) || !(f > 0)) { f = assumedF; focalSource = 'assumed'; }
  let tiltDeg = null;
  let cameraHeightMm = null;
  try {
    const dec = decomposePlaneHomography(H, { f, cx, cy });
    if (Number.isFinite(dec.tiltDeg)) tiltDeg = dec.tiltDeg;
    if (Number.isFinite(dec.cameraHeightMm)) cameraHeightMm = dec.cameraHeightMm;
  } catch { /* leave nulls */ }
  if (tiltDeg === null && focalSource === 'estimated') {
    // Decomposition failed with the estimated focal: retry with the assumed one.
    f = assumedF; focalSource = 'assumed';
    try {
      const dec = decomposePlaneHomography(H, { f, cx, cy });
      if (Number.isFinite(dec.tiltDeg)) tiltDeg = dec.tiltDeg;
      if (Number.isFinite(dec.cameraHeightMm)) cameraHeightMm = dec.cameraHeightMm;
    } catch { /* leave nulls */ }
  }
  let targetPolygonPx = null;
  try {
    targetPolygonPx = transformPoints(H, targetPolygonMm(target));
    if (targetPolygonPx.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) targetPolygonPx = null;
  } catch { targetPolygonPx = null; }
  return { ...out, tiltDeg, focalPx: f, focalSource, cameraHeightMm, targetPolygonPx };
}
