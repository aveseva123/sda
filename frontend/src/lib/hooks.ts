import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'

/** Счётчик очереди уточнений в боковом меню. */
export function usePendingCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .pendingParts()
        .then((parts) => {
          if (alive) setCount(parts.length)
        })
        .catch(() => undefined)
    load()
    const timer = window.setInterval(load, 15000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return count
}

/** Загрузка данных с состоянием ошибки и ручным обновлением. */
export function useLoader<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    loader()
      .then((value) => {
        setData(value)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(reload, [reload])

  return { data, error, loading, reload, setData }
}
