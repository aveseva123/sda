import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  type Point,
  distanceToPath,
  placeInstance,
  pointInPolygon,
  sheetAt,
  sheetOrigin,
  snapPosition,
} from '../../editor/geometry'
import { type Viewport, render, screenToWorld } from '../../editor/render'
import type { Collision, InstanceView, Layout, Selection, ToolpathPreset } from '../../editor/types'
import { vectorKey } from '../../editor/types'

export interface Move {
  instance_id: number
  sheet_index?: number | null
  x?: number | null
  y?: number | null
  rotation?: number | null
  pinned?: boolean
}

export interface StageHandle {
  fit: () => void
  zoomBy: (factor: number) => void
  getScale: () => number
}

interface Props {
  layout: Layout
  collisions: Collision[]
  presets: ToolpathPreset[]
  selection: Selection
  onSelectionChange: (selection: Selection) => void
  focusedPartId: number | null
  onFocusPart: (partId: number | null) => void
  onMove: (moves: Move[]) => void
  onDropFiles: (files: File[]) => void
  showToolpaths: boolean
  gap: number
  onViewportChange?: (scale: number) => void
}

type Draft = Record<number, { x: number; y: number; sheet_index: number }>

const MIN_SCALE = 0.01
const MAX_SCALE = 4

const CanvasStage = forwardRef<StageHandle, Props>(function CanvasStage(props, ref) {
  const {
    layout,
    collisions,
    presets,
    selection,
    onSelectionChange,
    focusedPartId,
    onFocusPart,
    onMove,
    onDropFiles,
    showToolpaths,
    gap,
    onViewportChange,
  } = props

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ cx: 1400, cy: 1035, scale: 0.15 })
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hovered, setHovered] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [guides, setGuides] = useState<
    Array<{ axis: 'x' | 'y'; value: number; sheetIndex: number }>
  >([])
  const [marquee, setMarquee] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null)
  const [dragOver, setDragOver] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  const drag = useRef<{
    kind: 'pan' | 'move' | 'marquee'
    startScreen: Point
    startWorld: Point
    origin: Record<number, { x: number; y: number; sheet_index: number }>
    moved: boolean
  } | null>(null)

  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p])), [presets])

  // Раскладка с учётом ещё не сохранённого перетаскивания.
  const effective = useMemo<Layout>(() => {
    if (!Object.keys(draft).length) return layout
    return {
      ...layout,
      instances: layout.instances.map((instance) =>
        draft[instance.id] ? { ...instance, ...draft[instance.id] } : instance,
      ),
    }
  }, [layout, draft])

  const instancesById = useMemo(() => {
    const map = new Map<number, InstanceView>()
    for (const instance of effective.instances) map.set(instance.id, instance)
    return map
  }, [effective])

  // -------------------------------------------------------------- размеры

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!layout.sheets.length) return
    let maxX = 0
    let maxY = 0
    for (const sheet of layout.sheets) {
      const [ox, oy] = sheetOrigin(layout.sheets, sheet.index)
      maxX = Math.max(maxX, ox + sheet.w)
      maxY = Math.max(maxY, oy + sheet.h)
    }
    const pad = 80
    const scale = Math.min(
      (size.width - pad) / Math.max(maxX, 1),
      (size.height - pad) / Math.max(maxY, 1),
    )
    setViewport({
      cx: maxX / 2,
      cy: maxY / 2,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)),
    })
  }, [layout.sheets, size])

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor: number) =>
      setViewport((v) => ({
        ...v,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor)),
      })),
    getScale: () => viewport.scale,
  }))

  useEffect(() => {
    onViewportChange?.(viewport.scale)
  }, [viewport.scale, onViewportChange])

  // Первая подгонка, когда стали известны размеры и появились листы.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !layout.sheets.length || size.width < 50) return
    fitted.current = true
    fit()
  }, [fit, layout.sheets.length, size.width])

  // ------------------------------------------------------------ отрисовка

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    render(ctx, {
      layout: effective,
      viewport,
      width: size.width,
      height: size.height,
      selection,
      focusedPartId,
      hoveredInstance: hovered,
      collisions,
      presets: presetMap,
      showToolpaths,
      guides,
      marquee,
    })
  }, [
    effective,
    viewport,
    size,
    selection,
    focusedPartId,
    hovered,
    collisions,
    presetMap,
    showToolpaths,
    guides,
    marquee,
  ])

  // ------------------------------------------------------------ попадания

  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return [0, 0]
      return screenToWorld(viewport, size.width, size.height, [
        event.clientX - rect.left,
        event.clientY - rect.top,
      ])
    },
    [viewport, size],
  )

  const instanceAt = useCallback(
    (world: Point): InstanceView | null => {
      // Сверху вниз: последняя отрисованная деталь ловит клик первой.
      for (let i = effective.instances.length - 1; i >= 0; i--) {
        const instance = effective.instances[i]
        const part = effective.parts[String(instance.part_id)]
        if (!part) continue
        const placed = placeInstance(part, instance, effective.sheets)
        if (!placed) continue
        const [minX, minY, maxX, maxY] = placed.bbox
        if (world[0] < minX || world[0] > maxX || world[1] < minY || world[1] > maxY) continue
        if (pointInPolygon(world, placed.outer)) return instance
      }
      return null
    },
    [effective],
  )

  /** Вектор детали под курсором — работает только внутри выбранной детали. */
  const vectorAt = useCallback(
    (world: Point, partId: number): string | null => {
      const part = effective.parts[String(partId)]
      if (!part) return null
      // Допуск попадания в линию: в мировых миллиметрах, поэтому на любом
      // зуме мышью ловится одинаково легко.
      const tolerance = 6 / viewport.scale

      const instance = effective.instances.find((candidate) => {
        if (candidate.part_id !== partId) return false
        const placedCandidate = placeInstance(part, candidate, effective.sheets)
        if (!placedCandidate) return false
        const [ax, ay, bx, by] = placedCandidate.bbox
        return (
          world[0] >= ax - tolerance &&
          world[0] <= bx + tolerance &&
          world[1] >= ay - tolerance &&
          world[1] <= by + tolerance
        )
      })
      if (!instance) return null

      const placed = placeInstance(part, instance, effective.sheets)
      if (!placed) return null

      let best: { target: string; distance: number } | null = null
      const consider = (target: string, distance: number) => {
        if (distance > tolerance) return
        if (!best || distance < best.distance) best = { target, distance }
      }

      for (const op of placed.operations) {
        if (op.center && op.diameter) {
          const d = Math.abs(
            Math.hypot(world[0] - op.center[0], world[1] - op.center[1]) - op.diameter / 2,
          )
          consider(op.target, d)
        } else if (op.points?.length) {
          consider(op.target, distanceToPath(world, op.points, false))
        }
      }
      placed.inners.forEach((ring, index) => {
        consider(`inner:${index}`, distanceToPath(world, ring))
      })
      consider('outer', distanceToPath(world, placed.outer))

      // Клик внутри детали, но не по линии — это сама деталь, её внешний контур.
      if (best === null) return pointInPolygon(world, placed.outer) ? 'outer' : null
      return (best as { target: string; distance: number }).target
    },
    [effective, viewport.scale],
  )

  // ---------------------------------------------------------- перетаскивание

  const beginDrag = (event: React.MouseEvent) => {
    const world = toWorld(event)
    const panning = event.button === 1 || spaceHeld || event.altKey

    if (panning) {
      drag.current = {
        kind: 'pan',
        startScreen: [event.clientX, event.clientY],
        startWorld: world,
        origin: {},
        moved: false,
      }
      return
    }

    if (focusedPartId !== null) {
      const target = vectorAt(world, focusedPartId)
      if (target) {
        const key = vectorKey(focusedPartId, target)
        const next = event.shiftKey
          ? selection.vectors.includes(key)
            ? selection.vectors.filter((v) => v !== key)
            : [...selection.vectors, key]
          : [key]
        onSelectionChange({ instances: selection.instances, vectors: next })
        return
      }
    }

    const hit = instanceAt(world)
    if (!hit) {
      if (!event.shiftKey) {
        onSelectionChange({ instances: [], vectors: [] })
        onFocusPart(null)
      }
      const rect = canvasRef.current!.getBoundingClientRect()
      drag.current = {
        kind: 'marquee',
        startScreen: [event.clientX - rect.left, event.clientY - rect.top],
        startWorld: world,
        origin: {},
        moved: false,
      }
      setMarquee({
        x0: event.clientX - rect.left,
        y0: event.clientY - rect.top,
        x1: event.clientX - rect.left,
        y1: event.clientY - rect.top,
      })
      return
    }

    let instances = selection.instances
    if (event.shiftKey) {
      instances = instances.includes(hit.id)
        ? instances.filter((id) => id !== hit.id)
        : [...instances, hit.id]
    } else if (!instances.includes(hit.id)) {
      instances = [hit.id]
    }
    onSelectionChange({ instances, vectors: [] })

    const origin: Draft = {}
    for (const id of instances) {
      const instance = instancesById.get(id)
      if (instance && instance.x !== null && instance.y !== null && instance.sheet_index !== null) {
        origin[id] = { x: instance.x, y: instance.y, sheet_index: instance.sheet_index }
      }
    }
    drag.current = {
      kind: 'move',
      startScreen: [event.clientX, event.clientY],
      startWorld: world,
      origin,
      moved: false,
    }
  }

  const onMouseMove = (event: React.MouseEvent) => {
    const world = toWorld(event)
    const state = drag.current

    if (!state) {
      const hit = instanceAt(world)
      setHovered(hit ? hit.id : null)
      return
    }

    if (state.kind === 'pan') {
      const dx = (event.clientX - state.startScreen[0]) / viewport.scale
      const dy = (event.clientY - state.startScreen[1]) / viewport.scale
      state.startScreen = [event.clientX, event.clientY]
      setViewport((v) => ({ ...v, cx: v.cx - dx, cy: v.cy + dy }))
      state.moved = true
      return
    }

    if (state.kind === 'marquee') {
      const rect = canvasRef.current!.getBoundingClientRect()
      setMarquee((m) =>
        m ? { ...m, x1: event.clientX - rect.left, y1: event.clientY - rect.top } : m,
      )
      state.moved = true
      return
    }

    let dx = world[0] - state.startWorld[0]
    let dy = world[1] - state.startWorld[1]
    if (event.shiftKey) {
      // Shift — движение строго по одной оси, как в редакторах.
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }

    const next: Draft = {}
    const nextGuides: typeof guides = []
    const ids = Object.keys(state.origin).map(Number)

    for (const id of ids) {
      const start = state.origin[id]
      const instance = instancesById.get(id)
      const part = instance ? effective.parts[String(instance.part_id)] : undefined
      if (!instance || !part) continue

      let x = start.x + dx
      let y = start.y + dy
      let sheetIndex = start.sheet_index

      // Перенос между листами: смотрим, над каким листом оказался курсор.
      const [sox, soy] = sheetOrigin(effective.sheets, start.sheet_index)
      const under = sheetAt(effective.sheets, [sox + x, soy + y])
      if (under && under.index !== start.sheet_index) {
        const [nox, noy] = sheetOrigin(effective.sheets, under.index)
        x = sox + x - nox
        y = soy + y - noy
        sheetIndex = under.index
      }

      // Привязка только когда тащим одну деталь: иначе группа «разъезжается».
      if (ids.length === 1) {
        const sheet = effective.sheets.find((s) => s.index === sheetIndex)
        if (sheet) {
          const size2: [number, number] =
            Math.abs((instance.rotation ?? 0) % 180) === 90
              ? [part.width ?? 0, part.length ?? 0]
              : [part.length ?? 0, part.width ?? 0]
          const neighbours: Array<[number, number, number, number]> = []
          for (const other of effective.instances) {
            if (other.id === id || other.sheet_index !== sheetIndex) continue
            if (other.x === null || other.y === null) continue
            const otherPart = effective.parts[String(other.part_id)]
            if (!otherPart) continue
            const ow =
              Math.abs((other.rotation ?? 0) % 180) === 90
                ? otherPart.width ?? 0
                : otherPart.length ?? 0
            const oh =
              Math.abs((other.rotation ?? 0) % 180) === 90
                ? otherPart.length ?? 0
                : otherPart.width ?? 0
            neighbours.push([other.x, other.y, ow, oh])
          }
          const snapped = snapPosition(x, y, size2, sheet, neighbours, gap, 12 / viewport.scale)
          x = snapped.x
          y = snapped.y
          for (const guide of snapped.guides) {
            nextGuides.push({ ...guide, sheetIndex })
          }
        }
      }

      next[id] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, sheet_index: sheetIndex }
    }

    state.moved = true
    setDraft(next)
    setGuides(nextGuides)
  }

  const endDrag = () => {
    const state = drag.current
    drag.current = null
    setGuides([])

    if (!state) return

    if (state.kind === 'marquee') {
      const m = marquee
      setMarquee(null)
      if (m && state.moved) {
        const a = screenToWorld(viewport, size.width, size.height, [
          Math.min(m.x0, m.x1),
          Math.max(m.y0, m.y1),
        ])
        const b = screenToWorld(viewport, size.width, size.height, [
          Math.max(m.x0, m.x1),
          Math.min(m.y0, m.y1),
        ])
        const picked: number[] = []
        for (const instance of effective.instances) {
          const part = effective.parts[String(instance.part_id)]
          if (!part) continue
          const placed = placeInstance(part, instance, effective.sheets)
          if (!placed) continue
          const [minX, minY, maxX, maxY] = placed.bbox
          if (minX >= a[0] && maxX <= b[0] && minY >= a[1] && maxY <= b[1]) {
            picked.push(instance.id)
          }
        }
        if (picked.length) onSelectionChange({ instances: picked, vectors: [] })
      }
      return
    }

    if (state.kind === 'move' && state.moved && Object.keys(draft).length) {
      onMove(
        Object.entries(draft).map(([id, value]) => ({
          instance_id: Number(id),
          x: value.x,
          y: value.y,
          sheet_index: value.sheet_index,
          pinned: true,
        })),
      )
      setDraft({})
    }
  }

  // ------------------------------------------------------------------ зум

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const screen: Point = [event.clientX - rect.left, event.clientY - rect.top]
    const before = screenToWorld(viewport, size.width, size.height, screen)
    const factor = Math.exp(-event.deltaY * 0.0015)
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * factor))
    const after = screenToWorld({ ...viewport, scale }, size.width, size.height, screen)
    // Зум «в точку под курсором»: мир под указателем не должен уезжать.
    setViewport({
      cx: viewport.cx + (before[0] - after[0]),
      cy: viewport.cy + (before[1] - after[1]),
      scale,
    })
  }

  const onDoubleClick = (event: React.MouseEvent) => {
    const world = toWorld(event)
    const hit = instanceAt(world)
    if (hit) {
      // Вход внутрь детали — дальше выделяются её векторы, как в Figma.
      onFocusPart(hit.part_id)
      const target = vectorAt(world, hit.part_id)
      onSelectionChange({
        instances: [hit.id],
        vectors: target ? [vectorKey(hit.part_id, target)] : [],
      })
    } else {
      onFocusPart(null)
    }
  }

  // ----------------------------------------------------------- клавиатура

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (event.code === 'Space') {
        setSpaceHeld(true)
        event.preventDefault()
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const cursor = spaceHeld ? 'grab' : hovered ? 'move' : 'default'

  return (
    <div
      className={`stage${dragOver ? ' drag-over' : ''}`}
      ref={wrapRef}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        const files = Array.from(event.dataTransfer.files)
        if (files.length) onDropFiles(files)
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor }}
        onMouseDown={beginDrag}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
      {dragOver && (
        <div className="stage-drop">
          <b>Отпустите — файлы попадут в раскрой</b>
          <span>DXF · ZIP · спецификация</span>
        </div>
      )}
    </div>
  )
})

export default CanvasStage
