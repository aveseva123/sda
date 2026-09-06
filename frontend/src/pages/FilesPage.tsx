import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { Order, SourceFile } from '../api/types'
import { plural } from '../lib/format'
import { useLoader } from '../lib/hooks'

/**
 * Буфер файлов и заказы.
 *
 * CRM-слоя в платформе нет: заказ — это просто имя. Настоящая единица
 * принадлежности — файл DXF: он держит цвет, и именно по нему технолог
 * опознаёт деталь в цеху.
 */
export default function FilesPage() {
  const navigate = useNavigate()
  const [version, setVersion] = useState(0)
  const { data: files, error, loading } = useLoader<SourceFile[]>(() => api.files(), [version])
  const { data: orders } = useLoader<Order[]>(() => api.orders(), [version])
  const { data: palette } = useLoader(() => api.palette(), [])
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const reload = () => setVersion((v) => v + 1)

  const saveOrder = async (file: SourceFile) => {
    await api.updateFile(file.id, { order_name: draft.trim() || null })
    setEditing(null)
    reload()
  }

  const cycleColor = async (file: SourceFile) => {
    const size = palette?.files.length ?? 10
    await api.updateFile(file.id, { color_index: (file.color_index + 1) % size })
    reload()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Файлы и заказы</h2>
          <p>
            Цвет закреплён за файлом, штриховка на карте раскроя — за номером листа
            внутри файла. Заказ — просто имя: ни клиентов, ни изделий, ни сроков
            платформа не ведёт.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="empty">Загрузка…</div>}

      {!!orders?.length && (
        <div className="panel">
          <h3>Заказы</h3>
          <table>
            <thead>
              <tr>
                <th>Заказ</th>
                <th className="num">Файлов</th>
                <th className="num">Позиций</th>
                <th className="num">Деталей</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.name}>
                  <td>
                    <b>{order.name}</b>
                  </td>
                  <td className="num">{order.files}</td>
                  <td className="num">{order.positions}</td>
                  <td className="num">{order.parts}</td>
                  <td>
                    {order.needs_clarification > 0 && (
                      <span
                        className="badge warn"
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate('/pending')}
                      >
                        уточнить: {order.needs_clarification}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>Буфер файлов</h3>
        {files?.length === 0 && !loading && (
          <div className="empty">
            Файлов пока нет. Загрузите пачку DXF на вкладке «Импорт DXF».
          </div>
        )}
        {!!files?.length && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Файл</th>
                <th>Заказ</th>
                <th className="num">Листов</th>
                <th className="num">Позиций</th>
                <th className="num">Деталей</th>
                <th>Источник</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: file.color, cursor: 'pointer' }}
                      title="Сменить цвет файла"
                      onClick={() => cycleColor(file)}
                    />
                  </td>
                  <td className="mono">{file.filename}</td>
                  <td>
                    {editing === file.id ? (
                      <div className="row tight">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveOrder(file)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                        />
                        <button type="button" onClick={() => saveOrder(file)}>
                          ОК
                        </button>
                      </div>
                    ) : (
                      <span
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setEditing(file.id)
                          setDraft(file.order_name ?? '')
                        }}
                      >
                        {file.order_name ?? <span className="muted">— задать —</span>}
                      </span>
                    )}
                  </td>
                  <td className="num">{file.sheets}</td>
                  <td className="num">{file.positions}</td>
                  <td className="num">{file.parts}</td>
                  <td className="small muted">{file.detected_source}</td>
                  <td>
                    {file.needs_clarification > 0 && (
                      <span className="badge warn">
                        {plural(file.needs_clarification, 'деталь', 'детали', 'деталей')}
                      </span>
                    )}
                    {file.error && <span className="badge danger">ошибка</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {palette && (
          <div className="small muted" style={{ marginTop: 10 }}>
            {palette.note}
          </div>
        )}
      </div>
    </>
  )
}
