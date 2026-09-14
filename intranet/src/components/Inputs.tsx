// Компактные поля для редактируемых таблиц: число, выбор, включатель
import { useState } from 'react'

type NumProps = {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string // для скринридера
  className?: string
}

/**
 * Числовое поле. Пока значение в диапазоне, изменения применяются сразу;
 * незавершенный ввод дожидается потери фокуса и тогда подрезается к диапазону
 */
export function NumInput({ value, onChange, min = 0, max = 10_000_000, step = 1, label, className = 'w-24' }: NumProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'))
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      className={`field field-sm text-right tabular-nums ${className}`}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const v = Number(raw.replace(',', '.'))
        if (Number.isFinite(v) && v >= min && v <= max && raw !== '') onChange(v)
      }}
      onBlur={(e) => {
        if (draft !== null) commit(e.target.value)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

type SelectProps<T extends string> = {
  value: T
  options: { id: T; title: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}

export function SelectInput<T extends string>({ value, options, onChange, label, className = '' }: SelectProps<T>) {
  return (
    <select className={`field field-sm ${className}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      className="toggle print-hide"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

type TextProps = { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; required?: boolean }

export function TextInput({ value, onChange, label, placeholder, className = '', required }: TextProps) {
  return (
    <input
      type="text"
      className={`field field-sm ${className}`}
      aria-label={label}
      placeholder={placeholder ?? label}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Кнопка второго плана */
export function GhostButton({ children, onClick, type = 'button', disabled }: { children: string; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-white/20 px-3.5 py-2 text-sm hover:border-amber hover:text-amber disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:text-inherit"
    >
      {children}
    </button>
  )
}

export function PrimaryButton({ children, onClick, type = 'button', disabled }: { children: string; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-black hover:bg-amber-deep disabled:opacity-40"
    >
      {children}
    </button>
  )
}
