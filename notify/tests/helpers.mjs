// Shared test helpers: in-memory app + mock YCLIENTS / Telegram servers.
import http from 'node:http';
import { openDb } from '../src/db.js';
import { App } from '../src/app.js';
import { createServer } from '../src/api.js';

export function makeConfig(over = {}) {
  return { port: 0, host: '127.0.0.1', dataDir: '/tmp', dbFile: ':memory:', publicUrl: '', adminToken: 'admin-secret', apiToken: 'api-secret', tickSec: 3600, syncIntervalSec: 300, horizonDays: 14,
    seed: { yclients: { partnerToken: '', login: '', password: '', userToken: '', companyId: 0, baseUrl: '' }, channels: { log: { enabled: true } } }, ...over };
}

/** Mock YCLIENTS API. `state.records` is the list returned by GET /records; PUT bodies are collected in `state.updates`. */
export function mockYclients(state = {}) {
  state.records ??= []; state.updates = []; state.requests = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body) : null });
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (!/^Bearer /.test(req.headers.authorization || '')) return json(401, { success: false, meta: { message: 'Необходима авторизация' } });
      if (req.method === 'POST' && url.pathname === '/api/v1/auth') {
        const b = JSON.parse(body);
        if (b.login === 'admin@salon.ru' && b.password === 'pass') return json(201, { success: true, data: { id: 7, user_token: 'USERTOKEN', name: 'Админ', login: b.login } });
        if (b.login === '2fa@salon.ru') return json(200, { success: true, data: { uuid: 'u', flow: 'login', transport: { type: 'email' } } });
        return json(401, { success: false, meta: { message: 'Неверный логин или пароль' } });
      }
      if (!/User /.test(req.headers.authorization)) return json(401, { success: false, meta: { message: 'Нужен user token' } });
      if (req.method === 'GET' && url.pathname === '/api/v1/companies') return json(200, { success: true, data: [{ id: 4564, title: 'Салон «Тест»', address: 'ул. Ленина, 1', city: 'Москва' }] });
      if (req.method === 'GET' && /^\/api\/v1\/company\/\d+\/$/.test(url.pathname)) return json(200, { success: true, data: { id: 4564, title: 'Салон «Тест»', address: 'ул. Ленина, 1', phone: '+7 495 000-00-00', timezone_name: 'Europe/Moscow', site: 'salon.test' } });
      if (req.method === 'GET' && /^\/api\/v1\/records\/\d+$/.test(url.pathname)) {
        const page = Number(url.searchParams.get('page') || 1), count = Number(url.searchParams.get('count') || 200);
        const items = state.records.slice((page - 1) * count, page * count);
        return json(200, { success: true, data: items, meta: { page, total_count: state.records.length } });
      }
      const rec = url.pathname.match(/^\/api\/v1\/record\/(\d+)\/(\d+)$/);
      if (rec) {
        const r = state.records.find((x) => x.id === Number(rec[2]));
        if (!r) return json(404, { success: false, meta: { message: 'Запись не найдена' } });
        if (req.method === 'PUT') { const b = JSON.parse(body); state.updates.push({ id: r.id, body: b }); r.attendance = b.attendance; r.visit_attendance = b.attendance; return json(201, { success: true, data: r }); }
        return json(200, { success: true, data: r });
      }
      json(404, { success: false, meta: { message: 'not found' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, state, close: () => new Promise((r) => server.close(r)) })));
}

/** Mock Telegram Bot API: records every call in `calls`, answers getUpdates with queued updates. */
export function mockTelegramFetch() {
  const calls = []; let updates = []; let msgId = 100;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    const m = u.match(/\/bot([^/]+)\/(\w+)$/);
    if (!m) return realFetch(url, init);
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method: m[2], body });
    const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (m[2] === 'sendMessage') { if (String(body.chat_id) === '403') return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403 }); return ok({ message_id: ++msgId, chat: { id: body.chat_id } }); }
    if (m[2] === 'getUpdates') { const u2 = updates; updates = []; return ok(u2); }
    return ok(true);
  };
  return { fetchImpl, calls, pushUpdate: (u) => updates.push(u) };
}
const realFetch = globalThis.fetch;

export function record(over = {}) {
  const start = over.start ?? new Date(Date.now() + 26 * 3600e3);
  const iso = (d) => { const p = new Date(d).toISOString().slice(0, 19); return p + '+00:00'; };
  return { id: over.id ?? 1, company_id: 4564, staff_id: 9, staff: { id: 9, name: 'Оксана Иванова' }, services: [{ id: 1, title: 'Стрижка', cost: 1500 }],
    client: over.client === null ? null : { id: 55, name: 'Анна', surname: 'Петрова', phone: over.phone ?? '79161234567', email: '' },
    date: iso(start).slice(0, 19).replace('T', ' '), datetime: iso(start), create_date: iso(over.created ?? new Date(Date.now() - 60e3)), comment: '', online: true, visit_attendance: over.attendance ?? 0, attendance: over.attendance ?? 0, confirmed: 0,
    seance_length: 3600, length: 3600, deleted: over.deleted ?? false, last_change_date: iso(over.changed ?? new Date()), review_link: 'https://yc.gl/e/x/', short_link: 'https://yc.gl/c/x/' };
}

export async function makeApp({ yclients, fetchImpl, channels, settings } = {}) {
  const db = openDb(':memory:');
  const cfg = makeConfig();
  if (yclients) cfg.seed.yclients = { partnerToken: 'PARTNER', userToken: 'USERTOKEN', companyId: 4564, baseUrl: yclients.url, login: '', password: '' };
  if (channels) cfg.seed.channels = channels;
  const app = new App(cfg, db, { fetchImpl: fetchImpl || globalThis.fetch, logger: { log() {} } });
  if (settings) db.setSetting('general', { ...app.general, ...settings });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = 'admin-secret') => {
    const res = await realFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return { app, db, server, base, call, close: async () => { app.stop(); await new Promise((r) => server.close(r)); db.close(); } };
}
