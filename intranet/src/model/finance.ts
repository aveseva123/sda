// Финансовая модель. Только чистые функции: вход — параметры, данные и константы, выход — цифры.
// Все суммы в USD. Месяцы считаются с 1 (первый месяц подготовки).
// Константы передаются последним аргументом; по умолчанию берутся из data/finance.ts.

import type { EquipmentRow } from '../data/equipment'
import type { TeamRow } from '../data/team'
import { financeConstants, type Constants, type FinanceParams, type LoadScenarioId } from '../data/finance'

export type Range = { min: number; max: number; mid: number }

export const range = (min: number, max: number): Range => ({ min, max, mid: (min + max) / 2 })
export const addRanges = (...rs: Range[]): Range =>
  range(
    rs.reduce((s, r) => s + r.min, 0),
    rs.reduce((s, r) => s + r.max, 0),
  )
export const scaleRange = (r: Range, k: number): Range => range(r.min * k, r.max * k)
export const fixed = (n: number): Range => range(n, n)

/** Три сценария загрузки из констант */
export function loadScenarios(C: Constants): { id: LoadScenarioId; title: string; load: number; label: string }[] {
  const pct = (load: number) => `${load >= 1 ? '+' : '−'}${Math.round(Math.abs(load - 1) * 100)}% загрузки`
  const p = C.pessimisticLoadPct / 100
  const o = C.optimisticLoadPct / 100
  return [
    { id: 'pessimistic', title: 'Пессимистичный', load: p, label: pct(p) },
    { id: 'base', title: 'Базовый', load: 1, label: 'Как в параметрах' },
    { id: 'optimistic', title: 'Оптимистичный', load: o, label: pct(o) },
  ]
}

// ---------- Оборудование ----------

/** Сумма оборудования: количество × цена */
export function equipmentTotal(rows: EquipmentRow[]): Range {
  return range(
    rows.reduce((s, r) => s + r.qty * r.priceMin, 0),
    rows.reduce((s, r) => s + r.qty * r.priceMax, 0),
  )
}

/** Доставка и таможня: 15–20% от оборудования */
export function shippingFor(equipment: Range, C: Constants = financeConstants): Range {
  return range(equipment.min * (C.shippingPctMin / 100), equipment.max * (C.shippingPctMax / 100))
}

export type EquipmentCapex = { equipment: Range; shipping: Range; total: Range }

export function equipmentCapex(rows: EquipmentRow[], C: Constants = financeConstants): EquipmentCapex {
  const equipment = equipmentTotal(rows)
  const shipping = shippingFor(equipment, C)
  return { equipment, shipping, total: addRanges(equipment, shipping) }
}

// ---------- ФОТ ----------

export type Payroll = { headcount: number; gross: number; taxes: number; total: number }

/** Множитель к gross с учетом доли штата в общежитии и их сниженной зарплаты */
export const housedSalaryFactor = (C: Constants): number => 1 - (C.housedSharePct / 100) * (C.housedSalaryDiscountPct / 100)

/** Расходы на общежитие и питание в месяц для указанного числа сотрудников */
export const housingCost = (headcount: number, C: Constants): number => headcount * (C.housedSharePct / 100) * (C.housingPerPerson + C.mealsPerPerson)

/** ФОТ по строкам штата, с налогами. Зарплата уже с поправкой на общежитие, если она задана */
export function payrollOf(rows: TeamRow[], C: Constants = financeConstants): Payroll {
  const headcount = rows.reduce((s, r) => s + r.qty, 0)
  const gross = rows.reduce((s, r) => s + r.qty * r.salary, 0) * housedSalaryFactor(C)
  const taxes = gross * (C.payrollTaxPct / 100)
  return { headcount, gross, taxes, total: gross + taxes }
}

export type HousingEffect = { headcount: number; housed: number; cost: number; payrollSaving: number; net: number }

