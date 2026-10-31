// Telegram Bot API channel. Clients are addressed by chat id, so a contact must have shared their
// phone number with the bot first (we ask for it with a "request_contact" keyboard on /start).
// Updates arrive either via webhook (POST /webhooks/telegram) or long polling (getUpdates) when no PUBLIC_URL.
import { ChannelError } from './index.js';

export class TelegramChannel {
  constructor(cfg, { db, fetchImpl = globalThis.fetch } = {}) {
    this.name = 'telegram'; this.cfg = cfg; this.db = db; this.fetch = fetchImpl;
    this.hasDeliveryReceipts = false; // Bot API has no per-message delivery receipts
    this.api = `https://api.telegram.org/bot${cfg.botToken}`;
  }

  async call(method, body) {
    let res, data;
    try {
      res = await this.fetch(`${this.api}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      data = await res.json();
    } catch (e) { throw new ChannelError(`Telegram недоступен: ${e.message}`, { code: 'network', permanent: false, cause: e }); }
    if (!data.ok) {
      const permanent = ![429, 500, 502, 503, 504].includes(data.error_code);
      throw new ChannelError(`Telegram: ${data.description || 'ошибка'}`, { code: `tg_${data.error_code}`, permanent });
    }
    return data.result;
  }

  canReach(contact) { return Boolean(contact?.telegram_chat_id); }

  async send(message, contact) {
    if (!contact?.telegram_chat_id) throw new ChannelError('Клиент не подключил Telegram-бота', { code: 'no_chat' });
    const body = { chat_id: contact.telegram_chat_id, text: message.text, disable_web_page_preview: true };
    if (message.buttons?.length) {
      body.reply_markup = { inline_keyboard: [message.buttons.map((b) => ({ text: b.text, callback_data: JSON.stringify({ a: b.action, r: message.record_id ?? message.recordId ?? null, m: message.id }).slice(0, 64) }))] };
    }
    const r = await this.call('sendMessage', body);
    return { externalId: String(r.message_id), status: 'sent', meta: { chatId: contact.telegram_chat_id } };
  }

  async sendText(chatId, text, extra = {}) { return this.call('sendMessage', { chat_id: chatId, text, ...extra }); }

  async setWebhook(url, secret) { return this.call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }); }
  async deleteWebhook() { return this.call('deleteWebhook', {}); }
  async getMe() { return this.call('getMe', {}); }

  /** Long-polling loop; calls onUpdate for each update. Stops when `signal` aborts. */
  async poll(onUpdate, { signal, timeoutSec = 25 } = {}) {
    let offset = Number(this.db?.getSetting('telegram.offset', 0)) || 0;
    while (!signal?.aborted) {
      try {
        const updates = await this.call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await onUpdate(u); } catch (e) { this.db?.log('error', 'telegram', `update failed: ${e.message}`); }
        }
        this.db?.setSetting('telegram.offset', offset);
      } catch (e) {
        this.db?.log('warn', 'telegram', `getUpdates: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Parse an update into a normalised inbound event. */
  static parseUpdate(u) {
    if (u.callback_query) {
      const cq = u.callback_query; let data = null;
      try { data = JSON.parse(cq.data); } catch { data = { a: cq.data }; }
      return { kind: 'callback', chatId: String(cq.message?.chat?.id ?? cq.from?.id), from: cq.from, action: data?.a, recordId: data?.r ?? null, messageId: data?.m ?? null, callbackId: cq.id, text: cq.data };
    }
    const m = u.message;
    if (!m) return null;
    if (m.contact) return { kind: 'contact', chatId: String(m.chat.id), from: m.from, phone: m.contact.phone_number, contactUserId: m.contact.user_id, text: '' };
    return { kind: 'text', chatId: String(m.chat.id), from: m.from, text: m.text ?? '' };
  }

  contactKeyboard() {
    return { keyboard: [[{ text: '📱 Поделиться номером телефона', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  }
}
