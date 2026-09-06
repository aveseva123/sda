import { useEffect, useRef } from 'react'

import { operationColor, themeColor } from '../editor/palette'

export interface ShapeOperation {
  semantic: string
  kind: string
  points?: number[][]
  center?: number[]
  diameter?: number
}

interface Props {
  /** Замкнутый внешний контур детали. */
  outer?: number[][]
  /** Внутренние вырезы. */
  inners?: number[][][]
  /** Присадка, пазы, карманы. */
  operations?: ShapeOperation[]
  /** Произвольные полилинии — используется для превью слоя в мастере. */
  paths?: number[][][]
  fill?: string
  stroke?: string
  height?: number
  label?: string
}

/**
 * Отрисовка геометрии на Canvas.
 *
 * Canvas, а не SVG: на карте раскроя деталей сотни, и SVG на таком объёме
 * ощутимо тормозит. Компонент общий, чтобы превью детали и карта раскроя
 * рисовались одним кодом.
 */
export default function ShapeCanvas({
  outer,
  inners = [],
  operations = [],
  paths = [],
  fill,
  stroke,
  height = 220,
  label,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Цвета превью — из темы: раньше здесь стояли светлые литералы, оставшиеся
  // от первой версии, и превью слоя рисовалось тёмно-синим по почти чёрному.
  const shapeFill = fill ?? themeColor('--preview-fill', '#e3e7ee')
  const shapeStroke = stroke ?? themeColor('--op-outer', '#101418')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth || 400
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, height)

    const everything: number[][][] = []
    if (outer && outer.length) everything.push(outer)
    everything.push(...inners)
    everything.push(...paths)
    for (const op of operations) {
      if (op.points?.length) everything.push(op.points)
      if (op.center && op.diameter) {
        const r = op.diameter / 2
        everything.push([
          [op.center[0] - r, op.center[1] - r],
          [op.center[0] + r, op.center[1] + r],
        ])
      }
    }

    const points = everything.flat()
    if (!points.length) {
      ctx.fillStyle = themeColor('--canvas-ink-3', '#5e6976')
      ctx.font = '13px sans-serif'
      ctx.fillText('нет геометрии', 12, 24)
      return
    }

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

    const pad = 14
    const spanX = Math.max(maxX - minX, 1e-6)
    const spanY = Math.max(maxY - minY, 1e-6)
    const scale = Math.min((cssWidth - pad * 2) / spanX, (height - pad * 2) / spanY)
    const offsetX = (cssWidth - spanX * scale) / 2
    const offsetY = (height - spanY * scale) / 2

    // Y инвертируется: в DXF ось вверх, на канве — вниз.
    const tx = (x: number) => offsetX + (x - minX) * scale
    const ty = (y: number) => height - (offsetY + (y - minY) * scale)

    const trace = (ring: number[][], close: boolean) => {
      ctx.beginPath()
      ring.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(tx(x), ty(y))
        else ctx.lineTo(tx(x), ty(y))
      })
      if (close) ctx.closePath()
    }

    if (outer && outer.length > 2) {
      trace(outer, true)
      ctx.fillStyle = shapeFill
      ctx.fill()
      ctx.strokeStyle = shapeStroke
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = themeColor('--sheet-fill', '#f8f9f7')
      for (const ring of inners) {
        if (ring.length < 3) continue
        trace(ring, true)
        ctx.fill()
        ctx.strokeStyle = operationColor('INNER')
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    ctx.lineWidth = 1.2
    for (const path of paths) {
      if (path.length < 2) continue
      trace(path, false)
      ctx.strokeStyle = shapeStroke
      ctx.stroke()
    }

    for (const op of operations) {
      ctx.strokeStyle = operationColor(op.semantic)
      ctx.lineWidth = 1.2
      if (op.center && op.diameter) {
        ctx.beginPath()
        ctx.arc(tx(op.center[0]), ty(op.center[1]), Math.max((op.diameter / 2) * scale, 1.5), 0, Math.PI * 2)
        ctx.stroke()
      } else if (op.points?.length) {
        trace(op.points, op.kind === 'contour')
        ctx.stroke()
      }
    }

    if (label) {
      ctx.fillStyle = themeColor('--canvas-ink-2', '#47515f')
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(label, 8, 14)
    }
  }, [outer, inners, operations, paths, shapeFill, shapeStroke, height, label])

  return <canvas className="preview" ref={ref} style={{ height }} />
}
