import { useEffect, useMemo } from 'react'
import { Aurora } from './components/Aurora'
import { Sidebar, TopNav } from './components/Nav'
import { useUrlParams } from './hooks/useUrlParams'
import { useActiveSection } from './hooks/useActiveSection'
import { sections } from './data/sections'
import { equipment } from './data/equipment'
import { team } from './data/team'
import { computeModel } from './model/finance'

import { Summary } from './sections/Summary'
import { About } from './sections/About'
import { Market } from './sections/Market'
import { Product } from './sections/Product'
import { Premises } from './sections/Premises'
import { Equipment } from './sections/Equipment'
import { Team } from './sections/Team'
import { Operations } from './sections/Operations'
import { Finance } from './sections/Finance'
import { Investor } from './sections/Investor'
import { Roadmap } from './sections/Roadmap'
import { Risks } from './sections/Risks'
import { NextSteps } from './sections/NextSteps'

const ids = sections.map((s) => s.id)

export default function App() {
  const { params, set, reset, isDefault } = useUrlParams()
  const model = useMemo(() => computeModel(params, equipment, team), [params])
  const active = useActiveSection(ids)

  // Ссылка с якорем (#finance) открывается на нужном разделе: контент появляется после загрузки
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [])

  return (
    <>
      <Aurora />
      <Sidebar active={active} />
      <div className="relative z-10 px-4 sm:px-6 lg:px-10 lg:ml-60 print-main">
        <TopNav active={active} />
        <main className="mx-auto max-w-6xl pb-16">
          <Summary model={model} />
          <About />
          <Market />
          <Product />
          <Premises />
          <Equipment scenario={params.scenario} onScenario={(s) => set('scenario', s)} />
          <Team />
          <Operations />
          <Finance model={model} params={params} set={set} reset={reset} isDefault={isDefault} />
          <Investor />
          <Roadmap />
          <Risks />
          <NextSteps />
          <footer className="print-hide pt-8 text-sm text-muted border-t border-white/10">
            Внутренний документ. Все цифры по рынку Армении — к уточнению на встрече
          </footer>
        </main>
      </div>
    </>
  )
}
