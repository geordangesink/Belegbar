import { describe, expect, it } from 'vitest'
import { buildSummaryText } from '../../src/main/data/export'
import { DEFAULT_SETTINGS, type AppSettings, type TaxPeriod } from '../../src/shared/domain'

const period: TaxPeriod = { year: 2026, quarter: null, month: null }

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    incomeTaxMethod: 'euer',
    deductibleContributions: 1,
    ...overrides
  }
}

describe('income-tax summary export', () => {
  it('omits disabled church tax, Soli and zero prepayments', () => {
    const summary = buildSummaryText(
      [],
      period,
      settings({
        churchTax: 'none',
        includeSolidaritySurcharge: false,
        incomeTaxPrepayments: 0
      })
    )

    expect(summary).not.toContain('Kirchensteuer / Church tax:')
    expect(summary).not.toContain('Solidaritätszuschlag / Solidarity surcharge:')
    expect(summary).not.toContain('Vorauszahlungen / Prepayments:')
  })

  it('includes enabled taxes and configured prepayments', () => {
    const summary = buildSummaryText(
      [],
      period,
      settings({
        churchTax: 'rate9',
        includeSolidaritySurcharge: true,
        incomeTaxPrepayments: 500
      })
    )

    expect(summary).toContain('Kirchensteuer / Church tax:')
    expect(summary).toContain('Solidaritätszuschlag / Solidarity surcharge:')
    expect(summary).toContain('Vorauszahlungen / Prepayments: 500.00 EUR')
  })
})
