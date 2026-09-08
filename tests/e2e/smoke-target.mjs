// Printable target check: render the SVG from src/testing/targetSvg.js in headless Chromium at 4 px/mm,
// detect the markers with OpenCV in Node, and verify ids, geometry (40:130:210) and corner order.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadCv } from '../helpers/cv.mjs';
import { createDetector } from '../../src/vision/aruco.js';
import { DEFAULT_TARGET } from '../../src/vision/target.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8096);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SCALE = 4; // px per mm

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => { child.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(child); }); setTimeout(() => resolve(child), 2000); });
}

let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/target.html`, { waitUntil: 'load' });
  const raw = await page.evaluate(async (scale) => {
    const mod = await import('/src/testing/targetSvg.js');
    const svg = mod.targetSvg({});
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const wMm = Number(m[1]); const hMm = Number(m[2]);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = Math.round(wMm * scale); c.height = Math.round(hMm * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    let s = ''; const bytes = d.data; for (let i = 0; i < bytes.length; i += 3) { s += String.fromCharCode(bytes[i], bytes[i + 1] ?? 0, bytes[i + 2] ?? 0); }
    return { width: c.width, height: c.height, wMm, hMm, b64: btoa(s), hasControl: /100/.test(svg), svgLen: svg.length, mmUnits: /width="210mm"/.test(svg) };
  }, SCALE);
  check(raw.mmUnits, 'svg declares width in mm');
  check(raw.wMm === 210 && raw.hMm === 297, `viewBox is A4 (${raw.wMm}x${raw.hMm})`);
  const buf = Buffer.from(raw.b64, 'base64');
  const data = new Uint8ClampedArray(raw.width * raw.height * 4);
  data.set(buf.subarray(0, data.length));
  const cv = await loadCv();
  const det = createDetector(cv, { target: DEFAULT_TARGET });
  const { markers } = det.detect({ data, width: raw.width, height: raw.height });
  det.dispose();
  const ids = markers.map((m) => m.id).sort();
  check(ids.join(',') === '0,1,2,3', `detected ids ${ids.join(',')}`);
  const byId = Object.fromEntries(markers.map((m) => [m.id, m]));
  const center = (m) => [m.corners.reduce((a, c) => a + c[0], 0) / 4, m.corners.reduce((a, c) => a + c[1], 0) / 4];
  if (ids.length === 4) {
    const c0 = center(byId[0]); const c1 = center(byId[1]); const c2 = center(byId[2]); const c3 = center(byId[3]);
    const dx01 = (c1[0] - c0[0]) / SCALE; const dy01 = (c1[1] - c0[1]) / SCALE;
    const dx03 = (c3[0] - c0[0]) / SCALE; const dy03 = (c3[1] - c0[1]) / SCALE;
    check(Math.abs(dx01 - 130) < 0.5 && Math.abs(dy01) < 0.5, `id1 is 130 mm right of id0 (${dx01.toFixed(2)}, ${dy01.toFixed(2)})`);
    check(Math.abs(dx03) < 0.5 && Math.abs(dy03 - 210) < 0.5, `id3 is 210 mm below id0 (${dx03.toFixed(2)}, ${dy03.toFixed(2)})`);
    check(Math.abs((c2[0] - c0[0]) / SCALE - 130) < 0.5 && Math.abs((c2[1] - c0[1]) / SCALE - 210) < 0.5, 'id2 is bottom-right');
    for (const m of markers) {
      const side = Math.hypot(m.corners[1][0] - m.corners[0][0], m.corners[1][1] - m.corners[0][1]) / SCALE;
      check(Math.abs(side - 40) < 0.5, `id${m.id} side ${side.toFixed(2)} mm`);
      const c = center(m);
      const tl = m.corners[0]; const tr = m.corners[1]; const br = m.corners[2]; const bl = m.corners[3];
      check(tl[0] < c[0] && tl[1] < c[1] && tr[0] > c[0] && tr[1] < c[1] && br[0] > c[0] && br[1] > c[1] && bl[0] < c[0] && bl[1] > c[1], `id${m.id} corner order TL,TR,BR,BL (upright, not mirrored)`);
    }
    const setW = 130 + 40; const setH = 210 + 40;
    const left = (c0[0] - 20 * SCALE) / SCALE; const top = (c0[1] - 20 * SCALE) / SCALE;
    check(Math.abs(left - (210 - setW) / 2) < 3 && top > 5 && top + setH < 292, `marker set centred horizontally (left ${left.toFixed(1)} mm, top ${top.toFixed(1)} mm)`);
  }
  check(raw.hasControl, 'control segment text present');
} catch (e) {
  failed++; console.log('  FAIL exception: ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failed ? `smoke-target: ${failed} failure(s)` : 'smoke-target: all checks passed');
process.exit(failed ? 1 : 0);
