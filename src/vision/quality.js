// Frame quality metrics and hints (SPEC 5.3). Pure module: OpenCV via `cv`, no DOM.
import { DEFAULT_SETTINGS } from '../settings.js';
import { toGray, cvError } from './aruco.js';

export const HINTS = Object.freeze({
  NO_TARGET: 'Положите мишень в кадр',
  FEW_MARKERS: 'Видно только часть мишени — точность ниже',
  TILT: 'Держите телефон ровнее над столом',
  TOO_SMALL: 'Подойдите ближе',
  BLUR: 'Держите ровнее, кадр смазан',
  GLARE: 'Отвернитесь от окна, блики мешают',
  REPROJ: 'Мишень читается плохо — переснимите',
  LOW_RES: 'Слишком далеко — подойдите ближе',
});

// Clip an { x, y, width, height } ROI to the image; returns null when it is missing or empty.
export function clipRoi(roi, width, height) {
  if (!roi || typeof roi !== 'object') return null;
  const x0 = Math.max(0, Math.floor(Number(roi.x) || 0));
  const y0 = Math.max(0, Math.floor(Number(roi.y) || 0));
  const x1 = Math.min(width, Math.ceil((Number(roi.x) || 0) + (Number(roi.width) || 0)));
  const y1 = Math.min(height, Math.ceil((Number(roi.y) || 0) + (Number(roi.height) || 0)));
  if (!(x1 - x0 >= 3) || !(y1 - y0 >= 3)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Robust range of an 8-bit image from its histogram: percentile(hi) - percentile(lo).
function robustRange(data, lo = 0.05, hi = 0.95) {
  const hist = new Int32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const n = data.length;
  let acc = 0;
  let pLo = -1;
  let pHi = -1;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (pLo < 0 && acc >= lo * n) pLo = v;
    if (pHi < 0 && acc >= hi * n) { pHi = v; break; }
  }
  if (pLo < 0) pLo = 0;
  if (pHi < 0) pHi = 255;
  return { p5: pLo, p95: pHi, contrast: pHi - pLo };
}

/**
 * sharpness(cv, grayMat, roi) -> { laplacianVar, contrast, normalized, ... }
 * Laplacian (3×3, CV_16S) variance over the ROI (clipped to the image; null = whole image).
 * Pixel noise contributes a floor of ~20·σ² to that variance, so the floor is estimated robustly
 * (MAD of the Laplacian over the ROI, which is dominated by flat pixels) and subtracted:
 *   laplacianVar = max(0, rawVar − noiseVar), contrast = p95 − p5 of the ROI histogram,
 *   normalized = laplacianVar / max(contrast, 1)²  (dimensionless, ~edge density × edge sharpness).
 * Recommended ROI: bounding box of the target polygon (dense, high-contrast edges).
 */
export function sharpness(cv, grayMat, roi = null) {
  let gray = null;
  let region = null;
  let view = null;
  let lap = null;
  try {
    gray = toGray(cv, grayMat);
    const rect = clipRoi(roi, gray.cols, gray.rows);
    if (rect && (rect.width < gray.cols || rect.height < gray.rows)) {
      view = gray.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
      region = view.clone();
    } else {
      region = gray;
    }
    lap = new cv.Mat();
    cv.Laplacian(region, lap, cv.CV_16S, 3, 1, 0, cv.BORDER_DEFAULT);
    const d = lap.data16S;
    const n = d.length;
    // Single pass: mean, mean of squares and histogram of |L| (|L| ≤ 4·255 = 1020 for a 3×3 kernel).
    const absHist = new Int32Array(1021);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = d[i];
      sum += v;
      sumSq += v * v;
      absHist[v < 0 ? -v : v]++;
    }
    const mean = n ? sum / n : 0;
    const rawVar = n ? Math.max(0, sumSq / n - mean * mean) : 0;
    // Median of |L| -> Gaussian sigma of the Laplacian noise (MAD estimator, 0.6745 = Φ⁻¹(0.75)).
    let acc = 0;
    let median = 0;
    for (let v = 0; v <= 1020; v++) { acc += absHist[v]; if (acc >= n / 2) { median = v; break; } }
    const noiseSigma = median / 0.6745;
    const noiseVar = Math.min(rawVar, noiseSigma * noiseSigma);
    const laplacianVar = Math.max(0, rawVar - noiseVar);
    const { p5, p95, contrast } = robustRange(region.data);
    const denom = Math.max(contrast, 1);
    const normalized = laplacianVar / (denom * denom);
    return {
      laplacianVar,
      contrast,
      normalized,
      laplacianVarRaw: rawVar,
      noiseVar,
      p5,
      p95,
      roi: rect || { x: 0, y: 0, width: gray.cols, height: gray.rows },
    };
  } catch (e) {
    throw cvError(cv, e, 'BAD_INPUT', 'Не удалось оценить резкость');
  } finally {
    if (lap) lap.delete();
    if (region && region !== gray) region.delete();
    if (view) view.delete();
    if (gray) gray.delete();
  }
}

/**
 * glareFraction(cv, rgbaOrGrayMat, { threshold = 250 }) -> 0..1
 * Fraction of pixels whose brightness (gray for 1-channel input, V = max(R,G,B) for colour input)
 * is ≥ threshold after a 3×3 box denoise (so isolated noisy pixels on white paper do not count).
 */
