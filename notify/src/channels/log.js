// Development channel: records the message in the DB log and reports it as delivered.
export class LogChannel {
  constructor(cfg = {}, { db, logger } = {}) { this.name = 'log'; this.cfg = cfg; this.db = db; this.logger = logger; this.hasDeliveryReceipts = false; this.sent = []; }
  canReach() { return true; }
  async send(message) {
    if (this.cfg.failPhones?.includes(message.phone)) { const { ChannelError } = await import('./index.js'); throw new ChannelError('log: имитация ошибки', { code: 'simulated' }); }
    const id = `log-${message.id}-${Date.now()}`;
    this.sent.push({ phone: message.phone, text: message.text, buttons: message.buttons });
    this.db?.log('info', 'channel:log', `→ ${message.phone}: ${message.text}`, { messageId: message.id, buttons: message.buttons });
    this.logger?.(`[log channel] → ${message.phone}: ${message.text}`);
    return { externalId: id, status: 'sent' };
  }
}
