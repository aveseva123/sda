// HTTP API: public send API (/api/v1), admin API (/admin), webhooks (/webhooks), static panel (/).
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, readJson, readBody, sendJson, bearer, serveStatic } from './http.js';
import { normalizePhone, formatPhone } from './phone.js';
import { RULE_TYPES } from './rules.js';
import { VARIABLES_HELP, render, recordVars } from './templates.js';
import { CHANNEL_INFO } from './channels/index.js';
import { ATTENDANCE_LABEL } from './yclients.js';
import { applyRecord } from './sync.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SECRET_KEYS = ['password', 'partnerToken', 'userToken', 'botToken', 'accessToken', 'verifyToken', 'appSecret'];
const MASK = '••••••••';

function maskSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET_KEYS.includes(k) ? (v ? MASK : '') : (v && typeof v === 'object' ? maskSecrets(v) : v);
  return out;
}
function unmaskSecrets(incoming, current) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const out = Array.isArray(incoming) ? [] : {};
  for (const [k, v] of Object.entries(incoming)) {
    if (SECRET_KEYS.includes(k) && v === MASK) out[k] = current?.[k] ?? '';
    else out[k] = v && typeof v === 'object' ? unmaskSecrets(v, current?.[k]) : v;
  }
  return out;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export function createServer(app) {
  const { db, config } = app;
  const r = new Router();

  const requireToken = (req, token, what) => {
    if (!token) throw new HttpError(503, `${what} не задан в конфигурации сервера`);
    if (!safeEqual(bearer(req), token)) throw new HttpError(401, 'Неверный токен');
  };
  const admin = (h) => async (req, res, params, url) => { requireToken(req, config.adminToken, 'ADMIN_TOKEN'); return h(req, res, params, url); };
  const api = (h) => async (req, res, params, url) => { if (!(safeEqual(bearer(req), config.apiToken) || safeEqual(bearer(req), config.adminToken))) throw new HttpError(401, 'Неверный токен'); return h(req, res, params, url); };
  const num = (v, d) => (v == null || v === '' ? d : Number(v));

  r.get('/health', async () => ({ ok: true, yclients: app.yclientsReady, channels: Object.keys(app.channels), time: new Date().toISOString() }));

  // ---- public API --------------------------------------------------------------------------
  r.post('/api/v1/messages', api(async (req) => {
    const b = await readJson(req);
    const msg = await app.enqueue({ phone: b.phone, text: b.text, channels: b.channels, buttons: b.buttons, source: 'api', meta: b.meta });
    return { status: 201, body: present(msg) };
  }));
  r.get('/api/v1/messages', api(async (req, res, p, url) => db.listMessages({ status: url.searchParams.get('status'), phone: normalizePhone(url.searchParams.get('phone')), limit: num(url.searchParams.get('limit'), 100), offset: num(url.searchParams.get('offset'), 0) }).map(present)));
  r.get('/api/v1/messages/:id', api(async (req, res, p) => { const m = db.getMessage(Number(p.id)); if (!m) throw new HttpError(404, 'Сообщение не найдено'); return { ...present(m), attempts: db.attemptsForMessage(m.id) }; }));
  r.get('/api/v1/schedule', api(async (req, res, p, url) => scheduleView(app, url)));
  r.get('/api/v1/contacts', api(async (req, res, p, url) => db.listContacts({ q: url.searchParams.get('q') || '', limit: num(url.searchParams.get('limit'), 100) })));

  // ---- admin -------------------------------------------------------------------------------
  r.get('/admin/overview', admin(async () => {
    const day = Date.now() - 24 * 3600e3;
    const y = app.yclientsSettings;
    return {
      company: app.company, yclients: { configured: Boolean(y.partnerToken && y.companyId), authorized: app.yclientsReady, companyId: y.companyId, userName: y.userName || '', login: y.login || '' },
      sync: db.getSetting('sync.last', null), channels: Object.fromEntries(Object.keys(CHANNEL_INFO).map((k) => [k, { ...CHANNEL_INFO[k], active: Boolean(app.channels[k]) }])),
      cascade: app.general.cascade, stats: db.stats(day), rules: db.listRules().length, publicUrl: config.publicUrl,
      webhooks: { telegram: `${config.publicUrl || ''}/webhooks/telegram`, whatsapp: `${config.publicUrl || ''}/webhooks/whatsapp`, yclients: `${config.publicUrl || ''}/webhooks/yclients?token=${app.general.webhookSecret}` },
    };
  }));
  r.get('/admin/settings', admin(async () => ({ yclients: maskSecrets(app.yclientsSettings), channels: maskSecrets(app.channelSettings), general: app.general, channelInfo: CHANNEL_INFO })));
  r.put('/admin/settings', admin(async (req) => {
    const b = await readJson(req);
    if (b.yclients) app.saveSettings('yclients', { ...app.yclientsSettings, ...unmaskSecrets(b.yclients, app.yclientsSettings), companyId: Number(b.yclients.companyId ?? app.yclientsSettings.companyId) || 0 });
    if (b.channels) app.saveSettings('channels', unmaskSecrets({ ...app.channelSettings, ...b.channels }, app.channelSettings));
    if (b.general) app.saveSettings('general', { ...app.general, ...b.general });
    if (b.channels?.telegram) { app.stop(); app.start(); }
    return { ok: true };
  }));
  r.post('/admin/yclients/auth', admin(async (req) => { const b = await readJson(req); return app.yclientsLogin(b.login, b.password); }));
  r.get('/admin/yclients/companies', admin(async () => { if (!app.yc) throw new HttpError(400, 'YCLIENTS не настроен'); return app.yc.myCompanies(); }));
  r.post('/admin/yclients/company', admin(async () => app.refreshCompany()));
  r.post('/admin/yclients/sync', admin(async () => app.sync()));
  r.get('/admin/yclients/staff', admin(async () => { if (!app.yclientsReady) throw new HttpError(400, 'YCLIENTS не настроен'); return app.yc.staff(); }));
  r.get('/admin/yclients/clients', admin(async (req, res, p, url) => { if (!app.yclientsReady) throw new HttpError(400, 'YCLIENTS не настроен'); return app.yc.searchClients({ q: url.searchParams.get('q') || '', page: num(url.searchParams.get('page'), 1) }); }));

  r.get('/admin/schedule', admin(async (req, res, p, url) => scheduleView(app, url, { withJobs: true })));
  r.get('/admin/records/:id', admin(async (req, res, p) => {
    const rec = db.getRecord(Number(p.id)); if (!rec) throw new HttpError(404, 'Запись не найдена');
    return { record: presentRecord(rec, app), jobs: db.all('SELECT j.*, r.name AS rule_name FROM jobs j LEFT JOIN rules r ON r.id = j.rule_id WHERE j.record_id = ? ORDER BY j.due_at', rec.id), messages: db.listMessages({ recordId: rec.id }).map(present) };
  }));
  r.get('/admin/jobs', admin(async (req, res, p, url) => db.listJobs({ status: url.searchParams.get('status') || null, limit: num(url.searchParams.get('limit'), 200) })));
  r.post('/admin/jobs/:id/run', admin(async (req, res, p) => { const j = db.get('SELECT * FROM jobs WHERE id = ?', Number(p.id)); if (!j) throw new HttpError(404, 'Задача не найдена'); const m = await app.runJob(j, { force: true }); await app.tick(); return { message: m ? present(db.getMessage(m.id)) : null }; }));
  r.post('/admin/jobs/:id/cancel', admin(async (req, res, p) => { db.updateJob(Number(p.id), { status: 'cancelled', note: 'отменено администратором' }); return { ok: true }; }));

  r.get('/admin/rules', admin(async () => ({ rules: db.listRules(), types: RULE_TYPES, variables: VARIABLES_HELP })));
  r.post('/admin/rules', admin(async (req) => { const b = await readJson(req); validateRule(b); return { status: 201, body: db.saveRule({ ...b, id: undefined }) }; }));
  r.put('/admin/rules/:id', admin(async (req, res, p) => { const b = await readJson(req); validateRule(b); if (!db.getRule(Number(p.id))) throw new HttpError(404, 'Правило не найдено'); const saved = db.saveRule({ ...b, id: Number(p.id) }); app.plan(); return saved; }));
  r.delete('/admin/rules/:id', admin(async (req, res, p) => { db.deleteRule(Number(p.id)); return { ok: true }; }));
  r.post('/admin/rules/preview', admin(async (req) => {
    const b = await readJson(req);
    const rec = b.recordId ? db.getRecord(Number(b.recordId)) : db.listRecords({ fromTs: Date.now(), limit: 1 })[0] || sampleRecord();
    return { text: render(b.template || '', recordVars(rec, app.company || {})), recordId: rec?.id ?? null };
  }));

  r.get('/admin/messages', admin(async (req, res, p, url) => db.listMessages({ status: url.searchParams.get('status') || null, phone: normalizePhone(url.searchParams.get('phone')), limit: num(url.searchParams.get('limit'), 100), offset: num(url.searchParams.get('offset'), 0) }).map(present)));
  r.get('/admin/messages/:id', admin(async (req, res, p) => { const m = db.getMessage(Number(p.id)); if (!m) throw new HttpError(404, 'Сообщение не найдено'); return { ...present(m), attempts: db.attemptsForMessage(m.id) }; }));
  r.post('/admin/messages/:id/retry', admin(async (req, res, p) => { const m = await app.retryMessage(Number(p.id)); if (!m) throw new HttpError(404, 'Сообщение не найдено'); return present(m); }));
  r.post('/admin/send', admin(async (req) => { const b = await readJson(req); const m = await app.enqueue({ phone: b.phone, text: b.text, channels: b.channels, buttons: b.buttons, source: 'manual' }); return { status: 201, body: present(m) }; }));
  r.get('/admin/contacts', admin(async (req, res, p, url) => db.listContacts({ q: url.searchParams.get('q') || '', limit: num(url.searchParams.get('limit'), 200) })));
  r.put('/admin/contacts/:phone', admin(async (req, res, p) => { const b = await readJson(req); const phone = normalizePhone(p.phone); if (!phone) throw new HttpError(400, 'Некорректный телефон'); return db.upsertContact({ phone, unsubscribed: b.unsubscribed, telegramChatId: b.telegramChatId, name: b.name }); }));
  r.get('/admin/inbound', admin(async (req, res, p, url) => db.listInbound(num(url.searchParams.get('limit'), 100))));
  r.get('/admin/log', admin(async (req, res, p, url) => db.recentLog(num(url.searchParams.get('limit'), 200))));
  r.get('/admin/telegram/me', admin(async () => { if (!app.channels.telegram) throw new HttpError(400, 'Telegram не настроен'); return app.channels.telegram.getMe(); }));

  // ---- webhooks ----------------------------------------------------------------------------
  r.post('/webhooks/telegram', async (req) => {
    if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], app.telegramSecret())) throw new HttpError(403, 'bad secret');
    const update = await readJson(req);
    app.onTelegramUpdate(update).catch((e) => db.log('error', 'telegram', e.message));
    return { ok: true };
  });
  r.get('/webhooks/whatsapp', async (req, res, p, url) => {
    const verify = app.channelSettings.whatsapp?.verifyToken;
    if (url.searchParams.get('hub.mode') === 'subscribe' && verify && safeEqual(url.searchParams.get('hub.verify_token'), verify)) {
      return { raw: url.searchParams.get('hub.challenge') || '' };
    }
    throw new HttpError(403, 'verification failed');
  });
  r.post('/webhooks/whatsapp', async (req) => {
    const buf = await readBody(req);
    const secret = app.channelSettings.whatsapp?.appSecret;
    if (secret) {
      const sig = String(req.headers['x-hub-signature-256'] || '').replace(/^sha256=/, '');
      const expect = crypto.createHmac('sha256', secret).update(buf).digest('hex');
      if (!safeEqual(sig, expect)) throw new HttpError(403, 'bad signature');
    }
    let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'bad json'); }
    const out = await app.onWhatsAppWebhook(body);
    return { ok: true, handled: out };
  });
  r.post('/webhooks/yclients', async (req, res, p, url) => {
    if (!safeEqual(url.searchParams.get('token'), app.general.webhookSecret)) throw new HttpError(403, 'bad token');
    const b = await readJson(req);
    const items = Array.isArray(b) ? b : [b];
    let applied = 0;
    for (const it of items) {
      const data = it?.data ?? it;
      if (it?.resource && it.resource !== 'record') continue;
      if (!data?.id) continue;
      if (it?.status === 'delete') { db.markRecordDeleted(Number(data.id)); applied++; continue; }
      applyRecord(db, data, { companyId: it?.company_id ?? app.yclientsSettings.companyId, tz: app.tz }); applied++;
    }
    app.plan();
    return { ok: true, applied };
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const m = r.match(req.method, url.pathname);
      if (!m) {
        if (req.method === 'GET' && serveStatic(PUBLIC_DIR, url.pathname, res)) return;
        throw new HttpError(404, 'Не найдено');
      }
      const out = await m.handler(req, res, m.params, url);
      if (out && typeof out === 'object' && 'raw' in out) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String(out.raw)); return; }
      if (out && typeof out === 'object' && 'status' in out && 'body' in out && Object.keys(out).length === 2) return sendJson(res, out.status, out.body);
      sendJson(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e.status && Number.isInteger(e.status) ? e.status : 500;
      if (status >= 500) db.log('error', 'http', `${req.method} ${url.pathname}: ${e.message}`);
      sendJson(res, status, { error: e.message, code: e.code, ...(e.extra || {}) });
    }
  });
  return server;
}

