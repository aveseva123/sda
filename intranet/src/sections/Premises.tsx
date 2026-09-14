import { useState, type FormEvent } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, ScrollHint } from '../components/Card'
import { premises } from '../data/premises'

type Candidate = (typeof premises.candidates)[number]

const empty: Candidate = { address: '', area: '', price: '', height: '', power: '', access: '', status: 'Смотрим', comment: '' }

const columns: { key: keyof Candidate; title: string; placeholder: string; width?: string }[] = [
  { key: 'address', title: 'Адрес', placeholder: 'Район, улица', width: 'min-w-44' },
  { key: 'area', title: 'Площадь, м²', placeholder: '400' },
  { key: 'price', title: '$/м²', placeholder: '5' },
  { key: 'height', title: 'Высота, м', placeholder: '4,5' },
  { key: 'power', title: 'Электрика', placeholder: '100 кВт' },
  { key: 'access', title: 'Въезд', placeholder: 'Фура, рампа' },
  { key: 'status', title: 'Статус', placeholder: '' },
  { key: 'comment', title: 'Комментарий', placeholder: 'Что важно', width: 'min-w-44' },
]

export function Premises() {
  // Состояние только в памяти: перезагрузка страницы сбрасывает добавленные строки
  const [rows, setRows] = useState<Candidate[]>(premises.candidates)
  const [draft, setDraft] = useState<Candidate>(empty)

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.address.trim()) return
    setRows((r) => [...r, draft])
    setDraft(empty)
  }
  const remove = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  return (
    <Section id="premises" index={5} title="Помещение" lead="Требования к площадке, районы поиска, кандидаты и план на 4 недели">
      <Bento>
        {premises.requirements.map((r, i) => (
          <Card key={r.title} className={i < 2 ? 'lg:col-span-6' : 'lg:col-span-3'} title={r.title} big={i < 2}>
            <p className="text-sm sm:text-base text-muted text-pretty">{r.text}</p>
          </Card>
        ))}

        <Card className="lg:col-span-7" title="Районы поиска">
          <ul className="flex flex-wrap gap-2">
            {premises.districts.map((d) => (
              <li key={d} className="rounded-full border border-white/15 px-3 py-1 text-sm">
                {d}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-5" title="Аренда и подготовка">
          <p className="text-2xl font-semibold tracking-tight text-amber">{premises.rent.perM2}</p>
          <p className="mt-1 text-muted">{premises.rent.deposit}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-amber">{premises.rent.fitOut}</p>
          <p className="mt-1 text-sm text-muted text-pretty">{premises.rent.fitOutNote}</p>
        </Card>
      </Bento>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">Кандидаты</h3>
      <Card className="p-0! sm:p-0!">
        <ScrollHint />
        <div className="overflow-x-auto relative">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.title}</th>
                ))}
                <th className="print-hide">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.address}-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.width ?? ''} ${c.key === 'comment' ? 'text-muted' : ''}`}>
                      {r[c.key] || <span className="text-muted">—</span>}
                    </td>
                  ))}
                  <td className="print-hide text-right">
                    <button type="button" onClick={() => remove(i)} className="text-xs text-muted hover:text-amber" aria-label={`Удалить ${r.address}`}>
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="text-muted">
                    Пока нет кандидатов
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="print-hide border-t border-white/10 p-4 sm:p-5">
          <p className="text-sm text-muted mb-3">Добавить строку. Данные живут только в памяти страницы</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {columns.map((c) =>
              c.key === 'status' ? (
                <select
                  key={c.key}
                  aria-label={c.title}
                  className="field"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                >
                  {premises.candidateStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  key={c.key}
                  aria-label={c.title}
                  className="field"
                  placeholder={c.title}
                  required={c.key === 'address'}
                  value={draft[c.key]}
                  onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })}
                />
              ),
            )}
          </div>
          <button type="submit" className="mt-3 rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-black hover:bg-amber-deep">
            Добавить кандидата
          </button>
        </form>
      </Card>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">План поиска</h3>
      <Bento>
        {premises.searchPlan.map((w) => (
          <Card key={w.week} className="lg:col-span-3" title={w.week}>
            <p className="text-sm sm:text-base text-muted text-pretty">{w.text}</p>
          </Card>
        ))}
      </Bento>
    </Section>
  )
}
