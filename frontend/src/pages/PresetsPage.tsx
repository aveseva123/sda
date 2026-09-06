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

const OPERATION_TITLE = Object.fromEntries(OPERATIONS) as Record<string, string>

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
  // Черновик пересобирается при смене шаблона, а не на каждое обновление
  // списка: иначе «Шаблон сохранён» гасло через долю секунды после сохранения,
  // потому что reload() менял объект пресета.
  useEffect(() => {
    setDraft(preset ? structuredClone(preset) : null)
    setFailure(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.id])

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

  /** Как фреза записана в шаблоне: по этой записи её потом ищут в библиотеке. */
  const toolEntry = (tool: Tool) => ({
    slot: tool.slot ? `T${tool.slot}` : null,
    name: tool.name,
    diameter: tool.diameter,
  })

  const setTool = (semantic: string, toolId: string, index = 0) => {
    const tool = tools.find((item) => String(item.id) === toolId)
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...(prev.tools as Record<string, unknown>) }
      const current = next[semantic]
      // Присадка держит НЕСКОЛЬКО свёрл — их подбирают по диаметру отверстия.
      // Раньше страница показывала только первое и затирала список целиком:
      // чашечное ⌀15 исчезало из шаблона при любой правке строки.
      if (Array.isArray(current)) {
        const list = [...current]
        if (!tool) list.splice(index, 1)
        else list[index] = toolEntry(tool)
        if (list.length === 0) delete next[semantic]
        else next[semantic] = list
      } else if (!tool) {
        delete next[semantic]
      } else {
        next[semantic] = toolEntry(tool)
      }
      return { ...prev, tools: next }
    })
  }

  const addDrill = () => {
    const drill = tools.find((item) => item.type === 'drill') ?? tools[0]
    if (!drill) return
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...(prev.tools as Record<string, unknown>) }
      const current = next.DRILL
      const list = Array.isArray(current) ? [...current] : current ? [current] : []
      next.DRILL = [...list, toolEntry(drill)]
      return { ...prev, tools: next }
    })
  }

  /** Новый шаблон: пустой или копией открытого. */
  const createPreset = async (source: CuttingPreset | null) => {
    const name = window.prompt(
      'Название шаблона',
      source ? `${source.name} (копия)` : 'Новый шаблон',
    )
    if (!name?.trim()) return
    const base = source ?? (presets ?? [])[0]
    setBusy(true)
    setFailure(null)
    try {
      const created = await api.createCuttingPreset({
        slug: `preset_${Date.now().toString(36)}`,
        name: name.trim(),
        applies_to: base ? { ...base.applies_to } : {},
        placement: base ? { ...base.placement } : {},
        depth: base ? { ...base.depth } : {},
        strategy: base ? { ...base.strategy } : {},
        tools: base ? structuredClone(base.tools) : {},
        order: base ? [...base.order] : ['DRILL', 'GROOVE', 'POCKET', 'INNER', 'OUTER'],
        safety: base ? { ...base.safety } : {},
        post: base ? { ...base.post } : {},
        is_default: false,
      })
      setSlug(created.slug)
      setMessage(`Шаблон «${created.name}» создан. Проверьте материал и толщину.`)
      reload()
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removePreset = async () => {
    if (!preset) return
    if (
      !window.confirm(
        `Удалить шаблон «${preset.name}»? Раскрои, посчитанные по нему, ` +
          'сохранят свои параметры — у них лежит копия.',
      )
    ) {
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await api.deleteCuttingPreset(preset.id)
      setSlug(null)
      setMessage(`Шаблон «${preset.name}» удалён.`)
      reload()
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const moveOrder = (index: number, delta: number) =>
    setDraft((prev) => {
      if (!prev) return prev
      const list = [...(prev.order ?? [])]
      const target = index + delta
      if (target < 0 || target >= list.length) return prev
      ;[list[index], list[target]] = [list[target], list[index]]
      return { ...prev, order: list }
    })

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

  type ToolRef = { slot?: string | null; name?: string; diameter?: number }

  /** Записи шаблона по типу траектории: у присадки их несколько. */
  const toolRefs = (semantic: string): ToolRef[] => {
    const entry = (draft?.tools as Record<string, ToolRef | ToolRef[]>)?.[semantic]
    if (!entry) return []
    return Array.isArray(entry) ? entry : [entry]
  }

  /**
   * Какая фреза библиотеки стоит в этой записи шаблона.
   *
   * Сначала гнездо, потом имя, и только потом диаметр. Раньше поиск начинался
   * с диаметра — и в строке «Присадка» показывалась компрессионная ⌀8 вместо
   * сверла ⌀8, потому что она просто лежала в списке раньше.
   */
  const toolIdOf = (ref: ToolRef | undefined): string => {
    if (!ref) return ''
    const bySlot = ref.slot
      ? tools.find((tool) => tool.slot !== null && `T${tool.slot}` === ref.slot)
      : undefined
    const byName = tools.find((tool) => tool.name === ref.name)
    const byDiameter = tools.find(
      (tool) => Math.abs(tool.diameter - Number(ref.diameter)) < 0.01,
    )
    const found = bySlot ?? byName ?? byDiameter
    return found ? String(found.id) : ''
  }

  const placement = (draft?.placement ?? {}) as Record<string, number | string | boolean>
  const depth = (draft?.depth ?? {}) as Record<string, number>
  const strategy = (draft?.strategy ?? {}) as Record<string, unknown>
  const applies = (draft?.applies_to ?? {}) as Record<string, unknown>
  const safety = (draft?.safety ?? {}) as Record<string, unknown>
  const post = (draft?.post ?? {}) as Record<string, unknown>
  // В шаблоне лежит регулярное выражение вида «(?i)лдсп», а в справочнике имя
  // написано «ЛДСП». Сравнение без учёта регистра — иначе поле показывало
  // «любой» там, где материал на самом деле задан.
  const appliesName = String(applies.material_regex ?? '').replace('(?i)', '')
  const materialRegex =
    materialNames.find((name) => name.toLowerCase() === appliesName.toLowerCase()) ??
    (appliesName ? appliesName : '')

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
          <div className="row tight" style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => createPreset(null)} disabled={busy}>
              Новый
            </button>
            <button
              type="button"
              onClick={() => createPreset(draft)}
              disabled={busy || !draft}
              title="Скопировать открытый шаблон на другую толщину"
            >
              Копия
            </button>
            <button
              type="button"
              className="danger"
              onClick={removePreset}
              disabled={busy || !preset}
            >
              Удалить
            </button>
          </div>
          {(presets ?? []).map((item) => (
            <div
              key={item.slug}
              className={`list-row${item.slug === preset?.slug ? ' active' : ''}`}
              onClick={() => {
                // Несохранённые правки молча пропадали при клике на соседний
                // шаблон — полчаса подбора режимов исчезали без следа.
                if (
                  dirty &&
                  !window.confirm(
                    'В открытом шаблоне есть несохранённые правки. Уйти и потерять их?',
                  )
                ) {
                  return
                }
                setMessage(null)
                setSlug(item.slug)
              }}
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
                    style={{ alignSelf: 'flex-end' }}
                    disabled={busy || !dirty}
                    onClick={save}
                    title={dirty ? 'Записать правки в шаблон' : 'Правок нет'}
                  >
                    {dirty ? 'Сохранить правки' : 'Сохранено'}
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {OPERATIONS.map(([semantic, title]) => {
                      // У присадки свёрл несколько: инструмент подбирается по
                      // диаметру отверстия, и каждое сверло — своя строка.
                      const refs = toolRefs(semantic)
                      const rows = refs.length ? refs : [undefined]
                      return rows.map((ref, index) => {
                        const id = toolIdOf(ref)
                        const tool = tools.find((item) => String(item.id) === id)
                        return (
                          <tr key={`${semantic}-${index}`}>
                            <td>{index === 0 ? title : ''}</td>
                            <td>
                              <select
                                value={id}
                                onChange={(event) =>
                                  setTool(semantic, event.target.value, index)
                                }
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
                            <td>
                              {semantic === 'DRILL' && refs.length > 1 && (
                                <button
                                  type="button"
                                  className="ghost"
                                  title="Убрать это сверло из шаблона"
                                  onClick={() => setTool(semantic, '', index)}
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    })}
                  </tbody>
                </table>
                <button
                  type="button"
                  style={{ marginTop: 10 }}
                  onClick={addDrill}
                  disabled={!tools.length}
                >
                  Добавить сверло
                </button>
                <div className="small muted" style={{ marginTop: 8 }}>
                  Контур режется последним: иначе отрезанная деталь поедет под
                  фрезой. Свёрл в присадке может быть несколько — платформа берёт
                  то, чей диаметр ближе к отверстию. Параметры самой фрезы
                  правятся ниже, в библиотеке.
                </div>
              </div>

              <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="panel">
                  <h3>Размещение на листе</h3>
                  <div className="fld-grid">
                    <label className="fld">
                      <span>Мостик между деталями, мм</span>
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
                      <span>Отступ от края листа, мм</span>
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
                      <span>Поворот деталей</span>
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
                      <span>Волокно при раскладке</span>
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
                      <span>Мин. деловой обрезок, мм</span>
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
                      <span>Что брать первым</span>
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
                      <span>Начальная глубина, мм</span>
                      <input
                        type="number"
                        step={0.5}
                        value={String(depth.start ?? '')}
                        onChange={(event) => patch('depth', 'start', Number(event.target.value))}
                      />
                    </label>
                    <label className="fld">
                      <span>Подрез в стол, мм</span>
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
                      <span>Припуск, мм</span>
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
                      <span>Шаг по Z, мм</span>
                      <input
                        type="number"
                        step={0.25}
                        value={String(depth.step_z ?? '')}
                        onChange={(event) => patch('depth', 'step_z', Number(event.target.value))}
                      />
                    </label>
                    <label className="fld">
                      <span>Точность контура, мм</span>
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
                    <span>Тип обработки</span>
                    <select
                      value={String(strategy.type ?? 'offset')}
                      onChange={(event) => patch('strategy', 'type', event.target.value)}
                    >
                      <option value="offset">смещение</option>
                      <option value="raster">растр</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Направление обхода</span>
                    <select
                      value={String(strategy.direction ?? 'climb')}
                      onChange={(event) => patch('strategy', 'direction', event.target.value)}
                    >
                      <option value="climb">попутный</option>
                      <option value="conventional">встречный</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Точка входа</span>
                    <select
                      value={String(strategy.start_point ?? 'inside')}
                      onChange={(event) => patch('strategy', 'start_point', event.target.value)}
                    >
                      <option value="inside">внутри</option>
                      <option value="outside">снаружи</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Коррекция на радиус</span>
                    <select
                      value={String(strategy.compensation ?? 'cam')}
                      onChange={(event) => patch('strategy', 'compensation', event.target.value)}
                    >
                      <option value="cam">в CAM</option>
                      <option value="g41g42">стойкой G41/G42</option>
                    </select>
                  </label>
                  <label className="fld">
                    <span>Перемычки</span>
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

              <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="panel">
                  <h3>Порядок обработки</h3>
                  {/* Порядок лежит в шаблоне, а на экране он раньше был зашит
                      в код: страница могла показывать не то, что уйдёт в УП. */}
                  <div className="order-list">
                    {(draft.order ?? []).map((semantic, index) => (
                      <div className="order-row" key={semantic}>
                        <span className="num">{index + 1}</span>
                        <span className="grow">{OPERATION_TITLE[semantic] ?? semantic}</span>
                        <button
                          type="button"
                          className="ghost"
                          disabled={index === 0}
                          title="Раньше"
                          onClick={() => moveOrder(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={index === (draft.order ?? []).length - 1}
                          title="Позже"
                          onClick={() => moveOrder(index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Контур обязан быть последним: отрезанная деталь поедет под
                    фрезой и испортит и себя, и соседей.
                  </div>
                </div>

                <div className="panel">
                  <h3>Нули и постпроцессор</h3>
                  <div className="fld-grid">
                    <label className="fld">
                      <span>Плоскость безопасности, мм</span>
                      <input
                        type="number"
                        step={5}
                        value={String(safety.safe_plane ?? '')}
                        onChange={(event) =>
                          patch('safety', 'safe_plane', Number(event.target.value))
                        }
                      />
                    </label>
                    <label className="fld">
                      <span>Ноль детали</span>
                      <select
                        value={String(safety.part_zero ?? 'sheet_corner')}
                        onChange={(event) => patch('safety', 'part_zero', event.target.value)}
                      >
                        <option value="sheet_corner">угол листа</option>
                        <option value="center">центр детали</option>
                      </select>
                    </label>
                    <label className="fld">
                      <span>Стойка</span>
                      <input
                        value={String(post.controller ?? '')}
                        onChange={(event) => patch('post', 'controller', event.target.value)}
                      />
                    </label>
                    <label className="fld">
                      <span>Расширение файла УП</span>
                      <input
                        value={String(post.extension ?? '')}
                        onChange={(event) => patch('post', 'extension', event.target.value)}
                      />
                    </label>
                    <label className="fld">
                      <span>Файл программы</span>
                      <select
                        value={post.one_file_per_sheet ? 'sheet' : 'job'}
                        onChange={(event) =>
                          patch('post', 'one_file_per_sheet', event.target.value === 'sheet')
                        }
                      >
                        <option value="sheet">свой на каждый лист</option>
                        <option value="job">один на весь раскрой</option>
                      </select>
                    </label>
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Генерация УП ещё не подключена: сначала нужен образец
                    программы с вашего станка. Значения здесь уже хранятся и
                    попадут в неё, когда постпроцессор появится.
                  </div>
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
  const [saved, setSaved] = useState<string | null>(null)

  const tools = library?.tools ?? []
  const dirty = useMemo(() => {
    if (!form || openId === null) return false
    const source = tools.find((tool) => tool.id === openId)
    return Boolean(source) && JSON.stringify(source) !== JSON.stringify(form)
  }, [form, openId, tools])

  const open = (tool: Tool) => {
    // Несохранённые режимы соседней фрезы пропадали молча.
    if (dirty && tool.id !== openId && !window.confirm('Правки фрезы не сохранены. Уйти?')) {
      return
    }
    setOpenId(tool.id === openId ? null : tool.id)
    setForm(structuredClone(tool))
    setSaved(null)
  }

  const save = async (override?: Tool) => {
    const source = override ?? form
    if (!source) return
    setBusy(true)
    setFailure(null)
    try {
      await api.updateTool(source.id, {
        name: source.name,
        type: source.type,
        diameter: source.diameter,
        slot: source.slot,
        flute_length: source.flute_length,
        total_length: source.total_length,
        flutes: source.flutes,
        shank: source.shank,
        article: source.article,
        rpm: source.rpm,
        feed: source.feed,
        plunge_feed: source.plunge_feed,
        step_down: source.step_down,
        resource_used: source.resource.used,
        resource_limit: source.resource.limit,
        resource_unit: source.resource.unit,
        modes: source.modes,
      })
      setForm(structuredClone(source))
      // Раньше карточка просто закрывалась, и было непонятно, записалось ли.
      setSaved(`«${source.name}» сохранена.`)
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
            {slot.tool_id ? (
              <span>
                {slot.name}
                <em>⌀ {num(slot.diameter, 1)} мм</em>
              </span>
            ) : (
              <span>свободен</span>
            )}
          </div>
        ))}
      </div>

      {failure && <div className="notice error">{failure}</div>}
      {saved && <div className="notice ok">{saved}</div>}

      <table>
        <thead>
          <tr>
            <th>Гнездо</th>
            <th>Фреза</th>
            <th>Тип</th>
            <th className="num">⌀, мм</th>
            <th className="num">Длина реза, мм</th>
            <th className="num">Обороты, об/мин</th>
            <th className="num">Подача, мм/мин</th>
            <th className="num">Шаг Z, мм</th>
            <th>Наработка</th>
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
            <button type="button" className="primary" disabled={busy} onClick={() => save()}>
              Сохранить фрезу
            </button>
            <button
              type="button"
              disabled={busy}
              title="Обнулить наработку и сразу записать это"
              // Кнопка только правила черновик: наработка возвращалась при
              // любом переоткрытии карточки, потому что на сервер ничего не
              // уходило. Замена фрезы — событие, а не намерение.
              onClick={() => save({ ...form, resource: { ...form.resource, used: 0 } })}
            >
              Фреза заменена — обнулить наработку
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
