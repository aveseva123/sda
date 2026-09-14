import type { ReactNode } from 'react'

type Props = {
  title?: string
  children?: ReactNode
  className?: string
  /** Заголовок крупнее — для главных плиток бенто */
  big?: boolean
  as?: 'div' | 'article' | 'li'
}

/** Стеклянная плитка */
export function Card({ title, children, className = '', big = false, as = 'div' }: Props) {
  const Tag = as
  return (
    <Tag className={`glass p-5 sm:p-6 min-w-0 ${className}`}>
      {title && (
        <h3 className={`font-semibold tracking-tight text-balance ${big ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'} ${children ? 'mb-3' : ''}`}>
          {title}
        </h3>
      )}
      {children}
    </Tag>
  )
}

/** Сетка бенто: 12 колонок на десктопе, 1–2 на мобильном */
export function Bento({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 sm:gap-4 ${className}`}>{children}</div>
}

/** Список без маркеров, с тонкими разделителями */
export function List({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`divide-y divide-white/10 ${className}`}>
      {items.map((it) => (
        <li key={it} className="py-2 text-sm sm:text-base text-pretty">
          {it}
        </li>
      ))}
    </ul>
  )
}

/** Пометка «к уточнению» и подобные */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-white/20 px-2.5 py-0.5 text-xs text-muted align-middle">
      {children}
    </span>
  )
}

/** Подсказка для телефона: таблица шире экрана */
export function ScrollHint() {
  return <p className="sm:hidden print-hide px-5 pt-4 -mb-1 text-xs text-muted">Таблица листается вбок</p>
}
