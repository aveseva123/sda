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

// Константы модели. Все значения числовые: их можно менять в панели «Константы модели» на сайте,
// изменения попадают в адрес страницы. Здесь — значения по умолчанию.
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
  prepPayrollSharePct: 50, // доля ФОТ в подготовительные месяцы: команда нанимается постепенно

  // Оборотка
  materialsMin: 20000, // материалы на первые заказы
  materialsMax: 40000,

  // Поток заказов
  externalStartMonthOfOps: 3, // внешние заказы появляются с 3-го месяца работы (после первого заказа)
  externalRampMonths: 6, // и линейно растут до полной скорости за 6 месяцев

  // Фазы расширения, месяцев после первого заказа
  phaseOffsetM6: 6,
  phaseOffsetM12: 12,

  // Сценарии загрузки, % от базовой
  pessimisticLoadPct: 70,
  optimisticLoadPct: 130,

  // Общежитие и питание для сотрудников. По умолчанию выключено (нули): стоимость в Ереване — к уточнению.
  // Логика: часть штата живет в общежитии и питается за счет цеха, зато нанимается с меньшей зарплатой gross
  housingPerPerson: 0, // проживание, $ на человека в месяц
  mealsPerPerson: 0, // питание, $ на человека в месяц
  housedSharePct: 0, // доля штата, которая пользуется общежитием, %
  housedSalaryDiscountPct: 0, // на сколько ниже зарплата gross у тех, кто живет в общежитии, %
}

// Пример для кнопки «Подставить пример» на сайте. Это не рыночные данные, а иллюстрация механики
export const housingExample = { housingPerPerson: 150, mealsPerPerson: 120, housedSharePct: 50, housedSalaryDiscountPct: 15 }

export type Constants = typeof financeConstants
export type ConstantKey = keyof Constants

// Описание констант для панели на сайте: подпись, единица, диапазон
export type ConstantField = { key: ConstantKey; label: string; unit?: string; min: number; max: number; step: number }
export type ConstantGroup = { title: string; fields: ConstantField[] }

export const constantGroups: ConstantGroup[] = [
  {
    title: 'CAPEX',
    fields: [
      { key: 'shippingPctMin', label: 'Доставка и таможня, от', unit: '%', min: 0, max: 50, step: 1 },
      { key: 'shippingPctMax', label: 'Доставка и таможня, до', unit: '%', min: 0, max: 50, step: 1 },
      { key: 'fitOutMin', label: 'Подготовка помещения, от', unit: '$', min: 0, max: 200000, step: 1000 },
      { key: 'fitOutMax', label: 'Подготовка помещения, до', unit: '$', min: 0, max: 200000, step: 1000 },
      { key: 'registrationMin', label: 'Регистрация и ПО, от', unit: '$', min: 0, max: 50000, step: 500 },
      { key: 'registrationMax', label: 'Регистрация и ПО, до', unit: '$', min: 0, max: 50000, step: 500 },
      { key: 'depositMonths', label: 'Депозит по аренде', unit: 'мес', min: 0, max: 6, step: 1 },
    ],
  },
  {
    title: 'OPEX',
    fields: [
      { key: 'payrollTaxPct', label: 'Налоги и взносы сверх gross', unit: '%', min: 0, max: 60, step: 1 },
      { key: 'electricityPerMonth', label: 'Электричество в месяц', unit: '$', min: 0, max: 10000, step: 50 },
      { key: 'otherPerMonth', label: 'Прочее в месяц', unit: '$', min: 0, max: 10000, step: 50 },
      { key: 'prepPayrollSharePct', label: 'ФОТ в подготовительные месяцы', unit: '%', min: 0, max: 100, step: 5 },
    ],
  },
  {
    title: 'Оборотка и поток заказов',
    fields: [
      { key: 'materialsMin', label: 'Материалы на первые заказы, от', unit: '$', min: 0, max: 200000, step: 1000 },
      { key: 'materialsMax', label: 'Материалы на первые заказы, до', unit: '$', min: 0, max: 200000, step: 1000 },
      { key: 'externalStartMonthOfOps', label: 'Внешние заказы с месяца работы', unit: '№', min: 1, max: 12, step: 1 },
      { key: 'externalRampMonths', label: 'Разгон внешних заказов', unit: 'мес', min: 1, max: 24, step: 1 },
    ],
  },
  {
    title: 'Фазы и сценарии',
    fields: [
      { key: 'phaseOffsetM6', label: 'Фаза «+6 мес» после первого заказа', unit: 'мес', min: 0, max: 24, step: 1 },
      { key: 'phaseOffsetM12', label: 'Фаза «+12 мес» после первого заказа', unit: 'мес', min: 0, max: 36, step: 1 },
      { key: 'pessimisticLoadPct', label: 'Пессимистичная загрузка', unit: '%', min: 10, max: 100, step: 5 },
      { key: 'optimisticLoadPct', label: 'Оптимистичная загрузка', unit: '%', min: 100, max: 300, step: 5 },
      { key: 'paybackSearchMonths', label: 'Искать окупаемость до месяца', unit: '№', min: 18, max: 120, step: 6 },
    ],
  },
  {
    title: 'Общежитие и питание',
    fields: [
      { key: 'housingPerPerson', label: 'Проживание на человека в месяц', unit: '$', min: 0, max: 2000, step: 10 },
      { key: 'mealsPerPerson', label: 'Питание на человека в месяц', unit: '$', min: 0, max: 2000, step: 10 },
      { key: 'housedSharePct', label: 'Доля штата в общежитии', unit: '%', min: 0, max: 100, step: 5 },
      { key: 'housedSalaryDiscountPct', label: 'Ниже зарплата gross у живущих', unit: '%', min: 0, max: 50, step: 1 },
    ],
  },
]

export type LoadScenarioId = 'pessimistic' | 'base' | 'optimistic'
