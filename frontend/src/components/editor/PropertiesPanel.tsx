import { useMemo, useState } from 'react'

import type { Collision, Layout, Selection, ToolpathPreset } from '../../editor/types'
import type { Move } from './CanvasStage'

interface Props {
  layout: Layout
  selection: Selection
  presets: ToolpathPreset[]
  collisions: Collision[]
  onMove: (moves: Move[]) => void
  onAssignToolpath: (partId: number, targets: string[], presetId: number) => void
  onToggleVector: (partId: number, targets: string[], enabled: boolean) => void
}

const ROTATIONS = [0, 90, 180, 270]

/** Итоговая глубина: слой -> насквозь -> фиксированная. Та же логика, что на сервере. */
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

export default function PropertiesPanel({
  layout,
  selection,
  presets,
  collisions,
  onMove,
  onAssignToolpath,
  onToggleVector,
}: Props) {
  const [presetChoice, setPresetChoice] = useState<string>('')

  const instances = useMemo(
    () => layout.instances.filter((i) => selection.instances.includes(i.id)),
    [layout.instances, selection.instances],
  )

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

  const problems = collisions.filter((c) =>
    c.instance_ids.some((id) => selection.instances.includes(id)),
  )

  if (!instances.length && !vectorsByPart.size) {
    return (
      <div className="panel-scroll">
        <div className="panel-title">Свойства</div>
        <div className="empty small">
          Ничего не выделено.
          <br />
          Кликните по детали, чтобы её выбрать. Двойной клик — вход внутрь детали:
          там выделяются отдельные векторы, и к ним применяются траектории.
        </div>
      </div>
    )
  }

  const rotate = (angle: number) =>
    onMove(instances.map((i) => ({ instance_id: i.id, rotation: angle, pinned: true })))

  const rotateBy = (delta: number) =>
    onMove(
      instances.map((i) => ({
        instance_id: i.id,
        rotation: ((i.rotation ?? 0) + delta + 360) % 360,
        pinned: true,
      })),
    )

  const setPinned = (pinned: boolean) =>
    onMove(instances.map((i) => ({ instance_id: i.id, pinned })))

  const single = instances.length === 1 ? instances[0] : null
  const singlePart = single ? layout.parts[String(single.part_id)] : null

  return (
    <div className="panel-scroll">
      <div className="panel-title">Свойства</div>

      {!!problems.length && (
        <div className="notice error small">
          {problems.map((p, index) => (
            <div key={index}>{p.message}</div>
          ))}
        </div>
      )}

      {!!instances.length && (
        <>
          <div className="prop-block">
            <div className="prop-head">
              {instances.length === 1
                ? singlePart?.name ?? 'Деталь'
                : `Выделено деталей: ${instances.length}`}
            </div>
            {singlePart && (
              <div className="small muted">
                {singlePart.project_name} · {singlePart.product_name}
                <br />
                {singlePart.length?.toFixed(1)} × {singlePart.width?.toFixed(1)} ×{' '}
                {singlePart.thickness ?? '—'} мм
                {singlePart.grain !== 'none' && ' · с текстурой'}
              </div>
            )}
          </div>

          {single && (
            <div className="prop-block">
              <div className="row tight">
                <label className="field">
                  X, мм
                  <input
                    type="number"
                    step={0.1}
                    value={single.x ?? 0}
                    onChange={(event) =>
                      onMove([
                        { instance_id: single.id, x: Number(event.target.value), pinned: true },
                      ])
                    }
                  />
                </label>
                <label className="field">
                  Y, мм
                  <input
                    type="number"
                    step={0.1}
                    value={single.y ?? 0}
                    onChange={(event) =>
                      onMove([
                        { instance_id: single.id, y: Number(event.target.value), pinned: true },
                      ])
                    }
                  />
                </label>
              </div>
              <label className="field" style={{ marginTop: 8 }}>
                Лист
                <select
                  value={single.sheet_index ?? ''}
                  onChange={(event) =>
                    onMove([
                      {
                        instance_id: single.id,
                        sheet_index: Number(event.target.value),
                        pinned: true,
                      },
                    ])
                  }
                >
                  {layout.sheets.map((sheet) => (
                    <option key={sheet.index} value={sheet.index}>
                      Лист {sheet.index + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="prop-block">
            <div className="prop-label">Поворот</div>
            <div className="row tight">
              {ROTATIONS.map((angle) => (
                <button
                  key={angle}
                  type="button"
                  className={single && (single.rotation ?? 0) === angle ? 'primary' : ''}
                  onClick={() => rotate(angle)}
                >
                  {angle}°
                </button>
              ))}
            </div>
            <div className="row tight" style={{ marginTop: 6 }}>
              <button type="button" onClick={() => rotateBy(-90)}>
                ⟲ −90°
              </button>
              <button type="button" onClick={() => rotateBy(90)}>
                ⟳ +90°
              </button>
            </div>
            {layout.job.has_grain && (
              <div className="small muted" style={{ marginTop: 6 }}>
                Материал с текстурой: поперёк волокна деталь класть нельзя, поэтому
                автораскладка использует только 0° и 180°.
              </div>
            )}
          </div>

          <div className="prop-block">
            <div className="row tight">
              <button type="button" onClick={() => setPinned(true)}>
                Закрепить
              </button>
              <button type="button" onClick={() => setPinned(false)}>
                Открепить
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Закреплённые детали автораскладка не двигает.
            </div>
          </div>
        </>
      )}

      {!!vectorsByPart.size && (
        <div className="prop-block">
          <div className="prop-head">Траектория</div>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Выделено векторов: {selection.vectors.length}. Выберите стратегию — она
            применится ко всем выделенным.
          </div>

          {[...vectorsByPart.entries()].map(([partId, targets]) => {
            const part = layout.parts[String(partId)]
            if (!part) return null
            return (
              <div key={partId} style={{ marginBottom: 10 }}>
                {targets.map((target) => {
                  const vector = part.vectors.find((v) => v.target === target)
                  if (!vector) return null
                  const preset = presets.find((p) => p.id === vector.preset_id)
                  const depth = resolveDepth(preset, vector.depth, part.thickness)
                  return (
                    <div className="vector-row" key={target}>
                      <span
                        className="swatch"
                        style={{ background: preset?.color ?? '#9ca3af' }}
                      />
                      <span className="grow">
                        <b>{vector.title}</b>
                        <div className="small muted">
                          {preset ? preset.name : 'без траектории'}
                          {depth !== null && ` · глубина ${depth} мм`}
                          {preset?.tool_diameter ? ` · фреза ⌀${preset.tool_diameter}` : ''}
                        </div>
                      </span>
                      <input
                        type="checkbox"
                        checked={vector.enabled}
                        title="Обрабатывать этот вектор"
                        onChange={(event) =>
                          onToggleVector(partId, [target], event.target.checked)
                        }
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}

          <label className="field">
            Применить стратегию
            <select
              value={presetChoice}
              onChange={(event) => setPresetChoice(event.target.value)}
            >
              <option value="">— выберите —</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.tool_diameter ? ` · ⌀${preset.tool_diameter}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            style={{ marginTop: 8, width: '100%' }}
            disabled={!presetChoice}
            onClick={() => {
              for (const [partId, targets] of vectorsByPart.entries()) {
                onAssignToolpath(partId, targets, Number(presetChoice))
              }
            }}
          >
            Применить к выделенным векторам
          </button>
        </div>
      )}
    </div>
  )
}
