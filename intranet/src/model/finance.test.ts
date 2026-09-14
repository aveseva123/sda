import { describe, expect, it } from 'vitest'
import {
  breakEvenObjects,
  computeCapex,
  computeCashCurve,
  computeInvestment,
  computeModel,
  computeOpex,
  housingEffect,
  equipmentCapex,
  objectsInOpsMonth,
  operatingZeroMonth,
  paybackMonth,
  payrollOf,
  range,
} from './finance'
import { equipment } from '../data/equipment'
import { team } from '../data/team'
import { financeConstants as C, financeDefaults } from '../data/finance'
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
  comment: '',
  ...over,
})

const person = (over: Partial<TeamRow>): TeamRow => ({
  id: 'x',
  role: 'x',
  qty: 1,
  salary: 1000,
  when: '',
  where: '',
  ...over,
})

describe('оборудование', () => {
  it('итог считает количество и доставку 15–20%', () => {
    const c = equipmentCapex([row({ qty: 2, priceMin: 100, priceMax: 200 })])
    expect(c.equipment).toEqual(range(200, 400))
    expect(c.shipping.min).toBeCloseTo(30)
    expect(c.shipping.max).toBeCloseTo(80)
    expect(c.total.min).toBeCloseTo(230)
    expect(c.total.max).toBeCloseTo(480)
  })

  it('стартовые данные без металл-поста: $68–110k', () => {
    const c = equipmentCapex(equipment)
    expect(c.equipment.min).toBe(68000)
    expect(c.equipment.max).toBe(110000)
    expect(equipment.some((r) => /металл|лазер|листогиб|сварк/i.test(r.name))).toBe(false)
  })

  it('доставка берется из констант', () => {
    const c = equipmentCapex([row({ priceMin: 1000, priceMax: 1000 })], { ...C, shippingPctMin: 10, shippingPctMax: 10 })
    expect(c.shipping).toEqual(range(100, 100))
  })
})

describe('ФОТ', () => {
  it('налоги +25% сверх gross', () => {
    const p = payrollOf([person({ qty: 2, salary: 1000 })])
    expect(p).toEqual({ headcount: 2, gross: 2000, taxes: 500, total: 2500 })
  })

  it('стартовый штат из ТЗ: 9 человек, $7 300 gross, без сварщика', () => {
    const p = payrollOf(team)
    expect(p.headcount).toBe(9)
    expect(p.gross).toBe(7300)
    expect(p.total).toBe(9125)
    expect(team.some((r) => /сварщик/i.test(r.role))).toBe(false)
  })
})

