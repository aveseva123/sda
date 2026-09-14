import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, Tag } from '../components/Card'
import { Slider } from '../components/Slider'
import { CashChart } from '../components/CashChart'
import { GhostButton, NumInput, PrimaryButton } from '../components/Inputs'
import { constantGroups, financeConstants, financeRanges } from '../data/finance'
import { sensitivity, tranches, type LoadResult, type ModelResult } from '../model/finance'
import { activeRows } from '../model/config'
import type { ConfigApi } from '../hooks/useConfig'
import { amd, num, usd, usdRange, usdRangeShort, usdShort } from '../lib/format'

type Props = { model: ModelResult; config: ConfigApi; edit: boolean; onEdit: (v: boolean) => void }

function Row({ label, value, note, strong = false }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <tr>
      <td className={strong ? 'font-semibold' : ''}>
        {label}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </td>
      <td className={`num ${strong ? 'font-semibold text-amber' : ''}`}>{value}</td>
    </tr>
  )
}

function Metric({ label, value, note, big = false }: { label: string; value: string; note?: string; big?: boolean }) {
  return (
    <div className={`glass p-5 sm:p-6 ${big ? 'sm:col-span-2' : ''}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 font-semibold tracking-tight text-amber tabular-nums break-words ${big ? 'text-4xl sm:text-5xl' : 'text-3xl'}`}>{value}</p>
      {note && <p className="mt-1 text-sm text-muted text-pretty">{note}</p>}
    </div>
  )
}

