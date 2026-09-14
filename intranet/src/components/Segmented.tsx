// Переключатель из нескольких кнопок: сценарий A/B, фазы
type Option<T extends string> = { id: T; title: string }

type Props<T extends string> = {
  label: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
}

export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1 max-w-full">
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`px-3.5 py-1.5 text-sm rounded-lg whitespace-nowrap ${
              active ? 'bg-amber text-black font-semibold' : 'text-muted hover:text-white'
            }`}
          >
            {o.title}
          </button>
        )
      })}
    </div>
  )
}
