// Конфигурация сайта, которая живет в адресе страницы: ползунки финмодели,
// правки строк оборудования и штата, свои строки и переопределенные константы.
// Чистые функции: кодирование в query-строку, разбор и наложение на данные по умолчанию.

import type { Condition, EquipmentRow, Phase, Scenario, Source } from '../data/equipment'
import type { TeamRow } from '../data/team'
import { financeConstants, financeDefaults, financeRanges, constantGroups, type ConstantKey, type Constants, type FinanceParams } from '../data/finance'

// ---------- Типы ----------

/** Правка базовой строки оборудования: какие поля можно менять на сайте */
export type EquipmentEdit = {
  enabled: boolean
  qty: number
  priceMin: number
  priceMax: number
  phase: Phase
  scenario: Scenario
}

/** Своя строка оборудования, добавленная на сайте */
export type CustomEquipment = EquipmentEdit & { name: string; source: Source; condition: Condition }

export type TeamEdit = { enabled: boolean; qty: number; salary: number; phase: Phase }
export type CustomTeam = TeamEdit & { role: string }

export type Config = {
  params: FinanceParams
  equipment: Record<string, EquipmentEdit> // по id базовой строки
  customEquipment: CustomEquipment[]
  team: Record<string, TeamEdit>
  customTeam: CustomTeam[]
  constants: Partial<Constants>
}

/** Строка с флагами для таблиц на сайте */
export type EffectiveEquipment = EquipmentRow & { enabled: boolean; custom: boolean; changed: boolean }
export type EffectiveTeam = TeamRow & { enabled: boolean; custom: boolean; changed: boolean }

export const emptyConfig = (): Config => ({
  params: { ...financeDefaults },
  equipment: {},
  customEquipment: [],
  team: {},
  customTeam: [],
  constants: {},
})

// ---------- Справочники ----------

export const PHASES: Phase[] = ['start', 'm6', 'm12']
export const SCENARIOS: Scenario[] = ['A', 'B']
export const SOURCES: Source[] = ['Россия б/у', 'Россия дилер', 'Китай']
export const CONDITIONS: Condition[] = ['новый', 'б/у']
export const CUSTOM_PREFIX = 'x'

const constantKeys = new Set<string>(Object.keys(financeConstants))
const constantFields = Object.fromEntries(constantGroups.flatMap((g) => g.fields.map((f) => [f.key, f])))

// ---------- Кодирование ----------

// Ключи в адресе
const paramKeys: Record<keyof FinanceParams, string> = {
  scenario: 'sc',
  areaM2: 'area',
  rentPerM2: 'rent',
  avgBudget: 'budget',
  anchorPerYear: 'anchor',
  externalPerYear: 'ext',
  marginPct: 'margin',
  monthsToFirstOrder: 'm0',
  reservePct: 'res',
  amdRate: 'amd',
}
const KEY_EQ = 'eq'
const KEY_EQX = 'eqx'
const KEY_TM = 'tm'
const KEY_TMX = 'tmx'
const KEY_C = 'c'

// Разделители: поля через «|», строки через «,». Свободный текст кодируется отдельно,
// поэтому «|» и «,» внутри названий не ломают разбор
const FIELD = '|'
const ROW = ','

const num = (v: number) => String(Math.round(v * 1000) / 1000)
const flag = (b: boolean) => (b ? '1' : '0')
// В свободном тексте экранируются только «%» и разделители: остальное URLSearchParams кодирует сам,
// а браузер показывает кириллицу в адресе как есть
const enc = (s: string) => s.replace(/%/g, '%25').replace(/\|/g, '%7C').replace(/,/g, '%2C')
const dec = (s: string) => s.replace(/%7C/gi, FIELD).replace(/%2C/gi, ROW).replace(/%25/g, '%')

const eqTuple = (e: EquipmentEdit) => [flag(e.enabled), num(e.qty), num(e.priceMin), num(e.priceMax), e.phase, e.scenario]
const tmTuple = (e: TeamEdit) => [flag(e.enabled), num(e.qty), num(e.salary), e.phase]

