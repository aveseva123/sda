// Segmentation of dark flat parts on a light background in the rectified (metric) raster.
// No DOM; OpenCV is passed as `cv`. Every Mat created here is deleted except the returned mask.
//
// Pipeline (SPEC 5.5): gray + HSV -> background = (V >= bgMinV && S <= bgMaxS) -> candidate = !background
// -> optional Otsu darkness test inside candidates -> MORPH_CLOSE (ellipse, closeKernelMm) -> hole fill
// -> zero exclusion polygons (target) and a border band -> external contours filtered by area / min side.

const DEFAULT_PARAMS = Object.freeze({
  bgMinV: 140,
  bgMaxS: 70,
  closeKernelMm: 12,
  minAreaMm2: 400,
  minSideMm: 15,
  borderMarginMm: 3,
  useOtsu: true,
});

// Otsu is applied only when the candidate histogram is clearly bimodal (mode separation vs. spread)
// and the threshold is never allowed below OTSU_FLOOR so that dark parts next to darker marker blobs
// are not thrown away when Otsu splits "black" from "dark grey".
const OTSU_FLOOR = 100;
const OTSU_MIN_PIXELS = 64;
const OTSU_SEPARATION = 2.5;

function cvError(cv, e) {
  if (typeof e === 'number' && cv && typeof cv.exceptionFromPtr === 'function') {
    const info = cv.exceptionFromPtr(e);
    return Object.assign(new Error(`Ошибка OpenCV: ${info && info.msg ? info.msg : e}`), { code: 'BAD_INPUT', cause: e });
  }
  return e;
}

function badInput(message) {
  return Object.assign(new Error(message), { code: 'BAD_INPUT' });
}

function oddKernelSize(px) {
  let k = Math.round(px);
  if (k < 3) k = 3;
  if (k % 2 === 0) k += 1;
  return k;
}

/** Otsu threshold over a 256-bin histogram. Dark class = value <= threshold. */
export function otsuFromHistogram(hist) {
  let total = 0; let sumAll = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sumAll += i * hist[i]; }
  if (total === 0) return { threshold: 0, total: 0, separation: 0, mu0: 0, mu1: 0, sigma0: 0, sigma1: 0 };
  let w0 = 0; let sum0 = 0; let best = -1; let threshold = 0;
  for (let t = 0; t < 255; t++) {
    w0 += hist[t]; sum0 += t * hist[t];
    if (w0 === 0) continue;
    const w1 = total - w0;
    if (w1 === 0) break;
    const mu0 = sum0 / w0; const mu1 = (sumAll - sum0) / w1;
    const sb = w0 * w1 * (mu0 - mu1) * (mu0 - mu1);
    if (sb > best) { best = sb; threshold = t; }
  }
  // Class statistics at the chosen threshold (used to judge bimodality).
  let n0 = 0; let s0 = 0; let q0 = 0; let n1 = 0; let s1 = 0; let q1 = 0;
  for (let i = 0; i < 256; i++) {
    const h = hist[i];
    if (!h) continue;
    if (i <= threshold) { n0 += h; s0 += i * h; q0 += i * i * h; } else { n1 += h; s1 += i * h; q1 += i * i * h; }
  }
  const mu0 = n0 ? s0 / n0 : 0; const mu1 = n1 ? s1 / n1 : 0;
  const sigma0 = n0 ? Math.sqrt(Math.max(0, q0 / n0 - mu0 * mu0)) : 0;
  const sigma1 = n1 ? Math.sqrt(Math.max(0, q1 / n1 - mu1 * mu1)) : 0;
  const separation = (mu1 - mu0) / (sigma0 + sigma1 + 1e-9);
  return { threshold, total, separation, mu0, mu1, sigma0, sigma1, n0, n1 };
}

function grayAndHsv(cv, src) {
  const ch = src.channels();
  const gray = new cv.Mat();
  const hsv = new cv.Mat();
  let rgb = null;
  try {
    if (ch === 4) {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      rgb = new cv.Mat();
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    } else if (ch === 3) {
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
      cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);
    } else if (ch === 1) {
      src.copyTo(gray);
      // Synthesise HSV from gray: H = 0, S = 0, V = gray.
      const zeros = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);
      const mv = new cv.MatVector();
      try {
        mv.push_back(zeros); mv.push_back(zeros); mv.push_back(gray);
        cv.merge(mv, hsv);
      } finally { mv.delete(); zeros.delete(); }
    } else {
      throw badInput('Растр должен иметь 1, 3 или 4 канала');
    }
  } finally {
    if (rgb) rgb.delete();
  }
  return { gray, hsv };
}

/**
 * Segment parts in the rectified raster.
 * @returns {{ mask: cv.Mat, contours: Array<{ pointsRaster:number[][], areaRaster:number, bboxRaster:{x,y,width,height} }>, info: object }}
 */
