// Generates PWA icons without any image library: a tiny PNG encoder (zlib deflate + CRC32) and a
// software rasteriser with 4x4 supersampling. Writes icons/icon-192.png, icons/icon-512.png,
// icons/maskable-512.png and icons/icon.svg (the same drawing as vector).
// Usage: node tools/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons');

// ---- PNG encoding ---------------------------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing (unit square coordinates) -----------------------------------------------------------
const BG = [0x0f, 0x11, 0x15];
const LIGHT = [0xf2, 0xf4, 0xf8];
const CYAN = [0x4c, 0xc2, 0xff];
const BLACK = [0x0f, 0x11, 0x15];

// Design in a 100x100 box: dark rounded background, sheet outline, ArUco-like marker.
const DESIGN = {
  bgRadius: 20,
  sheet: { x: 16, y: 25, w: 68, h: 50, rx: 4, stroke: 6 },
  marker: { x: 51, y: 47, s: 22 },
  inner: { x: 56.5, y: 52.5, s: 11 },
};

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  if (r <= 0) return true;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx; const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// Colour of one sample point (0..100 space). Returns [r,g,b,a].
function sample(px, py, { maskable }) {
  if (maskable) {
    // Full-bleed background; content shrunk into the safe zone (central 80 %).
    const s = 0.72;
    px = 50 + (px - 50) / s; py = 50 + (py - 50) / s;
  } else if (!inRoundedRect(px, py, 0, 0, 100, 100, DESIGN.bgRadius)) {
    return [0, 0, 0, 0];
  }
  let c = BG;
  const sh = DESIGN.sheet; const half = sh.stroke / 2;
  const outer = inRoundedRect(px, py, sh.x - half, sh.y - half, sh.w + sh.stroke, sh.h + sh.stroke, sh.rx + half);
  const innerHole = inRoundedRect(px, py, sh.x + half, sh.y + half, sh.w - sh.stroke, sh.h - sh.stroke, Math.max(0, sh.rx - half));
  if (outer && !innerHole) c = LIGHT;
  const m = DESIGN.marker;
  if (px >= m.x && px <= m.x + m.s && py >= m.y && py <= m.y + m.s) c = CYAN;
  const i = DESIGN.inner;
  if (px >= i.x && px <= i.x + i.s && py >= i.y && py <= i.y + i.s) c = BLACK;
  return [c[0], c[1], c[2], 255];
}

export function renderIcon(size, { maskable = false } = {}) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * 100;
          const py = ((y + (sy + 0.5) / SS) / size) * 100;
          const [cr, cg, cb, ca] = sample(px, py, { maskable });
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
      rgba[o + 3] = a / (SS * SS);
    }
  }
  return rgba;
}

export function iconSvg() {
  const sh = DESIGN.sheet; const m = DESIGN.marker; const i = DESIGN.inner;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
<rect width="100" height="100" rx="${DESIGN.bgRadius}" fill="#0f1115"/>
<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.rx}" fill="none" stroke="#f2f4f8" stroke-width="${sh.stroke}"/>
<rect x="${m.x}" y="${m.y}" width="${m.s}" height="${m.s}" fill="#4cc2ff"/>
<rect x="${i.x}" y="${i.y}" width="${i.s}" height="${i.s}" fill="#0f1115"/>
</svg>
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  mkdirSync(outDir, { recursive: true });
  const files = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['maskable-512.png', 512, true],
  ];
  for (const [name, size, maskable] of files) {
    const png = encodePng(renderIcon(size, { maskable }), size, size);
    writeFileSync(path.join(outDir, name), png);
    console.log(`wrote icons/${name} (${png.length} bytes)`);
  }
  writeFileSync(path.join(outDir, 'icon.svg'), iconSvg(), 'utf8');
  console.log('wrote icons/icon.svg');
}
