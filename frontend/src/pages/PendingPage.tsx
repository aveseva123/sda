import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { Material, Part } from '../api/types'
import { mm, sourceLabel } from '../lib/format'
import { useLoader } from '../lib/hooks'

/** Трассировка резолвера: что система пробовала и почему не приняла результат. */
function Trace({ part }: { part: Part }) {
  const clarification = part.clarification
  if (!clarification) return null
  return (
    <div className="trace">
      {clarification.thickness.attempts.map((attempt, index) => (
        <div key={index} className={attempt.matched ? 'hit' : 'miss'}>
          {attempt.matched ? '✓' : '·'} {sourceLabel(attempt.resolver)}: {attempt.note}
        </div>
      ))}
      {!clarification.material.accepted && (
        <div className="miss">· материал: {clarification.material.note}</div>
      )}
      {clarification.unmapped_layers.length > 0 && (
        <div className="miss">
          · слои без назначенной семантики: {clarification.unmapped_layers.join(', ')}
        </div>
      )}
      {clarification.geometry_warnings.map((warning, index) => (
        <div key={`w${index}`} className="miss">
          · геометрия: {warning}
        </div>
      ))}
    </div>
  )
}

export default function PendingPage() {
  const { data: parts, error, loading, reload } = useLoader<Part[]>(
    () => api.pendingParts(),
    [],
  )
  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])

  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [thickness, setThickness] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const thicknesses = useMemo(
    () => Array.from(new Set((materials ?? []).map((m) => m.thickness))).sort((a, b) => a - b),
    [materials],
  )

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setChecked((prev) =>
      prev.size === (parts?.length ?? 0) ? new Set() : new Set((parts ?? []).map((p) => p.id)),
    )
  }

  const apply = async () => {
    if (!checked.size) return
    setMessage(null)
    try {
      const result = await api.bulkAssign({
        part_ids: Array.from(checked),
        thickness: thickness ? Number(thickness) : undefined,
        material_id: materialId ? Number(materialId) : undefined,
      })
      setMessage(
        `Обновлено ${result.updated}, ушло из очереди ${result.resolved}. ` +
          `Осталось уточнить: ${result.still_pending}.`,
      )
      setChecked(new Set())
      reload()
    } catch (err) {
      setMessage((err as Error).message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Требуют уточнения</h2>
          <p>
            Система не угадывает толщину и материал молча. Здесь собраны детали, для
            которых уверенного ответа не нашлось — с показом того, что именно было
            испробовано. Отметьте нужные и назначьте значения разом.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice ok">{message}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      {parts?.length === 0 && !loading && (
        <div className="panel empty">
          Очередь пуста — у всех деталей определены и толщина, и материал.
        </div>
      )}

      {!!parts?.length && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={checked.size === parts.length && parts.length > 0}
                    onChange={toggleAll}
                    aria-label="Выбрать все"
                  />
                </th>
                <th>Деталь</th>
                <th>Проект / изделие</th>
                <th className="num">Габарит, мм</th>
                <th>Толщина</th>
                <th>Материал</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(part.id)}
                      onChange={() => toggle(part.id)}
                      aria-label={`Выбрать ${part.name}`}
                    />
                  </td>
                  <td>
                    <b>{part.name}</b>
                    {part.source_file && (
                      <div className="small muted mono">{part.source_file}</div>
                    )}
                    <Trace part={part} />
                  </td>
                  <td className="small">
                    {part.project_name}
                    <div className="muted">{part.product_name}</div>
                  </td>
                  <td className="num">
                    {mm(part.length)} × {mm(part.width)}
                  </td>
                  <td>
                    {part.thickness === null ? (
                      <span className="badge danger">не определена</span>
                    ) : (
                      <span className="badge warn">{part.thickness} мм · не подтверждена</span>
                    )}
                  </td>
                  <td>
                    {part.material_name ?? <span className="badge danger">не назначен</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="selection-bar" style={{ marginTop: 12 }}>
            <span>Выбрано: {checked.size}</span>
            <select value={thickness} onChange={(event) => setThickness(event.target.value)}>
              <option value="">— толщина —</option>
              {thicknesses.map((value) => (
                <option key={value} value={value}>
                  {value} мм
                </option>
              ))}
            </select>
            <select value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
              <option value="">— материал —</option>
              {(materials ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.thickness} мм
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary"
              onClick={apply}
              disabled={!checked.size || (!thickness && !materialId)}
            >
              Назначить выбранным
            </button>
          </div>
        </div>
      )}
    </>
  )
}
