// App bootstrap: service worker, database, settings, vision worker, router, navigation chrome.
import { createRouter } from './router.js';
import { h, clear, toast, confirmDialog, vibrate as vibrateFn } from './ui/components.js';
import { createVisionClient } from './vision/client.js';
import { defaultSettings, mergeSettings } from './settings.js';

const SCREENS = {
  camera: () => import('./ui/camera.js'),
  result: () => import('./ui/result.js'),
  compare: () => import('./ui/compare.js'),
  orders: () => import('./ui/orders.js'),
  remnants: () => import('./ui/remnants.js'),
  settings: () => import('./ui/settings.js'),
  test: () => import('./ui/test.js'),
  help: () => import('./ui/help.js'),
  target: () => import('./ui/target.js'),
};
const TOP_LEVEL = new Set(['camera', 'orders', 'remnants', 'settings']);
const NAV_OF = { camera: 'camera', result: 'camera', compare: 'camera', orders: 'orders', order: 'orders', remnants: 'remnants', settings: 'settings', test: 'settings', help: 'settings', target: 'settings' };

function setBanner(text, kind = 'info') {
  const el = document.getElementById('banner');
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ''; el.className = ''; return; }
  el.hidden = false; el.textContent = text; el.className = kind === 'error' ? 'banner-error' : '';
}

async function main() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  }

  let db = null;
  try {
    const mod = await import('./store/db.js');
    db = await mod.openDb();
  } catch (e) {
    console.error('DB unavailable', e);
    setBanner('База данных недоступна: ' + (e.message || e), 'error');
  }

  let settings = defaultSettings();
  try { if (db) settings = await db.getSettings(); } catch (e) { console.warn('settings load failed', e); }

  const vision = createVisionClient();
  const readyState = { vision: 'loading', db: db ? 'ok' : 'error', opencvVersion: null };
  setBanner('Загрузка OpenCV…');
  vision.ready.then((info) => {
    readyState.vision = 'ready';
    readyState.opencvVersion = info.opencvVersion;
    setBanner('');
  }).catch((e) => {
    readyState.vision = 'error';
    setBanner('Модуль зрения не загрузился: ' + (e.message || e), 'error');
  });

  const ctx = {
    db,
    settings,
    readyState,
    async saveSettings(patch) {
      if (db) ctx.settings = await db.saveSettings(patch);
      else ctx.settings = mergeSettings(ctx.settings, patch);
      return ctx.settings;
    },
    vision,
    navigate: null,
    toast,
    confirmDialog,
    vibrate(ms = 60) { if (ctx.settings?.ui?.vibrate !== false) vibrateFn(ms); },
    state: { mode: 'batch', currentOrderId: null, lastMeasurementId: null, lastPhoto: null, lastResult: null },
  };
  try {
    const savedMode = localStorage.getItem('sda.mode');
    if (savedMode) ctx.state.mode = savedMode;
    const savedOrder = localStorage.getItem('sda.currentOrderId');
    if (savedOrder) ctx.state.currentOrderId = savedOrder;
  } catch { /* ignore */ }

  const root = document.getElementById('screen');
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('back');
  const navLinks = Array.from(document.querySelectorAll('#nav a'));
  const router = createRouter({
    root,
    screens: SCREENS,
    ctx,
    onRoute(route, mod) {
      titleEl.textContent = mod.title || 'Замер деталей';
      backBtn.hidden = TOP_LEVEL.has(route.name);
      clear(document.getElementById('header-extra'));
      const navName = NAV_OF[route.name] || 'camera';
      navLinks.forEach((a) => a.classList.toggle('active', a.dataset.nav === navName));
    },
  });
  ctx.navigate = (hash) => router.navigate(hash);
  backBtn.addEventListener('click', () => {
    if (history.length > 1) history.back(); else router.navigate('#/camera');
  });
  window.addEventListener('error', (e) => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
  window.__app = ctx;
  await router.start();
}

main().catch((e) => {
  console.error(e);
  const root = document.getElementById('screen');
  if (root) root.appendChild(h('div', { class: 'error-box' }, 'Приложение не запустилось: ' + (e.message || e)));
});
