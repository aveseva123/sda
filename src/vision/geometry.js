// Pure 2D/3D geometry helpers. No DOM, no OpenCV. All angles in degrees unless noted.
// Homographies are 9-element row-major arrays mapping [x, y, 1] -> [u, v, w].

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export function transformPoints(H, pts) {
  return pts.map((p) => applyHomography(H, p[0], p[1]));
}

export function composeHomography(A, B) {
  const C = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[r * 3 + k] * B[k * 3 + c];
      C[r * 3 + c] = s;
    }
  }
  return C;
}

export function invertHomography(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) throw Object.assign(new Error('Вырожденная гомография'), { code: 'BAD_INPUT' });
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

export function normalizeHomography(H) {
  const s = H[8];
  if (!s) return H.slice();
  return H.map((v) => v / s);
}

export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Total least squares line fit (PCA). Returns unit direction and unit normal.
export function fitLineTLS(points) {
  const n = points.length;
  if (n < 2) return { point: points[0] ? points[0].slice() : [0, 0], dir: [1, 0], normal: [0, 1], residuals: [], rms: Infinity };
  let mx = 0; let my = 0;
  for (const p of points) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (const p of points) {
    const dx = p[0] - mx; const dy = p[1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = [Math.cos(theta), Math.sin(theta)];
  const normal = [-dir[1], dir[0]];
  const residuals = points.map((p) => (p[0] - mx) * normal[0] + (p[1] - my) * normal[1]);
  let ss = 0;
  for (const r of residuals) ss += r * r;
  return { point: [mx, my], dir, normal, residuals, rms: Math.sqrt(ss / n) };
}

// Iteratively re-fit, discarding points whose residual exceeds sigmaK * robust sigma.
export function fitLineRobust(points, { iters = 3, sigmaK = 2.5, minPoints = 4, floorSigma = 0.05 } = {}) {
  let current = points.slice();
  let fit = fitLineTLS(current);
  if (current.length < minPoints) return { ...fit, inliers: current.length, ok: false };
  for (let it = 0; it < iters; it++) {
    const absRes = fit.residuals.map(Math.abs).sort((a, b) => a - b);
    const median = absRes[Math.floor(absRes.length / 2)] || 0;
    const sigma = Math.max(1.4826 * median, floorSigma);
    const keep = [];
    for (let k = 0; k < current.length; k++) if (Math.abs(fit.residuals[k]) <= sigmaK * sigma) keep.push(current[k]);
    if (keep.length < minPoints) break;
    if (keep.length === current.length) break;
    current = keep;
    fit = fitLineTLS(current);
  }
  return { ...fit, inliers: current.length, ok: current.length >= minPoints };
}

export function intersectLines(l1, l2) {
  const [px, py] = l1.point; const [dx, dy] = l1.dir;
  const [qx, qy] = l2.point; const [ex, ey] = l2.dir;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((qx - px) * ey - (qy - py) * ex) / denom;
  return [px + t * dx, py + t * dy];
}

export function lineDistance(l, p) {
  const nx = -l.dir[1]; const ny = l.dir[0];
  return (p[0] - l.point[0]) * nx + (p[1] - l.point[1]) * ny;
}

export function polygonArea(pts) {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(pts) {
  const n = pts.length;
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]; const q = pts[(i + 1) % n];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    let mx = 0; let my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    return [mx / n, my / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// Andrew's monotone chain. Returns CCW hull (in a y-up frame; in y-down image frame it is CW visually).
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// Minimum-area bounding rectangle via rotating calipers over the convex hull.
// size.width >= size.height; angleDeg is the direction of the width axis; corners ordered around the rectangle.
export function minAreaRect(points) {
  const hull = convexHull(points);
  if (hull.length === 0) return { center: [0, 0], size: { width: 0, height: 0 }, angleDeg: 0, corners: [] };
  if (hull.length === 1) return { center: hull[0].slice(), size: { width: 0, height: 0 }, angleDeg: 0, corners: [hull[0], hull[0], hull[0], hull[0]] };
  let best = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i]; const b = hull[(i + 1) % n];
    const len = dist(a, b);
    if (len < 1e-12) continue;
    const ux = (b[0] - a[0]) / len; const uy = (b[1] - a[1]) / len;
    const vx = -uy; const vy = ux;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy; const v = p[0] * vx + p[1] * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area - 1e-9) best = { area, ux, uy, vx, vy, minU, maxU, minV, maxV };
  }
  if (!best) return { center: hull[0].slice(), size: { width: 0, height: 0 }, angleDeg: 0, corners: [hull[0], hull[0], hull[0], hull[0]] };
  const { ux, uy, vx, vy, minU, maxU, minV, maxV } = best;
  const toXY = (u, v) => [u * ux + v * vx, u * uy + v * vy];
  let corners = [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
  let w = maxU - minU; let h = maxV - minV;
  let angle = Math.atan2(uy, ux) * 180 / Math.PI;
  if (h > w) {
    // rotate corner order so that side 0-1 is along the longer axis
    corners = [corners[1], corners[2], corners[3], corners[0]];
    [w, h] = [h, w];
    angle += 90;
  }
  angle = ((angle % 180) + 180) % 180;
  if (angle >= 90) angle -= 180;
  const center = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
  return { center, size: { width: w, height: h }, angleDeg: angle, corners };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1]; const xj = poly[j][0]; const yj = poly[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function shiftPrincipalPoint(H, cx, cy) {
  // H' = T^-1 * H, T = [[1,0,cx],[0,1,cy],[0,0,1]]
  return [
    H[0] - cx * H[6], H[1] - cx * H[7], H[2] - cx * H[8],
    H[3] - cy * H[6], H[4] - cy * H[7], H[5] - cy * H[8],
    H[6], H[7], H[8],
  ];
}

// Self-calibration of focal length (square pixels, principal point at (cx, cy)) from a plane homography
// H: plane (mm) -> image (px). Returns null when the view is too frontal for a stable estimate.
export function estimateFocalFromHomography(H, cx, cy) {
  const Hp = shiftPrincipalPoint(H, cx, cy);
  const h1 = [Hp[0], Hp[3], Hp[6]];
  const h2 = [Hp[1], Hp[4], Hp[7]];
  // Scale so that the xy-part has unit-ish magnitude; avoids absolute thresholds
  const s = Math.hypot(h1[0], h1[1], h2[0], h2[1]) / 2 || 1;
  const a = [h1[0] / s, h1[1] / s, h1[2] / s];
  const b = [h2[0] / s, h2[1] / s, h2[2] / s];
  const num1 = -(a[0] * b[0] + a[1] * b[1]);
  const den1 = a[2] * b[2];
  const num2 = (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]);
  const den2 = b[2] * b[2] - a[2] * a[2];
  const D = Math.max(2 * cx, 2 * cy, 1);
  const candidates = [];
  const minDen = 1e-8;
  if (Math.abs(den1) > minDen) {
    const f2 = num1 / den1;
    if (f2 > 0) candidates.push({ f: Math.sqrt(f2), weight: Math.abs(den1) });
  }
  if (Math.abs(den2) > minDen) {
    const f2 = num2 / den2;
    if (f2 > 0) candidates.push({ f: Math.sqrt(f2), weight: Math.abs(den2) });
  }
  const plausible = candidates.filter((c) => c.f > 0.3 * D && c.f < 5 * D);
  if (plausible.length === 0) return null;
  if (plausible.length === 2) {
    const [p, q] = plausible;
    const ratio = p.f / q.f;
    if (ratio > 1.6 || ratio < 1 / 1.6) return plausible.sort((x, y) => y.weight - x.weight)[0].f;
    return (p.f * p.weight + q.f * q.weight) / (p.weight + q.weight);
  }
  return plausible[0].f;
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) { return Math.hypot(a[0], a[1], a[2]); }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Decompose plane homography (plane mm -> image px) into rotation/translation given intrinsics.
// tiltDeg: angle between plane normal and optical axis; cameraHeightMm: distance camera->plane.
export function decomposePlaneHomography(H, { f, cx, cy }) {
  const Hp = shiftPrincipalPoint(H, cx, cy);
  // K^-1 * H'
  const G = [
    Hp[0] / f, Hp[1] / f, Hp[2] / f,
    Hp[3] / f, Hp[4] / f, Hp[5] / f,
    Hp[6], Hp[7], Hp[8],
  ];
  let c1 = [G[0], G[3], G[6]];
  let c2 = [G[1], G[4], G[7]];
  let c3 = [G[2], G[5], G[8]];
  const lambda = 2 / (norm3(c1) + norm3(c2));
  c1 = scale3(c1, lambda); c2 = scale3(c2, lambda); c3 = scale3(c3, lambda);
  if (c3[2] < 0) { c1 = scale3(c1, -1); c2 = scale3(c2, -1); c3 = scale3(c3, -1); }
  let r1 = scale3(c1, 1 / norm3(c1));
  let r3 = cross3(r1, c2);
  r3 = scale3(r3, 1 / norm3(r3));
  const r2 = cross3(r3, r1);
  const t = c3;
  const cosTilt = Math.min(1, Math.abs(r3[2]));
  const tiltDeg = Math.acos(cosTilt) * 180 / Math.PI;
  const cameraHeightMm = Math.abs(dot3(r3, t));
  const R = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  return { tiltDeg, normal: r3, cameraHeightMm, R, t };
}
