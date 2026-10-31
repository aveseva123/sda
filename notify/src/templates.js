// Message templates: {{variable}} substitution with optional filters, e.g. {{client_name|default:Гость}}.
// Variables are built from a YCLIENTS record + company info; dates are formatted in the company time zone.

const RU_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function partsInTz(ts, tz = 'Europe/Moscow') {
  const d = new Date(ts);
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false });
  } catch {
    fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false });
  }
  const o = {};
  for (const part of fmt.formatToParts(d)) o[part.type] = part.value;
  const hour = Number(o.hour) % 24;
  // weekday index via a UTC trick: build a date in the target tz
  const local = new Date(Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day)));
  return { year: Number(o.year), month: Number(o.month), day: Number(o.day), hour, minute: Number(o.minute), weekday: local.getUTCDay() };
}

export function fmtDate(ts, tz) { const p = partsInTz(ts, tz); return `${p.day} ${RU_MONTHS_GEN[p.month - 1]}`; }
export function fmtDateFull(ts, tz) { const p = partsInTz(ts, tz); return `${p.day} ${RU_MONTHS_GEN[p.month - 1]} ${p.year}`; }
export function fmtTime(ts, tz) { const p = partsInTz(ts, tz); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
export function fmtWeekday(ts, tz) { const p = partsInTz(ts, tz); return RU_WEEKDAYS[p.weekday]; }
export function fmtDateTime(ts, tz) { return `${fmtDate(ts, tz)} в ${fmtTime(ts, tz)}`; }

export function firstName(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)[0];
}

/** Build the variable map for a record. `company` = { title, address, phone, timezone_name, site }. */
export function recordVars(record, company = {}, extra = {}) {
  const tz = company.timezone_name || company.timezoneName || 'Europe/Moscow';
  const services = Array.isArray(record?.services) ? record.services : [];
  const ts = record?.start_ts ?? record?.startTs;
  const cost = services.reduce((s, x) => s + Number(x.cost ?? x.cost_to_pay ?? 0), 0);
  return {
    client_name: firstName(record?.client_name ?? record?.clientName) || '',
    client_full_name: record?.client_name ?? record?.clientName ?? '',
    client_phone: record?.client_phone ?? record?.clientPhone ?? '',
    date: ts ? fmtDate(ts, tz) : '',
    date_full: ts ? fmtDateFull(ts, tz) : '',
    time: ts ? fmtTime(ts, tz) : '',
    weekday: ts ? fmtWeekday(ts, tz) : '',
    datetime: ts ? fmtDateTime(ts, tz) : '',
    services: services.map((s) => s.title).filter(Boolean).join(', '),
    service: services[0]?.title ?? '',
    cost: cost ? String(cost) : '',
    staff: record?.staff_name ?? record?.staffName ?? '',
    staff_first_name: firstName(record?.staff_name ?? record?.staffName),
    company: company.public_title || company.title || '',
    address: company.address || '',
    company_phone: company.phone || '',
    site: company.site || '',
    review_link: record?.review_link ?? record?.reviewLink ?? '',
    record_link: record?.short_link ?? record?.shortLink ?? '',
    record_id: record?.id != null ? String(record.id) : '',
    ...extra,
  };
}

const FILTERS = {
  default: (v, arg) => (v === '' || v == null ? arg : v),
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  capitalize: (v) => { const s = String(v); return s ? s[0].toUpperCase() + s.slice(1) : s; },
  trim: (v) => String(v).trim(),
};

/** Render `{{name}}` / `{{name|filter:arg}}` placeholders. Unknown variables render as empty strings. */
export function render(template, vars) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z_][\w]*)\s*((?:\|[^}]*)?)\}\}/g, (_, name, filters) => {
    let v = vars[name];
    if (v == null) v = '';
    for (const f of filters.split('|').map((s) => s.trim()).filter(Boolean)) {
      const [fname, ...rest] = f.split(':');
      const fn = FILTERS[fname.trim()];
      if (fn) v = fn(v, rest.join(':').trim());
    }
    return String(v);
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function usedVariables(template) {
  const out = new Set();
  for (const m of String(template ?? '').matchAll(/\{\{\s*([a-zA-Z_][\w]*)/g)) out.add(m[1]);
  return [...out];
}

export const VARIABLES_HELP = [
  ['client_name', 'Имя клиента (первое слово)'], ['client_full_name', 'Полное имя клиента'], ['client_phone', 'Телефон клиента'],
  ['date', 'Дата визита, напр. «5 ноября»'], ['date_full', 'Дата с годом'], ['time', 'Время визита, напр. «14:30»'], ['weekday', 'День недели'], ['datetime', '«5 ноября в 14:30»'],
  ['services', 'Все услуги через запятую'], ['service', 'Первая услуга'], ['cost', 'Стоимость услуг'], ['staff', 'Мастер'], ['staff_first_name', 'Имя мастера'],
  ['company', 'Название салона'], ['address', 'Адрес салона'], ['company_phone', 'Телефон салона'], ['site', 'Сайт салона'],
  ['review_link', 'Ссылка на отзыв из YCLIENTS'], ['record_link', 'Короткая ссылка на запись'], ['record_id', 'ID записи'],
];
