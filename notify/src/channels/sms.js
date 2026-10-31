// SMS via HTTP gateway. Presets for smsc.ru and sms.ru; `custom` lets you template any GET/POST API:
//   { url: 'https://gw/send?to={phone}&text={text}&key=…', method: 'GET', successPattern: '"status":"OK"' }
import { ChannelError } from './index.js';

const PRESETS = {
  smsc: {
    build: (cfg, phone, text) => ({ url: 'https://smsc.ru/sys/send.php', method: 'POST', form: { login: cfg.login, psw: cfg.password, phones: phone, mes: text, sender: cfg.sender || undefined, fmt: 3, charset: 'utf-8' } }),
    parse: (data) => { if (data.error) throw new ChannelError(`smsc: ${data.error} (${data.error_code})`, { code: `smsc_${data.error_code}`, permanent: ![1, 2, 9].includes(Number(data.error_code)) }); return { externalId: String(data.id ?? ''), status: 'sent' }; },
  },
  smsru: {
    build: (cfg, phone, text) => ({ url: 'https://sms.ru/sms/send', method: 'POST', form: { api_id: cfg.password || cfg.apiId, to: phone, msg: text, from: cfg.sender || undefined, json: 1 } }),
    parse: (data, phone) => {
      const s = data.sms?.[phone];
      if (data.status !== 'OK' || !s || s.status !== 'OK') throw new ChannelError(`sms.ru: ${s?.status_text || data.status_text || data.status_code}`, { code: `smsru_${s?.status_code ?? data.status_code}` });
      return { externalId: String(s.sms_id ?? ''), status: 'sent' };
    },
  },
};

export class SmsChannel {
  constructor(cfg, { db, fetchImpl = globalThis.fetch } = {}) { this.name = 'sms'; this.cfg = cfg; this.db = db; this.fetch = fetchImpl; this.hasDeliveryReceipts = false; }
  canReach() { return true; }

  async send(message) {
    const provider = this.cfg.provider || 'smsc';
    const text = this.cfg.transliterate ? translit(message.text) : message.text;
    let req, parse;
    if (provider === 'custom') {
      if (!this.cfg.url) throw new ChannelError('SMS: не задан URL шлюза', { code: 'config' });
      const sub = (s) => String(s).replace(/\{phone\}/g, encodeURIComponent(message.phone)).replace(/\{text\}/g, encodeURIComponent(text)).replace(/\{sender\}/g, encodeURIComponent(this.cfg.sender || ''));
      req = { url: sub(this.cfg.url), method: (this.cfg.method || 'GET').toUpperCase(), body: this.cfg.body ? sub(this.cfg.body) : undefined, headers: this.cfg.headers || {} };
      parse = (raw) => { if (this.cfg.successPattern && !new RegExp(this.cfg.successPattern).test(raw)) throw new ChannelError(`SMS-шлюз: ${raw.slice(0, 200)}`, { code: 'gateway' }); return { externalId: null, status: 'sent' }; };
    } else {
      const preset = PRESETS[provider];
      if (!preset) throw new ChannelError(`SMS: неизвестный провайдер ${provider}`, { code: 'config' });
      req = preset.build(this.cfg, message.phone, text);
      parse = (raw) => { let data; try { data = JSON.parse(raw); } catch { throw new ChannelError(`SMS-шлюз вернул не JSON: ${raw.slice(0, 200)}`, { code: 'gateway' }); } return preset.parse(data, message.phone); };
    }
    let res, raw;
    try {
      const init = { method: req.method, headers: { ...(req.headers || {}) } };
      if (req.form) { init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(Object.fromEntries(Object.entries(req.form).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString(); }
      else if (req.body !== undefined && req.method !== 'GET') { init.headers['Content-Type'] ??= 'application/x-www-form-urlencoded'; init.body = req.body; }
      res = await this.fetch(req.url, init);
      raw = await res.text();
    } catch (e) { throw new ChannelError(`SMS-шлюз недоступен: ${e.message}`, { code: 'network', permanent: false, cause: e }); }
    if (!res.ok) throw new ChannelError(`SMS-шлюз: HTTP ${res.status} ${raw.slice(0, 200)}`, { code: `http_${res.status}`, permanent: res.status < 500 });
    return parse(raw);
  }
}

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
export function translit(s) {
  return String(s).replace(/[а-яё]/gi, (c) => { const l = c.toLowerCase(); const t = TR[l] ?? c; return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1); });
}
