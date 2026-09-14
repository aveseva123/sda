import { useId } from 'react'

type Props = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  unit?: string
}

/** Ползунок с числовым полем. Значение всегда в диапазоне min–max */
export function Slider({ label, value, min, max, step, onChange, format, unit }: Props) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-muted">
          {label}
        </label>
        <output htmlFor={id} className="text-base font-semibold tabular-nums text-amber whitespace-nowrap">
          {format ? format(value) : value}
          {unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
        </output>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <input
          id={id}
          type="range"
          className="slider"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ ['--fill' as string]: `${pct}%` }}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format ? format(value) : String(value)}
        />
        <input
          type="number"
          className="field w-24 text-right tabular-nums print-hide"
          aria-label={`${label}, точное значение`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onChange(clamp(v))
          }}
        />
      </div>
    </div>
  )
}
