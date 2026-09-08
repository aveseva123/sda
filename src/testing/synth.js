// Synthetic scene renderer: ArUco target + dark rectangular parts on a light plate seen through a
// perspective camera. Pure JS (no DOM, no OpenCV) so it runs in Node tests and in the in-app test mode.
import { DICT_4X4_50 } from '../data/dict4x4_50.js';
import { DEFAULT_TARGET, markerCentersMm, targetBoundsMm } from '../vision/target.js';
import { invertHomography, composeHomography } from '../vision/geometry.js';

export { DICT_4X4_50 };

const DEG = Math.PI / 180;

function rotX(a) { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(a) { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mul3(A, B) { return composeHomography(A, B); }

// Build a homography (plane mm -> image px) for a camera looking at the plane.
// pxPerMm is the scale at the plane point centerMm (which projects to the image centre).
export function makeHomography({
  widthPx, heightPx, pxPerMm, tiltDeg = 0, rollDeg = 0, yawDeg = 0, centerMm = [65, 105], focalPx = null,
  offsetPx = [0, 0],
}) {
  const f = focalPx || 0.75 * Math.max(widthPx, heightPx);
  const D = f / pxPerMm; // camera height above the plane at the centre
  const cx = (widthPx - 1) / 2 + offsetPx[0];
  const cy = (heightPx - 1) / 2 + offsetPx[1];
  const R = mul3(rotZ(rollDeg * DEG), mul3(rotX(tiltDeg * DEG), rotZ(yawDeg * DEG)));
  // P = K [r1 r2 t], t = (0,0,D)
  const r1 = [R[0], R[3], R[6]];
  const r2 = [R[1], R[4], R[7]];
  const t = [0, 0, D];
  const M = [r1[0], r2[0], t[0], r1[1], r2[1], t[1], r1[2], r2[2], t[2]];
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1];
  const H = mul3(K, M);
  const T = [1, 0, -centerMm[0], 0, 1, -centerMm[1], 0, 0, 1];
  const Hc = mul3(H, T);
  return Hc.map((v) => v / Hc[8]);
}

function gaussianBlurRGBA(data, width, height, sigma) {
  if (!sigma || sigma <= 0) return data;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); kernel[i + radius] = v; sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(width * height * 3);
  const out = new Uint8ClampedArray(data.length);
  // horizontal
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        const idx = (y * width + xx) * 4; const w = kernel[k + radius];
        r += data[idx] * w; g += data[idx + 1] * w; b += data[idx + 2] * w;
      }
      const o = (y * width + x) * 3; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b;
    }
  }
  // vertical
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0; let g = 0; let b = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        const idx = (yy * width + x) * 3; const w = kernel[k + radius];
        r += tmp[idx] * w; g += tmp[idx + 1] * w; b += tmp[idx + 2] * w;
      }
      const o = (y * width + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// Deterministic pseudo-random (mulberry32) so tests are reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function partCornersMm(part) {
  const a = (part.angleDeg || 0) * DEG;
  const c = Math.cos(a); const s = Math.sin(a);
  const hw = part.w / 2; const hh = part.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [part.x + lx * c - ly * s, part.y + lx * s + ly * c]);
}

/**
 * Render a scene. Returns { data: Uint8ClampedArray(RGBA), width, height }.
 * spec: { widthPx, heightPx, H, target, parts, paper, background, glare, shadows, blurSigma, noise, supersample, seed }
 */
