import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import AlignBar from '../components/editor/AlignBar'
import BufferPanel from '../components/editor/BufferPanel'
import CanvasStage, { type Move, type StageHandle } from '../components/editor/CanvasStage'
import IntakeDialog, { type Placement } from '../components/editor/IntakeDialog'
import JobFlow from '../components/editor/JobFlow'
import MapLegend from '../components/editor/MapLegend'
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
import { fileColors } from '../editor/palette'
import { plural } from '../lib/format'
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
  // Снимок раскладки для стека отмены: он читается в коллбэках, которым
  // нельзя пересоздаваться на каждое движение мыши.
  const layoutRef = useRef<Layout | null>(null)
  const [collisions, setCollisions] = useState<Collision[]>([])
  const [presets, setPresets] = useState<ToolpathPreset[]>([])
  const [cuttingPresets, setCuttingPresets] = useState<CuttingPreset[]>([])
  const [files, setFiles] = useState<SourceFile[]>([])
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [focusedPartId, setFocusedPartId] = useState<number | null>(null)
  // Ширина фрезы — режим проверки, а не фон: включённой по умолчанию она
  // закрашивает весь лист и раскладку под ней не видно.
  const [showToolpaths, setShowToolpaths] = useState(false)
  // Режим просмотра, как «Каркас» в векторных редакторах: заливка отвечает на
  // вопрос «чьё и насколько плотно», каркас — «что за геометрия и где что
  // налезает». Выбор запоминается: у технолога и оператора он обычно разный.
  const [view, setView] = useState<'solid' | 'outline'>(() => {
    try {
      return window.localStorage.getItem('nestor.view') === 'outline' ? 'outline' : 'solid'
    } catch {
      return 'solid'
    }
  })
  const [scale, setScale] = useState(0.15)
  const [busy, setBusy] = useState(false)
  const [busyWhat, setBusyWhat] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Отмена ручных правок. Раньше промах мышью было нечем откатить, кроме
  // полного пересчёта, — и раскладку переставали трогать вообще.
  const undoStack = useRef<Move[][]>([])
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

  const say = useCallback((text: string) => {
    setError(null)
    setMessage(text)
  }, [])

  const fail = useCallback((err: unknown) => {
    setMessage(null)
    const text = err instanceof Error ? err.message : String(err)
    // «Failed to fetch» на экране у станка не значит ничего.
    setError(
      /failed to fetch|networkerror|load failed/i.test(text)
        ? 'Нет связи с сервером. Проверьте, запущен ли «Нестор» на компьютере-сервере.'
        : text,
    )
  }, [])

  /** Долгая операция: показывает, что именно считается, и не даёт кликать. */
  const run = useCallback(
    async (what: string, action: () => Promise<void>) => {
      setBusy(true)
      setBusyWhat(what)
      try {
        await action()
      } catch (err) {
        fail(err)
      } finally {
        setBusy(false)
        setBusyWhat(null)
      }
    },
    [fail],
  )

  const loadJobs = useCallback(async () => {
    const rows = await api.nestingJobs()
    setJobs(rows)
    if (rows.length && jobId === null) setJobId(rows[0].id)
  }, [jobId])

  const loadLayout = useCallback(async (id: number) => {
    const [data, issues] = await Promise.all([api.layout(id), api.collisions(id)])
    layoutRef.current = data
    setLayout(data)
    setCollisions(issues)
    // Буфер — файлы этого раскроя, а не всё, что когда-либо загружали в цеху.
    api.files(id).then(setFiles).catch(() => undefined)
  }, [])

  useEffect(() => {
    api.toolpathPresets().then(setPresets).catch(() => undefined)
    api.cuttingPresets().then(setCuttingPresets).catch(() => undefined)
    loadJobs().catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (jobId === null) return
    loadLayout(jobId).catch(fail)
  }, [jobId, loadLayout])

  const applyMoves = useCallback(
    async (moves: Move[], remember = true) => {
      if (jobId === null || !moves.length) return
      // Обратный ход запоминается до правки: без него промах мышью нечем
      // откатить, и раскладку перестают трогать руками совсем.
      if (remember && layoutRef.current) {
        const before = new Map(layoutRef.current.instances.map((i) => [i.id, i]))
        const back = moves
          .map((move) => {
            const was = before.get(move.instance_id)
            if (!was) return null
            return {
              instance_id: was.id,
              x: was.x ?? undefined,
              y: was.y ?? undefined,
              rotation: was.rotation,
              sheet_index: was.sheet_index ?? undefined,
              pinned: was.pinned,
            } as Move
          })
          .filter((item): item is Move => item !== null)
        if (back.length) {
          undoStack.current = [...undoStack.current.slice(-29), back]
        }
      }
      // Раскладка правится сразу на экране, ответ сервера её только подтверждает:
      // иначе перетаскивание «залипает» на времени запроса.
      setLayout((current) => {
        if (!current) return current
        const byId = new Map(moves.map((m) => [m.instance_id, m]))
        const next = {
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
        layoutRef.current = next
        return next
      })
      try {
        await api.moveInstances(jobId, moves)
        await loadLayout(jobId)
      } catch (err) {
        fail(err)
        await loadLayout(jobId)
      }
    },
    [jobId, loadLayout, fail],
  )

  const undo = useCallback(() => {
    const back = undoStack.current.pop()
    if (!back) {
      say('Отменять нечего.')
      return
    }
    applyMoves(back, false)
  }, [applyMoves, say])

  const arrange = async (keepPinned: boolean) => {
    if (jobId === null) return
    // Полный пересчёт стирает ручную расстановку. Полчаса работы не должны
    // исчезать от случайного попадания по кнопке в верхней строке.
    if (!keepPinned) {
      const pinned = (layout?.instances ?? []).filter((i) => i.pinned).length
      const question = pinned
        ? `Разложить заново? Все детали переставятся, закрепление снимется с ${plural(
            pinned,
            'детали',
            'деталей',
            'деталей',
          )}.`
        : 'Разложить заново? Все детали переставятся с нуля.'
      if (!window.confirm(question)) return
    }
    await run(keepPinned ? 'Уплотняю лист' : 'Раскладываю заново', async () => {
      const result = await api.arrange(jobId, keepPinned)
      undoStack.current = []
      say(
        [
          `Разложено на ${plural(result.sheets, 'лист', 'листа', 'листов')}, ` +
            `КИМ ${percent(result.utilization)}.`,
          result.unplaced
            ? `Не поместилось: ${plural(result.unplaced, 'деталь', 'детали', 'деталей')} — ` +
              'они ждут в списке слева.'
            : '',
          keepPinned
            ? 'Закреплённые детали остались на местах.'
            : 'Закрепление снято: все детали переставлены заново.',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      await loadLayout(jobId)
    })
  }

  const changePreset = async (value: string) => {
    if (jobId === null) return
    await run('Пересчитываю раскладку по шаблону', async () => {
      // У другого шаблона другая фреза и другой зазор — раскладка
      // пересчитывается сразу, иначе она перестанет соответствовать УП.
      const result = await api.setJobPreset(jobId, value ? Number(value) : null)
      say(
        result.preset
          ? `Шаблон «${result.preset.name}»: фреза контура ⌀${
              result.preset.layout.kerf ?? 0
            } мм, зазор ${
              (result.preset.layout.kerf ?? 0) + (result.preset.layout.part_gap ?? 0)
            } мм.`
          : 'Шаблон снят. Раскладка считается по общим настройкам.',
      )
      await loadLayout(jobId)
    })
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
      fail(err)
    }
  }

  const assignToolpath = async (partId: number, targets: string[], presetId: number) => {
    try {
      await api.assignToolpath(partId, { targets, preset_id: presetId })
      if (jobId !== null) await loadLayout(jobId)
      say(`Траектория применена к ${plural(targets.length, 'вектору', 'векторам', 'векторам')}.`)
    } catch (err) {
      fail(err)
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
      fail(err)
    }
  }

  const dropFiles = async (files: File[]) => {
    if (jobId === null) {
      fail(new Error('Сначала заведите раскрой: материал, толщина, оператор.'))
      return
    }
    if (layoutRef.current?.job.stage === 'finished') {
      fail(
        new Error(
          'Раскрой завершён: лист отрезан и списан. Заведите новый раскрой для этих файлов.',
        ),
      )
      return
    }
    await run(
      `Читаю ${plural(files.length, 'файл', 'файла', 'файлов')}`,
      async () => {
        // Первый шаг: файлы разобраны, деталей ещё нет. Что с ними делать,
        // решает оператор в диалоге.
        setIntake(await api.addFiles(jobId, files))
      },
    )
  }

  const confirmFiles = async (decisions: FileDecision[], placement: Placement) => {
    if (jobId === null || !intake) return
    setBusy(true)
    setBusyWhat('Раскладываю добавленные детали')
    setError(null)
    try {
      const result = await api.confirmFiles(jobId, intake.batch_id, decisions, { ...placement })
      setIntake(null)
      undoStack.current = []
      say(
        [
          `Добавлено ${plural(result.added, 'позиция', 'позиции', 'позиций')}, ` +
            `разложено на ${plural(
              result.layout?.sheets ?? 0,
              'лист',
              'листа',
              'листов',
            )}.`,
          result.layout?.unplaced
            ? `Не поместилось: ${plural(
                result.layout.unplaced,
                'деталь',
                'детали',
                'деталей',
              )} — они в списке слева.`
            : '',
          ...result.warnings,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      await loadLayout(jobId)
      await loadJobs()
    } catch (err) {
      // Ошибку показывает сам диалог: под затемнением плашку сзади не видно.
      throw err
    } finally {
      setBusy(false)
      setBusyWhat(null)
    }
  }

  const takeJob = async (operator: string) => {
    if (jobId === null) return
    await run('Записываю оператора', async () => {
      await api.takeJob(jobId, operator)
      await loadLayout(jobId)
    })
  }

  const checkItem = async (key: string, done: boolean) => {
    if (jobId === null || !layout) return
    const items: Record<string, boolean> = {}
    for (const item of layout.job.checklist) items[item.key] = item.key === key ? done : item.done
    try {
      await api.setChecklist(jobId, items)
      await loadLayout(jobId)
    } catch (err) {
      fail(err)
    }
  }

  const finishJob = async () => {
    if (jobId === null) return
    // Наложение деталей — это испорченный лист. Закрывать раскрой, зная о
    // них, нельзя: сначала пусть технолог их разведёт.
    if (collisions.length) {
      fail(
        new Error(
          `На листе ${plural(collisions.length, 'наложение', 'наложения', 'наложений')} — ` +
            'раскрой не закрывается. Найдите красные детали и разведите их.',
        ),
      )
      return
    }
    await run('Закрываю раскрой', async () => {
      await api.finishJob(jobId)
      say('Раскрой завершён. Лист списан, деловой обрезок ушёл на склад.')
      await loadLayout(jobId)
    })
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
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
  }, [layout, selection, applyMoves, undo])

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
        // Базовый цвет файла, а не заливка первой попавшейся детали: у неё
        // может быть оттенок второго листа, и квадратик в легенде разойдётся
        // с тем, что человек видит на карте.
        color: part.style ? fileColors(part.style.base ?? part.style.fill).fill : 'var(--ink-2)',
        name: part.source_file ?? `Файл ${part.source_file_id}`,
        count: 0,
      }
      row.count += 1
      counts.set(part.source_file_id, row)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [layout])

  const job = layout?.job

  // Стартовые параметры диалога. Поворот берётся из шаблона: раньше здесь
  // всегда стояло «0 / 90°», и настройка шаблона молча затиралась.
  const intakePlacement = useMemo(() => {
    const params = layout?.job.preset_snapshot?.layout
    const step = params?.rotation_step
    return {
      part_gap: params?.part_gap ?? 2,
      sheet_margin: params?.sheet_margin ?? 0,
      rotation: step === 0 ? 'none' : step === 90 ? 'quarter' : 'free',
      respect_grain: layout?.job.has_grain ?? false,
    }
  }, [layout])
  // Нехватка листов — не украшение шапки, а причина не начинать раскрой.
  const shortage = layout ? layout.stock.needed > layout.stock.available : false
  // Наложения — испорченный лист, поэтому о них говорят в шапке, а не в
  // сообщении, которое закроют через минуту.
  const trouble = collisions.length
  // Завершённый раскрой заморожен: лист отрезан и списан, детали размечены.
  // Переложить карту — значит сделать её описанием того, чего в цеху не было.
  const frozen = job?.stage === 'finished'
  const unplaced = (layout?.instances ?? []).filter((i) => i.sheet_index === null).length

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

        {job && (
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
        )}

        {job && <span className={`stage-badge ${job.stage}`}>{STAGE_TITLE[job.stage]}</span>}

        <div className="spacer">
          {job && (
            <>
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
          {unplaced > 0 && (
            <span
              className="chip"
              title="Эти детали не влезли ни на один лист — они перечислены в панели слева"
            >
              Не влезло <b className="bad">{unplaced}</b>
            </span>
          )}
          {trouble > 0 && (
            <button
              type="button"
              className="chip trouble"
              title="Показать детали, которые налезают друг на друга"
              onClick={() => {
                setSelection({
                  instances: [...new Set(collisions.flatMap((c) => c.instance_ids))],
                  vectors: [],
                })
              }}
            >
              Наложений <b>{trouble}</b>
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => arrange(false)}
            disabled={busy || jobId === null || frozen || !layout?.instances.length}
            title={
              frozen
                ? 'Раскрой завершён: лист отрезан и списан, раскладка заморожена'
                : 'Полный пересчёт раскладки: двигаются все детали, включая закреплённые'
            }
          >
            Разложить заново
          </button>
            </>
          )}
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

      <div className={`editor-body${layout ? '' : ' alone'}`}>
        {/* Панели появляются вместе с раскроем: до него они пусты, а пустая
            панель на весь экран — это не интерфейс, а тишина. */}
        {layout && (
          <aside className="editor-side left">
            <BufferPanel
              files={files}
              layout={layout}
              selection={selection}
              onSelectionChange={setSelection}
              onFocusPart={setFocusedPartId}
              onFocusSheet={(index) => stage.current?.focusSheet(index)}
              onPickFiles={() => filePicker.current?.click()}
              onDropFiles={dropFiles}
              frozen={frozen}
            />
          </aside>
        )}

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
              onMove={frozen ? () => undefined : applyMoves}
              onDropFiles={dropFiles}
              view={view}
              showToolpaths={showToolpaths}
              gap={gap}
              onViewportChange={setScale}
            />
          ) : (
            <div className="stage start">
              <div className="start-card">
                <div className="start-step">Шаг 1 из 2</div>
                <h2>Заведите раскрой</h2>
                <p>
                  Раскрой — это лист на станке: материал, толщина и тот, кто его
                  ведёт. Файлы добавляются в уже заведённый раскрой — хоть из
                  Базиса, хоть откуда, хоть из нескольких проектов сразу, чтобы
                  не тратить лист зря.
                </p>
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
                <label className="field">
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
                  disabled={!creating.material_id || !creating.thickness}
                  onClick={createJob}
                >
                  Создать раскрой
                </button>
                <div className="start-next">
                  Шаг 2 — перетащить сюда DXF или нажать «+ Файл».
                </div>
              </div>
            </div>
          )}

          {layout && (
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
            <span className="chip segmented" role="group" aria-label="Вид карты">
              {(
                [
                  ['solid', 'Заливка', 'Деталь залита цветом своего файла'],
                  ['outline', 'Контуры', 'Только линии: видно геометрию, вырезы и наложения'],
                ] as const
              ).map(([mode, title, hint]) => (
                <button
                  key={mode}
                  type="button"
                  className={view === mode ? 'on' : undefined}
                  title={hint}
                  onClick={() => {
                    setView(mode)
                    try {
                      window.localStorage.setItem('nestor.view', mode)
                    } catch {
                      /* приватное окно — просто не запомним */
                    }
                  }}
                >
                  {title}
                </button>
              ))}
            </span>
            <label
              className="chip"
              style={{ cursor: 'pointer' }}
              title="Полоса материала, которую снимет фреза: у контура — снаружи линии, у выреза и кармана — внутри, у паза — по оси"
            >
              <input
                type="checkbox"
                checked={showToolpaths}
                onChange={(event) => setShowToolpaths(event.target.checked)}
              />
              Полоса реза
            </label>
          </div>
          )}

          {layout && <MapLegend layout={layout} files={legend} scale={scale} />}

          {layout && (
            <AlignBar
              layout={layout}
              selection={selection}
              onMove={applyMoves}
              onCompact={() => arrange(true)}
              busy={busy || frozen}
            />
          )}

          {busy && busyWhat && (
            <div className="stage-busy">
              <span className="spinner" />
              {busyWhat}…
            </div>
          )}

          <Shortcuts />
        </div>

        {layout && (
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
        )}
      </div>

      {/* Диалог показывается по факту разобранных файлов: раньше он ждал
          раскладку и при незагруженной пропадал вместе с файлами. */}
      {intake && (
        <IntakeDialog
          cards={intake.files}
          materials={materials ?? []}
          jobThickness={job?.thickness ?? (Number(creating.thickness) || 0)}
          jobMaterialId={job?.material_id ?? (Number(creating.material_id) || 0)}
          placement={intakePlacement}
          busy={busy}
          onCancel={() => {
            setIntake(null)
            say('Файлы не добавлены — раскрой остался прежним.')
          }}
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
  ['Ctrl + Z', 'отменить последнюю правку'],
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
