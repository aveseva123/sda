import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import ShapeCanvas from '../components/ShapeCanvas'
import type { Material, Part, PartGeometry, Project } from '../api/types'
import { mm, sourceLabel } from '../lib/format'
import { useLoader } from '../lib/hooks'

export default function PartsPage() {
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('project') ?? ''
  const productFilter = params.get('product') ?? ''
  const thicknessFilter = params.get('thickness') ?? ''
  const statusFilter = params.get('status') ?? ''

  const [selected, setSelected] = useState<PartGeometry | null>(null)

  const { data: projects } = useLoader<Project[]>(() => api.projects(), [])
  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])
  const { data: parts, error, loading } = useLoader<Part[]>(
    () =>
      api.parts({
        project_id: projectFilter || undefined,
        product_id: productFilter || undefined,
        thickness: thicknessFilter || undefined,
        status: statusFilter || undefined,
      }),
    [projectFilter, productFilter, thicknessFilter, statusFilter],
  )

  const thicknesses = useMemo(
    () => Array.from(new Set((materials ?? []).map((m) => m.thickness))).sort((a, b) => a - b),
    [materials],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Part[]>()
    for (const part of parts ?? []) {
      const key = part.thickness === null ? 'без толщины' : `${part.thickness} мм`
      const bucket = map.get(key) ?? []
      bucket.push(part)
      map.set(key, bucket)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'))
  }, [parts])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const openGeometry = async (part: Part) => {
    setSelected(await api.partGeometry(part.id))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Детали</h2>
          <p>
            Детали сгруппированы по толщине — именно так они уйдут в раскрой: разные
            толщины никогда не попадают на один лист.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="row">
          <label className="field">
            Проект
            <select value={projectFilter} onChange={(e) => setFilter('project', e.target.value)}>
              <option value="">все</option>
              {(projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Толщина
            <select
              value={thicknessFilter}
              onChange={(e) => setFilter('thickness', e.target.value)}
            >
              <option value="">все</option>
              {thicknesses.map((value) => (
                <option key={value} value={value}>
                  {value} мм
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Статус
            <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">все</option>
              <option value="ready">готовы к раскрою</option>
              <option value="needs_clarification">требуют уточнения</option>
            </select>
          </label>
          {productFilter && (
            <button type="button" onClick={() => setFilter('product', '')}>
              Сбросить фильтр по изделию
            </button>
          )}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      <div className="split">
        <div>
          {grouped.length === 0 && !loading && (
            <div className="panel empty">Деталей по заданным фильтрам нет.</div>
          )}
          {grouped.map(([thickness, group]) => (
            <div className="panel" key={thickness}>
              <h3>
                {thickness}{' '}
                <span className="badge plain">{group.length} поз. </span>{' '}
                <span className="badge plain">
                  {group.reduce((sum, part) => sum + part.qty, 0)} шт.
                </span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Деталь</th>
                    <th>Проект / изделие</th>
                    <th className="num">Кол-во</th>
                    <th className="num">Габарит, мм</th>
                    <th>Материал</th>
                    <th>Толщина взята из</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.map((part) => (
                    <tr key={part.id}>
                      <td>
                        <div className="row tight">
                          {part.style && (
                            <span
                              className="swatch"
                              style={{ background: part.style.fill }}
                              title={`${part.project_name} / ${part.product_name}`}
                            />
                          )}
                          <b>{part.name}</b>
                        </div>
                        {part.source_file && (
                          <div className="small muted mono">{part.source_file}</div>
                        )}
                      </td>
                      <td className="small">
                        {part.project_name}
                        <div className="muted">{part.product_name}</div>
                      </td>
                      <td className="num">{part.qty}</td>
                      <td className="num">
                        {mm(part.length)} × {mm(part.width)}
                      </td>
                      <td className="small">{part.material_name ?? <span className="badge warn">не назначен</span>}</td>
                      <td className="small muted">
                        {sourceLabel(part.thickness_source)}
                        {part.thickness_confidence > 0 && part.thickness_source !== 'manual' && (
                          <span> · {(part.thickness_confidence * 100).toFixed(0)}%</span>
                        )}
                      </td>
                      <td>
                        <button type="button" onClick={() => openGeometry(part)}>
                          Контур
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>Контур детали</h3>
          {selected?.geometry ? (
            <>
              <ShapeCanvas
                outer={selected.geometry.outer}
                inners={selected.geometry.inners}
                operations={selected.geometry.operations}
                height={260}
                label={selected.name}
              />
              <div className="small muted" style={{ marginTop: 8 }}>
                Габарит {mm(selected.geometry.length)} × {mm(selected.geometry.width)} мм,
                площадь {(selected.geometry.area / 1_000_000).toFixed(3)} м².
                <br />
                Красным — присадка, фиолетовым — пазы, серым — вырезы.
              </div>
            </>
          ) : (
            <div className="empty small">Выберите деталь, чтобы увидеть её контур.</div>
          )}
        </div>
      </div>
    </>
  )
}
