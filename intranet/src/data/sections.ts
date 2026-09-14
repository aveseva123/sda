// Разделы сайта в порядке показа. id — якорь в URL (#finance), title — подпись в навигации
export type SectionId =
  | 'summary'
  | 'about'
  | 'market'
  | 'product'
  | 'premises'
  | 'equipment'
  | 'team'
  | 'operations'
  | 'finance'
  | 'investor'
  | 'roadmap'
  | 'risks'
  | 'next'

export const sections: { id: SectionId; title: string; short: string }[] = [
  { id: 'summary', title: 'Резюме', short: 'Резюме' },
  { id: 'about', title: 'Кто я', short: 'Кто я' },
  { id: 'market', title: 'Рынок и ниша', short: 'Рынок' },
  { id: 'product', title: 'Продукт', short: 'Продукт' },
  { id: 'premises', title: 'Помещение', short: 'Помещение' },
  { id: 'equipment', title: 'Оборудование', short: 'Станки' },
  { id: 'team', title: 'Команда', short: 'Команда' },
  { id: 'operations', title: 'Операционная модель', short: 'Операции' },
  { id: 'finance', title: 'Финансовая модель', short: 'Финансы' },
  { id: 'investor', title: 'Условия для инвестора', short: 'Инвестору' },
  { id: 'roadmap', title: 'Дорожная карта', short: 'Карта' },
  { id: 'risks', title: 'Риски', short: 'Риски' },
  { id: 'next', title: 'До второй встречи', short: 'Встреча' },
]
