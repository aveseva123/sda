import {
  type PlacedPart,
  type Point,
  placeInstance,
  rotatedSize,
  sheetOrigin,
} from './geometry'
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
  showToolpaths: boolean
  guides: Array<{ axis: 'x' | 'y'; value: number; sheetIndex: number }>
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
}

const GRID_COLOR = '#e6e9ee'
const SHEET_FILL = '#ffffff'
const SHEET_STROKE = '#9aa3af'
const TRIM_STROKE = '#c9ced6'
const ACCENT = '#0072b2'
const DANGER = '#dc2626'

const patternCache = new Map<string, CanvasPattern | null>()

/** Штриховка изделия: цвет — проект, узор — изделие. */
function hatch(
  ctx: CanvasRenderingContext2D,
  fill: string,
  pattern: string,
): CanvasPattern | string {
  if (pattern === 'solid') return fill
  const key = `${pattern}|${fill}`
  const cached = patternCache.get(key)
  if (cached !== undefined) return cached ?? fill

  const size = 8
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
  tctx.strokeStyle = 'rgba(255,255,255,0.75)'
  tctx.lineWidth = 1.4
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
      tctx.arc(size / 2, size / 2, 1.4, 0, Math.PI * 2)
      tctx.fillStyle = 'rgba(255,255,255,0.85)'
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
  ctx.fillStyle = '#eef0f4'
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

    ctx.fillStyle = SHEET_FILL
    ctx.fillRect(topLeft[0], topLeft[1], w, h)
    ctx.strokeStyle = SHEET_STROKE
    ctx.lineWidth = 1.5
    ctx.strokeRect(topLeft[0], topLeft[1], w, h)

    // Полезная область: то, что осталось после обрезки кромок листа.
    const inset = toScreen([ox + sheet.trim.left, oy + sheet.h - sheet.trim.top])
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = TRIM_STROKE
    ctx.lineWidth = 1
    ctx.strokeRect(
      inset[0],
      inset[1],
      (sheet.w - sheet.trim.left - sheet.trim.right) * viewport.scale,
      (sheet.h - sheet.trim.top - sheet.trim.bottom) * viewport.scale,
    )
    ctx.setLineDash([])

    ctx.fillStyle = '#4b5563'
    ctx.font = '600 12px system-ui, sans-serif'
    const utilization = sheet.utilization ? ` · КПД ${(sheet.utilization * 100).toFixed(1)}%` : ''
    ctx.fillText(
      `Лист ${sheet.index + 1} · ${sheet.w.toFixed(0)} × ${sheet.h.toFixed(0)} мм${utilization}`,
      topLeft[0],
      topLeft[1] - 8,
    )
  }

  // Детали.
  const labelScale = viewport.scale > 0.06
  for (const instance of layout.instances) {
    const part = layout.parts[String(instance.part_id)]
    if (!part) continue
    const placed = placeInstance(part, instance, layout.sheets)
    if (!placed) continue

    const isSelected = selectedInstances.has(instance.id)
    const isFocused = input.focusedPartId === part.id
    const isColliding = collidingInstances.has(instance.id)
    const style = part.style

    tracePath(ctx, placed.outer, toScreen, true)
    ctx.fillStyle = style ? hatch(ctx, style.fill, style.pattern) : '#cbd5e1'
    ctx.fill()

    // Вырезы «прорезают» деталь до листа.
    for (const ring of placed.inners) {
      tracePath(ctx, ring, toScreen, true)
      ctx.fillStyle = SHEET_FILL
      ctx.fill()
      ctx.strokeStyle = '#4b5563'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    tracePath(ctx, placed.outer, toScreen, true)
    ctx.strokeStyle = isColliding ? DANGER : isSelected ? ACCENT : style?.stroke ?? '#334155'
    ctx.lineWidth = isColliding ? 2.5 : isSelected ? 2.5 : 1.2
    ctx.stroke()

    if (isColliding) {
      ctx.fillStyle = 'rgba(220,38,38,0.18)'
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.fill()
    }

    drawOperations(ctx, input, part, placed, toScreen, selectedVectors, isFocused)

    if (input.hoveredInstance === instance.id && !isSelected) {
      tracePath(ctx, placed.outer, toScreen, true)
      ctx.strokeStyle = 'rgba(0,114,178,0.55)'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    if (instance.pinned) drawPin(ctx, placed, toScreen)
    if (labelScale) drawLabel(ctx, part, instance, placed, toScreen, viewport.scale)
    if (labelScale && part.grain !== 'none') {
      drawGrainArrow(ctx, placed, toScreen, instance.rotation ?? 0)
    }
    void rotatedSize
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

  for (const op of placed.operations) {
    const vector = byTarget.get(op.target)
    const preset = vector?.preset_id ? input.presets.get(vector.preset_id) : undefined
    const color = preset?.color ?? '#6b7280'
    const selected = selectedVectors.has(vectorKey(part.id, op.target))
    const enabled = vector?.enabled !== false

    // Ширина фрезы: видно, что реально снимет инструмент.
    if (input.showToolpaths && preset?.tool_diameter && enabled) {
      ctx.strokeStyle = `${color}55`
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

    ctx.strokeStyle = enabled ? color : '#9ca3af'
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

  // Контуры детали как выбираемые векторы — только внутри выбранной детали.
  if (!isFocused) return
  const outerSelected = selectedVectors.has(vectorKey(part.id, 'outer'))
  if (outerSelected) {
    tracePath(ctx, placed.outer, toScreen, true)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 3.5
    ctx.stroke()
  }
  placed.inners.forEach((ring, index) => {
    if (!selectedVectors.has(vectorKey(part.id, `inner:${index}`))) return
    tracePath(ctx, ring, toScreen, true)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 3.5
    ctx.stroke()
  })
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  part: RenderInput['layout']['parts'][string],
  instance: RenderInput['layout']['instances'][number],
  placed: PlacedPart,
  toScreen: (p: Point) => Point,
  scale: number,
): void {
  const [minX, minY, maxX, maxY] = placed.bbox
  const center = toScreen([(minX + maxX) / 2, (minY + maxY) / 2])
  const boxW = (maxX - minX) * scale
  const boxH = (maxY - minY) * scale
  if (boxW < 46 || boxH < 22) return

  ctx.save()
  // Подпись обрезается по контуру детали: иначе на плотном листе названия
  // наползают на соседей и читать раскладку невозможно.
  tracePath(ctx, placed.outer, toScreen, true)
  ctx.clip()

  ctx.fillStyle = part.style?.text ?? '#111827'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const [w, h] = [part.length ?? 0, part.width ?? 0]
  const dimensions = `${w.toFixed(0)} × ${h.toFixed(0)}`
  const twoLines = boxH > 34

  ctx.font = '600 11px system-ui, sans-serif'
  const name = fitText(ctx, part.name, boxW - 8)
  if (name) ctx.fillText(name, center[0], center[1] - (twoLines ? 7 : 0))

  if (twoLines) {
    ctx.font = '10px system-ui, sans-serif'
    const dims = fitText(ctx, dimensions, boxW - 8)
    if (dims) ctx.fillText(dims, center[0], center[1] + 7)
    if (boxH > 52) {
      const uid = fitText(ctx, instance.uid.slice(-7), boxW - 8)
      if (uid) ctx.fillText(uid, center[0], center[1] + 20)
    }
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

  ctx.strokeStyle = 'rgba(17,24,39,0.45)'
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
  ctx.fillStyle = ACCENT
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
  // Шаг сетки подбирается так, чтобы линии не сливались.
  const steps = [10, 50, 100, 500, 1000]
  const step = steps.find((s) => s * viewport.scale > 18) ?? 1000
  const half = [width / 2 / viewport.scale, height / 2 / viewport.scale]
  const x0 = Math.floor((viewport.cx - half[0]) / step) * step
  const x1 = viewport.cx + half[0]
  const y0 = Math.floor((viewport.cy - half[1]) / step) * step
  const y1 = viewport.cy + half[1]

  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = x0; x <= x1; x += step) {
    const s = toScreen([x, 0])
    ctx.moveTo(s[0], 0)
    ctx.lineTo(s[0], height)
  }
  for (let y = y0; y <= y1; y += step) {
    const s = toScreen([0, y])
    ctx.moveTo(0, s[1])
    ctx.lineTo(width, s[1])
  }
  ctx.stroke()
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  toScreen: (p: Point) => Point,
): void {
  if (!input.guides.length) return
  ctx.strokeStyle = '#e11d48'
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
  ctx.fillStyle = 'rgba(0,114,178,0.10)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, w, h)
}
