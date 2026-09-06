import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { CuttingPreset, Material, Tool, ToolLibrary } from '../api/types'
import { useLoader } from '../lib/hooks'

/** Типы траекторий, к которым назначается фреза. Порядок — как режется. */
const OPERATIONS: Array<[string, string]> = [
  ['DRILL', 'Присадка'],
  ['GROOVE', 'Паз'],
  ['POCKET', 'Выборка'],
  ['INNER', 'Внутренний вырез'],
  ['OUTER', 'Раскрой по контуру'],
]

const TOOL_TYPE: Array<[string, string]> = [
  ['compression', 'Компрессионная — раскрой'],
  ['end_mill', 'Концевая — раскрой'],
  ['groove', 'Пазовая — паз'],
  ['pocket', 'Спиральная — выборка'],
  ['drill', 'Сверло — присадка'],
  ['v_bit', 'V-образная — гравировка'],
  ['profile', 'Фасонная — скругление'],
]

const TOOL_TYPE_TITLE = Object.fromEntries(
  TOOL_TYPE.map(([key, title]) => [key, title.split(' — ')[0]]),
) as Record<string, string>

function num(value: unknown, digits = 2): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = Number(value).toFixed(digits)
  // Хвостовые нули убираются только после запятой: «200» — это двести, а не
  // два, и ресурс фрезы нельзя показывать в десять раз меньше.
  const trimmed = digits > 0 ? text.replace(/\.?0+$/, '') : text
  return trimmed.replace('.', ',')
}

/**
 * Шаблоны траекторий.
 *
 * Один шаблон описывает, как режется конкретный материал: чем, на какую
 * глубину, в каком порядке и с каким зазором. Технолог настраивает его один
 * раз, а платформа сама подбирает шаблон по материалу и толщине.
 *
 * Библиотека фрез живёт здесь же: выбирать фрезу для траектории и не видеть
 * её параметров — значит гадать.
 */
