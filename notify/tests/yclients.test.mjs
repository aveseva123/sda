import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { YclientsClient } from '../src/yclients.js';
import { openDb } from '../src/db.js';
import { syncRecords } from '../src/sync.js';
import { mockYclients, record } from './helpers.mjs';

const yc = await mockYclients();
after(() => yc.close());

test('auth returns user token and sends the partner bearer header', async () => {
  const c = new YclientsClient({ partnerToken: 'PARTNER', baseUrl: yc.url });
  const u = await c.auth('admin@salon.ru', 'pass');
  assert.equal(u.user_token, 'USERTOKEN'); assert.equal(c.userToken, 'USERTOKEN');
  const req = yc.state.requests.at(-1);
  assert.equal(req.headers.authorization, 'Bearer PARTNER');
  assert.equal(req.headers.accept, 'application/vnd.yclients.v2+json');
  await assert.rejects(() => c.auth('admin@salon.ru', 'wrong'), /Неверный логин/);
  await assert.rejects(() => c.auth('2fa@salon.ru', 'x'), (e) => e.code === '2fa');
});

test('records are paged and carry both tokens; setAttendance re-sends the record body', async () => {
  yc.state.records = Array.from({ length: 250 }, (_, i) => record({ id: i + 1 }));
  const c = new YclientsClient({ partnerToken: 'PARTNER', userToken: 'USERTOKEN', companyId: 4564, baseUrl: yc.url });
  const list = await c.records({ startDate: '2026-11-01', endDate: '2026-11-15', pageSize: 200 });
  assert.equal(list.length, 250);
  const reqs = yc.state.requests.filter((r) => r.path === '/api/v1/records/4564');
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].headers.authorization, 'Bearer PARTNER, User USERTOKEN');
  assert.deepEqual(reqs[0].query, { page: '1', count: '200', start_date: '2026-11-01', end_date: '2026-11-15', with_deleted: '1' });
  const upd = await c.setAttendance(5, 2);
  assert.equal(upd.attendance, 2);
  const put = yc.state.updates[0];
  assert.equal(put.id, 5);
  assert.equal(put.body.attendance, 2); assert.equal(put.body.staff_id, 9); assert.equal(put.body.seance_length, 3600); assert.equal(put.body.services[0].id, 1); assert.equal(put.body.send_sms, false);
});

test('syncRecords upserts records and contacts, detecting changes', async () => {
  const start = new Date(Date.now() + 2 * 24 * 3600e3);
  yc.state.records = [record({ id: 1, start }), record({ id: 2, start, phone: '8 (916) 000-00-02' }), record({ id: 3, start, client: null })];
  const c = new YclientsClient({ partnerToken: 'PARTNER', userToken: 'USERTOKEN', companyId: 4564, baseUrl: yc.url });
  const db = openDb();
  const r1 = await syncRecords({ db, yc: c, company: { timezone_name: 'Europe/Moscow' }, horizonDays: 14 });
  assert.equal(r1.fetched, 3); assert.equal(r1.changed, 3);
  assert.equal(db.getRecord(2).client_phone, '79160000002');
  assert.equal(db.getRecord(3).client_phone, null);
  assert.equal(db.getContact('79160000002').name, 'Анна Петрова');
  assert.equal(db.getContact('79160000002').yclients_client_id, 55);
  const r2 = await syncRecords({ db, yc: c, company: { timezone_name: 'Europe/Moscow' }, horizonDays: 14 });
  assert.equal(r2.changed, 0);
  yc.state.records[0].deleted = true; yc.state.records[0].last_change_date = '2030-01-01T00:00:00+03:00';
  const r3 = await syncRecords({ db, yc: c, company: { timezone_name: 'Europe/Moscow' }, horizonDays: 14 });
  assert.equal(r3.changed, 1); assert.equal(db.getRecord(1).deleted, 1);
  assert.ok(db.getSetting('sync.last').at > 0);
});
