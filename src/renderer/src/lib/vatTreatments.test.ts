import { describe, expect, it } from 'vitest'
import { vatTreatmentOptionsForDirection } from './vatTreatments'

describe('vatTreatmentOptionsForDirection', () => {
  it('shows only revenue treatments for income documents', () => {
    const codes = vatTreatmentOptionsForDirection('income').map(({ code }) => code)

    expect(codes).toContain('DE_DOMESTIC_19')
    expect(codes).toContain('EU_B2B_REVERSE_CHARGE_REVENUE')
    expect(codes).not.toContain('DE_EXPENSE_INPUT_VAT')
    expect(codes).not.toContain('EXPENSE_REVERSE_CHARGE_13B')
  })

  it('shows only purchase treatments for expense documents', () => {
    const codes = vatTreatmentOptionsForDirection('expense').map(({ code }) => code)

    expect(codes).toEqual([
      'DE_EXPENSE_INPUT_VAT',
      'DE_EXPENSE_NO_INPUT_VAT',
      'EXPENSE_REVERSE_CHARGE_13B'
    ])
  })

  it('puts the current suggestion first without duplicating it', () => {
    const codes = vatTreatmentOptionsForDirection('income', 'THIRD_COUNTRY_B2B_SERVICE').map(
      ({ code }) => code
    )

    expect(codes[0]).toBe('THIRD_COUNTRY_B2B_SERVICE')
    expect(codes.filter((code) => code === 'THIRD_COUNTRY_B2B_SERVICE')).toHaveLength(1)
  })
})
