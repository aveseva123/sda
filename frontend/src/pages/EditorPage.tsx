import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import AlignBar from '../components/editor/AlignBar'
import BufferPanel from '../components/editor/BufferPanel'
import CanvasStage, { type Move, type StageHandle } from '../components/editor/CanvasStage'
import IntakeDialog, { type Placement } from '../components/editor/IntakeDialog'
import JobFlow from '../components/editor/JobFlow'
import PropertiesPanel from '../components/editor/PropertiesPanel'
import type { Collision, Layout, Selection, ToolpathPreset } from '../editor/types'
import { emptySelection } from '../editor/types'
import type {
  CuttingPreset,
  FileDecision,
  IntakeResult,
  Material,
  SourceFile,
} from '../api/types'
import { useLoader } from '../lib/hooks'

const STAGE_TITLE: Record<string, string> = {
  planning: 'Раскладка',
  in_progress: 'В работе',
  finished: 'Завершён',
}

/** Проценты по-русски: запятая, один знак, прочерк вместо пустоты. */
function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${(value * 100).toFixed(1).replace('.', ',')} %`
}

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
  // Ширина фрезы — режим проверки, а не фон: включённой по умолчанию она
  // закрашивает весь лист и раскладку под ней не видно.
  const [showToolpaths, setShowToolpaths] = useState(false)
  const [scale, setScale] = useState(0.15)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState({ material_id: '', thickness: '', operator: '' })
  // Файлы разбираются до создания деталей: сначала оператор отвечает в диалоге.
  const [intake, setIntake] = useState<IntakeResult | null>(null)

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
    // Буфер — файлы этого раскроя, а не всё, что когда-либо загружали в цеху.
    api.files(id).then(setFiles).catch(() => undefined)
  }, [])

  useEffect(() => {
    api.toolpathPresets().then(setPresets).catch(() => undefined)
    api.cuttingPresets().then(setCuttingPresets).catch(() => undefined)
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
        operator: creating.operator.trim() || null,
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
    if (jobId === null) {
      setError('Сначала заведите раскрой: материал, толщина, оператор.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Первый шаг: файлы разобраны, деталей ещё нет. Что с ними делать,
      // решает оператор в диалоге.
      setIntake(await api.addFiles(jobId, files))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmFiles = async (decisions: FileDecision[], placement: Placement) => {
    if (jobId === null || !intake) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.confirmFiles(jobId, intake.batch_id, decisions, { ...placement })
      setIntake(null)
      setMessage(
        [`Добавлено деталей: ${result.added}.`, ...result.warnings].join('\n'),
      )
      await loadLayout(jobId)
      await loadJobs()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const takeJob = async (operator: string) => {
    if (jobId === null) return
    setBusy(true)
    setError(null)
    try {
      await api.takeJob(jobId, operator)
      await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkItem = async (key: string, done: boolean) => {
    if (jobId === null || !layout) return
    const items: Record<string, boolean> = {}
    for (const item of layout.job.checklist) items[item.key] = item.key === key ? done : item.done
    try {
      await api.setChecklist(jobId, items)
      await loadLayout(jobId)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const finishJob = async () => {
    if (jobId === null) return
    setBusy(true)
    setError(null)
    try {
      await api.finishJob(jobId)
      setMessage('Раскрой завершён. Лист закрыт по чеклисту.')
      await loadLayout(jobId)
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
    const counts = new Map<number, { id: number; color: string; name: string; count: number }>()
    for (const instance of layout.instances) {
      if (instance.sheet_index === null) continue
      const part = layout.parts[String(instance.part_id)]
      if (!part?.source_file_id) continue
      const row = counts.get(part.source_file_id) ?? {
        id: part.source_file_id,
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
  // Нехватка листов — не украшение шапки, а причина не начинать раскрой.
  const shortage = layout ? layout.stock.needed > layout.stock.available : false

  return (
    <div className="editor">
      {/* Верхняя строка: какой лист открыт, чем считаем и что с ним сейчас. */}
      <div className="editor-topbar">
        <label className="picker" title="Открытый раскрой">
          <span>Раскрой</span>
          <select
            value={jobId ?? ''}
            onChange={(event) => {
              setJobId(Number(event.target.value))
              setSelection(emptySelection)
              setFocusedPartId(null)
            }}
          >
            {jobs.length === 0 && <option value="">ещё не заведён</option>}
            {jobs.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name ?? `Задание ${row.id}`}
              </option>
            ))}
          </select>
        </label>

        <label
          className="picker"
          title="Шаблон траекторий: фреза, зазор, глубины, порядок обработки"
        >
          <span>Шаблон</span>
          <select
            value={job?.preset?.id ?? ''}
            disabled={busy || jobId === null}
            onChange={(event) => changePreset(event.target.value)}
          >
            <option value="">не выбран</option>
            {cuttingPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        {job && <span className={`stage-badge ${job.stage}`}>{STAGE_TITLE[job.stage]}</span>}

        <div className="spacer">
          <span className="chip" title="Полезная площадь по всем листам задания">
            КИМ <b>{percent(job?.utilization)}</b>
          </span>
          <span
            className="chip"
            title="Сколько листов уйдёт на этот раскрой и сколько числится на складе"
          >
            Листы{' '}
            <b className={shortage ? 'bad' : undefined}>
              {layout ? `${layout.stock.needed} из ${layout.stock.available}` : '—'}
            </b>
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => arrange(false)}
            disabled={busy || jobId === null || !layout?.instances.length}
            title="Полный пересчёт раскладки: двигаются все детали, включая закреплённые"
          >
            Разложить заново
          </button>
        </div>
      </div>

      {(error || message) && (
        <div className={`notice ${error ? 'error' : 'ok'} editor-notice`}>
          <div className="notice-lines">
            {(error ?? message ?? '').split('\n').map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
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
                Новый раскрой
              </div>
              <div className="small muted" style={{ marginBottom: 8 }}>
                Работа начинается отсюда: материал, толщина, оператор. Файлы
                добавляются в уже заведённый раскрой — хоть из Базиса, хоть
                откуда.
              </div>
              <label className="field">
                Материал и толщина
                <select
                  value={creating.material_id}
                  onChange={(event) => {
                    const material = (materials ?? []).find(
                      (m) => String(m.id) === event.target.value,
                    )
                    setCreating((prev) => ({
                      ...prev,
                      material_id: event.target.value,
                      thickness: material ? String(material.thickness) : '',
                    }))
                  }}
                >
                  <option value="">— выберите —</option>
                  {(materials ?? []).map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} · {material.thickness} мм
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginTop: 8 }}>
                Оператор
                <input
                  placeholder="кто ведёт лист"
                  value={creating.operator}
                  onChange={(event) =>
                    setCreating((prev) => ({ ...prev, operator: event.target.value }))
                  }
                />
              </label>
              <button
                type="button"
                className="primary"
                style={{ width: '100%', marginTop: 10 }}
                disabled={!creating.material_id || !creating.thickness}
                onClick={createJob}
              >
                Создать раскрой
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
              Заведите раскрой слева, потом перетащите сюда DXF.
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
                <div className="legend-row" key={row.id}>
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

          <Shortcuts />
        </div>

        <aside className="editor-side right">
          {layout && (
            <JobFlow
              layout={layout}
              busy={busy}
              onTake={takeJob}
              onCheck={checkItem}
              onFinish={finishJob}
            />
          )}
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

      {intake && layout && (
        <IntakeDialog
          cards={intake.files}
          materials={materials ?? []}
          jobThickness={layout.job.thickness}
          jobMaterialId={layout.job.material_id}
          placement={{
            part_gap: layout.job.preset_snapshot?.layout.part_gap ?? 2,
            sheet_margin: layout.job.preset_snapshot?.layout.sheet_margin ?? 0,
            rotation:
              layout.job.preset_snapshot?.layout.rotation_step === 90 ? 'quarter' : 'quarter',
            respect_grain: layout.job.has_grain,
          }}
          busy={busy}
          onCancel={() => setIntake(null)}
          onConfirm={confirmFiles}
        />
      )}

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

    </div>
  )
}

const SHORTCUTS: Array<[string, string]> = [
  ['Колесо', 'приблизить и отдалить'],
  ['Пробел или средняя кнопка', 'двигать поле'],
  ['Клик', 'выбрать деталь'],
  ['Двойной клик', 'войти в деталь и выбирать её векторы'],
  ['Shift + клик', 'добавить к выделению'],
  ['R / Shift + R', 'повернуть на 90° туда и обратно'],
  ['Стрелки', 'сдвинуть на 1 мм, с Shift — на 10'],
  ['Esc', 'снять выделение'],
]

/**
 * Подсказки по управлению. Раньше они стояли стеной внизу экрана и висели
 * там всю смену, хотя нужны один раз — в первый день. Теперь их открывают.
 */
function Shortcuts() {
  const [open, setOpen] = useState(false)
  return (
    <div className="shortcuts">
      {open && (
        <div className="shortcuts-card">
          <div className="lbl">Управление полем</div>
          {SHORTCUTS.map(([key, what]) => (
            <div className="shortcuts-row" key={key}>
              <span className="kbd">{key}</span>
              <span>{what}</span>
            </div>
          ))}
          <div className="shortcuts-note">
            DXF можно просто перетащить в поле — откроется диалог добавления.
          </div>
        </div>
      )}
      <button
        type="button"
        className={`shortcuts-toggle${open ? ' on' : ''}`}
        title="Как управлять полем"
        aria-label="Как управлять полем"
        onClick={() => setOpen((prev) => !prev)}
      >
        ?
      </button>
    </div>
  )
}
