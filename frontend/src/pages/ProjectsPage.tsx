import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { Project } from '../api/types'
import { plural } from '../lib/format'
import { useLoader } from '../lib/hooks'

/** Штриховка изделия — та же, что на карте раскроя и на стикере. */
function PatternSwatch({ fill, pattern }: { fill: string; pattern: string }) {
  const id = `pat-${pattern}-${fill.replace('#', '')}`
  return (
    <svg width={16} height={16} style={{ flex: 'none', borderRadius: 3 }}>
      <defs>
        <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse">
          <rect width={6} height={6} fill={fill} />
          {pattern === 'diagonal' && <path d="M0 6 L6 0" stroke="#fff" strokeWidth={1.4} />}
          {pattern === 'diagonal-back' && <path d="M0 0 L6 6" stroke="#fff" strokeWidth={1.4} />}
          {pattern === 'cross' && (
            <path d="M0 6 L6 0 M0 0 L6 6" stroke="#fff" strokeWidth={1.1} />
          )}
          {pattern === 'dots' && <circle cx={3} cy={3} r={1.2} fill="#fff" />}
          {pattern === 'horizontal' && <path d="M0 3 L6 3" stroke="#fff" strokeWidth={1.4} />}
          {pattern === 'vertical' && <path d="M3 0 L3 6" stroke="#fff" strokeWidth={1.4} />}
          {pattern === 'grid' && <path d="M0 3 L6 3 M3 0 L3 6" stroke="#fff" strokeWidth={1} />}
        </pattern>
      </defs>
      <rect width={16} height={16} fill={`url(#${id})`} stroke="rgba(0,0,0,.25)" />
    </svg>
  )
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoader<Project[]>(() => api.projects(), [])
  const [name, setName] = useState('')

  const create = async () => {
    if (!name.trim()) return
    await api.createProject({ name: name.trim() })
    setName('')
    reload()
  }

  const remove = async (project: Project) => {
    if (!window.confirm(`Удалить проект «${project.name}» вместе со всеми деталями?`)) return
    await api.deleteProject(project.id)
    reload()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Проекты</h2>
          <p>
            Цвет закреплён за проектом, штриховка — за изделием внутри него. Эта пара
            переносится на карту раскроя, в легенду и на стикер, поэтому принадлежность
            детали видна без чтения подписей.
          </p>
        </div>
        <div className="row tight">
          <input
            placeholder="Новый проект"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && create()}
          />
          <button type="button" className="primary" onClick={create}>
            Добавить
          </button>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      {data?.length === 0 && (
        <div className="panel empty">
          Проектов пока нет. Загрузите пачку DXF на вкладке «Импорт DXF».
        </div>
      )}

      {data?.map((project) => (
        <div className="tree-project" key={project.id}>
          <header style={{ borderLeftColor: project.color }}>
            <span className="swatch" style={{ background: project.color }} />
            <strong>{project.name}</strong>
            <span className="muted small">
              {plural(project.parts_count, 'позиция', 'позиции', 'позиций')}
            </span>
            {project.needs_clarification > 0 && (
              <span
                className="badge warn"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/pending')}
              >
                уточнить: {project.needs_clarification}
              </span>
            )}
            <div className="grow" />
            <button type="button" onClick={() => navigate(`/parts?project=${project.id}`)}>
              Детали
            </button>
            <button type="button" className="danger" onClick={() => remove(project)}>
              Удалить
            </button>
          </header>
          <div className="tree-products">
            {project.products.length === 0 && (
              <div className="muted small" style={{ padding: '6px 0' }}>
                В проекте пока нет изделий.
              </div>
            )}
            {project.products.map((product) => (
              <div className="tree-product" key={product.id}>
                {product.style && (
                  <PatternSwatch fill={product.style.fill} pattern={product.style.pattern} />
                )}
                <span>{product.name}</span>
                <div className="grow" />
                <span className="muted small">
                  {plural(product.parts_count, 'позиция', 'позиции', 'позиций')} ·{' '}
                  {plural(product.parts_qty, 'экземпляр', 'экземпляра', 'экземпляров')}
                </span>
                <button
                  type="button"
                  onClick={() => navigate(`/parts?product=${product.id}`)}
                >
                  Открыть
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
