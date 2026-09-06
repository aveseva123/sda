import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { CuttingPreset, ToolLibrary } from '../api/types'
import { useLoader } from '../lib/hooks'

const ORDER_TITLE: Record<string, string> = {
  DRILL: 'Присадка',
  GROOVE: 'Паз',
  POCKET: 'Выборка',
  INNER: 'Внутренний вырез',
  OUTER: 'Раскрой по контуру',
  MARK: 'Гравировка',
}

const STRATEGY_TITLE: Record<string, string> = {
  offset: 'смещение',
  raster: 'растр',
  climb: 'попутное',
  conventional: 'встречное',
  inside: 'внутри',
  outside: 'снаружи',
  cam: 'в CAM',
  g41g42: 'стойкой G41/G42',
  none: 'нет',
  threshold: 'по порогу',
  quarter: '0 / 90°',
  free: 'свободно',
  sheet_corner: 'угол листа',
  center: 'центр',
}

function title(value: unknown): string {
  const key = String(value ?? '')
  return STRATEGY_TITLE[key] ?? (key || '—')
}

function num(value: unknown, digits = 2): string {
  if (value === null || value === undefined || value === '') return '—'
  return Number(value).toFixed(digits).replace(/[.,]?0+$/, '').replace('.', ',')
}

/**
 * Пресеты раскроя.
 *
 * Словарь параметров — из ArtCAM, но это не диалог на каждую траекторию:
 * технолог настраивает раскрой материала один раз, а платформа подбирает
 * пресет по паре «материал + толщина». Задание запоминает пресет, с которым
 * посчитано, — старую УП можно повторить точь-в-точь.
 */
