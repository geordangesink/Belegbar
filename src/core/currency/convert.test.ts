import { describe, expect, it } from 'vitest'
import {
  convertToEur,
  extractInlineRate,
  isIsoCurrency,
  roundMoney,
  type ExchangeRateResult
} from './convert'

describe('isIsoCurrency', () => {
  it('accepts common active ISO-4217 codes', () => {
    for (const code of ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'SEK', 'PLN', 'INR']) {
      expect(isIsoCurrency(code), code).toBe(true)
    }
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(isIsoCurrency('usd')).toBe(true)
    expect(isIsoCurrency(' eur ')).toBe(true)
  })

  it('rejects crypto tickers — they are not ISO currencies', () => {
    for (const code of ['USDT', 'USDC', 'BTC', 'ETH']) {
      expect(isIsoCurrency(code), code).toBe(false)
    }
  })

  it('rejects junk', () => {
    expect(isIsoCurrency('')).toBe(false)
    expect(isIsoCurrency('EU')).toBe(false)
    expect(isIsoCurrency('EURO')).toBe(false)
    expect(isIsoCurrency('XYZ')).toBe(false)
  })
})

describe('roundMoney', () => {
  it('rounds half up (away from zero) at 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(1.004)).toBe(1.0)
    expect(roundMoney(0)).toBe(0)
  })
})

describe('convertToEur', () => {
  const rate = (rateToEur: number): ExchangeRateResult => ({
    currency: 'USD',
    date: '2026-01-15',
    rateToEur,
    source: 'test'
  })

  it('multiplies by rateToEur and rounds half-up to 2 decimals', () => {
    expect(convertToEur(50, rate(0.9024))).toBe(45.12)
    expect(convertToEur(59.5, rate(0.9024))).toBe(53.69) // 53.6928
    expect(convertToEur(1.005, rate(1))).toBe(1.01)
  })

  it('handles negative amounts (credit notes)', () => {
    expect(convertToEur(-50, rate(0.9024))).toBe(-45.12)
  })
})

describe('extractInlineRate', () => {
  it('parses a direct quote to EUR', () => {
    expect(extractInlineRate('1 USD = 0.9024 EUR')).toEqual({
      currency: 'USD',
      rateToEur: 0.9024
    })
  })

  it('parses the rate out of surrounding receipt text', () => {
    expect(
      extractInlineRate('Charged €17.14 using 1 USD = 0.9024 EUR')
    ).toEqual({ currency: 'USD', rateToEur: 0.9024 })
  })

  it('inverts an EUR-base quote', () => {
    const parsed = extractInlineRate('1 EUR = 1.1082 USD')
    expect(parsed?.currency).toBe('USD')
    expect(parsed?.rateToEur).toBeCloseTo(1 / 1.1082, 6)
  })

  it('parses German decimal commas', () => {
    expect(extractInlineRate('1 USD = 0,9024 EUR')).toEqual({
      currency: 'USD',
      rateToEur: 0.9024
    })
    const inverted = extractInlineRate('1 EUR = 1,1082 USD')
    expect(inverted?.currency).toBe('USD')
    expect(inverted?.rateToEur).toBeCloseTo(1 / 1.1082, 6)
  })

  it('accepts "1.00 USD = …" style', () => {
    expect(extractInlineRate('1.00 USD = 0.85 EUR')).toEqual({
      currency: 'USD',
      rateToEur: 0.85
    })
  })

  it('does not treat "11 USD = 10 EUR" as a unit-rate quote', () => {
    expect(extractInlineRate('11 USD = 10 EUR')).toBeNull()
  })

  it('rejects non-ISO currencies and text without a rate', () => {
    expect(extractInlineRate('1 XYZ = 0.5 EUR')).toBeNull()
    expect(extractInlineRate('1 USDT = 0.9 EUR')).toBeNull()
    expect(extractInlineRate('Total due: 42.00 EUR')).toBeNull()
  })

  it('ignores EUR = EUR pseudo-quotes', () => {
    expect(extractInlineRate('1 EUR = 1.00 EUR')).toBeNull()
  })
})
