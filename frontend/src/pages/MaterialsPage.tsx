import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { Material, SheetFormat } from '../api/types'
import { plural } from '../lib/format'
import { useLoader } from '../lib/hooks'

/** Число по-русски: запятая вместо точки, целые без хвоста. */
function mmText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(Number.isInteger(value) ? value : value.toFixed(1)).replace('.', ',')
}

/**
 * Типоразмеры листа материала.
 *
 * Раньше поля «длина / ширина / Добавить формат» стояли открытыми в каждой из
 * трёх десятков строк справочника — экран превращался в стену пустых полей.
 * Теперь форматы показаны значками, а поля открываются по нажатию.
 */
function SheetFormats({ material }: { material: Material }) {
  const [formats, setFormats] = useState<SheetFormat[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ w: '', h: '' })
  const [error, setError] = useState<string | null>(null)

  const reload = () => {
    api
      .sheetFormats(material.id)
      .then(setFormats)
      .catch((err: Error) => setError(err.message))
  }

  useEffect(reload, [material.id])

  const add = async () => {
    setError(null)
    try {
      await api.addSheetFormat(material.id, { w: Number(draft.w), h: Number(draft.h) })
      setDraft({ w: '', h: '' })
      setAdding(false)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = async (format: SheetFormat) => {
    // Формат листа — это партия материала на складе. Удаление крестиком без
    // вопроса стирало его молча.
    if (!window.confirm(`Убрать формат ${format.w} × ${format.h} мм?`)) return
    try {
      await api.deleteSheetFormat(material.id, format.id)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <div className="row tight">
        <span className="chip" title="Формат из карточки материала">
          {mmText(material.sheet_w)} × {mmText(material.sheet_h)}
          <span className="muted">основной</span>
        </span>
        {formats.map((format) => (
          <span className="chip" key={format.id}>
            {mmText(format.w)} × {mmText(format.h)}
            <button
              type="button"
              className="ghost"
              style={{ padding: '0 4px', height: 18, lineHeight: 1 }}
              onClick={() => remove(format)}
              title="Убрать формат"
            >
              ✕
            </button>
          </span>
        ))}
        {!adding && (
          <button type="button" className="ghost" onClick={() => setAdding(true)}>
            + формат
          </button>
        )}
      </div>
      {adding && (
        <div className="row tight" style={{ marginTop: 6 }}>
          <input
            type="number"
            placeholder="длина, мм"
            style={{ width: 96 }}
            value={draft.w}
            onChange={(event) => setDraft((p) => ({ ...p, w: event.target.value }))}
          />
          <input
            type="number"
            placeholder="ширина, мм"
            style={{ width: 96 }}
            value={draft.h}
            onChange={(event) => setDraft((p) => ({ ...p, h: event.target.value }))}
          />
          <button type="button" onClick={add} disabled={!draft.w || !draft.h}>
            Добавить
          </button>
          <button type="button" className="ghost" onClick={() => setAdding(false)}>
            Отмена
          </button>
        </div>
      )}
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}

type Draft = {
  name: string
  thickness: string
  has_grain: boolean
  sheet_w: string
  sheet_h: string
  price: string
  supplier: string
  trim_left: string
  trim_right: string
  trim_top: string
  trim_bottom: string
  stock_sheets: string
  aliases: string
}

const EMPTY: Draft = {
  name: '',
  thickness: '18',
  has_grain: false,
  sheet_w: '2070',
  sheet_h: '2800',
  price: '',
  supplier: '',
  trim_left: '10',
  trim_right: '10',
  trim_top: '10',
  trim_bottom: '10',
  stock_sheets: '',
  aliases: '',
}

const toDraft = (material: Material): Draft => ({
  name: material.name,
  thickness: String(material.thickness),
  has_grain: material.has_grain,
  sheet_w: String(material.sheet_w),
  sheet_h: String(material.sheet_h),
  price: material.price === null ? '' : String(material.price),
  supplier: material.supplier ?? '',
  trim_left: String(material.trim_left),
  trim_right: String(material.trim_right),
  trim_top: String(material.trim_top),
  trim_bottom: String(material.trim_bottom),
  stock_sheets: material.stock_sheets === null ? '' : String(material.stock_sheets),
  aliases: (material.aliases ?? []).join(', '),
})

const toPayload = (draft: Draft) => ({
  name: draft.name.trim(),
  thickness: Number(draft.thickness),
  has_grain: draft.has_grain,
  sheet_w: Number(draft.sheet_w),
  sheet_h: Number(draft.sheet_h),
  price: draft.price ? Number(draft.price) : null,
  supplier: draft.supplier.trim() || null,
  trim_left: Number(draft.trim_left),
  trim_right: Number(draft.trim_right),
  trim_top: Number(draft.trim_top),
  trim_bottom: Number(draft.trim_bottom),
  stock_sheets: draft.stock_sheets ? Number(draft.stock_sheets) : null,
  aliases: draft.aliases
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
})

/** Поля материала — общие для «нового» и для правки существующего. */
function MaterialForm({
  draft,
  onChange,
  compact,
}: {
  draft: Draft
  onChange: (values: Partial<Draft>) => void
  compact?: boolean
}) {
  return (
    <div className="fld-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      {!compact && (
        <label className="fld">
          <span>Название</span>
          <input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
      )}
      <label className="fld">
        <span>Толщина, мм</span>
        <input
          type="number"
          step="0.1"
          value={draft.thickness}
          onChange={(e) => onChange({ thickness: e.target.value })}
        />
      </label>
      <label className="fld">
        <span>Длина листа, мм</span>
        <input
          type="number"
          value={draft.sheet_w}
          onChange={(e) => onChange({ sheet_w: e.target.value })}
        />
      </label>
      <label className="fld">
        <span>Ширина листа, мм</span>
        <input
          type="number"
          value={draft.sheet_h}
          onChange={(e) => onChange({ sheet_h: e.target.value })}
        />
      </label>
      {(['trim_left', 'trim_right', 'trim_top', 'trim_bottom'] as const).map((key, index) => (
        <label className="fld" key={key}>
          <span>
            {['Обрезка слева, мм', 'Обрезка справа, мм', 'Обрезка сверху, мм', 'Обрезка снизу, мм'][index]}
          </span>
          <input
            type="number"
            value={draft[key]}
            onChange={(e) => onChange({ [key]: e.target.value } as Partial<Draft>)}
          />
        </label>
      ))}
      <label className="fld">
        <span>Листов, справочно</span>
        <input
          type="number"
          placeholder="не считаем"
          value={draft.stock_sheets}
          onChange={(e) => onChange({ stock_sheets: e.target.value })}
        />
      </label>
      <label className="fld">
        <span>Цена за лист, ₽</span>
        <input
          type="number"
          value={draft.price}
          onChange={(e) => onChange({ price: e.target.value })}
        />
      </label>
      <label className="fld">
        <span>Поставщик</span>
        <input
          value={draft.supplier}
          onChange={(e) => onChange({ supplier: e.target.value })}
        />
      </label>
      <label className="fld" style={{ gridColumn: 'span 2' }}>
        <span>Как называется в файлах (через запятую)</span>
        <input
          placeholder="ldsp, лдсп, белый"
          value={draft.aliases}
          onChange={(e) => onChange({ aliases: e.target.value })}
        />
      </label>
      <label className="fld" style={{ justifyContent: 'flex-end' }}>
        <span>Текстура</span>
        <span className="row tight" style={{ height: 28, alignItems: 'center' }}>
          <input
            type="checkbox"
            style={{ width: 16, height: 16 }}
            checked={draft.has_grain}
            onChange={(e) => onChange({ has_grain: e.target.checked })}
          />
          <span className="small muted">волокно вдоль длины</span>
        </span>
      </label>
    </div>
  )
}

/**
 * Справочник материалов.
 *
 * Раскрой всегда идёт по паре «материал + толщина», поэтому толщина — часть
 * идентичности материала, а не его свойство. Справочник заводится сразу
 * полным: три десятка позиций, и листать их плоским списком невозможно —
 * они сгруппированы по названию и ищутся по толщине.
 */
export default function MaterialsPage() {
  const { data, error, loading, reload } = useLoader<Material[]>(() => api.materials(), [])
  const [form, setForm] = useState<Draft>({ ...EMPTY })
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const submit = async () => {
    setFormError(null)
    try {
      await api.createMaterial(toPayload(form))
      // Название и формат листа сохраняются: заводят обычно не один материал,
      // а весь ряд толщин подряд, и стирать всю форму каждый раз — издевательство.
      setForm((prev) => ({ ...EMPTY, name: prev.name, sheet_w: prev.sheet_w, sheet_h: prev.sheet_h }))
      setNote(`Материал «${form.name.trim()}» ${mmText(Number(form.thickness))} мм добавлен.`)
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const saveEdit = async () => {
    if (editing === null || !editDraft) return
    setFormError(null)
    try {
      await api.updateMaterial(editing, toPayload(editDraft))
      setEditing(null)
      setEditDraft(null)
      setNote('Материал изменён.')
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const remove = async (material: Material) => {
    if (!window.confirm(`Удалить материал «${material.name}» ${mmText(material.thickness)} мм?`)) {
      return
    }
    try {
      await api.deleteMaterial(material.id)
      setFormError(null)
      setNote(null)
      reload()
    } catch (err) {
      // «Удалить нельзя: на складе позиций — 12» бесполезно, если его не видно.
      setFormError((err as Error).message)
    }
  }

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const map = new Map<string, Material[]>()
    for (const material of data ?? []) {
      // Поиск по названию и по толщине: «18» находит все восемнадцатые.
      const hay = `${material.name} ${material.thickness}`.toLowerCase()
      if (needle && !hay.includes(needle)) continue
      map.set(material.name, [...(map.get(material.name) ?? []), material])
    }
    const groups: Array<[string, Material[]]> = Array.from(map.entries()).map(
      ([name, rows]) => [name, [...rows].sort((a, b) => a.thickness - b.thickness)],
    )
    return groups.sort((a, b) => a[0].localeCompare(b[0], 'ru'))
  }, [data, query])

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Материалы</h2>
          <p>
            Раскрой идёт по паре «материал + толщина», поэтому каждая толщина —
            отдельная запись со своим форматом листа, обрезкой кромок и остатком
            на складе. Названия из имён файлов распознаются по списку в поле «как
            называется в файлах».
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {formError && <div className="notice error">{formError}</div>}
      {note && <div className="notice ok">{note}</div>}

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          placeholder="Найти материал или толщину"
          style={{ width: 260 }}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted small">
          {plural(data?.length ?? 0, 'позиция', 'позиции', 'позиций')} в справочнике
        </span>
        <button
          type="button"
          style={{ marginLeft: 'auto' }}
          onClick={() => setAddOpen((prev) => !prev)}
        >
          {addOpen ? 'Свернуть' : 'Добавить материал'}
        </button>
      </div>

      {addOpen && (
        <div className="panel">
          <h3>Новый материал</h3>
          <MaterialForm draft={form} onChange={(values) => setForm((p) => ({ ...p, ...values }))} />
          <button
            type="button"
            className="primary"
            style={{ marginTop: 12 }}
            onClick={submit}
            disabled={!form.name.trim() || !form.thickness}
          >
            Добавить
          </button>
        </div>
      )}

      {loading && <div className="panel empty">Загрузка…</div>}

      {grouped.map(([name, rows]) => (
        <div className="panel" key={name}>
          <h3>
            {name} <span className="badge plain">{plural(rows.length, 'толщина', 'толщины', 'толщин')}</span>
          </h3>
          <table>
            <thead>
              <tr>
                <th className="num">Толщина</th>
                <th>Форматы листа, мм</th>
                <th className="num">Обрезка кромок, мм</th>
                <th className="num" title="Справочное число из карточки материала. Настоящий остаток ведётся на экране «Склад»">
                  Листов, справочно
                </th>
                <th>Распознаётся как</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((material) => (
                <tr key={material.id}>
                  <td className="num">
                    <b>{mmText(material.thickness)} мм</b>
                    {material.has_grain && (
                      <div>
                        <span className="badge warn">текстура</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <SheetFormats material={material} />
                  </td>
                  <td
                    className="num small mono"
                    title="Слева / справа / сверху / снизу"
                  >
                    {mmText(material.trim_left)} · {mmText(material.trim_right)} ·{' '}
                    {mmText(material.trim_top)} · {mmText(material.trim_bottom)}
                  </td>
                  <td className="num">
                    {material.stock_sheets === null ? (
                      <span className="muted small" title="Остаток по этому материалу не ведётся">
                        не считаем
                      </span>
                    ) : (
                      material.stock_sheets
                    )}
                  </td>
                  <td className="small muted">
                    {(material.aliases ?? []).join(', ') || '—'}
                  </td>
                  <td>
                    <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(material.id)
                          setEditDraft(toDraft(material))
                        }}
                      >
                        Изменить
                      </button>
                      <button type="button" className="ghost" onClick={() => remove(material)}>
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!loading && grouped.length === 0 && (
        <div className="panel empty">
          {data?.length
            ? 'По этому запросу ничего нет.'
            : 'Справочник пуст. Без материалов деталь не сможет уйти в раскрой.'}
        </div>
      )}

      {editing !== null && editDraft && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-head">
              <b>
                {editDraft.name} · {mmText(Number(editDraft.thickness))} мм
              </b>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditing(null)
                  setEditDraft(null)
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <MaterialForm
                draft={editDraft}
                onChange={(values) => setEditDraft((p) => (p ? { ...p, ...values } : p))}
              />
              <div className="small muted" style={{ marginTop: 10 }}>
                Правка меняет только справочник. Раскрои, уже посчитанные по этому
                материалу, остаются как были.
              </div>
            </div>
            <div className="modal-foot">
              <span className="grow" />
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setEditDraft(null)
                }}
              >
                Отмена
              </button>
              <button type="button" className="primary" onClick={saveEdit}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
