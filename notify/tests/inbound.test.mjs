import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { classify, handleInbound, resolveRecord } from '../src/inbound.js';

test('classify understands Russian replies', () => {
  for (const t of ['1', 'Да', 'да, приду', 'Подтверждаю!', 'ок', '+', '✅ Подтверждаю']) assert.equal(classify(t), 'confirm', t);
  for (const t of ['2', 'нет', 'Отменить', 'перенести на вторник', 'не приду', '❌ Отменить / перенести']) assert.equal(classify(t), 'cancel', t);
  for (const t of ['стоп', 'STOP', 'отписаться']) assert.equal(classify(t), 'stop', t);
  assert.equal(classify('а можно пораньше?'), 'text');
  assert.equal(classify(''), 'empty');
});

test('confirmation resolves the nearest record, updates YCLIENTS and the local cache', async () => {
  const db = openDb(); const now = Date.now();
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', startTs: now + 20 * 3600e3, endTs: now + 21 * 3600e3 });
  db.upsertRecord({ id: 2, companyId: 1, clientPhone: '79160000001', startTs: now + 5 * 24 * 3600e3, endTs: now + 5 * 24 * 3600e3 + 3600e3 });
  const calls = []; const yc = { setAttendance: async (id, att) => { calls.push([id, att]); } };
  const admin = [];
  const ctx = { db, yc, settings: {}, notifyAdmin: async (t) => admin.push(t) };
  const r = await handleInbound(ctx, { channel: 'whatsapp', phone: '+79160000001', text: 'да' });
  assert.equal(r.action, 'confirm'); assert.equal(r.recordId, 1);
  assert.deepEqual(calls, [[1, 2]]);
  assert.equal(db.getRecord(1).attendance, 2);
  assert.match(r.reply, /подтверждён/);
  assert.ok(db.getSetting('wa.lastInbound.79160000001') > 0);

  const c = await handleInbound(ctx, { channel: 'whatsapp', phone: '79160000001', text: '2' });
  assert.equal(c.action, 'cancel'); assert.equal(c.recordId, 1); assert.equal(admin.length, 1); assert.match(admin[0], /отменить/);

  const s = await handleInbound(ctx, { channel: 'whatsapp', phone: '79160000001', text: 'стоп' });
  assert.equal(s.action, 'stop'); assert.equal(db.getContact('79160000001').unsubscribed, 1);
  const back = await handleInbound(ctx, { channel: 'whatsapp', phone: '79160000001', text: 'старт' });
  assert.equal(back.action, 'resubscribe'); assert.equal(db.getContact('79160000001').unsubscribed, 0);

  const free = await handleInbound(ctx, { channel: 'whatsapp', phone: '79160000001', text: 'можно пораньше?' });
  assert.equal(free.action, 'text'); assert.equal(free.reply, null); assert.equal(admin.length, 3);
  assert.equal(db.listInbound().length, 5);
});

test('explicit record id and confirmation-message preference', () => {
  const db = openDb(); const now = Date.now();
  db.upsertRecord({ id: 1, companyId: 1, clientPhone: '79160000001', startTs: now + 2 * 3600e3, endTs: now + 3 * 3600e3 });
  db.upsertRecord({ id: 2, companyId: 1, clientPhone: '79160000001', startTs: now + 48 * 3600e3, endTs: now + 49 * 3600e3 });
  assert.equal(resolveRecord(db, '79160000001', 2, { now }).id, 2);
  assert.equal(resolveRecord(db, '79160000001', null, { now }).id, 1);
  db.insertMessage({ phone: '79160000001', text: 'confirm?', channels: ['log'], recordId: 2 });
  assert.equal(resolveRecord(db, '79160000001', null, { now }).id, 2);
});