export default function PresetsPage() {
  const { data: presets, error, loading } = useLoader<CuttingPreset[]>(
    () => api.cuttingPresets(),
    [],
  )
  const { data: library } = useLoader<ToolLibrary>(() => api.tools(), [])
  const [slug, setSlug] = useState<string | null>(null)

  const preset = useMemo(
    () => (presets ?? []).find((item) => item.slug === slug) ?? (presets ?? [])[0] ?? null,
    [presets, slug],
  )

  const placement = (preset?.placement ?? {}) as Record<string, string | number | boolean>
  const depth = (preset?.depth ?? {}) as Record<string, number>
  const strategy = (preset?.strategy ?? {}) as Record<string, unknown>
  const safety = (preset?.safety ?? {}) as Record<string, unknown>
  const post = (preset?.post ?? {}) as Record<string, unknown>
  const lead = (strategy.lead ?? {}) as Record<string, unknown>
  const applies = (preset?.applies_to ?? {}) as Record<string, unknown>

  const toolName = (slotName: unknown, diameter: unknown): string => {
    const tool = (library?.tools ?? []).find(
      (item) => item.slot !== null && `T${item.slot}` === slotName,
    )
    return tool ? tool.name : `⌀${num(diameter, 1)}`
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Пресеты раскроя</h2>
          <p>
            Словарь параметров взят из ArtCAM, но это не диалог на каждую
            траекторию: пресет настраивается на материал один раз и дальше
            подбирается сам по толщине и материалу.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      <div className="split" style={{ gridTemplateColumns: '260px 1fr' }}>
        <div className="panel">
          <h3>
            Пресеты <span className="badge plain">{presets?.length ?? 0}</span>
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

          {preset && (
            <>
              <h3 style={{ marginTop: 16 }}>Порядок траекторий</h3>
              {preset.order.map((semantic, index) => (
                <div className="row tight" key={semantic} style={{ padding: '3px 0' }}>
                  <span className="mono muted small" style={{ width: 16 }}>
                    {index + 1}
                  </span>
                  <span className="small">{ORDER_TITLE[semantic] ?? semantic}</span>
                </div>
              ))}
              <div className="small muted" style={{ marginTop: 8 }}>
                Контур режется последним: иначе отрезанная деталь поедет под
                фрезой.
              </div>
            </>
          )}
        </div>

        <div>
          {preset ? (
            <>
              <div className="panel">
                <h3>
                  {preset.name}{' '}
                  {preset.is_builtin ? (
                    <span className="badge plain">из конфига</span>
                  ) : (
                    <span className="badge ok">правлен вручную</span>
                  )}
                </h3>
                <div className="stat-grid">
                  <div className="stat">
                    <b>
                      {preset.last_utilization
                        ? `${(preset.last_utilization * 100).toFixed(1).replace('.', ',')} %`
                        : '—'}
                    </b>
                    <span>КИМ последнего раскроя</span>
                  </div>
                  <div className="stat">
                    <b>{applies.thickness ? `${applies.thickness} мм` : '—'}</b>
                    <span>толщина</span>
                  </div>
                  <div className="stat">
                    <b className="mono" style={{ fontSize: 15 }}>
                      {String(applies.material_regex ?? '—').replace('(?i)', '')}
                    </b>
                    <span>материал по названию</span>
                  </div>
                </div>
                <div className="small muted" style={{ marginTop: 10 }}>
                  При добавлении файлов пресет подбирается по толщине и материалу.
                  Технолог может сменить его на любом раскрое — задание запомнит,
                  с каким пресетом было посчитано.
                </div>
              </div>

              <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div className="panel">
                    <h3>Размещение на листе</h3>
                    <div className="params">
                      <span>Мостик между деталями</span>
                      <span>{num(placement.part_gap)} мм</span>
                      <span>Рез (фреза контура)</span>
                      <span>
                        {num((preset.tools as Record<string, { diameter?: number }>)?.OUTER?.diameter, 1)} мм
                      </span>
                      <span>Отступ от края</span>
                      <span>{num(placement.sheet_margin)} мм</span>
                      <span>Поворот деталей</span>
                      <span>{title(placement.rotation)}</span>
                      <span>Учитывать волокно</span>
                      <span>{placement.respect_grain ? 'да' : 'нет'}</span>
                      <span>Сначала остатки</span>
                      <span>{placement.offcuts_first ? 'да' : 'нет'}</span>
                      <span>Мин. остаток в склад</span>
                      <span>{num(placement.min_offcut)} мм</span>
                    </div>
                  </div>

                  <div className="panel">
                    <h3>Глубина резания</h3>
                    <div className="params">
                      <span>Начальная глубина</span>
                      <span>{num(depth.start)} мм</span>
                      <span>Подрез в стол</span>
                      <span>{num(depth.end_extra)} мм</span>
                      <span>Припуск</span>
                      <span>{num(depth.allowance)} мм</span>
                      <span>Шаг по Z</span>
                      <span>{num(depth.step_z)} мм</span>
                      <span>Точность</span>
                      <span>{num(depth.tolerance)} мм</span>
                    </div>
                  </div>

                  <div className="panel">
                    <h3>Безопасность и нули</h3>
                    <div className="params">
                      <span>Плоскость безопасности</span>
                      <span>{num(safety.safe_plane)} мм</span>
                      <span>Точка возврата</span>
                      <span>{(safety.return_point as number[] | undefined)?.join(' · ') ?? '—'}</span>
                      <span>Ноль детали</span>
                      <span>{title(safety.part_zero)}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="panel">
                    <h3>Стратегия обработки</h3>
                    <div className="params">
                      <span>Тип</span>
                      <span>{title(strategy.type)}</span>
                      <span>Направление</span>
                      <span>{title(strategy.direction)}</span>
                      <span>Начальная точка</span>
                      <span>{title(strategy.start_point)}</span>
                      <span>Наклонное врезание</span>
                      <span>{strategy.ramp ? 'да' : 'нет'}</span>
                      <span>Заход / выход</span>
                      <span>
                        {lead.type === 'arc' ? `дуга R${num(lead.radius, 1)}` : title(lead.type)}
                      </span>
                      <span>Коррекция радиуса</span>
                      <span>{title(strategy.compensation)}</span>
                      <span>Мостики</span>
                      <span>{title(strategy.tabs)}</span>
                    </div>
                  </div>

                  <div className="panel">
                    <h3>Фрезы по типам траекторий</h3>
                    <table>
                      <tbody>
                        {Object.entries(preset.tools ?? {}).map(([semantic, entry]) => {
                          const items = Array.isArray(entry) ? entry : [entry]
                          return items.map((item, index) => {
                            const tool = item as { slot?: string; diameter?: number }
                            return (
                              <tr key={`${semantic}-${index}`}>
                                <td>{ORDER_TITLE[semantic] ?? semantic}</td>
                                <td className="mono">{tool.slot ?? '—'}</td>
                                <td className="small">{toolName(tool.slot, tool.diameter)}</td>
                              </tr>
                            )
                          })
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="panel">
                    <h3>Постпроцессор</h3>
                    <div className="params">
                      <span>Стойка</span>
                      <span>{String(post.controller ?? '—')}</span>
                      <span>Расширение</span>
                      <span>{String(post.extension ?? '—')}</span>
                      <span>Файл на лист</span>
                      <span>{post.one_file_per_sheet ? 'да' : 'нет'}</span>
                    </div>
                    <div className="notice warn small" style={{ marginTop: 10 }}>
                      Диалект постпроцессора не сверен с реальным станком: нужен
                      эталонный .nc из NcStudio.
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            !loading && <div className="panel empty">Пресетов нет.</div>
          )}
        </div>
      </div>
    </>
  )
}
