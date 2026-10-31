import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { planJobs, computeDue, checkAtRun, applyQuietHours, matchesFilters, DEFAULT_RULES } from '../src/rules.js';

const H = 3600e3;
function setup(now) {
  const db = openDb();
  const rules = DEFAULT_RULES.map((r) => db.saveRule({ ...r, enabled: true }));
  const start = now + 26 * H;
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', clientName: 'Анна', startTs: start, endTs: start + H, services: [{ id: 1, title: 'Стрижка' }], staffId: 9, createDate: new Date(now - 60e3).toISOString() });
  return { db, rules, start };
}

test('planJobs creates one pending job per applicable rule and is idempotent', () => {
  const now = Date.now();
  const { db, start } = setup(now);
  const s1 = planJobs(db, db.listRules(true), db.recordsForPlanning(0, Infinity), { now });
  assert.equal(s1.created, 5);
  const jobs = db.listJobs();
  const byType = Object.fromEntries(jobs.map((j) => [j.rule_type + ':' + j.rule_name, j.due_at]));
  assert.equal(byType['before_visit:Напоминание за день'], start - 24 * H);
  assert.equal(byType['before_visit:Напоминание за 2 часа'], start - 2 * H);
  assert.equal(byType['after_visit:Запрос отзыва'], start + H + 2 * H);
  assert.equal(byType['return_visit:Приглашение вернуться'], start + H + 30 * 24 * H);
  assert.ok(byType['on_create:Подтверждение новой записи'] >= now);
  const s2 = planJobs(db, db.listRules(true), db.recordsForPlanning(0, Infinity), { now });
  assert.deepEqual(s2, { created: 0, updated: 0, cancelled: 0, skipped: 0 });
});

test('rescheduling and cancellation follow the record', () => {
  const now = Date.now();
  const { db, start } = setup(now);
  planJobs(db, db.listRules(true), db.recordsForPlanning(0, Infinity), { now });
  const rec = db.getRecord(1);
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: rec.client_phone, startTs: start + 2 * H, endTs: start + 3 * H, services: rec.services, createDate: rec.create_date });
  const s = planJobs(db, db.listRules(true), db.recordsForPlanning(0, Infinity), { now });
  assert.equal(s.updated, 4); // on_create stays (due computed from "now")
  assert.equal(db.listJobs().find((j) => j.rule_name === 'Напоминание за день').due_at, start + 2 * H - 24 * H);
  db.markRecordDeleted(1);
  const s2 = planJobs(db, db.listRules(true), db.recordsForPlanning(0, Infinity), { now });
  assert.equal(s2.cancelled, 5);
  assert.ok(db.listJobs().every((j) => j.status === 'cancelled'));
});

test('jobs whose time passed beyond grace are stored as skipped; old bookings get no on_create', () => {
  const now = Date.now();
  const db = openDb();
  const rule = db.saveRule({ name: 'за день', type: 'before_visit', offsetMin: 1440, template: 'x' });
  const onCreate = db.saveRule({ name: 'new', type: 'on_create', offsetMin: 0, template: 'x', options: { maxAgeMin: 180 } });
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', startTs: now + 2 * H, endTs: now + 3 * H, createDate: new Date(now - 5 * H).toISOString() });
  const s = planJobs(db, [rule, onCreate], db.recordsForPlanning(0, Infinity), { now });
  assert.equal(s.skipped, 1); assert.equal(s.created, 0);
  assert.equal(computeDue(onCreate, db.getRecord(1), { now }), null);
});

test('filters, quiet hours and run-time checks', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0);
  const rec = { staff_id: 9, services: [{ id: 1 }], online: false };
  assert.equal(matchesFilters({ options: { staffIds: [9] } }, rec), true);
  assert.equal(matchesFilters({ options: { staffIds: [10] } }, rec), false);
  assert.equal(matchesFilters({ options: { serviceIds: [2] } }, rec), false);
  assert.equal(matchesFilters({ options: { onlineOnly: true } }, rec), false);
  // 23:30 Moscow → shifted to 09:00 next morning
  assert.equal(applyQuietHours(Date.UTC(2026, 10, 5, 20, 30), { from: 21, to: 9 }, 'Europe/Moscow'), Date.UTC(2026, 10, 6, 6, 0));
  assert.equal(applyQuietHours(Date.UTC(2026, 10, 5, 12, 0), { from: 21, to: 9 }, 'Europe/Moscow'), Date.UTC(2026, 10, 5, 12, 0));
  assert.equal(applyQuietHours(Date.UTC(2026, 10, 5, 4, 0), { from: 21, to: 9 }, 'Europe/Moscow'), Date.UTC(2026, 10, 5, 6, 0));

  const db = openDb();
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', startTs: now + H, endTs: now + 2 * H, attendance: 2 });
  const r = db.getRecord(1);
  assert.deepEqual(checkAtRun({ type: 'before_visit', options: { skipIfConfirmed: true } }, r, db, { now }), { ok: false, reason: 'клиент уже подтвердил' });
  assert.deepEqual(checkAtRun({ type: 'before_visit', options: {} }, r, db, { now }), { ok: true });
  assert.equal(checkAtRun({ type: 'after_visit', options: {} }, r, db, { now }).ok, false);
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', startTs: now - 3 * H, endTs: now - 2 * H, attendance: 1 });
  assert.equal(checkAtRun({ type: 'after_visit', options: {} }, db.getRecord(1), db, { now }).ok, true);
  assert.equal(checkAtRun({ type: 'return_visit', options: {} }, db.getRecord(1), db, { now }).ok, true);
  db.upsertRecord({ id: 2, companyId: 1, clientPhone: '79160000001', startTs: now + 48 * H, endTs: now + 49 * H });
  assert.equal(checkAtRun({ type: 'return_visit', options: {} }, db.getRecord(1), db, { now }).reason, 'клиент уже записан снова');
  db.upsertContact({ phone: '79160000001', unsubscribed: true });
  assert.equal(checkAtRun({ type: 'before_visit', options: {} }, db.getRecord(2), db, { now }).reason, 'клиент отписался');
});
