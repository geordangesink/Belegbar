import { describe, expect, it } from 'vitest'
import {
  getBuiltInSoliRules,
  getBuiltInTariffParams,
  getIncomeTaxEngine,
  listSupportedTaxYears,
  type IncomeTaxEngineInput
} from './income-tax'

function calc(overrides: Partial<IncomeTaxEngineInput> & { year: number }) {
  const { engine } = getIncomeTaxEngine(overrides.year)
  return engine.calculate({
    taxableIncome: 0,
    assessmentType: 'single',
    churchTax: 'none',
    includeSolidaritySurcharge: true,
    ...overrides
  })
}

describe('bundled official tariff history', () => {
  it.each([
    [2022, 10347, 14926, 58596, 9336.45, 17671.2, 16956],
    [2023, 10908, 15999, 62809, 9972.98, 18307.73, 17543],
    [2024, 11784, 17005, 66760, 10636.31, 18971.06, 18130]
  ])(
    '%i carries the official §32a boundaries and Soli Freigrenze',
    (year, basicAllowance, zone2End, zone3End, zone4Sub, zone5Sub, soliThreshold) => {
      expect(getBuiltInTariffParams(year)).toMatchObject({
        basicAllowance,
        zone2End,
        zone3End,
        zone4: { rate: 0.42, sub: zone4Sub },
        zone5: { rate: 0.45, sub: zone5Sub }
      })
      expect(getBuiltInSoliRules(year)).toEqual({
        thresholdSingle: soliThreshold,
        thresholdJoint: soliThreshold * 2,
        rate: 0.055,
        mitigationRate: 0.119,
        centRounding: 'down'
      })
    }
  )

  it.each([
    [2022, 30000, 4951],
    [2022, 100000, 32663],
    [2023, 30000, 4700],
    [2023, 100000, 32027],
    [2024, 30000, 4412],
    [2024, 100000, 31363]
  ])('%i, zvE %i € → %i €', (year, taxableIncome, expected) => {
    expect(calc({ year, taxableIncome }).incomeTax).toBe(expected)
  })
})

describe('§ 32a EStG tariff 2025', () => {
  // Reference values cross-checked against the published Grundtabelle 2025
  // (finanz-tools.de / grundtabelle.de) and the § 32a EStG (2025) formula.
  it.each([
    [12096, 0],
    [12097, 0],
    [17443, 1015],
    [30000, 4303],
    [50000, 10691],
    [68480, 17849],
    [68481, 17850],
    [100000, 31088],
    [300000, 115753]
  ])('single, zvE %i € → %i €', (zvE, expected) => {
    expect(calc({ year: 2025, taxableIncome: zvE }).incomeTax).toBe(expected)
  })

  it('floors the taxable income to a full euro', () => {
    expect(calc({ year: 2025, taxableIncome: 30000.99 }).incomeTax).toBe(4303)
  })

  it('returns zero for zero and negative income', () => {
    expect(calc({ year: 2025, taxableIncome: 0 }).incomeTax).toBe(0)
    expect(calc({ year: 2025, taxableIncome: -5000 }).incomeTax).toBe(0)
  })

  it('applies the splitting method for joint assessment', () => {
    // Splittingtabelle 2025: 100 000 € → 2 × tax(50 000 €) = 21 382 €
    expect(
      calc({ year: 2025, taxableIncome: 100000, assessmentType: 'joint' }).incomeTax
    ).toBe(21382)
    expect(
      calc({ year: 2025, taxableIncome: 60000, assessmentType: 'joint' }).incomeTax
    ).toBe(8606)
    // twice the Grundfreibetrag stays tax-free
    expect(
      calc({ year: 2025, taxableIncome: 24192, assessmentType: 'joint' }).incomeTax
    ).toBe(0)
  })
})

describe('§ 32a EStG tariff 2026 (Steuerfortentwicklungsgesetz)', () => {
  // Reference values cross-checked against the published Grundtabelle /
  // Splittingtabelle 2026 (lohn-info.de).
  it.each([
    [12348, 0],
    [17799, 1034],
    [20000, 1570],
    [30000, 4217],
    [40000, 7209],
    [50000, 10548],
    [100000, 30864],
    [300000, 115529]
  ])('single, zvE %i € → %i €', (zvE, expected) => {
    expect(calc({ year: 2026, taxableIncome: zvE }).incomeTax).toBe(expected)
  })

  it('joint assessment 2026', () => {
    expect(
      calc({ year: 2026, taxableIncome: 40000, assessmentType: 'joint' }).incomeTax
    ).toBe(3140)
    expect(
      calc({ year: 2026, taxableIncome: 100000, assessmentType: 'joint' }).incomeTax
    ).toBe(21096)
  })
})

