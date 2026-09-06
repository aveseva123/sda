const SOURCE_LABELS: Record<string, string> = {
  layer_map: 'слой DXF',
  filename: 'имя файла',
  folder: 'имя папки',
  dxf_annotation: 'текст в DXF',
  spec: 'спецификация',
  batch_default: 'по умолчанию',
  manual: 'вручную',
  unresolved: 'не определено',
}

const FILE_STATUS_LABELS: Record<string, string> = {
  pending: 'ожидает',
  parsed: 'разобран',
  needs_clarification: 'требует уточнения',
  failed: 'ошибка',
  duplicate: 'дубль',
}

const BATCH_STATUS_LABELS: Record<string, string> = {
  pending: 'готов к разбору',
  mapping_required: 'нужна карта слоёв',
  processing: 'разбирается',
  done: 'разобран',
  failed: 'ошибка',
}

const SOURCE_TITLES: Record<string, string> = {
  bazis: 'Базис',
  fusion: 'Fusion 360',
  unknown: 'источник не определён',
}

export const sourceLabel = (key: string) => SOURCE_LABELS[key] ?? key
export const fileStatusLabel = (key: string) => FILE_STATUS_LABELS[key] ?? key
export const batchStatusLabel = (key: string) => BATCH_STATUS_LABELS[key] ?? key
export const dxfSourceLabel = (key: string) => SOURCE_TITLES[key] ?? key

export function mm(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ${few}`
  return `${n} ${many}`
}
