import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, mockYclients, mockTelegramFetch, record } from './helpers.mjs';

const yc = await mockYclients();
const tg = mockTelegramFetch();
const fetchImpl = (url, init) => (String(url).includes('api.telegram.org') ? tg.fetchImpl(url, init) : globalThis.fetch(url, init));
const ctx = await makeApp({ yclients: yc, fetchImpl, channels: { telegram: { enabled: true, botToken: 'TOKEN' }, log: { enabled: true } }, settings: { cascade: ['telegram', 'log'], quietHours: null } });
const { app, db, call } = ctx;
after(() => Promise.all([ctx.close(), yc.close()]));

test('auth: admin and api tokens', async () => {
  assert.equal((await call('GET', '/admin/overview', undefined, null)).status, 401);
  assert.equal((await call('GET', '/admin/overview', undefined, 'wrong')).status, 401);
  assert.equal((await call('GET', '/admin/overview')).status, 200);
  assert.equal((await call('GET', '/api/v1/messages', undefined, 'api-secret')).status, 200);
  assert.equal((await call('GET', '/admin/overview', undefined, 'api-secret')).status, 401);
  assert.equal((await call('GET', '/health', undefined, null)).data.ok, true);
});

test('public API sends a message through the cascade', async () => {
  const r = await call('POST', '/api/v1/messages', { phone: '+7 916 000-00-09', text: 'Привет' }, 'api-secret');
  assert.equal(r.status, 201); assert.equal(r.data.status, 'sent'); assert.equal(r.data.currentChannel, 'log'); // telegram skipped: no chat id
  const one = await call('GET', `/api/v1/messages/${r.data.id}`, undefined, 'api-secret');
  assert.deepEqual(one.data.attempts.map((a) => [a.channel, a.status]), [['telegram', 'skipped'], ['log', 'sent']]);
  assert.equal((await call('POST', '/api/v1/messages', { phone: '12', text: 'x' }, 'api-secret')).status, 400);
  assert.equal((await call('POST', '/api/v1/messages', { phone: '79160000009', text: '' }, 'api-secret')).status, 400);
});

test('YCLIENTS login, sync, schedule view with phones and planned jobs', async () => {
  const start = new Date(Date.now() + 26 * 3600e3);
  yc.state.records = [record({ id: 11, start }), record({ id: 12, start: new Date(Date.now() + 3 * 3600e3), phone: '79160000002' })];
  const login = await call('POST', '/admin/yclients/auth', { login: 'admin@salon.ru', password: 'pass' });
  assert.equal(login.status, 200); assert.equal(login.data.user.name, 'Админ'); assert.equal(login.data.companies[0].id, 4564);
  assert.equal(app.company.title, 'Салон «Тест»');
  const sync = await call('POST', '/admin/yclients/sync');
  assert.equal(sync.data.fetched, 2); assert.ok(sync.data.plan.created >= 4);
  const sched = await call('GET', '/admin/schedule');
  assert.equal(sched.data.records.length, 2);
  const r11 = sched.data.records.find((r) => r.id === 11);
  assert.equal(r11.client.phone, '79161234567'); assert.equal(r11.client.phoneFormatted, '+7 916 123-45-67'); assert.equal(r11.client.name, 'Анна Петрова');
  assert.ok(r11.jobs.some((j) => j.ruleName === 'Напоминание за день' && j.status === 'pending'));
  const pub = await call('GET', '/api/v1/schedule', undefined, 'api-secret');
  assert.equal(pub.data.records.length, 2);
  const settings = await call('GET', '/admin/settings');
  assert.equal(settings.data.yclients.partnerToken, '••••••••'); assert.equal(settings.data.yclients.userToken, '••••••••');
  // saving masked secrets keeps the stored values
  await call('PUT', '/admin/settings', { yclients: { partnerToken: '••••••••', companyId: 4564 } });
  assert.equal(app.yclientsSettings.partnerToken, 'PARTNER');
});

