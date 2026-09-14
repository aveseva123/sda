import { useState, type FormEvent } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, ScrollHint, Tag } from '../components/Card'
import { GhostButton, NumInput, PrimaryButton, SelectInput, TextInput, Toggle } from '../components/Inputs'
import { founderRoles } from '../data/team'
import { phases, type Phase } from '../data/equipment'
import { payrollByPhase, payrollUpTo } from '../model/finance'
import type { CustomTeam } from '../model/config'
import type { ConfigApi } from '../hooks/useConfig'
import { usd } from '../lib/format'

const phaseLead: Record<Phase, string> = {
  start: 'Кто нужен к первому заказу',
  m6: 'Через 6 месяцев после первого заказа',
  m12: 'Через 12 месяцев: по образцу текущего цеха',
}
const phaseOptions = phases.map((p) => ({ id: p.id, title: p.title }))
const emptyDraft = (): CustomTeam => ({ role: '', enabled: true, qty: 1, salary: 0, phase: 'start' })

export function Team({ config }: { config: ConfigApi }) {
  const { teamRows: rows, constants, updateTeam, addTeam, removeTeam, resetTeam, teamEdited } = config
  const tax = constants.payrollTaxPct
  const active = rows.filter((r) => r.enabled)
  const total = payrollUpTo(active, 'm12', constants)
  const [draft, setDraft] = useState<CustomTeam>(emptyDraft)

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.role.trim()) return
    addTeam({ ...draft, role: draft.role.trim() })
    setDraft(emptyDraft())
  }

  return (
    <Section id="team" index={7} title="Команда" lead={`Штатное расписание по фазам. Налоги и взносы +${tax}% сверх gross, ФОТ считается автоматически. Роли можно выключать, менять и добавлять`}>
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
          <p className="mt-1 text-muted">ФОТ с налогами {usd(total.total)} в месяц</p>
          {teamEdited && (
            <div className="mt-3 flex flex-wrap items-center gap-2 print-hide">
              <Tag>штат изменен</Tag>
              <GhostButton onClick={resetTeam}>Вернуть исходный штат</GhostButton>
            </div>
          )}
        </Card>
      </Bento>

      <div className="space-y-4">
        {phases.map((ph) => {
          const group = rows.filter((r) => r.phase === ph.id)
          const sub = payrollByPhase(active, ph.id, constants)
          const cum = payrollUpTo(active, ph.id, constants)
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
                <table className="tbl min-w-[1040px]">
                  <thead>
                    <tr>
                      <th className="sticky-col">Роль</th>
                      <th className="num">Кол-во</th>
                      <th className="num">Зарплата gross</th>
                      <th className="num">Налоги +{tax}%</th>
                      <th className="num">Итого в месяц</th>
                      <th>Фаза</th>
                      <th>Когда нанимаем</th>
                      <th>Где ищем</th>
                      <th className="print-hide">
                        <span className="sr-only">Действия</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-muted">
                          В этой фазе никого нет
                        </td>
                      </tr>
                    )}
                    {group.map((r) => {
                      const gross = r.qty * r.salary
                      const taxes = gross * (tax / 100)
                      return (
                        <tr key={r.id} className={r.enabled ? '' : 'row-off'}>
                          <td className="sticky-col min-w-56 max-w-64">
                            <div className="flex items-start gap-2.5">
                              <span className="pt-0.5">
                                <Toggle checked={r.enabled} onChange={(v) => updateTeam(r.id, { enabled: v })} label={`${r.role}: учитывать`} />
                              </span>
                              <span>
                                <span className="row-name font-semibold">{r.role}</span>
                                {r.changed && !r.custom && <span className="changed-mark text-xs ml-1.5">изменено</span>}
                                {r.custom && <span className="changed-mark text-xs ml-1.5">добавлено</span>}
                                {r.note && !r.custom && <span className="block text-xs text-muted">{r.note}</span>}
                              </span>
                            </div>
                          </td>
                          <td className="num">
                            <NumInput value={r.qty} min={0} max={99} label={`${r.role}: количество`} onChange={(v) => updateTeam(r.id, { qty: v })} className="w-16" />
                          </td>
                          <td className="num">
                            <NumInput value={r.salary} max={100000} step={50} label={`${r.role}: зарплата`} onChange={(v) => updateTeam(r.id, { salary: v })} className="w-28" />
                          </td>
                          <td className="num">{usd(taxes)}</td>
                          <td className="num">{usd(gross + taxes)}</td>
                          <td>
                            <SelectInput value={r.phase} options={phaseOptions} label={`${r.role}: фаза`} onChange={(v: Phase) => updateTeam(r.id, { phase: v })} />
                          </td>
                          <td className="text-muted">{r.when || '—'}</td>
                          <td className="text-muted">{r.where || '—'}</td>
                          <td className="print-hide text-right">
                            {r.custom && (
                              <button type="button" onClick={() => removeTeam(r.id)} className="text-xs text-muted hover:text-amber" aria-label={`Удалить ${r.role}`}>
                                Удалить
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="sticky-col">Итого по фазе</td>
                      <td className="num">{sub.headcount}</td>
                      <td className="num">{usd(sub.gross)}</td>
                      <td className="num">{usd(sub.taxes)}</td>
                      <td className="num text-amber">{usd(sub.total)}</td>
                      <td colSpan={4} className="text-muted font-normal">
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

      <Card className="mt-4">
        <form onSubmit={add} className="print-hide">
          <p className="text-sm text-muted mb-3">Добавить роль. Попадет в адрес страницы вместе с остальными правками</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <TextInput value={draft.role} onChange={(v) => setDraft({ ...draft, role: v })} label="Роль" required className="col-span-2" />
            <NumInput value={draft.qty} min={1} max={99} label="Количество" onChange={(v) => setDraft({ ...draft, qty: v })} className="w-full" />
            <NumInput value={draft.salary} max={100000} step={50} label="Зарплата gross" onChange={(v) => setDraft({ ...draft, salary: v })} className="w-full" />
            <SelectInput value={draft.phase} options={phaseOptions} label="Фаза" onChange={(v: Phase) => setDraft({ ...draft, phase: v })} className="w-full" />
          </div>
          <div className="mt-3">
            <PrimaryButton type="submit">Добавить роль</PrimaryButton>
          </div>
        </form>
      </Card>
    </Section>
  )
}
