import {
  type PlacedPart,
  type Point,
  placeInstance,
  rotatedSize,
  sheetOrigin,
} from './geometry'
import {
  alpha as alphaOf,
  operationColor,
  fileColors,
  themeColor,
  vectorStyle,
} from './palette'
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

const CANVAS_BG = () => ink('--canvas-bg', '#C9CFD7')
const GRID_DOT = () => ink('--canvas-grid', '#B0B8C2')
const SHEET_FILL = () => ink('--sheet-fill', '#F8F9F7')
const SHEET_STROKE = () => ink('--sheet-edge', '#7F8996')
const TRIM_STROKE = () => ink('--sheet-trim', '#A3ACB8')
const TRIM_FILL = () => ink('--sheet-trim-fill', '#DFE3E6')
const REST_LINE = () => ink('--rest-line', '#4E8C6E')
const REST_FILL = () => ink('--rest-fill', '#C6E6D6')
const LABEL_INK = () => ink('--canvas-ink', '#16191D')
const DIM_INK = () => ink('--canvas-ink-2', '#47515F')
const FAINT_INK = () => ink('--canvas-ink-3', '#5E6976')
/** «Не обрабатывать»: слабее всех линий, но не невидимо. */
const SKIP_INK = () => ink('--op-skip', '#6F7A87')
/**
 * Белым на холсте были обозначены пять разных вещей: выделенная деталь, её
 * угловые маркеры, подсветка под курсором, выбранный вектор внутри детали,
 * значок закрепления и рамка резинового выделения. Всё это разные смыслы, и
 * на светлом фоне белый вдобавок не виден вовсе.
 */
const SELECT = () => ink('--canvas-select', '#3E45A8')
const HOVER_INK = () => ink('--canvas-hover', '#3E45A8')
const PIN_INK = () => ink('--canvas-pin', '#47515F')
/** Подложка под тёмной линией: делает её видимой на любом фоне. */
const HALO = 'rgba(255,255,255,0.9)'
const DANGER = () => ink('--canvas-danger', '#D92D20')
const PART_EDGE = () => ink('--part-edge', '#5A646F')
const LABEL_PLATE = () => ink('--canvas-plate', 'rgba(255,255,255,0.88)')
const GUIDE = () => ink('--canvas-guide', '#1668D6')
const GRAIN_INK = () => ink('--canvas-grain', '#7C8794')

const patternCache = new Map<string, CanvasPattern | null>()

/**
 * Заливка детали: цвет закреплён за файлом, штриховка — за листом внутри
 * файла. Штрих рисуется цветом ОБВОДКИ по бледной заливке, а не той же
 * краской с другой прозрачностью: полупрозрачный штрих был подобран под
 * чёрный холст, на светлом листе он почти исчезал.
 */
