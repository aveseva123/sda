import type {
  AppConfig,
  DetectedSheet,
  ImportBatch,
  LayerPreset,
  LayerSummary,
  Material,
  OffcutVerdict,
  Part,
  PartGeometry,
  Project,
  SheetFormat,
  StockItem,
  StockMovement,
  StockSummaryRow,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  projects: () => request<Project[]>('/projects'),
  createProject: (payload: { name: string; client?: string | null }) =>
    request<Project>('/projects', json('POST', payload)),
  deleteProject: (id: number) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  materials: () => request<Material[]>('/materials'),
  createMaterial: (payload: Partial<Material> & { name: string; thickness: number }) =>
    request<Material>('/materials', json('POST', payload)),
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
    product_id?: number
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

  presets: () => request<LayerPreset[]>('/layer-presets'),
  savePreset: (payload: {
    name: string
    source: string
    rules: Array<{ layer?: string; regex?: string; semantic: string }>
    thickness_from_layer_regex?: string | null
  }) => request<LayerPreset>('/layer-presets', json('POST', payload)),
}
