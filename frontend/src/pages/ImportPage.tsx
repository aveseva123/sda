import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import LayerWizard from '../components/LayerWizard'
import type { DetectedSheet, ImportBatch, LayerSummary, Material } from '../api/types'
import { batchStatusLabel, dxfSourceLabel, fileStatusLabel, plural } from '../lib/format'
import { useLoader } from '../lib/hooks'

/** Рекурсивно собирает файлы из перетащенной папки. */
async function filesFromDataTransfer(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = []

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      // webkitRelativePath у таких файлов пуст — путь передаём через имя.
      Object.defineProperty(file, 'webkitRelativePath', {
        value: prefix ? `${prefix}/${file.name}` : file.name,
        configurable: true,
      })
      out.push(file)
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const children = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    for (const child of children) {
      await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name)
    }
  }

  const entries: FileSystemEntry[] = []
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

export default function ImportPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batch, setBatch] = useState<ImportBatch | null>(null)
  const [summary, setSummary] = useState<LayerSummary | null>(null)
  const [defaults, setDefaults] = useState({ order_name: '', material_id: '' })
  const [sheets, setSheets] = useState<DetectedSheet[]>([])
  const [sheetNotice, setSheetNotice] = useState<string | null>(null)

  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])

  const upload = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const created = await api.upload(files, `Загрузка ${new Date().toLocaleString('ru')}`)
      setBatch(created)
      setSheets([])
      setSheetNotice(null)
      setSummary(await api.layers(created.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const items = event.dataTransfer.items
    const files = items?.length
      ? await filesFromDataTransfer(items)
      : Array.from(event.dataTransfer.files)
    await upload(files)
  }

  const process = async (overrides: Record<string, string>) => {
    if (!batch) return
    setBusy(true)
    setError(null)
    try {
      const done = await api.processBatch(batch.id, {
        layer_overrides: overrides,
        order_name: defaults.order_name || null,
        material_id: defaults.material_id ? Number(defaults.material_id) : null,
      })
      setBatch(done)
      setSummary(null)
      setSheets(await api.detectedSheets(batch.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stats = batch?.stats ?? {}

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Импорт DXF</h2>
          <p>
            Перетащите файлы, папку целиком или ZIP-архив. Вместе с DXF можно загрузить
            спецификацию Базиса (CSV, XLSX, XML) — из неё подтянутся изделия, количество и
            карта кромок.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="panel">
        <div
          data-drop
          className={`dropzone${dragOver ? ' over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <p>
            <b>Перетащите сюда файлы или папку</b>
          </p>
          <p className="muted small">DXF · ZIP · CSV · XLSX · XML</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
              Выбрать файлы
            </button>
            <button type="button" onClick={() => folderRef.current?.click()} disabled={busy}>
              Выбрать папку
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".dxf,.zip,.csv,.xlsx,.xls,.xml"
            onChange={(event) => upload(Array.from(event.target.files ?? []))}
          />
          <input
            ref={folderRef}
            type="file"
            hidden
            // @ts-expect-error нестандартные атрибуты выбора папки
            webkitdirectory=""
            directory=""
            multiple
            onChange={(event) => upload(Array.from(event.target.files ?? []))}
          />
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <label className="field">
            Проект по умолчанию
            <input
              placeholder="если не удастся определить из файлов"
              value={defaults.order_name}
              onChange={(event) =>
                setDefaults((prev) => ({ ...prev, order_name: event.target.value }))
              }
            />
          </label>
          <label className="field">
            Материал по умолчанию
            <select
              value={defaults.material_id}
              onChange={(event) =>
                setDefaults((prev) => ({ ...prev, material_id: event.target.value }))
              }
            >
              <option value="">— определять автоматически —</option>
              {(materials ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.thickness} мм
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {batch && (
        <div className="panel">
          <h3>
            Загрузка №{batch.id} — {batchStatusLabel(batch.status)}{' '}
            <span className="badge plain">{dxfSourceLabel(batch.detected_source)}</span>
          </h3>
          <div className="stat-grid">
            <div className="stat">
              <b>{stats.files_total ?? batch.files.length}</b>
              <span>файлов принято</span>
            </div>
            <div className="stat">
              <b>{stats.parsed ?? 0}</b>
              <span>разобрано</span>
            </div>
            <div className="stat">
              <b>{stats.needs_clarification ?? 0}</b>
              <span>требуют уточнения</span>
            </div>
            <div className="stat">
              <b>{stats.duplicates ?? 0}</b>
              <span>дублей схлопнуто</span>
            </div>
            <div className="stat">
              <b>{stats.failed ?? 0}</b>
              <span>ошибок</span>
            </div>
            <div className="stat">
              <b>{stats.spec_rows ?? 0}</b>
              <span>строк спецификации</span>
            </div>
          </div>

          {!!stats.skipped?.length && (
            <div className="notice warn" style={{ marginTop: 12 }}>
              Пропущено: {stats.skipped.join('; ')}
            </div>
          )}
          {!!stats.spec_warnings?.length && (
            <div className="notice warn" style={{ marginTop: 12 }}>
              Спецификация: {stats.spec_warnings.join('; ')}
            </div>
          )}

          {batch.status === 'done' && (
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="primary" onClick={() => navigate('/editor')}>
                В раскрой
              </button>
              {(stats.needs_clarification ?? 0) > 0 && (
                // Отдельного экрана уточнений больше нет: толщину спрашивают
                // при добавлении файла в раскрой. Кнопка вела на удалённую
                // страницу и просто выбрасывала обратно в раскрой.
                <span className="small" style={{ color: 'var(--warn)' }}>
                  У{' '}
                  {plural(stats.needs_clarification ?? 0, 'детали', 'деталей', 'деталей')} не
                  определена толщина — их спросят при добавлении файлов в раскрой.
                </span>
              )}
            </div>
          )}

          {!!batch.files.filter((f) => f.error).length && (
            <table style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Статус</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {batch.files
                  .filter((file) => file.error)
                  .map((file) => (
                    <tr key={file.id}>
                      <td className="mono">{file.relpath}</td>
                      <td>
                        <span className="badge danger">{fileStatusLabel(file.status)}</span>
                      </td>
                      <td className="small">{file.error}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {sheets.length > 0 && (
        <div className="panel">
          <h3>Листы, найденные в чертеже</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Габариты прочитаны со слоя контуров листа, а не выдуманы. Подтвердите
            их — формат добавится в справочник материала, а листы встанут на склад.
          </p>
          {sheetNotice && <div className="notice ok">{sheetNotice}</div>}
          <table>
            <thead>
              <tr>
                <th className="num">Габарит, мм</th>
                <th className="num">Толщина</th>
                <th className="num">Листов в чертеже</th>
                <th>Материал</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet, index) => (
                <SheetRow
                  key={index}
                  sheet={sheet}
                  materials={materials ?? []}
                  onDone={setSheetNotice}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {batch && summary && (
        <LayerWizard
          batchId={batch.id}
          summary={summary}
          busy={busy}
          onApply={(overrides) => process(overrides)}
        />
      )}
    </>
  )
}


/** Строка найденного листа: завести формат и оприходовать на склад. */
function SheetRow({
  sheet,
  materials,
  onDone,
}: {
  sheet: DetectedSheet
  materials: Material[]
  onDone: (message: string) => void
}) {
  // По толщине из чертежа подбирается материал: если он один, выбирать нечего.
  const candidates = materials.filter(
    (material) => sheet.thickness !== null && Math.abs(material.thickness - sheet.thickness) < 0.01,
  )
  const [materialId, setMaterialId] = useState(
    candidates.length === 1 ? String(candidates[0].id) : '',
  )
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = Number(materialId)
      // Формат может уже существовать — это не ошибка сценария.
      await api.addSheetFormat(id, { w: sheet.w, h: sheet.h }).catch(() => undefined)
      await api.stockReceive({
        material_id: id,
        w: sheet.w,
        h: sheet.h,
        qty: Number(qty),
        note: `из чертежа: ${sheet.files.slice(0, 2).join(', ')}`,
      })
      onDone(`Формат ${sheet.w} × ${sheet.h} заведён, ${qty} лист(ов) на складе.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td className="num">
        <b>
          {sheet.w} × {sheet.h}
        </b>
      </td>
      <td className="num">{sheet.thickness !== null ? `${sheet.thickness} мм` : '—'}</td>
      <td className="num">{sheet.count}</td>
      <td>
        <select value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
          <option value="">— выберите материал —</option>
          {(candidates.length ? candidates : materials).map((material) => (
            <option key={material.id} value={material.id}>
              {material.name} · {material.thickness} мм
            </option>
          ))}
        </select>
        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      </td>
      <td>
        <div className="row tight">
          <input
            type="number"
            min={1}
            style={{ width: 70 }}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            title="Сколько таких листов оприходовать"
          />
          <button type="button" onClick={apply} disabled={!materialId || busy}>
            Завести и оприходовать
          </button>
        </div>
      </td>
    </tr>
  )
}
