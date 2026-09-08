// Photo with measurement overlay (SPEC section 9). renderOverlay needs the DOM (canvas); hitTest and
// the colour tables are pure and usable anywhere. Nothing touches the DOM at module top level.
import { polygonCentroid, pointInPolygon } from '../vision/geometry.js';

export const STATUS_COLORS = {
  ok: '#3ddc84',
  extra: '#ffb020',
  ambiguous: '#ff4d4f',
  none: '#4cc2ff',
  ignored: '#8a8a8a',
};
export const DEFAULT_COLOR = '#4cc2ff';
export const MARKER_COLOR = '#22d3ee';

export function hexToRgba(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(76,194,255,${alpha})`;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

export function statusColor(status) {
  return (status && STATUS_COLORS[status]) || DEFAULT_COLOR;
}

// Polygon in photo pixels for a part: corners of the fitted rectangle, else the raw contour.
export function partPolygonPx(p) {
  if (!p) return null;
  if (Array.isArray(p.cornersPx) && p.cornersPx.length >= 3) return p.cornersPx;
  if (Array.isArray(p.polygonPx) && p.polygonPx.length >= 3) return p.polygonPx;
  return null;
}

function fmt1(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '—';
}

// Index of the part under (x, y) in result.image pixel coordinates, or -1. Smaller parts win when
// polygons nest so a part lying inside another's contour stays selectable.
export function hitTest(result, xImagePx, yImagePx) {
  const parts = (result && Array.isArray(result.parts)) ? result.parts : [];
  const pt = [Number(xImagePx), Number(yImagePx)];
  if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return -1;
  const order = parts.map((p, i) => ({ p, i })).sort((a, b) => (a.p.areaMm2 || 0) - (b.p.areaMm2 || 0));
  for (const { p, i } of order) {
    const poly = partPolygonPx(p);
    if (poly && pointInPolygon(pt, poly)) return Number.isInteger(p.index) ? p.index : i;
  }
  return -1;
}

function sourceSize(photo) {
  const w = photo.naturalWidth || photo.videoWidth || photo.width || 0;
  const h = photo.naturalHeight || photo.videoHeight || photo.height || 0;
  return { w, h };
}

async function toDrawable(photo) {
  if (!photo) throw Object.assign(new Error('Нет фото для разметки'), { code: 'BAD_INPUT' });
  if (typeof Blob !== 'undefined' && photo instanceof Blob) {
    if (typeof createImageBitmap !== 'function') throw Object.assign(new Error('Браузер не умеет декодировать фото'), { code: 'BAD_INPUT' });
    return { source: await createImageBitmap(photo), owned: true };
  }
  if (typeof HTMLImageElement !== 'undefined' && photo instanceof HTMLImageElement && !photo.complete && typeof photo.decode === 'function') {
    try { await photo.decode(); } catch { /* draw whatever is there */ }
  }
  return { source: photo, owned: false };
}

/**
 * Draw the photo with part polygons, labels and detected markers onto a new canvas.
 * `result` coordinates are in result.image pixels; the photo may be a downscaled copy of that image.
 * labels: { [index]: string } extra text per part (e.g. plan id); statuses: { [index]: 'ok'|'extra'|'ambiguous'|'ignored' }.
 */
export async function renderOverlay(photo, result, { labels = {}, statuses = {}, maxSidePx = 2000, selected = -1, drawMarkers = true } = {}) {
  const { source, owned } = await toDrawable(photo);
  try {
    const { w: srcW, h: srcH } = sourceSize(source);
    if (!(srcW > 0 && srcH > 0)) throw Object.assign(new Error('Фото пустое'), { code: 'BAD_INPUT' });
    const fit = Math.min(1, (maxSidePx > 0 ? maxSidePx : 2000) / Math.max(srcW, srcH));
    const W = Math.max(1, Math.round(srcW * fit));
    const H = Math.max(1, Math.round(srcH * fit));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.drawImage(source, 0, 0, W, H);

    const r = result || {};
    const refW = (r.image && r.image.width) || srcW;
    const s = W / refW;
    const maxSide = Math.max(W, H);
    const lw = Math.max(2, Math.round(maxSide / 500)); // 4 px at 2000 px
    const fontPx = Math.max(14, Math.round(maxSide / 45));
    const pad = Math.round(fontPx * 0.5);
    const tracePoly = (poly) => {
      g.beginPath();
      poly.forEach(([x, y], i) => { if (i === 0) g.moveTo(x * s, y * s); else g.lineTo(x * s, y * s); });
      g.closePath();
    };

    if (drawMarkers && r.target && Array.isArray(r.target.markers)) {
      g.lineWidth = Math.max(1, Math.round(lw / 2));
      g.strokeStyle = hexToRgba(MARKER_COLOR, 0.95);
      g.font = `bold ${Math.round(fontPx * 0.8)}px sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const mk of r.target.markers) {
        if (!Array.isArray(mk.corners) || mk.corners.length < 3) continue;
        tracePoly(mk.corners);
        g.stroke();
        const [cx, cy] = polygonCentroid(mk.corners);
        g.lineWidth = Math.max(2, Math.round(fontPx / 6));
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(String(mk.id), cx * s, cy * s);
        g.fillStyle = MARKER_COLOR;
        g.fillText(String(mk.id), cx * s, cy * s);
        g.lineWidth = Math.max(1, Math.round(lw / 2));
        g.strokeStyle = hexToRgba(MARKER_COLOR, 0.95);
      }
    }

    const parts = Array.isArray(r.parts) ? r.parts : [];
    g.font = `bold ${fontPx}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const index = Number.isInteger(p.index) ? p.index : i;
      const poly = partPolygonPx(p);
      if (!poly) continue;
      const status = statuses[index];
      const color = statusColor(status);
      tracePoly(poly);
      g.fillStyle = hexToRgba(color, 0.18);
      g.fill();
      g.lineWidth = selected === index ? lw * 2 : lw;
      g.strokeStyle = color;
      g.stroke();

      const [cx0, cy0] = polygonCentroid(poly);
      let text = `${index + 1}  ${fmt1(p.lengthMm)}×${fmt1(p.widthMm)}`;
      const label = labels[index];
      if (label !== undefined && label !== null && String(label) !== '') text += `  ${label}`;
      const tw = Math.ceil(g.measureText(text).width) + pad * 2;
      const th = Math.round(fontPx * 1.6);
      let bx = cx0 * s - tw / 2; let by = cy0 * s - th / 2;
      bx = Math.min(Math.max(0, bx), Math.max(0, W - tw));
      by = Math.min(Math.max(0, by), Math.max(0, H - th));
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(bx, by, tw, th);
      g.lineWidth = Math.max(1, Math.round(lw / 2));
      g.strokeStyle = color;
      g.strokeRect(bx + 0.5, by + 0.5, tw - 1, th - 1);
      g.fillStyle = status === 'ignored' ? '#bbbbbb' : '#ffffff';
      g.fillText(text, bx + tw / 2, by + th / 2);
    }
    return canvas;
  } finally {
    if (owned && source && typeof source.close === 'function') { try { source.close(); } catch { /* ignore */ } }
  }
}

// canvas.toBlob as a promise (JPEG by default — photos with overlays compress well).
export function canvasToBlob(canvas, { type = 'image/jpeg', quality = 0.9 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(Object.assign(new Error('Не удалось сохранить изображение'), { code: 'BAD_INPUT' }));
      }, type, quality);
    } catch (e) { reject(e); }
  });
}
