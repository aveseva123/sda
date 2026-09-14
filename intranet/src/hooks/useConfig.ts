// Вся конфигурация сайта в одном состоянии, синхронизированном с адресом страницы:
// ползунки финмодели, правки оборудования и штата, свои строки, константы.
// localStorage не используется намеренно: ссылка с параметрами — единственный носитель сценария.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { equipment as baseEquipment } from '../data/equipment'
import { team as baseTeam } from '../data/team'
import type { ConstantKey, Constants, FinanceParams } from '../data/finance'
import { financeConstants } from '../data/finance'
import {
  baseEquipmentEdit,
  baseTeamEdit,
  decodeConfig,
  effectiveConstants,
  effectiveEquipment,
  effectiveTeam,
  emptyConfig,
  encodeConfig,
  hasConstantEdits,
  hasEquipmentEdits,
  hasTeamEdits,
  isCustomId,
  sameEquipmentEdit,
  sameTeamEdit,
  CUSTOM_PREFIX,
  type Config,
  type CustomEquipment,
  type CustomTeam,
  type EffectiveEquipment,
  type EffectiveTeam,
} from '../model/config'

export type ConfigApi = {
  cfg: Config
  params: FinanceParams
  equipmentRows: EffectiveEquipment[]
  teamRows: EffectiveTeam[]
  constants: Constants
  isDefault: boolean
  equipmentEdited: boolean
  teamEdited: boolean
  constantsEdited: boolean
  setParam: <K extends keyof FinanceParams>(key: K, value: FinanceParams[K]) => void
  updateEquipment: (id: string, patch: Partial<CustomEquipment>) => void
  addEquipment: (row: CustomEquipment) => void
  removeEquipment: (id: string) => void
  resetEquipment: () => void
  updateTeam: (id: string, patch: Partial<CustomTeam>) => void
  addTeam: (row: CustomTeam) => void
  removeTeam: (id: string) => void
  resetTeam: () => void
  setConstant: (key: ConstantKey, value: number) => void
  resetConstants: () => void
  resetAll: () => void
}

const customIndex = (id: string) => Number(id.slice(CUSTOM_PREFIX.length))

export function useConfig(): ConfigApi {
  const [cfg, setCfg] = useState<Config>(() =>
    typeof window === 'undefined' ? emptyConfig() : decodeConfig(window.location.search, baseEquipment, baseTeam),
  )

  // Запись в адрес без перезагрузки и без новой записи в истории
  useEffect(() => {
    const next = encodeConfig(cfg)
    if (next === window.location.search) return
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${next}${window.location.hash}`)
    } catch {
      /* в песочнице превью адрес менять нельзя, состояние живет в памяти */
    }
  }, [cfg])

  // Кнопки «назад/вперед» и ручная правка адреса
  useEffect(() => {
    const onPop = () => setCfg(decodeConfig(window.location.search, baseEquipment, baseTeam))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setParam = useCallback(<K extends keyof FinanceParams>(key: K, value: FinanceParams[K]) => {
    setCfg((c) => (c.params[key] === value ? c : { ...c, params: { ...c.params, [key]: value } }))
  }, [])

  const updateEquipment = useCallback((id: string, patch: Partial<CustomEquipment>) => {
    setCfg((c) => {
      if (isCustomId(id)) {
        const i = customIndex(id)
        if (!c.customEquipment[i]) return c
        return { ...c, customEquipment: c.customEquipment.map((r, j) => (j === i ? { ...r, ...patch } : r)) }
      }
      const base = baseEquipment.find((r) => r.id === id)
      if (!base) return c
      const original = baseEquipmentEdit(base)
      const current = c.equipment[id] ?? original
      const { enabled, qty, priceMin, priceMax, phase, scenario } = { ...current, ...patch }
      const edit = { enabled, qty, priceMin, priceMax, phase, scenario }
      const equipment = { ...c.equipment }
      if (sameEquipmentEdit(edit, original)) delete equipment[id]
      else equipment[id] = edit
      return { ...c, equipment }
    })
  }, [])

  const addEquipment = useCallback((row: CustomEquipment) => {
    setCfg((c) => ({ ...c, customEquipment: [...c.customEquipment, row] }))
  }, [])

  const removeEquipment = useCallback((id: string) => {
    if (!isCustomId(id)) return
    setCfg((c) => ({ ...c, customEquipment: c.customEquipment.filter((_, j) => j !== customIndex(id)) }))
  }, [])

  const resetEquipment = useCallback(() => setCfg((c) => ({ ...c, equipment: {}, customEquipment: [] })), [])

  const updateTeam = useCallback((id: string, patch: Partial<CustomTeam>) => {
    setCfg((c) => {
      if (isCustomId(id)) {
        const i = customIndex(id)
        if (!c.customTeam[i]) return c
        return { ...c, customTeam: c.customTeam.map((r, j) => (j === i ? { ...r, ...patch } : r)) }
      }
      const base = baseTeam.find((r) => r.id === id)
      if (!base) return c
      const original = baseTeamEdit(base)
      const current = c.team[id] ?? original
      const { enabled, qty, salary, phase } = { ...current, ...patch }
      const edit = { enabled, qty, salary, phase }
      const team = { ...c.team }
      if (sameTeamEdit(edit, original)) delete team[id]
      else team[id] = edit
      return { ...c, team }
    })
  }, [])

  const addTeam = useCallback((row: CustomTeam) => {
    setCfg((c) => ({ ...c, customTeam: [...c.customTeam, row] }))
  }, [])

  const removeTeam = useCallback((id: string) => {
    if (!isCustomId(id)) return
    setCfg((c) => ({ ...c, customTeam: c.customTeam.filter((_, j) => j !== customIndex(id)) }))
  }, [])

  const resetTeam = useCallback(() => setCfg((c) => ({ ...c, team: {}, customTeam: [] })), [])

  const setConstant = useCallback((key: ConstantKey, value: number) => {
    setCfg((c) => {
      const constants = { ...c.constants }
      if (value === financeConstants[key]) delete constants[key]
      else constants[key] = value
      return { ...c, constants }
    })
  }, [])

  const resetConstants = useCallback(() => setCfg((c) => ({ ...c, constants: {} })), [])
  const resetAll = useCallback(() => setCfg(emptyConfig()), [])

  const equipmentRows = useMemo(() => effectiveEquipment(baseEquipment, cfg), [cfg])
  const teamRows = useMemo(() => effectiveTeam(baseTeam, cfg), [cfg])
  const constants = useMemo(() => effectiveConstants(cfg), [cfg])
  const isDefault = useMemo(() => encodeConfig(cfg) === '', [cfg])

  return {
    cfg,
    params: cfg.params,
    equipmentRows,
    teamRows,
    constants,
    isDefault,
    equipmentEdited: hasEquipmentEdits(cfg),
    teamEdited: hasTeamEdits(cfg),
    constantsEdited: hasConstantEdits(cfg),
    setParam,
    updateEquipment,
    addEquipment,
    removeEquipment,
    resetEquipment,
    updateTeam,
    addTeam,
    removeTeam,
    resetTeam,
    setConstant,
    resetConstants,
    resetAll,
  }
}
