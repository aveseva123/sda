import { useState, type FormEvent } from 'react'
import { Section } from '../components/Section'
import { Bento, Card, List, ScrollHint, Tag } from '../components/Card'
import { GhostButton, NumInput, PrimaryButton, SelectInput, TextInput, Toggle } from '../components/Inputs'
import type { Condition, Source } from '../data/equipment'
import { logistics, logisticsNote } from '../data/logistics'
import { equipmentCapex } from '../model/finance'
import { CONDITIONS, SOURCES, type CustomEquipment } from '../model/config'
import type { ConfigApi } from '../hooks/useConfig'
import { usd, usdRange } from '../lib/format'

const sourceOptions = SOURCES.map((s) => ({ id: s, title: s }))
const conditionOptions = CONDITIONS.map((s) => ({ id: s, title: s }))

const emptyDraft = (): CustomEquipment => ({
  name: '',
  enabled: true,
  qty: 1,
  priceMin: 0,
  priceMax: 0,
  source: 'Россия дилер',
  condition: 'новый',
})

export function Equipment({ config }: { config: ConfigApi }) {
  const { equipmentRows: rows, constants, updateEquipment, addEquipment, removeEquipment, resetEquipment, equipmentEdited } = config
  const [draft, setDraft] = useState<CustomEquipment>(emptyDraft)

  const active = rows.filter((r) => r.enabled)
  const capex = equipmentCapex(active, constants)

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    addEquipment({ ...draft, name: draft.name.trim(), priceMax: Math.max(draft.priceMin, draft.priceMax) })
    setDraft(emptyDraft())
  }

  return (
    <Section id="equipment" index={6} title="Оборудование" lead="Стартовый набор для корпусной мебели полного цикла. Цены за единицу без доставки. Металл не делаем: каркасы и нержавейка — субподряд">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <p className="text-sm text-muted">
          В итог входят включенные строки: {active.length} из {rows.length}. Строки можно выключать, править и добавлять прямо здесь
          {equipmentEdited && (
            <>
              {' '}
              <Tag>список изменен</Tag>
            </>
          )}
        </p>
        {equipmentEdited && (
          <span className="print-hide">
            <GhostButton onClick={resetEquipment}>Вернуть исходный список</GhostButton>
          </span>
        )}
      </div>

      <Card className="p-0! sm:p-0!">
        <ScrollHint />
        <div className="overflow-x-auto">
          <table className="tbl min-w-[1000px]">
            <thead>
              <tr>
                <th className="sticky-col">Станок</th>
                <th className="num">Кол-во</th>
                <th className="num">Цена от</th>
                <th className="num">Цена до</th>
                <th>Откуда</th>
                <th>Состояние</th>
                <th>Комментарий</th>
                <th className="print-hide">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.enabled ? '' : 'row-off'}>
                  <td className="sticky-col min-w-64 max-w-72">
                    <div className="flex items-start gap-2.5">
                      <span className="pt-0.5">
                        <Toggle checked={r.enabled} onChange={(v) => updateEquipment(r.id, { enabled: v })} label={`${r.name}: учитывать`} />
                      </span>
                      <span>
                        <span className="row-name font-semibold">{r.name}</span>
                        {r.changed && !r.custom && <span className="changed-mark text-xs ml-1.5">изменено</span>}
                        {r.custom && <span className="changed-mark text-xs ml-1.5">добавлено</span>}
                        {!r.enabled && <span className="block text-xs text-muted">Не входит в расчет</span>}
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    <NumInput value={r.qty} min={0} max={99} step={1} label={`${r.name}: количество`} onChange={(v) => updateEquipment(r.id, { qty: v })} className="w-16" />
                  </td>
                  <td className="num">
                    <NumInput value={r.priceMin} step={500} label={`${r.name}: цена от`} onChange={(v) => updateEquipment(r.id, { priceMin: v, priceMax: Math.max(v, r.priceMax) })} className="w-28" />
                  </td>
                  <td className="num">
                    <NumInput value={r.priceMax} min={r.priceMin} step={500} label={`${r.name}: цена до`} onChange={(v) => updateEquipment(r.id, { priceMax: v })} className="w-28" />
                  </td>
                  <td className="whitespace-nowrap">
                    {r.custom ? (
                      <SelectInput value={r.source} options={sourceOptions} label={`${r.name}: откуда`} onChange={(v: Source) => updateEquipment(r.id, { source: v })} />
                    ) : (
                      r.source
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.custom ? (
                      <SelectInput value={r.condition} options={conditionOptions} label={`${r.name}: состояние`} onChange={(v: Condition) => updateEquipment(r.id, { condition: v })} />
                    ) : (
                      r.condition
                    )}
                  </td>
                  <td className="text-muted min-w-56 text-pretty">{r.comment}</td>
                  <td className="print-hide text-right">
                    {r.custom && (
                      <button type="button" onClick={() => removeEquipment(r.id)} className="text-xs text-muted hover:text-amber" aria-label={`Удалить ${r.name}`}>
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Итого оборудование</td>
                <td className="num">{active.reduce((s, r) => s + r.qty, 0)}</td>
                <td className="num" colSpan={2}>
                  {usdRange(capex.equipment.min, capex.equipment.max)}
                </td>
                <td colSpan={4} className="text-muted font-normal">
                  Сумма по включенным строкам с учетом количества
                </td>
              </tr>
              <tr>
                <td className="sticky-col">
                  Доставка и таможня, {constants.shippingPctMin}–{constants.shippingPctMax}%
                </td>
                <td />
                <td className="num" colSpan={2}>
                  {usdRange(capex.shipping.min, capex.shipping.max)}
                </td>
                <td colSpan={4} className="text-muted font-normal">
                  Из России без пошлин, из Китая пошлина и НДС. Проценты — в константах финмодели
                </td>
              </tr>
              <tr>
                <td className="sticky-col text-amber">CAPEX по оборудованию</td>
                <td />
                <td className="num text-amber" colSpan={2}>
                  {usdRange(capex.total.min, capex.total.max)}
                </td>
                <td colSpan={4} className="text-muted font-normal">
                  В модели берется середина: {usd(capex.total.mid)}. Помещение, депозит и регистрация — в финмодели
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <form onSubmit={add} className="print-hide border-t border-white/10 p-4 sm:p-5">
          <p className="text-sm text-muted mb-3">Добавить станок. Строка попадет в адрес страницы вместе с остальными правками</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} label="Станок" required className="col-span-2 lg:col-span-3" />
            <NumInput value={draft.qty} min={1} max={99} label="Количество" onChange={(v) => setDraft({ ...draft, qty: v })} className="w-full" />
            <NumInput value={draft.priceMin} step={500} label="Цена от" onChange={(v) => setDraft({ ...draft, priceMin: v })} className="w-full" />
            <NumInput value={draft.priceMax} step={500} label="Цена до" onChange={(v) => setDraft({ ...draft, priceMax: v })} className="w-full" />
            <SelectInput value={draft.source} options={sourceOptions} label="Откуда" onChange={(v: Source) => setDraft({ ...draft, source: v })} className="w-full" />
            <SelectInput value={draft.condition} options={conditionOptions} label="Состояние" onChange={(v: Condition) => setDraft({ ...draft, condition: v })} className="w-full" />
          </div>
          <div className="mt-3">
            <PrimaryButton type="submit">Добавить станок</PrimaryButton>
          </div>
        </form>
      </Card>

      <h3 className="mt-10 mb-3 text-xl font-semibold tracking-tight">Логистика</h3>
      <Bento>
        {logistics.map((l) => (
          <Card key={l.title} className="lg:col-span-4" title={l.title}>
            <List items={l.points} className="text-sm" />
          </Card>
        ))}
      </Bento>
      <p className="mt-3 text-sm text-muted">{logisticsNote}</p>
    </Section>
  )
}
