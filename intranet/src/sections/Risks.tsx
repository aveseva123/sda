import { Section } from '../components/Section'
import { Card, ScrollHint } from '../components/Card'
import { risks, type Level } from '../data/risks'

const probLabel: Record<Level, string> = { low: 'низкая', mid: 'средняя', high: 'высокая' }
const impactLabel: Record<Level, string> = { low: 'низкое', mid: 'среднее', high: 'высокое' }

function Dots({ level }: { level: Level }) {
  const n = { low: 1, mid: 2, high: 3 }[level]
  return (
    <span className="inline-flex gap-1 align-middle mr-2" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`inline-block w-2 h-2 rounded-full ${i <= n ? 'bg-white print-bar' : 'bg-white/20 print-bg-line'}`} />
      ))}
    </span>
  )
}

export function Risks() {
  return (
    <Section id="risks" index={12} title="Риски" lead="Что может пойти не так и что делаю заранее">
      <Card className="p-0! sm:p-0!">
        <ScrollHint />
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>Риск</th>
                <th>Вероятность</th>
                <th>Влияние</th>
                <th>Как закрываю</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.risk}>
                  <td className="font-semibold min-w-44">{r.risk}</td>
                  <td className="whitespace-nowrap">
                    <Dots level={r.probability} />
                    {probLabel[r.probability]}
                  </td>
                  <td className="whitespace-nowrap">
                    <Dots level={r.impact} />
                    {impactLabel[r.impact]}
                  </td>
                  <td className="text-muted min-w-72 text-pretty">{r.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  )
}
