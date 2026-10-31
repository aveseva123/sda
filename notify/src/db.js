// SQLite storage (node:sqlite, bundled with Node ≥ 22.5). No external dependencies.
// All timestamps are epoch milliseconds (INTEGER); JSON columns are stored as TEXT.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY,
  name TEXT,
  yclients_client_id INTEGER,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  whatsapp_ok INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  client_phone TEXT,
  client_name TEXT,
  client_id INTEGER,
  staff_id INTEGER,
  staff_name TEXT,
  services TEXT NOT NULL DEFAULT '[]',
  datetime TEXT,
  start_ts INTEGER,
  end_ts INTEGER,
  length_sec INTEGER DEFAULT 0,
  attendance INTEGER DEFAULT 0,
  confirmed INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  online INTEGER DEFAULT 0,
  comment TEXT,
  review_link TEXT,
  short_link TEXT,
  create_date TEXT,
  last_change TEXT,
  raw TEXT,
  synced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_start ON records(start_ts);
CREATE INDEX IF NOT EXISTS records_phone ON records(client_phone);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  offset_min INTEGER DEFAULT 0,
  template TEXT NOT NULL,
  channels TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  rule_id INTEGER NOT NULL,
  record_id INTEGER,
  phone TEXT,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message_id INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, due_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  phone TEXT NOT NULL,
  text TEXT NOT NULL,
  buttons TEXT,
  channels TEXT NOT NULL,
  channel_index INTEGER DEFAULT 0,
  current_channel TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  external_id TEXT,
  error TEXT,
  record_id INTEGER,
  rule_id INTEGER,
  job_id INTEGER,
  source TEXT NOT NULL DEFAULT 'api',
  fallback_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS messages_status ON messages(status, fallback_at);
