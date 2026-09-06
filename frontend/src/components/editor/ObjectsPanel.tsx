import { useMemo } from 'react'

import type { Layout, Selection } from '../../editor/types'
import { vectorKey } from '../../editor/types'

interface Props {
  layout: Layout
  selection: Selection
  onSelectionChange: (selection: Selection) => void
  focusedPartId: number | null
  onFocusPart: (partId: number | null) => void
}

/**
 * Список объектов — как панель слоёв в редакторе: лист → детали → векторы
 * детали. Отсюда можно выделять то, что трудно поймать курсором на холсте:
 * присадку ⌀4 на детали шириной 38 мм мышью не подцепишь.
 */
export default function ObjectsPanel({
  layout,
  selection,
  onSelectionChange,
  focusedPartId,
  onFocusPart,
}: Props) {
  const selectedInstances = useMemo(() => new Set(selection.instances), [selection.instances])
  const selectedVectors = useMemo(() => new Set(selection.vectors), [selection.vectors])

  const bySheet = useMemo(() => {
    const map = new Map<number, typeof layout.instances>()
    for (const instance of layout.instances) {
      if (instance.sheet_index === null) continue
      const bucket = map.get(instance.sheet_index) ?? []
      bucket.push(instance)
      map.set(instance.sheet_index, bucket)
    }
    return map
  }, [layout.instances])

  const unplaced = layout.instances.filter((i) => i.sheet_index === null)

  const pickInstance = (id: number, partId: number, additive: boolean) => {
    const next = additive
      ? selectedInstances.has(id)
        ? selection.instances.filter((v) => v !== id)
        : [...selection.instances, id]
      : [id]
    onSelectionChange({ instances: next, vectors: [] })
    if (!additive) onFocusPart(partId)
  }

  const pickVector = (partId: number, target: string, additive: boolean) => {
    const key = vectorKey(partId, target)
    const next = additive
      ? selectedVectors.has(key)
        ? selection.vectors.filter((v) => v !== key)
        : [...selection.vectors, key]
      : [key]
    onFocusPart(partId)
    onSelectionChange({ instances: selection.instances, vectors: next })
  }

  return (
    <div className="panel-scroll">
      <div className="panel-title">Объекты</div>

      {[...bySheet.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sheetIndex, instances]) => {
          const sheet = layout.sheets.find((s) => s.index === sheetIndex)
          return (
            <div className="tree-block" key={sheetIndex}>
              <div className="tree-head">
                <b>Лист {sheetIndex + 1}</b>
                <span className="muted small">
                  {instances.length} дет.
                  {sheet?.utilization ? ` · ${(sheet.utilization * 100).toFixed(0)}%` : ''}
                </span>
              </div>
              {instances.map((instance) => {
                const part = layout.parts[String(instance.part_id)]
                if (!part) return null
                const active = selectedInstances.has(instance.id)
                const focused = focusedPartId === part.id
                return (
                  <div key={instance.id}>
                    <div
                      className={`tree-row${active ? ' active' : ''}`}
                      onClick={(event) =>
                        pickInstance(instance.id, part.id, event.shiftKey || event.metaKey)
                      }
                    >
                      <span
                        className="swatch"
                        style={{ background: part.style?.fill ?? '#cbd5e1' }}
                      />
                      <span className="grow ellipsis">{part.name}</span>
                      {instance.pinned && <span className="badge plain">закр.</span>}
                      <span className="muted small">{instance.rotation ?? 0}°</span>
                    </div>
                    {focused && (
                      <div className="tree-vectors">
                        {part.vectors.map((vector) => (
                          <div
                            key={vector.target}
                            className={`tree-row vector${
                              selectedVectors.has(vectorKey(part.id, vector.target)) ? ' active' : ''
                            }`}
                            onClick={(event) => {
                              event.stopPropagation()
                              pickVector(part.id, vector.target, event.shiftKey || event.metaKey)
                            }}
                          >
                            <span className="grow ellipsis">{vector.title}</span>
                            {vector.depth !== null && vector.depth !== undefined && (
                              <span className="muted small">D{vector.depth}</span>
                            )}
                            {!vector.preset_id && <span className="badge warn">нет</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

      {unplaced.length > 0 && (
        <div className="tree-block">
          <div className="tree-head">
            <b>Вне листов</b>
            <span className="muted small">{unplaced.length} дет.</span>
          </div>
          {unplaced.map((instance) => {
            const part = layout.parts[String(instance.part_id)]
            return (
              <div
                key={instance.id}
                className={`tree-row${selectedInstances.has(instance.id) ? ' active' : ''}`}
                onClick={(event) =>
                  pickInstance(instance.id, instance.part_id, event.shiftKey || event.metaKey)
                }
              >
                <span className="grow ellipsis">{part?.name ?? instance.uid}</span>
                <span className="badge warn">не размещена</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
