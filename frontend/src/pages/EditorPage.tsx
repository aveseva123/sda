import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import AlignBar from '../components/editor/AlignBar'
import BufferPanel from '../components/editor/BufferPanel'
import CanvasStage, { type Move, type StageHandle } from '../components/editor/CanvasStage'
import PropertiesPanel from '../components/editor/PropertiesPanel'
import type { Collision, Layout, Selection, ToolpathPreset } from '../editor/types'
import { emptySelection } from '../editor/types'
import type { CuttingPreset, Material, SourceFile } from '../api/types'
import { useLoader } from '../lib/hooks'

interface JobRow {
  id: number
  name: string | null
  thickness: number
  material_id: number
  utilization: number | null
}

export default function EditorPage() {
  const stage = useRef<StageHandle>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [jobId, setJobId] = useState<number | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [collisions, setCollisions] = useState<Collision[]>([])
  const [presets, setPresets] = useState<ToolpathPreset[]>([])
  const [cuttingPresets, setCuttingPresets] = useState<CuttingPreset[]>([])
  const [files, setFiles] = useState<SourceFile[]>([])
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [focusedPartId, setFocusedPartId] = useState<number | null>(null)
  const [showToolpaths, setShowToolpaths] = useState(true)
  const [scale, setScale] = useState(0.15)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState({ material_id: '', thickness: '' })

  // Зазор между деталями — не константа интерфейса, а параметр пресета:
  // диаметр фрезы контура плюс мостик. Прилипание на холсте обязано
  // совпадать с тем, по чему считалась раскладка.
  const gap = useMemo(() => {
    const params = layout?.job.preset_snapshot?.layout
    if (!params) return 10
    return (params.kerf ?? 8) + (params.part_gap ?? 0)
  }, [layout])

  const loadJobs = useCallback(async () => {
    const rows = await api.nestingJobs()
    setJobs(rows)
    if (rows.length && jobId === null) setJobId(rows[0].id)
  }, [jobId])

  const loadLayout = useCallback(async (id: number) => {
    const [data, issues] = await Promise.all([api.layout(id), api.collisions(id)])
    setLayout(data)
    setCollisions(issues)
    api.files().then(setFiles).catch(() => undefined)
  }, [])

  useEffect(() => {
    api.toolpathPresets().then(setPresets).catch(() => undefined)
    api.cuttingPresets().then(setCuttingPresets).catch(() => undefined)
    api.files().then(setFiles).catch(() => undefined)
    loadJobs().catch((err: Error) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (jobId === null) return
    loadLayout(jobId).catch((err: Error) => setError(err.message))
  }, [jobId, loadLayout])

  const applyMoves = useCallback(
    async (moves: Move[]) => {
      if (jobId === null || !moves.length) return
      // Раскладка правится сразу на экране, ответ сервера её только подтверждает:
      // иначе перетаскивание «залипает» на времени запроса.
      setLayout((current) => {
        if (!current) return current
        const byId = new Map(moves.map((m) => [m.instance_id, m]))
        return {
          ...current,
          instances: current.instances.map((instance) => {
            const move = byId.get(instance.id)
            if (!move) return instance
            return {
              ...instance,
              x: move.x ?? instance.x,
              y: move.y ?? instance.y,
              rotation: move.rotation ?? instance.rotation,
              sheet_index: move.sheet_index ?? instance.sheet_index,
              pinned: move.pinned ?? instance.pinned,
            }
          }),
        }
      })
      try {
        await api.moveInstances(jobId, moves)
        await loadLayout(jobId)
      } catch (err) {
        setError((err as Error).message)
        await loadLayout(jobId)
      }
    },
    [jobId, loadLayout],
  )

  const arrange = async (keepPinned: boolean) => {
    if (jobId === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.arrange(jobId, keepPinned)
      setMessage(
        `Разложено на ${result.sheets} лист(ах), КПД ${(result.utilization * 100).toFixed(1)}%` +
          (result.unplaced ? `, не размещено: ${result.unplaced}` : '') +
          (keepPinned ? '. Закреплённые детали не двигались.' : '.'),
      )
      await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changePreset = async (value: string) => {
    if (jobId === null) return
    setBusy(true)
    setError(null)
    try {
      // У другого пресета другая фреза и другой зазор — раскладка
      // пересчитывается сразу, иначе она перестанет соответствовать УП.
      const result = await api.setJobPreset(jobId, value ? Number(value) : null)
      setMessage(
        result.preset
          ? `Пресет «${result.preset.name}»: фреза контура ⌀${
              (result.preset.layout.kerf ?? 0)
            } мм, зазор ${(result.preset.layout.kerf ?? 0) + (result.preset.layout.part_gap ?? 0)} мм.`
          : 'Пресет снят. Раскладка считается по умолчанию из config/app.yaml.',
      )
      await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createJob = async () => {
    setError(null)
    try {
      const created = await api.createNestingJob({
        material_id: Number(creating.material_id),
        thickness: Number(creating.thickness),
      })
      await loadJobs()
      setJobId(created.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const assignToolpath = async (partId: number, targets: string[], presetId: number) => {
    try {
      await api.assignToolpath(partId, { targets, preset_id: presetId })
      if (jobId !== null) await loadLayout(jobId)
      setMessage(`Траектория применена к ${targets.length} вектор(ам).`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const toggleVector = async (partId: number, targets: string[], enabled: boolean) => {
    const part = layout?.parts[String(partId)]
    const vector = part?.vectors.find((v) => v.target === targets[0])
    if (!vector?.preset_id) return
    try {
      await api.assignToolpath(partId, { targets, preset_id: vector.preset_id, enabled })
      if (jobId !== null) await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const dropFiles = async (files: File[]) => {
    setBusy(true)
    setError(null)
    try {
      const batch = await api.upload(files, `Из редактора ${new Date().toLocaleString('ru')}`)
      const processed = await api.processBatch(batch.id, {})
      const stats = processed.stats ?? {}
      setMessage(
        `Загружено файлов: ${stats.files_total ?? files.length}. ` +
          `Разобрано: ${stats.parsed ?? 0}, требуют уточнения: ${stats.needs_clarification ?? 0}. ` +
          'Нажмите «Разложить», чтобы новые детали встали на листы.',
      )
      if (jobId !== null) await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Горячие клавиши: как в редакторах — стрелки двигают, R вращает.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (!layout) return

      const selected = layout.instances.filter((i) => selection.instances.includes(i.id))

      if (event.key === 'Escape') {
        setSelection(emptySelection)
        setFocusedPartId(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelection({ instances: layout.instances.map((i) => i.id), vectors: [] })
        return
      }
      if (!selected.length) return

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        applyMoves(
          selected.map((i) => ({
            instance_id: i.id,
            rotation: ((i.rotation ?? 0) + (event.shiftKey ? -90 : 90) + 360) % 360,
            pinned: true,
          })),
        )
        return
      }
      const step = event.shiftKey ? 10 : 1
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      }
      const delta = nudge[event.key]
      if (delta) {
        event.preventDefault()
        applyMoves(
          selected.map((i) => ({
            instance_id: i.id,
            x: (i.x ?? 0) + delta[0],
            y: (i.y ?? 0) + delta[1],
            pinned: true,
          })),
        )
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [layout, selection, applyMoves])

  const thicknesses = useMemo(
    () =>
      Array.from(
        new Set(
          (materials ?? [])
            .filter((m) => String(m.id) === creating.material_id)
            .map((m) => m.thickness),
        ),
      ),
    [materials, creating.material_id],
  )

  useEffect(() => {
    if (thicknesses.length === 1) {
      setCreating((prev) => ({ ...prev, thickness: String(thicknesses[0]) }))
    }
  }, [thicknesses])

  // Легенда: какие файлы лежат на листах этого задания и сколько от каждого.
  const legend = useMemo(() => {
    if (!layout) return []
    const counts = new Map<number, { color: string; name: string; count: number }>()
    for (const instance of layout.instances) {
      if (instance.sheet_index === null) continue
      const part = layout.parts[String(instance.part_id)]
      if (!part?.source_file_id) continue
      const row = counts.get(part.source_file_id) ?? {
        color: part.style?.fill ?? '#9AA3AF',
        name: part.source_file ?? `Файл ${part.source_file_id}`,
        count: 0,
      }
      row.count += 1
      counts.set(part.source_file_id, row)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [layout])

  const job = layout?.job

  return (
    <div className="editor">
      {/* Верхняя строка: где мы, каким пресетом считаем и что делаем дальше. */}
      <div className="editor-topbar">
        <select
          className="chip-select"
          value={jobId ?? ''}
          onChange={(event) => {
            setJobId(Number(event.target.value))
            setSelection(emptySelection)
            setFocusedPartId(null)
          }}
        >
          {jobs.length === 0 && <option value="">— заданий нет —</option>}
          {jobs.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name ?? `Задание ${row.id}`}
            </option>
          ))}
        </select>

        {job && (
          <>
            <span className="sep">/</span>
            <span className="what">
              {job.thickness} мм · {job.material_name}
            </span>
          </>
        )}

        <select
          className="chip-select"
          value={job?.preset?.id ?? ''}
          disabled={busy || jobId === null}
          title="Пресет раскроя: фреза, зазор, глубины, порядок обработки"
          onChange={(event) => changePreset(event.target.value)}
        >
          <option value="">— пресет не выбран —</option>
          {cuttingPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              Пресет · {preset.name}
            </option>
          ))}
        </select>

        <div className="spacer">
          <span className="chip" title="Полезная площадь по всем листам задания">
            КИМ{' '}
            <b>
              {job?.utilization
                ? `${(job.utilization * 100).toFixed(1).replace('.', ',')} %`
                : '—'}
            </b>
          </span>
          <span className="chip" title="Хватает ли листов на складе">
            Склад{' '}
            <b>
              {layout ? `${layout.stock.available} / ${layout.stock.needed}` : '—'}
            </b>
          </span>
          <button type="button" onClick={() => arrange(false)} disabled={busy || jobId === null}>
            Уплотнить всё
          </button>
          <button type="button" disabled title="Появится вместе с печатью стикеров">
            Стикеры
          </button>
          <button type="button" className="primary" disabled title="Появится вместе с постпроцессором">
            Сгенерировать УП
          </button>
        </div>
      </div>

      {(error || message) && (
        <div className={`notice ${error ? 'error' : 'ok'} editor-notice`}>
          {error ?? message}
          <button
            type="button"
            onClick={() => {
              setError(null)
              setMessage(null)
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="editor-body">
        <aside className="editor-side left">
          {layout || files.length ? (
            <BufferPanel
              files={files}
              layout={layout}
              selection={selection}
              onSelectionChange={setSelection}
              onFocusPart={setFocusedPartId}
              onFocusSheet={(index) => stage.current?.focusSheet(index)}
              onPickFiles={() => filePicker.current?.click()}
            />
          ) : (
            <div className="panel-scroll">
              <div className="panel-title">Буфер</div>
              <div className="small muted" style={{ padding: '0 12px 12px' }}>
                Перетащите DXF в рабочее поле — файлы попадут в буфер.
              </div>
            </div>
          )}

          {!layout && (
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
              <div className="lbl" style={{ marginBottom: 8 }}>
                Новое задание
              </div>
              <div className="small muted" style={{ marginBottom: 8 }}>
                Раскрой идёт по паре «материал + толщина»: разные толщины никогда не
                попадают на один лист.
              </div>
              <label className="field">
                Материал
                <select
                  value={creating.material_id}
                  onChange={(event) =>
                    setCreating({ material_id: event.target.value, thickness: '' })
                  }
                >
                  <option value="">— выберите —</option>
                  {(materials ?? []).map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} · {material.thickness} мм
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary"
                style={{ width: '100%', marginTop: 10 }}
                disabled={!creating.material_id || !creating.thickness}
                onClick={createJob}
              >
                Создать задание
              </button>
            </div>
          )}
        </aside>

        <div className="stage-wrap">
          {layout ? (
            <CanvasStage
              ref={stage}
              layout={layout}
              collisions={collisions}
              presets={presets}
              selection={selection}
              onSelectionChange={setSelection}
              focusedPartId={focusedPartId}
              onFocusPart={setFocusedPartId}
              onMove={applyMoves}
              onDropFiles={dropFiles}
              showToolpaths={showToolpaths}
              gap={gap}
              onViewportChange={setScale}
            />
          ) : (
            <div className="stage empty">
              Создайте задание на раскрой — и детали лягут на листы.
            </div>
          )}

          <div className="stage-chips">
            <span className="chip">
              <button type="button" onClick={() => stage.current?.zoomBy(1 / 1.25)} title="Отдалить">
                −
              </button>
              <b className="mono">{(scale * 100).toFixed(0)} %</b>
              <button type="button" onClick={() => stage.current?.zoomBy(1.25)} title="Приблизить">
                +
              </button>
              <button type="button" onClick={() => stage.current?.fit()} title="Показать все листы">
                ▢
              </button>
            </span>
            <span className="chip" title="Диаметр фрезы контура плюс мостик из пресета">
              Зазор <b className="mono">{gap} мм</b>
            </span>
            <label className="chip" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showToolpaths}
                onChange={(event) => setShowToolpaths(event.target.checked)}
              />
              Ширина фрезы
            </label>
          </div>

          {legend.length > 0 && (
            <div className="legend">
              <div className="lbl">Файлы на листе</div>
              {legend.map((row) => (
                <div className="legend-row" key={row.name}>
                  <span className="swatch" style={{ background: row.color }} />
                  <span className="mono ellipsis grow">{row.name}</span>
                  <span className="mono" style={{ color: 'var(--ink-3)' }}>
                    {row.count}
                  </span>
                </div>
              ))}
              <div className="legend-note">
                штриховка — второй и следующий листы внутри файла
              </div>
            </div>
          )}

          {layout && (
            <AlignBar
              layout={layout}
              selection={selection}
              onMove={applyMoves}
              onCompact={() => arrange(true)}
              busy={busy}
            />
          )}
        </div>

        <aside className="editor-side right">
          {layout && (
            <PropertiesPanel
              layout={layout}
              selection={selection}
              presets={presets}
              collisions={collisions}
              onMove={applyMoves}
              onSelectionChange={setSelection}
              onFocusPart={setFocusedPartId}
              onAssignToolpath={assignToolpath}
              onToggleVector={toggleVector}
            />
          )}
        </aside>
      </div>

      <input
        ref={filePicker}
        type="file"
        multiple
        accept=".dxf,.zip,.xlsx,.csv"
        style={{ display: 'none' }}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (picked.length) dropFiles(picked)
        }}
      />

      <div className="editor-hints">
        колесо — зум · пробел или средняя кнопка — панорама · клик — выбрать деталь ·
        двойной клик — войти в деталь и выбирать векторы · Shift — добавить к выделению ·
        R — повернуть на 90° · стрелки — сдвинуть на 1 мм (с Shift — на 10) ·
        Esc — снять выделение · перетащите DXF прямо в поле
      </div>
    </div>
  )
}
