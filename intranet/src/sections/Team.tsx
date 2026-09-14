import { useState, type FormEvent } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, ScrollHint, Tag } from '../components/Card'
import { GhostButton, NumInput, PrimaryButton, TextInput, Toggle } from '../components/Inputs'
import { founderRoles } from '../data/team'
import { financeConstants, housingExample } from '../data/finance'
import { housingEffect, payrollOf } from '../model/finance'
import type { CustomTeam } from '../model/config'
import type { ConfigApi } from '../hooks/useConfig'
import { num, usd } from '../lib/format'

const emptyDraft = (): CustomTeam => ({ role: '', enabled: true, qty: 1, salary: 0 })

export function Team({ config, edit }: { config: ConfigApi; edit: boolean }) {
  const { teamRows: rows, constants, updateTeam, addTeam, removeTeam, resetTeam, teamEdited, setConstant } = config
  const tax = constants.payrollTaxPct
  const active = rows.filter((r) => r.enabled)
  const shown = edit ? rows : active
  const total = payrollOf(active, constants)
  const [draft, setDraft] = useState<CustomTeam>(emptyDraft)

  // Общежитие и питание
  const housing = housingEffect(active, constants)
  const housingOn = constants.housedSharePct > 0 && (constants.housingPerPerson > 0 || constants.mealsPerPerson > 0 || constants.housedSalaryDiscountPct > 0)
  const housingKeys = ['housingPerPerson', 'mealsPerPerson', 'housedSharePct', 'housedSalaryDiscountPct'] as const
  const setExample = () => housingKeys.forEach((k) => setConstant(k, housingExample[k]))
  const clearHousing = () => housingKeys.forEach((k) => setConstant(k, financeConstants[k]))
  const salaryFactor = 1 - (constants.housedSharePct / 100) * (constants.housedSalaryDiscountPct / 100)

  const housingFields: { key: (typeof housingKeys)[number]; label: string; unit: string; max: number; step: number }[] = [
    { key: 'housingPerPerson', label: 'Проживание на человека в месяц', unit: '$', max: 2000, step: 10 },
    { key: 'mealsPerPerson', label: 'Питание на человека в месяц', unit: '$', max: 2000, step: 10 },
    { key: 'housedSharePct', label: 'Доля штата в общежитии', unit: '%', max: 100, step: 5 },
    { key: 'housedSalaryDiscountPct', label: 'Ниже зарплата gross у живущих', unit: '%', max: 50, step: 1 },
  ]

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.role.trim()) return
    addTeam({ ...draft, role: draft.role.trim() })
    setDraft(emptyDraft())
  }

  return (
    <Section id="team" index={7} title="Команда" lead={`Штат на старте. Налоги и взносы +${tax}% сверх gross, ФОТ считается автоматически`}>
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
        <Card className="lg:col-span-5" title="Штат на старте">
          <p className="text-3xl font-semibold tracking-tight text-amber tabular-nums">{total.headcount} человек</p>
          <p className="mt-1 text-muted">ФОТ с налогами {usd(total.total)} в месяц</p>
          {teamEdited && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Tag>штат изменен</Tag>
              {edit && (
                <span className="print-hide">
                  <GhostButton onClick={resetTeam}>Вернуть исходный штат</GhostButton>
                </span>
              )}
            </div>
          )}
        </Card>
      </Bento>

      <Card className="p-0! sm:p-0!">
        <ScrollHint />
        <div className="overflow-x-auto">
          <table className={`tbl ${edit ? 'min-w-[900px]' : 'min-w-[760px]'}`}>
            <thead>
              <tr>
                <th className="sticky-col">Роль</th>
                <th className="num">Кол-во</th>
                <th className="num">Зарплата gross</th>
                <th className="num">Налоги +{tax}%</th>
                <th className="num">Итого в месяц</th>
                <th>Когда нанимаем</th>
                <th>Где ищем</th>
                {edit && (
                  <th className="print-hide">
                    <span className="sr-only">Действия</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const gross = r.qty * r.salary * salaryFactor
                const taxes = gross * (tax / 100)
                return (
                  <tr key={r.id} className={r.enabled ? '' : 'row-off'}>
                    <td className="sticky-col min-w-56 max-w-64">
                      <div className="flex items-start gap-2.5">
                        {edit && (
                          <span className="pt-0.5">
                            <Toggle checked={r.enabled} onChange={(v) => updateTeam(r.id, { enabled: v })} label={`${r.role}: учитывать`} />
                          </span>
                        )}
                        <span>
                          <span className="row-name font-semibold">{r.role}</span>
                          {edit && r.changed && !r.custom && <span className="changed-mark text-xs ml-1.5">изменено</span>}
                          {r.custom && <span className="changed-mark text-xs ml-1.5">добавлено</span>}
                          {r.note && !r.custom && <span className="block text-xs text-muted">{r.note}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="num">
                      {edit ? <NumInput value={r.qty} min={0} max={99} label={`${r.role}: количество`} onChange={(v) => updateTeam(r.id, { qty: v })} className="w-16" /> : r.qty}
                    </td>
                    <td className="num">
                      {edit ? (
                        <NumInput value={r.salary} max={100000} step={50} label={`${r.role}: зарплата`} onChange={(v) => updateTeam(r.id, { salary: v })} className="w-28" />
                      ) : (
                        usd(r.salary)
                      )}
                    </td>
                    <td className="num">{usd(taxes)}</td>
                    <td className="num">{usd(gross + taxes)}</td>
                    <td className="text-muted">{r.when || '—'}</td>
                    <td className="text-muted">{r.where || '—'}</td>
                    {edit && (
                      <td className="print-hide text-right">
                        {r.custom && (
                          <button type="button" onClick={() => removeTeam(r.id)} className="text-xs text-muted hover:text-amber" aria-label={`Удалить ${r.role}`}>
                            Удалить
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Итого</td>
                <td className="num">{total.headcount}</td>
                <td className="num">{usd(total.gross)}</td>
                <td className="num">{usd(total.taxes)}</td>
                <td className="num text-amber">{usd(total.total)}</td>
                <td colSpan={edit ? 3 : 2} className="text-muted font-normal">
                  {salaryFactor < 1 ? `Gross с поправкой на общежитие: −${Math.round((1 - salaryFactor) * 100)}% в среднем по штату` : 'Gross без поправок'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {edit && (
          <form onSubmit={add} className="print-hide border-t border-white/10 p-4 sm:p-5">
            <p className="text-sm text-muted mb-3">Добавить роль. Попадет в адрес страницы вместе с остальными правками</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <TextInput value={draft.role} onChange={(v) => setDraft({ ...draft, role: v })} label="Роль" required className="col-span-2" />
              <NumInput value={draft.qty} min={1} max={99} label="Количество" onChange={(v) => setDraft({ ...draft, qty: v })} className="w-full" />
              <NumInput value={draft.salary} max={100000} step={50} label="Зарплата gross" onChange={(v) => setDraft({ ...draft, salary: v })} className="w-full" />
            </div>
            <div className="mt-3">
              <PrimaryButton type="submit">Добавить роль</PrimaryButton>
            </div>
          </form>
        )}
      </Card>

      <Bento className="mt-4">
        <Card className="lg:col-span-5" title="Общежитие и питание" big>
          <p className="text-muted text-pretty">
            Цех снимает дом или квартиры рядом и кормит смену. Это открывает найм релокантов и людей из регионов, снижает ожидания по зарплате и текучку
          </p>
          <ul className="mt-3 divide-y divide-white/10 text-sm">
            <li className="py-2">Нанимаем на 10–20% ниже рынка при гарантированном жилье и еде</li>
            <li className="py-2">Смена живет рядом с цехом: меньше опозданий и простоев</li>
            <li className="py-2">Стоимость проживания и питания в Ереване — к уточнению</li>
          </ul>
        </Card>
        <Card className="lg:col-span-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg sm:text-xl font-semibold tracking-tight">Эффект для штата</h3>
            {edit && (
              <div className="flex gap-2 print-hide">
                <GhostButton onClick={setExample}>Подставить пример</GhostButton>
                {housingOn && <GhostButton onClick={clearHousing}>Выключить</GhostButton>}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {housingFields.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3">
                <span className="text-muted">{f.label}</span>
                {edit ? (
                  <span className="flex items-center gap-1.5">
                    <NumInput value={constants[f.key]} max={f.max} step={f.step} label={f.label} onChange={(v) => setConstant(f.key, v)} className="w-24" />
                    <span className="text-xs text-muted w-5">{f.unit}</span>
                  </span>
                ) : (
                  <span className="font-semibold tabular-nums">
                    {f.unit === '$' ? usd(constants[f.key]) : `${constants[f.key]}%`}
                  </span>
                )}
              </label>
            ))}
          </div>
          <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-soft p-3">
              <dt className="text-xs text-muted">В общежитии</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{num(housing.housed, 1)} чел</dd>
            </div>
            <div className="glass-soft p-3">
              <dt className="text-xs text-muted">Расход в месяц</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{usd(housing.cost)}</dd>
            </div>
            <div className="glass-soft p-3">
              <dt className="text-xs text-muted">Экономия ФОТ с налогами</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{usd(housing.payrollSaving)}</dd>
            </div>
            <div className="glass-soft p-3">
              <dt className="text-xs text-muted">Чистый эффект в месяц</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-amber">
                {housing.net >= 0 ? '+' : ''}
                {usd(housing.net)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            {housingOn
              ? 'Учтено в OPEX и во всей финмодели'
              : edit
                ? 'Пока выключено: в модели нули. Введите стоимость или подставьте пример, чтобы увидеть эффект'
                : 'Пока не включено в модель: цифры появятся после уточнения стоимости'}
          </p>
        </Card>
      </Bento>
    </Section>
  )
}
