// YCLIENTS REST API client (https://developers.yclients.com/ru/). No dependencies — uses global fetch.
//
// Auth: every request carries `Authorization: Bearer <partner_token>` and, for company data,
// `, User <user_token>`. A user token is obtained once via POST /api/v1/auth (login + password).
// Dates returned by the API are ISO 8601 strings with the company offset ("2019-01-16T16:00:00+09:00").

export const ATTENDANCE = { NO_SHOW: -1, WAITING: 0, ARRIVED: 1, CONFIRMED: 2 };
export const ATTENDANCE_LABEL = { '-1': 'не пришёл', 0: 'ожидание', 1: 'пришёл', 2: 'подтвердил' };

export class YclientsError extends Error {
  constructor(message, { status, body, code } = {}) { super(message); this.name = 'YclientsError'; this.status = status; this.body = body; this.code = code || 'yclients_error'; }
}

export class YclientsClient {
  constructor({ partnerToken, userToken = '', companyId = 0, baseUrl = 'https://api.yclients.ru', fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    if (!partnerToken) throw new YclientsError('Не задан partner token YCLIENTS', { code: 'config' });
    this.partnerToken = partnerToken; this.userToken = userToken; this.companyId = Number(companyId) || 0;
    this.baseUrl = baseUrl.replace(/\/+$/, ''); this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }

  headers(withUser = true) {
    const auth = withUser && this.userToken ? `Bearer ${this.partnerToken}, User ${this.userToken}` : `Bearer ${this.partnerToken}`;
    return { Accept: 'application/vnd.yclients.v2+json', 'Content-Type': 'application/json', Authorization: auth };
  }

  async request(method, path, { query, body, withUser = true } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res, text;
    try {
      res = await this.fetch(url, { method, headers: this.headers(withUser), body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      text = await res.text();
    } catch (e) {
      throw new YclientsError(`YCLIENTS недоступен: ${e.message}`, { code: 'network' });
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok || (data && data.success === false)) {
      const msg = data?.meta?.message || data?.message || `HTTP ${res.status}`;
      throw new YclientsError(`YCLIENTS: ${msg}`, { status: res.status, body: data, code: res.status === 401 ? 'unauthorized' : res.status === 402 || res.status === 403 ? 'license' : 'api' });
    }
    return data;
  }

  /** POST /api/v1/auth → { user_token, id, name, ... }. Throws with code '2fa' if 2-factor confirmation is required. */
  async auth(login, password) {
    const data = await this.request('POST', '/api/v1/auth', { body: { login, password }, withUser: false });
    const d = data?.data ?? data;
    if (d?.user_token) { this.userToken = d.user_token; return d; }
    if (d?.uuid && d?.flow) throw new YclientsError('У пользователя включена двухфакторная авторизация: получите user_token вручную и укажите его в настройках', { code: '2fa', body: data });
    throw new YclientsError('YCLIENTS не вернул user_token', { code: 'api', body: data });
  }

  /** GET /api/v1/company/{id}/ → company { title, address, phone, timezone_name, site, ... } */
  async company(id = this.companyId) {
    const data = await this.request('GET', `/api/v1/company/${id}/`, { query: { my: 1 } });
    return data.data;
  }

  /** GET /api/v1/companies?my=1 — companies the user manages (for the settings UI). */
  async myCompanies() {
    const data = await this.request('GET', '/api/v1/companies', { query: { my: 1 } });
    return data.data ?? [];
  }

  /** GET /api/v1/company/{company_id}/staff/{staff_id} (staff_id omitted → all) */
  async staff(companyId = this.companyId) {
    const data = await this.request('GET', `/api/v1/company/${companyId}/staff/`);
    return data.data ?? [];
  }

  /**
   * GET /api/v1/records/{company_id} with paging. `startDate`/`endDate` — 'YYYY-MM-DD' (session date),
   * `changedAfter` — ISO date-time (created/updated since), `withDeleted` includes cancelled records.
   */
  async records({ companyId = this.companyId, startDate, endDate, changedAfter, changedBefore, staffId, clientId, withDeleted = true, pageSize = 200, maxPages = 50 } = {}) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.request('GET', `/api/v1/records/${companyId}`, {
        query: { page, count: pageSize, start_date: startDate, end_date: endDate, changed_after: changedAfter, changed_before: changedBefore, staff_id: staffId, client_id: clientId, with_deleted: withDeleted ? 1 : undefined },
      });
      const items = data.data ?? [];
      out.push(...items);
      const total = Number(data.meta?.total_count ?? 0);
      if (items.length < pageSize || (total && out.length >= total)) break;
    }
    return out;
  }

  /** GET /api/v1/record/{company_id}/{record_id} */
  async record(recordId, companyId = this.companyId) {
    const data = await this.request('GET', `/api/v1/record/${companyId}/${recordId}`);
    return data.data;
  }

  /**
   * PUT /api/v1/record/{company_id}/{record_id} — change only the attendance status.
   * YCLIENTS requires staff_id / services / datetime / seance_length in the body, so we re-send the current ones.
   * attendance: 2 — client confirmed, 1 — arrived, 0 — waiting, -1 — no-show.
   */
  async setAttendance(recordId, attendance, companyId = this.companyId, current = null) {
    const rec = current ?? await this.record(recordId, companyId);
    const body = {
      staff_id: rec.staff_id ?? rec.staff?.id,
      services: (rec.services ?? []).map((s) => ({ id: s.id, first_cost: s.first_cost ?? s.cost, discount: s.discount ?? 0, cost: s.cost })),
      datetime: rec.datetime ?? rec.date,
      seance_length: rec.seance_length ?? rec.length,
      attendance: Number(attendance),
      comment: rec.comment ?? '',
      save_if_busy: true,
      send_sms: false,
    };
    if (rec.client?.phone) body.client = { phone: rec.client.phone, name: rec.client.name ?? '', surname: rec.client.surname ?? '', patronymic: rec.client.patronymic ?? '', email: rec.client.email ?? '' };
    if (rec.activity_id) body.activity_id = rec.activity_id;
    const data = await this.request('PUT', `/api/v1/record/${companyId}/${recordId}`, { body });
    return data.data;
  }

  /** POST /api/v1/company/{company_id}/clients/search — phone/name quick search. */
  async searchClients({ companyId = this.companyId, q = '', page = 1, pageSize = 50, fields = ['id', 'name', 'phone', 'email', 'last_visit_date', 'visits_count'] } = {}) {
    const body = { page, page_size: pageSize, fields, order_by: 'name', order_by_direction: 'ASC', operation: 'AND', filters: q ? [{ type: 'quick_search', state: { value: q } }] : [] };
    const data = await this.request('POST', `/api/v1/company/${companyId}/clients/search`, { body });
    return { items: data.data ?? [], total: Number(data.meta?.total_count ?? 0) };
  }

  /** GET /api/v1/client/{company_id}/{id} */
  async client(clientId, companyId = this.companyId) {
    const data = await this.request('GET', `/api/v1/client/${companyId}/${clientId}`);
    return data.data;
  }
}

/** Parse a YCLIENTS date-time string ("2019-01-16T16:00:00+09:00" or "2019-01-16 16:00:00" with a tz) to epoch ms. */
export function parseYcDate(s, tz = 'Europe/Moscow') {
  if (!s) return null;
  const str = String(s).trim();
  if (/[+-]\d\d:?\d\d$|Z$/.test(str)) { const t = Date.parse(str.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); return Number.isNaN(t) ? null : t; }
  const m = str.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?$/);
  if (!m) { const t = Date.parse(str); return Number.isNaN(t) ? null : t; }
  const [, y, mo, d, h, mi, se] = m.map(Number);
  return zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: mi, second: se || 0 }, tz);
}

