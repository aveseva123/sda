import { Section } from '../components/Section'
import { Bento, Card, List, Tag } from '../components/Card'
import { investorNote, investorOptions } from '../data/investor'

export function Investor() {
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
      </Bento>
    </Section>
  )
}
