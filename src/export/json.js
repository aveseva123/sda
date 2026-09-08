// JSON export of one measurement (SPEC section 9). Pure JS, no DOM.
import { effectiveParts } from './csv.js';

export const FORMAT = 'sda-measure/measurement';
export const FORMAT_VERSION = 1;

function isBlob(v) {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

function isTypedArray(v) {
  return ArrayBuffer.isView(v) && !(typeof DataView !== 'undefined' && v instanceof DataView);
}

// Strips binary payloads that JSON cannot carry: Blobs become null, typed arrays become plain arrays.
function replacer(_key, value) {
  if (isBlob(value)) return null;
  if (isTypedArray(value)) return Array.from(value);
  if (value instanceof ArrayBuffer) return null;
  return value;
}

function summarizeOrder(order) {
  if (!order || typeof order !== 'object') return null;
  return {
    id: order.id ?? null,
    name: order.name ?? '',
    number: order.number ?? '',
    createdAt: order.createdAt ?? null,
    source: order.source ?? null,
    thicknessMm: order.thicknessMm ?? null,
    sheet: order.sheet ?? null,
    parts: (Array.isArray(order.parts) ? order.parts : []).map((p) => ({
      id: p.id, lengthMm: p.lengthMm, widthMm: p.widthMm, qty: p.qty ?? 1, rectangular: p.rectangular ?? null,
    })),
  };
}

// Pretty JSON of the measurement. The photo blob is replaced by its dimensions ({ width, height }),
// the order is included as a compact summary and `effectiveParts` lists the parts with manual
// overrides already applied.
export function measurementToJson(measurement, order = null) {
  const m = measurement && typeof measurement === 'object' ? measurement : {};
  const hasDims = m.photoWidth !== undefined || m.photoHeight !== undefined;
  const photo = (m.photo || hasDims) ? { width: m.photoWidth ?? null, height: m.photoHeight ?? null } : null;
  const { photo: _omit, ...rest } = m;
  const out = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    ...rest,
    photo,
    order: summarizeOrder(order),
    effectiveParts: effectiveParts(m).map((p) => ({
      index: p.index, lengthMm: p.lengthMm, widthMm: p.widthMm, areaMm2: p.areaMm2 ?? null,
      rectangularity: p.rectangularity ?? null, planId: p.planId, ignored: p.ignored, edited: p.edited,
    })),
  };
  return JSON.stringify(out, replacer, 2);
}