test('due job renders the template and sends; on_create job goes out immediately', async () => {
  const jobs = await call('GET', '/admin/jobs?status=pending');
  const onCreate = jobs.data.find((j) => j.rule_type === 'on_create' && j.record_id === 11);
  assert.ok(onCreate);
  const run = await call('POST', `/admin/jobs/${onCreate.id}/run`);
  assert.equal(run.data.message.status, 'sent');
  assert.match(run.data.message.text, /^Анна, вы записаны в Салон «Тест» \d+ [а-я]+ в \d\d:\d\d\.\nУслуги: Стрижка\. Мастер: Оксана Иванова\.\nАдрес: ул\. Ленина, 1\. Телефон: \+7 495 000-00-00\.$/);
  const rec = await call('GET', '/admin/records/11');
  assert.equal(rec.data.messages.length, 1);
  assert.equal(rec.data.jobs.find((j) => j.id === onCreate.id).status, 'done');
});

test('Telegram: contact sharing links the chat, reminders go to Telegram, confirm button updates YCLIENTS', async () => {
  // client shares the phone
  await app.onTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 777 }, from: { id: 777, username: 'anna' }, text: '/start' } });
  assert.equal(tg.calls.at(-1).method, 'sendMessage'); assert.ok(tg.calls.at(-1).body.reply_markup.keyboard[0][0].request_contact);
  await app.onTelegramUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 777 }, from: { id: 777, username: 'anna' }, contact: { phone_number: '+7 916 123-45-67', user_id: 777 } } });
  assert.equal(db.getContact('79161234567').telegram_chat_id, '777');

  // the 24h reminder with confirmation buttons: force-run it
  const jobs = await call('GET', '/admin/jobs?status=pending');
  const rem = jobs.data.find((j) => j.rule_name === 'Напоминание за день' && j.record_id === 11);
  const run = await call('POST', `/admin/jobs/${rem.id}/run`);
  assert.equal(run.data.message.currentChannel, 'telegram'); assert.equal(run.data.message.status, 'sent');
  const sent = tg.calls.filter((c) => c.method === 'sendMessage').at(-1);
  assert.equal(String(sent.body.chat_id), '777');
  assert.match(sent.body.text, /напоминаем о записи/);
  const btn = sent.body.reply_markup.inline_keyboard[0][0];
  assert.equal(btn.text, '✅ Подтверждаю');
  const cb = JSON.parse(btn.callback_data);
  assert.equal(cb.a, 'confirm'); assert.equal(cb.r, 11);

  // client presses "confirm"
  await app.onTelegramUpdate({ update_id: 3, callback_query: { id: 'cb1', from: { id: 777 }, message: { chat: { id: 777 } }, data: btn.callback_data } });
  assert.deepEqual(yc.state.updates.map((u) => [u.id, u.body.attendance]), [[11, 2]]);
  assert.equal(db.getRecord(11).attendance, 2);
  assert.match(tg.calls.filter((c) => c.method === 'sendMessage').at(-1).body.text, /подтверждён/);
  assert.equal(db.listInbound()[0].action, 'confirm');

  // second reminder is skipped only if skipIfConfirmed; "за 2 часа" has skipIfConfirmed=false → still sends
  const two = (await call('GET', '/admin/jobs?status=pending')).data.find((j) => j.rule_name === 'Напоминание за 2 часа' && j.record_id === 11);
  db.updateJob(two.id, { dueAt: Date.now() - 1000 });
  await app.runDueJobs();
  assert.equal(db.get('SELECT status FROM jobs WHERE id = ?', two.id).status, 'done');
  // but a skipIfConfirmed rule is skipped
  const rule = db.listRules().find((r) => r.name === 'Напоминание за день');
  const j2 = db.insertJob({ key: 'manual-test', ruleId: rule.id, recordId: 11, phone: '79161234567', dueAt: Date.now() - 1 });
  await app.runDueJobs();
  assert.equal(db.get('SELECT status, note FROM jobs WHERE id = ?', j2).note, 'клиент уже подтвердил');
});

test('Telegram webhook endpoint requires the secret header; blocked bot falls back to the next channel', async () => {
  const bad = await fetch(ctx.base + '/webhooks/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ update_id: 9 }) });
  assert.equal(bad.status, 403);
  const ok = await fetch(ctx.base + '/webhooks/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': app.telegramSecret() }, body: JSON.stringify({ update_id: 9, message: { chat: { id: 777 }, from: { id: 777 }, text: 'спасибо' } }) });
  assert.equal(ok.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db.listInbound()[0].text, 'спасибо');

  db.upsertContact({ phone: '79160000403', telegramChatId: '403' });
  const r = await call('POST', '/admin/send', { phone: '79160000403', text: 'x' });
  assert.equal(r.data.currentChannel, 'log'); assert.equal(r.data.status, 'sent');
  const detail = await call('GET', `/admin/messages/${r.data.id}`);
  assert.deepEqual(detail.data.attempts.map((a) => [a.channel, a.status]), [['telegram', 'failed'], ['log', 'sent']]);
  assert.match(detail.data.attempts[0].error, /blocked/);
});

