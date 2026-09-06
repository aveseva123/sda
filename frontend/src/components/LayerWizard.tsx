import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { LayerSummary } from '../api/types'
import { dxfSourceLabel } from '../lib/format'
import ShapeCanvas from './ShapeCanvas'

interface Props {
  batchId: number
  summary: LayerSummary
  onApply: (overrides: Record<string, string>, presetId: number | null) => void
  busy?: boolean
}

/**
 * Мастер сопоставления слоёв.
 *
 * Показывает реальные слои загруженных файлов со статистикой и превью, а не
 * список зашитых имён: у Базиса и Fusion слои называются по-разному, и
 * заранее их знать нельзя. Назначенную карту можно сохранить как пресет —
 * дальше она применяется автоматически по сигнатуре файла.
 */
export default function LayerWizard({ batchId, summary, onApply, busy }: Props) {
  const [assignment, setAssignment] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<number[][][]>([])
  const [presetName, setPresetName] = useState('')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    setAssignment({ ...summary.suggestions })
    setSelected(summary.layers[0]?.name ?? null)
    setPresetName(dxfSourceLabel(summary.detected_source))
  }, [summary])

  useEffect(() => {
    if (!selected) return
    let alive = true
    api
      .layerPreview(batchId, selected)
      .then((data) => {
        if (alive) setPreview(data.paths)
      })
      .catch(() => {
        if (alive) setPreview([])
      })
    return () => {
      alive = false
    }
  }, [batchId, selected])

  const semanticOptions = useMemo(() => Object.entries(summary.semantics), [summary.semantics])

  const savePreset = async () => {
    setSaveMessage(null)
    try {
      const saved = await api.savePreset({
        name: presetName.trim() || dxfSourceLabel(summary.detected_source),
        source: summary.detected_source,
        rules: Object.entries(assignment).map(([layer, semantic]) => ({ layer, semantic })),
      })
      setSaveMessage(`Пресет «${saved.name}» сохранён — дальше применится автоматически.`)
    } catch (error) {
      setSaveMessage(`Не удалось сохранить: ${(error as Error).message}`)
    }
  }

  return (
    <div className="panel">
      <h3>Мастер сопоставления слоёв</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Источник определён как <b>{dxfSourceLabel(summary.detected_source)}</b>
        {summary.preset_name && (
          <>
            , применён пресет <b>{summary.preset_name}</b>
          </>
        )}
        . Назначьте каждому слою технологический смысл. Строки, помеченные
        «пресет», уже подтверждены ранее; остальные предзаполнены подсказкой по
        геометрии слоя, а не по его имени. Слой без назначения не режется и
        отправляет деталь в очередь уточнений.
      </p>

      <div className="split">
        <table className="layer-table">
          <thead>
            <tr>
              <th>Слой</th>
              <th className="num">Примитивов</th>
              <th className="num">Глубина</th>
              <th>Состав</th>
              <th>Семантика</th>
            </tr>
          </thead>
          <tbody>
            {summary.layers.map((layer) => (
              <tr
                key={layer.name}
                onClick={() => setSelected(layer.name)}
                style={{
                  cursor: 'pointer',
                  background: selected === layer.name ? '#eaf4fb' : undefined,
                }}
              >
                <td>
                  <b>{layer.name}</b>
                  <div className="small muted">
                    в {layer.files} файл(ах){' '}
                    {layer.from_preset ? (
                      <span className="badge ok">пресет</span>
                    ) : (
                      <span className="badge plain">геометрия</span>
                    )}
                  </div>
                </td>
                <td className="num">{layer.count}</td>
                <td className="num">
                  {layer.depth !== null ? (
                    <b>{layer.depth} мм</b>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="small muted">
                  {Object.entries(layer.dxftypes)
                    .map(([type, count]) => `${type}×${count}`)
                    .join(', ')}
                  {layer.circle_diameters.length > 0 && (
                    <div>⌀ {layer.circle_diameters.join(', ')} мм</div>
                  )}
                </td>
                <td>
                  <select
                    value={assignment[layer.name] ?? ''}
                    onChange={(event) =>
                      setAssignment((prev) => ({ ...prev, [layer.name]: event.target.value }))
                    }
                    onClick={(event) => event.stopPropagation()}
                  >
                    <option value="">— не назначено —</option>
                    {semanticOptions.map(([key, info]) => (
                      <option key={key} value={key}>
                        {key} — {info.title}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Превью слоя {selected ? <b>{selected}</b> : '—'}
          </div>
          <ShapeCanvas paths={preview} height={220} stroke="#0072b2" />
          <div className="small muted" style={{ marginTop: 6 }}>
            Показана геометрия слоя из первого файла загрузки.
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <label className="field">
          Имя пресета
          <input value={presetName} onChange={(event) => setPresetName(event.target.value)} />
        </label>
        <button type="button" onClick={savePreset} disabled={busy}>
          Сохранить пресет
        </button>
        <div className="grow" />
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => onApply(assignment, null)}
        >
          {busy ? 'Разбираю…' : 'Применить и разобрать'}
        </button>
      </div>
      {saveMessage && (
        <div className="notice ok" style={{ marginTop: 10 }}>
          {saveMessage}
        </div>
      )}
    </div>
  )
}
