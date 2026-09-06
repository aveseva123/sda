/**
 * Демо-режим: интерфейс без сервера.
 *
 * Собирается отдельной сборкой (`npm run build:demo`) и нужен ровно для
 * одного — показать работу тому, у кого не установлены ни Python, ни Node.
 * Ответы взяты снимком с настоящего сервера на эталонных DXF заказчика,
 * поэтому на экране живые детали, а не выдумка.
 *
 * Демо проводит по всему пути: пустой экран → раскрой заведён → файл
 * добавлен через диалог → взял в работу → чеклист → раскрой завершён.
 * Считает при этом не оно: раскладка взята готовой, а разбор DXF в браузере
 * без сервера невозможен, поэтому диалог показывает заранее снятые карточки.
 *
 * Всё живёт в памяти вкладки и пропадает при перезагрузке.
 */

import snapshot from './demo-data.json'

type Json = Record<string, unknown>

const data = snapshot as Record<string, unknown>

interface DemoJob {
  id: number
  name: string
  material_id: number
  thickness: number
  operator: string | null
  stage: string
  checklist: Record<string, boolean>
}

const layout = structuredClone(data['/nesting/jobs/1/layout']) as {
  job: Json
  sheets: unknown[]
  parts: Record<string, Json>
  instances: Array<{
    id: number
    x: number | null
    y: number | null
    rotation: number
    sheet_index: number | null
    pinned: boolean
  }>
  stock: Json
}

const CHECKLIST: Array<[string, string]> = [
  ['marking', 'Маркировка сделана'],
  ['sorted', 'Детали отсортированы по проектам и изделиям'],
  ['counted', 'Количество деталей посчитано'],
]

/** Раскрой заводит сам зритель — демо начинается с пустого экрана. */
const state: { job: DemoJob | null; filesAdded: boolean } = {
  job: null,
  filesAdded: false,
}

export class DemoUnavailable extends Error {
  constructor(what: string) {
    super(`${what} доступно только на настоящем сервере — это демо интерфейса.`)
  }
}

function jobView(): Json {
  const job = state.job
  return {
    ...(layout.job as Json),
    id: job?.id ?? 1,
    name: job?.name ?? 'Раскрой',
    operator: job?.operator ?? null,
    stage: job?.stage ?? 'planning',
    checklist: CHECKLIST.map(([key, title]) => ({
      key,
      title,
      done: Boolean(job?.checklist[key]),
    })),
  }
}

function currentLayout(): Json {
  // Пока файлы не добавлены, лист пуст: демо начинается с чистого раскроя.
  if (!state.filesAdded) {
    return { job: jobView(), sheets: [], parts: {}, instances: [], stock: layout.stock }
  }
  return { ...layout, job: jobView() }
}

function applyMoves(body: string | undefined): Json {
  const moves = (JSON.parse(body ?? '{}').moves ?? []) as Array<{
    instance_id: number
    x?: number | null
    y?: number | null
    rotation?: number | null
    sheet_index?: number | null
    pinned?: boolean
  }>
  for (const move of moves) {
    const instance = layout.instances.find((i) => i.id === move.instance_id)
    if (!instance) continue
    if (move.x !== undefined && move.x !== null) instance.x = move.x
    if (move.y !== undefined && move.y !== null) instance.y = move.y
    if (move.rotation !== undefined && move.rotation !== null) instance.rotation = move.rotation
    if (move.sheet_index !== undefined && move.sheet_index !== null) {
      instance.sheet_index = move.sheet_index
    }
    if (move.pinned !== undefined) instance.pinned = move.pinned
  }
  return { updated: moves.length, utilization: 0 }
}

