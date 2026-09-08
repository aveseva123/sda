// Remnant fitting (SPEC 8): can a rectangular part `need` be cut from a remnant? Pure JS, no DOM.
//
// Rectangular remnants (no polygon, or polygon area >= 97% of its lengthMm x widthMm box) are checked
// by bounding box in both orientations. Other remnants are checked by rasterising the polygon (cell is
// "inside" when its centre is inside the polygon, even-odd rule identical to geometry.pointInPolygon)
// at every angle 0, step, ..., < 180 and sliding the part window (need + margin, both orientations)
// over a summed-area table.
//
// placement = { angleDeg, xMm, yMm, rotated }: the part is a rectangle centred at (xMm, yMm) in the
// remnant frame (polygon coordinates, or the L x W box with origin at its corner for 'bbox'); its
// first side (need.lengthMm, or need.widthMm when rotated) runs along direction angleDeg (0..180,
// degrees, Y down as in the polygon frame), the other side perpendicular to it.
import { polygonArea, minAreaRect } from '../vision/geometry.js';

const DEG = Math.PI / 180;
const RECT_RATIO = 0.97;
const MAX_CELLS = 4e6;
const EPS = 1e-6;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

function validPolygon(poly) {
  return Array.isArray(poly) && poly.length >= 3 && poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// Dimensions/area of a remnant, deriving missing fields from the polygon when possible.
function remnantDims(remnant) {
  const poly = validPolygon(remnant && remnant.polygonMm) ? remnant.polygonMm : null;
  let L = num(remnant && remnant.lengthMm);
  let W = num(remnant && remnant.widthMm);
  let area = num(remnant && remnant.areaMm2);
  if (poly && (!Number.isFinite(L) || !Number.isFinite(W))) {
    const r = minAreaRect(poly);
    L = r.size.width; W = r.size.height;
  }
  if (!Number.isFinite(area)) area = poly ? polygonArea(poly) : (Number.isFinite(L) && Number.isFinite(W) ? L * W : NaN);
  return { poly, L, W, area };
}

export function remnantAreaMm2(remnant) {
  return remnantDims(remnant).area;
}

function isRectangular(dims) {
  if (!dims.poly) return true;
  const box = dims.L * dims.W;
  if (!(box > 0) || !Number.isFinite(dims.area)) return false;
  return dims.area / box >= RECT_RATIO;
}

// Rasterise a polygon into a boolean grid (Uint8Array, row-major) with cell size `res`.
// A cell is inside when its centre is inside the polygon (even-odd rule, same half-open convention
// as geometry.pointInPolygon), computed by scanline so the cost is O(rows * edges + cells).
export function rasterizePolygon(poly, res) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cols = Math.max(0, Math.ceil((maxX - minX) / res - 1e-9));
  const rows = Math.max(0, Math.ceil((maxY - minY) / res - 1e-9));
  const grid = new Uint8Array(cols * rows);
  const n = poly.length;
  const xs = [];
  for (let j = 0; j < rows; j++) {
    const yc = minY + (j + 0.5) * res;
    xs.length = 0;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const xi = poly[i][0]; const yi = poly[i][1]; const xk = poly[k][0]; const yk = poly[k][1];
      if ((yi > yc) !== (yk > yc)) xs.push((xk - xi) * (yc - yi) / (yk - yi) + xi);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const rowBase = j * cols;
    for (let s = 0; s + 1 < xs.length; s += 2) {
      // Cells whose centre xc satisfies xs[s] <= xc < xs[s+1] (centre strictly left of an odd number of crossings).
      let i0 = Math.ceil((xs[s] - minX) / res - 0.5);
      let i1 = Math.ceil((xs[s + 1] - minX) / res - 0.5);
      if (i0 < 0) i0 = 0;
      if (i1 > cols) i1 = cols;
      for (let i = i0; i < i1; i++) grid[rowBase + i] = 1;
    }
  }
  return { grid, cols, rows, minX, minY, res };
}