export function segmentParts(cv, rasterRgba, plan, { params = {}, exclusionPolygonsMm = [] } = {}) {
  if (!rasterRgba || typeof rasterRgba.channels !== 'function' || rasterRgba.empty()) throw badInput('Пустой растр');
  if (!plan || !(plan.pxPerMm > 0) || typeof plan.mmToRaster !== 'function') throw badInput('Некорректный план растра');
  const p = { ...DEFAULT_PARAMS, ...(params || {}) };
  const pxPerMm = plan.pxPerMm;
  const rows = rasterRgba.rows; const cols = rasterRgba.cols;

  const temps = [];
  const track = (m) => { temps.push(m); return m; };
  let mask = null;
  try {
    const { gray, hsv } = grayAndHsv(cv, rasterRgba);
    track(gray); track(hsv);

    // Background: bright and unsaturated.
    const bg = track(new cv.Mat());
    const low = track(cv.matFromArray(1, 3, cv.CV_8UC1, [0, 0, Math.max(0, Math.min(255, Math.round(p.bgMinV)))]));
    const high = track(cv.matFromArray(1, 3, cv.CV_8UC1, [180, Math.max(0, Math.min(255, Math.round(p.bgMaxS))), 255]));
    cv.inRange(hsv, low, high, bg);
    const candidate = track(new cv.Mat());
    cv.bitwise_not(bg, candidate);

    const info = { candidatePixels: 0, otsuThreshold: null, otsuApplied: false, otsuSeparation: null, kernelPx: 0, borderPx: 0, rejected: 0 };
    let dark = candidate;
    if (p.useOtsu) {
      // Histogram of gray restricted to candidate pixels (views taken right before the loop: no allocations inside).
      const hist = new Float64Array(256);
      const g = gray.data; const c = candidate.data;
      const n = rows * cols;
      let count = 0;
      for (let i = 0; i < n; i++) if (c[i]) { hist[g[i]]++; count++; }
      info.candidatePixels = count;
      if (count >= OTSU_MIN_PIXELS) {
        const o = otsuFromHistogram(hist);
        info.otsuThreshold = o.threshold;
        info.otsuSeparation = o.separation;
        if (o.separation >= OTSU_SEPARATION && o.n1 > 0) {
          const tEff = Math.max(o.threshold, OTSU_FLOOR);
          const darkMat = track(new cv.Mat());
          cv.threshold(gray, darkMat, tEff, 255, cv.THRESH_BINARY_INV); // 255 where gray <= tEff
          const both = track(new cv.Mat());
          cv.bitwise_and(candidate, darkMat, both);
          dark = both;
          info.otsuApplied = true;
          info.otsuThreshold = tEff;
        }
      }
    } else {
      info.candidatePixels = cv.countNonZero(candidate);
    }

    // Morphological close to bridge small gaps (glare edges, texture) and heal thin cracks.
    // A rectangular kernel is separable in OpenCV (O(1) per pixel via van Herk/Gil-Werman); an elliptical
    // kernel of the same size costs O(k^2) per pixel and took ~2 s per dilate/erode on a 5 MP raster.
    const kPx = oddKernelSize(p.closeKernelMm * pxPerMm);
    info.kernelPx = kPx;
    const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kPx, kPx)));
    const closed = track(new cv.Mat());
    cv.morphologyEx(dark, closed, cv.MORPH_CLOSE, kernel);

    // Hole fill: paint every external contour solid.
    mask = cv.Mat.zeros(rows, cols, cv.CV_8UC1);
    {
      const cs = new cv.MatVector(); const hier = new cv.Mat();
      try {
        cv.findContours(closed, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        if (cs.size() > 0) cv.drawContours(mask, cs, -1, new cv.Scalar(255), cv.FILLED);
      } finally { cs.delete(); hier.delete(); }
    }

    // Exclusion polygons (target zone etc.), given in mm.
    for (const poly of exclusionPolygonsMm || []) {
      if (!Array.isArray(poly) || poly.length < 3) continue;
      const flat = [];
      for (const [x, y] of poly) {
        const [u, v] = plan.mmToRaster(x, y);
        if (!Number.isFinite(u) || !Number.isFinite(v)) { flat.length = 0; break; }
        flat.push(Math.round(u), Math.round(v));
      }
      if (flat.length < 6) continue;
      const pts = cv.matFromArray(flat.length / 2, 1, cv.CV_32SC2, flat);
      const mv = new cv.MatVector();
      try {
        mv.push_back(pts);
        cv.fillPoly(mask, mv, new cv.Scalar(0));
      } finally { mv.delete(); pts.delete(); }
    }

    // Border band.
    const band = Math.min(Math.ceil(Math.max(0, p.borderMarginMm) * pxPerMm), Math.floor(Math.min(rows, cols) / 2));
    info.borderPx = band;
    if (band > 0) {
      const rects = [
        new cv.Rect(0, 0, cols, band), new cv.Rect(0, rows - band, cols, band),
        new cv.Rect(0, 0, band, rows), new cv.Rect(cols - band, 0, band, rows),
      ];
      for (const r of rects) { const roi = mask.roi(r); try { roi.setTo(new cv.Scalar(0)); } finally { roi.delete(); } }
    }

    // External contours, filtered.
    const minArea = p.minAreaMm2 * pxPerMm * pxPerMm;
    const minSide = p.minSideMm * pxPerMm;
    const contours = [];
    const cs = new cv.MatVector(); const hier = new cv.Mat();
    try {
      cv.findContours(mask, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const count = cs.size();
      for (let i = 0; i < count; i++) {
        const c = cs.get(i);
        try {
          const area = cv.contourArea(c);
          if (area < minArea) { info.rejected++; continue; }
          const rr = cv.minAreaRect(c);
          if (Math.min(rr.size.width, rr.size.height) < minSide) { info.rejected++; continue; }
          const br = cv.boundingRect(c);
          const d = c.data32S;
          const pts = new Array(d.length / 2);
          for (let k = 0; k < pts.length; k++) pts[k] = [d[2 * k], d[2 * k + 1]];
          contours.push({ pointsRaster: pts, areaRaster: area, bboxRaster: { x: br.x, y: br.y, width: br.width, height: br.height } });
        } finally { c.delete(); }
      }
    } finally { cs.delete(); hier.delete(); }
    contours.sort((a, b) => b.areaRaster - a.areaRaster);

    const out = mask; mask = null;
    return { mask: out, contours, info };
  } catch (e) {
    throw cvError(cv, e);
  } finally {
    for (const m of temps) { try { m.delete(); } catch { /* ignore */ } }
    if (mask) { try { mask.delete(); } catch { /* ignore */ } }
  }
}
