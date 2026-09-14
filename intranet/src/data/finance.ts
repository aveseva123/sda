// Параметры финансовой модели: значения по умолчанию, диапазоны ползунков и константы.
// Все суммы — USD. Ползунки меняют defaults, константы правятся только здесь.

import type { Scenario } from './equipment'

export type FinanceParams = {
  scenario: Scenario
  areaM2: number // площадь, м²
  rentPerM2: number // аренда, $/м²/мес
  avgBudget: number // средний бюджет мебели на объект, $
  anchorPerYear: number // объектов от якорного клиента в год
  externalPerYear: number // внешних объектов в год (полная скорость после разгона)
  marginPct: number // валовая маржа, %
  monthsToFirstOrder: number // месяцев подготовки до первого заказа
  reservePct: number // резерв, % от суммы CAPEX + оборотка
  amdRate: number // курс драма к доллару
}

export const financeDefaults: FinanceParams = {
  scenario: 'A',
  areaM2: 400,
  rentPerM2: 5.5,
  avgBudget: 35000,
  anchorPerYear: 3,
  externalPerYear: 4,
  marginPct: 35,
  monthsToFirstOrder: 3,
  reservePct: 12,
  amdRate: 390,
}

// Диапазоны ползунков
export const financeRanges: Record<Exclude<keyof FinanceParams, 'scenario'>, { min: number; max: number; step: number }> = {
  areaM2: { min: 300, max: 800, step: 10 },
  rentPerM2: { min: 3, max: 9, step: 0.25 },
  avgBudget: { min: 10000, max: 90000, step: 1000 },
  anchorPerYear: { min: 0, max: 12, step: 1 },
  externalPerYear: { min: 0, max: 24, step: 1 },
  marginPct: { min: 20, max: 55, step: 1 },
  monthsToFirstOrder: { min: 1, max: 6, step: 1 },
  reservePct: { min: 0, max: 30, step: 1 },
  amdRate: { min: 350, max: 450, step: 1 },
}

export const financeConstants = {
  horizonMonths: 18, // горизонт кэш-кривой
  paybackSearchMonths: 60, // до какого месяца ищем окупаемость

  // CAPEX
  shippingPctMin: 15, // доставка и таможня, % от оборудования
  shippingPctMax: 20,
  fitOutMin: 15000, // подготовка помещения
  fitOutMax: 40000,
  registrationMin: 5000, // регистрация, ПО, юристы
  registrationMax: 10000,
  depositMonths: 2, // депозит по аренде, месяцев

  // OPEX
  payrollTaxPct: 25, // налоги и взносы сверх gross
  electricityPerMonth: 800,
  otherPerMonth: 1500, // связь, расходники, бухгалтерия, транспорт
  prepPayrollShare: 0.5, // доля ФОТ в подготовительные месяцы: команда нанимается постепенно

  // Оборотка
  materialsMin: 20000, // материалы на первые заказы
  materialsMax: 40000,

  // Поток заказов
  externalStartMonthOfOps: 3, // внешние заказы появляются с 3-го месяца работы (после первого заказа)
  externalRampMonths: 6, // и линейно растут до полной скорости за 6 месяцев

  // Фазы расширения, месяцев после первого заказа
  phaseOffset: { start: 0, m6: 6, m12: 12 } as const,

  // Три сценария загрузки
  loadScenarios: [
    { id: 'pessimistic', title: 'Пессимистичный', load: 0.7, label: '−30% загрузки' },
    { id: 'base', title: 'Базовый', load: 1, label: 'Как в параметрах' },
    { id: 'optimistic', title: 'Оптимистичный', load: 1.3, label: '+30% загрузки' },
  ] as const,
}

export type LoadScenarioId = (typeof financeConstants.loadScenarios)[number]['id']