/** Convert wall-clock time in an IANA zone to epoch ms (two-pass offset correction, handles DST). */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const off1 = tzOffsetMs(asUtc, tz);
  const guess = asUtc - off1;
  const off2 = tzOffsetMs(guess, tz);
  return off1 === off2 ? guess : asUtc - off2;
}

export function tzOffsetMs(ts, tz) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
  catch { fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
  const o = {};
  for (const prt of fmt.formatToParts(new Date(ts))) o[prt.type] = prt.value;
  const local = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour) % 24, Number(o.minute), Number(o.second));
  return local - Math.floor(ts / 1000) * 1000;
}

/** Normalise a YCLIENTS record object into the shape stored in our `records` table. */
export function normalizeRecord(rec, { companyId, tz = 'Europe/Moscow', normalizePhone = (x) => x } = {}) {
  const start = parseYcDate(rec.datetime || rec.date, tz);
  const lengthSec = Number(rec.seance_length ?? rec.length ?? 0);
  const client = rec.client ?? null;
  const name = client ? [client.name, client.surname].filter(Boolean).join(' ').trim() || client.display_name || '' : '';
  return {
    id: Number(rec.id),
    companyId: Number(rec.company_id ?? companyId),
    clientPhone: client?.phone ? normalizePhone(client.phone) : null,
    clientName: name || null,
    clientId: client?.id ?? null,
    staffId: rec.staff_id ?? rec.staff?.id ?? null,
    staffName: rec.staff?.name ?? null,
    services: (rec.services ?? []).map((s) => ({ id: s.id, title: s.title, cost: s.cost })),
    datetime: rec.datetime ?? rec.date ?? null,
    startTs: start,
    endTs: start != null ? start + lengthSec * 1000 : null,
    lengthSec,
    attendance: Number(rec.attendance ?? rec.visit_attendance ?? 0),
    confirmed: Number(rec.confirmed ?? 0) === 1,
    deleted: Boolean(rec.deleted),
    online: Boolean(rec.online),
    comment: rec.comment ?? '',
    reviewLink: rec.review_link ?? null,
    shortLink: rec.short_link ?? null,
    createDate: rec.create_date ?? null,
    lastChange: rec.last_change_date ?? null,
    raw: rec,
  };
}

export function ymd(ts, tz = 'Europe/Moscow') {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(ts)); // en-CA gives YYYY-MM-DD
}
