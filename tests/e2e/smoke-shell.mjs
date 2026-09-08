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