function createJob(body: string | undefined): Json {
  const payload = JSON.parse(body ?? '{}') as {
    material_id?: number
    thickness?: number
    operator?: string
  }
  const materials = (data['/materials'] ?? []) as Array<{
    id: number
    name: string
    thickness: number
  }>
  // В демо готовая раскладка одна — на ЛДСП 16 мм. Чтобы шапка не спорила с
  // тем, что лежит на листе, раскрой заводится именно на этом материале.
  const canned = (layout.job ?? {}) as { material_id?: number; thickness?: number }
  const material =
    materials.find((m) => m.id === Number(canned.material_id)) ??
    materials.find((m) => m.id === Number(payload.material_id))
  state.job = {
    id: 1,
    name: `${material?.name ?? 'Материал'} ${canned.thickness ?? 16} мм`,
    material_id: Number(canned.material_id ?? payload.material_id ?? 1),
    thickness: Number(canned.thickness ?? payload.thickness ?? 16),
    operator: payload.operator ?? null,
    stage: 'planning',
    checklist: {},
  }
  state.filesAdded = false
  return { id: 1 }
}

export function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const clean = path.split('?')[0]
  const body = init?.body as string | undefined

  if (method === 'GET') {
    if (clean === '/nesting/jobs') {
      return Promise.resolve((state.job ? [{ ...state.job }] : []) as T)
    }
    if (clean === '/nesting/jobs/1/layout') return Promise.resolve(currentLayout() as T)
    if (clean === '/nesting/jobs/1/collisions') return Promise.resolve([] as unknown as T)
    if (clean === '/files' && !state.filesAdded) return Promise.resolve([] as unknown as T)

    const found = data[clean] ?? data[path]
    if (found !== undefined) return Promise.resolve(structuredClone(found) as T)

    const geometry = clean.match(/^\/parts\/(\d+)\/geometry$/)
    if (geometry) {
      const part = layout.parts[geometry[1]]
      if (part) {
        return Promise.resolve({
          id: Number(geometry[1]),
          name: part.name,
          geometry: part.geometry,
        } as T)
      }
    }
    return Promise.resolve([] as unknown as T)
  }

  if (clean === '/nesting/jobs' && method === 'POST') {
    return Promise.resolve(createJob(body) as T)
  }
  if (clean.endsWith('/files') && method === 'POST') {
    // Разобрать DXF в браузере нечем — показываем карточки, снятые с сервера
    // на эталонных файлах заказчика.
    return Promise.resolve(structuredClone(data['__intake']) as T)
  }
  if (clean.endsWith('/files/confirm')) {
    state.filesAdded = true
    return Promise.resolve({
      added: layout.instances.length,
      warnings: [
        'Демонстрация: раскладка взята готовой (ЛДСП 16 мм), разбор DXF и ' +
          'пересчёт работают только на сервере.',
      ],
    } as T)
  }
  if (clean.endsWith('/take')) {
    const payload = JSON.parse(body ?? '{}') as { operator?: string }
    if (state.job) {
      state.job.operator = payload.operator ?? state.job.operator
      state.job.stage = 'in_progress'
    }
    return Promise.resolve({ stage: 'in_progress', operator: state.job?.operator } as T)
  }
  if (clean.endsWith('/checklist')) {
    const payload = JSON.parse(body ?? '{}') as { items?: Record<string, boolean> }
    if (state.job) state.job.checklist = { ...state.job.checklist, ...(payload.items ?? {}) }
    return Promise.resolve({ checklist: jobView().checklist } as T)
  }
  if (clean.endsWith('/finish')) {
    const left = CHECKLIST.filter(([key]) => !state.job?.checklist[key])
    if (left.length) throw new Error('Не отмечено: ' + left.map(([, t]) => t).join('; '))
    if (state.job) state.job.stage = 'finished'
    return Promise.resolve({ stage: 'finished' } as T)
  }
  if (method === 'POST' && clean.endsWith('/move')) {
    return Promise.resolve(applyMoves(body) as T)
  }

  if (clean.endsWith('/arrange')) throw new DemoUnavailable('Автораскладка')
  if (clean === '/imports') throw new DemoUnavailable('Импорт DXF')
  if (clean.startsWith('/stock')) throw new DemoUnavailable('Движение по складу')
  throw new DemoUnavailable('Изменение данных')
}

export const IS_DEMO = import.meta.env.VITE_DEMO === '1'
