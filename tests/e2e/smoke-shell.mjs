// Shell smoke test: serves the repo, opens the app in headless Chromium with a fake camera,
// checks that screens mount without page errors and that the vision worker becomes ready
// (the latter only when src/vision/pipeline.js exists).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8093);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => { child.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(child); }); setTimeout(() => resolve(child), 2000); });
}

const server = await startServer();
let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
let browser;
try {
  browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const page = await context.newPage();
  const pageErrors = []; const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const base = `http://127.0.0.1:${PORT}/`;
  await page.goto(base + '#/camera', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  check(await page.locator('.cam').count() === 1, 'camera screen mounted');
  check(await page.locator('.btn-capture').count() === 1, 'capture button present');
  const capH = await page.locator('.btn-capture').evaluate((el) => el.getBoundingClientRect().height);
  check(capH >= 80, `capture button height ${capH}px >= 80`);
  const hasVideo = await page.evaluate(() => { const v = document.querySelector('.cam video'); return !!(v && v.videoWidth > 0); });
  check(hasVideo, 'fake camera stream playing');
  const hasPipeline = existsSync(path.join(root, 'src/vision/pipeline.js'));
  if (hasPipeline) {
    await page.waitForFunction(() => window.__app.readyState.vision !== 'loading', null, { timeout: 120000 });
    const rs = await page.evaluate(() => window.__app.readyState);
    check(rs.vision === 'ready', `vision worker ready (opencv ${rs.opencvVersion})`);
    if (rs.vision === 'ready') {
      await page.waitForTimeout(2500);
      const hint = await page.locator('.cam-hint').textContent();
      check(/мишен|Можно|Загрузка/i.test(hint || ''), `live hint shown: "${hint}"`);
    }
    if (rs.vision === 'ready') {
      // Full analysis in the browser: synthetic scene -> worker (ImageData and ImageBitmap paths).
      const r = await page.evaluate(async () => {
        const { standardScene } = await import('/src/testing/synth.js');
        const { image } = standardScene({ widthPx: 1600, heightPx: 1200, pxPerMm: 2.2, tiltDeg: 12, rollDeg: 5, centerMm: [230, 105], parts: [{ x: 330, y: 105, w: 297, h: 210, angleDeg: 12 }], shadows: true, noise: 3 });
        const imgData = new ImageData(image.data, image.width, image.height);
        const t0 = performance.now();
        const a = await window.__app.vision.analyze(imgData, window.__app.settings);
        const tA = performance.now() - t0;
        const bmp = await createImageBitmap(new ImageData(image.data.slice(), image.width, image.height));
        const t1 = performance.now();
        const b = await window.__app.vision.analyze(bmp, window.__app.settings);
        const tB = performance.now() - t1;
        return { a: { ok: a.ok, n: a.parts?.length, L: a.parts?.[0]?.lengthMm, W: a.parts?.[0]?.widthMm, tilt: a.quality?.tiltDeg, ms: Math.round(tA), timings: a.timingsMs, err: a.error }, b: { ok: b.ok, n: b.parts?.length, L: b.parts?.[0]?.lengthMm, ms: Math.round(tB), err: b.error } };
      });
      check(r.a.ok && r.a.n === 1, `browser analyze (ImageData) ok: ${JSON.stringify(r.a.err || r.a.timings)}`);
      check(r.a.ok && Math.abs(r.a.L - 297) < 0.8 && Math.abs(r.a.W - 210) < 0.8, `browser dims ${r.a.L?.toFixed(2)}x${r.a.W?.toFixed(2)} (tilt ${r.a.tilt?.toFixed(1)}) in ${r.a.ms} ms`);
      check(r.b.ok && r.b.n === 1 && Math.abs(r.b.L - 297) < 0.8, `browser analyze (ImageBitmap) ok in ${r.b.ms} ms`);

      // Full flow: camera screen file input -> analysis -> result screen -> part sheet.
      const png = await page.evaluate(async () => {
        const { standardScene } = await import('/src/testing/synth.js');
        const { image } = standardScene({ widthPx: 1600, heightPx: 1200, pxPerMm: 2.2, tiltDeg: 15, centerMm: [80, 180], parts: [{ x: 295, y: 60, w: 210, h: 120, angleDeg: 0 }, { x: -135, y: 40, w: 140, h: 150, angleDeg: 0 }, { x: 65, y: 345, w: 380, h: 90, angleDeg: 5 }], shadows: true, noise: 3 });
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        c.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        const buf = await blob.arrayBuffer();
        let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
      });
      await page.evaluate(() => { location.hash = '#/camera'; });
      await page.waitForSelector('.cam input[type=file]', { state: 'attached', timeout: 10000 });
      await page.setInputFiles('.cam input[type=file]', { name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 });
      await page.waitForSelector('.result-canvas', { timeout: 15000 });
      await page.waitForTimeout(800);
      const cards = await page.locator('#screen .card.clickable').count();
      check(cards >= 3, `result screen lists ${cards} parts (expected 3)`);
      const dimsText = await page.locator('#screen .dims').allTextContents();
      check(dimsText.some((t) => /380\.\d × 90\.\d/.test(t)), `result shows 380x90 part: ${dimsText.join(' | ')}`);
      await page.locator('#screen .card.clickable').first().click();
      await page.waitForSelector('.sheet-panel', { timeout: 5000 });
      const sheetTitle = await page.locator('.sheet-title').textContent();
      check(/Деталь 1/.test(sheetTitle || ''), `part sheet opened: "${sheetTitle}"`);
      const stepperCount = await page.locator('.sheet-panel .stepper-btn').count();
      check(stepperCount >= 4, `part sheet has ${stepperCount} stepper buttons`);
      await page.locator('.sheet-close').click();
      await page.waitForTimeout(400);
    }
  } else {
    console.log('  skip vision readiness (pipeline.js not present yet)');
  }
  for (const route of ['#/orders', '#/remnants', '#/settings', '#/help', '#/test', '#/target', '#/result/nope', '#/compare/nope', '#/camera']) {
    await page.evaluate((r) => { location.hash = r; }, route);
    await page.waitForTimeout(600);
    const txt = (await page.locator('#screen').textContent()) || '';
    check(!/Ошибка экрана|Не удалось открыть/.test(txt), `route ${route} mounted (${txt.trim().slice(0, 40).replace(/\s+/g, ' ')})`);
  }
  const navH = await page.locator('#nav a').first().evaluate((el) => el.getBoundingClientRect().height);
  check(navH >= 64, `nav item height ${navH}px >= 64`);
  const benign = (e) => /pipeline\.js|db\.js|manifest|sw\.js|icon|favicon|404|Failed to load resource/i.test(e);
  const realPageErrors = pageErrors.filter((e) => !benign(e));
  const realConsoleErrors = consoleErrors.filter((e) => !benign(e));
  check(realPageErrors.length === 0, `no page errors (${realPageErrors.join(' | ').slice(0, 300)})`);
  check(realConsoleErrors.length === 0, `no console errors (${realConsoleErrors.join(' | ').slice(0, 300)})`);
  if (pageErrors.length || consoleErrors.length) console.log('  (all errors) ' + pageErrors.concat(consoleErrors).join(' | ').slice(0, 800));
} catch (e) {
  failed++; console.log('  FAIL exception: ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failed ? `smoke-shell: ${failed} failure(s)` : 'smoke-shell: all checks passed');
process.exit(failed ? 1 : 0);
