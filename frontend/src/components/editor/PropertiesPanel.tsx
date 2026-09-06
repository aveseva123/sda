import { useEffect, useMemo, useState } from 'react'

import type { Collision, Layout, Selection, ToolpathPreset, VectorView } from '../../editor/types'
import { vectorKey } from '../../editor/types'
import type { Move } from './CanvasStage'

interface Props {
  layout: Layout
  selection: Selection
  presets: ToolpathPreset[]
  collisions: Collision[]
  onMove: (moves: Move[]) => void
  onSelectionChange: (selection: Selection) => void
  onFocusPart: (partId: number | null) => void
  onAssignToolpath: (partId: number, targets: string[], presetId: number) => void
  onToggleVector: (partId: number, targets: string[], enabled: boolean) => void
}

/** Итоговая глубина: слой → насквозь → фиксированная. Та же логика, что на сервере. */
function resolveDepth(
  preset: ToolpathPreset | undefined,
  layerDepth: number | null,
  thickness: number | null,
): number | null {
  if (!preset) return null
  const spec = (preset.depth ?? {}) as Record<string, unknown>
  const mode = String(spec.mode ?? 'fixed')
  const overcut = Number(spec.overcut ?? 0)
  const through = thickness === null ? null : Math.round((thickness + overcut) * 1000) / 1000

  if (mode === 'from_layer') {
    if (layerDepth !== null && layerDepth !== undefined) return layerDepth
    if (String(spec.fallback ?? 'through') === 'through') return through
    return spec.value === undefined ? null : Number(spec.value)
  }
  if (mode === 'through') return through
  return spec.value === undefined ? null : Number(spec.value)
}

/**
 * Координата детали: правка применяется по Enter или по уходу из поля.
 *
 * Раньше поле стояло на onChange, и каждый набранный символ уезжал на сервер
 * отдельным перемещением: «125» — это три запроса, три перерисовки и три
 * шага в истории отмены, а стёртое поле мгновенно означало ноль.
 */
