// Дорожная карта на 18 месяцев. Месяцы считаются с 1 (регистрация). start/end включительно
export type RoadmapBar = { title: string; start: number; end: number }
export type Milestone = { title: string; month: number }

export const roadmapMonths = 18

export const roadmapBars: RoadmapBar[] = [
  { title: 'Регистрация и счет', start: 1, end: 1 },
  { title: 'Помещение', start: 1, end: 2 },
  { title: 'Закупка и доставка станков', start: 1, end: 3 },
  { title: 'Подготовка помещения', start: 2, end: 3 },
  { title: 'Монтаж и пусконаладка', start: 3, end: 4 },
  { title: 'Найм', start: 2, end: 4 },
  { title: 'Первый заказ', start: 4, end: 5 },
  { title: 'Выход в ноль', start: 9, end: 12 },
  { title: 'Расширение до B', start: 10, end: 18 },
]

export const milestones: Milestone[] = [
  { title: 'Компания открыта', month: 1 },
  { title: 'Договор аренды', month: 2 },
  { title: 'Станки в цехе', month: 3 },
  { title: 'Первый заказ', month: 4 },
  { title: 'Первый монтаж', month: 5 },
  { title: 'Второй ЧПУ', month: 10 },
  { title: 'Лазер и листогиб', month: 16 },
]
