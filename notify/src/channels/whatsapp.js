// WhatsApp Business Cloud API (Meta Graph API). Sends free-form text inside the 24h customer-service
// window; outside it a pre-approved template is required (cfg.templateName + language). Delivery
// statuses (sent/delivered/read/failed) and inbound messages arrive via webhook (POST /webhooks/whatsapp).
import { ChannelError } from './index.js';

export class WhatsAppChannel {
  constructor(cfg, { db, fetchImpl = globalThis.fetch } = {}) {
    this.name = 'whatsapp'; this.cfg = cfg; this.db = db; this.fetch = fetchImpl;
    this.hasDeliveryReceipts = true;
    this.api = `https://graph.facebook.com/${cfg.apiVersion || 'v21.0'}/${cfg.phoneNumberId}/messages`;
  }

  canReach() { return true; }

  async send(message, contact) {
    const payload = this.buildPayload(message, contact);
    let res, data;
    try {
      res = await this.fetch(this.api, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.accessToken}` }, body: JSON.stringify(payload) });
      data = await res.json();
    } catch (e) { throw new ChannelError(`WhatsApp недоступен: ${e.message}`, { code: 'network', permanent: false, cause: e }); }
    if (!res.ok || data.error) {
      const err = data.error || {};
      const permanent = ![429, 500, 503].includes(res.status) && err.code !== 130429;
      throw new ChannelError(`WhatsApp: ${err.message || `HTTP ${res.status}`}${err.error_data?.details ? ` (${err.error_data.details})` : ''}`, { code: `wa_${err.code ?? res.status}`, permanent });
    }
    const id = data.messages?.[0]?.id;
    return { externalId: id, status: 'sent' };
  }

  buildPayload(message, contact) {
    const to = message.phone;
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
    const inWindow = this.isInWindow(contact);
    if (this.cfg.templateName && !inWindow) {
      // Template with the whole text as a single body parameter ({{1}}) — the common "generic notification" template.
      return { ...base, type: 'template', template: { name: this.cfg.templateName, language: { code: this.cfg.templateLang || 'ru' }, components: [{ type: 'body', parameters: [{ type: 'text', text: message.text }] }] } };
    }
    if (message.buttons?.length) {
      return { ...base, type: 'interactive', interactive: { type: 'button', body: { text: message.text }, action: { buttons: message.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: `${b.action}:${message.record_id ?? message.recordId ?? ''}:${message.id}`, title: b.text.slice(0, 20) } })) } } };
    }
    return { ...base, type: 'text', text: { preview_url: false, body: message.text } };
  }

  /** The 24h window is open if the client wrote to us within the last 24 hours (tracked in contacts.whatsapp_last_inbound via settings). */
  isInWindow(contact) {
    if (!contact?.phone || !this.db) return false;
    const last = this.db.getSetting(`wa.lastInbound.${contact.phone}`, 0);
    return Date.now() - Number(last) < 24 * 3600 * 1000;
  }

  /** Normalise webhook payload into events: [{ kind: 'status', externalId, status }, { kind: 'text'|'button', phone, text, action, recordId }] */
  static parseWebhook(body) {
    const events = [];
    for (const entry of body?.entry ?? []) for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      for (const s of v.statuses ?? []) events.push({ kind: 'status', externalId: s.id, status: s.status, phone: s.recipient_id, error: s.errors?.[0]?.title });
      for (const m of v.messages ?? []) {
        const phone = m.from;
        if (m.type === 'interactive' && m.interactive?.button_reply) {
          const [action, recordId, messageId] = String(m.interactive.button_reply.id).split(':');
          events.push({ kind: 'button', phone, text: m.interactive.button_reply.title, action, recordId: recordId ? Number(recordId) : null, messageId: messageId ? Number(messageId) : null, externalId: m.id });
        } else if (m.type === 'button') {
          events.push({ kind: 'text', phone, text: m.button?.text ?? '', externalId: m.id });
        } else {
          events.push({ kind: 'text', phone, text: m.text?.body ?? '', externalId: m.id });
        }
      }
    }
    return events;
  }
}
