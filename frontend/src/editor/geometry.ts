import type { InstanceView, PartGeometryData, PartView, SheetView } from './types'

export type Point = [number, number]

/** Зазор между листами на холсте, мм. */
export const SHEET_GAP = 300

/** Начало координат листа в мировой системе (миллиметры). */
export function sheetOrigin(sheets: SheetView[], index: number): Point {
  let x = 0
  for (const sheet of sheets) {
    if (sheet.index === index) break
    x += sheet.w + SHEET_GAP
  }
  return [x, 0]
}

function rotatePoint([x, y]: Point, angleDeg: number): Point {
  if (angleDeg === 0) return [x, y]
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [x * cos - y * sin, x * sin + y * cos]
}

export function bboxOf(points: Point[]): [number, number, number, number] {
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
  return [minX, minY, maxX, maxY]
}

/**
 * Геометрия детали, приведённая к её собственному нулю.
 *
 * DXF отдаёт координаты в системе чертежа: деталь может лежать где угодно.
 * Для раскладки нужна деталь с нулём в левом нижнем углу габарита — тогда
 * позиция экземпляра (x, y) означает ровно «куда поставить угол детали».
 */
export interface LocalGeometry {
  outer: Point[]
  inners: Point[][]
  operations: PartGeometryData['operations']
  w: number
  h: number
}

const localCache = new WeakMap<PartGeometryData, LocalGeometry>()

export function localGeometry(geometry: PartGeometryData): LocalGeometry {
  const cached = localCache.get(geometry)
  if (cached) return cached

  const [minX, minY, maxX, maxY] = geometry.bbox as [number, number, number, number]
  const shift = (p: number[]): Point => [p[0] - minX, p[1] - minY]

  const local: LocalGeometry = {
    outer: (geometry.outer ?? []).map(shift),
    inners: (geometry.inners ?? []).map((ring) => ring.map(shift)),
    operations: (geometry.operations ?? []).map((op) => ({
      ...op,
      points: op.points?.map((p) => [p[0] - minX, p[1] - minY] as number[]),
      center: op.center ? ([op.center[0] - minX, op.center[1] - minY] as number[]) : undefined,
    })),
    w: maxX - minX,
    h: maxY - minY,
  }
  localCache.set(geometry, local)
  return local
}

/**
 * Габарит детали на листе с учётом поворота.
 *
 * Берётся из геометрии, а не из «длина × ширина»: последние — это больший и
 * меньший размеры, они не помнят, как деталь лежит на чертеже. Для стойки
 * 1954×630, стоящей вертикально, они дали бы горизонтальный габарит, и
 * выравнивание раскидало бы детали мимо их настоящих краёв.
 */
export function rotatedSize(part: PartView, rotation: number): [number, number] {
  let w = part.length ?? 0
  let h = part.width ?? 0
  const bbox = part.geometry?.bbox
  if (bbox && bbox.length === 4) {
    const dx = bbox[2] - bbox[0]
    const dy = bbox[3] - bbox[1]
    if (dx > 0 && dy > 0) {
      w = dx
      h = dy
    }
  }
  return Math.abs(rotation % 180) === 90 ? [h, w] : [w, h]
}

export interface PlacedPart {
  outer: Point[]
  inners: Point[][]
  operations: Array<{
    semantic: string
    target: string
    points?: Point[]
    center?: Point
    diameter?: number
    depth?: number
  }>
  /** Габарит в мировых координатах. */
  bbox: [number, number, number, number]
}

/**
 * Геометрия экземпляра в мировых координатах: деталь повёрнута и поставлена
 * на свой лист. Поворот делается вокруг нуля детали, после чего габарит
 * снова подтягивается к (x, y) — так же, как считает укладчик на сервере.
 */
export function placeInstance(
  part: PartView,
  instance: InstanceView,
  sheets: SheetView[],
): PlacedPart | null {
  if (!part.geometry || instance.sheet_index === null || instance.x === null || instance.y === null) {
    return null
  }
  const local = localGeometry(part.geometry)
  const rotation = instance.rotation ?? 0
  const [ox, oy] = sheetOrigin(sheets, instance.sheet_index)

  const rotated = local.outer.map((p) => rotatePoint(p, rotation))
  const [rminX, rminY] = bboxOf(rotated)
  const dx = ox + instance.x - rminX
  const dy = oy + instance.y - rminY
  const put = (p: Point): Point => {
    const r = rotatePoint(p, rotation)
    return [r[0] + dx, r[1] + dy]
  }

  const outer = local.outer.map(put)
  return {
    outer,
    inners: local.inners.map((ring) => ring.map(put)),
    operations: local.operations.map((op, index) => ({
      semantic: op.semantic,
      target: `op:${index}`,
      points: op.points?.map((p) => put(p as Point)),
      center: op.center ? put(op.center as Point) : undefined,
      diameter: op.diameter,
      depth: op.depth,
    })),
    bbox: bboxOf(outer),
  }
}

/** Точка внутри многоугольника — для попадания курсором по детали. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const [px, py] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function distanceToPath(p: Point, path: Point[], closed = true): number {
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distanceToSegment(p, path[i], path[i + 1]))
  }
  if (closed && path.length > 2) {
    best = Math.min(best, distanceToSegment(p, path[path.length - 1], path[0]))
  }
  return best
}

/** Какой лист находится под точкой. */
export function sheetAt(sheets: SheetView[], point: Point): SheetView | null {
  for (const sheet of sheets) {
    const [ox, oy] = sheetOrigin(sheets, sheet.index)
    if (
      point[0] >= ox &&
      point[0] <= ox + sheet.w &&
      point[1] >= oy &&
      point[1] <= oy + sheet.h
    ) {
      return sheet
    }
  }
  return null
}

/**
 * Привязка при перетаскивании: к краям полезной области листа и к граням
 * соседних деталей с учётом зазора под рез.
 */
export interface SnapResult {
  x: number
  y: number
  guides: Array<{ axis: 'x' | 'y'; value: number }>
}

export function snapPosition(
  x: number,
  y: number,
  size: [number, number],
  sheet: SheetView,
  neighbours: Array<[number, number, number, number]>,
  gap: number,
  tolerance: number,
): SnapResult {
  const [w, h] = size
  const guides: SnapResult['guides'] = []

  const candidatesX = [sheet.trim.left, sheet.w - sheet.trim.right - w]
  const candidatesY = [sheet.trim.bottom, sheet.h - sheet.trim.top - h]
  for (const [nx, ny, nw, nh] of neighbours) {
    candidatesX.push(nx, nx + nw + gap, nx - w - gap, nx + nw - w)
    candidatesY.push(ny, ny + nh + gap, ny - h - gap, ny + nh - h)
  }

  let bestX = x
  let bestDx = tolerance
  for (const candidate of candidatesX) {
    const delta = Math.abs(candidate - x)
    if (delta < bestDx) {
      bestDx = delta
      bestX = candidate
    }
  }
  if (bestX !== x) guides.push({ axis: 'x', value: bestX })

  let bestY = y
  let bestDy = tolerance
  for (const candidate of candidatesY) {
    const delta = Math.abs(candidate - y)
    if (delta < bestDy) {
      bestDy = delta
      bestY = candidate
    }
  }
  if (bestY !== y) guides.push({ axis: 'y', value: bestY })

  return { x: bestX, y: bestY, guides }
}
