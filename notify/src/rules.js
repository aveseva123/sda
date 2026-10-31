// Rule engine: turns YCLIENTS records into scheduled jobs.
//
// Rule types:
//   before_visit  — offset_min before the appointment start (reminder; option confirm=true adds Confirm/Cancel buttons)
//   on_create     — shortly after a new booking appears (booking confirmation)
//   after_visit   — offset_min after the appointment end, only if the client actually came (feedback request)
//   return_visit  — offset_min after the visit if the client has not booked again (win-back / repeat invitation)
//
// Common options: channels (array, overrides default cascade), staffIds, serviceIds, onlineOnly,
//   skipIfConfirmed (before_visit), requireAttendance (after_visit/return_visit, default [1]),
//   maxAgeMin (on_create, default 180), quietHours handled globally.
import { ATTENDANCE } from './yclients.js';

export const RULE_TYPES = {
  before_visit: { title: 'Напоминание до визита', offsetLabel: 'за N минут до начала' },
  on_create: { title: 'Подтверждение новой записи', offsetLabel: 'через N минут после создания' },
  after_visit: { title: 'После визита (отзыв)', offsetLabel: 'через N минут после окончания' },
  return_visit: { title: 'Приглашение вернуться', offsetLabel: 'через N минут после визита, если нет новой записи' },
};

const GRACE_MS = { before_visit: 20 * 60e3, on_create: 0, after_visit: 36 * 3600e3, return_visit: 7 * 24 * 3600e3 };

export function jobKey(rule, record) { return `rule:${rule.id}:rec:${record.id}`; }

