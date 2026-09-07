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
  OUTER: '#101418',
  INNER: '#3f4a57',
  POCKET: '#0f6c8c',
  GROOVE: '#6425c4',
  /* Присадка была красной, и красный на карте значил сразу две вещи: «здесь
     отверстие» и «здесь наложение деталей». Тревога должна быть одна на всю
     карту, поэтому присадке отдан малиновый: он далеко и от красного, и от
     фиолетового паза. */
  DRILL: '#a01a5f',
  MARK: '#46700d',
  /* Тип не распознан или траектория не назначена: это не «серое ничто», а
     решение, которое технолог ещё не принял. */
  NONE: '#7a4e00',
}

export function operationColor(semantic: string): string {
  const key = semantic.toUpperCase()
  const fallback = OPERATION_FALLBACK[key] ?? OPERATION_FALLBACK.NONE
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
  OUTER: { width: 1.8, dash: [] },
  INNER: { width: 1.5, dash: [] },
  POCKET: { width: 1.5, dash: [7, 3] },
  GROOVE: { width: 1.5, dash: [4, 3] },
  DRILL: { width: 1.4, dash: [] },
  MARK: { width: 1.2, dash: [1, 3] },
}

export function vectorStyle(semantic: string): VectorStyle {
  const key = semantic.toUpperCase()
  const shape = VECTOR_STYLES[key] ?? { width: 1.4, dash: [2, 2] }
  return { color: operationColor(key), ...shape }
}

/**
 * Цвета детали по файлу: бледная заливка и плотная обводка.
 *
 * Сервер раздаёт файлам палитру Окабэ–Ито — она различима при дальтонизме за
 * счёт РАЗНОЙ светлоты, а не только тона. Но светлота базовых цветов гуляет
 * широко, и на светлом листе это давало разный визуальный вес при равной
 * смысловой важности: фиолетовые и терракотовые детали лезли вперёд, а
 * оранжевые и голубые почти сливались с листом. Именно так и получается каша.
 *
 * Заливки сжаты в узкую полосу светлоты, а цветность ограничена сверху:
 * порядок светлот сохраняется как второй канал различия, но разброс веса
 * уходит. Выравнивать светлоту в одну точку нельзя — тогда сине-фиолетовый,
 * синий и голубой при дейтеранопии становятся одним цветом.
 *
 * Обводка — тот же тон, но тёмный: каждая деталь читается как объект даже
 * без фона, и она же рисует штриховку листа.
 */
const FILE_TONES: Record<string, { fill: string; edge: string }> = {
  '#7D82C5': { fill: '#D6D6FF', edge: '#575F9E' },
  '#23AC74': { fill: '#B5E9CC', edge: '#007A4E' },
  '#9D3725': { fill: '#F9C0B2', edge: '#932E1E' },
  '#861CB4': { fill: '#E0C2EA', edge: '#71368B' },
  '#0072B2': { fill: '#B4D5FF', edge: '#005E93' },
  '#E69F00': { fill: '#FDDEB6', edge: '#996906' },
  '#CC79A7': { fill: '#FFCFE8', edge: '#9C4D7B' },
  '#56B4E9': { fill: '#C5E6FF', edge: '#0079A7' },
  '#D55E00': { fill: '#FECEB3', edge: '#9C4A13' },
  '#3B7C70': { fill: '#9DE0D2', edge: '#22655A' },
  '#7A8C00': { fill: '#DFE6B4', edge: '#5C6A00' },
  '#1A6E9E': { fill: '#BFDCEF', edge: '#155B82' },
}

/**
 * Сдвиг оттенка по номеру листа ВНУТРИ файла.
 *
 * Файл на три листа даёт три оттенка одного цвета — вместе со штриховкой это
 * отвечает на вопрос «с какого листа исходника приехала деталь». Шаги мелкие:
 * заливки специально сведены в узкую полосу светлоты, и крупный сдвиг вывел
 * бы их обратно в разнобой. Основную работу делает штриховка.
 */
const SHEET_SHADE_STEPS = [0, -0.07, 0.07, -0.13, 0.12, -0.19, 0.17, -0.24]

export function fileColors(
  base: string,
  sheetIndex = 0,
): { fill: string; edge: string } {
  const key = base.toUpperCase()
  const tone =
    FILE_TONES[key] ??
    // Цвет не из палитры — технолог задал свой. Приводим к той же логике:
    // бледная заливка примешиванием к листу, тёмная обводка затемнением.
    {
      fill: mix(base, themeColor('--sheet-fill', '#f8f9f7'), 0.74),
      edge: shade(base, -0.3),
    }
  const step = SHEET_SHADE_STEPS[sheetIndex % SHEET_SHADE_STEPS.length]
  if (step === 0) return tone
  return { fill: shade(tone.fill, step), edge: tone.edge }
}
