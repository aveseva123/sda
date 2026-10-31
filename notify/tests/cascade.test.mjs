import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { processMessage, processQueue, applyDeliveryStatus } from '../src/cascade.js';
import { ChannelError } from '../src/channels/index.js';

function ch(name, { fail, permanent = true, receipts = false, reach = () => true } = {}) {
  const c = { name, hasDeliveryReceipts: receipts, sent: [], canReach: reach };
  c.send = async (m) => { if (fail) throw new ChannelError(`${name} down`, { permanent }); c.sent.push(m.text); return { externalId: `${name}-${m.id}`, status: 'sent' }; };
  return c;
}

test('falls through unreachable and failing channels to the first that works', async () => {
  const db = openDb();
  const channels = { telegram: ch('telegram', { reach: (c) => Boolean(c.telegram_chat_id) }), whatsapp: ch('whatsapp', { fail: true }), sms: ch('sms') };
  const m = db.insertMessage({ phone: '79160000001', text: 'hi', channels: ['telegram', 'whatsapp', 'sms'] });
  const out = await processMessage(db, m, channels, { now: 1000 });
  assert.equal(out.status, 'sent'); assert.equal(out.current_channel, 'sms'); assert.equal(out.fallback_at, null);
  assert.deepEqual(db.attemptsForMessage(m.id).map((a) => [a.channel, a.status]), [['telegram', 'skipped'], ['whatsapp', 'failed'], ['sms', 'sent']]);
  assert.equal(channels.sms.sent.length, 1);
});

test('all channels failing → failed; missing channel config is skipped', async () => {
  const db = openDb();
  const m = db.insertMessage({ phone: '79160000001', text: 'hi', channels: ['nope', 'sms'] });
  const out = await processMessage(db, m, { sms: ch('sms', { fail: true }) });
  assert.equal(out.status, 'failed'); assert.match(out.error, /sms down/);
});

test('temporary errors are retried, then fall through', async () => {
  const db = openDb();
  const channels = { sms: ch('sms', { fail: true, permanent: false }), log: ch('log') };
  const m = db.insertMessage({ phone: '79160000001', text: 'hi', channels: ['sms', 'log'] });
  let out = await processMessage(db, m, channels, { now: 0, maxTempRetries: 2 });
  assert.equal(out.status, 'queued'); assert.equal(out.fallback_at, 60e3); assert.equal(out.meta.retries, 1);
  assert.equal(db.messagesToProcess(30e3).length, 0, 'not due yet');
  out = (await processQueue(db, channels, { now: 60e3, maxTempRetries: 2 }))[0];
  assert.equal(out.meta.retries, 2);
  out = (await processQueue(db, channels, { now: 200e3, maxTempRetries: 2 }))[0];
  assert.equal(out.status, 'sent'); assert.equal(out.current_channel, 'log');
});

test('delivery receipts: timeout and failed status move to the next channel; delivered finalises', async () => {
  const db = openDb();
  const channels = { whatsapp: ch('whatsapp', { receipts: true }), sms: ch('sms') };
  let m = db.insertMessage({ phone: '79160000001', text: 'a', channels: ['whatsapp', 'sms'] });
  m = await processMessage(db, m, channels, { now: 0, fallbackSec: 600 });
  assert.equal(m.status, 'sent'); assert.equal(m.fallback_at, 600e3); assert.equal(m.external_id, `whatsapp-${m.id}`);
  assert.equal(db.messagesToProcess(599e3).length, 0);
  const [after] = await processQueue(db, channels, { now: 600e3 });
  assert.equal(after.current_channel, 'sms'); assert.equal(after.status, 'sent');
  assert.equal(db.attemptsForMessage(m.id)[0].status, 'timeout');

  let m2 = db.insertMessage({ phone: '79160000002', text: 'b', channels: ['whatsapp', 'sms'] });
  m2 = await processMessage(db, m2, channels, { now: 0 });
  applyDeliveryStatus(db, 'whatsapp', `whatsapp-${m2.id}`, 'delivered');
  assert.equal(db.getMessage(m2.id).status, 'delivered'); assert.equal(db.getMessage(m2.id).fallback_at, null);
  applyDeliveryStatus(db, 'whatsapp', `whatsapp-${m2.id}`, 'read');
  assert.equal(db.getMessage(m2.id).status, 'read');
  assert.equal(db.messagesToProcess(1e9).length, 0);

  let m3 = db.insertMessage({ phone: '79160000003', text: 'c', channels: ['whatsapp', 'sms'] });
  m3 = await processMessage(db, m3, channels, { now: 0 });
  applyDeliveryStatus(db, 'whatsapp', `whatsapp-${m3.id}`, 'failed', { error: 'Message undeliverable' });
  const q = db.getMessage(m3.id);
  assert.equal(q.status, 'queued'); assert.equal(q.channel_index, 1);
  const [done] = await processQueue(db, channels, { now: 1 });
  assert.equal(done.current_channel, 'sms');
});
