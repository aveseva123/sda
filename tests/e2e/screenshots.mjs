// Captures mobile-viewport screenshots of every screen into tests/e2e/screenshots/ (for manual review).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8097);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const outDir = process.env.OUT_DIR || path.join(root, 'tests/e2e/screenshots');
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => { server.stdout.on('data', (d) => { if (String(d).includes('serving')) r(); }); setTimeout(r, 2000); });
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
try {
  await page.goto(`http://127.0.0.1:${PORT}/#/camera`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.readyState.vision !== 'loading', null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot('01-camera');
  // Seed an order from the DXF fixture through the UI, then run an analysis via the file input.
  await page.evaluate(() => { location.hash = '#/orders'; });
  await page.waitForTimeout(800);
  await shot('02-orders-empty');
  const fileInput = page.locator('#screen input[type=file]').first();
  await fileInput.setInputFiles(path.join(root, 'tests/fixtures/nest_polylines.dxf'));
  await page.waitForSelector('.sheet-panel', { timeout: 10000 });
  await page.waitForTimeout(500);
  await shot('03-orders-import-preview');
  const saveBtn = page.locator('.sheet-panel button', { hasText: 'Сохранить' }).first();
  await saveBtn.click();
  await page.waitForTimeout(800);
  await shot('04-orders-list');
  const png = await page.evaluate(async () => {
    const { standardScene } = await import('/src/testing/synth.js');
    const { image } = standardScene({ widthPx: 1600, heightPx: 1200, pxPerMm: 2.2, tiltDeg: 15, centerMm: [80, 180], parts: [{ x: 295, y: 60, w: 380, h: 240, angleDeg: 0 }, { x: -135, y: 40, w: 100, h: 100, angleDeg: 0 }, { x: 65, y: 345, w: 300, h: 200, angleDeg: 5 }], shadows: true, noise: 3 });
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    c.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s);
  });
  await page.evaluate(() => { location.hash = '#/camera'; });
  await page.waitForSelector('.cam input[type=file]', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(500);
  await page.setInputFiles('.cam input[type=file]', { name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 });
  await page.waitForSelector('.result-canvas', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await shot('05-result');
  await page.locator('#screen .card.clickable').first().click();
  await page.waitForSelector('.sheet-panel', { timeout: 5000 });
  await page.waitForTimeout(400);
  await shot('06-result-part-sheet');
  await page.locator('.sheet-close').click();
  await page.waitForTimeout(300);
  const compareBtn = page.locator('#screen button', { hasText: 'Сверка' }).first();
  await compareBtn.click();
  await page.waitForTimeout(1200);
  await shot('07-compare');
  for (const [name, hash] of [['08-remnants', '#/remnants'], ['09-settings', '#/settings'], ['10-help', '#/help'], ['11-test', '#/test'], ['12-target', '#/target']]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(900);
    await shot(name);
  }
  await page.goto(`http://127.0.0.1:${PORT}/target.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await shot('13-target-html');
  console.log('screenshots written to', outDir);
} catch (e) {
  console.log('screenshot run failed:', e && e.message);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
