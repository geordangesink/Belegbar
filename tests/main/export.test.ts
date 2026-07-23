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
  it('labels current-year values as a projected whole year', () => {
    const summary = buildSummaryText([], period, settings(), '2026-07-23')

    expect(summary).toContain('Recorded income to date')
    expect(summary).toContain('Projected full-year profit')
    expect(summary).toContain('7 month(s), factor 1.71')
  })

  it('does not annualize a completed year', () => {
    const summary = buildSummaryText(
      [],
      { year: 2025, quarter: null, month: null },
      settings(),
      '2026-07-23'
    )

    expect(summary).not.toContain('Projected full-year profit')
    expect(summary).toContain('Business profit before personal taxes')
  })

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