/** Серилизует конфигурацию в query-строку. Пусто, если все по умолчанию */
export function encodeConfig(cfg: Config): string {
  const q = new URLSearchParams()
  for (const key of Object.keys(paramKeys) as (keyof FinanceParams)[]) {
    if (cfg.params[key] !== financeDefaults[key]) q.set(paramKeys[key], String(cfg.params[key]))
  }
  const eq = Object.entries(cfg.equipment).map(([id, e]) => [id, ...eqTuple(e)].join(FIELD))
  if (eq.length) q.set(KEY_EQ, eq.join(ROW))
  const eqx = cfg.customEquipment.map((e) => [enc(e.name), ...eqTuple(e), enc(e.source), enc(e.condition)].join(FIELD))
  if (eqx.length) q.set(KEY_EQX, eqx.join(ROW))
  const tm = Object.entries(cfg.team).map(([id, e]) => [id, ...tmTuple(e)].join(FIELD))
  if (tm.length) q.set(KEY_TM, tm.join(ROW))
  const tmx = cfg.customTeam.map((e) => [enc(e.role), ...tmTuple(e)].join(FIELD))
  if (tmx.length) q.set(KEY_TMX, tmx.join(ROW))
  const c = Object.entries(cfg.constants)
    .filter(([k, v]) => v !== undefined && v !== financeConstants[k as ConstantKey])
    .map(([k, v]) => `${k}${FIELD}${num(v as number)}`)
  if (c.length) q.set(KEY_C, c.join(ROW))
  // Разделители оставляем читаемыми: браузеры принимают их в query как есть
  const s = q.toString().replace(/%7C/g, FIELD).replace(/%2C/g, ROW)
  return s ? `?${s}` : ''
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const toNum = (raw: string | undefined, fallback: number, min = 0, max = 10_000_000) => {
  const v = Number((raw ?? '').replace(',', '.'))
  return Number.isFinite(v) ? clamp(v, min, max) : fallback
}
const toPhase = (raw: string | undefined, fallback: Phase): Phase => (PHASES.includes(raw as Phase) ? (raw as Phase) : fallback)
const toScenario = (raw: string | undefined, fallback: Scenario): Scenario => (SCENARIOS.includes(raw as Scenario) ? (raw as Scenario) : fallback)

function parseEquipmentEdit(f: string[], base: EquipmentEdit): EquipmentEdit {
  return {
    enabled: f[0] === undefined ? base.enabled : f[0] !== '0',
    qty: toNum(f[1], base.qty, 0, 99),
    priceMin: toNum(f[2], base.priceMin),
    priceMax: toNum(f[3], base.priceMax),
    phase: toPhase(f[4], base.phase),
    scenario: toScenario(f[5], base.scenario),
  }
}

function parseTeamEdit(f: string[], base: TeamEdit): TeamEdit {
  return {
    enabled: f[0] === undefined ? base.enabled : f[0] !== '0',
    qty: toNum(f[1], base.qty, 0, 99),
    salary: toNum(f[2], base.salary, 0, 100_000),
    phase: toPhase(f[3], base.phase),
  }
}

export const baseEquipmentEdit = (r: EquipmentRow): EquipmentEdit => ({
  enabled: true,
  qty: r.qty,
  priceMin: r.priceMin,
  priceMax: r.priceMax,
  phase: r.phase,
  scenario: r.scenario,
})

export const baseTeamEdit = (r: TeamRow): TeamEdit => ({ enabled: true, qty: r.qty, salary: r.salary, phase: r.phase })

export const sameEquipmentEdit = (a: EquipmentEdit, b: EquipmentEdit) =>
  a.enabled === b.enabled && a.qty === b.qty && a.priceMin === b.priceMin && a.priceMax === b.priceMax && a.phase === b.phase && a.scenario === b.scenario

export const sameTeamEdit = (a: TeamEdit, b: TeamEdit) => a.enabled === b.enabled && a.qty === b.qty && a.salary === b.salary && a.phase === b.phase

/** Разбирает query-строку. Неизвестные ключи и битые значения игнорируются */
export function decodeConfig(search: string, baseEquipment: EquipmentRow[], baseTeam: TeamRow[]): Config {
  const q = new URLSearchParams(search)
  const cfg = emptyConfig()

  const sc = q.get(paramKeys.scenario)
  if (sc === 'A' || sc === 'B') cfg.params.scenario = sc
  for (const key of Object.keys(financeRanges) as (keyof typeof financeRanges)[]) {
    const raw = q.get(paramKeys[key])
    if (raw === null) continue
    const r = financeRanges[key]
    cfg.params[key] = toNum(raw, financeDefaults[key], r.min, r.max)
  }

  const rows = (key: string) => (q.get(key) ?? '').split(ROW).filter(Boolean)

  for (const row of rows(KEY_EQ)) {
    const [id, ...f] = row.split(FIELD)
    const base = baseEquipment.find((r) => r.id === id)
    if (!base) continue
    const edit = parseEquipmentEdit(f, baseEquipmentEdit(base))
    if (!sameEquipmentEdit(edit, baseEquipmentEdit(base))) cfg.equipment[id] = edit
  }
  for (const row of rows(KEY_EQX)) {
    const [name, ...f] = row.split(FIELD)
    const title = dec(name).trim()
    if (!title) continue
    const edit = parseEquipmentEdit(f, { enabled: true, qty: 1, priceMin: 0, priceMax: 0, phase: 'start', scenario: 'A' })
    const source = dec(f[6] ?? '')
    const condition = dec(f[7] ?? '')
    cfg.customEquipment.push({
      name: title,
      ...edit,
      source: SOURCES.includes(source as Source) ? (source as Source) : 'Россия дилер',
      condition: CONDITIONS.includes(condition as Condition) ? (condition as Condition) : 'новый',
    })
  }
  for (const row of rows(KEY_TM)) {
    const [id, ...f] = row.split(FIELD)
    const base = baseTeam.find((r) => r.id === id)
    if (!base) continue
    const edit = parseTeamEdit(f, baseTeamEdit(base))
    if (!sameTeamEdit(edit, baseTeamEdit(base))) cfg.team[id] = edit
  }
  for (const row of rows(KEY_TMX)) {
    const [role, ...f] = row.split(FIELD)
    const title = dec(role).trim()
    if (!title) continue
    cfg.customTeam.push({ role: title, ...parseTeamEdit(f, { enabled: true, qty: 1, salary: 0, phase: 'start' }) })
  }
  for (const row of rows(KEY_C)) {
    const [key, raw] = row.split(FIELD)
    if (!constantKeys.has(key)) continue
    const field = constantFields[key]
    const v = toNum(raw, financeConstants[key as ConstantKey], field?.min ?? 0, field?.max ?? 10_000_000)
    if (v !== financeConstants[key as ConstantKey]) cfg.constants[key as ConstantKey] = v
  }
  return cfg
}

// ---------- Наложение на данные ----------

export const customId = (i: number) => `${CUSTOM_PREFIX}${i}`
export const isCustomId = (id: string) => id.startsWith(CUSTOM_PREFIX) && /^\d+$/.test(id.slice(CUSTOM_PREFIX.length))

/** Базовые строки с правками плюс свои строки. Все строки, включая выключенные */
export function effectiveEquipment(base: EquipmentRow[], cfg: Config): EffectiveEquipment[] {
  const edited = base.map((r): EffectiveEquipment => {
    const e = cfg.equipment[r.id]
    return e ? { ...r, ...e, enabled: e.enabled, custom: false, changed: true } : { ...r, enabled: true, custom: false, changed: false }
  })
  const custom = cfg.customEquipment.map(
    (c, i): EffectiveEquipment => ({
      id: customId(i),
      name: c.name,
      qty: c.qty,
      priceMin: c.priceMin,
      priceMax: c.priceMax,
      source: c.source,
      condition: c.condition,
      scenario: c.scenario,
      phase: c.phase,
      comment: 'Добавлено на сайте',
      enabled: c.enabled,
      custom: true,
      changed: true,
    }),
  )
  return [...edited, ...custom]
}

export function effectiveTeam(base: TeamRow[], cfg: Config): EffectiveTeam[] {
  const edited = base.map((r): EffectiveTeam => {
    const e = cfg.team[r.id]
    return e ? { ...r, ...e, enabled: e.enabled, custom: false, changed: true } : { ...r, enabled: true, custom: false, changed: false }
  })
  const custom = cfg.customTeam.map(
    (c, i): EffectiveTeam => ({
      id: customId(i),
      role: c.role,
      qty: c.qty,
      salary: c.salary,
      phase: c.phase,
      when: '',
      where: '',
      note: 'Добавлено на сайте',
      enabled: c.enabled,
      custom: true,
      changed: true,
    }),
  )
  return [...edited, ...custom]
}

export function effectiveConstants(cfg: Config): Constants {
  return { ...financeConstants, ...cfg.constants }
}

/** Только включенные строки — то, что идет в модель */
export const activeRows = <T extends { enabled: boolean }>(rows: T[]): T[] => rows.filter((r) => r.enabled)

export const hasEquipmentEdits = (cfg: Config) => Object.keys(cfg.equipment).length > 0 || cfg.customEquipment.length > 0
export const hasTeamEdits = (cfg: Config) => Object.keys(cfg.team).length > 0 || cfg.customTeam.length > 0
export const hasConstantEdits = (cfg: Config) => Object.keys(cfg.constants).length > 0