/** Due time for a rule and a record, or null if the rule does not apply. */
export function computeDue(rule, record, { now = Date.now() } = {}) {
  const off = Number(rule.offsetMin || 0) * 60e3;
  switch (rule.type) {
    case 'before_visit': return record.start_ts != null ? record.start_ts - off : null;
    case 'on_create': {
      const created = record.create_date ? Date.parse(String(record.create_date).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : null;
      const base = created && !Number.isNaN(created) ? created : record.synced_at ?? now;
      const maxAge = Number(rule.options?.maxAgeMin ?? 180) * 60e3;
      if (now - base > maxAge) return null; // old booking seen for the first time — don't spam
      return Math.max(base + off, now);
    }
    case 'after_visit':
    case 'return_visit': return record.end_ts != null ? record.end_ts + off : null;
    default: return null;
  }
}

/** Static filters evaluated at planning time. */
export function matchesFilters(rule, record) {
  const o = rule.options || {};
  if (o.staffIds?.length && !o.staffIds.map(Number).includes(Number(record.staff_id))) return false;
  if (o.serviceIds?.length) {
    const ids = (record.services || []).map((s) => Number(s.id));
    if (!o.serviceIds.map(Number).some((id) => ids.includes(id))) return false;
  }
  if (o.onlineOnly && !record.online) return false;
  if (o.excludeStaffIds?.length && o.excludeStaffIds.map(Number).includes(Number(record.staff_id))) return false;
  return true;
}

/** Shift a timestamp out of quiet hours (e.g. 21:00–09:00) to the next allowed moment, in the company tz. */
export function applyQuietHours(ts, quiet, tz = 'Europe/Moscow') {
  if (!quiet || quiet.from == null || quiet.to == null || quiet.from === quiet.to) return ts;
  const from = Number(quiet.from), to = Number(quiet.to);
  const h = hourInTz(ts, tz);
  const inQuiet = from > to ? (h >= from || h < to) : (h >= from && h < to);
  if (!inQuiet) return ts;
  // move forward to `to` o'clock of the appropriate day
  let t = ts;
  for (let i = 0; i < 48; i++) { // step by hours until we exit quiet period at `to:00`
    t = Math.floor(t / 3600e3) * 3600e3 + 3600e3;
    const hh = hourInTz(t, tz);
    if (hh === to) return t;
  }
  return ts;
}

function hourInTz(ts, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  return Number(fmt.format(new Date(ts))) % 24;
}

/**
 * Plan/refresh jobs for a set of records. Idempotent: existing jobs are updated (due time) or cancelled
 * (record deleted / no longer matches); jobs whose time passed beyond the grace period are stored as 'skipped'.
 */
export function planJobs(db, rules, records, { now = Date.now(), tz = 'Europe/Moscow', quietHours = null } = {}) {
  const stats = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  db.tx(() => {
    for (const record of records) {
      for (const rule of rules) {
        const key = jobKey(rule, record);
        const existing = db.getJobByKey(key);
        const applicable = !record.deleted && record.client_phone && rule.enabled && matchesFilters(rule, record);
        let due = applicable ? computeDue(rule, record, { now }) : null;
        if (due != null && quietHours) due = applyQuietHours(due, quietHours, tz);
        if (existing) {
          if (existing.status !== 'pending') continue;
          if (due == null) { db.updateJob(existing.id, { status: 'cancelled', note: record.deleted ? 'запись отменена' : 'правило больше не подходит' }); stats.cancelled++; }
          else if (existing.due_at !== due || existing.phone !== record.client_phone) { db.updateJob(existing.id, { dueAt: due, phone: record.client_phone }); stats.updated++; }
          continue;
        }
        if (due == null) continue;
        const grace = GRACE_MS[rule.type] ?? 0;
        if (due < now - grace) { db.insertJob({ key, ruleId: rule.id, recordId: record.id, phone: record.client_phone, dueAt: due, status: 'skipped', note: 'время уже прошло' }); stats.skipped++; continue; }
        db.insertJob({ key, ruleId: rule.id, recordId: record.id, phone: record.client_phone, dueAt: due });
        stats.created++;
      }
    }
  });
  return stats;
}

/**
 * Run-time check right before sending. Returns { ok: true } or { ok: false, reason }.
 */
export function checkAtRun(rule, record, db, { now = Date.now() } = {}) {
  if (!record) return { ok: false, reason: 'запись не найдена' };
  if (record.deleted) return { ok: false, reason: 'запись отменена' };
  if (!record.client_phone) return { ok: false, reason: 'нет телефона клиента' };
  const contact = db.getContact(record.client_phone);
  if (contact?.unsubscribed) return { ok: false, reason: 'клиент отписался' };
  const o = rule.options || {};
  switch (rule.type) {
    case 'before_visit':
      if (record.start_ts != null && record.start_ts < now) return { ok: false, reason: 'визит уже начался' };
      if (o.skipIfConfirmed && record.attendance === ATTENDANCE.CONFIRMED) return { ok: false, reason: 'клиент уже подтвердил' };
      if (record.attendance === ATTENDANCE.NO_SHOW) return { ok: false, reason: 'отмечен как не пришёл' };
      return { ok: true };
    case 'on_create':
      if (record.start_ts != null && record.start_ts < now) return { ok: false, reason: 'визит уже начался' };
      return { ok: true };
    case 'after_visit': {
      const req = (o.requireAttendance ?? [ATTENDANCE.ARRIVED]).map(Number);
      if (!req.includes(Number(record.attendance))) return { ok: false, reason: `статус визита ${record.attendance}, нужен ${req.join('/')}` };
      return { ok: true };
    }
    case 'return_visit': {
      const req = (o.requireAttendance ?? [ATTENDANCE.ARRIVED]).map(Number);
      if (!req.includes(Number(record.attendance))) return { ok: false, reason: `статус визита ${record.attendance}` };
      if (db.hasFutureRecord(record.client_phone, record.end_ts ?? now)) return { ok: false, reason: 'клиент уже записан снова' };
      return { ok: true };
    }
    default: return { ok: false, reason: 'неизвестный тип правила' };
  }
}

export const CONFIRM_BUTTONS = [{ text: '✅ Подтверждаю', action: 'confirm' }, { text: '❌ Отменить / перенести', action: 'cancel' }];

export const DEFAULT_RULES = [
  { name: 'Напоминание за день', type: 'before_visit', offsetMin: 24 * 60, sort: 1, enabled: true,
    template: '{{client_name|default:Здравствуйте}}, напоминаем о записи в {{company}} {{datetime}}.\nУслуги: {{services}}. Мастер: {{staff}}.\nАдрес: {{address}}.\n\nПожалуйста, подтвердите визит: ответьте «1» — приду, «2» — нужно отменить или перенести.',
    options: { confirm: true, skipIfConfirmed: true } },
  { name: 'Напоминание за 2 часа', type: 'before_visit', offsetMin: 120, sort: 2, enabled: true,
    template: '{{client_name|default:Здравствуйте}}, ждём вас сегодня в {{time}} в {{company}}, {{address}}. До встречи!', options: { skipIfConfirmed: false } },
  { name: 'Подтверждение новой записи', type: 'on_create', offsetMin: 2, sort: 0, enabled: true,
    template: '{{client_name|default:Здравствуйте}}, вы записаны в {{company}} {{datetime}}.\nУслуги: {{services}}. Мастер: {{staff}}.\nАдрес: {{address}}. Телефон: {{company_phone}}.', options: { maxAgeMin: 180 } },
  { name: 'Запрос отзыва', type: 'after_visit', offsetMin: 120, sort: 3, enabled: true,
    template: '{{client_name|default:Здравствуйте}}, спасибо, что выбрали {{company}}! Оцените визит, пожалуйста: {{review_link}}\nЕсли что-то не понравилось — просто ответьте на это сообщение, мы всё исправим.', options: { requireAttendance: [1] } },
  { name: 'Приглашение вернуться', type: 'return_visit', offsetMin: 30 * 24 * 60, sort: 4, enabled: false,
    template: '{{client_name|default:Здравствуйте}}, прошёл месяц после вашего визита в {{company}}. Пора повторить «{{service}}»? Запишитесь онлайн: {{site}} или ответьте на это сообщение.', options: { requireAttendance: [1] } },
];
