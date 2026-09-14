// Ключевая цифра: подпись сверху, крупное число янтарным, пояснение снизу
type Props = {
  label: string
  value: string
  note?: string
  className?: string
}

export function Stat({ label, value, note, className = '' }: Props) {
  return (
    <div className={`glass p-5 sm:p-6 min-w-0 ${className}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-amber tabular-nums break-words">{value}</p>
      {note && <p className="mt-2 text-sm text-muted text-pretty">{note}</p>}
    </div>
  )
}
