import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { Tool, ToolLibrary } from '../api/types'
import { useLoader } from '../lib/hooks'

const TYPE_TITLE: Record<string, string> = {
  end_mill: 'Раскрой',
  compression: 'Раскрой',
  drill: 'Присадка',
  v_bit: 'Гравировка',
  profile: 'Скругление',
  saw: 'Пила',
}

function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—'
  return value.toFixed(digits).replace('.', ',')
}

/**
 * Библиотека фрез и магазин станка.
 *
 * Смена инструмента у Дайхонга ручная, поэтому здесь видно две вещи: что
 * стоит в слотах станка и что лежит в ящике. Ресурс считается по пройденному
 * в материале пути — холостые проходы фрезу не тупят.
 */
export default function ToolsPage() {
  const { data, error, loading, reload } = useLoader<ToolLibrary>(() => api.tools(), [])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const tools = data?.tools ?? []
  const selected: Tool | null = useMemo(
    () => tools.find((tool) => tool.id === selectedId) ?? tools[0] ?? null,
    [tools, selectedId],
  )

  const lowCount = tools.filter((tool) => tool.resource.low).length

  const replace = async (tool: Tool) => {
    setBusy(true)
    try {
      await api.setToolResource(tool.id, 0)
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Библиотека фрез</h2>
          <p>
            Диаметр фрезы задаёт минимальный внутренний радиус детали. Платформа
            сверяет его с геометрией контуров и предупреждает до выгрузки УП, а не
            на станке.
          </p>
        </div>
        {lowCount > 0 && <span className="badge warn">Ресурс на исходе · {lowCount}</span>}
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      <div className="panel">
        <h3>
          Магазин станка{' '}
          <span className="badge plain">
            {(data?.magazine ?? []).filter((slot) => slot.tool_id).length} из {data?.slots ?? 0}
          </span>
        </h3>
        <div className="magazine">
          {(data?.magazine ?? []).map((slot) => (
            <div
              className={`slot${slot.tool_id ? '' : ' empty'}${slot.low ? ' low' : ''}`}
              key={slot.slot}
              onClick={() => slot.tool_id && setSelectedId(slot.tool_id)}
            >
              <b>T{slot.slot}</b>
              {slot.tool_id ? (
                <span>
                  {slot.name}
                  <br />⌀{num(slot.diameter, 1)}
                </span>
              ) : (
                <span>свободен</span>
              )}
            </div>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          Фрезы вне магазина ставятся вручную — платформа скажет об этом в УП, а не
          сделает вид, что инструмент в станке.
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <h3>Фрезы</h3>
          <table>
            <thead>
              <tr>
                <th>T</th>
                <th>Фреза</th>
                <th>Тип</th>
                <th className="num">⌀</th>
                <th className="num">L реза</th>
                <th className="num">Z</th>
                <th className="num">Обороты</th>
                <th className="num">Подача</th>
                <th>Ресурс</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr
                  key={tool.id}
                  onClick={() => setSelectedId(tool.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono">{tool.slot ? `T${tool.slot}` : '—'}</td>
                  <td>
                    <b>{tool.name}</b>
                    {tool.article && <div className="small muted mono">{tool.article}</div>}
                  </td>
                  <td className="small">{TYPE_TITLE[tool.type] ?? tool.type}</td>
                  <td className="num mono">{num(tool.diameter, 1)}</td>
                  <td className="num mono">{num(tool.flute_length)}</td>
                  <td className="num mono">{tool.flutes ?? '—'}</td>
                  <td className="num mono">{tool.rpm.toLocaleString('ru')}</td>
                  <td className="num mono">{tool.feed.toLocaleString('ru')}</td>
                  <td style={{ minWidth: 120 }}>
                    {tool.resource.limit ? (
                      <>
                        <div className={`bar${tool.resource.low ? ' low' : ''}`}>
                          <i style={{ width: `${Math.min(100, (tool.resource.ratio ?? 0) * 100)}%` }} />
                        </div>
                        <div className="small muted mono">
                          {num(tool.resource.used)} / {num(tool.resource.limit)} {tool.resource.unit}
                        </div>
                      </>
                    ) : (
                      <span className="small muted">вне магазина</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <div className="params" style={{ gridTemplateColumns: '110px 1fr' }}>
                <span>Слот</span>
                <span>{selected.slot ? `T${selected.slot}` : 'вне магазина'}</span>
                <span>Хвостовик</span>
                <span>{num(selected.shank, 1)} мм</span>
                <span>Длина реза</span>
                <span>{num(selected.flute_length)} мм</span>
                <span>Общая длина</span>
                <span>{num(selected.total_length)} мм</span>
                <span>Зубья</span>
                <span>{selected.flutes ?? '—'}</span>
                <span>Мин. радиус</span>
                <span>{num(selected.min_radius, 1)} мм</span>
                <span>Шаг по Z</span>
                <span>{num(selected.step_down, 2)} мм</span>
                <span>Артикул</span>
                <span>{selected.article ?? '—'}</span>
              </div>

              <h3 style={{ marginTop: 16 }}>Режимы по материалам</h3>
              {selected.modes.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Материал</th>
                      <th className="num">Об/мин</th>
                      <th className="num">Подача</th>
                      <th className="num">Шаг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.modes.map((mode) => (
                      <tr key={mode.material}>
                        <td>{mode.material}</td>
                        <td className="num mono">{mode.rpm.toLocaleString('ru')}</td>
                        <td className="num mono">{mode.feed.toLocaleString('ru')}</td>
                        <td className="num mono">{num(mode.step_z, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty small">Режимы не заданы.</div>
              )}

              <h3 style={{ marginTop: 16 }}>Где используется</h3>
              {selected.usage.length ? (
                selected.usage.map((entry) => (
                  <div className="small" key={entry} style={{ padding: '3px 0' }}>
                    {entry}
                  </div>
                ))
              ) : (
                <div className="empty small">Ни один пресет её не называет.</div>
              )}

              <div className="row tight" style={{ marginTop: 14 }}>
                <button type="button" disabled={busy} onClick={() => replace(selected)}>
                  Фреза заменена — обнулить ресурс
                </button>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                Ресурс считается по пройденному в материале пути, а не по времени
                работы шпинделя.
              </div>
            </>
          ) : (
            <div className="empty small">Выберите фрезу.</div>
          )}
        </div>
      </div>
    </>
  )
}
