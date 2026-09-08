// Measurement pipeline (SPEC 5.7): photo -> ArUco -> homography -> quality -> rectify -> segment ->
// measure -> thickness correction -> result in mm and photo px. Pure module: OpenCV via `cv`, no DOM.
import { createDetector, imageDataToMat, toGray, cvError } from './aruco.js';
import { buildCorrespondences, computeHomography, assessGeometry } from './homography.js';
import { sharpness, glareFraction, evaluateQuality } from './quality.js';
import { planRaster, rectify } from './rectify.js';
import { segmentParts } from './segment.js';
import { measureContour, grayView } from './measure.js';
import { targetPolygonMm } from './target.js';
import { applyHomography, convexHull, polygonCentroid } from './geometry.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../settings.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function polygonBbox(poly) {
  if (!poly || poly.length === 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  if (!Number.isFinite(minX + minY + maxX + maxY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function safeDelete(m) { if (m) { try { m.delete(); } catch { /* ignore */ } } }

function scaleAbout(points, c, f) {
  return points.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]);
}

function applyThickness(parts, settings, quality) {
  const t = Number(settings.thickness?.thicknessMm) || 0;
  let hs = Number(settings.thickness?.shootHeightMm) || 0;
  let heightSource = hs > 0 ? 'setting' : null;
  if (!(hs > 0) && quality.cameraHeightMm > 0 && quality.focalSource === 'estimated') { hs = quality.cameraHeightMm; heightSource = 'estimated'; }
  const correction = { thicknessMm: t, shootHeightMm: hs > 0 ? hs : 0, heightSource, factor: 1 };
  if (!(t > 0)) return correction;
  if (!(hs > t)) {
    quality.warnings.push({ code: 'THICKNESS_UNKNOWN', message: 'Высота съёмки неизвестна — поправка на толщину не применена', severity: 'warn', value: hs });
    quality.ok = false;
    return correction;
  }
  const f = (hs - t) / hs;
  correction.factor = f;
  for (const p of parts) {
    const c = polygonCentroid(p.cornersMm);
    p.lengthMm *= f; p.widthMm *= f; p.areaMm2 *= f * f;
    p.cornersMm = scaleAbout(p.cornersMm, c, f);
    p.polygonMm = scaleAbout(p.polygonMm, c, f);
  }
  return correction;
}

export function createPipeline(cv) {
  if (!cv || typeof cv.Mat !== 'function') throw Object.assign(new Error('OpenCV не загружен'), { code: 'BAD_INPUT' });
  let detector = null;
  let detectorKey = null;

  function getDetector(target) {
    const key = JSON.stringify([target.dictionary, target.ids]);
    if (!detector || key !== detectorKey) {
      if (detector) detector.dispose();
      detector = createDetector(cv, { target, subpixel: true });
      detectorKey = key;
    }
    return detector;
  }

  function targetRoi(geo, width, height) {
    const bb = polygonBbox(geo.targetPolygonPx);
    if (!bb) return null;
    // Include a little context around the target so edges of the paper count as well.
    const pad = Math.max(bb.width, bb.height) * 0.1;
    return { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad, imageWidth: width, imageHeight: height };
  }

  function analyze(imageData, settingsIn, { onProgress = null } = {}) {
    const settings = mergeSettings(DEFAULT_SETTINGS, settingsIn || {});
    const target = settings.target;
    const timingsMs = {};
    const tStart = now();
    const progress = (s) => { if (onProgress) { try { onProgress(s); } catch { /* ignore */ } } };
    let src = null; let gray = null; let raster = null; let rasterGray = null; let seg = null;
    const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message }, ...extra, timingsMs: { ...timingsMs, total: Math.round(now() - tStart) } });
    try {
      progress('aruco');
      let t0 = now();
      src = imageDataToMat(cv, imageData);
      const width = src.cols; const height = src.rows;
      const image = { width, height };
      const det = getDetector(target).detect(src);
      timingsMs.aruco = Math.round(now() - t0);
      const markers = det.markers;
      const targetInfo = { markersFound: markers.length, ids: markers.map((m) => m.id), markers, rejectedCount: det.rejectedCount };
      if (markers.length < Math.max(2, settings.quality.minMarkers)) {
        const q = evaluateQuality({ markersFound: markers.length }, settings.quality);
        const quality = { warnings: q.warnings, ok: false, markersFound: markers.length };
        return fail(q.fatal ? q.fatal.code : 'FEW_MARKERS', q.fatal ? q.fatal.message : 'Найдено меньше двух меток мишени', { image, target: targetInfo, quality });
      }

      progress('homography');
      t0 = now();
      const corr = buildCorrespondences(markers, target);
      let hom;
      try { hom = computeHomography(cv, corr, { ransacThreshPx: 2 }); } catch (e) {
        return fail(e.code || 'REPROJ', e.message || 'Не удалось вычислить гомографию', { image, target: targetInfo });
      }
      const geo = assessGeometry({ H: hom.H, corr, markers, imageWidth: width, imageHeight: height, target });
      timingsMs.homography = Math.round(now() - t0);

      progress('quality');
      t0 = now();
      gray = toGray(cv, src);
      const sh = sharpness(cv, gray, targetRoi(geo, width, height));
      const glare = glareFraction(cv, gray, { threshold: 250 });
      const metrics = {
        markersFound: markers.length, reprojMaxPx: hom.reprojMaxPx, tiltDeg: geo.tiltDeg, targetFraction: geo.targetFraction,
        sharpnessNormalized: sh.normalized, glareFraction: glare, pxPerMmAtTarget: geo.pxPerMmAtTarget,
      };
      const q = evaluateQuality(metrics, settings.quality);
      const quality = {
        markersFound: markers.length,
        reprojRmsPx: hom.reprojRmsPx, reprojMaxPx: hom.reprojMaxPx, inliers: hom.inliers,
        tiltDeg: geo.tiltDeg, focalPx: geo.focalPx, focalSource: geo.focalSource, cameraHeightMm: geo.cameraHeightMm,
        targetFraction: geo.targetFraction, pxPerMmAtTarget: geo.pxPerMmAtTarget, markerSidePx: geo.markerSidePx,
        sharpness: { laplacianVar: sh.laplacianVar, contrast: sh.contrast, normalized: sh.normalized },
        glareFraction: glare, warnings: q.warnings, ok: q.ok,
      };
      timingsMs.quality = Math.round(now() - t0);
      if (q.fatal) return fail(q.fatal.code, q.fatal.message, { image, target: targetInfo, quality, homography: hom.H, homographyInv: hom.Hinv });

      progress('rectify');
      t0 = now();
      const plan = planRaster({ H: hom.H, imageWidth: width, imageHeight: height, target, pxPerMmAtTarget: geo.pxPerMmAtTarget, raster: settings.raster });
      raster = rectify(cv, src, plan);
      timingsMs.rectify = Math.round(now() - t0);

      progress('segment');
      t0 = now();
      seg = segmentParts(cv, raster, plan, { params: settings.segmentation, exclusionPolygonsMm: [targetPolygonMm(target, 10)] });
      timingsMs.segment = Math.round(now() - t0);

      progress('measure');
      t0 = now();
      rasterGray = toGray(cv, raster);
      const gv = grayView(cv, rasterGray);
      const parts = [];
      for (const c of seg.contours) {
        try {
          const m = measureContour(gv, c.pointsRaster, plan, { edgeRefine: settings.edgeRefine });
          parts.push(m);
        } catch (e) { /* skip degenerate contour */ }
      }
      const correction = applyThickness(parts, settings, quality);
      parts.sort((a, b) => b.areaMm2 - a.areaMm2);
      const outParts = parts.map((p, index) => ({
        index,
        lengthMm: p.lengthMm, widthMm: p.widthMm, areaMm2: p.areaMm2,
        cornersMm: p.cornersMm, cornersPx: p.cornersMm.map(([x, y]) => applyHomography(hom.H, x, y)),
        polygonMm: p.polygonMm, polygonPx: p.polygonMm.map(([x, y]) => applyHomography(hom.H, x, y)),
        angleDeg: p.angleDeg, rectangularity: p.rectangularity, refined: p.refined, refine: p.refine,
      }));
      timingsMs.measure = Math.round(now() - t0);
      timingsMs.total = Math.round(now() - tStart);
      return {
        ok: true,
        image,
        target: targetInfo,
        homography: hom.H, homographyInv: hom.Hinv,
        quality,
        raster: { pxPerMm: plan.pxPerMm, originMm: plan.originMm, width: plan.width, height: plan.height, M: plan.M, boundsMm: plan.boundsMm },
        correction,
        parts: outParts,
        segmentation: seg.info || null,
        timingsMs,
      };
    } catch (e) {
      const err = cvError(cv, e, 'ERROR', 'Ошибка обработки кадра');
      return fail(err.code || 'ERROR', err.message);
    } finally {
      if (seg && seg.mask) safeDelete(seg.mask);
      safeDelete(rasterGray); safeDelete(raster); safeDelete(gray); safeDelete(src);
    }
  }

  function preview(imageData, settingsIn) {
    const settings = mergeSettings(DEFAULT_SETTINGS, settingsIn || {});
    const target = settings.target;
    let src = null; let gray = null;
    try {
      src = imageDataToMat(cv, imageData);
      const width = src.cols; const height = src.rows;
      const det = getDetector(target).detect(src);
      const markers = det.markers;
      let geo = null; let hom = null;
      if (markers.length >= 2) {
        try {
          const corr = buildCorrespondences(markers, target);
          hom = computeHomography(cv, corr, { ransacThreshPx: 2 });
          geo = assessGeometry({ H: hom.H, corr, markers, imageWidth: width, imageHeight: height, target });
        } catch { geo = null; hom = null; }
      }
      gray = toGray(cv, src);
      let roi = null;
      if (markers.length > 0) {
        const pts = markers.flatMap((m) => m.corners);
        const bb = polygonBbox(pts);
        if (bb) { const pad = Math.max(bb.width, bb.height) * 0.15; roi = { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad }; }
      }
      const sh = sharpness(cv, gray, roi);
      const glare = glareFraction(cv, gray, { threshold: 250 });
      const thresholds = { ...settings.quality, sharpnessMin: (settings.quality.sharpnessMin || 0) * 0.5, minPxPerMm: 0 };
      const q = evaluateQuality({
        markersFound: markers.length, reprojMaxPx: hom ? hom.reprojMaxPx : null, tiltDeg: geo ? geo.tiltDeg : null,
        targetFraction: geo ? geo.targetFraction : null, sharpnessNormalized: sh.normalized, glareFraction: glare, pxPerMmAtTarget: null,
      }, thresholds);
      const hints = q.warnings.slice().sort((a, b) => (a.severity === 'fatal' ? 0 : 1) - (b.severity === 'fatal' ? 0 : 1));
      let targetPolygonPx = null;
      if (markers.length >= 1) {
        const hull = convexHull(markers.flatMap((m) => m.corners));
        if (hull.length >= 3) targetPolygonPx = hull;
      }
      return {
        markersFound: markers.length, ids: markers.map((m) => m.id),
        tiltDeg: geo ? geo.tiltDeg : null, targetFraction: geo ? geo.targetFraction : null,
        sharpnessNormalized: sh.normalized, glareFraction: glare, pxPerMmAtTarget: geo ? geo.pxPerMmAtTarget : null,
        hints, ok: hints.length === 0, targetPolygonPx,
      };
    } catch (e) {
      const err = cvError(cv, e, 'ERROR', 'Ошибка предпросмотра');
      return { markersFound: 0, ids: [], tiltDeg: null, targetFraction: null, sharpnessNormalized: null, glareFraction: null, pxPerMmAtTarget: null, hints: [{ code: err.code || 'ERROR', message: err.message, severity: 'fatal' }], ok: false, targetPolygonPx: null };
    } finally {
      safeDelete(gray); safeDelete(src);
    }
  }

  function dispose() {
    if (detector) { detector.dispose(); detector = null; detectorKey = null; }
  }

  return { analyze, preview, dispose };
}
