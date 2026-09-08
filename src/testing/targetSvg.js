// Printable calibration target as an SVG string (mm units, A4 portrait by default).
// Pure module: no DOM, works in Node (tools/gen-target.mjs) and in the browser (target.html, #/target).
// Marker layout follows src/vision/target.js: id0 top-left, id1 top-right, id2 bottom-right, id3 bottom-left,
// Y axis down. Only black rectangles are drawn on a white page so nothing anti-aliases at cell boundaries.
import { DEFAULT_TARGET, markerCentersMm } from '../vision/target.js';
import { DICT_4X4_50 } from '../data/dict4x4_50.js';

export const DEFAULT_PAGE = Object.freeze({ widthMm: 210, heightMm: 297 });
export const CONTROL_SEGMENT_MM = 100;

const TITLE = 'Мишень для замера деталей · печать 100 % (без масштабирования)';
const CONTROL_TEXT = 'Контрольный отрезок 100 мм — измерьте после печати и введите в настройках';

function num(v) {
  return String(Number(v.toFixed(3)));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Marker positions on the page: the marker set is centred on the page.
export function targetLayout({ target = DEFAULT_TARGET, page = DEFAULT_PAGE } = {}) {
  const scale = target.printScale || 1;
  const side = target.markerSideMm * scale;
  const centers = markerCentersMm(target);
  const minX = Math.min(...centers.map((c) => c.x)) - side / 2;
  const maxX = Math.max(...centers.map((c) => c.x)) + side / 2;
  const minY = Math.min(...centers.map((c) => c.y)) - side / 2;
  const maxY = Math.max(...centers.map((c) => c.y)) + side / 2;
  const ox = (page.widthMm - (maxX - minX)) / 2 - minX;
  const oy = (page.heightMm - (maxY - minY)) / 2 - minY;
  const markers = centers.map((c, index) => ({
    id: c.id,
    index,
    // top-left corner of the marker on the page (mm)
    x: c.x - side / 2 + ox,
    y: c.y - side / 2 + oy,
    centerX: c.x + ox,
    centerY: c.y + oy,
  }));
  return { side, cell: side / 6, markers, offset: { x: ox, y: oy }, bounds: { minX: minX + ox, minY: minY + oy, maxX: maxX + ox, maxY: maxY + oy } };
}

// Black cell runs of a 6x6 marker (border + inner 4x4 bits). Returns [{ row, col, len }].
export function markerBlackRuns(bits) {
  const runs = [];
  for (let r = 0; r < 6; r++) {
    let start = -1;
    for (let c = 0; c <= 6; c++) {
      const black = c < 6 && (r === 0 || r === 5 || c === 0 || c === 5 || !(bits && bits[r - 1] && bits[r - 1][c - 1] === 1));
      if (black && start < 0) start = c;
      if (!black && start >= 0) { runs.push({ row: r, col: start, len: c - start }); start = -1; }
    }
  }
  return runs;
}

function markerGroup(m, layout, bits) {
  const { cell, side } = layout;
  const rects = markerBlackRuns(bits).map((run) => `<rect x="${num(m.x + run.col * cell)}" y="${num(m.y + run.row * cell)}" width="${num(run.len * cell)}" height="${num(cell)}"/>`);
  // Label outside the marker, away from the quiet zone: above for the top row, below for the bottom row.
  const top = m.index === 0 || m.index === 1;
  const right = m.index === 1 || m.index === 2;
  const lx = right ? m.x + side : m.x;
  const ly = top ? m.y - 4 : m.y + side + 5.5;
  const label = `<text x="${num(lx)}" y="${num(ly)}" font-size="3" text-anchor="${right ? 'end' : 'start'}">id ${m.id}</text>`;
  return `<g class="marker" data-id="${m.id}" fill="#000">${rects.join('')}${label}</g>`;
}

/**
 * Build the SVG. Returns a string without an XML declaration (safe for innerHTML); prepend one when saving to a file.
 * { target, page: { widthMm, heightMm }, dictBits }
 */
export function targetSvg({ target = DEFAULT_TARGET, page = DEFAULT_PAGE, dictBits = DICT_4X4_50 } = {}) {
  const layout = targetLayout({ target, page });
  const W = page.widthMm; const H = page.heightMm;
  const scale = target.printScale || 1;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}" shape-rendering="crispEdges" font-family="Arial, Helvetica, sans-serif" data-target="${esc(target.dictionary)}" data-marker-side-mm="${num(layout.side)}">`);
  parts.push(`<title>${esc(TITLE)}</title>`);
  parts.push(`<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#fff"/>`);
  // Title block
  parts.push(`<text x="${num(W / 2)}" y="11" font-size="4.2" font-weight="bold" text-anchor="middle" fill="#000">${esc(TITLE)}</text>`);
  parts.push(`<text x="${num(W / 2)}" y="16.5" font-size="3" text-anchor="middle" fill="#000">${esc(`${target.dictionary} · id ${layout.markers.map((m) => m.id).join(', ')} · метка ${num(layout.side)} мм · центры ${num(target.spacingXMm * scale)} × ${num(target.spacingYMm * scale)} мм`)}</text>`);
  // Markers
  for (const m of layout.markers) parts.push(markerGroup(m, layout, dictBits[m.id]));
  // Control segment: exactly CONTROL_SEGMENT_MM between the tick centres.
  const cy = H - 12;
  const x0 = (W - CONTROL_SEGMENT_MM) / 2; const x1 = x0 + CONTROL_SEGMENT_MM;
  parts.push(`<g class="control" stroke="#000" stroke-width="0.3" fill="none" shape-rendering="geometricPrecision" data-length-mm="${CONTROL_SEGMENT_MM}">` +
    `<line x1="${num(x0)}" y1="${num(cy)}" x2="${num(x1)}" y2="${num(cy)}"/>` +
    `<line x1="${num(x0)}" y1="${num(cy - 3)}" x2="${num(x0)}" y2="${num(cy + 3)}"/>` +
    `<line x1="${num(x1)}" y1="${num(cy - 3)}" x2="${num(x1)}" y2="${num(cy + 3)}"/>` +
    '</g>');
  parts.push(`<text x="${num(W / 2)}" y="${num(cy - 4.5)}" font-size="3" text-anchor="middle" fill="#000">${esc(CONTROL_TEXT)}</text>`);
  parts.push(`<text x="${num(x0)}" y="${num(cy + 6.5)}" font-size="3" fill="#000">0</text>`);
  parts.push(`<text x="${num(x1)}" y="${num(cy + 6.5)}" font-size="3" text-anchor="end" fill="#000">100 мм</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

export function targetSvgDataUrl(opts) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(targetSvg(opts));
}