function ScenarioCard({ r, base, horizon, paybackSearch }: { r: LoadResult; base: boolean; horizon: number; paybackSearch: number }) {
  const inv = r.investment.total
  const rows: [string, string][] = [
    ['Нужная инвестиция', usdRangeShort(inv.min, inv.max)],
    ['Выход в ноль', r.zeroMonth ? `мес ${r.zeroMonth}` : `нет за ${horizon} мес`],
    ['Окупаемость', r.payback ? `${r.payback} мес` : `нет за ${paybackSearch} мес`],
    ['Минимум кассы', `${usdShort(r.minCash.value)} · мес ${r.minCash.month}`],
    [`Касса к ${horizon} мес`, usdShort(r.cashAtEnd)],
    ['Накоплено к 36 мес', usdShort(r.cumulative36)],
    ['Объектов в месяц к концу', num(r.objectsAtEnd, 2)],
  ]
  return (
    <Card className={`lg:col-span-4 ${base ? 'border-amber/50!' : ''}`}>
      <p className="text-sm text-muted">{r.label}</p>
      <h3 className="text-2xl font-semibold tracking-tight">{r.title}</h3>
      <dl className="mt-4 space-y-2.5 text-sm">
        {rows.map(([k, v], i) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={`tabular-nums text-right ${i === 0 ? 'font-semibold text-amber' : ''}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

export function Finance({ model, config, edit, onEdit }: Props) {
  const { params, setParam: set, resetAll, isDefault, constants: C, setConstant, resetConstants, constantsEdited, equipmentEdited, teamEdited, equipmentRows, teamRows } = config
  const [copied, setCopied] = useState(false)
  const inv = model.base.investment
  const capex = model.capex
  const opex = model.opex
  const firstOrder = params.monthsToFirstOrder + 1
  const r = financeRanges

  const trancheRows = useMemo(() => tranches(params, inv, model.base.curve), [params, inv, model.base.curve])
  const sens = useMemo(
    () => sensitivity(params, activeRows(equipmentRows), activeRows(teamRows), C),
    [params, equipmentRows, teamRows, C],
  )

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Скопируйте ссылку', window.location.href)
    }
  }

  const profitPerObject = params.avgBudget * (params.marginPct / 100)
  const flowNote = model.flowForPayback36
    ? `Для окупаемости за 36 мес нужно ≈ ${num(model.flowForPayback36, 0)} объектов в год, сейчас ${params.anchorPerYear + params.externalPerYear}`
    : 'Не окупается даже при десятикратном потоке: смотрите маржу и OPEX'
  const utilPct = Math.round(model.utilizationAtEnd * 100)

  const assumptions: [string, string][] = [
    ['Площадь', `${params.areaM2} м²`],
    ['Аренда', `$${num(params.rentPerM2, 2)} за м² в мес`],
    ['Средний бюджет мебели на объект', usd(params.avgBudget)],
    ['Объектов от якорного клиента в год', String(params.anchorPerYear)],
    ['Внешних объектов в год', String(params.externalPerYear)],
    ['Валовая маржа', `${params.marginPct}%`],
    ['Месяцев до первого заказа', String(params.monthsToFirstOrder)],
    ['Резерв', `${params.reservePct}%`],
    ['Курс драма к доллару', String(params.amdRate)],
  ]

  // Блоки раздела. Порядок зависит от режима: в правке карточка параметров высокая и занимает два ряда
  const blocks: Record<string, ReactNode> = {
    params: (
      <Card key="params" className={`lg:col-span-5 ${edit ? 'lg:row-span-2' : ''}`} title={edit ? 'Параметры' : 'Допущения модели'}>
        {edit ? (
          <>
            <div className="space-y-4">
              <Slider label="Площадь" value={params.areaM2} {...r.areaM2} onChange={(v) => set('areaM2', v)} unit="м²" />
              <Slider label="Аренда" value={params.rentPerM2} {...r.rentPerM2} onChange={(v) => set('rentPerM2', v)} format={(v) => `$${num(v, 2)}`} unit="за м² в мес" />
              <Slider label="Средний бюджет мебели на объект" value={params.avgBudget} {...r.avgBudget} onChange={(v) => set('avgBudget', v)} format={usd} />
              <Slider label="Объектов от якорного клиента в год" value={params.anchorPerYear} {...r.anchorPerYear} onChange={(v) => set('anchorPerYear', v)} />
              <Slider label="Внешних объектов в год" value={params.externalPerYear} {...r.externalPerYear} onChange={(v) => set('externalPerYear', v)} />
              <Slider label="Валовая маржа" value={params.marginPct} {...r.marginPct} onChange={(v) => set('marginPct', v)} unit="%" />
              <Slider label="Месяцев до первого заказа" value={params.monthsToFirstOrder} {...r.monthsToFirstOrder} onChange={(v) => set('monthsToFirstOrder', v)} />
              <Slider label="Резерв" value={params.reservePct} {...r.reservePct} onChange={(v) => set('reservePct', v)} unit="%" />
              <Slider label="Курс драма к доллару" value={params.amdRate} {...r.amdRate} onChange={(v) => set('amdRate', v)} unit="драм за $1" />
            </div>
            <div className="print-hide mt-5 flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={copyLink}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</PrimaryButton>
              <GhostButton onClick={resetAll} disabled={isDefault}>
                Сбросить все
              </GhostButton>
            </div>
            {(equipmentEdited || teamEdited || constantsEdited) && (
              <p className="mt-3 text-xs text-muted">
                Учтены правки: {[equipmentEdited && 'станки', teamEdited && 'штат', constantsEdited && 'константы'].filter(Boolean).join(', ')}
              </p>
            )}
          </>
        ) : (
          <>
            <dl className="divide-y divide-white/10 text-sm">
              {assumptions.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold tabular-nums text-right">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              Штат {model.headcount} человек, {activeRows(equipmentRows).length} позиций оборудования
              {!isDefault && '. Сценарий отличается от базового'}
            </p>
            <div className="print-hide mt-4 flex flex-wrap gap-2">
              <GhostButton onClick={() => onEdit(true)}>Изменить параметры</GhostButton>
              <GhostButton onClick={copyLink}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</GhostButton>
            </div>
          </>
        )}
      </Card>
    ),
    results: (
      <div key="results" className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Metric
          big
          label="Нужная инвестиция"
          value={usdRangeShort(inv.total.min, inv.total.max)}
          note={`В модели ${usd(inv.total.mid)} ≈ ${amd(inv.total.mid * params.amdRate)}. CAPEX ${usdShort(capex.total.mid)} + оборотка ${usdShort(inv.workingCapital.mid)} + резерв ${params.reservePct}%`}
        />
        <Metric label="OPEX в месяц" value={usdShort(opex.total)} note={`${opex.headcount} человек, ${usdShort(opex.payroll)} ФОТ с налогами`} />
        <Metric label="Точка безубыточности" value={`${num(model.breakEven, 2)} объекта в мес`} note={`${num(model.breakEven * 12, 1)} в год при ${usdShort(profitPerObject)} валовой прибыли с объекта`} />
        <Metric
          label="Выход в ноль"
          value={inv.zeroMonth ? `мес ${inv.zeroMonth}` : `нет за ${C.horizonMonths} мес`}
          note={inv.zeroMonth ? 'Валовая прибыль месяца покрывает OPEX' : `Заказов мало: оборотка заложена на все ${C.horizonMonths} мес`}
        />
        <Metric label="Срок окупаемости" value={model.base.payback ? `${model.base.payback} мес` : `нет за ${C.paybackSearchMonths} мес`} note={flowNote} />
      </div>
    ),
    chart: (
      <Card key="chart" className="lg:col-span-7" title={`Кэш-кривая на ${C.horizonMonths} месяцев`}>
        <CashChart base={model.base} pessimistic={model.pessimistic} optimistic={model.optimistic} firstOrderMonth={firstOrder} />
      </Card>
    ),
    tranches: (
      <Card key="tranches" className="lg:col-span-5" title="Когда нужны деньги">
        <ol className="divide-y divide-white/10">
          {trancheRows.map((t) => (
            <li key={t.title} className="py-3">
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{t.title}</span>
                <span className="font-semibold text-amber tabular-nums">{usdShort(t.amount)}</span>
              </div>
              <p className="text-xs text-muted">
                {t.months} · {t.note}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">Сумма траншей и резерва равна нужной инвестиции в модели: {usd(inv.total.mid)}</p>
      </Card>
    ),
    economics: (
      <Card key="economics" className="lg:col-span-6" title="Экономика одного объекта">
        <dl className="divide-y divide-white/10 text-sm">
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Средний бюджет мебели</dt>
            <dd className="font-semibold tabular-nums">{usd(params.avgBudget)}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Материалы, субподряд, доставка ({100 - params.marginPct}%)</dt>
            <dd className="tabular-nums">−{usd(params.avgBudget - profitPerObject)}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Валовая прибыль ({params.marginPct}%)</dt>
            <dd className="font-semibold text-amber tabular-nums">{usd(profitPerObject)}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Объектов в месяц, чтобы покрыть OPEX</dt>
            <dd className="tabular-nums">{num(model.breakEven, 2)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">Зарплаты цеха сидят в OPEX, поэтому валовая прибыль объекта идет на их покрытие целиком</p>
      </Card>
    ),
    capacity: (
      <Card key="capacity" className="lg:col-span-6" title="Мощность цеха">
        <p className="text-3xl font-semibold tracking-tight text-amber tabular-nums">{num(C.capacityObjectsPerMonth, 1)} объекта в месяц</p>
        <p className="mt-1 text-sm text-muted">Оценка при стартовом штате и одном ЧПУ, к уточнению по первым заказам</p>
        <dl className="mt-4 divide-y divide-white/10 text-sm">
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Точка безубыточности от мощности</dt>
            <dd className="tabular-nums">{C.capacityObjectsPerMonth > 0 ? `${Math.round((model.breakEven / C.capacityObjectsPerMonth) * 100)}%` : '—'}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Загрузка потоком заказов к {C.horizonMonths} мес</dt>
            <dd className={`tabular-nums ${utilPct > 100 ? 'text-amber font-semibold' : ''}`}>{utilPct}%</dd>
          </div>
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-muted">Потолок выручки в год при полной загрузке</dt>
            <dd className="tabular-nums">{usdShort(C.capacityObjectsPerMonth * 12 * params.avgBudget)}</dd>
          </div>
        </dl>
        {utilPct > 100 && <p className="mt-3 text-xs text-amber">Поток заказов выше мощности: нужна вторая смена или второй ЧПУ, иначе сроки поедут</p>}
      </Card>
    ),
    scenarios: (
      <Fragment key="scenarios">
        <ScenarioCard r={model.pessimistic} base={false} horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />
        <ScenarioCard r={model.base} base horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />
        <ScenarioCard r={model.optimistic} base={false} horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />
      </Fragment>
    ),
    capex: (
      <Card key="capex" className="lg:col-span-6 p-0! sm:p-0!">
        <h3 className="px-5 sm:px-6 pt-5 text-xl font-semibold tracking-tight">CAPEX по статьям</h3>
        <div className="overflow-x-auto mt-3">
          <table className="tbl">
            <tbody>
              <Row label="Оборудование" note="включенные строки таблицы" value={usdRange(capex.equipment.min, capex.equipment.max)} />
              <Row label="Доставка и таможня" note={`${C.shippingPctMin}–${C.shippingPctMax}%`} value={usdRange(capex.shipping.min, capex.shipping.max)} />
              <Row label="Подготовка помещения" value={usdRange(capex.fitOut.min, capex.fitOut.max)} />
              <Row label="Депозит по аренде" note={`${C.depositMonths} мес × ${params.areaM2} м² × $${num(params.rentPerM2, 2)}`} value={usd(capex.deposit.mid)} />
              <Row label="Регистрация, ПО, юристы" value={usdRange(capex.registration.min, capex.registration.max)} />
            </tbody>
            <tfoot>
              <Row label="CAPEX" value={usdRange(capex.total.min, capex.total.max)} strong />
              <Row label="Материалы на первые заказы" value={usdRange(inv.materials.min, inv.materials.max)} />
              <Row label="OPEX до выхода в ноль" note={`${inv.monthsToZero} мес`} value={usd(inv.opexUntilZero)} />
              <Row label="Резерв" note={`${params.reservePct}% от CAPEX и оборотки`} value={usdRange(inv.reserve.min, inv.reserve.max)} />
              <Row label="Нужная инвестиция" value={usdRange(inv.total.min, inv.total.max)} strong />
            </tfoot>
          </table>
        </div>
      </Card>
    ),
    opex: (
      <Card key="opex" className="lg:col-span-6 p-0! sm:p-0!">
        <h3 className="px-5 sm:px-6 pt-5 text-xl font-semibold tracking-tight">OPEX в месяц</h3>
        <div className="overflow-x-auto mt-3">
          <table className="tbl">
            <tbody>
              <Row label="ФОТ gross" note={`${opex.headcount} человек`} value={usd(opex.payrollGross)} />
              <Row label={`Налоги и взносы +${C.payrollTaxPct}%`} value={usd(opex.payrollTaxes)} />
              <Row label="Аренда" note={`${params.areaM2} м² × $${num(params.rentPerM2, 2)}`} value={usd(opex.rent)} />
              <Row label="Электричество" value={usd(opex.electricity)} />
              <Row label="Прочее" note="связь, расходники, бухгалтерия, транспорт" value={usd(opex.other)} />
              {opex.housing > 0 && <Row label="Общежитие и питание" note={`${C.housedSharePct}% штата, зарплата у них ниже на ${C.housedSalaryDiscountPct}%`} value={usd(opex.housing)} />}
            </tbody>
            <tfoot>
              <Row label="OPEX в месяц" value={usd(opex.total)} strong />
              <Row label="В драмах" note={`курс ${params.amdRate}`} value={amd(opex.total * params.amdRate)} />
            </tfoot>
          </table>
        </div>
      </Card>
    ),
    sensitivity: (
      <Card key="sensitivity" className={`${edit ? 'lg:col-span-7' : 'lg:col-span-12'} p-0! sm:p-0!`}>
        <h3 className="px-5 sm:px-6 pt-5 text-xl font-semibold tracking-tight">Что влияет сильнее всего</h3>
        <p className="px-5 sm:px-6 mt-1 text-sm text-muted">
          Меняем один вход, остальное как в параметрах. База: {num(model.breakEven, 2)} объекта в месяц, {usdShort(inv.total.mid)} инвестиции, поток к 36 мес {usdShort(model.base.cumulative36)}
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>Вход</th>
                <th>Изменение</th>
                <th className="num">Точка безубыточности</th>
                <th className="num">Нужная инвестиция</th>
                <th className="num">Поток к 36 мес</th>
              </tr>
            </thead>
            <tbody>
              {sens.map((s) => {
                const d = (v: number, base: number, f: (n: number) => string) => {
                  const diff = v - base
                  return (
                    <span className="text-muted">
                      ({diff >= 0 ? '+' : '−'}
                      {f(Math.abs(diff))})
                    </span>
                  )
                }
                return (
                  <tr key={`${s.title}-${s.change}`}>
                    <td className="font-semibold">{s.title}</td>
                    <td className="tabular-nums">{s.change}</td>
                    <td className="num">
                      {num(s.breakEven, 2)} {d(s.breakEven, model.breakEven, (n) => num(n, 2))}
                    </td>
                    <td className="num">
                      {usdShort(s.investment)} {d(s.investment, inv.total.mid, usdShort)}
                    </td>
                    <td className="num">
                      {usdShort(s.cumulative36)} {d(s.cumulative36, model.base.cumulative36, usdShort)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    ),
    constants: edit ? (
      <Card key="constants" className="lg:col-span-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-xl font-semibold tracking-tight">
            Константы модели {constantsEdited && <Tag>изменены</Tag>}
          </h3>
          {constantsEdited && (
            <span className="print-hide">
              <GhostButton onClick={resetConstants}>Вернуть по умолчанию</GhostButton>
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">Все, что не вынесено на ползунки. Измененные значения подсвечены, значение по умолчанию показано рядом</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
          {constantGroups.map((g) => (
            <div key={g.title}>
              <h4 className="text-sm font-semibold mb-2">{g.title}</h4>
              <ul className="space-y-2">
                {g.fields.map((f) => {
                  const changed = C[f.key] !== financeConstants[f.key]
                  return (
                    <li key={f.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className={changed ? 'changed-mark' : 'text-muted'}>
                        {f.label}
                        {changed && <span className="block text-xs text-muted">по умолчанию {financeConstants[f.key]}</span>}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <NumInput value={C[f.key]} min={f.min} max={f.max} step={f.step} label={f.label} onChange={(v) => setConstant(f.key, v)} className="w-24" />
                        {f.unit && <span className="text-xs text-muted w-8">{f.unit}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    ) : null,
    how: (
      <Card key="how" className="lg:col-span-12" title="Как считает модель">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-muted">
          <li>Цены оборудования и подготовки — диапазоны, в кривой берется середина</li>
          <li>CAPEX распределен по месяцам подготовки, депозит — в первый месяц</li>
          <li>В подготовительные месяцы ФОТ и общежитие учтены на {C.prepPayrollSharePct}%: команда нанимается постепенно</li>
          <li>
            Якорный клиент дает заказы с первого месяца работы, внешние — с {C.externalStartMonthOfOps}-го и растут до полной скорости за {C.externalRampMonths} мес
          </li>
          <li>Выручка признается в месяц заказа, валовая прибыль = выручка × маржа</li>
          <li>Оборотка = материалы на первые заказы + OPEX за месяцы до выхода в ноль</li>
          <li>Окупаемость — месяц, когда накопленный денежный поток возвращается к нулю</li>
          <li>Выключенные строки станков и штата в расчет не входят</li>
        </ul>
      </Card>
    ),
  }
  const viewOrder = ['params', 'results', 'chart', 'tranches', 'economics', 'capacity', 'scenarios', 'capex', 'opex', 'sensitivity', 'how']
  const editOrder = ['params', 'results', 'chart', 'economics', 'capacity', 'tranches', 'sensitivity', 'scenarios', 'capex', 'opex', 'constants', 'how']

  return (
    <Section
      id="finance"
      index={9}
      title="Финансовая модель"
      lead={edit ? 'Все цифры считаются на лету. Параметры, правки станков, штата и констант хранятся в адресе страницы: ссылку со сценарием можно отправить как есть' : 'Сколько нужно денег, когда цех выходит в ноль и что на это влияет. Все цифры считаются из параметров ниже'}
    >
      <Bento>
        {(edit ? editOrder : viewOrder).map((k) => blocks[k])}
      </Bento>
    </Section>
  )
}
