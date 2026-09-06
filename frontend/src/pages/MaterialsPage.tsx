import { useEffect, useState } from 'react'

import { api } from '../api/client'
import type { Material, SheetFormat } from '../api/types'
import { useLoader } from '../lib/hooks'

/** Типоразмеры листа для материала: задаются здесь, а не зашиты в код. */
function SheetFormats({ material }: { material: Material }) {
  const [formats, setFormats] = useState<SheetFormat[]>([])
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
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const remove = async (formatId: number) => {
    // Сервер отказывает осмысленно — этот отказ обязан долететь до человека,
    // а не утонуть в необработанном промисе.
    try {
      await api.deleteSheetFormat(material.id, formatId)
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <div className="row tight" style={{ marginBottom: 6 }}>
        <span className="chip">
          {material.sheet_w} × {material.sheet_h}
          <span className="muted">основной</span>
        </span>
        {formats.map((format) => (
          <span className="chip" key={format.id}>
            {format.w} × {format.h}
            <button
              type="button"
              className="danger"
              style={{ padding: '0 5px', lineHeight: 1.2 }}
              onClick={() => remove(format.id)}
              title="Удалить формат"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row tight">
        <input
          type="number"
          placeholder="длина"
          style={{ width: 82 }}
          value={draft.w}
          onChange={(event) => setDraft((p) => ({ ...p, w: event.target.value }))}
        />
        <input
          type="number"
          placeholder="ширина"
          style={{ width: 82 }}
          value={draft.h}
          onChange={(event) => setDraft((p) => ({ ...p, h: event.target.value }))}
        />
        <button type="button" onClick={add} disabled={!draft.w || !draft.h}>
          Добавить формат
        </button>
      </div>
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}

const EMPTY = {
  name: '',
  thickness: '18',
  has_grain: false,
  sheet_w: '2800',
  sheet_h: '2070',
  price: '',
  supplier: '',
  trim_left: '10',
  trim_right: '10',
  trim_top: '10',
  trim_bottom: '10',
  stock_sheets: '',
  aliases: '',
}

export default function MaterialsPage() {
  const { data, error, loading, reload } = useLoader<Material[]>(() => api.materials(), [])
  const [form, setForm] = useState({ ...EMPTY })
  const [formError, setFormError] = useState<string | null>(null)

  const set = (key: keyof typeof EMPTY, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    setFormError(null)
    try {
      await api.createMaterial({
        name: form.name.trim(),
        thickness: Number(form.thickness),
        has_grain: form.has_grain,
        sheet_w: Number(form.sheet_w),
        sheet_h: Number(form.sheet_h),
        price: form.price ? Number(form.price) : null,
        supplier: form.supplier || null,
        trim_left: Number(form.trim_left),
        trim_right: Number(form.trim_right),
        trim_top: Number(form.trim_top),
        trim_bottom: Number(form.trim_bottom),
        stock_sheets: form.stock_sheets ? Number(form.stock_sheets) : null,
        aliases: form.aliases
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      })
      setForm({ ...EMPTY })
      reload()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  const remove = async (material: Material) => {
    if (!window.confirm(`Удалить материал «${material.name}» ${material.thickness} мм?`)) return
    try {
      await api.deleteMaterial(material.id)
      setFormError(null)
      reload()
    } catch (err) {
      // «Удалить нельзя: на складе позиций — 12» бесполезно, если его не видно.
      setFormError((err as Error).message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Материалы</h2>
          <p>
            Толщина — часть идентичности материала: раскрой всегда идёт по паре
            «материал + толщина». Список толщин расширяется добавлением материала, ничего
            не зашито в код. Типоразмеры листа задаются здесь же — можно завести
            несколько форматов на один материал. Алиасы помогают распознать материал
            по имени файла.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {formError && <div className="notice error">{formError}</div>}

      <div className="panel">
        <h3>Новый материал</h3>
        <div className="row">
          <label className="field">
            Название
            <input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="field">
            Толщина, мм
            <input
              type="number"
              step="0.1"
              style={{ width: 90 }}
              value={form.thickness}
              onChange={(e) => set('thickness', e.target.value)}
            />
          </label>
          <label className="field">
            Лист, мм
            <div className="row tight">
              <input
                type="number"
                style={{ width: 90 }}
                value={form.sheet_w}
                onChange={(e) => set('sheet_w', e.target.value)}
              />
              <span className="muted">×</span>
              <input
                type="number"
                style={{ width: 90 }}
                value={form.sheet_h}
                onChange={(e) => set('sheet_h', e.target.value)}
              />
            </div>
          </label>
          <label className="field">
            Обрезка кромок, мм (Л/П/В/Н)
            <div className="row tight">
              {(['trim_left', 'trim_right', 'trim_top', 'trim_bottom'] as const).map((key) => (
                <input
                  key={key}
                  type="number"
                  style={{ width: 62 }}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              ))}
            </div>
          </label>
          <label className="field">
            Листов в наличии
            <input
              type="number"
              style={{ width: 110 }}
              value={form.stock_sheets}
              onChange={(e) => set('stock_sheets', e.target.value)}
            />
          </label>
          <label className="field">
            Алиасы (через запятую)
            <input
              placeholder="ldsp, белый, white"
              value={form.aliases}
              onChange={(e) => set('aliases', e.target.value)}
            />
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.has_grain}
              onChange={(e) => set('has_grain', e.target.checked)}
            />
            Текстура (направление волокна)
          </label>
          <button type="button" className="primary" onClick={submit} disabled={!form.name.trim()}>
            Добавить
          </button>
        </div>
      </div>

      <div className="panel">
        {loading && <div className="empty">Загрузка…</div>}
        <table>
          <thead>
            <tr>
              <th>Материал</th>
              <th className="num">Толщина</th>
              <th>Форматы листа, мм</th>
              <th>Текстура</th>
              <th className="num">Обрезка</th>
              <th className="num">В наличии</th>
              <th>Алиасы</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((material) => (
              <tr key={material.id}>
                <td>
                  <b>{material.name}</b>
                  {material.supplier && <div className="small muted">{material.supplier}</div>}
                </td>
                <td className="num">{material.thickness} мм</td>
                <td>
                  <SheetFormats material={material} />
                </td>
                <td>
                  {material.has_grain ? (
                    <span className="badge warn">есть</span>
                  ) : (
                    <span className="badge plain">нет</span>
                  )}
                </td>
                <td className="num small">
                  {material.trim_left}/{material.trim_right}/{material.trim_top}/
                  {material.trim_bottom}
                </td>
                <td className="num">{material.stock_sheets ?? '∞'}</td>
                <td className="small muted">{(material.aliases ?? []).join(', ')}</td>
                <td>
                  <button type="button" className="danger" onClick={() => remove(material)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && (
          <div className="empty">
            Справочник пуст. Добавьте материалы — без них деталь не сможет уйти в раскрой.
          </div>
        )}
      </div>
    </>
  )
}
