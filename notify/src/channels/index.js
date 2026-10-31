// Channel registry. A channel implements:
//   name, async send(message, contact) → { externalId?, status: 'sent'|'delivered', meta? } — throws ChannelError on failure
//   hasDeliveryReceipts: boolean — if false, 'sent' is treated as final success (no cascade timeout)
//   optional canReach(contact) → boolean — e.g. Telegram needs a known chat id
import { TelegramChannel } from './telegram.js';
import { WhatsAppChannel } from './whatsapp.js';
import { SmsChannel } from './sms.js';
import { LogChannel } from './log.js';

export class ChannelError extends Error {
  constructor(message, { code = 'send_failed', permanent = true, cause } = {}) { super(message); this.name = 'ChannelError'; this.code = code; this.permanent = permanent; this.cause = cause; }
}

export const CHANNEL_INFO = {
  telegram: { title: 'Telegram-бот', hint: 'Клиент должен один раз написать боту и поделиться номером; после этого сообщения приходят в Telegram.' },
  whatsapp: { title: 'WhatsApp (Cloud API)', hint: 'Официальный API Meta: вне 24-часового окна диалога нужны утверждённые шаблоны.' },
  sms: { title: 'SMS', hint: 'HTTP-шлюз: smsc.ru, sms.ru или произвольный URL.' },
  log: { title: 'Лог (тест)', hint: 'Ничего не отправляет, пишет в журнал. Для отладки.' },
};

export function buildChannels(settings, deps) {
  const list = {};
  const cfg = settings || {};
  if (cfg.telegram?.enabled && cfg.telegram.botToken) list.telegram = new TelegramChannel(cfg.telegram, deps);
  if (cfg.whatsapp?.enabled && cfg.whatsapp.accessToken && cfg.whatsapp.phoneNumberId) list.whatsapp = new WhatsAppChannel(cfg.whatsapp, deps);
  if (cfg.sms?.enabled) list.sms = new SmsChannel(cfg.sms, deps);
  if (cfg.log?.enabled !== false) list.log = new LogChannel(cfg.log || {}, deps);
  return list;
}
