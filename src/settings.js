import { DEFAULT_TARGET } from './vision/target.js';

export const DEFAULT_SETTINGS = Object.freeze({
  target: { ...DEFAULT_TARGET },
  quality: {
    minMarkers: 2,
    fullMarkers: 4,
    reprojMaxPx: 1.5,
    tiltMaxDeg: 35,
    targetMinFraction: 0.05,
    sharpnessMin: 0.02,
    glareMaxFraction: 0.10,
    minPxPerMm: 1.0,
  },
  segmentation: {
    bgMinV: 140,
    bgMaxS: 70,
    closeKernelMm: 12,
    minAreaMm2: 400,
    minSideMm: 15,
    borderMarginMm: 3,
    useOtsu: true,
  },
  raster: { maxPxPerMm: 4, maxPixels: 6e6, maxExtentMm: 3000 },
  edgeRefine: { enabled: true, searchMm: 3, stepPx: 2, endTrimFrac: 0.1 },
  match: { toleranceMm: 3, ambiguityMm: 5 },
  thickness: { thicknessMm: 0, shootHeightMm: 0 },
  history: { photoMaxPx: 1600 },
  ui: { vibrate: true },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function mergeSettings(base, patch) {
  const out = {};
  for (const k of Object.keys(base || {})) {
    const b = base[k];
    out[k] = isPlainObject(b) ? mergeSettings(b, {}) : Array.isArray(b) ? b.slice() : b;
  }
  for (const k of Object.keys(patch || {})) {
    const p = patch[k];
    if (isPlainObject(p) && isPlainObject(out[k])) out[k] = mergeSettings(out[k], p);
    else if (p !== undefined) out[k] = Array.isArray(p) ? p.slice() : p;
  }
  return out;
}

export function defaultSettings() {
  return mergeSettings(DEFAULT_SETTINGS, {});
}