export default function PresetsPage() {
  const { data: presets, error, loading, reload } = useLoader<CuttingPreset[]>(
    () => api.cuttingPresets(),
    [],
  )
  const { data: library, reload: reloadTools } = useLoader<ToolLibrary>(() => api.tools(), [])
  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])

  const [slug, setSlug] = useState<string | null>(null)
  const [draft, setDraft] = useState<CuttingPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const preset = useMemo(
    () => (presets ?? []).find((item) => item.slug === slug) ?? (presets ?? [])[0] ?? null,
    [presets, slug],
  )

  // Правки живут в черновике: пока не нажали «Сохранить», шаблон не меняется.
  useEffect(() => {
    setDraft(preset ? structuredClone(preset) : null)
    setMessage(null)
    setFailure(null)
  }, [preset])

  const tools = library?.tools ?? []
  const dirty = useMemo(
    () => Boolean(draft && preset && JSON.stringify(draft) !== JSON.stringify(preset)),
    [draft, preset],
  )

  // Названия материалов из справочника: шаблон подбирается по ним.
  const materialNames = useMemo(
    () => Array.from(new Set((materials ?? []).map((m) => m.name))).sort(),
    [materials],
  )
  const thicknesses = useMemo(
    () => Array.from(new Set((materials ?? []).map((m) => m.thickness))).sort((a, b) => a - b),
    [materials],
  )

  const patch = (path: keyof CuttingPreset, key: string, value: unknown) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            [path]: { ...(prev[path] as Record<string, unknown>), [key]: value },
          }
        : prev,
    )

  const setTool = (semantic: string, toolId: string) => {
    const tool = tools.find((item) => String(item.id) === toolId)
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...(prev.tools as Record<string, unknown>) }
      if (!tool) delete next[semantic]
      else {
        next[semantic] = {
          slot: tool.slot ? `T${tool.slot}` : null,
          name: tool.name,
          diameter: tool.diameter,
        }
      }
      return { ...prev, tools: next }
    })
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setFailure(null)
    try {
      await api.updateCuttingPreset(draft.id, {
        slug: draft.slug,
        name: draft.name,
        applies_to: draft.applies_to,
        placement: draft.placement,
        depth: draft.depth,
        strategy: draft.strategy,
        tools: draft.tools,
        order: draft.order,
        safety: draft.safety,
        post: draft.post,
        is_default: draft.is_default,
      })
      setMessage('Шаблон сохранён. Новые раскрои считаются по нему.')
      reload()
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const currentToolId = (semantic: string): string => {
    const entry = (draft?.tools as Record<string, { name?: string; diameter?: number }>)?.[semantic]
    const item = Array.isArray(entry) ? entry[0] : entry
    if (!item) return ''
    const found = tools.find(
      (tool) => tool.name === item.name || Math.abs(tool.diameter - Number(item.diameter)) < 0.01,
    )
    return found ? String(found.id) : ''
  }

  const placement = (draft?.placement ?? {}) as Record<string, number | string | boolean>
  const depth = (draft?.depth ?? {}) as Record<string, number>
  const strategy = (draft?.strategy ?? {}) as Record<string, unknown>
  const applies = (draft?.applies_to ?? {}) as Record<string, unknown>
  const materialRegex = String(applies.material_regex ?? '').replace('(?i)', '')

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Шаблоны траекторий</h2>
          <p>
            Шаблон описывает, как режется материал: чем, на какую глубину, в каком
            порядке и с каким зазором. Настраивается один раз, дальше подбирается
            сам по материалу и толщине — и запоминается в раскрое, чтобы старую
            программу можно было повторить.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {failure && <div className="notice error">{failure}</div>}
      {message && <div className="notice ok">{message}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      <div className="split" style={{ gridTemplateColumns: '250px 1fr' }}>
        <div className="panel">
          <h3>
            Шаблоны <span className="badge plain">{presets?.length ?? 0}</span>
          </h3>
          {(presets ?? []).map((item) => (
            <div
              key={item.slug}
              className={`list-row${item.slug === preset?.slug ? ' active' : ''}`}
              onClick={() => setSlug(item.slug)}
            >
              <span className="grow">
                {item.name}
                <div className="small muted mono">
                  {item.applies_to.thickness ? `${item.applies_to.thickness} мм` : 'без толщины'}
                </div>
              </span>
              {item.is_default && <span className="badge plain">по умолч.</span>}
            </div>
          ))}
        </div>

        <div>
          {draft ? (
            <>
              <div className="panel">
                <div className="row" style={{ marginBottom: 12 }}>
                  <label className="field grow">
                    Название шаблона
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Тип материала
                    <select
                      value={materialRegex}
                      onChange={(event) =>
                        patch(
                          'applies_to',
                          'material_regex',
                          event.target.value ? `(?i)${event.target.value}` : '',
                        )
                      }
                    >
                      <option value="">любой</option>
                      {materialNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Толщина, мм
                    <select
                      value={String(applies.thickness ?? '')}
                      onChange={(event) =>
                        patch('applies_to', 'thickness', Number(event.target.value))
                      }
                    >
                      {thicknesses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !dirty}
                    onClick={save}
                  >
                    Сохранить
                  </button>
                </div>
                <div className="small muted">
                  Шаблон подбирается по этой паре при добавлении файлов в раскрой.
                  Толщина обязана совпадать: раскрой 16 мм шаблоном на 18 прорежет
                  жертвенный стол.
                  {preset && preset.last_utilization ? (
                    <>
                      {' '}Последний раскрой по нему —{' '}
                      <b>{(preset.last_utilization * 100).toFixed(1).replace('.', ',')} %</b> КИМ.
                    </>
                  ) : null}
                </div>
              </div>

              <div className="panel">
                <h3>Фрезы по типам траекторий</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Траектория</th>
                      <th>Фреза</th>
                      <th>Тип</th>
                      <th className="num">⌀</th>
                      <th className="num">Обороты</th>
                      <th className="num">Подача</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPERATIONS.map(([semantic, title]) => {
                      const id = currentToolId(semantic)
                      const tool = tools.find((item) => String(item.id) === id)
                      return (
                        <tr key={semantic}>
                          <td>{title}</td>
                          <td>
                            <select
                              value={id}
                              onChange={(event) => setTool(semantic, event.target.value)}
                            >
                              <option value="">— не режется —</option>
                              {tools.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.slot ? `T${item.slot} · ` : ''}
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="small">
                            {tool ? TOOL_TYPE_TITLE[tool.type] ?? tool.type : '—'}
                          </td>
                          <td className="num mono">{tool ? num(tool.diameter, 1) : '—'}</td>
                          <td className="num mono">
                            {tool ? tool.rpm.toLocaleString('ru') : '—'}
                          </td>
                          <td className="num mono">
                            {tool ? tool.feed.toLocaleString('ru') : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="small muted" style={{ marginTop: 8 }}>
                  Контур режется последним: иначе отрезанная деталь поедет под
                  фрезой. Параметры самой фрезы правятся ниже, в библиотеке.
                </div>
              </div>

              <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="panel">
                  <h3>Размещение на листе</h3>
                  <div className="fld-grid">
                    <label className="fld">
                      <span>Мостик</span>
                      <input
                        type="number"
                        step={0.5}
                        value={String(placement.part_gap ?? '')}
                        onChange={(event) =>
                          patch('placement', 'part_gap', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Отступ</span>
                      <input
                        type="number"
                        step={1}
                        value={String(placement.sheet_margin ?? '')}
                        onChange={(event) =>
                          patch('placement', 'sheet_margin', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Поворот</span>
                      <select
                        value={String(placement.rotation ?? 'quarter')}
                        onChange={(event) =>
                          patch('placement', 'rotation', event.target.value)
                        }
                      >
                        <option value="quarter">0 / 90°</option>
                        <option value="none">без поворота</option>
                        <option value="free">свободно</option>
                      </select>
                    </label>
                    <label className="fld">
                      <span>Волокно</span>
                      <select
                        value={placement.respect_grain ? 'yes' : 'no'}
                        onChange={(event) =>
                          patch('placement', 'respect_grain', event.target.value === 'yes')
                        }
                      >
                        <option value="yes">учитывать</option>
                        <option value="no">не важно</option>
                      </select>
                    </label>
                    <label className="fld">
                      <span>Мин. остаток</span>
                      <input
                        type="number"
                        step={10}
                        value={String(placement.min_offcut ?? '')}
                        onChange={(event) =>
                          patch('placement', 'min_offcut', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Остатки</span>
                      <select
                        value={placement.offcuts_first ? 'yes' : 'no'}
                        onChange={(event) =>
                          patch('placement', 'offcuts_first', event.target.value === 'yes')
                        }
                      >
                        <option value="yes">сначала обрезки</option>
                        <option value="no">сначала листы</option>
                      </select>
                    </label>
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Зазор между деталями = диаметр фрезы контура + мостик.
                  </div>
                </div>

                <div className="panel">
                  <h3>Глубина резания</h3>
                  <div className="fld-grid">
                    <label className="fld">
                      <span>Начало</span>
                      <input
                        type="number"
                        step={0.5}
                        value={String(depth.start ?? '')}
                        onChange={(event) => patch('depth', 'start', Number(event.target.value))}
                      />
                    </label>
                    <label className="fld">
                      <span>Подрез</span>
                      <input
                        type="number"
                        step={0.1}
                        value={String(depth.end_extra ?? '')}
                        onChange={(event) =>
                          patch('depth', 'end_extra', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Припуск</span>
                      <input
                        type="number"
                        step={0.1}
                        value={String(depth.allowance ?? '')}
                        onChange={(event) =>
                          patch('depth', 'allowance', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Шаг Z</span>
                      <input
                        type="number"
                        step={0.25}
                        value={String(depth.step_z ?? '')}
                        onChange={(event) => patch('depth', 'step_z', Number(event.target.value))}
                      />
                    </label>
                    <label className="fld">
                      <span>Точность</span>
                      <input
                        type="number"
                        step={0.01}
                        value={String(depth.tolerance ?? '')}
                        onChange={(event) =>
                          patch('depth', 'tolerance', Number(event.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Подрез — насколько фреза уходит ниже толщины, в жертвенный стол.
                  </div>
                </div>
              </div>

              <div className="panel">
                <h3>Стратегия обработки</h3>
                <div className="fld-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <label className="fld">
                    <span>Тип</span>
                    <select
                      value={String(strategy.type ?? 'offset')}
                      onChange={(event) => patch('strategy', 'type', event.target.value)}
                    >
                      <option value="offset">смещение</option>
                      <option value="raster">растр</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Обход</span>
                    <select
                      value={String(strategy.direction ?? 'climb')}
                      onChange={(event) => patch('strategy', 'direction', event.target.value)}
                    >
                      <option value="climb">попутный</option>
                      <option value="conventional">встречный</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Старт</span>
                    <select
                      value={String(strategy.start_point ?? 'inside')}
                      onChange={(event) => patch('strategy', 'start_point', event.target.value)}
                    >
                      <option value="inside">внутри</option>
                      <option value="outside">снаружи</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Коррекция</span>
                    <select
                      value={String(strategy.compensation ?? 'cam')}
                      onChange={(event) => patch('strategy', 'compensation', event.target.value)}
                    >
                      <option value="cam">в CAM</option>
                      <option value="g41g42">стойкой G41/G42</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Мостики</span>
                    <select
                      value={String(strategy.tabs ?? 'none')}
                      onChange={(event) => patch('strategy', 'tabs', event.target.value)}
                    >
                      <option value="none">нет</option>
                      <option value="threshold">по порогу</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Врезание</span>
                    <select
                      value={strategy.ramp ? 'yes' : 'no'}
                      onChange={(event) =>
                        patch('strategy', 'ramp', event.target.value === 'yes')
                      }
                    >
                      <option value="no">вертикальное</option>
                      <option value="yes">наклонное</option>
                    </select>
                  </label>
                </div>
              </div>

              <ToolLibrarySection library={library} onChanged={reloadTools} />
            </>
          ) : (
            !loading && <div className="panel empty">Шаблонов нет.</div>
          )}
        </div>
      </div>
    </>
  )
}

/** Библиотека фрез: магазин станка и параметры каждой фрезы. */
function ToolLibrarySection({
  library,
  onChanged,
}: {
  library: ToolLibrary | null
  onChanged: () => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [form, setForm] = useState<Tool | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const tools = library?.tools ?? []
  const open = (tool: Tool) => {
    setOpenId(tool.id === openId ? null : tool.id)
    setForm(structuredClone(tool))
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    setFailure(null)
    try {
      await api.updateTool(form.id, {
        name: form.name,
        type: form.type,
        diameter: form.diameter,
        slot: form.slot,
        flute_length: form.flute_length,
        total_length: form.total_length,
        flutes: form.flutes,
        shank: form.shank,
        article: form.article,
        rpm: form.rpm,
        feed: form.feed,
        plunge_feed: form.plunge_feed,
        step_down: form.step_down,
        resource_used: form.resource.used,
        resource_limit: form.resource.limit,
        resource_unit: form.resource.unit,
        modes: form.modes,
      })
      setOpenId(null)
      onChanged()
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h3>
        Библиотека фрез{' '}
        <span className="badge plain">
          магазин {(library?.magazine ?? []).filter((s) => s.tool_id).length} из{' '}
          {library?.slots ?? 0}
        </span>
      </h3>

      <div className="magazine" style={{ marginBottom: 14 }}>
        {(library?.magazine ?? []).map((slot) => (
          <div
            className={`slot${slot.tool_id ? '' : ' empty'}${slot.low ? ' low' : ''}`}
            key={slot.slot}
          >
            <b>T{slot.slot}</b>
            <span>{slot.tool_id ? `${slot.name}\n⌀${num(slot.diameter, 1)}` : 'свободен'}</span>
          </div>
        ))}
      </div>

      {failure && <div className="notice error">{failure}</div>}

      <table>
        <thead>
          <tr>
            <th>T</th>
            <th>Фреза</th>
            <th>Тип</th>
            <th className="num">⌀</th>
            <th className="num">L реза</th>
            <th className="num">Обороты</th>
            <th className="num">Подача</th>
            <th className="num">Шаг Z</th>
            <th>Ресурс</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.id}>
              <td className="mono">{tool.slot ? `T${tool.slot}` : '—'}</td>
              <td>
                <b>{tool.name}</b>
              </td>
              <td className="small">{TOOL_TYPE_TITLE[tool.type] ?? tool.type}</td>
              <td className="num mono">{num(tool.diameter, 1)}</td>
              <td className="num mono">{num(tool.flute_length, 0)}</td>
              <td className="num mono">{tool.rpm.toLocaleString('ru')}</td>
              <td className="num mono">{tool.feed.toLocaleString('ru')}</td>
              <td className="num mono">{num(tool.step_down, 2)}</td>
              <td style={{ minWidth: 110 }}>
                {tool.resource.limit ? (
                  <>
                    <div className={`bar${tool.resource.low ? ' low' : ''}`}>
                      <i
                        style={{
                          width: `${Math.min(100, (tool.resource.ratio ?? 0) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="small muted mono">
                      {num(tool.resource.used, 0)} / {num(tool.resource.limit, 0)}{' '}
                      {tool.resource.unit}
                    </div>
                  </>
                ) : (
                  <span className="small muted">не задан</span>
                )}
              </td>
              <td>
                <button type="button" onClick={() => open(tool)}>
                  {openId === tool.id ? 'Закрыть' : 'Править'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {form && openId !== null && (
        <div className="intake-card" style={{ marginTop: 12 }}>
          <div className="intake-head">
            <b>{form.name}</b>
            <span className="small muted">
              минимальный внутренний радиус детали — {num(form.diameter / 2, 1)} мм
            </span>
          </div>
          <div className="intake-grid">
            <label className="field">
              Название
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field">
              Тип фрезы
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
              >
                {TOOL_TYPE.map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Слот в магазине
              <select
                value={form.slot ?? ''}
                onChange={(event) =>
                  setForm({ ...form, slot: event.target.value ? Number(event.target.value) : null })
                }
              >
                <option value="">вне магазина</option>
                {Array.from({ length: library?.slots ?? 8 }, (_, index) => index + 1).map((slot) => (
                  <option key={slot} value={slot}>
                    T{slot}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Диаметр, мм
              <input
                type="number"
                step={0.1}
                value={form.diameter}
                onChange={(event) => setForm({ ...form, diameter: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Длина реза, мм
              <input
                type="number"
                step={1}
                value={form.flute_length ?? ''}
                onChange={(event) =>
                  setForm({ ...form, flute_length: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              Зубья
              <input
                type="number"
                step={1}
                value={form.flutes ?? ''}
                onChange={(event) => setForm({ ...form, flutes: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Обороты, об/мин
              <input
                type="number"
                step={500}
                value={form.rpm}
                onChange={(event) => setForm({ ...form, rpm: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Подача, мм/мин
              <input
                type="number"
                step={100}
                value={form.feed}
                onChange={(event) => setForm({ ...form, feed: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Шаг по Z, мм
              <input
                type="number"
                step={0.25}
                value={form.step_down}
                onChange={(event) => setForm({ ...form, step_down: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              Ресурс, пройдено
              <input
                type="number"
                step={1}
                value={form.resource.used}
                onChange={(event) =>
                  setForm({
                    ...form,
                    resource: { ...form.resource, used: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              Ресурс, предел
              <input
                type="number"
                step={10}
                value={form.resource.limit ?? ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    resource: { ...form.resource, limit: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <div className="row tight">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              Сохранить фрезу
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setForm({ ...form, resource: { ...form.resource, used: 0 } })
              }
            >
              Фреза заменена — обнулить ресурс
            </button>
          </div>
          {form.usage.length > 0 && (
            <div className="small muted">Используется: {form.usage.join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
