// Measurement of a segmented part in the rectified raster: minAreaRect of the contour, sub-pixel edge
// refinement along the four sides, corner intersections, dimensions in mm. Pure JS except grayView.
// Pixel convention: raster pixel u has its centre at u; an edge lying exactly between pixels k and k+1
// is reported at k + 0.5. Nothing else adds or subtracts half pixels.
import { minAreaRect, fitLineRobust, intersectLines, polygonArea, dist } from './geometry.js';

const PROFILE_STEP_PX = 0.5;   // sampling step along the normal
const KEEP_FRACTION = 0.25;    // samples weaker than this fraction of the side's strongest edge are dropped
const MIN_SIDE_POINTS = 6;
const MAX_SIDE_RMS_PX = 1.5;
const MAX_POLYGON_POINTS = 200;

function badInput(message) {
  return Object.assign(new Error(message), { code: 'BAD_INPUT' });
}

/**
 * Copy a CV_8UC1 Mat into a plain { data, width, height } object.
 * The copy is deliberate: Mat.data is a view into the wasm heap that detaches when the heap grows.
 */
export function grayView(cv, grayMat) {
  if (!grayMat || typeof grayMat.channels !== 'function' || grayMat.empty()) throw badInput('Пустое изображение');
  let src = grayMat;
  const temps = [];
  try {
    if (grayMat.channels() !== 1) {
      const g = new cv.Mat();
      temps.push(g);
      const ch = grayMat.channels();
      cv.cvtColor(grayMat, g, ch === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);
      src = g;
    }
    if (src.type() !== cv.CV_8UC1) {
      const g8 = new cv.Mat();
      temps.push(g8);
      src.convertTo(g8, cv.CV_8U);
      src = g8;
    }
    if (!src.isContinuous()) {
      const c = src.clone();
      temps.push(c);
      src = c;
    }
    const width = src.cols; const height = src.rows;
    const data = new Uint8Array(src.data.subarray(0, width * height));
    return { data, width, height };
  } catch (e) {
    if (typeof e === 'number' && cv && typeof cv.exceptionFromPtr === 'function') {
      const info = cv.exceptionFromPtr(e);
      throw Object.assign(new Error(`Ошибка OpenCV: ${info && info.msg ? info.msg : e}`), { code: 'BAD_INPUT', cause: e });
    }
    throw e;
  } finally {
    for (const m of temps) m.delete();
  }
}

