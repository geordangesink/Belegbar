import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTariffOverrides,
  evaluateTariff,
  getRegisteredOverrideYears,
  getTariffOverride,
  registerTariffOverride,
  tariffParamsEqual,
  validateTariffParams,
  type Section32aParams
} from './tariff-override'
import { getBuiltInTariffParams, getIncomeTaxEngine } from './income-tax'

function params2026(): Section32aParams {
  return getBuiltInTariffParams(2026)!
}

afterEach(() => clearTariffOverrides())

describe('validateTariffParams', () => {
  it('accepts all built-in parameter sets', () => {
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      expect(validateTariffParams(getBuiltInTariffParams(year)!)).toEqual([])
    }
  })

  it('rejects a basic allowance outside [10000, 25000]', () => {
    expect(validateTariffParams({ ...params2026(), basicAllowance: 9999 })).toContain(
      'basic_allowance_out_of_range'
    )
    expect(validateTariffParams({ ...params2026(), basicAllowance: 25001 })).toContain(
      'basic_allowance_out_of_range'
    )
  })

  it('rejects non-ascending zone boundaries', () => {
    expect(validateTariffParams({ ...params2026(), zone3End: 17000 })).toContain(
      'boundaries_not_ascending'
    )
  })

  it('rejects a tariff that is discontinuous at a zone boundary', () => {
    const p = params2026()
    // shifting the zone-3 constant by 10 € breaks continuity at zone2End
    const discontinuous = { ...p, zone3: { ...p.zone3, c: p.zone3.c + 10 } }
    expect(validateTariffParams(discontinuous)).toContain('discontinuous_at_zone2_end')
  })

  it('rejects implausible marginal rates', () => {
    const p = params2026()
    expect(
      validateTariffParams({ ...p, zone4: { ...p.zone4, rate: 0.3 } })
    ).toContain('zone4_rate_not_near_42_percent')
    expect(
      validateTariffParams({ ...p, zone2: { ...p.zone2, b: 500 } })
    ).toContain('entry_rate_not_near_14_percent')
    expect(
      validateTariffParams({ ...p, zone5: { ...p.zone5, rate: 0.41 } }).length
    ).toBeGreaterThan(0)
  })

  it('rejects non-finite parameters', () => {
    const p = params2026()
    expect(
      validateTariffParams({ ...p, zone3: { ...p.zone3, a: Number.NaN } })
    ).toEqual(['non_finite_parameter'])
  })

  it('rejects a garbled quadratic factor via continuity', () => {
    const p = params2026()
    // decimal comma lost: 914,51 read as 91451 — must not survive validation
    const garbled = { ...p, zone2: { ...p.zone2, a: 91451 } }
    expect(validateTariffParams(garbled).length).toBeGreaterThan(0)
  })
})

describe('registerTariffOverride', () => {
  it('rejects invalid params with a throw', () => {
    const p = params2026()
    expect(() =>
      registerTariffOverride(2026, { ...p, basicAllowance: 5000 }, 'gii-20260715')
    ).toThrow(/tariff_override_rejected/)
    expect(getTariffOverride(2026)).toBeUndefined()
  })

  it('rejects bad years and labels', () => {
    expect(() => registerTariffOverride(1980, params2026(), 'gii-x')).toThrow()
    expect(() => registerTariffOverride(2026.5, params2026(), 'gii-x')).toThrow()
    expect(() => registerTariffOverride(2026, params2026(), '')).toThrow()
    expect(() => registerTariffOverride(2026, params2026(), 'bad label!')).toThrow()
  })

  it('stores an immutable copy retrievable via getTariffOverride', () => {
    const p = params2026()
    registerTariffOverride(2026, p, 'gii-20260715')
    p.basicAllowance = 1 // caller mutation must not leak into the registry
    const stored = getTariffOverride(2026)
    expect(stored?.sourceLabel).toBe('gii-20260715')
    expect(stored?.params.basicAllowance).toBe(12348)
    expect(getRegisteredOverrideYears()).toEqual([2026])
  })

  it('clearTariffOverrides removes everything', () => {
    registerTariffOverride(2026, params2026(), 'gii-20260715')
    clearTariffOverrides()
    expect(getTariffOverride(2026)).toBeUndefined()
    expect(getRegisteredOverrideYears()).toEqual([])
  })
})

describe('engine integration (precedence + version labeling)', () => {
  it('prefers a registered override and appends the source label', () => {
    registerTariffOverride(2026, params2026(), 'gii-20260715')
    const { engine, exactYearMatch } = getIncomeTaxEngine(2026)
    expect(exactYearMatch).toBe(true)
    expect(engine.version).toBe('2026.1+gii-20260715')
    // identical params → identical tax
    expect(
      engine.calculate({
        year: 2026,
        taxableIncome: 50000,
        assessmentType: 'single',
        churchTax: 'none',
        includeSolidaritySurcharge: true
      }).incomeTax
    ).toBe(10548)
  })

  it('override params actually drive the calculation', () => {
    const p = params2026()
    // +1.50 € on the zone-3 constant stays within the 2 € continuity
    // tolerance but must shift the tax by 1 € (after flooring)
    const shifted = { ...p, zone3: { ...p.zone3, c: p.zone3.c + 1.5 } }
    expect(validateTariffParams(shifted)).toEqual([])
    registerTariffOverride(2026, shifted, 'gii-test')
    const { engine } = getIncomeTaxEngine(2026)
    expect(
      engine.calculate({
        year: 2026,
        taxableIncome: 30000,
        assessmentType: 'single',
        churchTax: 'none',
        includeSolidaritySurcharge: true
      }).incomeTax
    ).toBe(4218) // built-in engine yields 4217
  })

  it('a year without built-in engine gets a <year>.0 base version', () => {
    registerTariffOverride(2027, params2026(), 'gii-20270102')
    const exact = getIncomeTaxEngine(2027)
    expect(exact.exactYearMatch).toBe(true)
    expect(exact.engine.year).toBe(2027)
    expect(exact.engine.version).toBe(
      '2027.0+gii-20270102+solzg-fallback-2026'
    )
  })

  it('later years fall back to the closest earlier override', () => {
    registerTariffOverride(2027, params2026(), 'gii-20270102')
    const fallback = getIncomeTaxEngine(2028)
    expect(fallback.exactYearMatch).toBe(false)
    expect(fallback.engine.year).toBe(2027)
    expect(fallback.engine.version).toBe(
      '2027.0+gii-20270102+solzg-fallback-2026'
    )
  })

  it('clearing overrides restores the built-in engines', () => {
    registerTariffOverride(2026, params2026(), 'gii-20260715')
    clearTariffOverrides()
    expect(getIncomeTaxEngine(2026).engine.version).toBe('2026.1')
    expect(getIncomeTaxEngine(2027).exactYearMatch).toBe(false)
    expect(getIncomeTaxEngine(2027).engine.year).toBe(2026)
  })
})

describe('evaluateTariff / tariffParamsEqual helpers', () => {
  it('evaluates the 2026 tariff exactly like the published values', () => {
    const p = params2026()
    expect(Math.floor(evaluateTariff(p, 30000))).toBe(4217)
    expect(Math.floor(evaluateTariff(p, 100000))).toBe(30864)
    expect(evaluateTariff(p, p.basicAllowance)).toBe(0)
  })

  it('compares parameter sets structurally', () => {
    expect(tariffParamsEqual(params2026(), params2026())).toBe(true)
    const changed = params2026()
    changed.zone4.sub += 0.01
    expect(tariffParamsEqual(params2026(), changed)).toBe(false)
  })
})
