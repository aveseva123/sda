import { Section } from '../components/Section'
import { Bento, Card, Tag } from '../components/Card'
import { product } from '../data/product'

export function Product() {
  return (
    <Section id="product" index={4} title="Продукт" lead="Корпусная мебель для зала и бара полного цикла: проект, производство, покраска, монтаж">
      <h3 className="mb-3 text-xl font-semibold tracking-tight">На старте</h3>
      <Bento>
        {product.start.map((p, i) => (
          <Card key={p.title} className={i === 0 ? 'lg:col-span-6' : i === 1 ? 'lg:col-span-6' : 'lg:col-span-3'} title={p.title} big={i < 2}>
            <p className="text-sm sm:text-base text-muted text-pretty">{p.text}</p>
          </Card>
        ))}
      </Bento>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">Добавляем позже</h3>
      <Bento>
        {product.later.map((p) => (
          <Card key={p.title} className="lg:col-span-6" title={p.title}>
            <p className="text-sm sm:text-base text-muted text-pretty">{p.text}</p>
          </Card>
        ))}
      </Bento>
      <p className="mt-3 text-sm text-muted">{product.subcontract}</p>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">
        Ценовые диапазоны на объект <Tag>ориентир</Tag>
      </h3>
      <Bento>
        {product.prices.map((p) => (
          <Card key={p.format} className="lg:col-span-4">
            <p className="text-sm text-muted">{p.format}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-amber tabular-nums">{p.range}</p>
            <p className="mt-2 text-sm text-muted text-pretty">{p.note}</p>
          </Card>
        ))}
      </Bento>
      <p className="mt-3 text-sm text-muted">{product.priceNote}</p>
    </Section>
  )
}
