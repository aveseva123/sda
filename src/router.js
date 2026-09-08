// Hash router with lazy screen modules. Routes: '#/name' or '#/name/:id'.
import { clear, h } from './ui/components.js';

const ROUTES = [
  { name: 'camera', pattern: /^camera$/ },
  { name: 'result', pattern: /^result\/([^/]+)$/, params: ['id'] },
  { name: 'compare', pattern: /^compare\/([^/]+)$/, params: ['id'] },
  { name: 'orders', pattern: /^orders$/ },
  { name: 'order', pattern: /^orders\/([^/]+)$/, params: ['id'], module: 'orders' },
  { name: 'remnants', pattern: /^remnants$/ },
  { name: 'settings', pattern: /^settings$/ },
  { name: 'test', pattern: /^test$/ },
  { name: 'help', pattern: /^help$/ },
  { name: 'target', pattern: /^target$/ },
];

export function parseHash(hash) {
  const path = (hash || '').replace(/^#\/?/, '').replace(/\/+$/, '') || 'camera';
  for (const r of ROUTES) {
    const m = path.match(r.pattern);
    if (m) {
      const params = {};
      (r.params || []).forEach((p, i) => { params[p] = decodeURIComponent(m[i + 1]); });
      return { name: r.name, module: r.module || r.name, params, path };
    }
  }
  return { name: 'camera', module: 'camera', params: {}, path: 'camera' };
}

export function createRouter({ root, screens, ctx, onRoute = null }) {
  let cleanup = null;
  let current = null;
  let seq = 0;

  async function render() {
    const route = parseHash(location.hash);
    const mySeq = ++seq;
    if (cleanup) { try { await cleanup(); } catch (e) { console.warn('cleanup failed', e); } cleanup = null; }
    clear(root);
    root.appendChild(h('div', { class: 'screen-loading' }, 'Загрузка…'));
    let mod;
    try {
      const loader = screens[route.module];
      if (!loader) throw new Error(`Нет экрана ${route.module}`);
      mod = await loader();
    } catch (e) {
      console.error(e);
      if (mySeq !== seq) return;
      clear(root);
      root.appendChild(h('div', { class: 'error-box' }, `Не удалось открыть раздел: ${e.message || e}`));
      return;
    }
    if (mySeq !== seq) return;
    current = route;
    clear(root);
    root.dataset.screen = route.name;
    if (onRoute) onRoute(route, mod);
    try {
      const c = await mod.mount(root, ctx, route.params);
      if (typeof c === 'function') cleanup = c;
    } catch (e) {
      console.error(e);
      clear(root);
      root.appendChild(h('div', { class: 'error-box' }, `Ошибка экрана: ${e.message || e}`));
    }
  }

  return {
    navigate(hash) {
      const target = hash.startsWith('#') ? hash : `#/${hash.replace(/^\/+/, '')}`;
      if (location.hash === target) render(); else location.hash = target;
    },
    get current() { return current; },
    start() {
      window.addEventListener('hashchange', render);
      if (!location.hash) location.replace('#/camera');
      return render();
    },
    render,
  };
}