/** Эффект общежития для штата: расход, экономия ФОТ с налогами и чистый итог в месяц (плюс — экономия) */
export function housingEffect(rows: TeamRow[], C: Constants = financeConstants): HousingEffect {
  const headcount = rows.reduce((s, r) => s + r.qty, 0)
  const fullGross = rows.reduce((s, r) => s + r.qty * r.salary, 0)
  const payrollSaving = fullGross * (1 - housedSalaryFactor(C)) * (1 + C.payrollTaxPct / 100)
  const cost = housingCost(headcount, C)
  return { headcount, housed: headcount * (C.housedSharePct / 100), cost, payrollSaving, net: payrollSaving - cost }
}

// ---------- CAPEX ----------

export type Capex = {
  equipment: Range
  shipping: Range
  fitOut: Range
  deposit: Range
  registration: Range
  total: Range
}

export function computeCapex(params: FinanceParams, equipment: EquipmentRow[], C: Constants = financeConstants): Capex {
  const eq = equipmentCapex(equipment, C)
  const fitOut = range(C.fitOutMin, C.fitOutMax)
  const deposit = fixed(params.areaM2 * params.rentPerM2 * C.depositMonths)
  const registration = range(C.registrationMin, C.registrationMax)
  return {
    equipment: eq.equipment,
    shipping: eq.shipping,
    fitOut,
    deposit,
    registration,
    total: addRanges(eq.equipment, eq.shipping, fitOut, deposit, registration),
  }
}

// ---------- OPEX ----------

export type Opex = {
  headcount: number
  payrollGross: number
  payrollTaxes: number
  payroll: number
  rent: number
  electricity: number
  other: number
  housing: number // общежитие и питание
  total: number
}

/** OPEX в месяц при полном штате */
export function computeOpex(params: FinanceParams, team: TeamRow[], C: Constants = financeConstants): Opex {
  const p = payrollOf(team, C)
  const rent = params.areaM2 * params.rentPerM2
  const electricity = C.electricityPerMonth
  const other = C.otherPerMonth
  const housing = housingCost(p.headcount, C)
  return {
    headcount: p.headcount,
    payrollGross: p.gross,
    payrollTaxes: p.taxes,
    payroll: p.total,
    rent,
    electricity,
    other,
    housing,
    total: p.total + rent + electricity + other + housing,
  }
}

// ---------- Точка безубыточности ----------

/** Сколько объектов в месяц покрывают OPEX */
export function breakEvenObjects(opexPerMonth: number, avgBudget: number, marginPct: number): number {
  const profitPerObject = avgBudget * (marginPct / 100)
  return profitPerObject > 0 ? opexPerMonth / profitPerObject : Infinity
}

// ---------- Поток заказов ----------

/** Объектов в месяц в k-й месяц работы (k = 1 — месяц первого заказа) */
export function objectsInOpsMonth(params: FinanceParams, k: number, load = 1, C: Constants = financeConstants): number {
  if (k < 1) return 0
  const anchor = params.anchorPerYear / 12
  const rampProgress = Math.min(1, Math.max(0, (k - C.externalStartMonthOfOps + 1) / C.externalRampMonths))
  const external = (params.externalPerYear / 12) * rampProgress
  return load * (anchor + external)
}

// ---------- Кэш-кривая ----------

export type CurvePoint = {
  month: number // календарный месяц с 1
  opsMonth: number // месяц работы, 0 до первого заказа
  objects: number
  revenue: number
  grossProfit: number
  opex: number
  capex: number
  net: number
  cumulative: number // сумма net с начала
  cash: number // startCash + cumulative
}

/** OPEX конкретного месяца: в подготовительный период часть ФОТ и общежития, дальше полный */
export function opexInMonth(params: FinanceParams, team: TeamRow[], m: number, C: Constants = financeConstants): number {
  const first = params.monthsToFirstOrder + 1
  const rent = params.areaM2 * params.rentPerM2
  const fixedPart = rent + C.electricityPerMonth + C.otherPerMonth
  const p = payrollOf(team, C)
  const people = p.total + housingCost(p.headcount, C)
  return fixedPart + (m < first ? people * (C.prepPayrollSharePct / 100) : people)
}

