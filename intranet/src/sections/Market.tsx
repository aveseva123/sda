import { Section } from '../components/Section'
import { Bento, Card, List, Tag } from '../components/Card'
import { market } from '../data/market'

export function Market() {
  return (
    <Section id="market" index={3} title="Рынок и ниша" lead={market.lead}>
      <Bento>
        {market.players.map((p) => (
          <Card key={p.title} className="lg:col-span-4" title={p.title}>
            <List items={p.items} />
          </Card>
        ))}

        <Card className="lg:col-span-7" title={market.niche.text} big>
          <p className="text-sm text-muted mb-3">{market.niche.title}</p>
          <List items={market.niche.points} />
        </Card>

        <Card className="lg:col-span-5 border-amber/40!" title="Данные к уточнению на встрече">
          <p className="mb-3">
            <Tag>Цифр по Еревану пока нет, не выдумываем</Tag>
          </p>
          <ol className="list-decimal pl-5 space-y-1.5 text-sm sm:text-base marker:text-muted">
            {market.toClarify.map((q) => (
              <li key={q} className="text-pretty">
                {q}
              </li>
            ))}
          </ol>
        </Card>
      </Bento>
    </Section>
  )
}