function validateRule(b) {
  if (!b.name || !String(b.name).trim()) throw new HttpError(400, 'Укажите название правила');
  if (!RULE_TYPES[b.type]) throw new HttpError(400, 'Неизвестный тип правила');
  if (!b.template || !String(b.template).trim()) throw new HttpError(400, 'Укажите текст шаблона');
  if (b.channels != null && !Array.isArray(b.channels)) throw new HttpError(400, 'channels должен быть массивом');
}

function present(m) {
  if (!m) return m;
  return { id: m.id, createdAt: m.created_at, updatedAt: m.updated_at, phone: m.phone, phoneFormatted: formatPhone(m.phone), text: m.text, buttons: m.buttons, channels: m.channels, channelIndex: m.channel_index,
    currentChannel: m.current_channel, status: m.status, externalId: m.external_id, error: m.error, recordId: m.record_id, ruleId: m.rule_id, jobId: m.job_id, source: m.source, fallbackAt: m.fallback_at, meta: m.meta };
}

function presentRecord(rec, app) {
  const contact = rec.client_phone ? app.db.getContact(rec.client_phone) : null;
  return { id: rec.id, startTs: rec.start_ts, endTs: rec.end_ts, datetime: rec.datetime, lengthSec: rec.length_sec, client: { name: rec.client_name, phone: rec.client_phone, phoneFormatted: formatPhone(rec.client_phone), id: rec.client_id, telegram: Boolean(contact?.telegram_chat_id), unsubscribed: Boolean(contact?.unsubscribed) },
    staff: { id: rec.staff_id, name: rec.staff_name }, services: rec.services, attendance: rec.attendance, attendanceLabel: ATTENDANCE_LABEL[String(rec.attendance)] || String(rec.attendance), confirmed: Boolean(rec.confirmed), deleted: Boolean(rec.deleted), online: Boolean(rec.online), comment: rec.comment, reviewLink: rec.review_link, shortLink: rec.short_link };
}

