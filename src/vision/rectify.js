// Rectification: plan a metric raster (mm plane -> pixels) covering the visible part of the table
// and warp the photo onto it. No DOM; OpenCV is passed as `cv`.
// Conventions: H maps target-plane mm -> photo px; pixel (i, j) has its centre at (i, j).
// Raster pixel u (centre) corresponds to mm x = originMm.x + u / pxPerMm (same for v / y).
import { invertHomography, composeHomography, applyHomography } from './geometry.js';
import { targetBoundsMm, DEFAULT_TARGET } from './target.js';

function cvError(cv, e) {
  if (typeof e === 'number' && cv && typeof cv.exceptionFromPtr === 'function') {
    const info = cv.exceptionFromPtr(e);
    return Object.assign(new Error(`Ошибка OpenCV: ${info && info.msg ? info.msg : e}`), { code: 'BAD_INPUT', cause: e });
  }
  return e;
}

/**
 * Plan the raster: working area = projection of the photo corners onto the plane (through H^-1),
 * clipped to +-maxExtentMm around the target; points behind the horizon (w <= 0) are dropped.
 * The target bounds (20 mm margin) are always included.
 */
export function planRaster({ H, imageWidth, imageHeight, target = DEFAULT_TARGET, pxPerMmAtTarget, raster = {} }) {
  if (!Array.isArray(H) || H.length !== 9 || !H.every(Number.isFinite)) {
    throw Object.assign(new Error('Некорректная гомография'), { code: 'BAD_INPUT' });
  }
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    throw Object.assign(new Error('Некорректный размер изображения'), { code: 'BAD_INPUT' });
  }
  const maxPxPerMm = raster.maxPxPerMm > 0 ? raster.maxPxPerMm : 4;
  const maxPixels = raster.maxPixels > 0 ? raster.maxPixels : 10e6;
  const maxExtentMm = raster.maxExtentMm > 0 ? raster.maxExtentMm : 3000;

  const Hinv = invertHomography(H);
  const tb = targetBoundsMm(target, 20);
  let minX = tb.minX; let minY = tb.minY; let maxX = tb.maxX; let maxY = tb.maxY;

  const imgCorners = [
    [-0.5, -0.5], [imageWidth - 0.5, -0.5], [imageWidth - 0.5, imageHeight - 0.5], [-0.5, imageHeight - 0.5],
  ];
  const w = (u, v) => Hinv[6] * u + Hinv[7] * v + Hinv[8];
  // Sign of w at the target centre tells which side of the horizon is "in front of the camera".
  const tcx = (tb.minX + tb.maxX) / 2; const tcy = (tb.minY + tb.maxY) / 2;
  const [tcu, tcv] = applyHomography(H, tcx, tcy);
  const frontSign = w(tcu, tcv) < 0 ? -1 : 1;
  for (const [u, v] of imgCorners) {
    const wc = w(u, v) * frontSign;
    if (!(wc > 1e-12)) continue; // behind the horizon
    const [x, y] = applyHomography(Hinv, u, v);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Clip to the allowed extent around the target.
  minX = Math.max(minX, tb.minX - maxExtentMm); minY = Math.max(minY, tb.minY - maxExtentMm);
  maxX = Math.min(maxX, tb.maxX + maxExtentMm); maxY = Math.min(maxY, tb.maxY + maxExtentMm);

  let pxPerMm = Math.min(pxPerMmAtTarget > 0 ? pxPerMmAtTarget : maxPxPerMm, maxPxPerMm);
  const sizeFor = (s) => ({
    width: Math.max(1, Math.ceil((maxX - minX) * s) + 1),
    height: Math.max(1, Math.ceil((maxY - minY) * s) + 1),
  });
  let { width, height } = sizeFor(pxPerMm);
  for (let guard = 0; guard < 32 && width * height > maxPixels; guard++) {
    pxPerMm *= Math.sqrt(maxPixels / (width * height));
    ({ width, height } = sizeFor(pxPerMm));
  }
  const originMm = { x: minX, y: minY };
  // S: mm -> raster px; M = S * Hinv: photo px -> raster px.
  const S = [pxPerMm, 0, -originMm.x * pxPerMm, 0, pxPerMm, -originMm.y * pxPerMm, 0, 0, 1];
  const M = composeHomography(S, Hinv);
  const Minv = invertHomography(M);
  return {
    pxPerMm,
    originMm,
    width,
    height,
    M,
    Minv,
    boundsMm: { minX, minY, maxX, maxY },
    mmToRaster(x, y) { return [(x - originMm.x) * pxPerMm, (y - originMm.y) * pxPerMm]; },
    rasterToMm(u, v) { return [originMm.x + u / pxPerMm, originMm.y + v / pxPerMm]; },
  };
}

/** Warp the photo (any depth/channels) onto the planned raster. Background is white. Returns a new Mat. */
export function rectify(cv, srcMat, plan, { interpolation = 'linear' } = {}) {
  const interp = interpolation === 'nearest' ? cv.INTER_NEAREST
    : interpolation === 'cubic' ? cv.INTER_CUBIC : cv.INTER_LINEAR;
  let M = null; let dst = null;
  try {
    M = cv.matFromArray(3, 3, cv.CV_64F, plan.M.map(Number));
    dst = new cv.Mat();
    cv.warpPerspective(
      srcMat, dst, M, new cv.Size(plan.width, plan.height),
      interp, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255),
    );
    const out = dst; dst = null;
    return out;
  } catch (e) {
    throw cvError(cv, e);
  } finally {
    if (M) M.delete();
    if (dst) dst.delete();
  }
}
