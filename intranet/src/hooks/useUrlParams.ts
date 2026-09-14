// Параметры финмодели живут в query-строке URL: ссылку со сценарием можно скинуть как есть.
// localStorage не используется намеренно.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { financeDefaults, financeRanges, type FinanceParams } from '../data/finance'

type NumericKey = Exclude<keyof FinanceParams, 'scenario'>

// Короткие ключи в URL
const keys: Record<keyof FinanceParams, string> = {
  scenario: 'sc',
  areaM2: 'area',
  rentPerM2: 'rent',
  avgBudget: 'budget',
  anchorPerYear: 'anchor',
  externalPerYear: 'ext',
  marginPct: 'margin',
  monthsToFirstOrder: 'm0',
  reservePct: 'res',
  amdRate: 'amd',
}

const clamp = (v: number, key: NumericKey): number => {
  const r = financeRanges[key]
  return Math.min(r.max, Math.max(r.min, v))
}

export function parseParams(search: string): FinanceParams {
  const q = new URLSearchParams(search)
  const out: FinanceParams = { ...financeDefaults }
  const sc = q.get(keys.scenario)
  if (sc === 'A' || sc === 'B') out.scenario = sc
  for (const key of Object.keys(financeRanges) as NumericKey[]) {
    const raw = q.get(keys[key])
    if (raw === null) continue
    const v = Number(raw.replace(',', '.'))
    if (Number.isFinite(v)) out[key] = clamp(v, key)
  }
  return out
}

export function serializeParams(p: FinanceParams): string {
  const q = new URLSearchParams()
  for (const key of Object.keys(keys) as (keyof FinanceParams)[]) {
    if (p[key] !== financeDefaults[key]) q.set(keys[key], String(p[key]))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function useUrlParams() {
  const [params, setParams] = useState<FinanceParams>(() =>
    typeof window === 'undefined' ? financeDefaults : parseParams(window.location.search),
  )

  // Запись в URL без перезагрузки и без новой записи в истории
  useEffect(() => {
    const next = serializeParams(params)
    const current = window.location.search
    if (next !== current) {
      // В песочницах (превью, iframe) replaceState может быть запрещен: цифры все равно считаются
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`)
      } catch {
        /* адрес не обновится, состояние остается в памяти */
      }
    }
  }, [params])

  // Кнопки «назад/вперед» и ручная правка адреса
  useEffect(() => {
    const onPop = () => setParams(parseParams(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const set = useCallback(<K extends keyof FinanceParams>(key: K, value: FinanceParams[K]) => {
    setParams((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }))
  }, [])

  const reset = useCallback(() => setParams({ ...financeDefaults }), [])

  const isDefault = useMemo(() => serializeParams(params) === '', [params])

  return { params, set, reset, isDefault }
}
