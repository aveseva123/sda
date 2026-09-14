import { useState } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, Tag } from '../components/Card'
import { Slider } from '../components/Slider'
import { Segmented } from '../components/Segmented'
import { CashChart } from '../components/CashChart'
import { GhostButton, NumInput, PrimaryButton } from '../components/Inputs'
import { constantGroups, financeConstants, financeRanges } from '../data/finance'
import type { LoadResult, ModelResult } from '../model/finance'
import type { ConfigApi } from '../hooks/useConfig'
import { amd, num, usd, usdRange, usdRangeShort, usdShort } from '../lib/format'

type Props = { model: ModelResult; config: ConfigApi }

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

function ScenarioCard({ r, base, horizon, paybackSearch }: { r: LoadResult; base: boolean; horizon: number; paybackSearch: number }) {
  const inv = r.investment.total
  return (
    <Card className={`lg:col-span-4 ${base ? 'border-amber/50!' : ''}`}>
      <p className="text-sm text-muted">{r.label}</p>
      <h3 className="text-2xl font-semibold tracking-tight">{r.title}</h3>
      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Нужная инвестиция</dt>
          <dd className="font-semibold text-amber tabular-nums text-right">{usdRangeShort(inv.min, inv.max)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Операционный ноль</dt>
          <dd className="tabular-nums">{r.zeroMonth ? `мес ${r.zeroMonth}` : 'не в горизонте'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Окупаемость</dt>
          <dd className="tabular-nums">{r.payback ? `${r.payback} мес` : `нет за ${paybackSearch} мес`}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Минимум кассы</dt>
          <dd className="tabular-nums">
            {usdShort(r.minCash.value)} <span className="text-muted">· мес {r.minCash.month}</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Касса к {horizon} мес</dt>
          <dd className="tabular-nums">{usdShort(r.cashAtEnd)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Объектов в месяц к концу</dt>
          <dd className="tabular-nums">{num(r.objectsAtEnd, 2)}</dd>
        </div>
      </dl>
    </Card>
  )
}

export function Finance({ model, config }: Props) {
  const { params, setParam: set, resetAll, isDefault, constants: C, setConstant, resetConstants, constantsEdited, equipmentEdited, teamEdited } = config
  const [copied, setCopied] = useState(false)
  const inv = model.base.investment
  const capex = model.capex
  const opex = model.opexStart
  const firstOrder = params.monthsToFirstOrder + 1
  const r = financeRanges

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Скопируйте ссылку', window.location.href)
    }
  }

  return (
    <Section id="finance" index={9} title="Финансовая модель" lead="Все цифры считаются на лету. Параметры, правки станков, штата и констант хранятся в адресе страницы: ссылку со сценарием можно отправить как есть">
      <Bento>
        {/* Параметры */}
        <Card className="lg:col-span-5 lg:row-span-2" title="Параметры">
          <div className="print-hide mb-4">
            <Segmented
              label="Сценарий"
              value={params.scenario}
              options={[
                { id: 'A', title: 'Сценарий A' },
                { id: 'B', title: 'Сценарий B' },
              ]}
              onChange={(v) => set('scenario', v)}
            />
          </div>
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
        </Card>

        {/* Ключевые результаты */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="glass p-5 sm:p-6 sm:col-span-2">
            <p className="text-sm text-muted">Нужная инвестиция, сценарий {params.scenario}</p>
            <p className="mt-1 text-4xl sm:text-5xl font-semibold tracking-tight text-amber tabular-nums break-words">{usdRangeShort(inv.total.min, inv.total.max)}</p>
            <p className="mt-2 text-sm text-muted">
              В модели {usd(inv.total.mid)} ≈ {amd(inv.total.mid * params.amdRate)}. CAPEX {usdShort(capex.total.mid)} + оборотка {usdShort(inv.workingCapital.mid)} + резерв {params.reservePct}%
            </p>
          </div>
          <div className="glass p-5 sm:p-6">
            <p className="text-sm text-muted">OPEX в месяц на старте</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-amber tabular-nums">{usdShort(opex.total)}</p>
            <p className="mt-1 text-sm text-muted">
              {opex.headcount} человек, {usdShort(opex.payroll)} ФОТ с налогами
            </p>
          </div>
          <div className="glass p-5 sm:p-6">
            <p className="text-sm text-muted">Точка безубыточности</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-amber tabular-nums">{num(model.breakEvenStart, 2)} объекта в мес</p>
            <p className="mt-1 text-sm text-muted">
              {num(model.breakEvenStart * 12, 1)} в год
              {params.scenario === 'B' && `; при полном штате B — ${num(model.breakEvenFull, 2)} в мес`}
            </p>
          </div>
          <div className="glass p-5 sm:p-6">
            <p className="text-sm text-muted">Операционный ноль</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-amber tabular-nums">{inv.zeroMonth ? `мес ${inv.zeroMonth}` : 'не в горизонте'}</p>
            <p className="mt-1 text-sm text-muted">{inv.zeroMonth ? 'Валовая прибыль месяца покрывает OPEX' : `Заказов мало: оборотка заложена на все ${C.horizonMonths} мес`}</p>
          </div>
          <div className="glass p-5 sm:p-6">
            <p className="text-sm text-muted">Срок окупаемости</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-amber tabular-nums">{model.base.payback ? `${model.base.payback} мес` : 'нет'}</p>
            <p className="mt-1 text-sm text-muted">{model.base.payback ? 'Накопленный поток возвращается к нулю' : `Не окупается за ${C.paybackSearchMonths} мес при этих параметрах`}</p>
          </div>
        </div>

        {/* Кривая */}
        <Card className="lg:col-span-7" title={`Кэш-кривая на ${C.horizonMonths} месяцев`}>
          <CashChart base={model.base} pessimistic={model.pessimistic} optimistic={model.optimistic} firstOrderMonth={firstOrder} />
        </Card>

        {/* Три сценария */}
        <ScenarioCard r={model.pessimistic} base={false} horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />
        <ScenarioCard r={model.base} base horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />
        <ScenarioCard r={model.optimistic} base={false} horizon={C.horizonMonths} paybackSearch={C.paybackSearchMonths} />

        {/* CAPEX */}
        <Card className="lg:col-span-6 p-0! sm:p-0!">
          <h3 className="px-5 sm:px-6 pt-5 text-xl font-semibold tracking-tight">CAPEX по статьям</h3>
          <div className="overflow-x-auto mt-3">
            <table className="tbl">
              <tbody>
                <Row label="Оборудование" note={`сценарий ${params.scenario}, все фазы, включенные строки`} value={usdRange(capex.equipment.min, capex.equipment.max)} />
                <Row label="Доставка и таможня" note={`${C.shippingPctMin}–${C.shippingPctMax}%`} value={usdRange(capex.shipping.min, capex.shipping.max)} />
                <Row label="Подготовка помещения" value={usdRange(capex.fitOut.min, capex.fitOut.max)} />
                <Row label="Депозит по аренде" note={`${C.depositMonths} мес × ${params.areaM2} м² × $${num(params.rentPerM2, 2)}`} value={usd(capex.deposit.mid)} />
                <Row label="Регистрация, ПО, юристы" value={usdRange(capex.registration.min, capex.registration.max)} />
                {params.scenario === 'B' && (
                  <>
                    <Row label={`Из них расширение +${C.phaseOffsetM6} мес`} note="оборудование с доставкой" value={usdRange(capex.byPhase.m6.min, capex.byPhase.m6.max)} />
                    <Row label={`Из них расширение +${C.phaseOffsetM12} мес`} note="можно вынести во второй транш" value={usdRange(capex.byPhase.m12.min, capex.byPhase.m12.max)} />
                  </>
                )}
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

        {/* OPEX */}
        <Card className="lg:col-span-6 p-0! sm:p-0!">
          <h3 className="px-5 sm:px-6 pt-5 text-xl font-semibold tracking-tight">OPEX в месяц, стартовый штат</h3>
          <div className="overflow-x-auto mt-3">
            <table className="tbl">
              <tbody>
                <Row label="ФОТ gross" note={`${opex.headcount} человек`} value={usd(opex.payrollGross)} />
                <Row label={`Налоги и взносы +${C.payrollTaxPct}%`} value={usd(opex.payrollTaxes)} />
                <Row label="Аренда" note={`${params.areaM2} м² × $${num(params.rentPerM2, 2)}`} value={usd(opex.rent)} />
                <Row label="Электричество" value={usd(opex.electricity)} />
                <Row label="Прочее" note="связь, расходники, бухгалтерия, транспорт" value={usd(opex.other)} />
              </tbody>
              <tfoot>
                <Row label="OPEX в месяц" value={usd(opex.total)} strong />
                {params.scenario === 'B' && <Row label="OPEX при полном штате B" note={`${model.opexFull.headcount} человек`} value={usd(model.opexFull.total)} />}
                <Row label="В драмах" note={`курс ${params.amdRate}`} value={amd(opex.total * params.amdRate)} />
              </tfoot>
            </table>
          </div>
        </Card>

        {/* Константы */}
        <Card className="lg:col-span-12">
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
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
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

        <Card className="lg:col-span-12" title="Как считает модель">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm text-muted">
            <li>Цены оборудования и подготовки — диапазоны, в кривой берется середина</li>
            <li>Стартовый CAPEX распределен по месяцам подготовки, депозит — в первый месяц</li>
            <li>В подготовительные месяцы ФОТ учтен на {C.prepPayrollSharePct}%: команда нанимается постепенно</li>
            <li>
              Якорный клиент дает заказы с первого месяца работы, внешние — с {C.externalStartMonthOfOps}-го и растут до полной скорости за {C.externalRampMonths} мес
            </li>
            <li>Выручка признается в месяц заказа, валовая прибыль = выручка × маржа</li>
            <li>Оборотка = материалы на первые заказы + OPEX за месяцы до операционного нуля</li>
            <li>
              В сценарии B оборудование и штат фаз +6 и +12 включаются через {C.phaseOffsetM6} и {C.phaseOffsetM12} месяцев после первого заказа
            </li>
            <li>Окупаемость — месяц, когда накопленный денежный поток возвращается к нулю</li>
            <li>Выключенные строки станков и штата в расчет не входят</li>
          </ul>
        </Card>
      </Bento>
    </Section>
  )
}