/** Bilinear sample of a gray image at (x, y); coordinates are clamped to the image. */
export function sampleBilinear(gray, x, y) {
  const { data, width, height } = gray;
  if (!(width > 0) || !(height > 0)) return 0;
  if (x < 0) x = 0; else if (x > width - 1) x = width - 1;
  if (y < 0) y = 0; else if (y > height - 1) y = height - 1;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const fx = x - x0; const fy = y - y0;
  const r0 = y0 * width; const r1 = y1 * width;
  const top = data[r0 + x0] * (1 - fx) + data[r0 + x1] * fx;
  const bot = data[r1 + x0] * (1 - fx) + data[r1 + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

// Locate the edge along the outward normal at point p: returns { s, strength } or null.
function locateEdge(gray, px, py, nx, ny, searchPx, sign) {
  const nS = Math.max(5, Math.round(2 * searchPx / PROFILE_STEP_PX) + 1);
  const prof = new Float64Array(nS);
  for (let i = 0; i < nS; i++) {
    const s = -searchPx + i * PROFILE_STEP_PX;
    prof[i] = sampleBilinear(gray, px + s * nx, py + s * ny);
  }
  // 3-tap box smoothing (edges replicate).
  const sm = new Float64Array(nS);
  for (let i = 0; i < nS; i++) {
    const a = prof[i > 0 ? i - 1 : 0]; const b = prof[i]; const c = prof[i < nS - 1 ? i + 1 : nS - 1];
    sm[i] = (a + b + c) / 3;
  }
  // Central derivative (per px) with the requested sign.
  const d = new Float64Array(nS);
  for (let i = 1; i < nS - 1; i++) d[i] = sign * (sm[i + 1] - sm[i - 1]) / (2 * PROFILE_STEP_PX);
  let best = -Infinity; let bi = -1;
  for (let i = 2; i < nS - 2; i++) if (d[i] > best) { best = d[i]; bi = i; }
  if (bi < 0 || !(best > 0)) return null;
  const dm = d[bi - 1]; const d0 = d[bi]; const dp = d[bi + 1];
  const denom = dm - 2 * d0 + dp;
  let delta = 0;
  if (denom < -1e-12) delta = 0.5 * (dm - dp) / denom;
  if (delta > 1) delta = 1; else if (delta < -1) delta = -1;
  const s = -searchPx + (bi + delta) * PROFILE_STEP_PX;
  return { s, strength: best };
}

/**
 * Refine the four sides of a rectangle (corners in raster px, ordered around the rectangle) by
 * locating the brightness edge along the outward normal and fitting a robust line per side.
 */
export function refineRectEdges(gray, cornersRaster, { searchPx, stepPx = 2, endTrimFrac = 0.1, darkInside = true } = {}) {
  const fail = (reason, partial = {}) => ({
    corners: cornersRaster.map((c) => [c[0], c[1]]), lines: [], residualRmsPx: Infinity, pointsUsed: 0, sides: [], ok: false, reason, ...partial,
  });
  if (!gray || !gray.data || !(gray.width > 0) || !(gray.height > 0)) return fail('no image');
  if (!Array.isArray(cornersRaster) || cornersRaster.length !== 4) return fail('need 4 corners');
  const search = Math.max(1.5, Number(searchPx) || 0);
  const step = Math.max(0.5, Number(stepPx) || 2);
  const trim = Math.min(0.45, Math.max(0, Number(endTrimFrac) || 0));
  const sign = darkInside ? 1 : -1;

  let cx = 0; let cy = 0;
  for (const c of cornersRaster) { cx += c[0]; cy += c[1]; }
  cx /= 4; cy /= 4;

  const lines = [];
  const sides = [];
  let sumSq = 0; let pointsUsed = 0;
  for (let k = 0; k < 4; k++) {
    const A = cornersRaster[k]; const B = cornersRaster[(k + 1) % 4];
    const L = dist(A, B);
    if (!(L > 1e-6)) return fail('degenerate side');
    const dx = (B[0] - A[0]) / L; const dy = (B[1] - A[1]) / L;
    let nx = -dy; let ny = dx;
    const mx = (A[0] + B[0]) / 2; const my = (A[1] + B[1]) / 2;
    if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
    const t0 = trim * L; const t1 = L - trim * L;
    const samples = [];
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      const px = A[0] + t * dx; const py = A[1] + t * dy;
      const e = locateEdge(gray, px, py, nx, ny, search, sign);
      if (!e) continue;
      samples.push({ point: [px + e.s * nx, py + e.s * ny], strength: e.strength });
    }
    if (samples.length === 0) return fail('no edge samples', { sides });
    let maxStrength = 0;
    for (const s of samples) if (s.strength > maxStrength) maxStrength = s.strength;
    const kept = samples.filter((s) => s.strength >= KEEP_FRACTION * maxStrength).map((s) => s.point);
    const fit = fitLineRobust(kept, { minPoints: MIN_SIDE_POINTS });
    const side = { n: fit.inliers, rms: fit.rms, sampled: samples.length, kept: kept.length };
    sides.push(side);
    if (!fit.ok || !(fit.rms <= MAX_SIDE_RMS_PX)) return fail(`side ${k}: ${!fit.ok ? 'few points' : 'rms ' + fit.rms.toFixed(2)}`, { sides });
    // Orient the line direction along the original side direction (cosmetic; keeps lines consistent).
    const dir = fit.dir[0] * dx + fit.dir[1] * dy < 0 ? [-fit.dir[0], -fit.dir[1]] : fit.dir.slice();
    lines.push({ point: fit.point.slice(), dir });
    sumSq += fit.rms * fit.rms * fit.inliers;
    pointsUsed += fit.inliers;
  }
  const corners = [];
  for (let k = 0; k < 4; k++) {
    const p = intersectLines(lines[(k + 3) % 4], lines[k]);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return fail('parallel sides', { sides });
    // Guard against wild fits: a refined corner cannot move further than the search window (plus slack).
    if (dist(p, cornersRaster[k]) > 2 * search + 3) return fail('corner moved too far', { sides });
    corners.push(p);
  }
  return {
    corners, lines, residualRmsPx: pointsUsed ? Math.sqrt(sumSq / pointsUsed) : 0, pointsUsed, sides, ok: true,
  };
}

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-18) return dist(p, a);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(L2);
}

// Iterative Douglas-Peucker on an open polyline (indices into pts). Returns kept indices in order.
function douglasPeucker(pts, first, last, eps, keep) {
  const stack = [[first, last]];
  keep[first] = true; keep[last] = true;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = -1; let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpendicularDistance(pts[i], pts[i0], pts[i1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = true;
      stack.push([i0, idx], [idx, i1]);
    }
  }
}

