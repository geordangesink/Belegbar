import { describe, expect, it } from 'vitest'
import { detectNumberLocale, parseLocalizedAmount, roundMoney } from './numbers'

describe('parseLocalizedAmount', () => {
  it('parses German formats', () => {
    expect(parseLocalizedAmount('1.300,00')).toBe(1300)
    expect(parseLocalizedAmount('23,00 EUR')).toBe(23)
    expect(parseLocalizedAmount('7,50')).toBe(7.5)
    expect(parseLocalizedAmount('1.234.567,89')).toBe(1234567.89)
    expect(parseLocalizedAmount('0,80')).toBe(0.8)
  })

  it('parses English formats', () => {
    expect(parseLocalizedAmount('1,300.00')).toBe(1300)
    expect(parseLocalizedAmount('1300.00')).toBe(1300)
    expect(parseLocalizedAmount('$59.50')).toBe(59.5)
    expect(parseLocalizedAmount('€23.00')).toBe(23)
    expect(parseLocalizedAmount('6,000.00')).toBe(6000)
    expect(parseLocalizedAmount('1,234,567.89')).toBe(1234567.89)
  })

  it('parses plain and adorned numbers', () => {
    expect(parseLocalizedAmount('1300')).toBe(1300)
    expect(parseLocalizedAmount("1'300.50")).toBe(1300.5)
    expect(parseLocalizedAmount('EUR  99,00')).toBe(99)
    expect(parseLocalizedAmount('USDT 7550.56')).toBe(7550.56)
  })

  it('handles negatives and accounting parentheses', () => {
    expect(parseLocalizedAmount('-5,00')).toBe(-5)
    expect(parseLocalizedAmount('(5.00)')).toBe(-5)
    expect(parseLocalizedAmount('−2,49')).toBe(-2.49)
  })

  it('resolves ambiguous group-of-three via hint, null otherwise', () => {
    expect(parseLocalizedAmount('1,300')).toBeNull()
    expect(parseLocalizedAmount('1,300', 'en')).toBe(1300)
    expect(parseLocalizedAmount('1,300', 'de')).toBe(1.3)
    expect(parseLocalizedAmount('1.300')).toBeNull()
    expect(parseLocalizedAmount('1.300', 'de')).toBe(1300)
    expect(parseLocalizedAmount('1.300', 'en')).toBe(1.3)
    // multiple groups are unambiguous
    expect(parseLocalizedAmount('1.300.000')).toBe(1300000)
    expect(parseLocalizedAmount('1,300,000')).toBe(1300000)
  })

  it('rejects invalid input', () => {
    expect(parseLocalizedAmount('')).toBeNull()
    expect(parseLocalizedAmount('abc')).toBeNull()
    expect(parseLocalizedAmount('12.34.56')).toBeNull()
    expect(parseLocalizedAmount('20.08.2025')).toBeNull()
    expect(parseLocalizedAmount('..')).toBeNull()
  })
})

describe('detectNumberLocale', () => {
  it('detects German decimal commas', () => {
    expect(detectNumberLocale('Summe 1.300,00 EUR und 7,50 EUR')).toBe('de')
  })
  it('detects English decimal dots', () => {
    expect(detectNumberLocale('Total 1,300.00 and $7.50')).toBe('en')
  })
  it('returns unknown without evidence', () => {
    expect(detectNumberLocale('no numbers here')).toBe('unknown')
  })
})

describe('roundMoney', () => {
  it('rounds half-up to 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(3.6727)).toBe(3.67)
    expect(roundMoney(1.004)).toBe(1)
    expect(roundMoney(10)).toBe(10)
  })
  it('rounds negative halves away from zero (commercial)', () => {
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(-2.494)).toBe(-2.49)
  })
})