function CoordField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number | null
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setText(value === null ? '' : String(Math.round(value * 10) / 10))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    const next = Number(text.replace(',', '.'))
    if (text.trim() === '' || Number.isNaN(next) || next === value) {
      setText(value === null ? '' : String(Math.round(value * 10) / 10))
      return
    }
    onCommit(next)
  }

  return (
    <label className="fld">
      <span>{label}</span>
      <input
        inputMode="decimal"
        disabled={value === null}
        value={value === null ? 'не размещена' : text}
        onFocus={() => setEditing(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setEditing(false)
            setText(value === null ? '' : String(value))
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

/** Значок операции — по типу, распознанному из геометрии вектора. */
function OpIcon({ semantic, bright }: { semantic: string; bright: boolean }) {
  const stroke = bright ? '#E8EAED' : '#9AA3AF'
  const common = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke, strokeWidth: 1.5 }
  if (semantic === 'DRILL') {
    return (
      <svg {...common} style={{ flex: 'none' }}>
        <circle cx="4.5" cy="4.5" r="2" />
        <circle cx="11.5" cy="4.5" r="2" />
        <circle cx="4.5" cy="11.5" r="2" />
        <circle cx="11.5" cy="11.5" r="2" />
      </svg>
    )
  }
  if (semantic === 'GROOVE') {
    return (
      <svg {...common} style={{ flex: 'none' }}>
        <path d="M2.5 8h11" />
        <path d="M2.5 5.5v5M13.5 5.5v5" />
      </svg>
    )
  }
  if (semantic === 'POCKET') {
    return (
      <svg {...common} style={{ flex: 'none' }}>
        <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
        <rect x="5" y="6" width="6" height="4" rx=".8" />
      </svg>
    )
  }
  if (semantic === 'INNER') {
    return (
      <svg {...common} style={{ flex: 'none' }}>
        <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
        <path d="M6 6h4v4H6z" />
      </svg>
    )
  }
  return (
    <svg {...common} style={{ flex: 'none' }}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    </svg>
  )
}

/** Типы фрез из конфига — по-русски, как их называют в цеху. */
const TOOL_LABEL: Record<string, string> = {
  compression: 'компрес.',
  spiral: 'спиральная',
  straight: 'прямая',
  groove: 'пазовая',
  drill: 'сверло',
  vbit: 'гравёр',
  saw: 'пила',
}

const GRAIN_LABEL: Record<string, string> = {
  none: '—',
  along: '↔',
  across: '↕',
  any: '—',
}

/**
 * Правая панель: положение детали и её траектории.
 *
 * Словарь параметров — из ArtCAM, но это не диалог на каждую траекторию:
 * значения приходят из пресета материала, а панель показывает, что именно
 * из него получилось, и даёт переназначить вручную.
 */
export default function PropertiesPanel({
  layout,
  selection,
  presets,
  collisions,
  onMove,
  onSelectionChange,
  onFocusPart,
  onAssignToolpath,
  onToggleVector,
}: Props) {
  const instances = useMemo(
    () => layout.instances.filter((i) => selection.instances.includes(i.id)),
    [layout.instances, selection.instances],
  )

  const single = instances.length === 1 ? instances[0] : null
  const part = single ? layout.parts[String(single.part_id)] : null

  // Выделенные векторы, сгруппированные по детали: назначение идёт на деталь.
  const vectorsByPart = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const key of selection.vectors) {
      const [partId, ...rest] = key.split(':')
      const target = rest.join(':')
      const list = map.get(Number(partId)) ?? []
      list.push(target)
      map.set(Number(partId), list)
    }
    return map
  }, [selection.vectors])

  const [activeTarget, setActiveTarget] = useState<string | null>(null)
  useEffect(() => {
    setActiveTarget(selection.vectors.length ? selection.vectors[0].split(':').slice(1).join(':') : null)
  }, [selection.vectors])

  const [presetChoice, setPresetChoice] = useState<string>('')

  // Одинаковые операции показываются одной строкой со счётчиком: двенадцать
  // строк «Присадка ⌀4» — это не список, а стена, и стратегию к ним всё
  // равно применяют разом.
  const groups = useMemo(() => {
    const map = new Map<string, { title: string; semantic: string; targets: string[]; sample: VectorView }>()
    for (const vector of part?.vectors ?? []) {
      // «Выборка 1…14» — это одна и та же операция с номерами: в группу их
      // сводит не название, а тип, глубина, диаметр и назначенная стратегия.
      const title = vector.title.replace(/\s\d+$/, '')
      const key = [
        title,
        vector.semantic,
        vector.diameter ?? '',
        vector.depth ?? '',
        vector.preset_id ?? '—',
        vector.enabled,
      ].join('|')
      const row = map.get(key) ?? {
        title,
        semantic: vector.semantic,
        targets: [],
        sample: vector,
      }
      row.targets.push(vector.target)
      map.set(key, row)
    }
    return [...map.values()]
  }, [part])

  const problems = collisions.filter((c) =>
    c.instance_ids.some((id) => selection.instances.includes(id)),
  )

  if (!instances.length && !vectorsByPart.size) {
    return (
      <div className="panel-scroll">
        <div className="panel-title">Объект</div>
        <div className="empty small">Выберите деталь на листе.</div>
      </div>
    )
  }

  if (!part) {
    return (
      <div className="panel-scroll">
        <div className="sec">
          <div className="sec-head">
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              Выделено деталей: {instances.length}
            </span>
          </div>
          <div className="small muted">
            Общие действия — на нижней панели: выравнивание, распределение, поворот.
          </div>
        </div>
        <div className="sec">
          <div className="row tight">
            <button
              type="button"
              onClick={() =>
                onMove(instances.map((i) => ({ instance_id: i.id, pinned: true })))
              }
            >
              Закрепить
            </button>
            <button
              type="button"
              onClick={() =>
                onMove(instances.map((i) => ({ instance_id: i.id, pinned: false })))
              }
            >
              Открепить
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Деталь без листа не размещена: показывать её координаты нулями — врать.
  const placed = single ? single.sheet_index !== null && single.x !== null : false
  const rotation = single?.rotation ?? 0
  const width = Math.abs(rotation % 180) === 90 ? part.width : part.length
  const height = Math.abs(rotation % 180) === 90 ? part.length : part.width

  const vectors: VectorView[] = part.vectors
  const active = vectors.find((v) => v.target === activeTarget) ?? null
  const activeGroup = groups.find((g) => g.targets.includes(activeTarget ?? '')) ?? null
  const activePreset = active?.preset_id
    ? presets.find((p) => p.id === active.preset_id)
    : undefined
  const activeDepth = resolveDepth(activePreset, active?.depth ?? null, part.thickness)
  const snapshot = layout.job.preset_snapshot
  const strategy = (snapshot?.strategy ?? {}) as Record<string, unknown>
  const depthSpec = (snapshot?.depth ?? {}) as Record<string, number>
  const lead = (strategy.lead ?? {}) as Record<string, unknown>
  const order = snapshot?.order ?? []

  const setField = (field: 'x' | 'y' | 'rotation', value: number) => {
    if (!single) return
    onMove([{ instance_id: single.id, [field]: value, pinned: true } as Move])
  }

  const pickGroup = (targets: string[]) => {
    setActiveTarget(targets[0])
    onFocusPart(part.id)
    onSelectionChange({
      instances: selection.instances,
      vectors: targets.map((target) => vectorKey(part.id, target)),
    })
  }

  return (
    <div className="panel-scroll">
      <div className="sec">
        <div className="sec-head" style={{ marginBottom: 3 }}>
          <span className="swatch" style={{ background: part.style?.fill ?? '#9AA3AF' }} />
          <span className="ellipsis grow" style={{ fontSize: 14, fontWeight: 600 }} title={part.name}>
            {part.name}
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            {vectors.length} вект.
          </span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {part.source_file ?? 'без файла'}
          {part.source_sheet_index > 0 && ` · лист ${part.source_sheet_index + 1} в файле`}
          {part.order_name ? ` · ${part.order_name}` : ''}
        </div>
      </div>

      {!!problems.length && (
        <div className="sec">
          {problems.map((problem, index) => (
            <div className="notice error small" key={index} style={{ marginBottom: 0 }}>
              {problem.message}
            </div>
          ))}
        </div>
      )}

      <div className="sec">
        <div className="lbl" style={{ marginBottom: 9 }}>
          Положение на листе
        </div>
        {placed ? null : (
          <div className="notice warn small" style={{ marginBottom: 9 }}>
            Деталь не разместилась ни на одном листе. Раньше в полях X и Y у неё
            стояли нули — как будто она лежит в углу.
          </div>
        )}
        <div className="fld-grid">
          {/* Ввод отправляется по Enter или уходу из поля. Раньше запрос летел
              на каждое нажатие: «125» — это три перемещения детали, три
              обращения к серверу и три шага в стеке отмены. */}
          <CoordField
            label="X, мм"
            value={placed ? (single?.x ?? null) : null}
            onCommit={(next) => setField('x', next)}
          />
          <CoordField
            label="Y, мм"
            value={placed ? (single?.y ?? null) : null}
            onCommit={(next) => setField('y', next)}
          />
          <div className="fld">
            <span>Ширина, мм</span>
            <div className="fld-value mono">{width?.toFixed(0) ?? '—'}</div>
          </div>
          <div className="fld">
            <span>Высота, мм</span>
            <div className="fld-value mono">{height?.toFixed(0) ?? '—'}</div>
          </div>
          <label className="fld">
            <span>Поворот</span>
            <select
              value={rotation}
              style={{ border: 'none', background: 'transparent', padding: 0, width: '100%' }}
              onChange={(event) => setField('rotation', Number(event.target.value))}
            >
              {[0, 90, 180, 270].map((angle) => (
                <option key={angle} value={angle}>
                  {angle}°
                </option>
              ))}
            </select>
          </label>
          <div className="fld" title={layout.job.has_grain ? 'Материал с текстурой' : 'Материал без текстуры'}>
            <span>Волокно</span>
            {GRAIN_LABEL[part.grain] ?? part.grain}
          </div>
        </div>
        {layout.job.has_grain && part.grain !== 'none' && (
          <div className="small muted" style={{ marginTop: 8 }}>
            Поперёк волокна деталь класть нельзя: автораскладка использует только
            0° и 180°.
          </div>
        )}
      </div>

      <div className="sec">
        <div className="sec-head">
          <span className="lbl">Траектории</span>
          {order.length > 0 && (
            <span
              className="mono"
              style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-3)' }}
              title={`Порядок обработки из пресета: ${order.join(' → ')}`}
            >
              контур последним
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {groups.map((group) => {
            const vector = group.sample
            const preset = presets.find((p) => p.id === vector.preset_id)
            const isActive = group.targets.includes(activeTarget ?? '')
            const depth = resolveDepth(preset, vector.depth, part.thickness)
            return (
              <button
                type="button"
                key={group.title + group.targets[0]}
                className={`op${isActive ? ' on' : ''}${vector.enabled ? '' : ' off'}`}
                onClick={() => pickGroup(group.targets)}
              >
                <OpIcon semantic={group.semantic} bright={isActive} />
                <span className="grow ellipsis" style={{ textAlign: 'left' }}>
                  {group.title}
                </span>
                {group.targets.length > 1 && (
                  <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                    ×{group.targets.length}
                  </span>
                )}
                {preset && !vector.assigned_manually && <span className="badge auto">АВТО</span>}
                {!preset && <span className="badge warn">нет</span>}
                <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 11 }}>
                  {vector.diameter
                    ? `⌀${vector.diameter}`
                    : depth !== null
                      ? `${String(depth).replace('.', ',')} мм`
                      : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {active && (
        <div className="sec">
          <div className="lbl" style={{ marginBottom: 9 }}>
            {active.title}
            {activeGroup && activeGroup.targets.length > 1 && ` · ${activeGroup.targets.length} шт.`}
          </div>
          <div className="params">
            <span>Инструмент</span>
            <span>
              {activePreset?.tool_diameter
                ? `${
                    TOOL_LABEL[activePreset.tool_type ?? ''] ?? activePreset.tool_type ?? 'фреза'
                  } ⌀${activePreset.tool_diameter}`
                : 'из пресета материала'}
            </span>
            <span>Глубина</span>
            <span>{activeDepth === null ? '—' : `${String(activeDepth).replace('.', ',')} мм`}</span>
            <span>Проходы</span>
            <span>
              {activeDepth && depthSpec.step_z
                ? `${Math.ceil(activeDepth / depthSpec.step_z)} × ${String(depthSpec.step_z).replace('.', ',')} мм`
                : '—'}
            </span>
            <span>Подрез</span>
            <span>
              {depthSpec.end_extra
                ? `${String(depthSpec.end_extra).replace('.', ',')} мм в стол`
                : 'нет'}
            </span>
            <span>Заход</span>
            <span>
              {lead.type === 'arc' ? `дуга R${lead.radius ?? '—'}` : 'по нормали'}
            </span>
            <span>Обход</span>
            <span>{strategy.direction === 'conventional' ? 'встречный' : 'попутный'}</span>
            <span>Коррекция</span>
            <span>{strategy.compensation === 'g41g42' ? 'стойкой G41/G42' : 'в CAM'}</span>
          </div>

          <div className="row tight" style={{ marginTop: 10 }}>
            <select
              className="grow"
              value={presetChoice}
              onChange={(event) => setPresetChoice(event.target.value)}
            >
              <option value="">— сменить стратегию —</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.tool_diameter ? ` · ⌀${preset.tool_diameter}` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!presetChoice}
              onClick={() => {
                const targets = selection.vectors.length
                  ? [...vectorsByPart.entries()]
                  : ([[part.id, activeGroup?.targets ?? [active.target]]] as Array<[number, string[]]>)
                for (const [partId, list] of targets) {
                  onAssignToolpath(partId, list, Number(presetChoice))
                }
              }}
            >
              Применить
            </button>
          </div>
          <label className="row tight small muted" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={active.enabled}
              onChange={(event) =>
                onToggleVector(part.id, activeGroup?.targets ?? [active.target], event.target.checked)
              }
            />
            Обрабатывать этот вектор
          </label>
        </div>
      )}

      <div style={{ padding: '12px 14px', marginTop: 'auto' }}>
        <div className="row tight">
          <button
            type="button"
            className="grow"
            title={
              single?.pinned
                ? 'Пересчёт сможет двигать эту деталь'
                : 'Пересчёт оставит эту деталь на месте'
            }
            onClick={() => single && onMove([{ instance_id: single.id, pinned: !single.pinned }])}
          >
            {single?.pinned ? 'Открепить' : 'Закрепить на месте'}
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Тип операции определён по геометрии вектора, а не по слою. Любую можно
          переназначить вручную.
        </div>
      </div>
    </div>
  )
}
