// Cascade delivery: a message carries an ordered list of channels. We try the first reachable channel;
// if sending fails permanently, or the channel supports delivery receipts and none arrives within
// `fallbackSec`, the next channel is tried. Temporary errors are retried a few times.

const MAX_TEMP_RETRIES = 3;

export async function processMessage(db, message, channels, { now = Date.now(), fallbackSec = 600, maxTempRetries = MAX_TEMP_RETRIES } = {}) {
  let msg = message;
  const contact = db.getContact(msg.phone) || { phone: msg.phone };
  if (msg.status === 'sent') {
    // delivery receipt timeout → fall back to next channel
    const last = db.attemptsForMessage(msg.id).filter((a) => a.channel === msg.current_channel).pop();
    if (last) db.updateAttempt(last.id, { status: 'timeout', error: 'нет подтверждения доставки' });
    msg = db.updateMessage(msg.id, { status: 'queued', channelIndex: msg.channel_index + 1, fallbackAt: null, error: `${msg.current_channel}: нет подтверждения доставки` });
  }
  for (;;) {
    const name = msg.channels[msg.channel_index];
    if (!name) return db.updateMessage(msg.id, { status: 'failed', error: msg.error || 'ни один канал не доставил сообщение', fallbackAt: null });
    const ch = channels[name];
    if (!ch) { db.insertAttempt({ messageId: msg.id, channel: name, status: 'skipped', error: 'канал не настроен' }); msg = db.updateMessage(msg.id, { channelIndex: msg.channel_index + 1 }); continue; }
    if (ch.canReach && !ch.canReach(contact)) { db.insertAttempt({ messageId: msg.id, channel: name, status: 'skipped', error: 'клиент недоступен в этом канале' }); msg = db.updateMessage(msg.id, { channelIndex: msg.channel_index + 1 }); continue; }
    const attemptId = db.insertAttempt({ messageId: msg.id, channel: name, status: 'sending' });
    try {
      const r = await ch.send(msg, contact);
      db.updateAttempt(attemptId, { status: r.status || 'sent', externalId: r.externalId ?? null });
      const meta = { ...(msg.meta || {}), retries: 0, ...(r.meta || {}) };
      const withReceipts = Boolean(ch.hasDeliveryReceipts);
      return db.updateMessage(msg.id, { status: 'sent', currentChannel: name, externalId: r.externalId ?? null, fallbackAt: withReceipts ? now + fallbackSec * 1000 : null, error: null, meta });
    } catch (e) {
      const permanent = e.permanent !== false;
      db.updateAttempt(attemptId, { status: 'failed', error: e.message });
      db.log('warn', 'cascade', `message ${msg.id} via ${name} failed: ${e.message}`, { permanent });
      const retries = Number(msg.meta?.retries || 0);
      if (!permanent && retries < maxTempRetries) {
        return db.updateMessage(msg.id, { status: 'queued', fallbackAt: now + 60e3 * (retries + 1), error: e.message, meta: { ...(msg.meta || {}), retries: retries + 1 } });
      }
      msg = db.updateMessage(msg.id, { channelIndex: msg.channel_index + 1, error: `${name}: ${e.message}`, meta: { ...(msg.meta || {}), retries: 0 } });
    }
  }
}

/** Handle a delivery status callback from a channel (WhatsApp etc.). */
export function applyDeliveryStatus(db, channel, externalId, status, { error } = {}) {
  const msg = db.getMessageByExternalId(channel, externalId);
  if (!msg) return null;
  const attempt = db.attemptsForMessage(msg.id).filter((a) => a.channel === channel && a.external_id === String(externalId)).pop();
  const s = String(status).toLowerCase();
  if (['delivered', 'read'].includes(s)) {
    if (attempt) db.updateAttempt(attempt.id, { status: s });
    if (msg.status === 'read' && s === 'delivered') return msg; // out of order
    return db.updateMessage(msg.id, { status: s, fallbackAt: null });
  }
  if (['failed', 'undelivered', 'undeliverable'].includes(s)) {
    if (attempt) db.updateAttempt(attempt.id, { status: 'failed', error: error || s });
    if (msg.status === 'sent' && msg.current_channel === channel) {
      return db.updateMessage(msg.id, { status: 'queued', channelIndex: msg.channel_index + 1, fallbackAt: null, error: `${channel}: ${error || s}` });
    }
    return msg;
  }
  if (s === 'sent' && attempt) db.updateAttempt(attempt.id, { status: 'sent' });
  return msg;
}

/** Process everything that is due: queued messages and sent messages with an expired fallback timer. */
export async function processQueue(db, channels, opts = {}) {
  const now = opts.now ?? Date.now();
  const list = db.messagesToProcess(now, opts.limit ?? 50);
  const results = [];
  for (const m of list) results.push(await processMessage(db, m, channels, { ...opts, now }));
  return results;
}
