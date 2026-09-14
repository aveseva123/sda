import { useState } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, List, ScrollHint } from '../components/Card'
import { Segmented } from '../components/Segmented'
import { equipment, phases, type Phase, type Scenario } from '../data/equipment'
import { logistics, logisticsNote } from '../data/logistics'
import { equipmentCapex, equipmentRows } from '../model/finance'
import { financeConstants as C } from '../data/finance'
import { usd, usdRange } from '../lib/format'

type Props = { scenario: Scenario; onScenario: (s: Scenario) => void }

const phaseTitle: Record<Phase, string> = { start: 'Старт', m6: '+6 мес', m12: '+12 мес' }

export function Equipment({ scenario, onScenario }: Props) {
  const [phase, setPhase] = useState<Phase>('m12')
  const rows = equipmentRows(equipment, scenario, phase)
  const capex = equipmentCapex(rows)

  return (
    <Section id="equipment" index={6} title="Оборудование" lead="Сценарий A — компактный старт, B — расширение по фазам. Цены за единицу без доставки">
      <div className="flex flex-wrap gap-3 mb-4 print-hide">
        <Segmented label="Сценарий" value={scenario} options={[{ id: 'A', title: 'Сценарий A' }, { id: 'B', title: 'Сценарий B' }]} onChange={onScenario} />
        <Segmented label="Фаза" value={phase} options={phases} onChange={setPhase} />
      </div>
      <p className="text-sm text-muted mb-4">
        Показано накопительно: сценарий {scenario}, до фазы «{phaseTitle[phase]}» включительно. Строк: {rows.length}
        {scenario === 'A' && phase !== 'start' && '. В сценарии A докупок после старта нет'}
      </p>

      <Card className="p-0! sm:p-0!">
        <ScrollHint />
        <div className="overflow-x-auto">
          <table className="tbl min-w-[960px]">
            <thead>
              <tr>
                <th>Станок</th>
                <th className="num">Кол-во</th>
                <th className="num">Цена от – до</th>
                <th>Откуда</th>
                <th>Состояние</th>
                <th>Фаза</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold min-w-56">{r.name}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{usdRange(r.priceMin, r.priceMax)}</td>
                  <td className="whitespace-nowrap">{r.source}</td>
                  <td>{r.condition}</td>
                  <td className="whitespace-nowrap">
                    {phaseTitle[r.phase]}
                    {r.scenario === 'B' && <span className="text-muted"> · B</span>}
                  </td>
                  <td className="text-muted min-w-64 text-pretty">{r.comment}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Итого оборудование</td>
                <td className="num">{usdRange(capex.equipment.min, capex.equipment.max)}</td>
                <td colSpan={4} className="text-muted font-normal">
                  Сумма по строкам с учетом количества
                </td>
              </tr>
              <tr>
                <td colSpan={2}>
                  Доставка и таможня, {C.shippingPctMin}–{C.shippingPctMax}%
                </td>
                <td className="num">{usdRange(capex.shipping.min, capex.shipping.max)}</td>
                <td colSpan={4} className="text-muted font-normal">
                  Из России без пошлин, из Китая пошлина и НДС
                </td>
              </tr>
              <tr>
                <td colSpan={2} className="text-amber">
                  CAPEX по оборудованию
                </td>
                <td className="num text-amber">{usdRange(capex.total.min, capex.total.max)}</td>
                <td colSpan={4} className="text-muted font-normal">
                  В модели берется середина: {usd(capex.total.mid)}. Помещение, депозит и регистрация — в финмодели
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">Логистика</h3>
      <Bento>
        {logistics.map((l) => (
          <Card key={l.title} className="lg:col-span-4" title={l.title}>
            <List items={l.points} className="text-sm" />
          </Card>
        ))}
      </Bento>
      <p className="mt-3 text-sm text-muted">{logisticsNote}</p>
    </Section>
  )
}
