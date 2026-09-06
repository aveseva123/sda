import { useEffect, useState } from 'react'

import type { FileCard, FileDecision, Material } from '../../api/types'
import { plural } from '../../lib/format'

interface Props {
  cards: FileCard[]
  materials: Material[]
  jobThickness: number
  jobMaterialId: number
  /** Параметры раскладки текущего раскроя — их можно поправить прямо здесь. */
  placement: Placement
  busy: boolean
  onCancel: () => void
  onConfirm: (decisions: FileDecision[], placement: Placement) => Promise<void>
}

export interface Placement {
  part_gap: number
  sheet_margin: number
  rotation: string
  respect_grain: boolean
}

interface Row {
  keep: boolean
  thickness: string
  order_name: string
  product_name: string
  grain: string
  material_id: string
}

const GRAIN_OPTIONS = [
  { value: 'none', title: 'не важно' },
  { value: 'along', title: 'вдоль длины' },
  { value: 'across', title: 'поперёк длины' },
]

/**
 * Диалог добавления DXF в раскрой.
 *
 * Поля предзаполнены разбором имени файла и глубинами из слоёв, но отвечает
 * оператор: он смотрит на настоящий лист, а платформа — только на чертёж.
 *
 * Один файл — одна толщина. Если в чертеже встречаются разные, диалог это
 * показывает: молчаливая ошибка здесь стоит испорченной детали.
 */
