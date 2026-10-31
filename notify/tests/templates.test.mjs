import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, recordVars, fmtTime, usedVariables } from '../src/templates.js';
import { parseYcDate, zonedToUtc, ymd, normalizeRecord } from '../src/yclients.js';
import { normalizePhone, formatPhone, maskPhone } from '../src/phone.js';

test('normalizePhone handles common Russian formats', () => {
  assert.equal(normalizePhone('+7 (916) 123-45-67'), '79161234567');
  assert.equal(normalizePhone('8 916 123 45 67'), '79161234567');
  assert.equal(normalizePhone('9161234567'), '79161234567');
  assert.equal(normalizePhone('79161234567'), '79161234567');
  assert.equal(normalizePhone('+375291234567'), '375291234567');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(formatPhone('79161234567'), '+7 916 123-45-67');
  assert.equal(maskPhone('79161234567'), '+7916***4567');
});

test('parseYcDate understands YCLIENTS formats', () => {
  assert.equal(parseYcDate('2026-11-05T14:30:00+03:00'), Date.UTC(2026, 10, 5, 11, 30));
  assert.equal(parseYcDate('2019-01-16T20:35:11+0900'), Date.UTC(2019, 0, 16, 11, 35, 11));
  assert.equal(parseYcDate('2026-11-05 14:30:00', 'Europe/Moscow'), Date.UTC(2026, 10, 5, 11, 30));
  assert.equal(parseYcDate('2026-07-01 12:00:00', 'Asia/Yekaterinburg'), Date.UTC(2026, 6, 1, 7, 0));
  assert.equal(parseYcDate(''), null);
});

test('zonedToUtc handles DST transitions', () => {
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 15, hour: 12 }, 'Europe/Berlin'), Date.UTC(2026, 0, 15, 11));
  assert.equal(zonedToUtc({ year: 2026, month: 7, day: 15, hour: 12 }, 'Europe/Berlin'), Date.UTC(2026, 6, 15, 10));
  assert.equal(ymd(Date.UTC(2026, 10, 5, 22, 30), 'Europe/Moscow'), '2026-11-06');
});

test('render substitutes variables and filters', () => {
  const ts = Date.UTC(2026, 10, 5, 11, 30);
  const vars = recordVars({ client_name: 'Анна Петрова', client_phone: '79161234567', start_ts: ts, services: [{ title: 'Стрижка', cost: 1500 }, { title: 'Укладка', cost: 1000 }], staff_name: 'Оксана Иванова', review_link: 'https://r' }, { title: 'Салон', address: 'Ленина, 1', timezone_name: 'Europe/Moscow' });
  assert.equal(vars.client_name, 'Анна');
  assert.equal(vars.time, '14:30');
  assert.equal(vars.date, '5 ноября');
  assert.equal(vars.weekday, 'четверг');
  assert.equal(vars.cost, '2500');
  const out = render('{{client_name}}, ждём {{datetime}} ({{weekday}}): {{services}} у {{staff_first_name}}. {{company}}, {{address}}. {{unknown}}', vars);
  assert.equal(out, 'Анна, ждём 5 ноября в 14:30 (четверг): Стрижка, Укладка у Оксана. Салон, Ленина, 1.');
  assert.equal(render('{{client_name|default:Здравствуйте}}!', { client_name: '' }), 'Здравствуйте!');
  assert.equal(render('{{x|upper}} {{y|capitalize}}', { x: 'abc', y: 'мир' }), 'ABC Мир');
  assert.deepEqual(usedVariables('{{a}} {{b|default:1}} {{a}}'), ['a', 'b']);
});

test('time formatting respects company time zone', () => {
  const ts = Date.UTC(2026, 10, 5, 11, 30);
  assert.equal(fmtTime(ts, 'Europe/Moscow'), '14:30');
  assert.equal(fmtTime(ts, 'Asia/Vladivostok'), '21:30');
  assert.equal(fmtTime(ts, 'Invalid/Zone'), '14:30');
});

test('normalizeRecord maps YCLIENTS record to storage shape', () => {
  const rec = normalizeRecord({ id: 2, company_id: 4564, staff_id: 9, staff: { name: 'Оксана' }, services: [{ id: 1, title: 'Стрижка', cost: 100 }], client: { id: 5, name: 'Иван', surname: 'Иванов', phone: '+7 (916) 000-00-01' }, datetime: '2026-11-05T14:30:00+03:00', seance_length: 3600, attendance: 2, deleted: false, online: true }, { companyId: 4564, normalizePhone });
  assert.equal(rec.clientPhone, '79160000001');
  assert.equal(rec.clientName, 'Иван Иванов');
  assert.equal(rec.startTs, Date.UTC(2026, 10, 5, 11, 30));
  assert.equal(rec.endTs, rec.startTs + 3600e3);
  assert.equal(rec.attendance, 2);
  assert.equal(rec.online, true);
});