/** CAPEX конкретного месяца: оборудование, подготовка и регистрация равномерно по подготовительным месяцам, депозит — в первый */
export function capexInMonth(params: FinanceParams, equipment: EquipmentRow[], m: number, C: Constants = financeConstants): number {
  const capex = computeCapex(params, equipment, C)
  const prep = Math.max(1, params.monthsToFirstOrder)
  let out = 0
  if (m <= prep) {
    out += (capex.equipment.mid + capex.shipping.mid + capex.fitOut.mid + capex.registration.mid) / prep
  }
  if (m === 1) out += capex.deposit.mid
  return out
}

export function computeCashCurve(
  params: FinanceParams,
  equipment: EquipmentRow[],
  team: TeamRow[],
  load = 1,
  startCash = 0,
  horizon?: number,
  C: Constants = financeConstants,
): CurvePoint[] {
  const months = horizon ?? C.horizonMonths
  const first = params.monthsToFirstOrder + 1
  const points: CurvePoint[] = []
  let cumulative = 0
  for (let m = 1; m <= months; m++) {
    const opsMonth = Math.max(0, m - first + 1)
    const objects = objectsInOpsMonth(params, opsMonth, load, C)
    const revenue = objects * params.avgBudget
    const grossProfit = revenue * (params.marginPct / 100)
    const opex = opexInMonth(params, team, m, C)
    const capex = capexInMonth(params, equipment, m, C)
    const net = grossProfit - opex - capex
    cumulative += net
    points.push({ month: m, opsMonth, objects, revenue, grossProfit, opex, capex, net, cumulative, cash: startCash + cumulative })
  }
  return points
}

// ---------- Оборотка и нужная инвестиция ----------

export type Investment = {
  capex: Capex
  materials: Range
  zeroMonth: number | null // календарный месяц, когда валовая прибыль покрывает OPEX
  monthsToZero: number // сколько месяцев OPEX закладываем в оборотку
  opexUntilZero: number
  workingCapital: Range // материалы + OPEX до нуля
  subtotal: Range // CAPEX + оборотка
  reserve: Range
  total: Range
}

/** Первый месяц, когда валовая прибыль ≥ OPEX (операционный ноль) */
export function operatingZeroMonth(curve: CurvePoint[]): number | null {
  const p = curve.find((x) => x.opsMonth >= 1 && x.grossProfit >= x.opex)
  return p ? p.month : null
}

export function computeInvestment(
  params: FinanceParams,
  equipment: EquipmentRow[],
  team: TeamRow[],
  load = 1,
  C: Constants = financeConstants,
): Investment {
  const capex = computeCapex(params, equipment, C)
  const curve = computeCashCurve(params, equipment, team, load, 0, C.horizonMonths, C)
  const zeroMonth = operatingZeroMonth(curve)
  const monthsToZero = zeroMonth ? zeroMonth - 1 : C.horizonMonths
  const opexUntilZero = curve.slice(0, monthsToZero).reduce((s, p) => s + p.opex, 0)
  const materials = range(C.materialsMin, C.materialsMax)
  const workingCapital = addRanges(materials, fixed(opexUntilZero))
  const subtotal = addRanges(capex.total, workingCapital)
  const reserve = scaleRange(subtotal, params.reservePct / 100)
  return {
    capex,
    materials,
    zeroMonth,
    monthsToZero,
    opexUntilZero,
    workingCapital,
    subtotal,
    reserve,
    total: addRanges(subtotal, reserve),
  }
}

// ---------- Окупаемость ----------

/** Месяц, когда накопленный денежный поток возвращается к нулю: вложенное вернулось */
export function paybackMonth(
  params: FinanceParams,
  equipment: EquipmentRow[],
  team: TeamRow[],
  load = 1,
  C: Constants = financeConstants,
): number | null {
  const curve = computeCashCurve(params, equipment, team, load, 0, C.paybackSearchMonths, C)
  const p = curve.find((x) => x.opsMonth >= 1 && x.cumulative >= 0)
  return p ? p.month : null
}

// ---------- Полная модель ----------

