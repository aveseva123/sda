import { Section } from '../components/Section'
import { Bento, Card } from '../components/Card'
import { practices, processChain } from '../data/operations'

export function Operations() {
  return (
    <Section id="operations" index={8} title="Операционная модель" lead="Один поток от заявки до монтажа, каждая станция — со своей очередью и контролем">
      <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3" aria-label="Цепочка процесса">
        {processChain.map((step, i) => (
          <li key={step} className="glass-soft p-3 sm:p-4 min-w-0">
            <span className="block text-xs text-muted tabular-nums">{String(i + 1).padStart(2, '0')}</span>
            <span className="block mt-1 text-sm sm:text-base font-semibold leading-snug text-balance">{step}</span>
          </li>
        ))}
      </ol>

      <Bento className="mt-6">
        {practices.map((p, i) => (
          <Card key={p.title} className={i === 0 || i === 4 ? 'lg:col-span-6' : 'lg:col-span-3'} title={p.title} big={i === 0 || i === 4}>
            <p className="text-sm sm:text-base text-muted text-pretty">{p.text}</p>
          </Card>
        ))}
      </Bento>
    </Section>
  )
}