CREATE INDEX IF NOT EXISTS messages_ext ON messages(external_id);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_msg ON attempts(message_id);
CREATE TABLE IF NOT EXISTS inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  channel TEXT NOT NULL,
  phone TEXT,
  chat_id TEXT,
  text TEXT,
  payload TEXT,
  action TEXT,
  record_id INTEGER
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);
`;

const j = (v) => JSON.stringify(v ?? null);
const p = (s, fallback = null) => { if (s == null) return fallback; try { return JSON.parse(s); } catch { return fallback; } };

export function openDb(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  sqlite.exec(SCHEMA);
  return new Db(sqlite);
}

export class Db {
  constructor(sqlite) { this.sqlite = sqlite; this._stmts = new Map(); }
  close() { this.sqlite.close(); }
  stmt(sql) { let s = this._stmts.get(sql); if (!s) { s = this.sqlite.prepare(sql); this._stmts.set(sql, s); } return s; }
  run(sql, ...params) { return this.stmt(sql).run(...params); }
  get(sql, ...params) { return this.stmt(sql).get(...params) ?? null; }
  all(sql, ...params) { return this.stmt(sql).all(...params); }
  tx(fn) { this.sqlite.exec('BEGIN'); try { const r = fn(); this.sqlite.exec('COMMIT'); return r; } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; } }

  // ---- settings --------------------------------------------------------------------------
  getSetting(key, fallback = null) { const r = this.get('SELECT value FROM settings WHERE key = ?', key); return r ? p(r.value, fallback) : fallback; }
  setSetting(key, value) { this.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, j(value)); }

  // ---- log -------------------------------------------------------------------------------
  log(level, scope, message, data) {
    this.run('INSERT INTO log(created_at, level, scope, message, data) VALUES (?, ?, ?, ?, ?)', Date.now(), level, scope, String(message), data === undefined ? null : j(data));
    this.run('DELETE FROM log WHERE id < (SELECT MAX(id) FROM log) - 5000');
  }
  recentLog(limit = 200) { return this.all('SELECT * FROM log ORDER BY id DESC LIMIT ?', limit).map((r) => ({ ...r, data: p(r.data) })); }

  // ---- contacts --------------------------------------------------------------------------
  upsertContact(c) {
    const now = Date.now();
    this.run(`INSERT INTO contacts(phone, name, yclients_client_id, telegram_chat_id, telegram_username, whatsapp_ok, unsubscribed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        name = COALESCE(excluded.name, contacts.name),
        yclients_client_id = COALESCE(excluded.yclients_client_id, contacts.yclients_client_id),
        telegram_chat_id = COALESCE(excluded.telegram_chat_id, contacts.telegram_chat_id),
        telegram_username = COALESCE(excluded.telegram_username, contacts.telegram_username),
        whatsapp_ok = MAX(excluded.whatsapp_ok, contacts.whatsapp_ok),
        unsubscribed = COALESCE(?, contacts.unsubscribed),
        updated_at = excluded.updated_at`,
      c.phone, c.name ?? null, c.yclientsClientId ?? null, c.telegramChatId ?? null, c.telegramUsername ?? null,
      c.whatsappOk ? 1 : 0, c.unsubscribed ? 1 : 0, now, c.unsubscribed === undefined ? null : (c.unsubscribed ? 1 : 0));
    return this.getContact(c.phone);
  }
  getContact(phone) { return this.get('SELECT * FROM contacts WHERE phone = ?', phone); }
  getContactByTelegram(chatId) { return this.get('SELECT * FROM contacts WHERE telegram_chat_id = ?', String(chatId)); }
  listContacts({ q = '', limit = 100, offset = 0 } = {}) {
    const like = `%${q}%`;
    return this.all('SELECT * FROM contacts WHERE (? = \'\' OR phone LIKE ? OR name LIKE ?) ORDER BY updated_at DESC LIMIT ? OFFSET ?', q, like, like, limit, offset);
  }

  // ---- records (YCLIENTS appointments cache) ---------------------------------------------
  upsertRecord(r) {
    this.run(`INSERT INTO records(id, company_id, client_phone, client_name, client_id, staff_id, staff_name, services, datetime, start_ts, end_ts, length_sec,
        attendance, confirmed, deleted, online, comment, review_link, short_link, create_date, last_change, raw, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, client_phone=excluded.client_phone, client_name=excluded.client_name, client_id=excluded.client_id,
        staff_id=excluded.staff_id, staff_name=excluded.staff_name, services=excluded.services, datetime=excluded.datetime, start_ts=excluded.start_ts, end_ts=excluded.end_ts,
        length_sec=excluded.length_sec, attendance=excluded.attendance, confirmed=excluded.confirmed, deleted=excluded.deleted, online=excluded.online, comment=excluded.comment,
        review_link=excluded.review_link, short_link=excluded.short_link, create_date=excluded.create_date, last_change=excluded.last_change, raw=excluded.raw, synced_at=excluded.synced_at`,
      r.id, r.companyId, r.clientPhone ?? null, r.clientName ?? null, r.clientId ?? null, r.staffId ?? null, r.staffName ?? null, j(r.services ?? []), r.datetime ?? null,
      r.startTs ?? null, r.endTs ?? null, r.lengthSec ?? 0, r.attendance ?? 0, r.confirmed ? 1 : 0, r.deleted ? 1 : 0, r.online ? 1 : 0, r.comment ?? null,
      r.reviewLink ?? null, r.shortLink ?? null, r.createDate ?? null, r.lastChange ?? null, r.raw === undefined ? null : j(r.raw), Date.now());
    return this.getRecord(r.id);
  }
  getRecord(id) { const r = this.get('SELECT * FROM records WHERE id = ?', id); return r ? hydrateRecord(r) : null; }
  listRecords({ fromTs, toTs, phone, includeDeleted = false, limit = 500 } = {}) {
    const rows = this.all(`SELECT * FROM records WHERE (? IS NULL OR start_ts >= ?) AND (? IS NULL OR start_ts < ?) AND (? IS NULL OR client_phone = ?) AND (? = 1 OR deleted = 0)
      ORDER BY start_ts ASC LIMIT ?`, fromTs ?? null, fromTs ?? null, toTs ?? null, toTs ?? null, phone ?? null, phone ?? null, includeDeleted ? 1 : 0, limit);
    return rows.map(hydrateRecord);
  }
  recordsForPlanning(fromTs, toTs) { return this.listRecords({ fromTs, toTs, includeDeleted: true, limit: 100000 }); }
  hasFutureRecord(phone, afterTs) { return Boolean(this.get('SELECT 1 FROM records WHERE client_phone = ? AND deleted = 0 AND start_ts > ? LIMIT 1', phone, afterTs)); }
  markRecordDeleted(id) { this.run('UPDATE records SET deleted = 1, synced_at = ? WHERE id = ?', Date.now(), id); }

  // ---- rules -----------------------------------------------------------------------------
  listRules(onlyEnabled = false) {
    return this.all('SELECT * FROM rules WHERE (? = 0 OR enabled = 1) ORDER BY sort, id', onlyEnabled ? 1 : 0).map(hydrateRule);
  }
  getRule(id) { const r = this.get('SELECT * FROM rules WHERE id = ?', id); return r ? hydrateRule(r) : null; }
  saveRule(rule) {
    const row = { name: rule.name, type: rule.type, enabled: rule.enabled === false ? 0 : 1, offsetMin: Number(rule.offsetMin ?? 0), template: rule.template ?? '',
      channels: rule.channels ? j(rule.channels) : null, options: j(rule.options ?? {}), sort: Number(rule.sort ?? 0) };
    if (rule.id) {
      this.run('UPDATE rules SET name=?, type=?, enabled=?, offset_min=?, template=?, channels=?, options=?, sort=? WHERE id=?',
        row.name, row.type, row.enabled, row.offsetMin, row.template, row.channels, row.options, row.sort, rule.id);
      return this.getRule(rule.id);
    }
    const res = this.run('INSERT INTO rules(name, type, enabled, offset_min, template, channels, options, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.name, row.type, row.enabled, row.offsetMin, row.template, row.channels, row.options, row.sort);
    return this.getRule(Number(res.lastInsertRowid));
  }
  deleteRule(id) { this.run('DELETE FROM rules WHERE id = ?', id); this.run("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE rule_id = ? AND status = 'pending'", Date.now(), id); }

  // ---- jobs ------------------------------------------------------------------------------
  getJobByKey(key) { return this.get('SELECT * FROM jobs WHERE key = ?', key); }
  insertJob(job) {
    const now = Date.now();
    const res = this.run('INSERT INTO jobs(key, rule_id, record_id, phone, due_at, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      job.key, job.ruleId, job.recordId ?? null, job.phone ?? null, job.dueAt, job.status ?? 'pending', job.note ?? null, now, now);
    return Number(res.lastInsertRowid);
  }
  updateJob(id, fields) {
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${camelToSnake(k)} = ?`); vals.push(v); }
    sets.push('updated_at = ?'); vals.push(Date.now()); vals.push(id);
    this.run(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  }
  dueJobs(now = Date.now(), limit = 50) { return this.all("SELECT * FROM jobs WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?", now, limit); }
  pendingJobsForRecord(recordId) { return this.all("SELECT * FROM jobs WHERE record_id = ? AND status = 'pending'", recordId); }
  listJobs({ status, limit = 200 } = {}) {
    return this.all('SELECT j.*, r.name AS rule_name, r.type AS rule_type FROM jobs j LEFT JOIN rules r ON r.id = j.rule_id WHERE (? IS NULL OR j.status = ?) ORDER BY j.due_at DESC LIMIT ?', status ?? null, status ?? null, limit);
  }

  // ---- messages & attempts ---------------------------------------------------------------
  insertMessage(m) {
    const now = Date.now();
    const res = this.run(`INSERT INTO messages(created_at, updated_at, phone, text, buttons, channels, channel_index, current_channel, status, record_id, rule_id, job_id, source, meta)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 'queued', ?, ?, ?, ?, ?)`,
      now, now, m.phone, m.text, m.buttons ? j(m.buttons) : null, j(m.channels), m.recordId ?? null, m.ruleId ?? null, m.jobId ?? null, m.source ?? 'api', j(m.meta ?? {}));
    return this.getMessage(Number(res.lastInsertRowid));
  }
  getMessage(id) { const r = this.get('SELECT * FROM messages WHERE id = ?', id); return r ? hydrateMessage(r) : null; }
  getMessageByExternalId(channel, externalId) {
    const r = this.get('SELECT m.* FROM attempts a JOIN messages m ON m.id = a.message_id WHERE a.channel = ? AND a.external_id = ? ORDER BY a.id DESC LIMIT 1', channel, String(externalId));
    return r ? hydrateMessage(r) : null;
  }
  updateMessage(id, fields) {
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${camelToSnake(k)} = ?`); vals.push(typeof v === 'object' && v !== null ? j(v) : v); }
    sets.push('updated_at = ?'); vals.push(Date.now()); vals.push(id);
    this.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    return this.getMessage(id);
  }
  listMessages({ status, phone, recordId, limit = 100, offset = 0 } = {}) {
    return this.all(`SELECT * FROM messages WHERE (? IS NULL OR status = ?) AND (? IS NULL OR phone = ?) AND (? IS NULL OR record_id = ?) ORDER BY id DESC LIMIT ? OFFSET ?`,
      status ?? null, status ?? null, phone ?? null, phone ?? null, recordId ?? null, recordId ?? null, limit, offset).map(hydrateMessage);
  }
  messagesToProcess(now = Date.now(), limit = 50) {
    return this.all(`SELECT * FROM messages WHERE (status = 'queued' AND (fallback_at IS NULL OR fallback_at <= ?)) OR (status = 'sent' AND fallback_at IS NOT NULL AND fallback_at <= ?) ORDER BY id LIMIT ?`, now, now, limit).map(hydrateMessage);
  }
  lastOutboundForPhone(phone, channel) {
    return this.get(`SELECT m.* FROM messages m WHERE m.phone = ? AND m.current_channel = ? AND m.status IN ('sent','delivered','read') ORDER BY m.id DESC LIMIT 1`, phone, channel);
  }
  insertAttempt(a) {
    const now = Date.now();
    const res = this.run('INSERT INTO attempts(message_id, channel, status, external_id, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      a.messageId, a.channel, a.status, a.externalId ?? null, a.error ?? null, now, now);
    return Number(res.lastInsertRowid);
  }
  updateAttempt(id, fields) {
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${camelToSnake(k)} = ?`); vals.push(v); }
    sets.push('updated_at = ?'); vals.push(Date.now()); vals.push(id);
    this.run(`UPDATE attempts SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  }
  attemptsForMessage(messageId) { return this.all('SELECT * FROM attempts WHERE message_id = ? ORDER BY id', messageId); }
  stats(sinceTs) {
    const byStatus = this.all('SELECT status, COUNT(*) AS n FROM messages WHERE created_at >= ? GROUP BY status', sinceTs);
    const byChannel = this.all("SELECT channel, status, COUNT(*) AS n FROM attempts WHERE created_at >= ? GROUP BY channel, status", sinceTs);
    const jobs = this.all('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status');
    return { byStatus, byChannel, jobs };
  }

  // ---- inbound ---------------------------------------------------------------------------
  insertInbound(i) {
    const res = this.run('INSERT INTO inbound(created_at, channel, phone, chat_id, text, payload, action, record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      Date.now(), i.channel, i.phone ?? null, i.chatId == null ? null : String(i.chatId), i.text ?? null, i.payload === undefined ? null : j(i.payload), i.action ?? null, i.recordId ?? null);
    return Number(res.lastInsertRowid);
  }
  listInbound(limit = 100) { return this.all('SELECT * FROM inbound ORDER BY id DESC LIMIT ?', limit).map((r) => ({ ...r, payload: p(r.payload) })); }
}

function camelToSnake(s) { return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()); }
function hydrateRecord(r) { return { ...r, services: p(r.services, []), raw: p(r.raw) }; }
function hydrateRule(r) { return { id: r.id, name: r.name, type: r.type, enabled: Boolean(r.enabled), offsetMin: r.offset_min, template: r.template, channels: p(r.channels), options: p(r.options, {}), sort: r.sort }; }
function hydrateMessage(r) { return { ...r, channels: p(r.channels, []), buttons: p(r.buttons), meta: p(r.meta, {}) }; }