export type LoadResult = {
  id: LoadScenarioId
  title: string
  label: string
  load: number
  investment: Investment
  curve: CurvePoint[] // с базовой стартовой кассой
  minCash: { month: number; value: number }
  zeroMonth: number | null
  payback: number | null
  objectsAtEnd: number
  cashAtEnd: number
  cumulative36: number // накопленный поток к 36 месяцу, без стартовой кассы
  cumulative60: number
}

export type ModelResult = {
  params: FinanceParams
  constants: Constants
  capex: Capex
  opex: Opex
  breakEven: number // объектов в месяц
  base: LoadResult
  pessimistic: LoadResult
  optimistic: LoadResult
  startCash: number // базовая нужная инвестиция (mid)
  headcount: number
  flowForPayback36: number | null // объектов в год, чтобы окупиться за 36 мес
  utilizationAtEnd: number // загрузка мощности потоком заказов к концу горизонта, доля
}

export function computeModel(params: FinanceParams, equipment: EquipmentRow[], team: TeamRow[], C: Constants = financeConstants): ModelResult {
  const capex = computeCapex(params, equipment, C)
  const opex = computeOpex(params, team, C)
  const baseInvestment = computeInvestment(params, equipment, team, 1, C)
  const startCash = baseInvestment.total.mid

  const results = loadScenarios(C).map((s): LoadResult => {
    const investment = s.load === 1 ? baseInvestment : computeInvestment(params, equipment, team, s.load, C)
    const curve = computeCashCurve(params, equipment, team, s.load, startCash, C.horizonMonths, C)
    const minPoint = curve.reduce((a, b) => (b.cash < a.cash ? b : a), curve[0])
    const last = curve[curve.length - 1]
    return {
      id: s.id,
      title: s.title,
      label: s.label,
      load: s.load,
      investment,
      curve,
      minCash: { month: minPoint.month, value: minPoint.cash },
      zeroMonth: operatingZeroMonth(curve),
      payback: paybackMonth(params, equipment, team, s.load, C),
      objectsAtEnd: last.objects,
      cashAtEnd: last.cash,
      cumulative36: cumulativeAt(params, equipment, team, s.load, 36, C),
      cumulative60: cumulativeAt(params, equipment, team, s.load, 60, C),
    }
  })

  const byId = (id: LoadScenarioId) => results.find((r) => r.id === id)!

  return {
    params,
    constants: C,
    capex,
    opex,
    breakEven: breakEvenObjects(opex.total, params.avgBudget, params.marginPct),
    base: byId('base'),
    pessimistic: byId('pessimistic'),
    optimistic: byId('optimistic'),
    startCash,
    headcount: opex.headcount,
    flowForPayback36: flowForPayback(params, equipment, team, 36, C),
    utilizationAtEnd: capacityUtilization(byId('base').objectsAtEnd, C),
  }
}

export const toAmd = (usd: number, rate: number): number => usd * rate

// ---------- Дополнительные показатели для инвестора ----------

/** Накопленный денежный поток к месяцу m (без стартовой кассы) */
export function cumulativeAt(params: FinanceParams, equipment: EquipmentRow[], team: TeamRow[], load: number, m: number, C: Constants = financeConstants): number {
  const curve = computeCashCurve(params, equipment, team, load, 0, Math.max(m, 1), C)
  return curve[Math.min(m, curve.length) - 1].cumulative
}

/** Сколько объектов в год нужно, чтобы окупиться за months. Ищем множитель к текущему потоку. null — не достигается даже при 10-кратном потоке */
export function flowForPayback(params: FinanceParams, equipment: EquipmentRow[], team: TeamRow[], months: number, C: Constants = financeConstants): number | null {
  const baseFlow = params.anchorPerYear + params.externalPerYear
  if (baseFlow <= 0) return null
  const ok = (k: number) => {
    const p = { ...params, anchorPerYear: params.anchorPerYear * k, externalPerYear: params.externalPerYear * k }
    const pb = paybackMonth(p, equipment, team, 1, C)
    return pb !== null && pb <= months
  }
  if (!ok(10)) return null
  let lo = 0
  let hi = 10
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return baseFlow * hi
}

export type Tranche = { title: string; months: string; amount: number; note: string }

