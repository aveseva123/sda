import { rotatedSize } from '../../editor/geometry'
import type { Layout, Selection } from '../../editor/types'
import type { Move } from './CanvasStage'

interface Props {
  layout: Layout
  selection: Selection
  onMove: (moves: Move[]) => void
  onCompact: () => void
  busy: boolean
}

type Edge = 'left' | 'center' | 'right' | 'top' | 'bottom'

interface Box {
  id: number
  sheet: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Выравнивание и распределение — то, чем расставляют объекты в векторном
 * редакторе. Автораскладка даёт стартовую точку, но последнее слово за
 * технологом: он знает, что этот лист пойдёт на пильный стол первым.
 *
 * Всё считается внутри листа: выравнивать детали с разных листов бессмысленно.
 */
export default function AlignBar({ layout, selection, onMove, onCompact, busy }: Props) {
  const boxes: Box[] = []
  for (const instance of layout.instances) {
    if (!selection.instances.includes(instance.id)) continue
    if (instance.sheet_index === null || instance.x === null || instance.y === null) continue
    const part = layout.parts[String(instance.part_id)]
    if (!part) continue
    const [w, h] = rotatedSize(part, instance.rotation ?? 0)
    boxes.push({
      id: instance.id,
      sheet: instance.sheet_index,
      x: instance.x,
      y: instance.y,
      w,
      h,
    })
  }

  const enough = boxes.length >= 2 && !busy
  const bySheet = () => {
    const map = new Map<number, Box[]>()
    for (const box of boxes) map.set(box.sheet, [...(map.get(box.sheet) ?? []), box])
    return map
  }

  const align = (edge: Edge) => {
    const moves: Move[] = []
    for (const group of bySheet().values()) {
      if (group.length < 2) continue
      const minX = Math.min(...group.map((b) => b.x))
      const maxX = Math.max(...group.map((b) => b.x + b.w))
      const minY = Math.min(...group.map((b) => b.y))
      const maxY = Math.max(...group.map((b) => b.y + b.h))
      for (const box of group) {
        const move: Move = { instance_id: box.id, pinned: true }
        if (edge === 'left') move.x = minX
        if (edge === 'right') move.x = maxX - box.w
        if (edge === 'center') move.x = (minX + maxX) / 2 - box.w / 2
        if (edge === 'bottom') move.y = minY
        if (edge === 'top') move.y = maxY - box.h
        moves.push(move)
      }
    }
    onMove(moves)
  }

  /** Равные промежутки между деталями — не равные шаги центров. */
  const distribute = (axis: 'x' | 'y') => {
    const moves: Move[] = []
    for (const group of bySheet().values()) {
      if (group.length < 3) continue
      const sorted = [...group].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const span =
        axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y
      const used = sorted.reduce((sum, box) => sum + (axis === 'x' ? box.w : box.h), 0)
      const gap = (span - used) / (sorted.length - 1)
      let cursor = axis === 'x' ? first.x : first.y
      for (const box of sorted) {
        moves.push(
          axis === 'x'
            ? { instance_id: box.id, x: cursor, pinned: true }
            : { instance_id: box.id, y: cursor, pinned: true },
        )
        cursor += (axis === 'x' ? box.w : box.h) + gap
      }
    }
    onMove(moves)
  }

  const rotate = (delta: number) => {
    const moves: Move[] = layout.instances
      .filter((i) => selection.instances.includes(i.id))
      .map((i) => ({
        instance_id: i.id,
        rotation: ((i.rotation ?? 0) + delta + 360) % 360,
        pinned: true,
      }))
    onMove(moves)
  }

  const pin = (pinned: boolean) => {
    onMove(
      layout.instances
        .filter((i) => selection.instances.includes(i.id))
        .map((i) => ({ instance_id: i.id, pinned })),
    )
  }

  const some = boxes.length > 0 && !busy

  return (
    <div className="align-bar">
      <button
        type="button"
        className="tool"
        title="Выровнять по левому краю"
        disabled={!enough}
        onClick={() => align('left')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2.5 2v12" />
          <rect x="5" y="3.5" width="8" height="3.5" rx=".8" />
          <rect x="5" y="9" width="5" height="3.5" rx=".8" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Выровнять по центру"
        disabled={!enough}
        onClick={() => align('center')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M8 2v12" />
          <rect x="3" y="3.5" width="10" height="3.5" rx=".8" />
          <rect x="5" y="9" width="6" height="3.5" rx=".8" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Выровнять по правому краю"
        disabled={!enough}
        onClick={() => align('right')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M13.5 2v12" />
          <rect x="3" y="3.5" width="8" height="3.5" rx=".8" />
          <rect x="6" y="9" width="5" height="3.5" rx=".8" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Выровнять по верху"
        disabled={!enough}
        onClick={() => align('top')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 2.5h12" />
          <rect x="3.5" y="5" width="3.5" height="8" rx=".8" />
          <rect x="9" y="5" width="3.5" height="5" rx=".8" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Выровнять по низу"
        disabled={!enough}
        onClick={() => align('bottom')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 13.5h12" />
          <rect x="3.5" y="3" width="3.5" height="8" rx=".8" />
          <rect x="9" y="6" width="3.5" height="5" rx=".8" />
        </svg>
      </button>

      <div className="sep" />

      <button
        type="button"
        className="tool"
        title="Распределить по горизонтали (нужны минимум три детали)"
        disabled={boxes.length < 3 || busy}
        onClick={() => distribute('x')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1.5" y="4" width="3" height="8" rx=".8" />
          <rect x="6.5" y="4" width="3" height="8" rx=".8" />
          <rect x="11.5" y="4" width="3" height="8" rx=".8" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Распределить по вертикали (нужны минимум три детали)"
        disabled={boxes.length < 3 || busy}
        onClick={() => distribute('y')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="4" y="1.5" width="8" height="3" rx=".8" />
          <rect x="4" y="6.5" width="8" height="3" rx=".8" />
          <rect x="4" y="11.5" width="8" height="3" rx=".8" />
        </svg>
      </button>

      <div className="sep" />

      <button
        type="button"
        className="tool"
        title="Повернуть на 90° (клавиша R)"
        disabled={!some}
        onClick={() => rotate(90)}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2v3h-3" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Закрепить: автораскладка эти детали не двигает"
        disabled={!some}
        onClick={() => pin(true)}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M6 2h4l-.5 4 2.5 2v1H4V8l2.5-2z" />
          <path d="M8 9v5" />
        </svg>
      </button>
      <button
        type="button"
        className="tool"
        title="Открепить"
        disabled={!some}
        onClick={() => pin(false)}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M6 2h4l-.5 4 2.5 2v1H4V8l2.5-2z" />
          <path d="M2.5 13.5 13.5 2.5" />
        </svg>
      </button>

      <div className="sep" />

      {/* Кнопка пересчитывает ВСЁ задание, по всем листам, оставляя на местах
          закреплённые детали. Подпись «лист» врала про область действия. */}
      <button
        type="button"
        className="primary go"
        disabled={busy}
        onClick={onCompact}
        title="Пересчитать весь раскрой, оставив закреплённые детали на местах"
      >
        Уплотнить, не трогая закреплённые
      </button>
    </div>
  )
}
