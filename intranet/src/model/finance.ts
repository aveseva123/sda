// Финансовая модель. Только чистые функции: вход — параметры, данные и константы, выход — цифры.
// Все суммы в USD. Месяцы считаются с 1 (первый месяц подготовки).
// Константы передаются последним аргументом; по умолчанию берутся из data/finance.ts.

import type { EquipmentRow, Phase, Scenario } from '../data/equipment'
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

const PHASES: Phase[] = ['start', 'm6', 'm12']

/** Смещение фаз в месяцах после первого заказа */
export const phaseOffset = (C: Constants): Record<Phase, number> => ({ start: 0, m6: C.phaseOffsetM6, m12: C.phaseOffsetM12 })

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

/** Фазы, которые входят в сценарий: A — только старт, B — старт и расширение */
export function phasesForScenario(scenario: Scenario): Phase[] {
  return scenario === 'A' ? ['start'] : PHASES
}

/** Строки оборудования для сценария (B включает A) и, если задано, до фазы включительно */
export function equipmentRows(rows: EquipmentRow[], scenario: Scenario, upToPhase?: Phase): EquipmentRow[] {
  const allowedScenarios: Scenario[] = scenario === 'A' ? ['A'] : ['A', 'B']
  const allowedPhases = upToPhase ? PHASES.slice(0, PHASES.indexOf(upToPhase) + 1) : phasesForScenario(scenario)
  return rows.filter((r) => allowedScenarios.includes(r.scenario) && allowedPhases.includes(r.phase))
}

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

/** ФОТ одной фазы (только ее строки) */
export function payrollByPhase(team: TeamRow[], phase: Phase, C: Constants = financeConstants): Payroll {
  return payrollOf(
    team.filter((r) => r.phase === phase),
    C,
  )
}

/** ФОТ накопительно до фазы включительно */
export function payrollUpTo(team: TeamRow[], phase: Phase, C: Constants = financeConstants): Payroll {
  const allowed = PHASES.slice(0, PHASES.indexOf(phase) + 1)
  return payrollOf(
    team.filter((r) => allowed.includes(r.phase)),
    C,
  )
}

// ---------- CAPEX ----------

export type Capex = {
  equipment: Range
  shipping: Range
  fitOut: Range
  deposit: Range
  registration: Range
  total: Range
  byPhase: Record<Phase, Range> // оборудование + доставка по фазам
}

export function computeCapex(params: FinanceParams, equipment: EquipmentRow[], C: Constants = financeConstants): Capex {
  const rows = equipmentRows(equipment, params.scenario)
  const eq = equipmentCapex(rows, C)
  const byPhase = Object.fromEntries(
    PHASES.map((p) => [
      p,
      equipmentCapex(
        rows.filter((r) => r.phase === p),
        C,
      ).total,
    ]),
  ) as Record<Phase, Range>
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
    byPhase,
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

/** OPEX в месяц при полном штате указанных фаз */
export function computeOpex(params: FinanceParams, team: TeamRow[], phases: Phase[] = ['start'], C: Constants = financeConstants): Opex {
  const p = payrollOf(
    team.filter((r) => phases.includes(r.phase)),
    C,
  )
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

/** Активные фазы штата в календарном месяце m */
export function activePhases(params: FinanceParams, m: number, C: Constants = financeConstants): Phase[] {
  const first = params.monthsToFirstOrder + 1
  const offset = phaseOffset(C)
  return phasesForScenario(params.scenario).filter((p) => m >= first + offset[p])
}

/** OPEX конкретного месяца: в подготовительный период часть ФОТ, дальше по активным фазам */
export function opexInMonth(params: FinanceParams, team: TeamRow[], m: number, C: Constants = financeConstants): number {
  const first = params.monthsToFirstOrder + 1
  const rent = params.areaM2 * params.rentPerM2
  const fixedPart = rent + C.electricityPerMonth + C.otherPerMonth
  if (m < first) {
    const p = payrollUpTo(team, 'start', C)
    return fixedPart + (p.total + housingCost(p.headcount, C)) * (C.prepPayrollSharePct / 100)
  }
  const phases = activePhases(params, m, C)
  const p = payrollOf(
    team.filter((r) => phases.includes(r.phase)),
    C,
  )
  return fixedPart + p.total + housingCost(p.headcount, C)
}

/** CAPEX конкретного месяца: старт равномерно по подготовительным месяцам, фазы — в месяц начала фазы */
export function capexInMonth(params: FinanceParams, equipment: EquipmentRow[], m: number, C: Constants = financeConstants): number {
  const capex = computeCapex(params, equipment, C)
  const prep = Math.max(1, params.monthsToFirstOrder)
  const first = params.monthsToFirstOrder + 1
  const offset = phaseOffset(C)
  let out = 0
  if (m <= prep) {
    out += (capex.byPhase.start.mid + capex.fitOut.mid + capex.registration.mid) / prep
  }
  if (m === 1) out += capex.deposit.mid
  for (const p of phasesForScenario(params.scenario)) {
    if (p !== 'start' && m === first + offset[p]) out += capex.byPhase[p].mid
  }
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
}

export type ModelResult = {
  params: FinanceParams
  constants: Constants
  capex: Capex
  opexStart: Opex // при стартовом штате
  opexFull: Opex // при полном штате сценария
  breakEvenStart: number // объектов в месяц при стартовом OPEX
  breakEvenFull: number // при полном штате сценария
  base: LoadResult
  pessimistic: LoadResult
  optimistic: LoadResult
  startCash: number // базовая нужная инвестиция (mid)
  headcountStart: number
}

export function computeModel(params: FinanceParams, equipment: EquipmentRow[], team: TeamRow[], C: Constants = financeConstants): ModelResult {
  const capex = computeCapex(params, equipment, C)
  const opexStart = computeOpex(params, team, ['start'], C)
  const opexFull = computeOpex(params, team, phasesForScenario(params.scenario), C)
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
    }
  })

  const byId = (id: LoadScenarioId) => results.find((r) => r.id === id)!

  return {
    params,
    constants: C,
    capex,
    opexStart,
    opexFull,
    breakEvenStart: breakEvenObjects(opexStart.total, params.avgBudget, params.marginPct),
    breakEvenFull: breakEvenObjects(opexFull.total, params.avgBudget, params.marginPct),
    base: byId('base'),
    pessimistic: byId('pessimistic'),
    optimistic: byId('optimistic'),
    startCash,
    headcountStart: opexStart.headcount,
  }
}

export const toAmd = (usd: number, rate: number): number => usd * rate
