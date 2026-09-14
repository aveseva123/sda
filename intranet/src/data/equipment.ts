// Оборудование на старте. Цены за единицу, USD, без доставки.
// Металл не делаем: каркасы и нержавейка — субподряд, своего металл-поста нет.

export type Source = 'Россия б/у' | 'Россия дилер' | 'Китай'
export type Condition = 'новый' | 'б/у'

export type EquipmentRow = {
  id: string // короткий латинский идентификатор, используется в адресе страницы
  name: string
  qty: number
  priceMin: number
  priceMax: number
  source: Source
  condition: Condition
  comment: string
}

export const equipment: EquipmentRow[] = [
  {
    id: 'cnc-1',
    name: 'ЧПУ 1300×2500, нестинг, ATC',
    qty: 1,
    priceMin: 18000,
    priceMax: 25000,
    source: 'Китай',
    condition: 'новый',
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
    comment: 'Festool или аналоги, верстаки собираем сами',
  },
  {
    id: 'carts',
    name: 'Рохли, тележки',
    qty: 1,
    priceMin: 3000,
    priceMax: 6000,
    source: 'Россия дилер',
    condition: 'новый',
    comment: 'Перемещение листов и готовых изделий',
  },
]