describe('общежитие и питание', () => {
  const H = { ...C, housingPerPerson: 150, mealsPerPerson: 120, housedSharePct: 50, housedSalaryDiscountPct: 15 }
  const rows = [person({ qty: 10, salary: 1000 })]

  it('по умолчанию выключено и ничего не меняет', () => {
    const e = housingEffect(rows)
    expect(e).toEqual({ headcount: 10, housed: 0, cost: 0, payrollSaving: 0, net: 0 })
    expect(payrollOf(rows).gross).toBe(10000)
  })

  it('снижает gross на долю × скидку и добавляет расход на проживание и питание', () => {
    const p = payrollOf(rows, H)
    expect(p.gross).toBeCloseTo(10000 * (1 - 0.5 * 0.15))
    const e = housingEffect(rows, H)
    expect(e.housed).toBe(5)
    expect(e.cost).toBeCloseTo(5 * 270)
    expect(e.payrollSaving).toBeCloseTo(10000 * 0.075 * 1.25)
    expect(e.net).toBeCloseTo(e.payrollSaving - e.cost)
  })

  it('OPEX содержит строку общежития и учитывает ее в итоге', () => {
    const params = { ...financeDefaults, areaM2: 400, rentPerM2: 5 }
    const o = computeOpex(params, rows, H)
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

  it('CAPEX распределяется по подготовительным месяцам, потом ноль', () => {
    const p = { ...financeDefaults, monthsToFirstOrder: 3 }
    const curve = computeCashCurve(p, equipment, team)
    const capex = computeCapex(p, equipment)
    const spent = curve.slice(0, 3).reduce((s, x) => s + x.capex, 0)
    expect(spent).toBeCloseTo(capex.total.mid)
    expect(curve.slice(3).every((x) => x.capex === 0)).toBe(true)
  })

  it('в подготовительный период ФОТ учитывается частично', () => {
    const p = { ...financeDefaults, monthsToFirstOrder: 2 }
    const curve = computeCashCurve(p, equipment, team)
    expect(curve[0].opex).toBeLessThan(curve[2].opex)
    expect(curve[2].opex).toBeCloseTo(curve[10].opex)
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

  it('сценарии загрузки берутся из констант', () => {
    const m = computeModel(financeDefaults, equipment, team, { ...C, pessimisticLoadPct: 50, optimisticLoadPct: 200 })
    expect(m.pessimistic.load).toBe(0.5)
    expect(m.optimistic.load).toBe(2)
    expect(m.pessimistic.label).toBe('−50% загрузки')
    expect(m.optimistic.label).toBe('+100% загрузки')
  })
})

describe('показатели для инвестора', () => {
  const p = { ...financeDefaults, anchorPerYear: 8, externalPerYear: 12 }

  it('накопленный поток к 36 и 60 месяцам растет при большем потоке', async () => {
    const { computeModel: cm } = await import('./finance')
    const m = cm(p, equipment, team)
    expect(m.base.cumulative60).toBeGreaterThan(m.base.cumulative36)
    expect(m.optimistic.cumulative60).toBeGreaterThan(m.base.cumulative60)
  })

  it('нужный поток для окупаемости: с ним окупаемость укладывается в срок, без него нет', async () => {
    const { flowForPayback, paybackMonth: pb } = await import('./finance')
    const flow = flowForPayback(financeDefaults, equipment, team, 36)
    expect(flow).not.toBeNull()
    const k = flow! / (financeDefaults.anchorPerYear + financeDefaults.externalPerYear)
    const scaled = { ...financeDefaults, anchorPerYear: financeDefaults.anchorPerYear * k, externalPerYear: financeDefaults.externalPerYear * k }
    expect(pb(scaled, equipment, team)!).toBeLessThanOrEqual(36)
    expect(pb(financeDefaults, equipment, team)).toBeNull()
    expect(flowForPayback({ ...financeDefaults, anchorPerYear: 0, externalPerYear: 0 }, equipment, team, 36)).toBeNull()
  })

  it('транши: сумма равна нужной инвестиции и покрывает минимум кассы', async () => {
    const { tranches, computeInvestment: ci, computeCashCurve: cc } = await import('./finance')
    for (const pp of [p, financeDefaults]) {
      const inv = ci(pp, equipment, team)
      const curve = cc(pp, equipment, team)
      const t = tranches(pp, inv, curve)
      expect(t).toHaveLength(3)
      expect(t[0].amount + t[1].amount + t[2].amount).toBeCloseTo(inv.total.mid, 0)
      const minCum = Math.min(0, ...curve.map((x) => x.cumulative))
      expect(t[0].amount + t[1].amount).toBeGreaterThanOrEqual(-minCum - 1)
      expect(t[2].amount).toBeCloseTo(inv.reserve.mid)
    }
  })

  it('чувствительность: рост бюджета снижает точку безубыточности, рост зарплат повышает', async () => {
    const { sensitivity, computeModel: cm } = await import('./finance')
    const base = cm(p, equipment, team)
    const rows = sensitivity(p, equipment, team)
    expect(rows).toHaveLength(10)
    const budgetUp = rows.find((r) => r.title === 'Бюджет объекта' && r.change === '+10%')!
    const salaryUp = rows.find((r) => r.title === 'Зарплаты' && r.change === '+10%')!
    expect(budgetUp.breakEven).toBeLessThan(base.breakEven)
    expect(salaryUp.breakEven).toBeGreaterThan(base.breakEven)
    const flowUp = rows.find((r) => r.title === 'Поток заказов' && r.change === '+10%')!
    const flowDown = rows.find((r) => r.title === 'Поток заказов' && r.change === '−10%')!
    expect(flowUp.cumulative36).toBeGreaterThan(flowDown.cumulative36)
  })

  it('загрузка мощности', async () => {
    const { capacityUtilization } = await import('./finance')
    expect(capacityUtilization(1.5, { ...C, capacityObjectsPerMonth: 3 })).toBeCloseTo(0.5)
  })
})
