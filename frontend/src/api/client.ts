import { IS_DEMO, demoRequest } from './demo'
import type { Collision, Layout, PresetSnapshot, ToolpathPreset } from '../editor/types'
import type {
  AppConfig,
  CuttingPreset,
  DetectedSheet,
  FileDecision,
  IntakeResult,
  ToolLibrary,
  ImportBatch,
  LayerPreset,
  LayerSummary,
  Material,
  OffcutVerdict,
  Order,
  Part,
  PartGeometry,
  SheetFormat,
  SourceFile,
  StockItem,
  StockMovement,
  StockSummaryRow,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Демо-сборка отвечает снимком настоящих данных: сервера рядом нет.
  if (IS_DEMO) return demoRequest<T>(path, init)
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* тело не JSON — оставляем текст статуса */
    }
    throw new Error(detail)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  config: () => request<AppConfig>('/config'),

  // Заказ — просто имя; настоящая единица принадлежности — файл.
  files: (jobId?: number) =>
    request<SourceFile[]>(jobId ? `/files?job=${jobId}` : '/files'),
  updateFile: (id: number, payload: { order_name?: string | null; color_index?: number }) =>
    request<SourceFile>(`/files/${id}`, json('PATCH', payload)),
  orders: () => request<Order[]>('/orders'),
  palette: () =>
    request<{ files: string[]; sheet_patterns: string[]; note: string }>('/palette'),

  materials: () => request<Material[]>('/materials'),
  createMaterial: (payload: Partial<Material> & { name: string; thickness: number }) =>
    request<Material>('/materials', json('POST', payload)),
  updateMaterial: (id: number, payload: Record<string, unknown>) =>
    request<Material>(`/materials/${id}`, json('PUT', payload)),
  deleteMaterial: (id: number) => request<void>(`/materials/${id}`, { method: 'DELETE' }),
  sheetFormats: (materialId: number) =>
    request<SheetFormat[]>(`/materials/${materialId}/formats`),
  addSheetFormat: (materialId: number, payload: { w: number; h: number; price?: number | null }) =>
    request<SheetFormat>(`/materials/${materialId}/formats`, json('POST', payload)),
  deleteSheetFormat: (materialId: number, formatId: number) =>
    request<void>(`/materials/${materialId}/formats/${formatId}`, { method: 'DELETE' }),

  parts: (params: Record<string, string | number | undefined> = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    const suffix = query.toString() ? `?${query}` : ''
    return request<Part[]>(`/parts${suffix}`)
  },
  pendingParts: () => request<Part[]>('/parts/pending'),
  partGeometry: (id: number) => request<PartGeometry>(`/parts/${id}/geometry`),
  updatePart: (id: number, payload: Record<string, unknown>) =>
    request<Part>(`/parts/${id}`, json('PATCH', payload)),
  bulkAssign: (payload: {
    part_ids: number[]
    thickness?: number
    material_id?: number
    order_name?: string
  }) =>
    request<{ updated: number; resolved: number; still_pending: number }>(
      '/parts/bulk-assign',
      json('POST', payload),
    ),

  imports: () => request<ImportBatch[]>('/imports'),
  importBatch: (id: number) => request<ImportBatch>(`/imports/${id}`),
  upload: (files: File[], name: string | null) => {
    const form = new FormData()
    for (const file of files) {
      form.append('files', file)
      // Путь внутри перетащенной папки — из него берётся имя папки
      // для определения толщины.
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      form.append('relpaths', relative && relative.length > 0 ? relative : file.name)
    }
    if (name) form.append('name', name)
    return request<ImportBatch>('/imports', { method: 'POST', body: form })
  },
  layers: (batchId: number) => request<LayerSummary>(`/imports/${batchId}/layers`),
  layerPreview: (batchId: number, layer: string) =>
    request<{ file: string; layer: string; paths: number[][][] }>(
      `/imports/${batchId}/layers/${encodeURIComponent(layer)}/preview`,
    ),
  processBatch: (batchId: number, payload: Record<string, unknown>) =>
    request<ImportBatch>(`/imports/${batchId}/process`, json('POST', payload)),

  detectedSheets: (batchId: number) =>
    request<DetectedSheet[]>(`/imports/${batchId}/sheets`),

  stock: (params: { material_id?: number; kind?: string; include_used?: boolean } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    const suffix = query.toString() ? `?${query}` : ''
    return request<StockItem[]>(`/stock${suffix}`)
  },
  stockSummary: () => request<StockSummaryRow[]>('/stock/summary'),
  judgeOffcut: (w: number, h: number) =>
    request<OffcutVerdict>(`/stock/judge-offcut?w=${w}&h=${h}`),
  stockReceive: (payload: {
    material_id: number
    w: number
    h: number
    qty: number
    kind?: string
    location?: string | null
    note?: string | null
  }) => request<StockItem>('/stock', json('POST', payload)),
  stockConsume: (
    itemId: number,
    payload: {
      qty: number
      offcuts: Array<{ w: number; h: number; note?: string | null }>
      reason?: string | null
      actor?: string | null
    },
  ) =>
    request<{ item: StockItem; offcuts: StockItem[] }>(
      `/stock/${itemId}/consume`,
      json('POST', payload),
    ),
  stockScrap: (itemId: number, payload: { qty: number; reason?: string | null }) =>
    request<StockItem>(`/stock/${itemId}/scrap`, json('POST', payload)),
  stockAdjust: (itemId: number, payload: { new_qty: number; reason?: string | null }) =>
    request<StockItem>(`/stock/${itemId}/adjust`, json('POST', payload)),
  stockMovements: (itemId: number) =>
    request<StockMovement[]>(`/stock/${itemId}/movements`),

  // ---- раскрой и редактор ----
  nestingJobs: () => request<Array<{ id: number; name: string | null; thickness: number; material_id: number; utilization: number | null }>>('/nesting/jobs'),
  createNestingJob: (payload: {
    material_id: number
    thickness: number
    name?: string | null
    sheet_w?: number | null
    sheet_h?: number | null
    preset_id?: number | null
    operator?: string | null
    auto_arrange?: boolean
  }) => request<{ id: number }>('/nesting/jobs', json('POST', payload)),

  // ---- добавление файлов в раскрой ----
  addFiles: (jobId: number, files: File[]) => {
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    return request<IntakeResult>(`/nesting/jobs/${jobId}/files`, {
      method: 'POST',
      body: form,
    })
  },
  confirmFiles: (
    jobId: number,
    batchId: number,
    files: FileDecision[],
    placement?: Record<string, unknown>,
  ) =>
    request<{ added: number; warnings: string[]; layout?: Record<string, unknown> }>(
      `/nesting/jobs/${jobId}/files/confirm`,
      json('POST', { batch_id: batchId, files, placement }),
    ),

  // ---- работа с листом ----
  takeJob: (jobId: number, operator: string) =>
    request<{ stage: string; operator: string }>(
      `/nesting/jobs/${jobId}/take`,
      json('POST', { operator }),
    ),
  setChecklist: (jobId: number, items: Record<string, boolean>) =>
    request<{ checklist: Array<{ key: string; title: string; done: boolean }> }>(
      `/nesting/jobs/${jobId}/checklist`,
      json('PUT', { items }),
    ),
  finishJob: (jobId: number) =>
    request<{ stage: string }>(`/nesting/jobs/${jobId}/finish`, json('POST', {})),

  updateCuttingPreset: (presetId: number, payload: Record<string, unknown>) =>
    request<CuttingPreset>(`/cutting-presets/${presetId}`, json('PUT', payload)),
  createCuttingPreset: (payload: Record<string, unknown>) =>
    request<CuttingPreset>('/cutting-presets', json('POST', payload)),
  deleteCuttingPreset: (presetId: number) =>
    request<void>(`/cutting-presets/${presetId}`, { method: 'DELETE' }),

  // ---- библиотека фрез ----
  tools: () => request<ToolLibrary>('/tools'),
  updateTool: (toolId: number, payload: Record<string, unknown>) =>
    request<unknown>(`/tools/${toolId}`, json('PUT', payload)),
  setToolResource: (toolId: number, used: number, limit?: number | null) =>
    request<unknown>(`/tools/${toolId}/resource`, json('POST', { used, limit })),
  layout: (jobId: number) => request<Layout>(`/nesting/jobs/${jobId}/layout`),
  arrange: (jobId: number, keepPinned = true) =>
    request<{ sheets: number; placed: number; unplaced: number; utilization: number; warnings: string[] }>(
      `/nesting/jobs/${jobId}/arrange?keep_pinned=${keepPinned}`,
      json('POST', {}),
    ),
  moveInstances: (
    jobId: number,
    moves: Array<{
      instance_id: number
      sheet_index?: number | null
      x?: number | null
      y?: number | null
      rotation?: number | null
      pinned?: boolean
    }>,
  ) => request<{ updated: number; utilization: number }>(`/nesting/jobs/${jobId}/move`, json('POST', { moves })),
  collisions: (jobId: number) => request<Collision[]>(`/nesting/jobs/${jobId}/collisions`),
  deleteNestingJob: (jobId: number) =>
    request<void>(`/nesting/jobs/${jobId}`, { method: 'DELETE' }),

  // ---- пресеты раскроя ----
  cuttingPresets: () => request<CuttingPreset[]>('/cutting-presets'),
  matchCuttingPreset: (materialId: number, thickness: number) =>
    request<CuttingPreset | null>(
      `/cutting-presets/match?material_id=${materialId}&thickness=${thickness}`,
    ),
  setJobPreset: (jobId: number, presetId: number | null, rearrange = true) =>
    request<{ preset: PresetSnapshot | null; layout: Record<string, unknown> }>(
      `/nesting/jobs/${jobId}/preset`,
      json('PUT', { preset_id: presetId, rearrange }),
    ),

  toolpathPresets: () => request<ToolpathPreset[]>('/toolpath-presets'),
  assignToolpath: (
    partId: number,
    payload: { targets: string[]; preset_id: number; enabled?: boolean },
  ) => request<unknown>(`/parts/${partId}/toolpaths`, json('POST', payload)),
  autoAssignToolpaths: (partId: number) =>
    request<{ assigned: number }>(`/parts/${partId}/toolpaths/auto`, json('POST', {})),

  presets: () => request<LayerPreset[]>('/layer-presets'),
  savePreset: (payload: {
    name: string
    source: string
    rules: Array<{ layer?: string; regex?: string; semantic: string }>
    thickness_from_layer_regex?: string | null
  }) => request<LayerPreset>('/layer-presets', json('POST', payload)),
}
