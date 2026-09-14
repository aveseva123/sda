import { useEffect, useRef } from 'react'
import { sections, type SectionId } from '../data/sections'

type Props = { active: SectionId; edit: boolean; onEdit: (v: boolean) => void }

function printPage() {
  window.print()
}

/** Боковая навигация для десктопа */
export function Sidebar({ active, edit, onEdit }: Props) {
  return (
    <aside className="print-hide hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col px-5 py-8 z-20">
      <a href="#summary" className="text-base font-semibold tracking-tight leading-tight">
        Цех HoReCa
        <span className="block text-sm font-normal text-muted">Ереван · бизнес-план</span>
      </a>
      <nav aria-label="Разделы" className="mt-8 flex-1 overflow-y-auto">
        <ol className="space-y-0.5">
          {sections.map((s, i) => {
            const isActive = s.id === active
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm ${
                    isActive ? 'text-amber font-semibold bg-white/6' : 'text-muted hover:text-white'
                  }`}
                >
                  <span className="w-5 text-xs tabular-nums opacity-70">{String(i + 1).padStart(2, '0')}</span>
                  <span>{s.title}</span>
                </a>
              </li>
            )
          })}
        </ol>
      </nav>
      <label className="mt-6 flex items-center gap-3 text-sm cursor-pointer">
        <input type="checkbox" className="toggle" checked={edit} onChange={(e) => onEdit(e.target.checked)} />
        <span>
          Режим правки
          <span className="block text-xs text-muted">{edit ? 'Ползунки и таблицы открыты' : 'Чистый вид для чтения'}</span>
        </span>
      </label>
      <button
        type="button"
        onClick={printPage}
        className="mt-4 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium hover:border-amber hover:text-amber"
      >
        Экспорт в PDF
      </button>
    </aside>
  )
}

/** Верхнее меню с горизонтальной прокруткой для мобильного */
export function TopNav({ active, edit, onEdit }: Props) {
  const scroller = useRef<HTMLDivElement>(null)

  // Активная кнопка всегда в поле зрения
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-id="${active}"]`)
    const box = scroller.current
    if (!el || !box) return
    const target = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' })
  }, [active])

  return (
    <div className="print-hide lg:hidden sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-black/70 backdrop-blur-xl border-b border-white/10">
      <div className="flex items-center justify-between gap-3">
        <a href="#summary" className="text-sm font-semibold tracking-tight">
          Цех HoReCa · Ереван
        </a>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(!edit)}
            aria-pressed={edit}
            className={`text-xs rounded-lg border px-2.5 py-1.5 ${edit ? 'border-amber text-amber font-semibold' : 'border-white/20'}`}
          >
            Правка
          </button>
          <button type="button" onClick={printPage} className="text-xs rounded-lg border border-white/20 px-2.5 py-1.5">
            PDF
          </button>
        </div>
      </div>
      <nav aria-label="Разделы" ref={scroller} className="mt-2 -mx-4 px-4 overflow-x-auto no-scrollbar">
        <ol className="flex gap-1.5 w-max">
          {sections.map((s) => {
            const isActive = s.id === active
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  data-id={s.id}
                  aria-current={isActive ? 'true' : undefined}
                  className={`block rounded-full px-3 py-1.5 text-sm whitespace-nowrap border ${
                    isActive ? 'border-amber text-amber font-semibold' : 'border-white/15 text-muted'
                  }`}
                >
                  {s.short}
                </a>
              </li>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}
