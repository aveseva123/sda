// Application context: settings, YCLIENTS client, channels, scheduler loop.
import { YclientsClient } from './yclients.js';
import { buildChannels } from './channels/index.js';
import { syncRecords } from './sync.js';
import { planJobs, checkAtRun, DEFAULT_RULES, CONFIRM_BUTTONS } from './rules.js';
import { processQueue, processMessage, applyDeliveryStatus } from './cascade.js';
import { render, recordVars } from './templates.js';
import { handleInbound, handleTelegramUpdate } from './inbound.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { normalizePhone } from './phone.js';
import crypto from 'node:crypto';

export const DEFAULT_GENERAL = {
  cascade: ['telegram', 'whatsapp', 'sms'],
  fallbackSec: 600,
  quietHours: { from: 21, to: 9 },
  adminTelegramChatId: '',
  webhookSecret: '',
  replies: {},
};

export class App {
  constructor(config, db, { fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.config = config; this.db = db; this.fetch = fetchImpl; this.logger = logger;
    this.timers = []; this.abort = null; this.busy = false;
    this.seed();
    this.rebuild();
  }

  // ---- settings ---------------------------------------------------------------------------
  seed() {
    const { seed } = this.config;
    if (!this.db.getSetting('yclients')) this.db.setSetting('yclients', seed.yclients);
    else if (seed.yclients.partnerToken) {
      const cur = this.db.getSetting('yclients');
      this.db.setSetting('yclients', { ...cur, ...Object.fromEntries(Object.entries(seed.yclients).filter(([, v]) => v)) });
    }
    if (!this.db.getSetting('channels')) this.db.setSetting('channels', seed.channels);
    if (!this.db.getSetting('general')) this.db.setSetting('general', { ...DEFAULT_GENERAL, webhookSecret: crypto.randomBytes(12).toString('hex') });
    if (!this.db.getSetting('rules.seeded')) { for (const r of DEFAULT_RULES) this.db.saveRule(r); this.db.setSetting('rules.seeded', true); }
  }
  get yclientsSettings() { return this.db.getSetting('yclients', {}); }
  get channelSettings() { return this.db.getSetting('channels', {}); }
  get general() { return { ...DEFAULT_GENERAL, ...this.db.getSetting('general', {}) }; }
  get company() { return this.db.getSetting('company', null); }
  get tz() { return this.company?.timezone_name || 'Europe/Moscow'; }
  saveSettings(key, value) { this.db.setSetting(key, value); this.rebuild(); }

  rebuild() {
    const y = this.yclientsSettings;
    this.yc = null;
    if (y?.partnerToken && y.companyId) {
      try { this.yc = new YclientsClient({ partnerToken: y.partnerToken, userToken: y.userToken, companyId: y.companyId, baseUrl: y.baseUrl, fetchImpl: this.fetch }); } catch (e) { this.db.log('error', 'app', e.message); }
    }
    this.channels = buildChannels(this.channelSettings, { db: this.db, fetchImpl: this.fetch, logger: (m) => this.logger.log(m) });
  }

  get yclientsReady() { return Boolean(this.yc && this.yc.userToken); }

  // ---- YCLIENTS ---------------------------------------------------------------------------
  async yclientsLogin(login, password) {
    const y = this.yclientsSettings;
    if (!y.partnerToken) throw new Error('Сначала укажите partner token YCLIENTS');
    const tmp = new YclientsClient({ partnerToken: y.partnerToken, baseUrl: y.baseUrl, fetchImpl: this.fetch });
    const user = await tmp.auth(login, password);
    this.db.setSetting('yclients', { ...y, login, password, userToken: user.user_token, userName: user.name });
    this.rebuild();
    let companies = [];
    try { companies = await tmp.myCompanies(); } catch (e) { this.db.log('warn', 'yclients', `companies: ${e.message}`); }
    if (!this.yclientsSettings.companyId && companies.length === 1) { this.db.setSetting('yclients', { ...this.yclientsSettings, companyId: companies[0].id }); this.rebuild(); }
    if (this.yc) await this.refreshCompany().catch((e) => this.db.log('warn', 'yclients', `company: ${e.message}`));
    return { user: { id: user.id, name: user.name, login: user.login }, companies: companies.map((c) => ({ id: c.id, title: c.title, address: c.address, city: c.city })) };
  }

  async refreshCompany() {
    if (!this.yc) throw new Error('YCLIENTS не настроен');
    const c = await this.yc.company();
    const company = { id: c.id, title: c.title, public_title: c.public_title, address: c.address, phone: c.phone, phones: c.phones, timezone_name: c.timezone_name, site: c.site, city: c.city };
    this.db.setSetting('company', company);
    return company;
  }

  async sync() {
    if (!this.yclientsReady) throw new Error('YCLIENTS не настроен (нужны partner token, user token и ID филиала)');
    if (!this.company) await this.refreshCompany();
    const res = await syncRecords({ db: this.db, yc: this.yc, company: this.company, horizonDays: this.config.horizonDays });
    const plan = this.plan();
    this.db.log('info', 'sync', `records: ${res.fetched} (changed ${res.changed}); jobs +${plan.created} ~${plan.updated} -${plan.cancelled}`);
    return { ...res, plan };
  }

  plan() {
    const now = Date.now();
    const records = this.db.recordsForPlanning(now - 45 * 24 * 3600e3, now + (this.config.horizonDays + 1) * 24 * 3600e3);
    return planJobs(this.db, this.db.listRules(true), records, { now, tz: this.tz, quietHours: this.general.quietHours });
  }

  // ---- jobs & messages --------------------------------------------------------------------
  renderForRecord(template, record, extra = {}) { return render(template, recordVars(record, this.company || {}, extra)); }

  async runJob(job, { force = false } = {}) {
    const rule = this.db.getRule(job.rule_id);
    const record = job.record_id ? this.db.getRecord(job.record_id) : null;
    if (!rule) { this.db.updateJob(job.id, { status: 'cancelled', note: 'правило удалено' }); return null; }
    if (!force) {
      const check = checkAtRun(rule, record, this.db);
      if (!check.ok) { this.db.updateJob(job.id, { status: 'skipped', note: check.reason }); return null; }
    }
    const text = this.renderForRecord(rule.template, record);
    const buttons = rule.options?.confirm ? CONFIRM_BUTTONS : null;
    const channels = rule.channels?.length ? rule.channels : this.general.cascade;
    const msg = this.db.insertMessage({ phone: record.client_phone, text, buttons, channels, recordId: record.id, ruleId: rule.id, jobId: job.id, source: 'rule' });
    this.db.updateJob(job.id, { status: 'done', messageId: msg.id });
    return msg;
  }

  async runDueJobs(now = Date.now()) {
    const jobs = this.db.dueJobs(now);
    let sent = 0;
    for (const j of jobs) { try { if (await this.runJob(j)) sent++; } catch (e) { this.db.updateJob(j.id, { status: 'failed', note: e.message }); this.db.log('error', 'jobs', `job ${j.id}: ${e.message}`); } }
    return { due: jobs.length, sent };
  }

  async enqueue({ phone, text, channels, buttons, recordId, source = 'api', meta }) {
    const p = normalizePhone(phone);
    if (!p) throw Object.assign(new Error('Некорректный номер телефона'), { status: 400 });
    if (!text || !String(text).trim()) throw Object.assign(new Error('Пустой текст сообщения'), { status: 400 });
    const chans = Array.isArray(channels) && channels.length ? channels : this.general.cascade;
    if (!this.db.getContact(p)) this.db.upsertContact({ phone: p });
    const msg = this.db.insertMessage({ phone: p, text: String(text), buttons: buttons || null, channels: chans, recordId: recordId ?? null, source, meta });
    return processMessage(this.db, msg, this.channels, { fallbackSec: this.general.fallbackSec });
  }

  async retryMessage(id) {
    const m = this.db.getMessage(id);
    if (!m) return null;
    const msg = this.db.updateMessage(id, { status: 'queued', channelIndex: 0, fallbackAt: null, error: null, meta: { ...(m.meta || {}), retries: 0 } });
    return processMessage(this.db, msg, this.channels, { fallbackSec: this.general.fallbackSec });
  }

  async notifyAdmin(text) {
    const chat = this.general.adminTelegramChatId;
    const tg = this.channels.telegram;
    this.db.log('info', 'admin', text);
    if (chat && tg) await tg.sendText(chat, `🔔 ${text}`);
  }

  inboundCtx() { return { db: this.db, yc: this.yclientsReady ? this.yc : null, settings: this.general, notifyAdmin: (t) => this.notifyAdmin(t) }; }

  async onTelegramUpdate(update) {
    const tg = this.channels.telegram;
    if (!tg) return null;
    return handleTelegramUpdate(this.inboundCtx(), tg, update);
  }

  async onWhatsAppWebhook(body) {
    const events = WhatsAppChannel.parseWebhook(body);
    const out = [];
    for (const ev of events) {
      if (ev.kind === 'status') { applyDeliveryStatus(this.db, 'whatsapp', ev.externalId, ev.status, { error: ev.error }); out.push(`status:${ev.status}`); continue; }
      const res = await handleInbound(this.inboundCtx(), { channel: 'whatsapp', phone: ev.phone, text: ev.text, action: ev.kind === 'button' ? ev.action : undefined, recordId: ev.recordId, payload: ev });
      if (res.reply && this.channels.whatsapp) {
        try { await this.channels.whatsapp.send({ id: 0, phone: normalizePhone(ev.phone), text: res.reply }, this.db.getContact(normalizePhone(ev.phone))); } catch (e) { this.db.log('warn', 'whatsapp', `reply failed: ${e.message}`); }
      }
      out.push(res.action);
    }
    return out;
  }

  // ---- loop -------------------------------------------------------------------------------
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const now = Date.now();
      const last = this.db.getSetting('sync.last', null);
      if (this.yclientsReady && (!last || now - last.at >= this.config.syncIntervalSec * 1000)) {
        try { await this.sync(); } catch (e) { this.db.log('error', 'sync', e.message); this.db.setSetting('sync.last', { ...(last || {}), at: now, error: e.message }); }
      } else {
        this.plan();
      }
      await this.runDueJobs(now);
      await processQueue(this.db, this.channels, { fallbackSec: this.general.fallbackSec, now });
    } catch (e) { this.db.log('error', 'tick', e.message); }
    finally { this.busy = false; }
  }

  start() {
    this.stop();
    this.abort = new AbortController();
    this.timers.push(setInterval(() => this.tick(), this.config.tickSec * 1000));
    this.tick();
    this.startTelegram();
  }

  startTelegram() {
    const tg = this.channels.telegram;
    if (!tg) return;
    const secret = this.telegramSecret();
    if (this.config.publicUrl) {
      tg.setWebhook(`${this.config.publicUrl}/webhooks/telegram`, secret).then(() => this.db.log('info', 'telegram', 'webhook set')).catch((e) => this.db.log('error', 'telegram', `setWebhook: ${e.message}`));
    } else {
      tg.deleteWebhook().catch(() => {}).then(() => tg.poll((u) => this.onTelegramUpdate(u), { signal: this.abort.signal }));
      this.db.log('info', 'telegram', 'long polling started');
    }
  }

  telegramSecret() { return crypto.createHash('sha256').update('tg:' + (this.channelSettings.telegram?.botToken || '')).digest('hex').slice(0, 32); }

  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; this.abort?.abort(); this.abort = null; }
}
