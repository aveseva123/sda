import type { ReactNode } from 'react'
import type { SectionId } from '../data/sections'

type Props = {
  id: SectionId
  index: number
  title: string
  lead?: string
  children: ReactNode
}

export function Section({ id, index, title, lead, children }: Props) {
  return (
    <section id={id} className="section scroll-mt-24 lg:scroll-mt-8 py-10 sm:py-14 lg:py-16" aria-labelledby={`${id}-title`}>
      <header className="mb-6 sm:mb-8 max-w-3xl">
        <p className="text-sm text-muted tabular-nums">{String(index).padStart(2, '0')}</p>
        <h2 id={`${id}-title`} className="mt-1 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-balance">
          {title}
        </h2>
        {lead && <p className="mt-3 text-base sm:text-lg text-muted text-pretty">{lead}</p>}
      </header>
      {children}
    </section>
  )
}