describe('solidarity surcharge', () => {
  it('2025: no soli at or below the Freigrenze of 19 950 €', () => {
    // zvE 68 000 € → tax 17 648 € < 19 950 €
    const result = calc({ year: 2025, taxableIncome: 68000 })
    expect(result.incomeTax).toBe(17648)
    expect(result.solidaritySurcharge).toBe(0)
  })

  it('2025: mitigation zone caps soli at 11,9 % above the Freigrenze', () => {
    // zvE 100 000 € → tax 31 088 €; 11,9 % × (31 088 − 19 950) = 1 325.42
    const result = calc({ year: 2025, taxableIncome: 100000 })
    expect(result.solidaritySurcharge).toBe(1325.42)
  })

  it('2025: full 5,5 % beyond the mitigation zone', () => {
    // SolzG discards fractions of a cent: 5,5 % = 6 366.415 € → 6 366.41 €
    const result = calc({ year: 2025, taxableIncome: 300000 })
    expect(result.solidaritySurcharge).toBe(6366.41)
  })

  it('2025: joint Freigrenze is doubled (39 900 €)', () => {
    // joint zvE 200 000 € → tax 62 176 €; 11,9 % × (62 176 − 39 900) = 2 650.84
    const result = calc({
      year: 2025,
      taxableIncome: 200000,
      assessmentType: 'joint'
    })
    expect(result.incomeTax).toBe(62176)
    expect(result.solidaritySurcharge).toBe(2650.84)
  })

  it('2026: Freigrenze raised to 20 350 €', () => {
    // zvE 74 900 € → tax 20 322 € ≤ 20 350 → no soli
    expect(calc({ year: 2026, taxableIncome: 74900 }).solidaritySurcharge).toBe(0)
    // zvE 75 000 € → tax 20 364 €; 11,9 % × 14 = 1.666 € → 1.66 €
    expect(calc({ year: 2026, taxableIncome: 75000 }).solidaritySurcharge).toBe(1.66)
  })

  it('can be disabled', () => {
    expect(
      calc({
        year: 2025,
        taxableIncome: 100000,
        includeSolidaritySurcharge: false
      }).solidaritySurcharge
    ).toBe(0)
  })
})

describe('church tax', () => {
  it('applies 8 % (BW/BY) or 9 % (other states) of the income tax', () => {
    // zvE 100 000 € 2025 → tax 31 088 €
    expect(calc({ year: 2025, taxableIncome: 100000, churchTax: 'rate8' }).churchTax).toBe(
      2487.04
    )
    expect(calc({ year: 2025, taxableIncome: 100000, churchTax: 'rate9' }).churchTax).toBe(
      2797.92
    )
    expect(calc({ year: 2025, taxableIncome: 100000, churchTax: 'none' }).churchTax).toBe(0)
  })

  it('total adds income tax, soli and church tax', () => {
    const result = calc({ year: 2025, taxableIncome: 100000, churchTax: 'rate9' })
    expect(result.total).toBe(31088 + 1325.42 + 2797.92)
  })
})

describe('marginal and average rates', () => {
  it('reports zone rates', () => {
    expect(calc({ year: 2025, taxableIncome: 12000 }).marginalRatePercent).toBe(0)
    expect(calc({ year: 2025, taxableIncome: 100000 }).marginalRatePercent).toBe(42)
    expect(calc({ year: 2025, taxableIncome: 300000 }).marginalRatePercent).toBe(45)
    expect(calc({ year: 2025, taxableIncome: 30000 }).marginalRatePercent).toBeCloseTo(
      28.41,
      2
    )
  })

  it('reports the average rate on the floored zvE', () => {
    expect(calc({ year: 2025, taxableIncome: 100000 }).averageRatePercent).toBe(31.09)
    expect(calc({ year: 2025, taxableIncome: 0 }).averageRatePercent).toBe(0)
  })

  it('joint marginal rate is the rate at half the income', () => {
    const joint = calc({ year: 2025, taxableIncome: 100000, assessmentType: 'joint' })
    const single = calc({ year: 2025, taxableIncome: 50000 })
    expect(joint.marginalRatePercent).toBe(single.marginalRatePercent)
  })
})

describe('engine selection', () => {
  it('returns exact engines for supported years', () => {
    expect(getIncomeTaxEngine(2022)).toMatchObject({
      exactYearMatch: true,
      engine: { year: 2022, version: '2022.1' }
    })
    expect(getIncomeTaxEngine(2024)).toMatchObject({
      exactYearMatch: true,
      engine: { year: 2024, version: '2024.1' }
    })
    expect(getIncomeTaxEngine(2025)).toMatchObject({
      exactYearMatch: true,
      engine: { year: 2025, version: '2025.1' }
    })
    expect(getIncomeTaxEngine(2026)).toMatchObject({
      exactYearMatch: true,
      engine: { year: 2026, version: '2026.1' }
    })
  })

  it('falls back to the closest earlier engine', () => {
    const later = getIncomeTaxEngine(2027)
    expect(later.exactYearMatch).toBe(false)
    expect(later.engine.year).toBe(2026)
  })

  it('falls back to the earliest engine for years before 2022', () => {
    const earlier = getIncomeTaxEngine(2021)
    expect(earlier.exactYearMatch).toBe(false)
    expect(earlier.engine.year).toBe(2022)
  })

  it('lists supported years', () => {
    expect(listSupportedTaxYears()).toEqual([2022, 2023, 2024, 2025, 2026])
  })
})
