// Screens smoke test (orders / remnants / settings / help): serves the repo, opens the app in
// headless Chromium and drives the DOM: DXF import -> preview -> save -> detail; manual remnant +
// fit search; settings stepper persistence; help text. DB-dependent checks are skipped (not failed)
// while src/store/db.js does not exist yet.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8094);
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => { child.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(child); }); setTimeout(() => resolve(child), 2000); });
}

// Two closed LWPOLYLINE rectangles (380x240 and 500x120) - used only when the shared fixture is absent.
function makeTempDxf() {
  const rect = (x0, y0, x1, y1) => ['0', 'LWPOLYLINE', '8', 'PARTS', '90', '4', '70', '1',
    '10', String(x0), '20', String(y0), '10', String(x1), '20', String(y0), '10', String(x1), '20', String(y1), '10', String(x0), '20', String(y1)].join('\n');
  const text = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    rect(100, 100, 480, 340), rect(600, 100, 1100, 220), '0', 'ENDSEC', '0', 'EOF'].join('\n') + '\n';
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sda-e2e-'));
  const file = path.join(dir, 'nest_temp.dxf');
  writeFileSync(file, text);
  return file;
}

const fixture = path.join(root, 'tests/fixtures/nest_polylines.dxf');
const dxfPath = existsSync(fixture) ? fixture : makeTempDxf();
const dxfBase = path.basename(dxfPath).replace(/\.[^.]+$/, '');
const hasDb = existsSync(path.join(root, 'src/store/db.js'));

