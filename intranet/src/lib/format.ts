// Форматирование чисел. Пробел — неразрывный тонкий, чтобы суммы не рвались на переносе
const NBSP = ' '

const groups = (n: number): string => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)

/** $153 000 */
export function usd(n: number): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${groups(n)}`
}

/** $153k, $1,2M — для плиток */
export function usdShort(n: number): string {
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')}M`
  if (a >= 1000) return `${sign}$${Math.round(a / 1000)}k`
  return `${sign}$${Math.round(a)}`
}

/** $97–153k */
export function usdRangeShort(min: number, max: number): string {
  if (Math.round(min / 1000) === Math.round(max / 1000)) return usdShort(min)
  const a = Math.round(min / 1000)
  const b = Math.round(max / 1000)
  return `$${a}–${b}k`
}

/** $97 000 – $153 000 */
export function usdRange(min: number, max: number): string {
  if (Math.round(min) === Math.round(max)) return usd(min)
  return `${usd(min)}${NBSP}–${NBSP}${usd(max)}`
}

/** 153 млн драм */
export function amd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `${(a / 1_000_000_000).toFixed(2).replace('.', ',')} млрд драм`
  if (a >= 1_000_000) return `${Math.round(a / 1_000_000)} млн драм`
  return `${groups(a)} драм`
}

export function num(n: number, digits = 0): string {
  return n.toFixed(digits).replace('.', ',')
}

export function months(n: number | null, fallback = '—'): string {
  if (n === null) return fallback
  return `${n} мес`
}
