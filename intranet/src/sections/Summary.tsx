import { Section } from '../components/Section'
import { Bento, Card } from '../components/Card'
import { Stat } from '../components/Stat'
import { dealFormats, summary } from '../data/summary'
import type { ModelResult } from '../model/finance'
import { amd, num, usdRangeShort, usdShort } from '../lib/format'

export function Summary({ model }: { model: ModelResult }) {
  const inv = model.base.investment.total
  const payback = model.base.payback
  const bePerYear = model.breakEven * 12
  return (
    <Section id="summary" index={1} title={summary.title} lead={summary.lead}>
      <Bento>
        <Card className="lg:col-span-4" title="Что">
          <p className="text-muted text-pretty">{summary.what}</p>
        </Card>
        <Card className="lg:col-span-4" title="Для кого">
          <p className="text-muted text-pretty">{summary.forWhom}</p>
        </Card>
        <Card className="lg:col-span-4" title="Зачем инвестору">
          <p className="text-muted text-pretty">{summary.whyInvestor}</p>
        </Card>

        <Stat
          className="lg:col-span-4"
          label="Нужная инвестиция"
          value={usdRangeShort(inv.min, inv.max)}
          note={`≈ ${amd(inv.mid * model.params.amdRate)} по курсу ${model.params.amdRate}`}
        />
        <Stat
          className="lg:col-span-4"
          label="Расходы в месяц"
          value={usdShort(model.opex.total)}
          note={`ФОТ с налогами ${usdShort(model.opex.payroll)}, аренда ${usdShort(model.opex.rent)}`}
        />
        <Stat
          className="lg:col-span-4"
          label="Точка безубыточности"
          value={`${num(model.breakEven, 1)} объекта в месяц`}
          note={`≈ ${num(bePerYear, 0)} объектов в год при бюджете ${usdShort(model.params.avgBudget)} и марже ${model.params.marginPct}%`}
        />
        <Stat
          className="lg:col-span-4"
          label="Срок окупаемости"
          value={payback ? `${payback} мес` : `нет за ${model.constants.paybackSearchMonths} мес`}
          note={
            payback
              ? 'Вложенное возвращается полностью'
              : model.flowForPayback36
                ? `Для окупаемости за 36 мес нужно ≈ ${num(model.flowForPayback36, 0)} объектов в год при текущей марже`
                : 'При текущих марже и расходах не окупается'
          }
        />
        <Stat
          className="lg:col-span-4"
          label="Команда на старте"
          value={`${model.headcount} человек`}
          note={`Мощность ≈ ${num(model.constants.capacityObjectsPerMonth, 1)} объекта в месяц. Технолог, ОТК, продажи и закупки закрываю сам`}
        />
        <Stat className="lg:col-span-4" label="Площадь" value={`${model.params.areaM2} м²`} note="С ростом до 600–800 м²" />
      </Bento>

      <h3 className="mt-10 mb-4 text-xl sm:text-2xl font-semibold tracking-tight">Формат сделки</h3>
      <Bento>
        {dealFormats.map((d) => (
          <Card key={d.title} className="lg:col-span-4" title={d.title} big>
            <p className="text-muted text-pretty">{d.text}</p>
          </Card>
        ))}
      </Bento>
    </Section>
  )
}