function scheduleView(app, url, { withJobs = false } = {}) {
  const { db } = app;
  const now = Date.now();
  const from = url.searchParams.get('from') ? Date.parse(url.searchParams.get('from')) : now - 24 * 3600e3;
  const to = url.searchParams.get('to') ? Date.parse(url.searchParams.get('to')) : now + 7 * 24 * 3600e3;
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const records = db.listRecords({ fromTs: from, toTs: to, includeDeleted, limit: 2000 }).map((rec) => {
    const out = presentRecord(rec, app);
    if (withJobs) {
      out.jobs = db.all('SELECT j.id, j.status, j.due_at AS dueAt, j.note, j.message_id AS messageId, r.name AS ruleName, r.type AS ruleType FROM jobs j LEFT JOIN rules r ON r.id = j.rule_id WHERE j.record_id = ? ORDER BY j.due_at', rec.id);
      out.messages = db.listMessages({ recordId: rec.id, limit: 20 }).map((m) => ({ id: m.id, status: m.status, channel: m.current_channel, createdAt: m.created_at, error: m.error }));
    }
    return out;
  });
  return { from, to, tz: app.tz, company: app.company, records };
}

function sampleRecord() {
  const start = Date.now() + 24 * 3600e3;
  return { id: 0, client_name: 'Анна Иванова', client_phone: '79161234567', start_ts: start, end_ts: start + 3600e3, services: [{ id: 1, title: 'Женская стрижка', cost: 2500 }], staff_name: 'Ольга Смирнова', review_link: 'https://yc.gl/e/example/', short_link: 'https://yc.gl/c/example/' };
}
