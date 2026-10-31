// Inbound messages from clients (Telegram, WhatsApp): confirmations, cancellations, opt-out, free text.
import { normalizePhone } from './phone.js';
import { ATTENDANCE } from './yclients.js';

const RE_YES = /^\s*(1|да|да,?\s*приду|приду|подтверждаю|ок|ok|окей|\+|✅.*)\s*[.!]*\s*$/i;
// NB: \b is ASCII-only in JS regexes, so Cyrillic word boundaries are expressed with look-aheads.
const RE_NO = /^\s*(2|нет|отмена|отменить|отменяю|перенести|перенос|не\s+приду|❌.*)(?![а-яёa-z])/i;
const RE_STOP = /^\s*(стоп|stop|отписаться|отпишите|unsubscribe)(?![а-яёa-z])/i;

export function classify(text) {
  if (!text) return 'empty';
  if (RE_STOP.test(text)) return 'stop';
  if (RE_YES.test(text)) return 'confirm';
  if (RE_NO.test(text)) return 'cancel';
  return 'text';
}

/** Find the record the reply most likely refers to: explicit id, else the nearest upcoming record for the phone. */
export function resolveRecord(db, phone, recordId, { now = Date.now() } = {}) {
  if (recordId) { const r = db.getRecord(Number(recordId)); if (r) return r; }
  const upcoming = db.listRecords({ phone, fromTs: now - 3600e3, toTs: now + 14 * 24 * 3600e3, limit: 5 });
  // prefer the record for which a confirmation request was sent most recently
  const sent = db.listMessages({ phone, limit: 20 }).find((m) => m.record_id && upcoming.some((r) => r.id === m.record_id));
  if (sent) return upcoming.find((r) => r.id === sent.record_id);
  return upcoming[0] || null;
}

/**
 * Core handler. `ev` = { channel, phone?, chatId?, text, action?, recordId?, from? }.
 * Returns { action, reply, recordId } — reply is the text to send back to the client (or null).
 */
export async function handleInbound(ctx, ev) {
  const { db, yc, settings } = ctx;
  const now = Date.now();
  let phone = ev.phone ? normalizePhone(ev.phone) : null;
  if (!phone && ev.channel === 'telegram' && ev.chatId) phone = db.getContactByTelegram(ev.chatId)?.phone ?? null;
  if (ev.channel === 'whatsapp' && phone) db.setSetting(`wa.lastInbound.${phone}`, now);

  const action = ev.action || classify(ev.text);
  const texts = settings?.replies || {};
  const out = { action, reply: null, recordId: null, phone };

  if (action === 'stop' && phone) {
    db.upsertContact({ phone, unsubscribed: true });
    out.reply = texts.stop || 'Вы отписались от уведомлений. Чтобы снова получать напоминания, напишите «старт».';
  } else if (/^\s*(старт|start)(?![а-яёa-z])/i.test(ev.text || '') && phone && db.getContact(phone)?.unsubscribed) {
    db.upsertContact({ phone, unsubscribed: false });
    out.action = 'resubscribe'; out.reply = 'Уведомления снова включены.';
  } else if (action === 'confirm' || action === 'cancel') {
    const rec = phone ? resolveRecord(db, phone, ev.recordId, { now }) : null;
    out.recordId = rec?.id ?? null;
    if (!rec) {
      out.reply = texts.noRecord || 'Не нашли вашу ближайшую запись. Администратор свяжется с вами.';
    } else if (action === 'confirm') {
      let ok = true;
      if (yc) { try { await yc.setAttendance(rec.id, ATTENDANCE.CONFIRMED); } catch (e) { ok = false; db.log('error', 'inbound', `confirm ${rec.id} in YCLIENTS failed: ${e.message}`); } }
      db.upsertRecord({ ...recordToUpsert(rec), attendance: ATTENDANCE.CONFIRMED });
      out.reply = texts.confirmed || 'Спасибо, визит подтверждён! Ждём вас.';
      if (!ok) out.reply += '';
      // cancel remaining confirmation reminders that are marked skipIfConfirmed — checkAtRun handles this at send time
    } else {
      out.reply = texts.cancelled || 'Передали администратору — он свяжется с вами, чтобы отменить или перенести запись.';
    }
  } else if (action === 'text') {
    out.reply = null; // free text: just log, admin sees it in the panel
  }

  db.insertInbound({ channel: ev.channel, phone, chatId: ev.chatId, text: ev.text, payload: ev.payload, action: out.action, recordId: out.recordId });
  if (ctx.notifyAdmin && ['cancel', 'text', 'stop'].includes(out.action) && (ev.text || out.action !== 'text')) {
    const rec = out.recordId ? db.getRecord(out.recordId) : null;
    const who = `${db.getContact(phone || '')?.name || ''} ${phone ? '+' + phone : ev.chatId || ''}`.trim();
    const what = out.action === 'cancel' ? `❌ просит отменить/перенести запись${rec ? ` #${rec.id} (${rec.datetime})` : ''}` : out.action === 'stop' ? 'отписался от уведомлений' : `написал: «${ev.text}»`;
    try { await ctx.notifyAdmin(`${who} ${what}`); } catch (e) { db.log('warn', 'inbound', `notifyAdmin failed: ${e.message}`); }
  }
  return out;
}

