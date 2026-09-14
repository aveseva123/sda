import { Section } from '../components/Section'
import { Bento, Card, ScrollHint } from '../components/Card'
import { founderRoles, team } from '../data/team'
import { phases, type Phase } from '../data/equipment'
import { financeConstants as C } from '../data/finance'
import { payrollByPhase, payrollUpTo } from '../model/finance'
import { usd } from '../lib/format'

const phaseLead: Record<Phase, string> = {
  start: 'Кто нужен к первому заказу',
  m6: 'Через 6 месяцев после первого заказа',
  m12: 'Через 12 месяцев: по образцу текущего цеха',
}

export function Team() {
  const tax = C.payrollTaxPct
  const total = payrollUpTo(team, 'm12')
  return (
    <Section id="team" index={7} title="Команда" lead={`Штатное расписание по фазам. Налоги и взносы +${tax}% сверх gross, ФОТ считается автоматически`}>
      <Bento className="mb-6">
        <Card className="lg:col-span-7" title="Что закрываю сам на первом этапе" big>
          <ul className="flex flex-wrap gap-2">
            {founderRoles.map((r) => (
              <li key={r} className="rounded-full border border-white/15 px-3 py-1 text-sm">
                {r}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-5" title="Полный штат к +12 мес">
          <p className="text-3xl font-semibold tracking-tight text-amber tabular-nums">{total.headcount} человек</p>
          <p className="mt-1 text-muted">
            ФОТ с налогами {usd(total.total)} в месяц
          </p>
        </Card>
      </Bento>

      <div className="space-y-4">
        {phases.map((ph) => {
          const rows = team.filter((r) => r.phase === ph.id)
          const sub = payrollByPhase(team, ph.id)
          const cum = payrollUpTo(team, ph.id)
          return (
            <Card key={ph.id} className="p-0! sm:p-0!">
              <div className="px-5 sm:px-6 pt-5 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-semibold tracking-tight">
                  {ph.title} <span className="text-muted font-normal text-base">· {sub.headcount} человек</span>
                </h3>
                <p className="text-sm text-muted">{phaseLead[ph.id]}</p>
              </div>
              <ScrollHint />
              <div className="overflow-x-auto mt-3">
                <table className="tbl min-w-[860px]">
                  <thead>
                    <tr>
                      <th>Роль</th>
                      <th className="num">Кол-во</th>
                      <th className="num">Зарплата gross</th>
                      <th className="num">Налоги +{tax}%</th>
                      <th className="num">Итого в месяц</th>
                      <th>Когда нанимаем</th>
                      <th>Где ищем</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const gross = r.qty * r.salary
                      const taxes = gross * (tax / 100)
                      return (
                        <tr key={r.role}>
                          <td className="font-semibold min-w-44">
                            {r.role}
                            {r.note && <span className="block text-xs font-normal text-muted">{r.note}</span>}
                          </td>
                          <td className="num">{r.qty}</td>
                          <td className="num">{usd(r.salary)}</td>
                          <td className="num">{usd(taxes)}</td>
                          <td className="num">{usd(gross + taxes)}</td>
                          <td className="text-muted">{r.when}</td>
                          <td className="text-muted">{r.where}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Итого по фазе</td>
                      <td className="num">{sub.headcount}</td>
                      <td className="num">{usd(sub.gross)}</td>
                      <td className="num">{usd(sub.taxes)}</td>
                      <td className="num text-amber">{usd(sub.total)}</td>
                      <td colSpan={2} className="text-muted font-normal">
                        {ph.id !== 'start' && `Накопительно: ${cum.headcount} человек, ФОТ ${usd(cum.total)} в месяц`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )
        })}
      </div>
    </Section>
  )
}
