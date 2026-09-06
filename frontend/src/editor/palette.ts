/**
 * Палитра холста.
 *
 * Единственный источник правды по цвету — CSS-переменные в styles.css. Холст
 * рисуется на canvas, где переменные сами по себе не работают, поэтому их
 * читают отсюда один раз и кешируют. Смысл в том, что тема задаётся в одном
 * файле: раньше два десятка цветов были литералами в render.ts, и смена темы
 * превращалась в охоту за ними по коду.
 */

const cache = new Map<string, string>()

/** Значение CSS-переменной с запасным цветом, если её не оказалось. */
export function themeColor(name: string, fallback: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  let value = fallback
  if (typeof document !== 'undefined') {
    const read = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (read) value = read
  }
  cache.set(name, value)
  return value
}

/** Сбросить кеш — после смены темы. */
export function refreshTheme(): void {
  cache.clear()
}

/** Цвет с заданной прозрачностью. Принимает #rgb, #rrggbb и rgb()/rgba(). */
export function alpha(color: string, value: number): string {
  const rgb = toRgb(color)
  if (!rgb) return color
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${value})`
}

/** Смешать цвет с другим: 0 — первый, 1 — второй. */
export function mix(from: string, to: string, ratio: number): string {
  const a = toRgb(from)
  const b = toRgb(to)
  if (!a || !b) return from
  const at = Math.max(0, Math.min(1, ratio))
  const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * at)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

/** Осветлить к белому (>0) или затемнить к чёрному (<0). */
export function shade(color: string, amount: number): string {
  return amount >= 0 ? mix(color, '#ffffff', amount) : mix(color, '#000000', -amount)
}

/** Относительная яркость по WCAG — по ней выбирают цвет подписи поверх заливки. */
export function luminance(color: string): number {
  const rgb = toRgb(color)
  if (!rgb) return 0
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

function toRgb(color: string): [number, number, number] | null {
  const value = color.trim()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    if (full.length < 6) return null
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const parts = value.match(/-?\d+(\.\d+)?/g)
  if (!parts || parts.length < 3) return null
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])]
}

/**
 * Цвет типа операции.
 *
 * Тип распознаётся по геометрии вектора (OUTER, INNER, POCKET, GROOVE, DRILL,
 * MARK), и именно тип — то, что оператор читает на карте: «это паз», «это
 * присадка». Поэтому цвет закреплён за типом и живёт в теме: он обязан быть
 * различим на том фоне, который тема задаёт. Цвет из пресета траектории цвет
 * типа не подменяет — иначе два пресета одного типа выглядели бы разной
 * операцией.
 */
const OPERATION_FALLBACK: Record<string, string> = {
  OUTER: '#111827',
  INNER: '#374151',
  POCKET: '#0891b2',
  GROOVE: '#7c3aed',
  DRILL: '#b91c1c',
  MARK: '#65a30d',
}

export function operationColor(semantic: string): string {
  const key = semantic.toUpperCase()
  const fallback = OPERATION_FALLBACK[key] ?? '#6b7280'
  return themeColor(`--op-${key.toLowerCase()}`, fallback)
}

/**
 * Начертание линии по типу операции.
 *
 * Цвета операций в CAM никем не стандартизованы: в ArtCAM, Aspire и Fusion они
 * разные и настраиваются, так что «отраслевого» цвета, который оператор узнаёт
 * не задумываясь, просто нет. Значит, цвет придётся выучить по легенде — и
 * значит, он не должен быть ЕДИНСТВЕННЫМ различием: на дешёвом мониторе, при
 * солнце в окно и при дальтонизме он подводит первым.
 *
 * Поэтому к цвету добавлено начертание, и правило одно на всю карту:
 *
 *     сплошная — режется НАСКВОЗЬ
 *     штриховая — снимается НА ГЛУБИНУ
 *     кружок — отверстие
 *
 * Толщина третий канал: контур детали — то, по чему её отделяют от листа, —
 * самая жирная линия; разметка — самая тонкая.
 */
export interface VectorStyle {
  color: string
  /** Толщина в экранных пикселях: она не должна зависеть от зума. */
  width: number
  /** Штрих в экранных пикселях; пустой массив — сплошная. */
  dash: number[]
}

const VECTOR_STYLES: Record<string, Omit<VectorStyle, 'color'>> = {
  OUTER: { width: 1.6, dash: [] },
  INNER: { width: 1.4, dash: [] },
  POCKET: { width: 1.3, dash: [7, 3] },
  GROOVE: { width: 1.3, dash: [4, 3] },
  DRILL: { width: 1.3, dash: [] },
  MARK: { width: 1, dash: [1, 3] },
}

export function vectorStyle(semantic: string): VectorStyle {
  const key = semantic.toUpperCase()
  const shape = VECTOR_STYLES[key] ?? { width: 1.3, dash: [2, 2] }
  return { color: operationColor(key), ...shape }
}