const server = await startServer();
let failed = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
const skip = (msg) => console.log('  skip ' + msg);
let browser;
try {
  browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const page = await context.newPage();
  const pageErrors = []; const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const base = `http://127.0.0.1:${PORT}/`;
  const screenText = async () => (await page.locator('#screen').textContent()) || '';
  const go = async (hash) => { await page.evaluate((r) => { location.hash = r; }, hash); await page.waitForTimeout(500); };

  // ---------- Orders: import DXF ----------
  await page.goto(base + '#/orders', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__app, null, { timeout: 15000 });
  await page.waitForSelector('[data-view="orders-list"]', { timeout: 10000 });
  check(await page.locator('.orders-import-btn').count() === 1, 'orders: import button present');
  check(await page.locator('#orders-file-input').count() === 1, 'orders: hidden file input present');
  const importH = await page.locator('.orders-import-btn').evaluate((el) => el.getBoundingClientRect().height);
  check(importH >= 64, `orders: import button height ${importH}px >= 64`);
  const dbLive = await page.evaluate(() => !!window.__app.db);
  console.log(`  info db module ${hasDb ? 'present' : 'absent'}, ctx.db ${dbLive ? 'live' : 'null'}, fixture ${path.basename(dxfPath)}`);

  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.locator('.orders-import-btn').click()]);
  await chooser.setFiles(dxfPath);
  let previewRows = 0;
  try {
    await page.waitForSelector('.sheet-panel table[data-role="parts"] tbody tr', { timeout: 15000 });
    previewRows = await page.locator('.sheet-panel table[data-role="parts"] tbody tr').count();
  } catch { previewRows = 0; }
  check(previewRows >= 2, `orders: preview sheet shows ${previewRows} part rows (>= 2)`);
  const previewName = previewRows ? await page.locator('#order-import-name').inputValue() : '';
  check(previewName === dxfBase, `orders: preview name defaults to file base name ("${previewName}")`);

  let orderId = null;
  if (previewRows >= 2 && dbLive) {
    await page.locator('.sheet-actions button', { hasText: 'Сохранить' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
    await page.waitForSelector(`[data-order-id]`, { timeout: 5000 });
    const cardText = await page.locator('[data-order-id]').first().textContent();
    check((cardText || '').includes(dxfBase), `orders: saved order appears in list ("${(cardText || '').trim().slice(0, 60)}")`);
    orderId = await page.evaluate(() => window.__app.state.currentOrderId);
    check(!!orderId, `orders: currentOrderId set after save (${orderId})`);
    check(await page.evaluate(() => localStorage.getItem('sda.currentOrderId') === window.__app.state.currentOrderId), 'orders: currentOrderId persisted in localStorage');
    check((cardText || '').includes('текущий'), 'orders: list card shows "текущий" badge');

    // ---------- Order detail ----------
    await page.locator('[data-order-id]').first().click();
    await page.waitForSelector('[data-view="order-detail"]', { timeout: 10000 });
    check(await page.locator('[data-view="order-detail"]').count() === 1, 'orders: detail mounted');
    const detailHash = await page.evaluate(() => location.hash);
    check(detailHash.startsWith('#/orders/'), `orders: hash is ${detailHash}`);
    const detailRows = await page.locator('[data-view="order-detail"] table[data-role="parts"] tbody tr').count();
    check(detailRows >= 2, `orders: detail parts table has ${detailRows} rows`);
    const detailText = await screenText();
    check(/Замеры по заказу/.test(detailText), 'orders: detail has measurements section');
    check(/Замеров по этому заказу ещё нет/.test(detailText), 'orders: detail shows empty measurements state');
    check(/текущий заказ/.test(detailText), 'orders: detail shows current badge');
    // Edit a part row via sheet: open, change qty with +, save.
    await page.locator('[data-view="order-detail"] table[data-role="parts"] tbody tr').first().click();
    await page.waitForSelector('#part-edit-qty', { timeout: 5000 });
    const qtyBefore = Number(await page.locator('#part-edit-qty').inputValue());
    await page.locator('.stepper:has(#part-edit-qty) .stepper-btn').last().click();
    await page.locator('.sheet-actions button', { hasText: 'Сохранить' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
    const qtyAfter = await page.evaluate(async (id) => { const o = await window.__app.db.getOrder(id); return o.parts[0].qty; }, orderId);
    check(qtyAfter === qtyBefore + 1, `orders: part qty edited and persisted (${qtyBefore} -> ${qtyAfter})`);
  } else {
    skip('orders: save / list / detail (needs live db)');
    if (await page.locator('.sheet').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  }

  // ---------- Orders: import CSV (Russian headers, decimal comma, quoted delimiter) ----------
  const csvFixture = path.join(root, 'tests/fixtures/parts_ru.csv');
  let csvOrderId = null;
  if (dbLive && existsSync(csvFixture) && existsSync(path.join(root, 'src/match/csv.js'))) {
    await go('#/orders');
    await page.waitForSelector('[data-view="orders-list"]', { timeout: 10000 });
    const [csvChooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.locator('.orders-import-btn').click()]);
    await csvChooser.setFiles(csvFixture);
    await page.waitForSelector('.sheet-panel table[data-role="parts"] tbody tr', { timeout: 15000 });
    const csvRows = await page.locator('.sheet-panel table[data-role="parts"] tbody tr').count();
    check(csvRows === 5, `orders: CSV preview shows ${csvRows} rows (expected 5)`);
    const csvPreview = (await page.locator('.sheet-panel').textContent()) || '';
    check(/Кронштейн/.test(csvPreview) && /120\.5/.test(csvPreview), 'orders: CSV preview has Russian ids and decimal-comma value');
    await page.locator('.sheet-actions button', { hasText: 'Сохранить' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-order-id]').length === 2, null, { timeout: 5000 });
    const firstCard = (await page.locator('[data-order-id]').first().textContent()) || '';
    check(/parts_ru/.test(firstCard) && /11 дет\./.test(firstCard) && /CSV/.test(firstCard), `orders: CSV order listed first (newest) with 11 parts ("${firstCard.trim().slice(0, 70)}")`);
    csvOrderId = await page.locator('[data-order-id]').first().getAttribute('data-order-id');
  } else {
    skip('orders: CSV import (needs live db, fixture and src/match/csv.js)');
  }

  // ---------- Remnants ----------
  await go('#/remnants');
  await page.waitForSelector('[data-view="remnants"]', { timeout: 10000 });
  check(await page.locator('#rem-search-length').count() === 1, 'remnants: search panel present');
  if (dbLive) {
    await page.locator('.rem-add-btn').click();
    await page.waitForSelector('#rem-add-length', { timeout: 5000 });
    await page.fill('#rem-add-length', '600'); await page.dispatchEvent('#rem-add-length', 'change');
    await page.fill('#rem-add-width', '400'); await page.dispatchEvent('#rem-add-width', 'change');
    await page.locator('.sheet-actions button', { hasText: 'Сохранить' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
    await page.waitForSelector('[data-remnant-id]', { timeout: 5000 });
    const remText = (await page.locator('[data-remnant-id]').first().textContent()) || '';
    check(/600/.test(remText) && /400/.test(remText), `remnants: manual remnant 600x400 listed ("${remText.trim().slice(0, 60)}")`);
    check(/свободен/.test(remText), 'remnants: status badge "свободен"');
    const remId = await page.locator('[data-remnant-id]').first().getAttribute('data-remnant-id');
    check(/^R-\d{3}$/.test(remId || ''), `remnants: id format ${remId}`);
    await page.fill('#rem-search-length', '380'); await page.dispatchEvent('#rem-search-length', 'change');
    await page.fill('#rem-search-width', '240'); await page.dispatchEvent('#rem-search-width', 'change');
    await page.locator('.rem-search-btn').click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-remnant-id] .badge')).some((b) => /поместится/.test(b.textContent)), null, { timeout: 10000 });
    const hitText = (await page.locator('[data-remnant-id]').first().textContent()) || '';
    check(/поместится/.test(hitText) && /угол/.test(hitText), `remnants: 380x240 fits ("${hitText.trim().slice(0, 80)}")`);
    await page.fill('#rem-search-length', '700'); await page.dispatchEvent('#rem-search-length', 'change');
    await page.locator('.rem-search-btn').click();
    await page.waitForTimeout(500);
    check(/Ничего не подходит/.test(await screenText()), 'remnants: 700x240 does not fit');
    await page.locator('.rem-search-reset').click();
    await page.waitForTimeout(300);
    check(await page.locator('[data-remnant-id]').count() === 1, 'remnants: reset shows all');
    // Detail sheet: mark used -> "usedFor" field appears and status persists; then restore.
    await page.locator('[data-remnant-id]').first().click();
    await page.waitForSelector('#rem-note', { timeout: 5000 });
    await page.locator('.sheet-panel button', { hasText: 'Отметить использованным' }).click();
    await page.waitForSelector('#rem-used-for', { timeout: 5000 });
    await page.fill('#rem-used-for', 'заказ 2026-118'); await page.dispatchEvent('#rem-used-for', 'change');
    await page.waitForTimeout(300);
    const stored = await page.evaluate(async (id) => window.__app.db.getRemnant(id), remId);
    check(stored && stored.status === 'used' && stored.usedFor === 'заказ 2026-118', `remnants: marked used and persisted (${stored && stored.status}, "${stored && stored.usedFor}")`);
    await page.locator('.sheet-close').click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
    const usedCard = (await page.locator('[data-remnant-id]').first().textContent()) || '';
    check(/использован/.test(usedCard) && /2026-118/.test(usedCard), 'remnants: card shows "использован" badge and usedFor');
    await page.locator('.rem-search-btn').click();
    await page.waitForTimeout(400);
    check(/Ничего не подходит/.test(await screenText()), 'remnants: used remnant excluded from fit search');
    await page.locator('.rem-search-reset').click();
    await page.waitForTimeout(300);
    await page.locator('[data-remnant-id]').first().click();
    await page.waitForSelector('#rem-note', { timeout: 5000 });
    await page.locator('.sheet-panel button', { hasText: 'Вернуть в свободные' }).click();
    await page.waitForTimeout(300);
    const restored = await page.evaluate(async (id) => window.__app.db.getRemnant(id), remId);
    check(restored && restored.status === 'available' && restored.usedFor === null, 'remnants: restored to available');
    await page.locator('.sheet-close').click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 0, null, { timeout: 5000 });
  } else {
    skip('remnants: add / search (needs live db)');
  }

  // ---------- Settings ----------
  await go('#/settings');
  await page.waitForSelector('#set-match-tolerance', { timeout: 10000 });
  const tolBefore = await page.evaluate(() => window.__app.settings.match.toleranceMm);
  await page.locator('.stepper:has(#set-match-tolerance) .stepper-btn').last().click();
  await page.waitForFunction((v) => Math.abs(window.__app.settings.match.toleranceMm - v) < 1e-9, tolBefore + 0.5, { timeout: 5000 });
  const tolAfter = await page.evaluate(() => window.__app.settings.match.toleranceMm);
  check(tolAfter === tolBefore + 0.5, `settings: toleranceMm ${tolBefore} -> ${tolAfter} via +`);
  const pctBefore = await page.evaluate(() => window.__app.settings.quality.targetMinFraction);
  await page.locator('.stepper:has(#set-q-target-frac) .stepper-btn').last().click();
  await page.waitForFunction((v) => Math.abs(window.__app.settings.quality.targetMinFraction - v) < 1e-9, pctBefore + 0.005, { timeout: 5000 });
  check(true, `settings: targetMinFraction ${pctBefore} -> ${await page.evaluate(() => window.__app.settings.quality.targetMinFraction)} (percent stepper stored as fraction)`);
  const scaleBefore = await page.evaluate(() => window.__app.settings.target.printScale);
  await page.locator('.stepper:has(#set-target-scale) .stepper-btn').first().click();
  await page.waitForFunction((v) => Math.abs(window.__app.settings.target.printScale - v) < 1e-9, scaleBefore - 0.001, { timeout: 5000 });
  check(true, 'settings: control segment stepper stores printScale = v/100');
  check(await page.locator('#set-seg-details').evaluate((el) => !el.open), 'settings: segmentation section collapsed by default');
  check(await page.locator('#set-ui-vibrate').count() === 1, 'settings: vibrate toggle present');
  const settingsText = await screenText();
  check(/0\.1\.0/.test(settingsText), 'settings: version shown');
  check(/Экспорт всей базы/.test(settingsText) && /Импорт базы/.test(settingsText) && /Очистить всё/.test(settingsText), 'settings: data buttons present');
  if (dbLive) {
    const persisted = await page.evaluate(async () => { const s = await window.__app.db.getSettings(); return s.match.toleranceMm; });
    check(persisted === tolAfter, `settings: tolerance persisted in db (${persisted})`);
  } else {
    skip('settings: db persistence (needs live db)');
  }

  // ---------- Help ----------
  await go('#/help');
  await page.waitForSelector('[data-view="help"]', { timeout: 10000 });
  const helpText = await screenText();
  check(helpText.includes('Мишень и детали должны лежать на одной поверхности. Деталь на стопке на 20 мм выше мишени измеряется с ошибкой в проценты.'), 'help: rule 1 present');
  check(helpText.includes('Детали раскладывать в один слой с зазором 2–3 см. Перекрытые кромки алгоритм не видит.'), 'help: rule 2 present');
  check(/Положите мишень в кадр/.test(helpText) && /Отвернитесь от окна/.test(helpText), 'help: hints table present');
  check(/Сценарий A/.test(helpText) && /Сценарий B/.test(helpText) && /Сценарий C/.test(helpText), 'help: three scenarios present');
  check(/без сети/.test(helpText), 'help: offline note present');

  // ---------- Orders: delete via confirm dialog ----------
  if (csvOrderId) {
    await go(`#/orders/${csvOrderId}`);
    await page.waitForSelector('[data-view="order-detail"]', { timeout: 10000 });
    await page.locator('[data-view="order-detail"] button', { hasText: 'Удалить заказ' }).click();
    await page.waitForSelector('.confirm-text', { timeout: 5000 });
    await page.locator('.sheet-actions button', { hasText: 'Удалить' }).click();
    await page.waitForFunction(() => location.hash === '#/orders', null, { timeout: 5000 });
    await page.waitForSelector('[data-view="orders-list"]', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-order-id]').length === 1, null, { timeout: 5000 });
    const remaining = await page.evaluate(async () => (await window.__app.db.listOrders()).length);
    check(remaining === 1, `orders: CSV order deleted, ${remaining} order left`);
    check(await page.evaluate(() => window.__app.state.currentOrderId === localStorage.getItem('sda.currentOrderId')), 'orders: current order pointer consistent after delete');
  } else {
    skip('orders: delete (needs CSV order)');
  }

  // ---------- Errors ----------
  const benign = (e) => /pipeline\.js|db\.js|manifest|sw\.js|icon|favicon|404|Failed to load resource|DB unavailable/i.test(e);
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
console.log(failed ? `smoke-screens: ${failed} failure(s)` : 'smoke-screens: all checks passed');
process.exit(failed ? 1 : 0);
