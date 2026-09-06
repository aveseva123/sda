export type PartStatus = 'ready' | 'needs_clarification' | 'rejected'

export interface Material {
  id: number
  name: string
  thickness: number
  has_grain: boolean
  sheet_w: number
  sheet_h: number
  price: number | null
  supplier: string | null
  trim_left: number
  trim_right: number
  trim_top: number
  trim_bottom: number
  stock_sheets: number | null
  aliases: string[] | null
}

export interface Style {
  /** Цвет файла без оттенка по листу: оттенок считает клиент, он знает тему. */
  base: string
  /** Цвет с оттенком, посчитанный сервером, — для стикеров и печати. */
  fill: string
  pattern: string
  stroke: string
  text: string
}

/** Файл в буфере: он держит цвет и заказ. */
export interface SourceFile {
  id: number
  filename: string
  relpath: string
  order_name: string | null
  color: string
  color_index: number
  status: string
  detected_source: string
  sheets: number
  positions: number
  parts: number
  /** Сколько деталей на каждом листе внутри файла — дерево буфера. */
  sheet_parts: number[]
  needs_clarification: number
  error: string | null
}

/** Заказ — просто имя и то, что под ним лежит. */
export interface Order {
  name: string
  positions: number
  parts: number
  files: number
  needs_clarification: number
}

export interface ResolveAttempt {
  resolver: string
  matched: boolean
  value: number | null
  pattern: string | null
  confidence: number
  note: string
}

export interface Clarification {
  thickness: {
    value: number | null
    confidence: number
    source: string
    known: boolean
    accepted: boolean
    attempts: ResolveAttempt[]
  }
  material: {
    material_id: number | null
    material_name: string | null
    confidence: number
    source: string
    accepted: boolean
    note: string
  }
  unmapped_layers: string[]
  geometry_warnings: string[]
}

export interface Part {
  id: number
  source_file_id: number | null
  source_file: string | null
  source_sheet_index: number
  order_name: string | null
  name: string
  code: string | null
  qty: number
  length: number | null
  width: number | null
  thickness: number | null
  material_id: number | null
  material_name: string | null
  grain: string
  edge_top: string | null
  edge_bottom: string | null
  edge_left: string | null
  edge_right: string | null
  status: PartStatus
  thickness_source: string
  thickness_confidence: number
  material_source: string
  clarification: Clarification | null
  style: Style | null
}

export interface PartGeometry {
  id: number
  name: string
  geometry: {
    outer: number[][]
    inners: number[][][]
    operations: Array<{
      semantic: string
      kind: string
      layer: string
      closed: boolean
      points?: number[][]
      center?: number[]
      diameter?: number
    }>
    bbox: number[]
    length: number
    width: number
    area: number
  } | null
}

export interface ImportFile {
  id: number
  filename: string
  relpath: string
  status: string
  detected_source: string
  error: string | null
  part_id: number | null
  resolve_trace: Record<string, unknown> | null
}

export interface ImportBatch {
  id: number
  name: string | null
  status: string
  detected_source: string
  layer_preset_id: number | null
  filename_template: string | null
  stats: {
    files_total?: number
    spec_rows?: number
    skipped?: string[]
    spec_warnings?: string[]
    parsed?: number
    needs_clarification?: number
    duplicates?: number
    failed?: number
  } | null
  error: string | null
  created_at: string
  files: ImportFile[]
}

export interface LayerStat {
  name: string
  count: number
  files: number
  dxftypes: Record<string, number>
  closed_paths: number
  circles: number
  texts: number
  circle_diameters: number[]
  /** Глубина обработки, объявленная в имени слоя (Базис: «PERIMETER D 16.00»). */
  depth: number | null
  /** Семантика взята из сохранённого пресета, а не из геометрической догадки. */
  from_preset: boolean
}

export interface SemanticInfo {
  title: string
  cut: boolean
  offset: string
  through: boolean
}

