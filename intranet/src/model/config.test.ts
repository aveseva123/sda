import { describe, expect, it } from 'vitest'
import {
  activeRows,
  baseEquipmentEdit,
  decodeConfig,
  effectiveConstants,
  effectiveEquipment,
  effectiveTeam,
  emptyConfig,
  encodeConfig,
  sameEquipmentEdit,
  type Config,
} from './config'
import { equipment } from '../data/equipment'
import { team } from '../data/team'
import { financeConstants, financeDefaults } from '../data/finance'

const roundTrip = (cfg: Config) => decodeConfig(encodeConfig(cfg), equipment, team)

describe('кодирование конфигурации', () => {
  it('конфигурация по умолчанию дает пустой адрес', () => {
    expect(encodeConfig(emptyConfig())).toBe('')
  })

  it('ползунки кодируются короткими ключами и разбираются обратно', () => {
    const cfg = emptyConfig()
    cfg.params = { ...financeDefaults, scenario: 'B', areaM2: 500, rentPerM2: 6.25, avgBudget: 40000 }
    const s = encodeConfig(cfg)
    expect(s).toBe('?sc=B&area=500&rent=6.25&budget=40000')
    expect(roundTrip(cfg).params).toEqual(cfg.params)
  })

  it('значения ползунков вне диапазона подрезаются', () => {
    const cfg = decodeConfig('?area=5000&margin=-10', equipment, team)
    expect(cfg.params.areaM2).toBe(800)
    expect(cfg.params.marginPct).toBe(20)
  })

  it('правки базовых строк оборудования: выключение, количество, цена, фаза, сценарий', () => {
    const cfg = emptyConfig()
    cfg.equipment['cnc-1'] = { enabled: true, qty: 2, priceMin: 15000, priceMax: 20000, phase: 'start', scenario: 'A' }
    cfg.equipment['laser'] = { enabled: false, qty: 1, priceMin: 35000, priceMax: 60000, phase: 'm6', scenario: 'B' }
    const s = encodeConfig(cfg)
    expect(s).toContain('eq=cnc-1|1|2|15000|20000|start|A,laser|0|1|35000|60000|m6|B')
    expect(roundTrip(cfg).equipment).toEqual(cfg.equipment)
  })

  it('правка, равная исходной строке, при разборе отбрасывается', () => {
    const base = equipment[0]
    const cfg = decodeConfig(`?eq=${base.id}|1|${base.qty}|${base.priceMin}|${base.priceMax}|${base.phase}|${base.scenario}`, equipment, team)
    expect(cfg.equipment).toEqual({})
    expect(sameEquipmentEdit(baseEquipmentEdit(base), baseEquipmentEdit(base))).toBe(true)
  })

  it('неизвестные строки и битые значения игнорируются', () => {
    const cfg = decodeConfig('?eq=nope|0|1|1|1|start|A,cnc-1|1|abc|x|y|later|Z&tm=ghost|0|1|1|start&c=unknown|5,payrollTaxPct|abc', equipment, team)
    expect(cfg.equipment).toEqual({})
    expect(cfg.team).toEqual({})
    expect(cfg.constants).toEqual({})
  })

  it('свои строки с кириллицей и разделителями в названии переживают кодирование', () => {
    const cfg = emptyConfig()
    cfg.customEquipment.push({ name: 'Пресс | вакуумный, 2 стола', enabled: true, qty: 1, priceMin: 4000, priceMax: 7000, phase: 'm6', scenario: 'B', source: 'Китай', condition: 'новый' })
    cfg.customTeam.push({ role: 'Кладовщик, ночная смена', enabled: false, qty: 2, salary: 550, phase: 'm12' })
    const back = roundTrip(cfg)
    expect(back.customEquipment).toEqual(cfg.customEquipment)
    expect(back.customTeam).toEqual(cfg.customTeam)
  })

  it('константы: только отличающиеся от умолчания, с подрезкой к диапазону', () => {
    const cfg = emptyConfig()
    cfg.constants = { payrollTaxPct: 20, electricityPerMonth: financeConstants.electricityPerMonth }
    expect(encodeConfig(cfg)).toBe('?c=payrollTaxPct|20')
    expect(roundTrip(cfg).constants).toEqual({ payrollTaxPct: 20 })
    expect(decodeConfig('?c=optimisticLoadPct|900', equipment, team).constants.optimisticLoadPct).toBe(300)
  })

  it('адрес остается совместимым с браузерным кодированием разделителей', () => {
    const cfg = emptyConfig()
    cfg.team['cnc'] = { enabled: true, qty: 2, salary: 950, phase: 'start' }
    const s = encodeConfig(cfg)
    const encoded = s.replace(/\|/g, '%7C').replace(/,/g, '%2C')
    expect(decodeConfig(encoded, equipment, team).team).toEqual(cfg.team)
  })
})

describe('наложение конфигурации на данные', () => {
  it('без правок строки помечены как исходные и включенные', () => {
    const rows = effectiveEquipment(equipment, emptyConfig())
    expect(rows).toHaveLength(equipment.length)
    expect(rows.every((r) => r.enabled && !r.custom && !r.changed)).toBe(true)
  })

  it('правки применяются, свои строки получают идентификаторы x0, x1', () => {
    const cfg = emptyConfig()
    cfg.equipment['saw'] = { enabled: false, qty: 1, priceMin: 6000, priceMax: 10000, phase: 'start', scenario: 'A' }
    cfg.customEquipment.push({ name: 'Вакуумный пресс', enabled: true, qty: 1, priceMin: 4000, priceMax: 7000, phase: 'start', scenario: 'A', source: 'Китай', condition: 'новый' })
    const rows = effectiveEquipment(equipment, cfg)
    const saw = rows.find((r) => r.id === 'saw')!
    expect(saw.enabled).toBe(false)
    expect(saw.changed).toBe(true)
    const custom = rows[rows.length - 1]
    expect(custom.id).toBe('x0')
    expect(custom.custom).toBe(true)
    expect(activeRows(rows)).toHaveLength(equipment.length)
  })

  it('штат: измененная фаза переносит роль, выключенная роль не идет в расчет', () => {
    const cfg = emptyConfig()
    cfg.team['pm'] = { enabled: true, qty: 1, salary: 1000, phase: 'start' }
    cfg.team['weld'] = { enabled: false, qty: 1, salary: 900, phase: 'm6' }
    const rows = effectiveTeam(team, cfg)
    expect(rows.find((r) => r.id === 'pm')!.phase).toBe('start')
    expect(activeRows(rows).find((r) => r.id === 'weld')).toBeUndefined()
  })

  it('константы: переопределения поверх умолчаний', () => {
    const cfg = emptyConfig()
    cfg.constants = { payrollTaxPct: 20 }
    const c = effectiveConstants(cfg)
    expect(c.payrollTaxPct).toBe(20)
    expect(c.electricityPerMonth).toBe(financeConstants.electricityPerMonth)
  })
})
