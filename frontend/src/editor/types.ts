export interface Vector {
  target: string
  semantic: string
  title: string
  bbox: number[] | null
  length: number | null
  diameter: number | null
  depth: number | null
  points: number
  preset_id: number | null
  enabled: boolean
  /** Назначено вручную — тогда значок «АВТО» не показывается. */
  assigned_manually: boolean
}

export type VectorView = Vector

export interface PartGeometryData {
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
    depth?: number
  }>
  bbox: number[]
  length: number
  width: number
  area: number
}

export interface PartView {
  id: number
  name: string
  order_name: string | null
  source_file_id: number | null
  source_file: string | null
  /** Номер листа ВНУТРИ исходного файла: им размечается штриховка. */
  source_sheet_index: number
  style: { fill: string; pattern: string; stroke: string; text: string } | null
  length: number | null
  width: number | null
  thickness: number | null
  grain: string
  geometry: PartGeometryData | null
  vectors: Vector[]
}

export interface InstanceView {
  id: number
  part_id: number
  uid: string
  sheet_index: number | null
  x: number | null
  y: number | null
  rotation: number
  pinned: boolean
}

export interface SheetView {
  id: number
  index: number
  w: number
  h: number
  utilization: number | null
  is_offcut: boolean
  trim: { left: number; right: number; top: number; bottom: number }
}

export interface JobView {
  id: number
  name: string | null
  material_id: number
  material_name: string | null
  has_grain: boolean
  thickness: number
  status: string
  utilization: number | null
  params: Record<string, unknown> | null
  /** Пресет раскроя, которым посчитано задание. */
  preset: CuttingPresetCard | null
  /** Снимок параметров пресета: по нему задание повторяется точь-в-точь. */
  preset_snapshot: PresetSnapshot | null
  /** Кто взял лист в работу. Учётных записей нет — оператор называет себя. */
  operator: string | null
  /** planning | in_progress | finished */
  stage: string
  checklist: Array<{ key: string; title: string; done: boolean }>
}

/** Карточка пресета — то, что видно в панели задания. */
export interface CuttingPresetCard {
  id: number
  slug: string
  name: string
  thickness: number | null
  is_default: boolean
  is_builtin: boolean
  tool: string | null
  tool_diameter: number | null
  step_z: number | null
  strategy: string | null
  direction: string | null
  order: string[]
}

export interface PresetSnapshot {
  slug: string
  name: string
  placement: Record<string, number | string | boolean>
  depth: Record<string, number>
  strategy: Record<string, unknown>
  tools: Record<string, unknown>
  order: string[]
  safety: Record<string, unknown>
  post: Record<string, unknown>
  /** Параметры раскладки: рез, мостик, отступ от края. */
  layout: { kerf?: number; part_gap?: number; sheet_margin?: number; rotation_step?: number }
}

export interface Layout {
  job: JobView
  sheets: SheetView[]
  parts: Record<string, PartView>
  instances: InstanceView[]
  stock: { available: number; needed: number }
}

export interface Collision {
  kind: string
  instance_ids: number[]
  sheet_index: number
  message: string
}

export interface ToolpathPreset {
  id: number
  slug: string
  name: string
  semantic: string | null
  side: string
  tool_diameter: number | null
  tool_type: string | null
  depth: Record<string, unknown>
  step_down: number | null
  finish_pass: boolean
  direction: string
  lead: Record<string, unknown> | null
  tabs: string
  color: string
  is_builtin: boolean
}

/** Что сейчас выделено на холсте. */
export interface Selection {
  instances: number[]
  /** Ключ вектора: `${part_id}:${target}` — вектор принадлежит детали, а не экземпляру. */
  vectors: string[]
}

export const emptySelection: Selection = { instances: [], vectors: [] }

export const vectorKey = (partId: number, target: string) => `${partId}:${target}`
