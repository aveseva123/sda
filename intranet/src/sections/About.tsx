import { Section } from '../components/Section'
import { Bento, Card } from '../components/Card'
import { founder } from '../data/founder'

export function About() {
  return (
    <Section id="about" index={2} title="Кто я" lead={founder.intro}>
      <Bento>
        {founder.tiles.map((t, i) => (
          <Card key={t.title} className={i < 2 ? 'lg:col-span-6' : 'lg:col-span-6'} title={t.title} big>
            <p className="text-muted text-pretty">{t.text}</p>
          </Card>
        ))}

        <Card className="lg:col-span-7" title="Клиенты">
          <ul className="divide-y divide-white/10">
            {founder.clients.map((c) => (
              <li key={c.name} className="py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-lg font-semibold">{c.name}</span>
                <span className="text-muted">{c.text}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-5" title="Материалы">
          <ul className="flex flex-wrap gap-2">
            {founder.materials.map((m) => (
              <li key={m} className="rounded-full border border-white/15 px-3 py-1 text-sm">
                {m}
              </li>
            ))}
          </ul>
        </Card>

        {founder.extras.map((e) => (
          <Card key={e.title} className="lg:col-span-3" title={e.title}>
            <p className="text-sm text-muted text-pretty">{e.text}</p>
          </Card>
        ))}
      </Bento>
    </Section>
  )
}
