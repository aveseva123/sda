/**
 * Демо-режим: интерфейс без сервера.
 *
 * Собирается отдельной сборкой (`npm run build:demo`) и нужен ровно для
 * одного — показать вёрстку тому, у кого не установлены ни Python, ни Node.
 * Ответы API взяты снимком с настоящего сервера на эталонных DXF заказчика,
 * поэтому на экране живые детали, а не выдумка.
 *
 * Что демо НЕ делает: не считает раскрой, не пишет в базу, не генерирует УП.
 * Перетаскивание деталей работает в памяти вкладки и пропадает при
 * перезагрузке — иначе смотреть было бы не на что.
 */

import snapshot from './demo-data.json'

type Json = Record<string, unknown>

const data = snapshot as Record<string, unknown>

/** Раскладка живёт в памяти: её правит перетаскивание деталей. */
const layout = structuredClone(data['/nesting/jobs/1/layout']) as {
  instances: Array<{
    id: number
    x: number | null
    y: number | null
    rotation: number
    sheet_index: number | null
    pinned: boolean
  }>
}

export class DemoUnavailable extends Error {
  constructor(what: string) {
    super(`${what} доступно только на настоящем сервере — это демо интерфейса.`)
  }
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

export function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const clean = path.split('?')[0]

  if (method === 'GET') {
    if (clean === '/nesting/jobs/1/layout') return Promise.resolve(layout as T)
    const found = data[clean] ?? data[path]
    if (found !== undefined) return Promise.resolve(structuredClone(found) as T)
    // Геометрия отдельной детали лежит внутри раскладки — отдаём оттуда.
    const geometry = clean.match(/^\/parts\/(\d+)\/geometry$/)
    if (geometry) {
      const parts = (layout as unknown as { parts: Record<string, Json> }).parts ?? {}
      const part = parts[geometry[1]]
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

  if (method === 'POST' && clean.endsWith('/move')) {
    return Promise.resolve(applyMoves(init?.body as string) as T)
  }

  if (clean.endsWith('/arrange')) throw new DemoUnavailable('Автораскладка')
  if (clean === '/imports') throw new DemoUnavailable('Импорт DXF')
  if (clean.startsWith('/stock')) throw new DemoUnavailable('Движение по складу')
  throw new DemoUnavailable('Изменение данных')
}

export const IS_DEMO = import.meta.env.VITE_DEMO === '1'