function rotatePolygon(poly, angleDeg) {
  const c = Math.cos(angleDeg * DEG); const s = Math.sin(angleDeg * DEG);
  return poly.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// Summed-area table of a 0/1 grid: S[(j)*(cols+1)+i] = sum over cells [0,i) x [0,j).
function summedArea(grid, cols, rows) {
  const stride = cols + 1;
  const S = new Int32Array(stride * (rows + 1));
  for (let j = 0; j < rows; j++) {
    let rowSum = 0;
    const gBase = j * cols;
    const sBase = (j + 1) * stride;
    const pBase = j * stride;
    for (let i = 0; i < cols; i++) {
      rowSum += grid[gBase + i];
      S[sBase + i + 1] = S[pBase + i + 1] + rowSum;
    }
  }
  return S;
}

// First window of ww x wh cells fully inside the grid, or null. Returns cell origin [i, j].
function findFullWindow(S, cols, rows, ww, wh) {
  if (ww <= 0 || wh <= 0 || ww > cols || wh > rows) return null;
  const stride = cols + 1;
  const full = ww * wh;
  for (let j = 0; j + wh <= rows; j++) {
    const top = j * stride; const bot = (j + wh) * stride;
    for (let i = 0; i + ww <= cols; i++) {
      const sum = S[bot + i + ww] - S[top + i + ww] - S[bot + i] + S[top + i];
      if (sum === full) return [i, j];
    }
  }
  return null;
}

function normAngle(a) {
  let r = a % 180;
  if (r < 0) r += 180;
  if (Math.abs(r) < 1e-9 || Math.abs(r - 180) < 1e-9) r = 0;
  return r;
}

export function fitsInRemnant(remnant, need, { marginMm = 5, resolutionMm = 5, angleStepDeg = 15 } = {}) {
  const needL = num(need && need.lengthMm); const needW = num(need && need.widthMm);
  const dims = remnantDims(remnant);
  const margin = Number.isFinite(marginMm) && marginMm >= 0 ? marginMm : 5;
  const rectangular = isRectangular(dims);
  if (!(needL > 0) || !(needW > 0)) return { fits: false, method: rectangular ? 'bbox' : 'raster', placement: null };

  const reqL = needL + 2 * margin;
  const reqW = needW + 2 * margin;

  if (rectangular) {
    const { L, W } = dims;
    if (!(L > 0) || !(W > 0)) return { fits: false, method: 'bbox', placement: null };
    // EPS absorbs floating-point noise of dimensions derived from rotated polygons (599.9999 vs 600).
    if (reqL <= L + EPS && reqW <= W + EPS) {
      return { fits: true, method: 'bbox', placement: { angleDeg: 0, xMm: margin + needL / 2, yMm: margin + needW / 2, rotated: false } };
    }
    if (reqW <= L + EPS && reqL <= W + EPS) {
      return { fits: true, method: 'bbox', placement: { angleDeg: 0, xMm: margin + needW / 2, yMm: margin + needL / 2, rotated: true } };
    }
    return { fits: false, method: 'bbox', placement: null };
  }

  // Raster method.
  const poly = dims.poly;
  if (Number.isFinite(dims.area) && needL * needW > dims.area) return { fits: false, method: 'raster', placement: null };
  let res = Number.isFinite(resolutionMm) && resolutionMm > 0 ? resolutionMm : 5;
  const step = Number.isFinite(angleStepDeg) && angleStepDeg > 0 ? angleStepDeg : 180;
  // Guard against huge grids: coarsen the resolution so the (diagonal) bounding box fits MAX_CELLS.
  {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of poly) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const diag = Math.hypot(maxX - minX, maxY - minY);
    const cells = (diag / res) * (diag / res);
    if (cells > MAX_CELLS) res = diag / Math.sqrt(MAX_CELLS);
  }
  const wwL = Math.ceil(reqL / res - 1e-9);
  const whW = Math.ceil(reqW / res - 1e-9);

  for (let angle = 0; angle < 180 - 1e-9; angle += step) {
    const rp = rotatePolygon(poly, angle);
    const r = rasterizePolygon(rp, res);
    if (r.cols === 0 || r.rows === 0) continue;
    const smallSide = Math.min(wwL, whW); const bigSide = Math.max(wwL, whW);
    if (smallSide > Math.min(r.cols, r.rows) || bigSide > Math.max(r.cols, r.rows)) continue;
    const S = summedArea(r.grid, r.cols, r.rows);
    for (const rotated of [false, true]) {
      const ww = rotated ? whW : wwL;
      const wh = rotated ? wwL : whW;
      const win = findFullWindow(S, r.cols, r.rows, ww, wh);
      if (!win) continue;
      // Window centre in the rotated frame -> back to the polygon frame (rotate by -angle).
      const cxR = r.minX + (win[0] + ww / 2) * res;
      const cyR = r.minY + (win[1] + wh / 2) * res;
      const c = Math.cos(-angle * DEG); const s = Math.sin(-angle * DEG);
      const xMm = cxR * c - cyR * s;
      const yMm = cxR * s + cyR * c;
      return { fits: true, method: 'raster', placement: { angleDeg: normAngle(-angle), xMm, yMm, rotated } };
    }
  }
  return { fits: false, method: 'raster', placement: null };
}

// Corners of a placed part in the remnant frame (helper for drawing / verification).
export function placementCorners(need, placement) {
  const w = placement.rotated ? need.widthMm : need.lengthMm;
  const h = placement.rotated ? need.lengthMm : need.widthMm;
  const c = Math.cos(placement.angleDeg * DEG); const s = Math.sin(placement.angleDeg * DEG);
  const dx = [c, s]; const dy = [-s, c];
  const out = [];
  for (const [a, b] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
    out.push([placement.xMm + a * dx[0] + b * dy[0], placement.yMm + a * dx[1] + b * dy[1]]);
  }
  return out;
}

export function findFittingRemnants(remnants, need, opts = {}) {
  const list = Array.isArray(remnants) ? remnants : [];
  const needArea = num(need && need.lengthMm) * num(need && need.widthMm);
  const out = [];
  for (const remnant of list) {
    if (!remnant) continue;
    if (remnant.status !== undefined && remnant.status !== 'available') continue;
    const r = fitsInRemnant(remnant, need, opts);
    if (!r.fits) continue;
    const area = remnantAreaMm2(remnant);
    const wasteMm2 = Number.isFinite(area) ? area - needArea : Infinity;
    out.push({ remnant, placement: r.placement, wasteMm2 });
  }
  out.sort((a, b) => (a.wasteMm2 - b.wasteMm2) || String(a.remnant.id || '').localeCompare(String(b.remnant.id || '')));
  return out;
}