export interface LayerSummary {
  detected_source: string
  preset_name: string | null
  layers: LayerStat[]
  suggestions: Record<string, string>
  semantics: Record<string, SemanticInfo>
}

export interface LayerPreset {
  id: number
  name: string
  source: string
  rules: Array<{ layer?: string; regex?: string; semantic: string }>
  thickness_from_layer_regex: string | null
  is_builtin: boolean
}

export interface AppConfig {
  thicknesses: { known: number[]; match_tolerance: number; min: number; max: number }
  geometry: Record<string, number>
  import: Record<string, unknown>
  labels: { default_template: string }
  filename_templates: Array<{ name: string; title: string; example: string }>
  semantics: Record<string, SemanticInfo>
  depth_rules: Array<Record<string, unknown>>
}


export interface SheetFormat {
  id: number
  material_id: number
  w: number
  h: number
  price: number | null
}

export interface OffcutVerdict {
  worth_keeping: boolean
  reason: string
  area_m2: number
  thresholds: Record<string, number>
}

export interface StockItem {
  id: number
  material_id: number
  material_name: string | null
  thickness: number | null
  kind: 'sheet' | 'offcut'
  w: number
  h: number
  qty: number
  status: string
  location: string | null
  note: string | null
  price: number | null
  source_item_id: number | null
  area_m2: number
  verdict: OffcutVerdict | null
}

export interface StockMovement {
  id: number
  item_id: number
  kind: string
  qty: number
  reason: string | null
  actor: string | null
  offcut_id: number | null
  created_at: string
}

export interface StockSummaryRow {
  material_id: number
  material_name: string
  thickness: number | null
  sheets: number
  offcuts: number
  area_m2: number
}

export interface DetectedSheet {
  w: number
  h: number
  thickness: number | null
  count: number
  files: string[]
}

/** Пресет раскроя: словарь ArtCAM, но на материал, а не на траекторию. */
export interface CuttingPreset {
  id: number
  slug: string
  name: string
  applies_to: { thickness?: number; material_regex?: string; include_offcuts?: boolean }
  placement: Record<string, number | string | boolean>
  depth: Record<string, number>
  strategy: Record<string, unknown>
  tools: Record<string, unknown>
  order: string[]
  safety: Record<string, unknown>
  post: Record<string, unknown>
  is_default: boolean
  is_builtin: boolean
  last_utilization: number | null
}

/** Карточка файла в диалоге добавления: что платформа предлагает. */
export interface FileCard {
  file_id: number
  filename: string
  relpath: string
  order_name: string | null
  product_name: string | null
  part_name: string | null
  qty: number
  thickness: number | null
  thickness_source: string
  detected_thicknesses: number[]
  parts: number
  detected_source: string
  warnings: string[]
}

export interface IntakeResult {
  batch_id: number
  files: FileCard[]
}

/** Решение оператора по файлу. */
export interface FileDecision {
  relpath: string
  thickness: number
  material_id?: number | null
  order_name?: string | null
  product_name?: string | null
  grain?: string
}

export interface ChecklistItem {
  key: string
  title: string
  done: boolean
}

export interface ToolMode {
  material: string
  rpm: number
  feed: number
  step_z: number
}

export interface ToolResource {
  used: number
  limit: number | null
  unit: string
  ratio: number | null
  low: boolean
}

export interface Tool {
  id: number
  slot: number | null
  name: string
  type: string
  diameter: number
  flute_length: number | null
  total_length: number | null
  flutes: number | null
  shank: number | null
  article: string | null
  rpm: number
  feed: number
  plunge_feed: number
  step_down: number
  min_radius: number
  resource: ToolResource
  modes: ToolMode[]
  usage: string[]
  is_builtin: boolean
}

export interface MagazineSlot {
  slot: number
  tool_id: number | null
  name: string | null
  diameter: number | null
  low: boolean
}

export interface ToolLibrary {
  magazine: MagazineSlot[]
  slots: number
  tools: Tool[]
}
