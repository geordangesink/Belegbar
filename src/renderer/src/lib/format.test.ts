import { describe, expect, it } from 'vitest'
import {
  formatCurrencyAmount,
  formatEur,
  formatIsoDate,
  formatMonth,
  parseDecimalInput,
  previewFilename,
  round2,
  shortId
} from './format'

const normalize = (s: string): string => s.replace(/ | /g, ' ')

describe('round2', () => {
  it('rounds half away from zero (kaufmännisch)', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(1.004)).toBe(1.0)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(0)).toBe(0)
  })
})

describe('formatEur', () => {
  it('formats German style', () => {
    expect(normalize(formatEur(1234.56, 'de'))).toBe('1.234,56 €')
  })
  it('formats English style', () => {
    expect(formatEur(1234.56, 'en')).toBe('€1,234.56')
  })
  it('handles negatives', () => {
    expect(normalize(formatEur(-0.5, 'de'))).toBe('-0,50 €')
  })
})

describe('formatMonth', () => {
  it('formats localized short and full month names', () => {
    expect(formatMonth(3, 'de', 'short')).toBe('Mär')
    expect(formatMonth(3, 'en', 'long')).toBe('March')
  })

  it('rejects invalid month numbers', () => {
    expect(formatMonth(0, 'de')).toBe('')
    expect(formatMonth(13, 'en')).toBe('')
  })
})

describe('formatCurrencyAmount', () => {
  it('formats USD for both locales', () => {
    expect(formatCurrencyAmount(10000, 'USD', 'en')).toBe('$10,000.00')
    expect(normalize(formatCurrencyAmount(10000, 'USD', 'de'))).toBe('10.000,00 $')
  })
  it('falls back gracefully for unknown codes', () => {
    expect(normalize(formatCurrencyAmount(12.5, 'XX?', 'en'))).toContain('12.50')
  })
})

describe('formatIsoDate', () => {
  it('formats ISO dates per locale', () => {
    expect(formatIsoDate('2026-07-15', 'de')).toBe('15.07.2026')
    expect(formatIsoDate('2026-07-15', 'en')).toBe('Jul 15, 2026')
  })
  it('passes through invalid input and empty', () => {
    expect(formatIsoDate('15.07.2026', 'de')).toBe('15.07.2026')
    expect(formatIsoDate(null, 'de')).toBe('')
  })
})

describe('parseDecimalInput', () => {
  it('parses German notation', () => {
    expect(parseDecimalInput('1.234,56')).toBe(1234.56)
    expect(parseDecimalInput('1234,56')).toBe(1234.56)
  })
  it('parses English notation', () => {
    expect(parseDecimalInput('1,234.56')).toBe(1234.56)
    expect(parseDecimalInput('1234.56')).toBe(1234.56)
  })
  it('parses plain integers and negatives', () => {
    expect(parseDecimalInput('42')).toBe(42)
    expect(parseDecimalInput('-7,5')).toBe(-7.5)
  })
  it('rejects garbage', () => {
    expect(parseDecimalInput('abc')).toBeNull()
    expect(parseDecimalInput('1,2,3.4.5')).toBeNull()
    expect(parseDecimalInput('')).toBeNull()
    expect(parseDecimalInput('-')).toBeNull()
  })
})

describe('previewFilename', () => {
  it('joins date, counterparty and number', () => {
    expect(
      previewFilename({
        invoiceDate: '2026-01-24',
        counterparty: 'Muster GmbH',
        invoiceNumber: 'RE-2026/01'
      })
    ).toBe('2026-01-24_Muster-GmbH_RE-202601.pdf')
  })
  it('handles missing parts', () => {
    expect(previewFilename({ invoiceDate: null, counterparty: null, invoiceNumber: null })).toBe(
      'beleg.pdf'
    )
  })
})

describe('shortId', () => {
  it('takes the first 8 chars', () => {
    expect(shortId('a1b2c3d4-e5f6-7890')).toBe('a1b2c3d4')
  })
})