/** Decimate a closed polygon to at most maxPoints vertices (Douglas-Peucker with growing tolerance). */
export function simplifyPolygon(points, maxPoints = MAX_POLYGON_POINTS, epsStart = 0.25) {
  const n = points.length;
  if (n <= maxPoints || n < 4) return points.map((p) => [p[0], p[1]]);
  // Split the ring at the vertex farthest from vertex 0 so both halves are open polylines:
  // [0 .. far] and [far .. n] where index n stands for vertex 0 again (closing edge).
  let far = 1; let farD = -1;
  for (let i = 1; i < n; i++) { const d = dist(points[0], points[i]); if (d > farD) { farD = d; far = i; } }
  const closed = points.concat([points[0]]);
  let eps = epsStart;
  for (let iter = 0; iter < 40; iter++) {
    const keep = new Array(n + 1).fill(false);
    douglasPeucker(closed, 0, far, eps, keep);
    douglasPeucker(closed, far, n, eps, keep);
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push([points[i][0], points[i][1]]);
    if (out.length <= maxPoints) return out;
    eps *= 2;
  }
  // Fallback: uniform subsampling.
  const stride = Math.ceil(n / maxPoints);
  const out = [];
  for (let i = 0; i < n; i += stride) out.push([points[i][0], points[i][1]]);
  return out;
}

function sideLength(c, i, j) { return dist(c[i], c[j]); }

function normalizeAngleDeg(a) {
  a = ((a % 180) + 180) % 180;
  if (a > 90) a -= 180;
  return a;
}

/**
 * Measure one contour (raster px) -> dimensions in mm.
 * grayRaster: { data, width, height } from grayView(); plan from planRaster(); edgeRefine: settings.edgeRefine.
 */
export function measureContour(grayRaster, pointsRaster, plan, { edgeRefine = {} } = {}) {
  if (!Array.isArray(pointsRaster) || pointsRaster.length < 3) throw badInput('Контур слишком мал');
  if (!plan || !(plan.pxPerMm > 0) || typeof plan.rasterToMm !== 'function') throw badInput('Некорректный план растра');
  const er = { enabled: true, searchMm: 3, stepPx: 2, endTrimFrac: 0.1, darkInside: true, ...(edgeRefine || {}) };
  const pxPerMm = plan.pxPerMm;

  const rr = minAreaRect(pointsRaster);
  let corners = rr.corners.map((c) => [c[0], c[1]]);
  let refined = false;
  let refine = null;
  if (er.enabled && grayRaster && grayRaster.data && rr.size.height > 0) {
    const r = refineRectEdges(grayRaster, corners, {
      searchPx: er.searchMm * pxPerMm, stepPx: er.stepPx, endTrimFrac: er.endTrimFrac, darkInside: er.darkInside !== false,
    });
    if (r.ok) {
      corners = r.corners;
      refined = true;
      refine = { residualRmsPx: r.residualRmsPx, pointsUsed: r.pointsUsed, sides: r.sides.map((s) => ({ n: s.n, rms: s.rms })) };
    }
  }
  if (!refined) {
    // Fallback: the contour vertices are pixel centres, while each mask pixel covers ±0.5 px around its
    // centre; expand the rectangle by half a pixel outward so the footprint of the mask is measured.
    const c = corners; const cx = (c[0][0] + c[2][0]) / 2; const cy = (c[0][1] + c[2][1]) / 2;
    corners = c.map((p) => {
      const vx = p[0] - cx; const vy = p[1] - cy; const L = Math.hypot(vx, vy) || 1;
      // Move each corner 0.5 px along both side directions == 0.5*sqrt(2) along the diagonal for a rectangle.
      return [p[0] + (vx / L) * 0.5 * Math.SQRT2, p[1] + (vy / L) * 0.5 * Math.SQRT2];
    });
  }

  const a = (sideLength(corners, 0, 1) + sideLength(corners, 2, 3)) / 2;
  const b = (sideLength(corners, 1, 2) + sideLength(corners, 3, 0)) / 2;
  const lengthMm = Math.max(a, b) / pxPerMm;
  const widthMm = Math.min(a, b) / pxPerMm;
  const longFirst = a >= b;
  const ax = longFirst ? corners[1][0] - corners[0][0] : corners[2][0] - corners[1][0];
  const ay = longFirst ? corners[1][1] - corners[0][1] : corners[2][1] - corners[1][1];
  const angleDeg = normalizeAngleDeg(Math.atan2(ay, ax) * 180 / Math.PI);

  const cornersMm = corners.map((c) => plan.rasterToMm(c[0], c[1]));
  const polygonMm = simplifyPolygon(pointsRaster, MAX_POLYGON_POINTS).map((p) => plan.rasterToMm(p[0], p[1]));
  const areaMm2 = polygonArea(polygonMm);
  const rectArea = lengthMm * widthMm;
  const rectangularity = rectArea > 0 ? areaMm2 / rectArea : 0;

  return {
    lengthMm, widthMm, areaMm2,
    cornersRaster: corners, cornersMm, polygonMm,
    angleDeg, rectangularity, refined, refine,
    minAreaRectRaster: { center: rr.center, size: rr.size, angleDeg: rr.angleDeg, corners: rr.corners },
  };
}
