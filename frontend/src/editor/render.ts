import {
  type PlacedPart,
  type Point,
  placeInstance,
  rotatedSize,
  sheetOrigin,
} from './geometry'
import { alpha, operationColor, themeColor } from './palette'
import type { Collision, Layout, Selection, ToolpathPreset } from './types'
import { vectorKey } from './types'

export interface Viewport {
  /** Мировая точка в центре экрана, мм. */
  cx: number
  cy: number
  /** Пикселей на миллиметр. */
  scale: number
}

export interface RenderInput {
  layout: Layout
  viewport: Viewport
  width: number
  height: number
  selection: Selection
  /** Деталь, внутрь которой вошли для работы с векторами. */
  focusedPartId: number | null
  hoveredInstance: number | null
  collisions: Collision[]
  presets: Map<number, ToolpathPreset>
  /**
   * Режим просмотра, как «Каркас» в CorelDRAW.
   *
   * 'solid'   — деталь залита цветом своего файла: с одного взгляда видно,
   *             чьё и насколько плотно уложено.
   * 'outline' — только линии: на плотной раскладке заливки соседних деталей
   *             сливаются, и разобрать геометрию, вырезы и наложения можно
   *             только по контурам.
   */
  view: 'solid' | 'outline'
  showToolpaths: boolean
  guides: Array<{ axis: 'x' | 'y'; value: number; sheetIndex: number }>
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
}

/**
 * Палитра холста берётся из CSS-переменных: тема живёт в styles.css целиком,
 * включая рабочее поле. Раньше здесь стояли литералы, и смена темы означала
 * охоту за цветами по всему файлу.
 *
 * Значения читаются на каждый кадр из кеша palette.ts — это одно обращение к
 * Map, а не к getComputedStyle.
 */
const ink = (name: string, fallback: string) => themeColor(name, fallback)

const CANVAS_BG = () => ink('--canvas-bg', '#0A0C0F')
const GRID_DOT = () => ink('--canvas-grid', '#1A1F26')
const SHEET_FILL = () => ink('--sheet-fill', '#0D1013')
const SHEET_STROKE = () => ink('--sheet-edge', '#2E353E')
const TRIM_STROKE = () => ink('--sheet-trim', '#333A44')
const REST_FILL = () => ink('--rest-fill', '#232A32')
const LABEL_INK = () => ink('--canvas-ink', '#F2F4F6')
const DIM_INK = () => ink('--canvas-ink-2', '#AEB6C0')
const FAINT_INK = () => ink('--canvas-ink-3', '#69717D')
const SELECT = () => ink('--canvas-select', '#FFFFFF')
const DANGER = () => ink('--canvas-danger', '#D9694A')
const PART_EDGE = () => ink('--part-edge', 'rgba(226,231,238,0.62)')
const LABEL_PLATE = () => ink('--canvas-plate', 'rgba(10,12,15,0.72)')
const GUIDE = () => ink('--canvas-guide', '#e11d48')
const GRAIN_INK = () => ink('--canvas-grain', 'rgba(142,151,162,0.75)')