export function renderScene(spec, dictBits = DICT_4X4_50) {
  const {
    widthPx, heightPx, H, target = DEFAULT_TARGET, parts = [], paper = true,
    background = { gray: 205, gradient: 0.15 }, glare = [], shadows = false,
    blurSigma = 0, noise = 0, supersample = 3, seed = 1,
  } = spec;
  const Hinv = invertHomography(H);
  const s = target.printScale || 1;
  const side = target.markerSideMm * s;
  const cell = side / 6;
  const markers = markerCentersMm(target).map((m) => ({ ...m, bits: dictBits[m.id] }));
  const paperB = targetBoundsMm(target, 20);
  const bgGray = background.gray ?? 205;
  const grad = background.gradient ?? 0;
  // parts precomputed
  const P = parts.map((p) => {
    const a = (p.angleDeg || 0) * DEG;
    return { ...p, cos: Math.cos(a), sin: Math.sin(a), gray: p.gray ?? 55 };
  });
  const insidePart = (X, Y, p, grow = 0) => {
    const dx = X - p.x; const dy = Y - p.y;
    const lx = dx * p.cos + dy * p.sin;
    const ly = -dx * p.sin + dy * p.cos;
    return Math.abs(lx) <= p.w / 2 + grow && Math.abs(ly) <= p.h / 2 + grow;
  };
  const scene = (X, Y) => {
    // background with gentle gradient across the frame
    let g = bgGray * (1 + grad * ((X - 65) / 1500));
    let r = g; let b = g + 3;
    let inPart = null;
    for (const p of P) {
      if (insidePart(X, Y, p)) { inPart = p; break; }
    }
    if (inPart) {
      r = inPart.gray; g = inPart.gray + 2; b = inPart.gray + 8;
      for (const gl of glare) {
        const dx = (X - gl.x) / gl.rx; const dy = (Y - gl.y) / gl.ry;
        if (dx * dx + dy * dy <= 1) { r = 238; g = 240; b = 242; break; }
      }
      return [r, g, b];
    }
    if (shadows) {
      for (const p of P) {
        if (insidePart(X - 4, Y - 4, p, 3)) { r *= 0.72; g *= 0.72; b *= 0.72; break; }
      }
    }
    if (paper && X >= paperB.minX && X <= paperB.maxX && Y >= paperB.minY && Y <= paperB.maxY) {
      r = 246; g = 246; b = 244;
      for (const m of markers) {
        const lx = X - (m.x - side / 2); const ly = Y - (m.y - side / 2);
        if (lx >= 0 && lx < side && ly >= 0 && ly < side) {
          const c = Math.floor(lx / cell); const rw = Math.floor(ly / cell);
          let white = false;
          if (c >= 1 && c <= 4 && rw >= 1 && rw <= 4) white = m.bits[rw - 1][c - 1] === 1;
          const v = white ? 250 : 18;
          r = v; g = v; b = v;
          break;
        }
      }
    }
    return [r, g, b];
  };
  const n = Math.max(1, supersample | 0);
  const inv = 1 / (n * n);
  let data = new Uint8ClampedArray(widthPx * heightPx * 4);
  const rng = makeRng(seed);
  for (let j = 0; j < heightPx; j++) {
    for (let i = 0; i < widthPx; i++) {
      let r = 0; let g = 0; let b = 0;
      for (let a = 0; a < n; a++) {
        const v = j + (a + 0.5) / n - 0.5;
        for (let c = 0; c < n; c++) {
          const u = i + (c + 0.5) / n - 0.5;
          const w = Hinv[6] * u + Hinv[7] * v + Hinv[8];
          let col;
          if (w <= 1e-9) col = [bgGray, bgGray, bgGray + 3];
          else {
            const X = (Hinv[0] * u + Hinv[1] * v + Hinv[2]) / w;
            const Y = (Hinv[3] * u + Hinv[4] * v + Hinv[5]) / w;
            col = scene(X, Y);
          }
          r += col[0]; g += col[1]; b += col[2];
        }
      }
      const o = (j * widthPx + i) * 4;
      data[o] = r * inv; data[o + 1] = g * inv; data[o + 2] = b * inv; data[o + 3] = 255;
    }
  }
  if (blurSigma > 0) data = gaussianBlurRGBA(data, widthPx, heightPx, blurSigma);
  if (noise > 0) {
    for (let k = 0; k < data.length; k += 4) {
      // Box-Muller
      const u1 = Math.max(1e-9, rng()); const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * noise;
      data[k] += z; data[k + 1] += z; data[k + 2] += z;
    }
  }
  return { data, width: widthPx, height: heightPx };
}

// Convenience: a standard scene with the target and the given parts.
export function standardScene({ widthPx = 1600, heightPx = 1200, pxPerMm = 2.5, tiltDeg = 0, rollDeg = 0, yawDeg = 0, parts = [], centerMm = null, ...rest } = {}) {
  const c = centerMm || [65, 105];
  const H = makeHomography({ widthPx, heightPx, pxPerMm, tiltDeg, rollDeg, yawDeg, centerMm: c });
  return { H, image: renderScene({ widthPx, heightPx, H, parts, ...rest }), parts };
}
