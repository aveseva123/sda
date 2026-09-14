import { Section } from '../components/Section'
import { Card } from '../components/Card'
import { milestones, roadmapBars, roadmapMonths } from '../data/roadmap'

export function Roadmap() {
  const cols = `repeat(${roadmapMonths}, minmax(0, 1fr))`
  return (
    <Section id="roadmap" index={11} title="Дорожная карта" lead="18 месяцев от регистрации до расширения. Полосы — этапы, точки — вехи">
      <Card className="p-0! sm:p-0!">
        <div className="overflow-x-auto">
          <div className="min-w-[860px] p-5 sm:p-6">
            {/* Шкала месяцев */}
            <div className="grid" style={{ gridTemplateColumns: `13rem ${cols}` }} aria-hidden="true">
              <div />
              {Array.from({ length: roadmapMonths }, (_, i) => (
                <div key={i} className="text-center text-xs text-muted tabular-nums pb-2">
                  {i + 1}
                </div>
              ))}
            </div>

            <ol className="space-y-1.5">
              {roadmapBars.map((b) => (
                <li key={b.title} className="grid items-center min-h-8" style={{ gridTemplateColumns: `13rem ${cols}` }}>
                  <span className="text-sm pr-3 leading-tight">{b.title}</span>
                  <span
                    className="h-6 rounded-md bg-amber/85 print-bar"
                    style={{ gridColumn: `${b.start + 1} / ${b.end + 2}` }}
                    role="img"
                    aria-label={`${b.title}: месяцы ${b.start}–${b.end}`}
                  />
                </li>
              ))}
            </ol>

            {/* Вехи */}
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="grid" style={{ gridTemplateColumns: `13rem ${cols}` }}>
                <span className="text-sm text-muted">Вехи</span>
                {Array.from({ length: roadmapMonths }, (_, i) => {
                  const ms = milestones.filter((m) => m.month === i + 1)
                  return (
                    <div key={i} className="flex justify-center">
                      {ms.length > 0 && <span className="w-3 h-3 rounded-full bg-amber print-bar" aria-hidden="true" />}
                    </div>
                  )
                })}
              </div>
              <ol className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
                {milestones.map((m) => (
                  <li key={m.title} className="flex gap-2">
                    <span className="text-muted tabular-nums w-14 shrink-0">мес {m.month}</span>
                    <span>{m.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </Card>
    </Section>
  )
}
