// Pulls appointments from YCLIENTS into the local `records` cache and keeps `contacts` in sync.
import { normalizeRecord, ymd } from './yclients.js';
import { normalizePhone } from './phone.js';

const DAY = 24 * 3600 * 1000;

/**
 * Fetch records for [today - pastDays, today + horizonDays] (including cancelled ones) and upsert them.
 * Returns { fetched, changed, deleted }.
 */
export async function syncRecords({ db, yc, company, horizonDays = 14, pastDays = 1, now = Date.now() }) {
  const tz = company?.timezone_name || 'Europe/Moscow';
  const companyId = yc.companyId;
  const startDate = ymd(now - pastDays * DAY, tz);
  const endDate = ymd(now + horizonDays * DAY, tz);
  const items = await yc.records({ companyId, startDate, endDate, withDeleted: true });
  let changed = 0, deleted = 0;
  db.tx(() => {
    for (const raw of items) {
      const rec = normalizeRecord(raw, { companyId, tz, normalizePhone });
      const prev = db.getRecord(rec.id);
      if (!prev || prev.last_change !== rec.lastChange || prev.deleted !== (rec.deleted ? 1 : 0) || prev.attendance !== rec.attendance || prev.start_ts !== rec.startTs) changed++;
      if (rec.deleted) deleted++;
      db.upsertRecord(rec);
      if (rec.clientPhone) db.upsertContact({ phone: rec.clientPhone, name: rec.clientName, yclientsClientId: rec.clientId });
    }
  });
  db.setSetting('sync.last', { at: now, fetched: items.length, changed, startDate, endDate });
  return { fetched: items.length, changed, deleted, startDate, endDate };
}

/** Apply a single record payload (e.g. from a webhook or manual refresh). */
export function applyRecord(db, raw, { companyId, tz = 'Europe/Moscow' }) {
  const rec = normalizeRecord(raw, { companyId, tz, normalizePhone });
  db.upsertRecord(rec);
  if (rec.clientPhone) db.upsertContact({ phone: rec.clientPhone, name: rec.clientName, yclientsClientId: rec.clientId });
  return db.getRecord(rec.id);
}
