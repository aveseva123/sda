// Кэш-кривая на 18 месяцев: SVG без библиотек. Базовый сценарий янтарный, остальные серые
import { useEffect, useId, useRef, useState } from 'react'
import type { LoadResult } from '../model/finance'
import { usdShort } from '../lib/format'

type Props = {
  base: LoadResult
  pessimistic: LoadResult
  optimistic: LoadResult
  firstOrderMonth: number
}

const H = 300
const PAD = { top: 22, right: 18, bottom: 34, left: 58 }

/** Ширина контейнера: SVG перерисовывается под нее, поэтому шрифты не мельчают на телефоне */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export function CashChart({ base, pessimistic, optimistic, firstOrderMonth }: Props) {
  const id = useId()
  const { ref, width: W } = useWidth<HTMLElement>(720)
  const narrow = W < 480
  const all = [...base.curve, ...pessimistic.curve, ...optimistic.curve].map((p) => p.cash)
  const maxV = Math.max(0, ...all)
  const minV = Math.min(0, ...all)
  const span = maxV - minV || 1
  const months = base.curve.length

  const x = (m: number) => PAD.left + ((m - 1) / (months - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + ((maxV - v) / span) * (H - PAD.top - PAD.bottom)

  const path = (r: LoadResult) => r.curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.cash).toFixed(1)}`).join(' ')

  // Сетка по кассе: 4 шага
  const ticks = 4
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => minV + (span * i) / ticks)

  const min = base.minCash
  const desc = `Кэш-кривая. Минимальный остаток кассы базового сценария ${usdShort(min.value)} в месяце ${min.month}`

  return (
    <figure className="min-w-0" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full h-auto" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
        <title id={`${id}-title`}>Кэш-кривая на {months} месяцев</title>
        <desc id={`${id}-desc`}>{desc}</desc>

        {gridValues.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.12)" className="print-bg-line" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#E4E4E8">
              {usdShort(v)}
            </text>
          </g>
        ))}

        {/* Нулевая линия кассы */}
        {minV < 0 && <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.45)" strokeDasharray="3 4" />}

        {/* Месяц первого заказа */}
        {firstOrderMonth <= months && (
          <g>
            <line x1={x(firstOrderMonth)} x2={x(firstOrderMonth)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
            <text x={x(firstOrderMonth) + 5} y={H - PAD.bottom - 6} fontSize="11" fill="#E4E4E8">
              первый заказ
            </text>
          </g>
        )}

        {base.curve
          .filter((p) => !narrow || p.month % 2 === 0 || p.month === 1)
          .map((p) => (
            <text key={p.month} x={x(p.month)} y={H - PAD.bottom + 18} textAnchor="middle" fontSize="11" fill="#E4E4E8">
              {p.month}
            </text>
          ))}
        <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize="11" fill="#E4E4E8">
          месяц
        </text>

        <path d={path(pessimistic)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d={path(optimistic)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="1.5 4" />
        <path d={path(base)} fill="none" stroke="#f5b53f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Минимальный остаток кассы */}
        <circle cx={x(min.month)} cy={y(min.value)} r="9" fill="rgba(245,181,63,0.25)" />
        <circle cx={x(min.month)} cy={y(min.value)} r="4.5" fill="#f5b53f" stroke="#000" strokeWidth="2" />
        <text
          x={x(min.month) + (min.month > months * 0.6 ? -14 : 14)}
          y={y(min.value) + (y(min.value) > H / 2 ? -16 : 22)}
          textAnchor={min.month > months * 0.6 ? 'end' : 'start'}
          fontSize="12"
          fontWeight="600"
          fill="#f5b53f"
        >
          минимум {usdShort(min.value)}, мес {min.month}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span>
          <span className="inline-block w-5 border-t-2 border-amber align-middle mr-1.5" />
          базовый
        </span>
        <span>
          <span className="inline-block w-5 border-t border-dashed border-white/60 align-middle mr-1.5" />
          пессимистичный
        </span>
        <span>
          <span className="inline-block w-5 border-t border-dotted border-white/60 align-middle mr-1.5" />
          оптимистичный
        </span>
        <span>Все три стартуют с базовой инвестиции</span>
      </figcaption>
    </figure>
  )
}