function recordToUpsert(r) {
  return { id: r.id, companyId: r.company_id, clientPhone: r.client_phone, clientName: r.client_name, clientId: r.client_id, staffId: r.staff_id, staffName: r.staff_name, services: r.services,
    datetime: r.datetime, startTs: r.start_ts, endTs: r.end_ts, lengthSec: r.length_sec, attendance: r.attendance, confirmed: Boolean(r.confirmed), deleted: Boolean(r.deleted), online: Boolean(r.online),
    comment: r.comment, reviewLink: r.review_link, shortLink: r.short_link, createDate: r.create_date, lastChange: r.last_change, raw: r.raw };
}

/** Telegram-specific glue: contact sharing and /start. Returns reply text (and keyboard) or null. */
export async function handleTelegramUpdate(ctx, tg, update) {
  const { db } = ctx;
  const ev = tg.constructor.parseUpdate(update);
  if (!ev) return null;
  if (ev.kind === 'contact') {
    if (ev.contactUserId && ev.from?.id && ev.contactUserId !== ev.from.id) { await tg.sendText(ev.chatId, 'Пожалуйста, поделитесь своим номером через кнопку ниже.', { reply_markup: tg.contactKeyboard() }); return 'foreign_contact'; }
    const phone = normalizePhone(ev.phone);
    if (!phone) { await tg.sendText(ev.chatId, 'Не удалось распознать номер.'); return 'bad_phone'; }
    db.upsertContact({ phone, telegramChatId: ev.chatId, telegramUsername: ev.from?.username ?? null, name: null, unsubscribed: false });
    db.insertInbound({ channel: 'telegram', phone, chatId: ev.chatId, text: 'contact', action: 'link' });
    await tg.sendText(ev.chatId, ctx.settings?.replies?.linked || 'Спасибо! Номер привязан — напоминания о записях будут приходить сюда.', { reply_markup: { remove_keyboard: true } });
    return 'linked';
  }
  if (ev.kind === 'text' && /^\/start/.test(ev.text || '')) {
    const known = db.getContactByTelegram(ev.chatId);
    if (known) { await tg.sendText(ev.chatId, 'Вы уже подключены. Напоминания о записях будут приходить сюда.'); return 'start_known'; }
    await tg.sendText(ev.chatId, ctx.settings?.replies?.start || 'Здравствуйте! Чтобы получать напоминания о записях, поделитесь номером телефона кнопкой ниже.', { reply_markup: tg.contactKeyboard() });
    return 'start';
  }
  if (ev.kind === 'callback') {
    const res = await handleInbound(ctx, { channel: 'telegram', chatId: ev.chatId, text: ev.text, action: ev.action, recordId: ev.recordId, payload: update });
    try { await tg.call('answerCallbackQuery', { callback_query_id: ev.callbackId }); } catch { /* ignore */ }
    if (res.reply) await tg.sendText(ev.chatId, res.reply);
    return res.action;
  }
  const known = db.getContactByTelegram(ev.chatId);
  if (!known) { await tg.sendText(ev.chatId, 'Чтобы мы вас узнали, поделитесь номером телефона.', { reply_markup: tg.contactKeyboard() }); return 'unknown'; }
  const res = await handleInbound(ctx, { channel: 'telegram', chatId: ev.chatId, phone: known.phone, text: ev.text, payload: update });
  if (res.reply) await tg.sendText(ev.chatId, res.reply);
  return res.action;
}
