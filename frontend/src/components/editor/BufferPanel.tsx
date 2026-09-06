import { useMemo, useState } from 'react'

import type { SourceFile } from '../../api/types'
import type { Layout, Selection } from '../../editor/types'

interface Props {
  files: SourceFile[]
  layout: Layout | null
  selection: Selection
  onSelectionChange: (selection: Selection) => void
  onFocusPart: (partId: number | null) => void
  onFocusSheet: (index: number) => void
  onPickFiles: () => void
  onDropFiles: (files: File[]) => void
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      style={{ color: 'var(--ink-3)', flex: 'none' }}
    >
      {open ? <path d="M3 4.5 6 7.5 9 4.5" /> : <path d="M4.5 3 7.5 6 4.5 9" />}
    </svg>
  )
}

function SheetIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      style={{ flex: 'none' }}
    >
      <rect x="3.5" y="2" width="9" height="12" rx="1" />
    </svg>
  )
}

/**
 * Буфер: файлы DXF и листы внутри каждого файла.
 *
 * Файл — настоящая единица принадлежности: он держит цвет, и вопрос «откуда
 * эта деталь» в цеху звучит как «из какого файла». Клик по файлу или по его
 * листу выделяет на раскладке ровно те детали, которые оттуда приехали.
 */
export default function BufferPanel({
  files,
  layout,
  selection,
  onSelectionChange,
  onFocusPart,
  onFocusSheet,
  onPickFiles,
  onDropFiles,
}: Props) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  // Рамка выглядела как место для перетаскивания, но обработчиков не имела:
  // браузер уходил на файл, а раскрой оставался пустым.
  const [over, setOver] = useState(false)

  // Что из буфера реально лежит на листах этого задания.
  const placed = useMemo(() => {
    const byFile = new Map<number, Map<number, number[]>>()
    if (!layout) return byFile
    for (const instance of layout.instances) {
      const part = layout.parts[String(instance.part_id)]
      if (!part?.source_file_id) continue
      const sheets = byFile.get(part.source_file_id) ?? new Map<number, number[]>()
      const key = part.source_sheet_index ?? 0
      sheets.set(key, [...(sheets.get(key) ?? []), instance.id])
      byFile.set(part.source_file_id, sheets)
    }
    return byFile
  }, [layout])

  const totals = useMemo(
    () => ({
      files: files.length,
      parts: files.reduce((sum, file) => sum + file.parts, 0),
    }),
    [files],
  )

  const selected = new Set(selection.instances)

  const pick = (ids: number[], additive: boolean) => {
    if (!ids.length) return
    const next = additive ? [...new Set([...selection.instances, ...ids])] : ids
    onSelectionChange({ instances: next, vectors: [] })
    onFocusPart(null)
  }

  const sheetsOfJob = layout?.sheets ?? []

  // Деталь без листа не рисуется на холсте — её попросту нет на экране.
  // Раньше о ней сообщала одна строка во всплывающем сообщении, оператор
  // закрывал его и резал лист, а деталь всплывала на сборке.
  const unplaced = useMemo(() => {
    if (!layout) return []
    return layout.instances
      .filter((instance) => instance.sheet_index === null)
      .map((instance) => ({ instance, part: layout.parts[String(instance.part_id)] }))
      .filter((row) => Boolean(row.part))
  }, [layout])

  return (
    <div className="panel-scroll">
      <div className="panel-title">
        Файлы
        <span className="count" title={`${totals.files} · ${totals.parts} деталей в раскрое`}>
          {totals.files} · {totals.parts} дет.
        </span>
        <button
          type="button"
          className="ghost"
          style={{ marginLeft: 'auto', padding: '2px 6px' }}
          title="Добавить DXF"
          onClick={onPickFiles}
        >
          +
        </button>
      </div>

      <div className="buffer-drop">
        <div
          data-drop
          className={over ? 'over' : undefined}
          onClick={onPickFiles}
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setOver(false)
            const dropped = Array.from(event.dataTransfer.files)
            if (dropped.length) onDropFiles(dropped)
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#69717D"
            strokeWidth="1.4"
            style={{ flex: 'none' }}
          >
            <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 12v1.5h11V12" />
          </svg>
          <span>
            Перетащите DXF
            <small>или папку / zip</small>
          </span>
        </div>
      </div>

      <div className="tree">
        {files.length === 0 && (
          <div className="small muted" style={{ padding: '4px 8px 10px' }}>
            Файлов пока нет. Перетащите DXF в рабочее поле или в рамку выше.
          </div>
        )}

        {files.map((file) => {
          const sheets = placed.get(file.id)
          const ids = sheets ? [...sheets.values()].flat() : []
          const active = ids.length > 0 && ids.every((id) => selected.has(id))
          const trouble = file.needs_clarification > 0 || file.error !== null
          const isOpen = open[file.id] ?? false
          // Листы внутри файла: сколько деталей приехало с каждого.
          const counts = file.sheet_parts.length
            ? file.sheet_parts
            : Array.from({ length: Math.max(file.sheets, 1) }, () => 0)

          return (
            <div key={file.id}>
              <div
                className={`frow${active ? ' on' : ''}${trouble ? ' warn' : ''}`}
                onClick={(event) => {
                  setOpen((prev) => ({ ...prev, [file.id]: !isOpen }))
                  pick(ids, event.shiftKey || event.metaKey)
                }}
                title={
                  trouble
                    ? `${file.needs_clarification} деталей требуют уточнения`
                    : file.order_name ?? 'без проекта'
                }
              >
                <Chevron open={isOpen} />
                {trouble ? (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="var(--warn)"
                    strokeWidth="1.6"
                    style={{ flex: 'none' }}
                  >
                    <path d="M8 2.5 14.5 13.5h-13z" />
                    <path d="M8 6.5v3M8 11.4v.2" />
                  </svg>
                ) : (
                  <span className="swatch" style={{ background: file.color }} />
                )}
                <span className="mono ellipsis grow" style={{ fontSize: 11.5 }}>
                  {file.filename}
                </span>
                <span className="num">{trouble ? '?' : `${counts.length} л`}</span>
              </div>

              {isOpen &&
                counts.map((count, index) => {
                  const sheetIds = sheets?.get(index) ?? []
                  const sheetActive =
                    sheetIds.length > 0 && sheetIds.every((id) => selected.has(id))
                  return (
                    <div
                      key={index}
                      className={`srow${sheetActive ? ' on' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        pick(sheetIds, event.shiftKey || event.metaKey)
                      }}
                    >
                      <SheetIcon />
                      <span className="grow">Лист {index + 1}</span>
                      <span className="num">{count || sheetIds.length}</span>
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>

      {unplaced.length > 0 && (
        <>
          <div className="lbl warn-lbl" style={{ padding: '14px 12px 8px' }}>
            Не поместились · {unplaced.length}
          </div>
          <div className="tree">
            {unplaced.map(({ instance, part }) => (
              <div
                key={instance.id}
                className="frow warn"
                title="Деталь не влезла ни на один лист: добавьте лист или уменьшите зазор"
              >
                <span className="swatch" style={{ background: part.style?.fill ?? '#9AA3AF' }} />
                <span className="grow mono ellipsis" style={{ fontSize: 11.5 }}>
                  {part.name}
                </span>
                <span className="num">
                  {(part.length ?? 0).toFixed(0)} × {(part.width ?? 0).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="lbl" style={{ padding: '14px 12px 8px' }}>
        На рабочем поле
      </div>
      <div className="tree">
        {sheetsOfJob.length === 0 && (
          <div className="small muted" style={{ padding: '0 8px 8px' }}>
            Листов пока нет.
          </div>
        )}
        {sheetsOfJob.map((sheet) => {
          const onSheet = layout
            ? layout.instances.filter((i) => i.sheet_index === sheet.index).length
            : 0
          return (
            <div
              key={sheet.index}
              className="frow"
              onClick={() => onFocusSheet(sheet.index)}
              title="Показать этот лист целиком"
            >
              <span className="num" style={{ width: 14 }}>
                {sheet.index + 1}
              </span>
              <SheetIcon />
              <span className="grow mono" style={{ fontSize: 11.5 }}>
                {sheet.w.toFixed(0)} × {sheet.h.toFixed(0)}
                {sheet.is_offcut && <span className="muted"> обрезок</span>}
              </span>
              <span className="num muted" style={{ marginRight: 8 }}>
                {onSheet} дет.
              </span>
              <span className="num">
                {sheet.utilization
                  ? `${(sheet.utilization * 100).toFixed(1).replace('.', ',')} %`
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