/** Когда нужны деньги. Сумма траншей и резерва равна нужной инвестиции (середина диапазона) */
export function tranches(params: FinanceParams, investment: Investment, curve: CurvePoint[]): Tranche[] {
  const prep = params.monthsToFirstOrder
  const zero = investment.zeroMonth ?? curve.length
  const prepOpex = curve.slice(0, prep).reduce((s, p) => s + p.opex, 0)
  const first = investment.capex.total.mid + prepOpex
  const second = investment.materials.mid + Math.max(0, investment.opexUntilZero - prepOpex)
  return [
    { title: 'Транш 1: запуск', months: prep > 0 ? `месяцы 1–${prep}` : 'месяц 1', amount: first, note: 'Оборудование с доставкой, подготовка помещения, депозит, регистрация, OPEX до первого заказа' },
    { title: 'Транш 2: оборотка', months: zero > prep ? `месяцы ${prep + 1}–${zero}` : '—', amount: second, note: 'Материалы на первые заказы и OPEX до выхода в ноль, без зачета валовой прибыли' },
    { title: 'Резерв', months: 'по необходимости', amount: investment.reserve.mid, note: `${params.reservePct}% от CAPEX и оборотки на задержки оплат и курс` },
  ]
}

export type SensitivityRow = { title: string; change: string; breakEven: number; investment: number; cumulative36: number }

/** Чувствительность: как изменение одного входа меняет точку безубыточности, нужную инвестицию и поток к 36 мес */
export function sensitivity(params: FinanceParams, equipment: EquipmentRow[], team: TeamRow[], C: Constants = financeConstants): SensitivityRow[] {
  const run = (p: FinanceParams, t: TeamRow[], c: Constants) => {
    const opex = computeOpex(p, t, c)
    return {
      breakEven: breakEvenObjects(opex.total, p.avgBudget, p.marginPct),
      investment: computeInvestment(p, equipment, t, 1, c).total.mid,
      cumulative36: cumulativeAt(p, equipment, t, 1, 36, c),
    }
  }
  const scaleTeam = (k: number) => team.map((r) => ({ ...r, salary: r.salary * k }))
  const cases: { title: string; change: string; p?: FinanceParams; t?: TeamRow[]; c?: Constants }[] = [
    { title: 'Бюджет объекта', change: '+10%', p: { ...params, avgBudget: params.avgBudget * 1.1 } },
    { title: 'Бюджет объекта', change: '−10%', p: { ...params, avgBudget: params.avgBudget * 0.9 } },
    { title: 'Валовая маржа', change: '+5 п.п.', p: { ...params, marginPct: params.marginPct + 5 } },
    { title: 'Валовая маржа', change: '−5 п.п.', p: { ...params, marginPct: Math.max(1, params.marginPct - 5) } },
    { title: 'Поток заказов', change: '+10%', p: { ...params, anchorPerYear: params.anchorPerYear * 1.1, externalPerYear: params.externalPerYear * 1.1 } },
    { title: 'Поток заказов', change: '−10%', p: { ...params, anchorPerYear: params.anchorPerYear * 0.9, externalPerYear: params.externalPerYear * 0.9 } },
    { title: 'Зарплаты', change: '+10%', t: scaleTeam(1.1) },
    { title: 'Зарплаты', change: '−10%', t: scaleTeam(0.9) },
    { title: 'Аренда', change: '+10%', p: { ...params, rentPerM2: params.rentPerM2 * 1.1 } },
    { title: 'Аренда', change: '−10%', p: { ...params, rentPerM2: params.rentPerM2 * 0.9 } },
  ]
  return cases.map((k) => {
    const r = run(k.p ?? params, k.t ?? team, k.c ?? C)
    return { title: k.title, change: k.change, breakEven: r.breakEven, investment: r.investment, cumulative36: r.cumulative36 }
  })
}

/** Загрузка мощности потоком заказов к концу горизонта, доля от 1 */
export function capacityUtilization(objectsPerMonth: number, C: Constants = financeConstants): number {
  return C.capacityObjectsPerMonth > 0 ? objectsPerMonth / C.capacityObjectsPerMonth : Infinity
}