test('WhatsApp webhook: verification, delivery statuses and button replies', async () => {
  app.saveSettings('channels', { ...app.channelSettings, whatsapp: { enabled: true, phoneNumberId: '1', accessToken: 't', verifyToken: 'verify-me' } });
  const v = await fetch(ctx.base + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
  assert.equal(v.status, 200); assert.equal(await v.text(), '12345');
  assert.equal((await fetch(ctx.base + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status, 403);
  const m = db.insertMessage({ phone: '79160000005', text: 'x', channels: ['whatsapp'] });
  db.insertAttempt({ messageId: m.id, channel: 'whatsapp', status: 'sent', externalId: 'wamid.1' });
  db.updateMessage(m.id, { status: 'sent', currentChannel: 'whatsapp', externalId: 'wamid.1', fallbackAt: Date.now() + 600e3 });
  const body = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read', recipient_id: '79160000005' }] } }] }] };
  const res = await call('POST', '/webhooks/whatsapp', body, null);
  assert.equal(res.status, 200); assert.equal(db.getMessage(m.id).status, 'read');
  // Fake fetch for reply sending; capture it
  const yes = { entry: [{ changes: [{ value: { messages: [{ from: '79160000002', id: 'wamid.2', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'confirm:12:0', title: 'Подтверждаю' } } }] } }] }] };
  app.channels.whatsapp.send = async () => ({ externalId: 'x', status: 'sent' });
  const r2 = await call('POST', '/webhooks/whatsapp', yes, null);
  assert.deepEqual(r2.data.handled, ['confirm']);
  assert.equal(db.getRecord(12).attendance, 2);
  assert.equal(yc.state.updates.at(-1).id, 12);
});

test('YCLIENTS webhook applies record payloads when the token matches', async () => {
  const payload = { company_id: 4564, resource: 'record', resource_id: 13, status: 'create', data: record({ id: 13, start: new Date(Date.now() + 30 * 3600e3), phone: '79160000013' }) };
  assert.equal((await call('POST', '/webhooks/yclients?token=bad', payload, null)).status, 403);
  const ok = await call('POST', `/webhooks/yclients?token=${app.general.webhookSecret}`, payload, null);
  assert.equal(ok.data.applied, 1); assert.equal(db.getRecord(13).client_phone, '79160000013');
  assert.ok(db.pendingJobsForRecord(13).length >= 3);
  await call('POST', `/webhooks/yclients?token=${app.general.webhookSecret}`, { ...payload, status: 'delete' }, null);
  assert.equal(db.getRecord(13).deleted, 1);
  assert.equal(db.pendingJobsForRecord(13).length, 0);
});

test('rules CRUD and preview', async () => {
  const created = await call('POST', '/admin/rules', { name: 'Тест', type: 'before_visit', offsetMin: 60, template: 'Через час, {{client_name}}!', channels: ['log'] });
  assert.equal(created.status, 201); assert.equal(created.data.channels[0], 'log');
  const upd = await call('PUT', `/admin/rules/${created.data.id}`, { ...created.data, enabled: false });
  assert.equal(upd.data.enabled, false);
  assert.equal((await call('POST', '/admin/rules', { name: '', type: 'before_visit', template: 'x' })).status, 400);
  assert.equal((await call('POST', '/admin/rules', { name: 'x', type: 'weird', template: 'x' })).status, 400);
  const prev = await call('POST', '/admin/rules/preview', { template: '{{client_name}} / {{company}} / {{time}}', recordId: 11 });
  assert.match(prev.data.text, /^Анна \/ Салон «Тест» \/ \d\d:\d\d$/);
  await call('DELETE', `/admin/rules/${created.data.id}`);
  assert.equal(db.getRule(created.data.id), null);
});

test('static panel is served', async () => {
  const res = await fetch(ctx.base + '/');
  assert.equal(res.status, 200); assert.match(await res.text(), /Уведомления клиентам/);
  assert.equal((await fetch(ctx.base + '/app.js')).status, 200);
  assert.equal((await fetch(ctx.base + '/../server.mjs')).status, 404);
});
