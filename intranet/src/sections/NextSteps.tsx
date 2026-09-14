import { Section } from '../components/Section'
import { Bento, Card } from '../components/Card'
import { investorQuestions, myTasks } from '../data/nextSteps'

function Numbered({ items }: { items: string[] }) {
  return (
    <ol className="divide-y divide-white/10">
      {items.map((it, i) => (
        <li key={it} className="py-2.5 flex gap-3 text-sm sm:text-base">
          <span className="text-muted tabular-nums w-6 shrink-0">{i + 1}</span>
          <span className="text-pretty">{it}</span>
        </li>
      ))}
    </ol>
  )
}

export function NextSteps() {
  return (
    <Section id="next" index={13} title="До второй встречи" lead="Что сделать мне и что спросить у инвестора">
      <Bento>
        <Card className="lg:col-span-6" title="Сделать мне" big>
          <Numbered items={myTasks} />
        </Card>
        <Card className="lg:col-span-6" title="Спросить у инвестора" big>
          <Numbered items={investorQuestions} />
        </Card>
      </Bento>
    </Section>
  )
}
