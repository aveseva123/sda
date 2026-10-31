// Phone normalisation. Everything is stored as digits in international format without "+",
// e.g. "79161234567" — the same format YCLIENTS uses in record.client.phone.

export function normalizePhone(raw) {
  if (raw == null) return null;
  let d = String(raw).replace(/\D+/g, '');
  if (!d) return null;
  if (d.length === 10 && /^9/.test(d)) d = '7' + d; // 9161234567 → 79161234567
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1); // 8916... → 7916...
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

export function formatPhone(digits) {
  const d = normalizePhone(digits);
  if (!d) return '';
  if (d.length === 11 && d.startsWith('7')) {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  return '+' + d;
}

export function maskPhone(digits) {
  const d = normalizePhone(digits);
  if (!d) return '';
  return '+' + d.slice(0, d.length - 7) + '***' + d.slice(-4);
}