function hatch(
  ctx: CanvasRenderingContext2D,
  fill: string,
  edge: string,
  pattern: string,
): CanvasPattern | string {
  if (pattern === 'solid') return fill
  const key = `${pattern}|${fill}|${edge}`
  const cached = patternCache.get(key)
  if (cached !== undefined) return cached ?? fill

  const size = 10
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const tctx = tile.getContext('2d')
  if (!tctx) {
    patternCache.set(key, null)
    return fill
  }
  tctx.fillStyle = fill
  tctx.fillRect(0, 0, size, size)
  tctx.strokeStyle = alphaOf(edge, 0.55)
  tctx.fillStyle = alphaOf(edge, 0.55)
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
  return made ?? fill
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
let restPatternCache: { key: string; pattern: CanvasPattern | null } | null = null

/**
 * Заливка остатка листа: цвет плюс редкая диагональ.
 *
 * Зелёный сам по себе не годится — он занят и как цвет файла, и на карте
 * рядом лежат зелёные детали. Полоса остатка отличается фактурой: это не
 * деталь, а свободное место, и путать их нельзя, потому что одно уезжает на
 * склад, а другое на станок.
 */
function restFill(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  const fill = REST_FILL()
  const line = REST_LINE()
  const key = `${fill}|${line}`
  if (restPatternCache?.key === key) return restPatternCache.pattern ?? fill

  const size = 14
  const tile = document.createElement('canvas')
  tile.width = size
  tile.height = size
  const tctx = tile.getContext('2d')
  if (!tctx) {
    restPatternCache = { key, pattern: null }
    return fill
  }
  tctx.fillStyle = fill
  tctx.fillRect(0, 0, size, size)
  tctx.strokeStyle = alphaOf(line, 0.3)
  tctx.lineWidth = 1
  tctx.beginPath()
  tctx.moveTo(0, size)
  tctx.lineTo(size, 0)
  tctx.moveTo(-1, 1)
  tctx.lineTo(1, -1)
  tctx.moveTo(size - 1, size + 1)
  tctx.lineTo(size + 1, size - 1)
  tctx.stroke()
  const made = ctx.createPattern(tile, 'repeat')
  restPatternCache = { key, pattern: made }
  return made ?? fill
}

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
    ctx.lineWidth = 1.5
    ctx.strokeRect(...sheetBox)

    // Полезная область: то, что осталось после обрезки кромок листа. Полоса
    // обрезки залита, а не только обведена: пунктир на светлом читается как
    // «какая-то рамка», а заливка сразу говорит «сюда деталь не встанет».
    const inset = toScreen([ox + sheet.trim.left, oy + sheet.h - sheet.trim.top])
    const usable = crispRect(
      inset[0],
      inset[1],
      (sheet.w - sheet.trim.left - sheet.trim.right) * viewport.scale,
      (sheet.h - sheet.trim.top - sheet.trim.bottom) * viewport.scale,
      1,
    )
    ctx.save()
    ctx.beginPath()
    ctx.rect(...sheetBox)
    ctx.rect(...usable)
    ctx.fillStyle = TRIM_FILL()
    ctx.fill('evenodd')
    ctx.restore()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = TRIM_STROKE()
    ctx.lineWidth = 1
    ctx.strokeRect(...usable)
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
  // Вошли внутрь детали — остальные приглушаются, как режим изоляции в
  // векторном редакторе. Иначе соседние контуры спорят с тем, который сейчас
  // разбирают, а именно ради него сюда и зашли.
  const isolating = input.focusedPartId !== null

  for (const instance of layout.instances) {
    const part = layout.parts[String(instance.part_id)]
    if (!part) continue
    const placed = placeInstance(part, instance, layout.sheets)
    if (!placed) continue

    const isSelected = selectedInstances.has(instance.id)
    const isFocused = input.focusedPartId === part.id
    const isColliding = collidingInstances.has(instance.id)
    const style = part.style
    // Заливка и обводка по цвету файла считаются здесь: сервер отдаёт цвет
    // как есть, а как из него сделать читаемую на этом фоне пару, знает тема.
    const tone = style
      ? fileColors(style.base ?? style.fill, part.source_sheet_index ?? 0)
      : null

    ctx.save()
    if (isolating && !isFocused) ctx.globalAlpha = 0.22

    const outline = input.view === 'outline'

    if (!outline) {
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.fillStyle =
        style && tone
          ? hatch(ctx, tone.fill, tone.edge, style.pattern)
          : alphaOf(PART_EDGE(), 0.2)
      ctx.fill()

      // Вырезы «прорезают» деталь до листа.
      for (const ring of placed.inners) {
        tracePath(ctx, ring, toScreen, true)
        ctx.fillStyle = SHEET_FILL()
        ctx.fill()
        ctx.strokeStyle = operationColor('INNER')
        ctx.lineWidth = vectorStyle('INNER').width
        ctx.stroke()
      }
    } else {
      // В каркасе вырез — такая же линия, как всё остальное: заливать его
      // цветом листа незачем, под ним ничего не прячется.
      for (const ring of placed.inners) {
        tracePath(ctx, ring, toScreen, true)
        ctx.strokeStyle = operationColor('INNER')
        ctx.lineWidth = vectorStyle('INNER').width
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
        ? tone?.edge ?? PART_EDGE()
        : PART_EDGE()
    ctx.lineWidth = isColliding ? 3 : vectorStyle('OUTER').width
    ctx.stroke()

    if (isColliding) {
      ctx.fillStyle = alphaOf(DANGER(), 0.16)
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.fill()
    }

    // Выделение — белая рамка с угловыми маркерами, как в векторном редакторе.
    if (isSelected) drawSelection(ctx, placed, toScreen)

    drawOperations(ctx, input, part, placed, toScreen, selectedVectors, isFocused)

    if (input.hoveredInstance === instance.id && !isSelected) {
      tracePath(ctx, placed.outer, toScreen, true)
      // Подсветка под курсором отличается от выделения структурой — нет
      // рамки и ручек, — а не бледностью: полупрозрачный акцент на светлом
      // просто сереет и читается как «выключено».
      ctx.strokeStyle = HOVER_INK()
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (instance.pinned) drawPin(ctx, placed, toScreen)
    if (labelScale && (!isolating || isFocused)) labels.push({ part, instance, placed })
    if (labelScale && part.grain !== 'none') {
      drawGrainArrow(ctx, placed, toScreen, instance.rotation ?? 0)
    }
    ctx.restore()
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


/** Длина ломаной в экранных пикселях. */
function screenLength(points: Point[], toScreen: (p: Point) => Point): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = toScreen(points[i - 1])
    const b = toScreen(points[i])
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

/** Точка на ломаной по доле её длины и направление в ней. */
function alongPath(
  points: Point[],
  toScreen: (p: Point) => Point,
  fraction: number,
): { at: Point; angle: number } | null {
  const total = screenLength(points, toScreen)
  if (total <= 0) return null
  let target = total * fraction
  for (let i = 1; i < points.length; i += 1) {
    const a = toScreen(points[i - 1])
    const b = toScreen(points[i])
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (seg <= 0) continue
    if (target <= seg) {
      const t = target / seg
      return {
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      }
    }
    target -= seg
  }
  return null
}

/** Стрелка обхода: треугольник остриём по направлению движения фрезы. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  at: Point,
  angle: number,
  color: string,
  size = 7,
): void {
  ctx.save()
  ctx.translate(at[0], at[1])
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(size * 0.6, 0)
  ctx.lineTo(-size * 0.4, size * 0.42)
  ctx.lineTo(-size * 0.4, -size * 0.42)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/**
 * Разметка контура: направление обхода, точка входа и узлы.
 *
 * Показывается только у детали, внутрь которой вошли, — как isolation mode в
 * векторных редакторах. Рисовать это у всех сразу нельзя: на листе сотня
 * деталей, и стрелки превратятся в шум.
 *
 * Направление обхода — не украшение: от него зависит, попутное фрезерование
 * или встречное, а значит скол на лицевой стороне детали.
 */
function decoratePath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  toScreen: (p: Point) => Point,
  color: string,
  options: { nodes: boolean; closed: boolean },
): void {
  if (points.length < 2) return
  const total = screenLength(points, toScreen)
  if (total < 40) return

  // Одна стрелка на каждые двести пикселей длины, но не больше четырёх:
  // дальше они перестают читаться как направление и становятся пунктиром.
  const count = Math.max(1, Math.min(4, Math.round(total / 200)))
  for (let i = 0; i < count; i += 1) {
    const spot = alongPath(points, toScreen, (i + 0.5) / count)
    if (spot) drawArrow(ctx, spot.at, spot.angle, color)
  }

  // Точка входа: с неё фреза начнёт и на ней же оставит след врезания.
  const start = toScreen(points[0])
  ctx.beginPath()
  ctx.arc(start[0], start[1], 3.5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = SHEET_FILL()
  ctx.lineWidth = 1.5
  ctx.stroke()

  if (!options.nodes || points.length > 400) return
  ctx.fillStyle = SHEET_FILL()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const last = options.closed ? points.length - 1 : points.length
  for (let i = 0; i < last; i += 1) {
    const [x, y] = toScreen(points[i])
    ctx.beginPath()
    ctx.rect(Math.round(x) - 2.5, Math.round(y) - 2.5, 5, 5)
    ctx.fill()
    ctx.stroke()
  }
}

/** Самый крупный размер операции на экране, в пикселях. */
function operationExtent(
  op: PlacedPart['operations'][number],
  scale: number,
): number {
  if (op.diameter) return op.diameter * scale
  const points = op.points
  if (!points?.length) return 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Math.max(maxX - minX, maxY - minY) * scale
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

  ctx.save()

  // Порог видимости. На общем виде (0,17 пикселя на миллиметр) отверстие ⌀8
  // — это полтора пикселя: сотня деталей даёт семьсот красных точек, которые
  // ничего не сообщают и мешают увидеть саму раскладку. Операция рисуется,
  // только когда её видно как операцию, а не как пятно. Паз длиной 500 мм при
  // том же масштабе — это 85 пикселей, он остаётся.
  const MIN_OP_PX = 3.5

  for (const op of placed.operations) {
    if (operationExtent(op, input.viewport.scale) < MIN_OP_PX) continue
    const vector = byTarget.get(op.target)
    const preset = vector?.preset_id ? input.presets.get(vector.preset_id) : undefined
    // Цвет — по ТИПУ операции, а не по пресету: оператор читает на карте
    // «это паз», «это присадка». Два пресета одного типа не должны выглядеть
    // разными операциями, а цвет из конфига не знает, на каком фоне рисуют.
    const style = vectorStyle(op.semantic)
    const color = style.color
    const selected = selectedVectors.has(vectorKey(part.id, op.target))
    const enabled = vector?.enabled !== false

    // Ширина фрезы: видно, что реально снимет инструмент. Рисуется ДО самой
    // линии, иначе след закрывает вектор, который он поясняет.
    if (input.showToolpaths && preset?.tool_diameter && enabled) {
      ctx.strokeStyle = alphaOf(color, 0.32)
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

    // Начертание — второй канал различия к цвету: сплошная режется насквозь,
    // штриховая снимается на глубину. Выключенный вектор гасится и цветом, и
    // рисуется тем же штрихом, что и был, — чтобы тип оставался узнаваем.
    ctx.strokeStyle = enabled ? color : SKIP_INK()
    ctx.lineWidth = selected ? style.width + 1.7 : style.width
    ctx.setLineDash(enabled ? style.dash : [2, 3])
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
  // Выбранный вектор — тоже по схеме «гало плюс акцент»: без гало выбранный
  // чёрный контур сквозного реза визуально не отличается от невыбранного.
  const markSelected = (points: Point[]) => {
    tracePath(ctx, points, toScreen, true)
    ctx.strokeStyle = HALO
    ctx.lineWidth = 5
    ctx.stroke()
    tracePath(ctx, points, toScreen, true)
    ctx.strokeStyle = SELECT()
    ctx.lineWidth = 3
    ctx.stroke()
  }
  if (outerSelected) markSelected(placed.outer)
  placed.inners.forEach((ring, index) => {
    if (!selectedVectors.has(vectorKey(part.id, `inner:${index}`))) return
    markSelected(ring)
  })

  // Вошли внутрь детали — показываем, как её обойдёт фреза: направление,
  // точку входа и узлы контура. Узлы только вблизи: на общем виде они
  // сливаются в сплошную линию и мешают.
  const nodes = input.viewport.scale > 0.5
  decoratePath(ctx, placed.outer, toScreen, operationColor('OUTER'), { nodes, closed: true })
  for (const ring of placed.inners) {
    decoratePath(ctx, ring, toScreen, operationColor('INNER'), { nodes, closed: true })
  }
  for (const op of placed.operations) {
    if (!op.points?.length) continue
    decoratePath(ctx, op.points, toScreen, operationColor(op.semantic), {
      nodes: false,
      closed: false,
    })
  }
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
  ctx.beginPath()
  ctx.arc(s[0] - 6, s[1] + 6, 4.2, 0, Math.PI * 2)
  ctx.fillStyle = HALO
  ctx.fill()
  ctx.beginPath()
  ctx.arc(s[0] - 6, s[1] + 6, 3, 0, Math.PI * 2)
  ctx.fillStyle = PIN_INK()
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

    // Полупрозрачность здесь была рассчитана на тёмный холст; на светлом она
    // стирала зону до неразличимой. Цвет кладётся как есть.
    const restBox = crispRect(corner[0], corner[1], w, h, 1)
    ctx.fillStyle = restFill(ctx)
    ctx.fillRect(...restBox)
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = REST_LINE()
    ctx.lineWidth = 1
    ctx.strokeRect(...restBox)
    ctx.setLineDash([])

    if (h > 16 && w > 150) {
      const keep = height >= minOffcut && width >= minOffcut
      ctx.fillStyle = keep ? REST_LINE() : FAINT_INK()
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
  // Белое гало под тёмной линией: белое само по себе на светлом листе не
  // видно, а как подложка работает и на бледной заливке детали, и на сером
  // столе, и поверх чёрного контура сквозного реза.
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3.5
  ctx.strokeRect(...box)
  ctx.strokeStyle = SELECT()
  ctx.lineWidth = 1.5
  ctx.strokeRect(...box)

  // Угловые маркеры — полые, как в векторных редакторах: они не закрашивают
  // геометрию под собой. По той же пиксельной сетке, что и рамка.
  const [bx, by, bw, bh] = box
  const s = 6
  for (const [cx, cy] of [
    [bx, by],
    [bx + bw, by],
    [bx, by + bh],
    [bx + bw, by + bh],
  ]) {
    const hx = Math.round(cx - s / 2) + 0.5
    const hy = Math.round(cy - s / 2) + 0.5
    ctx.fillStyle = HALO
    ctx.fillRect(hx, hy, s, s)
    ctx.strokeStyle = SELECT()
    ctx.lineWidth = 1.5
    ctx.strokeRect(hx, hy, s, s)
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
  ctx.fillStyle = alphaOf(SELECT(), 0.1)
  ctx.fillRect(...box)
  ctx.strokeStyle = SELECT()
  ctx.lineWidth = 1
  ctx.strokeRect(...box)
}
