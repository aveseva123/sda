import { describe, expect, it } from 'vitest'
import {
  activePhases,
  breakEvenObjects,
  computeCapex,
  computeCashCurve,
  computeInvestment,
  computeModel,
  computeOpex,
  housingEffect,
  equipmentCapex,
  equipmentRows,
  objectsInOpsMonth,
  operatingZeroMonth,
  paybackMonth,
  payrollByPhase,
  payrollOf,
  payrollUpTo,
  range,
} from './finance'
import { equipment } from '../data/equipment'
import { team } from '../data/team'
import { financeConstants as C, financeConstants, financeDefaults } from '../data/finance'
import type { EquipmentRow } from '../data/equipment'
import type { TeamRow } from '../data/team'

const row = (over: Partial<EquipmentRow>): EquipmentRow => ({
  id: 'x',
  name: 'x',
  qty: 1,
  priceMin: 100,
  priceMax: 200,
  source: 'Китай',
  condition: 'новый',
  scenario: 'A',
  phase: 'start',
  comment: '',
  ...over,
})

const person = (over: Partial<TeamRow>): TeamRow => ({
  id: 'x',
  role: 'x',
  qty: 1,
  salary: 1000,
  phase: 'start',
  when: '',
  where: '',
  ...over,
})

describe('оборудование', () => {
  it('сценарий A берет только строки A, B — строки A и B', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', scenario: 'B', phase: 'm6' })]
    expect(equipmentRows(rows, 'A').map((r) => r.id)).toEqual(['a'])
    expect(equipmentRows(rows, 'B').map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('фильтр по фазе — накопительный', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', scenario: 'B', phase: 'm6' }), row({ id: 'c', scenario: 'B', phase: 'm12' })]
    expect(equipmentRows(rows, 'B', 'start').map((r) => r.id)).toEqual(['a'])
    expect(equipmentRows(rows, 'B', 'm6').map((r) => r.id)).toEqual(['a', 'b'])
    expect(equipmentRows(rows, 'B', 'm12').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('итог считает количество и доставку 15–20%', () => {
    const c = equipmentCapex([row({ qty: 2, priceMin: 100, priceMax: 200 })])
    expect(c.equipment).toEqual(range(200, 400))
    expect(c.shipping.min).toBeCloseTo(30)
    expect(c.shipping.max).toBeCloseTo(80)
    expect(c.total.min).toBeCloseTo(230)
    expect(c.total.max).toBeCloseTo(480)
  })

  it('стартовые данные сценария A совпадают с ТЗ: $74–120k', () => {
    const c = equipmentCapex(equipmentRows(equipment, 'A'))
    expect(c.equipment.min).toBe(74000)
    expect(c.equipment.max).toBe(120000)
  })
})

describe('ФОТ', () => {
  it('налоги +25% сверх gross', () => {
    const p = payrollOf([person({ qty: 2, salary: 1000 })])
    expect(p).toEqual({ headcount: 2, gross: 2000, taxes: 500, total: 2500 })
  })

  it('стартовый штат из ТЗ: 9 человек, $7 300 gross', () => {
    const p = payrollByPhase(team, 'start')
    expect(p.headcount).toBe(9)
    expect(p.gross).toBe(7300)
    expect(p.total).toBe(9125)
  })

  it('накопительно до +12 мес — 16 человек', () => {
    expect(payrollUpTo(team, 'm12').headcount).toBe(16)
  })
})

describe('общежитие и питание', () => {
  const C = { ...financeConstants, housingPerPerson: 150, mealsPerPerson: 120, housedSharePct: 50, housedSalaryDiscountPct: 15 }
  const rows = [person({ qty: 10, salary: 1000 })]

  it('по умолчанию выключено и ничего не меняет', () => {
    const e = housingEffect(rows)
    expect(e).toEqual({ headcount: 10, housed: 0, cost: 0, payrollSaving: 0, net: 0 })
    expect(payrollOf(rows).gross).toBe(10000)
  })

  it('снижает gross на долю × скидку и добавляет расход на проживание и питание', () => {
    const p = payrollOf(rows, C)
    expect(p.gross).toBeCloseTo(10000 * (1 - 0.5 * 0.15))
    const e = housingEffect(rows, C)
    expect(e.housed).toBe(5)
    expect(e.cost).toBeCloseTo(5 * 270)
    expect(e.payrollSaving).toBeCloseTo(10000 * 0.075 * 1.25)
    expect(e.net).toBeCloseTo(e.payrollSaving - e.cost)
  })

  it('OPEX содержит строку общежития и учитывает ее в итоге', () => {
    const params = { ...financeDefaults, areaM2: 400, rentPerM2: 5 }
    const o = computeOpex(params, rows, ['start'], C)
    expect(o.housing).toBeCloseTo(5 * 270)
    expect(o.total).toBeCloseTo(o.payroll + o.rent + o.electricity + o.other + o.housing)
  })
})

describe('CAPEX и OPEX', () => {
  it('CAPEX складывает оборудование, доставку, подготовку, депозит и регистрацию', () => {
    const p = { ...financeDefaults, areaM2: 400, rentPerM2: 5 }
    const c = computeCapex(p, [row({ priceMin: 10000, priceMax: 10000 })])
    expect(c.deposit.mid).toBe(4000)
    expect(c.total.min).toBeCloseTo(10000 + 1500 + C.fitOutMin + 4000 + C.registrationMin)
    expect(c.total.max).toBeCloseTo(10000 + 2000 + C.fitOutMax + 4000 + C.registrationMax)
  })

  it('OPEX = ФОТ с налогами + аренда + электричество + прочее', () => {
    const p = { ...financeDefaults, areaM2: 400, rentPerM2: 5 }
    const o = computeOpex(p, [person({ salary: 1000 })])
    expect(o.total).toBe(1250 + 2000 + C.electricityPerMonth + C.otherPerMonth)
  })

  it('точка безубыточности: OPEX / (бюджет × маржа)', () => {
    expect(breakEvenObjects(12250, 35000, 35)).toBeCloseTo(1)
    expect(breakEvenObjects(1000, 0, 35)).toBe(Infinity)
  })
})

describe('поток заказов', () => {
  const p = { ...financeDefaults, anchorPerYear: 12, externalPerYear: 12 }

  it('до первого заказа объектов нет', () => {
    expect(objectsInOpsMonth(p, 0)).toBe(0)
  })

  it('якорный клиент с первого месяца, внешние — с 3-го и линейно до полной скорости', () => {
    expect(objectsInOpsMonth(p, 1)).toBeCloseTo(1)
    expect(objectsInOpsMonth(p, 2)).toBeCloseTo(1)
    expect(objectsInOpsMonth(p, C.externalStartMonthOfOps)).toBeCloseTo(1 + 1 / C.externalRampMonths)
    expect(objectsInOpsMonth(p, C.externalStartMonthOfOps + C.externalRampMonths - 1)).toBeCloseTo(2)
    expect(objectsInOpsMonth(p, 30)).toBeCloseTo(2)
  })

  it('загрузка масштабирует поток', () => {
    expect(objectsInOpsMonth(p, 1, 0.7)).toBeCloseTo(0.7)
  })
})

describe('кэш-кривая', () => {
  it('длина равна горизонту, касса = старт + накопленный поток', () => {
    const curve = computeCashCurve(financeDefaults, equipment, team, 1, 100000)
    expect(curve).toHaveLength(C.horizonMonths)
    expect(curve[curve.length - 1].cash).toBeCloseTo(100000 + curve[curve.length - 1].cumulative)
  })

  it('стартовый CAPEX распределяется по подготовительным месяцам, потом ноль в сценарии A', () => {
    const p = { ...financeDefaults, scenario: 'A' as const, monthsToFirstOrder: 3 }
    const curve = computeCashCurve(p, equipment, team)
    const capex = computeCapex(p, equipment)
    const spent = curve.slice(0, 3).reduce((s, x) => s + x.capex, 0)
    expect(spent).toBeCloseTo(capex.total.mid)
    expect(curve.slice(3).every((x) => x.capex === 0)).toBe(true)
  })

  it('в сценарии B фазы включаются через 6 и 12 месяцев после первого заказа', () => {
    const p = { ...financeDefaults, scenario: 'B' as const, monthsToFirstOrder: 2 }
    expect(activePhases(p, 3)).toEqual(['start'])
    expect(activePhases(p, 8)).toEqual(['start'])
    expect(activePhases(p, 9)).toEqual(['start', 'm6'])
    expect(activePhases(p, 15)).toEqual(['start', 'm6', 'm12'])
    const curve = computeCashCurve(p, equipment, team)
    expect(curve[8].capex).toBeGreaterThan(0)
    expect(curve[14].capex).toBeGreaterThan(0)
    expect(curve[9].opex).toBeGreaterThan(curve[7].opex)
  })

  it('в подготовительный период ФОТ учитывается частично', () => {
    const p = { ...financeDefaults, monthsToFirstOrder: 2 }
    const curve = computeCashCurve(p, equipment, team)
    expect(curve[0].opex).toBeLessThan(curve[2].opex)
  })
})

describe('инвестиция и окупаемость', () => {
  it('при большом потоке заказов есть операционный ноль и окупаемость', () => {
    const p = { ...financeDefaults, anchorPerYear: 12, externalPerYear: 12 }
    const curve = computeCashCurve(p, equipment, team)
    expect(operatingZeroMonth(curve)).not.toBeNull()
    expect(paybackMonth(p, equipment, team)).not.toBeNull()
  })

  it('без заказов окупаемости нет, а оборотка = материалы + OPEX за весь горизонт', () => {
    const p = { ...financeDefaults, anchorPerYear: 0, externalPerYear: 0 }
    expect(paybackMonth(p, equipment, team)).toBeNull()
    const inv = computeInvestment(p, equipment, team)
    expect(inv.zeroMonth).toBeNull()
    expect(inv.monthsToZero).toBe(C.horizonMonths)
    const opexSum = computeCashCurve(p, equipment, team).reduce((s, x) => s + x.opex, 0)
    expect(inv.workingCapital.min).toBeCloseTo(C.materialsMin + opexSum)
  })

  it('резерв — процент от CAPEX + оборотки', () => {
    const p = { ...financeDefaults, reservePct: 10 }
    const inv = computeInvestment(p, equipment, team)
    expect(inv.reserve.mid).toBeCloseTo(inv.subtotal.mid * 0.1)
    expect(inv.total.mid).toBeCloseTo(inv.subtotal.mid * 1.1)
  })

  it('чем выше загрузка, тем меньше нужная инвестиция и раньше окупаемость', () => {
    const p = { ...financeDefaults, anchorPerYear: 8, externalPerYear: 8 }
    const m = computeModel(p, equipment, team)
    expect(m.optimistic.investment.total.mid).toBeLessThanOrEqual(m.base.investment.total.mid)
    expect(m.base.investment.total.mid).toBeLessThanOrEqual(m.pessimistic.investment.total.mid)
    expect(m.optimistic.cashAtEnd).toBeGreaterThan(m.base.cashAtEnd)
    expect(m.base.cashAtEnd).toBeGreaterThan(m.pessimistic.cashAtEnd)
    if (m.optimistic.payback && m.base.payback) expect(m.optimistic.payback).toBeLessThanOrEqual(m.base.payback)
  })

  it('минимальный остаток кассы в базовом сценарии не ниже резерва', () => {
    const m = computeModel(financeDefaults, equipment, team)
    expect(m.base.minCash.value).toBeGreaterThanOrEqual(m.base.investment.reserve.mid - 1)
  })
})