/** Заливка детали: цвет файла с прозрачностью — контур остаётся главным. */
function tint(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const patternCache = new Map<string, CanvasPattern | null>()

/**
 * Заливка детали: цвет закреплён за файлом, штриховка — за листом внутри
 * файла. На тёмном холсте заливка полупрозрачная, штрих — тот же цвет, но
 * плотнее: принадлежность читается и цветом, и рисунком.
 */
function hatch(
  ctx: CanvasRenderingContext2D,
  fill: string,
  pattern: string,
): CanvasPattern | string {
  if (pattern === 'solid') return tint(fill, 0.30)
  const key = `${pattern}|${fill}`
  const cached = patternCache.get(key)
  if (cached !== undefined) return cached ?? tint(fill, 0.30)

  const size = 10
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const tctx = tile.getContext('2d')
  if (!tctx) {
    patternCache.set(key, null)
    return tint(fill, 0.30)
  }
  tctx.fillStyle = tint(fill, 0.22)
  tctx.fillRect(0, 0, size, size)
  tctx.strokeStyle = tint(fill, 0.44)
  tctx.fillStyle = tint(fill, 0.44)
  tctx.lineWidth = 1.1
  tctx.beginPath()
  switch (pattern) {
    case 'diagonal':
      tctx.moveTo(0, size)
      tctx.lineTo(size, 0)
      break
    case 'diagonal-back':
      tctx.moveTo(0, 0)
      tctx.lineTo(size, size)
      break
    case 'cross':
      tctx.moveTo(0, size)
      tctx.lineTo(size, 0)
      tctx.moveTo(0, 0)
      tctx.lineTo(size, size)
      break
    case 'horizontal':
      tctx.moveTo(0, size / 2)
      tctx.lineTo(size, size / 2)
      break
    case 'vertical':
      tctx.moveTo(size / 2, 0)
      tctx.lineTo(size / 2, size)
      break
    case 'grid':
      tctx.moveTo(0, size / 2)
      tctx.lineTo(size, size / 2)
      tctx.moveTo(size / 2, 0)
      tctx.lineTo(size / 2, size)
      break
    case 'dots':
      tctx.arc(size / 2, size / 2, 1.8, 0, Math.PI * 2)
      tctx.fill()
      break
    default:
      break
  }
  tctx.stroke()
  const made = ctx.createPattern(tile, 'repeat')
  patternCache.set(key, made)
  return made ?? tint(fill, 0.30)
}

/**
 * Прямоугольник по пиксельной сетке.
 *
 * Canvas рисует линию по центру координаты: линия толщиной 1 при целой
 * координате ложится на границу двух пикселей и размывается в две серые
 * полосы вместо одной чёткой. Классическое лекарство — сдвиг на полпикселя.
 * Применимо только к прямоугольникам по осям: рамка листа, полоса обрезки,
 * остаток, плашка подписи, рамка выделения. Контур детали — произвольная
 * ломаная, её округлять нельзя, это исказило бы геометрию.
 */
function crispRect(
  x: number,
  y: number,
  w: number,
  h: number,
  lineWidth: number,
): [number, number, number, number] {
  const shift = (lineWidth % 2) / 2
  const x0 = Math.round(x) + shift
  const y0 = Math.round(y) + shift
  return [x0, y0, Math.round(x + w) + shift - x0, Math.round(y + h) + shift - y0]
}

export function worldToScreen(v: Viewport, width: number, height: number, p: Point): Point {
  return [width / 2 + (p[0] - v.cx) * v.scale, height / 2 - (p[1] - v.cy) * v.scale]
}

export function screenToWorld(
  v: Viewport,
  width: number,
  height: number,
  p: Point,
): Point {
  return [v.cx + (p[0] - width / 2) / v.scale, v.cy - (p[1] - height / 2) / v.scale]
}

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { layout, viewport, width, height, selection, collisions } = input
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = CANVAS_BG()
  ctx.fillRect(0, 0, width, height)

  const toScreen = (p: Point) => worldToScreen(viewport, width, height, p)
  const selectedInstances = new Set(selection.instances)
  const selectedVectors = new Set(selection.vectors)
  const collidingInstances = new Set(collisions.flatMap((c) => c.instance_ids))

  drawGrid(ctx, input, toScreen)

  // Листы.
  for (const sheet of layout.sheets) {
    const [ox, oy] = sheetOrigin(layout.sheets, sheet.index)
    const topLeft = toScreen([ox, oy + sheet.h])
    const w = sheet.w * viewport.scale
    const h = sheet.h * viewport.scale

    const sheetBox = crispRect(topLeft[0], topLeft[1], w, h, 1)
    ctx.fillStyle = SHEET_FILL()
    ctx.fillRect(...sheetBox)
    ctx.strokeStyle = SHEET_STROKE()
    ctx.lineWidth = 1
    ctx.strokeRect(...sheetBox)

    // Полезная область: то, что осталось после обрезки кромок листа.
    const inset = toScreen([ox + sheet.trim.left, oy + sheet.h - sheet.trim.top])
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = TRIM_STROKE()
    ctx.lineWidth = 1
    ctx.strokeRect(
      ...crispRect(
        inset[0],
        inset[1],
        (sheet.w - sheet.trim.left - sheet.trim.right) * viewport.scale,
        (sheet.h - sheet.trim.top - sheet.trim.bottom) * viewport.scale,
        1,
      ),
    )
    ctx.setLineDash([])

    // Подпись листа пишется только если помещается над ним: на общем виде
    // подписи соседних листов иначе наезжают друг на друга.
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'
    const title = `Лист ${sheet.index + 1} · ${sheet.w.toFixed(0)} × ${sheet.h.toFixed(0)}`
    const percent = sheet.utilization
      ? `${(sheet.utilization * 100).toFixed(1)} %`.replace('.', ',')
      : ''
    const titleWidth = ctx.measureText(title).width
    const fullWidth = titleWidth + (percent ? ctx.measureText(percent).width + 10 : 0)

    if (fullWidth <= w) {
      ctx.fillStyle = DIM_INK()
      ctx.fillText(title, topLeft[0], topLeft[1] - 8)
      if (percent) {
        ctx.fillStyle = FAINT_INK()
        ctx.fillText(percent, topLeft[0] + titleWidth + 10, topLeft[1] - 8)
      }
    } else if (percent && ctx.measureText(percent).width <= w) {
      ctx.fillStyle = FAINT_INK()
      ctx.fillText(percent, topLeft[0], topLeft[1] - 8)
    }
  }

  drawRest(ctx, input, toScreen)

  // Детали. Подписи собираются на второй проход: иначе траектории соседней
  // детали ложатся поверх её названия и раскладку невозможно прочитать.
  const labelScale = viewport.scale > 0.06
  const labels: Array<{
    part: RenderInput['layout']['parts'][string]
    instance: RenderInput['layout']['instances'][number]
    placed: PlacedPart
  }> = []
  // Копий одной детали на листе бывает несколько, и подписать их одинаково —
  // значит заставить оператора пересчитывать вручную.
  const copies = new Map<number, number>()
  for (const instance of layout.instances) {
    copies.set(instance.part_id, (copies.get(instance.part_id) ?? 0) + 1)
  }
  for (const instance of layout.instances) {
    const part = layout.parts[String(instance.part_id)]
    if (!part) continue
    const placed = placeInstance(part, instance, layout.sheets)
    if (!placed) continue

    const isSelected = selectedInstances.has(instance.id)
    const isFocused = input.focusedPartId === part.id
    const isColliding = collidingInstances.has(instance.id)
    const style = part.style

    const outline = input.view === 'outline'

    if (!outline) {
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.fillStyle = style
        ? hatch(ctx, style.fill, style.pattern)
        : alpha(PART_EDGE(), 0.2)
      ctx.fill()

      // Вырезы «прорезают» деталь до листа.
      for (const ring of placed.inners) {
        tracePath(ctx, ring, toScreen, true)
        ctx.fillStyle = SHEET_FILL()
        ctx.fill()
        ctx.strokeStyle = operationColor('INNER')
        ctx.lineWidth = 1
        ctx.stroke()
      }
    } else {
      // В каркасе вырез — такая же линия, как всё остальное: заливать его
      // цветом листа незачем, под ним ничего не прячется.
      for (const ring of placed.inners) {
        tracePath(ctx, ring, toScreen, true)
        ctx.strokeStyle = operationColor('INNER')
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
    }

    // В заливке контур нейтральный: сотня цветных обводок сливается в сетку,
    // а принадлежность уже несёт заливка. В каркасе заливки нет, и цвет файла
    // остаётся единственным способом понять, чья это деталь.
    tracePath(ctx, placed.outer, toScreen, true)
    ctx.strokeStyle = isColliding
      ? DANGER()
      : outline
        ? style?.fill ?? PART_EDGE()
        : PART_EDGE()
    ctx.lineWidth = isColliding ? 2.5 : outline ? 1.4 : 1.2
    ctx.stroke()

    if (isColliding) {
      ctx.fillStyle = alpha(DANGER(), 0.18)
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.fill()
    }

    // Выделение — белая рамка с угловыми маркерами, как в векторном редакторе.
    if (isSelected) drawSelection(ctx, placed, toScreen)

    drawOperations(ctx, input, part, placed, toScreen, selectedVectors, isFocused)

    if (input.hoveredInstance === instance.id && !isSelected) {
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.strokeStyle = alpha(SELECT(), 0.5)
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (instance.pinned) drawPin(ctx, placed, toScreen)
    if (labelScale) labels.push({ part, instance, placed })
    if (labelScale && part.grain !== 'none') {
      drawGrainArrow(ctx, placed, toScreen, instance.rotation ?? 0)
    }
    void rotatedSize
  }

  for (const label of labels) {
    drawLabel(
      ctx,
      label.part,
      label.instance,
      label.placed,
      toScreen,
      viewport.scale,
      (copies.get(label.instance.part_id) ?? 1) > 1,
    )
  }

  drawGuides(ctx, input, toScreen)
  drawMarquee(ctx, input)
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  toScreen: (p: Point) => Point,
  close: boolean,
): void {
  ctx.beginPath()
  points.forEach((p, index) => {
    const s = toScreen(p)
    if (index === 0) ctx.moveTo(s[0], s[1])
    else ctx.lineTo(s[0], s[1])
  })
  if (close) ctx.closePath()
}

function drawOperations(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  part: RenderInput['layout']['parts'][string],
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
  selectedVectors: Set<string>,
  isFocused: boolean,
): void {
  const byTarget = new Map(part.vectors.map((v) => [v.target, v]))

  // На общем виде пазы и присадка рисуются той же толщиной, что и вблизи, и
  // лист превращается в штриховку. Издалека они приглушены до фактуры, при
  // приближении набирают полную яркость.
  const zoomInk = Math.min(1, Math.max(0.4, input.viewport.scale / 0.35))
  ctx.save()
  ctx.globalAlpha = zoomInk

  for (const op of placed.operations) {
    const vector = byTarget.get(op.target)
    const preset = vector?.preset_id ? input.presets.get(vector.preset_id) : undefined
    // Цвет — по ТИПУ операции, а не по пресету: оператор читает на карте
    // «это паз», «это присадка». Два пресета одного типа не должны выглядеть
    // разными операциями, а цвет из конфига не знает, на каком фоне рисуют.
    const color = operationColor(op.semantic)
    const selected = selectedVectors.has(vectorKey(part.id, op.target))
    const enabled = vector?.enabled !== false

    // Ширина фрезы: видно, что реально снимет инструмент.
    if (input.showToolpaths && preset?.tool_diameter && enabled) {
      ctx.strokeStyle = alpha(color, 0.25)
      ctx.lineWidth = Math.max(preset.tool_diameter * input.viewport.scale, 1)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (op.center && op.diameter) {
        const c = toScreen(op.center)
        ctx.beginPath()
        ctx.arc(c[0], c[1], Math.max((op.diameter / 2) * input.viewport.scale, 0.5), 0, Math.PI * 2)
        ctx.stroke()
      } else if (op.points?.length) {
        tracePath(ctx, op.points, toScreen, false)
        ctx.stroke()
      }
      ctx.lineCap = 'butt'
    }

    ctx.strokeStyle = enabled ? color : FAINT_INK()
    ctx.lineWidth = selected ? 3 : 1.3
    if (!enabled) ctx.setLineDash([4, 3])
    if (op.center && op.diameter) {
      const c = toScreen(op.center)
      ctx.beginPath()
      ctx.arc(c[0], c[1], Math.max((op.diameter / 2) * input.viewport.scale, 1.5), 0, Math.PI * 2)
      ctx.stroke()
    } else if (op.points?.length) {
      tracePath(ctx, op.points, toScreen, false)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  ctx.restore()

  // Контуры детали как выбираемые векторы — только внутри выбранной детали.
  if (!isFocused) return
  const outerSelected = selectedVectors.has(vectorKey(part.id, 'outer'))
  if (outerSelected) {
    tracePath(ctx, placed.outer, toScreen, true)
    ctx.strokeStyle = SELECT()
    ctx.lineWidth = 3.5
    ctx.stroke()
  }
  placed.inners.forEach((ring, index) => {
    if (!selectedVectors.has(vectorKey(part.id, `inner:${index}`))) return
    tracePath(ctx, ring, toScreen, true)
    ctx.strokeStyle = SELECT()
    ctx.lineWidth = 3.5
    ctx.stroke()
  })
}

/**
 * Маркировка детали для карты раскроя.
 *
 * Базис не даёт деталям имён, и парсер называет их по файлу: на листе тогда
 * стоит сотня одинаковых «bazis_16mm_two_sheets…». Общий префикс имени файла
 * снимается — остаётся то, чем детали различаются.
 */
export function partMarking(part: RenderInput['layout']['parts'][string]): string | null {
  const stem = (part.source_file ?? '').replace(/\.[^.]+$/, '')
  let name = (part.name ?? '').trim()
  if (stem && name.startsWith(stem)) name = name.slice(stem.length).trim()
  name = name.replace(/^[-–—_·]+\s*/, '').trim()
  const ordinal = name.match(/^\((\d+)\)$/)
  if (ordinal) return `№${ordinal[1]}`
  return name || null
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  part: RenderInput['layout']['parts'][string],
  instance: RenderInput['layout']['instances'][number],
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
  scale: number,
  numbered: boolean,
): void {
  const [minX, minY, maxX, maxY] = placed.bbox
  const center = toScreen([(minX + maxX) / 2, (minY + maxY) / 2])
  const boxW = (maxX - minX) * scale
  const boxH = (maxY - minY) * scale
  if (boxW < 40 || boxH < 18) return

  // Размер — то, по чему деталь опознают на листе руками, поэтому он главный;
  // маркировка идёт второй строкой, её переписывают на деталь маркером.
  // Размер берётся из габарита на листе, а не из «длина × ширина» детали:
  // у повёрнутой или вертикальной детали те стороны идут в другом порядке, и
  // подпись расходилась бы с тем, что человек видит перед собой.
  const dimensions = `${(maxX - minX).toFixed(0)} × ${(maxY - minY).toFixed(0)}`
  const base = partMarking(part)
  const copy = numbered ? (instance.uid.match(/-(\d+)$/)?.[1] ?? '').replace(/^0+/, '') : ''
  const marking = base && copy ? `${base}\u00A0/\u00A0${copy}` : base

  ctx.save()
  // Подпись обрезается по контуру детали: иначе на плотном листе названия
  // наползают на соседей и читать раскладку невозможно.
  tracePath(ctx, placed.outer, toScreen, true)
  ctx.clip()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const twoLines = boxH > 30 && Boolean(marking)
  const inner = boxW - 10

  ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'
  const dims = fitText(ctx, dimensions, inner)
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace'
  const mark = twoLines && marking ? fitText(ctx, marking, inner) : null

  if (!dims && !mark) {
    ctx.restore()
    return
  }

  // Подложка: под детали ложатся пазы и присадка, и без неё текст тонет
  // в траекториях. Плашка ровно по строкам, а не по всей детали.
  ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'
  const dimsW = dims ? ctx.measureText(dims).width : 0
  ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace'
  const markW = mark ? ctx.measureText(mark).width : 0
  const plateW = Math.max(dimsW, markW) + 10
  const plateH = (dims ? 13 : 0) + (mark ? 12 : 0) + 4
  ctx.fillStyle = LABEL_PLATE()
  ctx.fillRect(center[0] - plateW / 2, center[1] - plateH / 2, plateW, plateH)

  const dimsY = mark ? center[1] - 5 : center[1]
  if (dims) {
    ctx.fillStyle = LABEL_INK()
    ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'
    ctx.fillText(dims, center[0], dimsY)
  }
  if (mark) {
    ctx.fillStyle = DIM_INK()
    ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace'
    ctx.fillText(mark, center[0], dimsY + 12)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

/** Подрезает текст под ширину, а если не влезает даже многоточие — прячет. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string | null {
  if (maxWidth <= 12) return null
  if (ctx.measureText(text).width <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return cut.length > 1 ? `${cut}…` : null
}


function drawGrainArrow(
  ctx: CanvasRenderingContext2D,
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
  rotation: number,
): void {
  const [minX, minY, maxX, maxY] = placed.bbox
  const along = Math.abs(rotation % 180) === 90
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const len = Math.min(maxX - minX, maxY - minY) * 0.3
  const a: Point = along ? [cx, cy - len] : [cx - len, cy]
  const b: Point = along ? [cx, cy + len] : [cx + len, cy]
  const sa = toScreen(a)
  const sb = toScreen(b)

  ctx.strokeStyle = GRAIN_INK()
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(sa[0], sa[1])
  ctx.lineTo(sb[0], sb[1])
  ctx.stroke()

  const angle = Math.atan2(sb[1] - sa[1], sb[0] - sa[0])
  ctx.beginPath()
  ctx.moveTo(sb[0], sb[1])
  ctx.lineTo(sb[0] - 6 * Math.cos(angle - 0.4), sb[1] - 6 * Math.sin(angle - 0.4))
  ctx.moveTo(sb[0], sb[1])
  ctx.lineTo(sb[0] - 6 * Math.cos(angle + 0.4), sb[1] - 6 * Math.sin(angle + 0.4))
  ctx.stroke()
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
): void {
  const [, , maxX, maxY] = placed.bbox
  const s = toScreen([maxX, maxY])
  ctx.fillStyle = SELECT()
  ctx.beginPath()
  ctx.arc(s[0] - 6, s[1] + 6, 3.2, 0, Math.PI * 2)
  ctx.fill()
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  toScreen: (p: Point) => Point,
): void {
  const { viewport, width, height } = input
  // Шаг сетки подбирается так, чтобы точки не сливались в кашу.
  const steps = [10, 50, 100, 500, 1000]
  const step = steps.find((s) => s * viewport.scale > 22) ?? 1000
  const half = [width / 2 / viewport.scale, height / 2 / viewport.scale]
  const x0 = Math.floor((viewport.cx - half[0]) / step) * step
  const x1 = viewport.cx + half[0]
  const y0 = Math.floor((viewport.cy - half[1]) / step) * step
  const y1 = viewport.cy + half[1]

  ctx.fillStyle = GRID_DOT()
  for (let x = x0; x <= x1; x += step) {
    for (let y = y0; y <= y1; y += step) {
      const s = toScreen([x, y])
      ctx.fillRect(s[0], s[1], 1.2, 1.2)
    }
  }
}

/**
 * Свободная полоса листа — будущий деловой обрезок. Заштрихована и подписана,
 * потому что именно её технолог решает оставить на склад или выбросить.
 */
function drawRest(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  toScreen: (p: Point) => Point,
): void {
  const { layout, viewport } = input
  // Порог делового обрезка берётся из пресета: узкая полоса — это отход, и
  // подписывать её «на склад» значит врать кладовщику.
  const rawMin = layout.job.preset_snapshot?.placement?.min_offcut
  const minOffcut = typeof rawMin === 'number' ? rawMin : 200
  for (const sheet of layout.sheets) {
    const [ox, oy] = sheetOrigin(layout.sheets, sheet.index)
    let top = sheet.trim.bottom
    for (const instance of layout.instances) {
      if (instance.sheet_index !== sheet.index) continue
      const part = layout.parts[String(instance.part_id)]
      if (!part) continue
      const placed = placeInstance(part, instance, layout.sheets)
      if (!placed) continue
      top = Math.max(top, placed.bbox[3] - oy)
    }
    const height = sheet.h - sheet.trim.top - top
    // Полоса ниже полутора сантиметров — это уже не обрезок, а опилки.
    if (height < 15) continue

    const left = sheet.trim.left
    const width = sheet.w - sheet.trim.left - sheet.trim.right
    const corner = toScreen([ox + left, oy + top + height])
    const w = width * viewport.scale
    const h = height * viewport.scale

    const restBox = crispRect(corner[0], corner[1], w, h, 1)
    ctx.fillStyle = REST_FILL()
    ctx.globalAlpha = 0.5
    ctx.fillRect(...restBox)
    ctx.globalAlpha = 1
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = SHEET_STROKE()
    ctx.lineWidth = 1
    ctx.strokeRect(...restBox)
    ctx.setLineDash([])

    if (h > 16 && w > 150) {
      const keep = height >= minOffcut && width >= minOffcut
      ctx.fillStyle = keep ? DIM_INK() : FAINT_INK()
      ctx.font = '400 11px \'IBM Plex Mono\', ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(
        `остаток ${width.toFixed(0)} × ${height.toFixed(0)} · ${
          keep ? 'деловой, на склад' : 'в отход'
        }`,
        corner[0] + w / 2,
        corner[1] + h / 2 + 4,
      )
      ctx.textAlign = 'left'
    }
  }
}

/** Рамка выделения с угловыми маркерами. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
): void {
  const [minX, minY, maxX, maxY] = placed.bbox
  const a = toScreen([minX, maxY])
  const b = toScreen([maxX, minY])
  const pad = 3
  const x = a[0] - pad
  const y = a[1] - pad
  const w = b[0] - a[0] + pad * 2
  const h = b[1] - a[1] + pad * 2

  const box = crispRect(x, y, w, h, 1)
  ctx.strokeStyle = SELECT()
  ctx.lineWidth = 1
  ctx.strokeRect(...box)

  // Угловые маркеры — по той же сетке, что и рамка, иначе они «плывут»
  // относительно неё на пол-пикселя.
  const [bx, by, bw, bh] = box
  ctx.fillStyle = SELECT()
  const s = 5
  for (const [cx, cy] of [
    [bx, by],
    [bx + bw, by],
    [bx, by + bh],
    [bx + bw, by + bh],
  ]) {
    ctx.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), s, s)
  }
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  toScreen: (p: Point) => Point,
): void {
  if (!input.guides.length) return
  ctx.strokeStyle = GUIDE()
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  for (const guide of input.guides) {
    const sheet = input.layout.sheets.find((s) => s.index === guide.sheetIndex)
    if (!sheet) continue
    const [ox, oy] = sheetOrigin(input.layout.sheets, sheet.index)
    ctx.beginPath()
    if (guide.axis === 'x') {
      const a = toScreen([ox + guide.value, oy])
      const b = toScreen([ox + guide.value, oy + sheet.h])
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
    } else {
      const a = toScreen([ox, oy + guide.value])
      const b = toScreen([ox + sheet.w, oy + guide.value])
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
}

function drawMarquee(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const m = input.marquee
  if (!m) return
  const x = Math.min(m.x0, m.x1)
  const y = Math.min(m.y0, m.y1)
  const w = Math.abs(m.x1 - m.x0)
  const h = Math.abs(m.y1 - m.y0)
  const box = crispRect(x, y, w, h, 1)
  ctx.fillStyle = alpha(SELECT(), 0.08)
  ctx.fillRect(...box)
  ctx.strokeStyle = SELECT()
  ctx.lineWidth = 1
  ctx.strokeRect(...box)
}
