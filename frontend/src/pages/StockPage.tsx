import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { Material, OffcutVerdict, StockItem, StockMovement } from '../api/types'
import { fixed, mm, plural } from '../lib/format'
import { useLoader } from '../lib/hooks'

interface OffcutDraft {
  w: string
  h: string
  note: string
  keep: boolean
  verdict: OffcutVerdict | null
}

const EMPTY_RECEIPT = {
  material_id: '',
  w: '2800',
  h: '2070',
  qty: '1',
  location: '',
  note: '',
}

/** Диалог «лист отрезан»: списать лист и решить судьбу обрезков. */
function CutDialog({
  item,
  onClose,
  onDone,
}: {
  item: StockItem
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [offcuts, setOffcuts] = useState<OffcutDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const addOffcut = () =>
    setOffcuts((prev) => [...prev, { w: '', h: '', note: '', keep: true, verdict: null }])

  const updateOffcut = async (index: number, patch: Partial<OffcutDraft>) => {
    setOffcuts((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
    // Подсказка пересчитывается только когда изменился габарит. Раньше она
    // шла на любую правку и вместе с собой возвращала галочку «Оставить»:
    // снять её было физически невозможно.
    const sizeChanged = 'w' in patch || 'h' in patch
    if (!sizeChanged) return
    const next = { ...offcuts[index], ...patch }
    const w = Number(next.w)
    const h = Number(next.h)
    if (w > 0 && h > 0) {
      try {
        const verdict = await api.judgeOffcut(w, h)
        // Платформа предлагает, но не решает: галочку ставит технолог.
        setOffcuts((prev) =>
          prev.map((row, i) =>
            i === index ? { ...row, verdict, keep: verdict.worth_keeping } : row,
          ),
        )
      } catch {
        /* подсказка необязательна */
      }
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const kept = offcuts.filter((row) => row.keep && Number(row.w) > 0 && Number(row.h) > 0)
      const result = await api.stockConsume(item.id, {
        qty: Number(qty),
        reason: reason || null,
        offcuts: kept.map((row) => ({
          w: Number(row.w),
          h: Number(row.h),
          note: row.note || null,
        })),
      })
      const dropped = offcuts.length - kept.length
      onDone(
        `Списано ${plural(Number(qty), 'лист', 'листа', 'листов')}. ` +
          `На складе оставлено ${plural(
            result.offcuts.length,
            'обрезок',
            'обрезка',
            'обрезков',
          )}` +
          (dropped > 0
            ? `, ${plural(dropped, 'обрезок', 'обрезка', 'обрезков')} не сохранено.`
            : '.'),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <b>
            Списать лист: {item.material_name} {mm(item.thickness)} мм ·{' '}
            {mm(item.w)} × {mm(item.h)} мм
          </b>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>
        <div className="modal-body">
      {error && <div className="notice error">{error}</div>}

      <div className="row">
        <label className="field">
          Сколько листов отрезано
          <input
            type="number"
            min={1}
            max={item.qty}
            style={{ width: 100 }}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
        </label>
        <label className="field grow">
          Комментарий
          <input
            placeholder="например: задание №14, кухня Ивановых"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>

      <h3 style={{ marginTop: 16 }}>Что осталось от листа</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Укажите габарит обрезка. Платформа подскажет, стоит ли его хранить, но
        решение за вами: отмеченные останутся на складе как деловой отход,
        неотмеченные не сохранятся.
      </p>

      {offcuts.length === 0 && (
        <div className="muted small" style={{ marginBottom: 10 }}>
          Обрезков нет — лист израсходован целиком.
        </div>
      )}

      {offcuts.map((row, index) => (
        <div className="row" key={index} style={{ marginBottom: 8 }}>
          <label className="field">
            Длина, мм
            <input
              type="number"
              style={{ width: 100 }}
              value={row.w}
              onChange={(event) => updateOffcut(index, { w: event.target.value })}
            />
          </label>
          <label className="field">
            Ширина, мм
            <input
              type="number"
              style={{ width: 100 }}
              value={row.h}
              onChange={(event) => updateOffcut(index, { h: event.target.value })}
            />
          </label>
          <label className="field grow">
            Пометка
            <input
              placeholder="где лежит, от чего остался"
              value={row.note}
              onChange={(event) => updateOffcut(index, { note: event.target.value })}
            />
          </label>
          <label
            className="field"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 14 }}
          >
            <input
              type="checkbox"
              checked={row.keep}
              onChange={(event) => updateOffcut(index, { keep: event.target.checked })}
            />
            Оставить
          </label>
          <button
            type="button"
            className="danger"
            style={{ marginTop: 14 }}
            onClick={() => setOffcuts((prev) => prev.filter((_, i) => i !== index))}
          >
            Убрать
          </button>
          {row.verdict && (
            <div style={{ flexBasis: '100%' }}>
              <span className={`badge ${row.verdict.worth_keeping ? 'ok' : 'warn'}`}>
                {row.verdict.worth_keeping ? 'деловой отход' : 'мелочь'}
              </span>{' '}
              <span className="small muted">{row.verdict.reason}</span>
            </div>
          )}
        </div>
      ))}

      <button type="button" style={{ marginTop: 12 }} onClick={addOffcut}>
          Добавить обрезок
        </button>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="primary" onClick={submit} disabled={busy}>
            {busy ? 'Списываю…' : 'Списать лист'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StockPage() {
  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])
  const [version, setVersion] = useState(0)
  const { data: items, error, loading } = useLoader<StockItem[]>(
    () => api.stock(),
    [version],
  )
  const { data: summary } = useLoader(() => api.stockSummary(), [version])

  const [form, setForm] = useState({ ...EMPTY_RECEIPT })
  const [cutting, setCutting] = useState<StockItem | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ item: StockItem; rows: StockMovement[] } | null>(
    null,
  )

  const reload = () => setVersion((v) => v + 1)

  const materialById = useMemo(
    () => new Map((materials ?? []).map((m) => [m.id, m])),
    [materials],
  )

  const receive = async () => {
    setFormError(null)
    try {
      await api.stockReceive({
        material_id: Number(form.material_id),
        w: Number(form.w),
        h: Number(form.h),
        qty: Number(form.qty),
        location: form.location || null,
        note: form.note || null,
      })
      setForm({ ...EMPTY_RECEIPT, material_id: form.material_id })
      setMessage('Приход оформлен.')
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const scrap = async (item: StockItem) => {
    if (!window.confirm(`Списать в мусор обрезок ${mm(item.w)} × ${mm(item.h)} мм?`)) return
    setFormError(null)
    try {
      await api.stockScrap(item.id, { qty: item.qty, reason: 'слишком мелкий' })
      setMessage('Обрезок списан в мусор.')
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const showHistory = async (item: StockItem) => {
    setHistory({ item, rows: await api.stockMovements(item.id) })
  }

  const pickMaterialFormat = (materialId: string) => {
    const material = materialById.get(Number(materialId))
    setForm((prev) => ({
      ...prev,
      material_id: materialId,
      w: material ? String(material.sheet_w) : prev.w,
      h: material ? String(material.sheet_h) : prev.h,
    }))
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Склад</h2>
          <p>
            Целые листы и деловой отход лежат вместе: обрезок режут так же, как
            лист, и от него так же остаётся обрезок. Отметьте «лист отрезан» —
            лист уйдёт со склада, а крупный остаток вернётся на него и будет
            предложен в следующем задании первым.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {formError && <div className="notice error">{formError}</div>}
      {message && <div className="notice ok">{message}</div>}

      {!!summary?.length && (
        <div className="panel">
          <h3>Остатки</h3>
          <table>
            <thead>
              <tr>
                <th>Материал</th>
                <th className="num">Толщина</th>
                <th className="num">Целых листов</th>
                <th className="num">Обрезков</th>
                <th className="num">Площадь, м²</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.material_id}>
                  <td>{row.material_name}</td>
                  <td className="num">{mm(row.thickness)} мм</td>
                  <td className="num">{row.sheets}</td>
                  <td className="num">{row.offcuts}</td>
                  <td className="num">{fixed(row.area_m2, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>Приход</h3>
        <div className="row">
          <label className="field">
            Материал
            <select
              value={form.material_id}
              onChange={(event) => pickMaterialFormat(event.target.value)}
            >
              <option value="">— выберите —</option>
              {(materials ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.thickness} мм
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Формат листа, мм
            <div className="row tight">
              <input
                type="number"
                style={{ width: 100 }}
                value={form.w}
                onChange={(event) => setForm((p) => ({ ...p, w: event.target.value }))}
              />
              <span className="muted">×</span>
              <input
                type="number"
                style={{ width: 100 }}
                value={form.h}
                onChange={(event) => setForm((p) => ({ ...p, h: event.target.value }))}
              />
            </div>
          </label>
          <label className="field">
            Количество
            <input
              type="number"
              min={1}
              style={{ width: 90 }}
              value={form.qty}
              onChange={(event) => setForm((p) => ({ ...p, qty: event.target.value }))}
            />
          </label>
          <label className="field">
            Место хранения
            <input
              placeholder="стеллаж, ряд"
              value={form.location}
              onChange={(event) => setForm((p) => ({ ...p, location: event.target.value }))}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={receive}
            disabled={!form.material_id}
          >
            Оприходовать
          </button>
        </div>
      </div>

      {cutting && (
        <CutDialog
          item={cutting}
          onClose={() => setCutting(null)}
          onDone={(text) => {
            setCutting(null)
            setMessage(text)
            reload()
          }}
        />
      )}

      <div className="panel">
        <h3>Наличие</h3>
        {loading && <div className="empty">Загрузка…</div>}
        {items?.length === 0 && !loading && (
          <div className="empty">
            Склад пуст. Оформите приход — без листов раскрою не на чем считаться.
          </div>
        )}
        {!!items?.length && (
          <table>
            <thead>
              <tr>
                <th>Позиция</th>
                <th>Материал</th>
                <th className="num">Габарит, мм</th>
                <th className="num">Площадь, м²</th>
                <th className="num">Кол-во</th>
                <th>Место</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.kind === 'offcut' ? (
                      <span className="badge warn">обрезок</span>
                    ) : (
                      <span className="badge plain">лист</span>
                    )}
                    {item.note && <div className="small muted">{item.note}</div>}
                    <div className="small muted">№{item.id}</div>
                  </td>
                  <td>
                    {item.material_name}
                    <div className="small muted">{mm(item.thickness)} мм</div>
                  </td>
                  <td className="num">
                    {mm(item.w)} × {mm(item.h)}
                  </td>
                  <td className="num">{fixed(item.area_m2, 2)}</td>
                  <td className="num">{item.qty}</td>
                  <td className="small muted">{item.location ?? '—'}</td>
                  <td>
                    <div className="row tight">
                      <button
                        type="button"
                        onClick={() => setCutting(item)}
                        title="Списать лист со склада и записать, какие обрезки от него остались"
                      >
                        Списать: отрезан
                      </button>
                      <button type="button" onClick={() => showHistory(item)}>
                        История
                      </button>
                      {item.kind === 'offcut' && (
                        <button type="button" className="danger" onClick={() => scrap(item)}>
                          В мусор
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history && (
        <div className="panel">
          <h3>
            История позиции №{history.item.id} — {history.item.material_name},{' '}
            {mm(history.item.w)} × {mm(history.item.h)} мм
            <button
              type="button"
              style={{ float: 'right' }}
              onClick={() => setHistory(null)}
            >
              Закрыть
            </button>
          </h3>
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Движение</th>
                <th className="num">Кол-во</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((row) => (
                <tr key={row.id}>
                  <td className="small">{new Date(row.created_at).toLocaleString('ru')}</td>
                  <td>{MOVEMENT_LABELS[row.kind] ?? row.kind}</td>
                  <td className="num">{row.qty > 0 ? `+${row.qty}` : row.qty}</td>
                  <td className="small muted">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: 'приход',
  consume: 'отрезан',
  offcut: 'деловой отход',
  scrap: 'в мусор',
  adjust: 'корректировка',
}
