import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import CanvasStage, { type Move, type StageHandle } from '../components/editor/CanvasStage'
import ObjectsPanel from '../components/editor/ObjectsPanel'
import PropertiesPanel from '../components/editor/PropertiesPanel'
import type { Collision, Layout, Selection, ToolpathPreset } from '../editor/types'
import { emptySelection } from '../editor/types'
import type { Material } from '../api/types'
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

  const { data: materials } = useLoader<Material[]>(() => api.materials(), [])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [jobId, setJobId] = useState<number | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [collisions, setCollisions] = useState<Collision[]>([])
  const [presets, setPresets] = useState<ToolpathPreset[]>([])
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [focusedPartId, setFocusedPartId] = useState<number | null>(null)
  const [showToolpaths, setShowToolpaths] = useState(true)
  const [scale, setScale] = useState(0.15)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState({ material_id: '', thickness: '' })

  const gap = 10

  const loadJobs = useCallback(async () => {
    const rows = await api.nestingJobs()
    setJobs(rows)
    if (rows.length && jobId === null) setJobId(rows[0].id)
  }, [jobId])

  const loadLayout = useCallback(async (id: number) => {
    const [data, issues] = await Promise.all([api.layout(id), api.collisions(id)])
    setLayout(data)
    setCollisions(issues)
  }, [])

  useEffect(() => {
    api.toolpathPresets().then(setPresets).catch(() => undefined)
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

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <select
          value={jobId ?? ''}
          onChange={(event) => {
            setJobId(Number(event.target.value))
            setSelection(emptySelection)
            setFocusedPartId(null)
          }}
        >
          {jobs.length === 0 && <option value="">— заданий нет —</option>}
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name ?? `Задание ${job.id}`}
              {job.utilization ? ` · КПД ${(job.utilization * 100).toFixed(0)}%` : ''}
            </option>
          ))}
        </select>

        <div className="divider" />

        <button type="button" onClick={() => arrange(true)} disabled={busy || jobId === null}>
          Разложить
        </button>
        <button type="button" onClick={() => arrange(false)} disabled={busy || jobId === null}>
          Разложить заново
        </button>

        <div className="divider" />

        <button type="button" onClick={() => stage.current?.zoomBy(1 / 1.25)} title="Отдалить">
          −
        </button>
        <span className="zoom-label">{(scale * 100).toFixed(0)}%</span>
        <button type="button" onClick={() => stage.current?.zoomBy(1.25)} title="Приблизить">
          +
        </button>
        <button type="button" onClick={() => stage.current?.fit()}>
          По размеру
        </button>

        <div className="divider" />

        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={showToolpaths}
            onChange={(event) => setShowToolpaths(event.target.checked)}
          />
          Показывать ширину фрезы
        </label>

        <div className="grow" />

        {layout && (
          <span className="muted small">
            {layout.job.material_name} · {layout.job.thickness} мм · листов{' '}
            {layout.sheets.length} · КПД{' '}
            {layout.job.utilization ? (layout.job.utilization * 100).toFixed(1) : '—'}% ·
            склад {layout.stock.available}/{layout.stock.needed}
          </span>
        )}
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
          {layout ? (
            <ObjectsPanel
              layout={layout}
              selection={selection}
              onSelectionChange={setSelection}
              focusedPartId={focusedPartId}
              onFocusPart={setFocusedPartId}
            />
          ) : (
            <div className="panel-scroll">
              <div className="panel-title">Задание на раскрой</div>
              <div className="small muted" style={{ padding: '0 12px 12px' }}>
                Раскрой идёт по паре «материал + толщина»: разные толщины никогда не
                попадают на один лист.
              </div>
              <div style={{ padding: '0 12px' }}>
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
            </div>
          )}
        </aside>

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

        <aside className="editor-side right">
          {layout && (
            <PropertiesPanel
              layout={layout}
              selection={selection}
              presets={presets}
              collisions={collisions}
              onMove={applyMoves}
              onAssignToolpath={assignToolpath}
              onToggleVector={toggleVector}
            />
          )}
        </aside>
      </div>

      <div className="editor-hints">
        колесо — зум · пробел или средняя кнопка — панорама · клик — выбрать деталь ·
        двойной клик — войти в деталь и выбирать векторы · Shift — добавить к выделению ·
        R — повернуть на 90° · стрелки — сдвинуть на 1 мм (с Shift — на 10) ·
        Esc — снять выделение · перетащите DXF прямо в поле
      </div>
    </div>
  )
}
