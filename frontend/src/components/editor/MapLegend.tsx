import { useMemo, useState } from 'react'

import { vectorStyle } from '../../editor/palette'
import type { Layout } from '../../editor/types'

interface FileRow {
  id: number
  color: string
  name: string
  count: number
}

interface Props {
  layout: Layout
  files: FileRow[]
}

/**
 * Что означает каждая линия. Пояснения — словами цеха, а не кодами.
 *
 * Порядок тот же, в каком идёт обработка: сначала мелкое и неглубокое, контур
 * последним. Так легенда заодно напоминает порядок резания.
 */
const LINES: Array<{ semantic: string; title: string; means: string }> = [
  { semantic: 'DRILL', title: 'Присадка', means: 'отверстия под фурнитуру, на глубину' },
  { semantic: 'GROOVE', title: 'Паз', means: 'канавка на глубину: задняя стенка, полкодержатель' },
  { semantic: 'POCKET', title: 'Выборка', means: 'карман: выбирается площадь на глубину' },
  { semantic: 'INNER', title: 'Внутренний вырез', means: 'проём внутри детали, насквозь' },
  { semantic: 'OUTER', title: 'Контур', means: 'рез насквозь по краю детали, режется последним' },
  { semantic: 'MARK', title: 'Разметка', means: 'гравировка: метка, номер, надпись' },
]

/** Образец линии — ровно тем же цветом, штрихом и толщиной, что и на карте. */
function LineSample({ semantic }: { semantic: string }) {
  const style = vectorStyle(semantic)
  if (semantic === 'DRILL') {
    return (
      <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden style={{ flex: 'none' }}>
        <circle cx="7" cy="5" r="2.6" fill="none" stroke={style.color} strokeWidth={style.width} />
        <circle cx="16" cy="5" r="2.6" fill="none" stroke={style.color} strokeWidth={style.width} />
      </svg>
    )
  }
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden style={{ flex: 'none' }}>
      <line
        x1="1"
        y1="5.5"
        x2="21"
        y2="5.5"
        stroke={style.color}
        strokeWidth={style.width}
        strokeDasharray={style.dash.length ? style.dash.join(' ') : undefined}
      />
    </svg>
  )
}

function SheetSample({ kind }: { kind: 'edge' | 'trim' | 'rest' }) {
  const stroke =
    kind === 'rest' ? 'var(--sheet-edge)' : kind === 'trim' ? 'var(--sheet-trim)' : 'var(--sheet-edge)'
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden style={{ flex: 'none' }}>
      {kind === 'rest' && <rect x="1" y="1.5" width="20" height="7" fill="var(--rest-fill)" />}
      <rect
        x="1.5"
        y="1.5"
        width="19"
        height="7"
        fill="none"
        stroke={stroke}
        strokeWidth="1"
        strokeDasharray={kind === 'edge' ? undefined : '3 2'}
      />
    </svg>
  )
}

/**
 * Легенда карты раскроя.
 *
 * Раньше на холсте была подсказка только о том, ЧЬИ детали лежат на листе.
 * Что означает каждая линия — цвет паза, присадки, выреза — не объяснялось
 * нигде: оператор либо знал, либо гадал. Легенда показывает только те типы,
 * которые на этом листе действительно есть, — иначе она превращается в
 * справочник, который перестают читать.
 */
export default function MapLegend({ layout, files }: Props) {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem('nestor.legend') !== 'closed'
    } catch {
      return true
    }
  })

  const toggle = () => {
    setOpen((prev) => {
      try {
        window.localStorage.setItem('nestor.legend', prev ? 'closed' : 'open')
      } catch {
        /* приватное окно — просто не запомним */
      }
      return !prev
    })
  }

  // Типы операций, которые реально есть на этом листе.
  const present = useMemo(() => {
    const kinds = new Set<string>()
    for (const instance of layout.instances) {
      if (instance.sheet_index === null) continue
      const part = layout.parts[String(instance.part_id)]
      if (!part?.geometry) continue
      kinds.add('OUTER')
      if (part.geometry.inners?.length) kinds.add('INNER')
      for (const op of part.geometry.operations ?? []) kinds.add(op.semantic)
    }
    return LINES.filter((line) => kinds.has(line.semantic))
  }, [layout])

  const hasRest = layout.sheets.length > 0

  return (
    <div className={`legend${open ? '' : ' closed'}`}>
      <button type="button" className="legend-head" onClick={toggle}>
        <span className="lbl">Что на карте</span>
        <span className="legend-chevron">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="legend-body">
          {present.length > 0 && (
            <>
              <div className="legend-section">Линии</div>
              <div className="legend-rule">
                Сплошная — насквозь, штриховая — на глубину, кружок — отверстие.
              </div>
              {present.map((line) => (
                <div className="legend-row" key={line.semantic} title={line.means}>
                  <LineSample semantic={line.semantic} />
                  <span className="grow">{line.title}</span>
                </div>
              ))}
            </>
          )}

          <div className="legend-section">Лист</div>
          <div className="legend-row" title="Край листа материала">
            <SheetSample kind="edge" />
            <span className="grow">Край листа</span>
          </div>
          <div className="legend-row" title="Обрезка кромок: сюда деталь не ставится">
            <SheetSample kind="trim" />
            <span className="grow">Обрезка кромок</span>
          </div>
          {hasRest && (
            <div className="legend-row" title="Свободная полоса: пойдёт в деловой обрезок или в отход">
              <SheetSample kind="rest" />
              <span className="grow">Остаток листа</span>
            </div>
          )}

          {files.length > 0 && (
            <>
              <div className="legend-section">Детали на листе</div>
              {files.map((row) => (
                <div className="legend-row" key={row.id}>
                  <span className="swatch" style={{ background: row.color }} />
                  <span className="mono ellipsis grow">{row.name}</span>
                  <span className="legend-count mono">{row.count}</span>
                </div>
              ))}
              <div className="legend-note">
                Штриховка — второй и следующий листы внутри одного файла.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
