// PWA smoke test: service worker registration and precache, manifest and icons over HTTP, the printable
// target (target.html and #/target), and the in-app synthetic accuracy test (#/test) when the vision
// pipeline exists. Same recipe as smoke-shell.mjs: static server + headless Chromium via Playwright.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8095);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PIPELINE_WAIT_MS = Number(process.env.PIPELINE_WAIT_MS || 20 * 60 * 1000);
const SYNTH_TIMEOUT_MS = 120000;

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => { child.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(child); }); setTimeout(() => resolve(child), 2000); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer();
let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
let browser;
try {
  const base = `http://127.0.0.1:${PORT}/`;

  // --- Static files over HTTP ---
  const man = await fetch(base + 'manifest.webmanifest');
  check(man.status === 200, `manifest.webmanifest HTTP ${man.status}`);
  let manifest = null;
  try { manifest = JSON.parse(await man.text()); } catch (e) { check(false, 'manifest is valid JSON: ' + e.message); }
  if (manifest) {
    check(manifest.name === 'Замер деталей' && manifest.display === 'standalone' && manifest.lang === 'ru', `manifest name/display/lang (${manifest.name}, ${manifest.display}, ${manifest.lang})`);
    check(Array.isArray(manifest.icons) && manifest.icons.length >= 3 && manifest.icons.some((i) => i.purpose === 'maskable'), `manifest icons (${(manifest.icons || []).length}, maskable present)`);
    for (const icon of manifest.icons || []) {
      const r = await fetch(new URL(icon.src, base));
      const buf = Buffer.from(await r.arrayBuffer());
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      check(r.status === 200 && isPng, `icon ${icon.src} HTTP ${r.status}, PNG signature, ${buf.length} bytes`);
    }
  }
  for (const f of ['icons/icon.svg', 'target.svg', 'sw.js', 'sw-manifest.js', 'target.html']) {
    const r = await fetch(base + f);
    check(r.status === 200, `${f} HTTP ${r.status}`);
  }

  browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const page = await context.newPage();
  const pageErrors = []; const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // --- App shell + service worker ---
  await page.goto(base + '#/camera', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 15000 });
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 20000))]);
    if (!reg) return 'timeout';
    return (reg.active && reg.active.state) || (reg.installing && 'installing') || (reg.waiting && 'waiting') || 'unknown';
  });
  check(swState === 'activated' || swState === 'activating', `service worker registration ready (${swState})`);
  let cacheInfo = { name: null, entries: 0, opencv: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    cacheInfo = await page.evaluate(async () => {
      const keys = await caches.keys();
      let best = { name: null, entries: 0, opencv: false };
      for (const k of keys) {
        if (!k.startsWith('sda-')) continue;
        const c = await caches.open(k);
        const reqs = await c.keys();
        const info = { name: k, entries: reqs.length, opencv: reqs.some((r) => r.url.endsWith('/vendor/opencv.js')) };
        if (info.entries > best.entries) best = info;
      }
      return best;
    });
    if (cacheInfo.entries >= 10 && cacheInfo.opencv) break;
    await sleep(1000);
  }
  check(!!cacheInfo.name && cacheInfo.entries >= 10, `precache '${cacheInfo.name}' has ${cacheInfo.entries} entries (>= 10)`);
  check(cacheInfo.opencv, 'vendor/opencv.js is precached');
  const cachedIndex = await page.evaluate(async () => !!(await caches.match(new URL('./index.html', location.href).href, { ignoreSearch: true })));
  check(cachedIndex, 'index.html is in the cache (navigation fallback)');

  // --- Printable target: standalone page ---
  await page.goto(base + 'target.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  check(await page.locator('svg').count() === 1, 'target.html renders one svg');
  check(await page.locator('svg g.marker').count() === 4, 'target.html has 4 marker groups');
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('svg g.marker')).map((g) => g.dataset.id).join(','));
  check(ids === '0,1,2,3', `marker ids ${ids}`);
  const svgAttrs = await page.evaluate(() => { const s = document.querySelector('svg'); return `${s.getAttribute('width')} ${s.getAttribute('height')} ${s.getAttribute('viewBox')}`; });
  check(svgAttrs === '210mm 297mm 0 0 210 297', `svg size attributes (${svgAttrs})`);
  const svgText = await page.locator('svg').textContent();
  check(/Контрольный отрезок 100 мм/.test(svgText || ''), 'control segment text present');
  const ctrlLen = await page.evaluate(() => { const l = document.querySelector('svg g.control line'); return l ? Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) : NaN; });
  check(ctrlLen === 100, `control segment is exactly 100 mm (${ctrlLen})`);
  check(await page.locator('button:has-text("Печать")').count() === 1, 'target.html has a print button');

  // --- Target inside the app ---
  await page.goto(base + '#/target', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  check(await page.locator('#screen svg').count() === 1, '#/target renders the svg');
  check(await page.locator('#screen svg g.marker').count() === 4, '#/target svg has 4 markers');
  check(await page.locator('#screen button:has-text("Печать")').count() === 1, '#/target has a print button');
  const svgW = await page.locator('#screen svg').evaluate((el) => el.getBoundingClientRect().width);
  check(svgW > 200 && svgW <= 412, `#/target svg fits the viewport width (${Math.round(svgW)}px)`);

  // --- Synthetic accuracy test (needs src/vision/pipeline.js from the vision agent) ---
  const pipelinePath = path.join(root, 'src/vision/pipeline.js');
  const tWait = Date.now();
  while (!existsSync(pipelinePath) && Date.now() - tWait < PIPELINE_WAIT_MS) {
    console.log('  ... waiting for src/vision/pipeline.js');
    await sleep(5000);
  }
  if (existsSync(pipelinePath)) {
    await page.goto(base + '#/test', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__app, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    check(await page.locator('#screen button:has-text("Запустить")').count() === 1, '#/test has the run button');
    check(await page.locator('#screen button:has-text("Проверить")').count() === 1, '#/test has the photo check button');
    await page.waitForFunction(() => window.__app.readyState.vision !== 'loading', null, { timeout: 120000 });
    const rs = await page.evaluate(() => window.__app.readyState);
    check(rs.vision === 'ready', `vision worker ready (opencv ${rs.opencvVersion})`);
    if (rs.vision === 'ready') {
      await page.waitForFunction(() => { const b = Array.from(document.querySelectorAll('#screen button')).find((x) => /Запустить/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 10000 });
      // The printed target itself must be readable by the detector: rasterise the SVG and run analyze().
      const targetDetect = await page.evaluate(async () => {
        const { targetSvgDataUrl } = await import('./src/testing/targetSvg.js');
        const img = new Image();
        img.src = targetSvgDataUrl({});
        await img.decode();
        const pxPerMm = 3;
        const c = document.createElement('canvas'); c.width = Math.round(210 * pxPerMm); c.height = Math.round(297 * pxPerMm);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const data = g.getImageData(0, 0, c.width, c.height);
        const r = await window.__app.vision.analyze(data, window.__app.settings);
        return { ok: r.ok, markersFound: r.target ? r.target.markersFound : 0, ids: r.target ? r.target.ids : [], pxPerMm: r.quality ? r.quality.pxPerMmAtTarget : null, reproj: r.quality ? r.quality.reprojMaxPx : null, error: r.error || null };
      });
      check(targetDetect.markersFound === 4 && [0, 1, 2, 3].every((i) => targetDetect.ids.includes(i)), `rasterised target.svg: detector finds 4 markers ${JSON.stringify(targetDetect.ids)} (reproj ${targetDetect.reproj && targetDetect.reproj.toFixed ? targetDetect.reproj.toFixed(2) : targetDetect.reproj} px, ${targetDetect.pxPerMm && targetDetect.pxPerMm.toFixed ? targetDetect.pxPerMm.toFixed(2) : targetDetect.pxPerMm} px/mm)`);
      check(targetDetect.pxPerMm === null || Math.abs(targetDetect.pxPerMm - 3) < 0.1, `target scale from markers ${targetDetect.pxPerMm} ≈ 3 px/mm`);

      await page.locator('#screen button:has-text("Запустить")').click();
      await page.waitForFunction(() => window.__testRunning === true || !!window.__testResult, null, { timeout: 5000 });
      await page.waitForFunction(() => !!window.__testResult, null, { timeout: SYNTH_TIMEOUT_MS });
      const res = await page.evaluate(() => window.__testResult);
      check(res && Array.isArray(res.scenes) && res.scenes.length === 2, `synthetic test produced ${res && res.scenes ? res.scenes.length : 0} scenes`);
      for (const s of (res && res.scenes) || []) {
        const sm = s.summary || {};
        console.log(`      ${s.name}: n=${sm.n} matched=${sm.matched} maxErr=${sm.maxErrMm} mean=${sm.meanErrMm} within=${sm.withinTolPct}% extra=${sm.unmatchedMeasured} analyze=${s.timeMs}ms render=${s.renderMs}ms${s.error ? ' error=' + JSON.stringify(s.error) : ''}`);
        check(sm.withinTolPct === 100, `${s.name}: 100 % within ±2 mm (got ${sm.withinTolPct} %)`);
        check(sm.maxErrMm !== null && sm.maxErrMm <= 1.5, `${s.name}: max error ${sm.maxErrMm} mm <= 1.5`);
        check(!sm.unmatchedMeasured, `${s.name}: no extra parts (${sm.unmatchedMeasured})`);
      }
      const tableRows = await page.locator('#screen table.table tbody tr').count();
      check(tableRows >= 7, `result tables rendered (${tableRows} rows)`);
    }
  } else {
    console.log('  skip synthetic test (src/vision/pipeline.js not present)');
  }

  const benign = (e) => /db\.js|share\.js|manifest|favicon|404|Failed to load resource/i.test(e);
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
console.log(failed ? `smoke-pwa: ${failed} failure(s)` : 'smoke-pwa: all checks passed');
process.exit(failed ? 1 : 0);