export function glareFraction(cv, mat, { threshold = 250 } = {}) {
  if (!mat || typeof mat.channels !== 'function' || mat.empty()) {
    throw Object.assign(new Error('Пустое изображение'), { code: 'BAD_INPUT' });
  }
  const temps = [];
  try {
    const ch = mat.channels();
    let bright;
    if (ch === 1) {
      bright = mat;
    } else if (ch === 3 || ch === 4) {
      const planes = new cv.MatVector();
      temps.push(planes);
      cv.split(mat, planes);
      const r = planes.get(0); const g = planes.get(1); const b = planes.get(2);
      temps.push(r, g, b);
      if (ch === 4) { const a = planes.get(3); temps.push(a); }
      const rg = new cv.Mat(); temps.push(rg);
      cv.max(r, g, rg);
      const v = new cv.Mat(); temps.push(v);
      cv.max(rg, b, v);
      bright = v;
    } else {
      throw Object.assign(new Error(`Неподдерживаемое число каналов: ${ch}`), { code: 'BAD_INPUT' });
    }
    if (bright.depth() !== cv.CV_8U) {
      const conv = new cv.Mat(); temps.push(conv);
      const alpha = (bright.depth() === cv.CV_32F || bright.depth() === cv.CV_64F) ? 255 : 1;
      bright.convertTo(conv, cv.CV_8U, alpha, 0);
      bright = conv;
    }
    const smooth = new cv.Mat(); temps.push(smooth);
    cv.blur(bright, smooth, new cv.Size(3, 3), new cv.Point(-1, -1), cv.BORDER_REPLICATE);
    const bin = new cv.Mat(); temps.push(bin);
    // THRESH_BINARY keeps src > thresh; use thresh - 0.5 so that integer values ≥ threshold count.
    cv.threshold(smooth, bin, Math.max(0, Number(threshold) - 0.5), 255, cv.THRESH_BINARY);
    const total = bin.rows * bin.cols;
    return total ? cv.countNonZero(bin) / total : 0;
  } catch (e) {
    throw cvError(cv, e, 'BAD_INPUT', 'Не удалось оценить блики');
  } finally {
    for (let i = temps.length - 1; i >= 0; i--) { try { temps[i].delete(); } catch { /* ignore */ } }
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * evaluateQuality(metrics, thresholds) -> { warnings, fatal, ok }
 * metrics: { markersFound, reprojMaxPx, tiltDeg, targetFraction, sharpnessNormalized, glareFraction, pxPerMmAtTarget }
 * thresholds: settings.quality (missing fields fall back to DEFAULT_SETTINGS.quality).
 * Fatal: markersFound < minMarkers → NO_TARGET (0 markers) / FEW_MARKERS (≥ 1); pxPerMmAtTarget < minPxPerMm → LOW_RES.
 * Warnings: FEW_MARKERS (< fullMarkers), REPROJ, TILT, TOO_SMALL, BLUR, GLARE. Metrics that are missing
 * (null/undefined/NaN) are skipped. Fatal entries are also listed in `warnings` with severity 'fatal'.
 * ok === true only when there is neither a fatal error nor a warning.
 */
export function evaluateQuality(metrics = {}, thresholds = {}) {
  const t = { ...DEFAULT_SETTINGS.quality, ...(thresholds || {}) };
  const m = metrics || {};
  const warnings = [];
  const push = (code, severity, value) => warnings.push({ code, message: HINTS[code], severity, value });

  const markersFound = num(m.markersFound) ?? 0;
  if (markersFound < t.minMarkers) {
    push(markersFound <= 0 ? 'NO_TARGET' : 'FEW_MARKERS', 'fatal', markersFound);
  } else if (markersFound < t.fullMarkers) {
    push('FEW_MARKERS', 'warn', markersFound);
  }
  const pxPerMm = num(m.pxPerMmAtTarget);
  if (markersFound > 0 && pxPerMm !== null && pxPerMm < t.minPxPerMm) push('LOW_RES', 'fatal', pxPerMm);

  const reproj = num(m.reprojMaxPx);
  if (reproj !== null && reproj > t.reprojMaxPx) push('REPROJ', 'warn', reproj);
  const tilt = num(m.tiltDeg);
  if (tilt !== null && tilt > t.tiltMaxDeg) push('TILT', 'warn', tilt);
  const frac = num(m.targetFraction);
  if (markersFound > 0 && frac !== null && frac < t.targetMinFraction) push('TOO_SMALL', 'warn', frac);
  const sharp = num(m.sharpnessNormalized);
  if (sharp !== null && sharp < t.sharpnessMin) push('BLUR', 'warn', sharp);
  const glare = num(m.glareFraction);
  if (glare !== null && glare > t.glareMaxFraction) push('GLARE', 'warn', glare);

  const firstFatal = warnings.find((w) => w.severity === 'fatal') || null;
  const fatal = firstFatal ? { code: firstFatal.code, message: firstFatal.message } : null;
  return { warnings, fatal, ok: fatal === null && warnings.length === 0 };
}