export default function IntakeDialog({
  cards,
  materials,
  jobThickness,
  jobMaterialId,
  placement,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [rows, setRows] = useState<Record<string, Row>>({})
  // Параметры раскладки берутся начальным значением. Раньше их переписывал
  // эффект на каждый перерисованный кадр родителя: введённый мостик
  // возвращался к прежнему прямо под руками.
  const [layout, setLayout] = useState<Placement>(placement)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next: Record<string, Row> = {}
    for (const card of cards) {
      next[card.relpath] = {
        keep: card.parts > 0,
        thickness: String(card.thickness ?? jobThickness),
        order_name: card.order_name ?? '',
        product_name: card.product_name ?? '',
        grain: 'none',
        material_id: String(jobMaterialId),
      }
    }
    setRows(next)
  }, [cards, jobThickness, jobMaterialId])

  const patch = (relpath: string, values: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [relpath]: { ...prev[relpath], ...values } }))

  const chosen = cards.filter((card) => rows[card.relpath]?.keep)

  const submit = async () => {
    setError(null)
    try {
      await onConfirm(
        chosen.map((card) => {
          const row = rows[card.relpath]
          return {
            relpath: card.relpath,
            thickness: Number(row.thickness),
            material_id: Number(row.material_id) || null,
            order_name: row.order_name.trim() || null,
            product_name: row.product_name.trim() || null,
            grain: row.grain,
          }
        }),
        layout,
      )
    } catch (err) {
      // Отказ сервера показывается здесь: плашку за затемнением не видно.
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <b>Добавить в раскрой</b>
          <span className="muted small">
            {plural(cards.length, 'файл', 'файла', 'файлов')} · толщина раскроя{' '}
            {String(jobThickness).replace('.', ',')} мм
          </span>
          <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {cards.map((card) => {
            const row = rows[card.relpath]
            if (!row) return null
            const foreign = Math.abs(Number(row.thickness) - jobThickness) > 0.01
            return (
              <div className={`intake-card${row.keep ? '' : ' off'}`} key={card.relpath}>
                <div className="intake-head">
                  <label className="row tight grow">
                    <input
                      type="checkbox"
                      checked={row.keep}
                      onChange={(event) => patch(card.relpath, { keep: event.target.checked })}
                    />
                    <b className="mono ellipsis">{card.filename}</b>
                  </label>
                  <span className="mono small muted">
                    {card.parts} дет. · ×{card.qty}
                  </span>
                </div>

                <div className="intake-grid">
                  <label className="field">
                    Толщина, мм
                    <input
                      type="number"
                      step={0.1}
                      value={row.thickness}
                      disabled={!row.keep}
                      onChange={(event) =>
                        patch(card.relpath, { thickness: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Материал
                    <select
                      value={row.material_id}
                      disabled={!row.keep}
                      onChange={(event) =>
                        patch(card.relpath, { material_id: event.target.value })
                      }
                    >
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.name} · {material.thickness} мм
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Проект
                    <input
                      value={row.order_name}
                      placeholder="из имени файла"
                      disabled={!row.keep}
                      onChange={(event) =>
                        patch(card.relpath, { order_name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Изделие
                    <input
                      value={row.product_name}
                      placeholder="из имени файла"
                      disabled={!row.keep}
                      onChange={(event) =>
                        patch(card.relpath, { product_name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field" title="Как волокно должно идти по самой детали">
                    Волокно детали
                    <select
                      value={row.grain}
                      disabled={!row.keep}
                      onChange={(event) => patch(card.relpath, { grain: event.target.value })}
                    >
                      {GRAIN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="intake-note">
                  Толщина предложена: {card.thickness_source}
                  {card.detected_thicknesses.length > 0 &&
                    ` · в слоях: ${card.detected_thicknesses
                      .map((value) => `${String(value).replace('.', ',')} мм`)
                      .join(', ')}`}
                </div>

                {card.warnings.map((warning, index) => (
                  <div className="notice warn small" key={index} style={{ marginBottom: 0 }}>
                    {warning}
                  </div>
                ))}

                {row.keep && foreign && (
                  <div className="notice warn small" style={{ marginBottom: 0 }}>
                    Толщина {row.thickness} мм не совпадает с раскроем ({jobThickness} мм):
                    эти детали останутся ждать своего раскроя.
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="intake-layout">
          <div className="lbl" style={{ marginBottom: 8 }}>
            Раскладка этого раскроя
          </div>
          <div className="intake-grid">
            <label className="field">
              Мостик между деталями, мм
              <input
                type="number"
                step={0.5}
                value={layout.part_gap}
                onChange={(event) =>
                  setLayout({ ...layout, part_gap: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              Отступ от края листа, мм
              <input
                type="number"
                step={1}
                value={layout.sheet_margin}
                onChange={(event) =>
                  setLayout({ ...layout, sheet_margin: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              Поворот деталей
              <select
                value={layout.rotation}
                onChange={(event) => setLayout({ ...layout, rotation: event.target.value })}
              >
                <option value="quarter">0 / 90°</option>
                <option value="none">не вертеть</option>
                <option value="free">свободно</option>
              </select>
            </label>
            <label
              className="field"
              title="Разрешать ли раскладке разворачивать детали поперёк волокна"
            >
              Волокно при раскладке
              <select
                value={layout.respect_grain ? 'yes' : 'no'}
                onChange={(event) =>
                  setLayout({ ...layout, respect_grain: event.target.value === 'yes' })
                }
              >
                <option value="yes">учитывать</option>
                <option value="no">не важно</option>
              </select>
            </label>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            Правки действуют на этот раскрой. Общий шаблон траекторий остаётся
            прежним. Зазор между деталями = диаметр фрезы контура + мостик.
          </div>
        </div>

        {error && (
          <div className="notice error" style={{ margin: '0 18px 10px' }}>
            {error}
          </div>
        )}

        <div className="modal-foot">
          <span className="small muted grow">
            {chosen.length === 0
              ? 'Отметьте галочкой файлы, которые идут в этот раскрой.'
              : 'Один файл — одна толщина. Проект и изделие нужны, чтобы после ' +
                'раскроя разложить детали по местам.'}
          </span>
          <button type="button" onClick={onCancel} disabled={busy}>
            Не добавлять
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || chosen.length === 0}
            onClick={submit}
          >
            {busy
              ? 'Считаю…'
              : `Добавить ${plural(chosen.length, 'файл', 'файла', 'файлов')}`}
          </button>
        </div>
      </div>
    </div>
  )
}
