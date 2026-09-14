// Оборудование. Цены за единицу, USD, без доставки.
// scenario: 'A' — стартовый набор; 'B' — расширение (добавляется к A).
// phase: когда покупаем. 'start' — до первого заказа, 'm6' — через 6 мес после первого заказа, 'm12' — через 12 мес.
// Фазы для сценария B — предположение, поправьте по факту переговоров.

export type Scenario = 'A' | 'B'
export type Phase = 'start' | 'm6' | 'm12'
export type Source = 'Россия б/у' | 'Россия дилер' | 'Китай'
export type Condition = 'новый' | 'б/у'

export type EquipmentRow = {
  id: string
  name: string
  qty: number
  priceMin: number
  priceMax: number
  source: Source
  condition: Condition
  scenario: Scenario
  phase: Phase
  comment: string
}

export const phases: { id: Phase; title: string }[] = [
  { id: 'start', title: 'Старт' },
  { id: 'm6', title: '+6 мес' },
  { id: 'm12', title: '+12 мес' },
]

export const equipment: EquipmentRow[] = [
  // ---------- Сценарий A: старт ----------
  {
    id: 'cnc-1',
    name: 'ЧПУ 1300×2500, нестинг, ATC',
    qty: 1,
    priceMin: 18000,
    priceMax: 25000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Основной станок. Автосмена инструмента обязательна',
  },
  {
    id: 'saw',
    name: 'Форматно-раскроечный',
    qty: 1,
    priceMin: 6000,
    priceMax: 10000,
    source: 'Россия б/у',
    condition: 'б/у',
    scenario: 'A',
    phase: 'start',
    comment: 'Раскрой ЛДСП и HPL, докрой после нестинга',
  },
  {
    id: 'edge',
    name: 'Кромкооблицовочный автомат',
    qty: 1,
    priceMin: 10000,
    priceMax: 16000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'ПУР или ЭВА, торцовка, фрезеровка, цикля',
  },
  {
    id: 'drill',
    name: 'Присадочный',
    qty: 1,
    priceMin: 5000,
    priceMax: 8000,
    source: 'Россия б/у',
    condition: 'б/у',
    scenario: 'A',
    phase: 'start',
    comment: 'Многошпиндельный, под сборку корпусов',
  },
  {
    id: 'air',
    name: 'Аспирация, компрессор, пневмолиния',
    qty: 1,
    priceMin: 7000,
    priceMax: 12000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Расчет по станкам, монтаж своими силами',
  },
  {
    id: 'paint',
    name: 'Покрасочная и сушильные камеры',
    qty: 1,
    priceMin: 8000,
    priceMax: 15000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Строю сам: каркас, фильтры, вентиляторы, свет',
  },
  {
    id: 'hand',
    name: 'Шлифовка, ручной инструмент, верстаки, стеллажи',
    qty: 1,
    priceMin: 11000,
    priceMax: 18000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Festool или аналоги, верстаки собираем сами',
  },
  {
    id: 'metal',
    name: 'Металл-пост: TIG и полуавтомат, гибка труб, вытяжка',
    qty: 1,
    priceMin: 6000,
    priceMax: 10000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Мелкий металл и доработки, каркасы — субподряд',
  },
  {
    id: 'carts',
    name: 'Рохли, тележки',
    qty: 1,
    priceMin: 3000,
    priceMax: 6000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'A',
    phase: 'start',
    comment: 'Перемещение листов и готовых изделий',
  },

  // ---------- Сценарий B: расширение ----------
  {
    id: 'cnc-2',
    name: 'Второй ЧПУ',
    qty: 1,
    priceMin: 20000,
    priceMax: 25000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'B',
    phase: 'm6',
    comment: 'Снимает узкое место при 2+ объектах в месяц',
  },
  {
    id: 'weld-polish',
    name: 'Сварка и полировка',
    qty: 1,
    priceMin: 8000,
    priceMax: 12000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'B',
    phase: 'm6',
    comment: 'Нержавейка своими силами, уход от субподряда',
  },
  {
    id: 'forklift',
    name: 'Погрузчик',
    qty: 1,
    priceMin: 10000,
    priceMax: 15000,
    source: 'Россия б/у',
    condition: 'б/у',
    scenario: 'B',
    phase: 'm6',
    comment: 'Разгрузка листов и станков без внешнего манипулятора',
  },
  {
    id: 'drill-cnc',
    name: 'Присадка с ЧПУ',
    qty: 1,
    priceMin: 12000,
    priceMax: 18000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'B',
    phase: 'm6',
    comment: 'Замена ручной присадки, точность и скорость',
  },
  {
    id: 'edge-pro',
    name: 'Кромка классом выше',
    qty: 1,
    priceMin: 20000,
    priceMax: 35000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'B',
    phase: 'm12',
    comment: 'ПУР, прифуговка, скругление. Первая кромка уходит на докрой',
  },
  {
    id: 'paint-pro',
    name: 'Промышленные покрасочная и сушильная камеры',
    qty: 1,
    priceMin: 20000,
    priceMax: 35000,
    source: 'Россия дилер',
    condition: 'новый',
    scenario: 'B',
    phase: 'm12',
    comment: 'Сертифицированные, под объем 2+ объектов в месяц',
  },
  {
    id: 'laser',
    name: 'Лазер 1,5–3 кВт',
    qty: 1,
    priceMin: 35000,
    priceMax: 60000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'B',
    phase: 'm12',
    comment: 'Листовой металл и нержавейка своими силами',
  },
  {
    id: 'bend',
    name: 'Листогиб',
    qty: 1,
    priceMin: 20000,
    priceMax: 35000,
    source: 'Китай',
    condition: 'новый',
    scenario: 'B',
    phase: 'm12',
    comment: 'В связке с лазером: фартуки, столешницы, короба',
  },
]
