import { Section } from '../components/Section'
import { Bento, Card, List, Tag } from '../components/Card'
import { investorControl, investorNote, investorOptions } from '../data/investor'
import type { ModelResult } from '../model/finance'
import { usd, usdShort } from '../lib/format'

export function Investor({ model }: { model: ModelResult }) {
  const p = model.params
  const C = model.constants
  const groupSpend = p.anchorPerYear * p.avgBudget
  const groupSaving = groupSpend * (C.groupDiscountPct / 100)
  const numbers: [string, string, string][] = [
    ['Бюджет группы на мебель в год', usd(groupSpend), `${p.anchorPerYear} объектов × ${usdShort(p.avgBudget)}`],
    ['Экономия при приоритетной цене', usd(groupSaving), `скидка ${C.groupDiscountPct}% от рынка, пример`],
    ['Накопленный поток цеха к 36 мес', usdShort(model.base.cumulative36), 'выручка минус расходы и CAPEX нарастающим итогом, базовый сценарий'],
    ['Накопленный поток цеха к 60 мес', usdShort(model.base.cumulative60), `оптимистичный: ${usdShort(model.optimistic.cumulative60)}`],
  ]
  return (
    <Section id="investor" index={10} title="Условия для инвестора" lead={investorNote}>
      <Bento>
        {investorOptions.map((o, i) => (
          <Card key={o.title} className="lg:col-span-4" as="article">
            <p className="text-sm text-muted tabular-nums">Вариант {['а', 'б', 'в'][i]}</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{o.title}</h3>
            <p className="mt-3 text-sm text-muted text-pretty">{o.example}</p>
            <p className="mt-2">
              <Tag>пример, обсуждается</Tag>
            </p>

            <h4 className="mt-5 text-sm font-semibold text-muted">Что получает инвестор</h4>
            <List items={o.investorGets} className="text-sm" />

            <h4 className="mt-4 text-sm font-semibold text-muted">Что получаю я</h4>
            <List items={o.iGet} className="text-sm" />

            <h4 className="mt-4 text-sm font-semibold text-muted">Риски сторон</h4>
            <List items={o.risks} className="text-sm" />
          </Card>
        ))}

        <Card className="lg:col-span-6" title="Что это дает группе в цифрах">
          <dl className="divide-y divide-white/10 text-sm">
            {numbers.map(([k, v, note]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt>
                  {k}
                  <span className="block text-xs text-muted">{note}</span>
                </dt>
                <dd className="font-semibold text-amber tabular-nums text-right whitespace-nowrap">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Считается из параметров финмодели. Доля инвестора в потоке зависит от выбранного варианта</p>
        </Card>

        <Card className="lg:col-span-6" title="Как инвестор контролирует">
          <ul className="divide-y divide-white/10">
            {investorControl.map((c) => (
              <li key={c.title} className="py-2.5">
                <span className="font-semibold">{c.title}</span>
                <span className="block text-sm text-muted text-pretty">{c.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Bento>
    </Section>
  )
}
