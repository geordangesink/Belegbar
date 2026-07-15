import { describe, expect, it } from 'vitest'
import {
  dateInPeriod,
  determineRecognition,
  periodOfIsoDate,
  quarterOfMonth
} from './period'

describe('quarterOfMonth', () => {
  it('maps months to quarters', () => {
    expect(quarterOfMonth(1)).toBe(1)
    expect(quarterOfMonth(3)).toBe(1)
    expect(quarterOfMonth(4)).toBe(2)
    expect(quarterOfMonth(6)).toBe(2)
    expect(quarterOfMonth(7)).toBe(3)
    expect(quarterOfMonth(9)).toBe(3)
    expect(quarterOfMonth(10)).toBe(4)
    expect(quarterOfMonth(12)).toBe(4)
  })
  it('rejects out-of-range months', () => {
    expect(() => quarterOfMonth(0)).toThrow()
    expect(() => quarterOfMonth(13)).toThrow()
  })
})

describe('periodOfIsoDate', () => {
  it('derives year/quarter/month', () => {
    expect(periodOfIsoDate('2026-05-10')).toEqual({ year: 2026, quarter: 2, month: 5 })
    expect(periodOfIsoDate('2025-12-31')).toEqual({ year: 2025, quarter: 4, month: 12 })
  })
  it('rejects invalid dates', () => {
    expect(() => periodOfIsoDate('2026-02-31')).toThrow()
  })
})

describe('determineRecognition', () => {
  it('EÜR: paid with payment date → definitive payment-date recognition', () => {
    const r = determineRecognition({
      invoiceDate: '2026-01-10',
      paymentDate: '2026-02-05',
      paymentStatus: 'paid',
      method: 'euer'
    })
    expect(r.recognitionDate).toBe('2026-02-05')
    expect(r.period).toEqual({ year: 2026, quarter: 1, month: 2 })
    expect(r.definitive).toBe(true)
    expect(r.reasonKey).toBe('recognized_payment_date')
  })

  it('EÜR: unpaid → no recognition yet', () => {
    const r = determineRecognition({
      invoiceDate: '2026-01-10',
      paymentDate: null,
      paymentStatus: 'unpaid',
      method: 'euer'
    })
    expect(r.recognitionDate).toBeNull()
    expect(r.period).toBeNull()
    expect(r.definitive).toBe(false)
    expect(r.reasonKey).toBe('not_yet_paid')
  })

  it('EÜR: unknown payment → provisional fallback to invoice date', () => {
    const r = determineRecognition({
      invoiceDate: '2026-01-10',
      paymentDate: null,
      paymentStatus: 'unknown',
      method: 'euer'
    })
    expect(r.recognitionDate).toBe('2026-01-10')
    expect(r.definitive).toBe(false)
    expect(r.reasonKey).toBe('payment_date_missing')
  })

  it('EÜR: paid but no payment date → provisional fallback', () => {
    const r = determineRecognition({
      invoiceDate: '2026-01-10',
      paymentDate: null,
      paymentStatus: 'paid',
      method: 'euer'
    })
    expect(r.definitive).toBe(false)
    expect(r.reasonKey).toBe('payment_date_missing')
  })

  it('accrual: invoice date governs, definitive', () => {
    const r = determineRecognition({
      invoiceDate: '2025-11-30',
      paymentDate: '2026-01-04',
      paymentStatus: 'paid',
      method: 'accrual'
    })
    expect(r.recognitionDate).toBe('2025-11-30')
    expect(r.period).toEqual({ year: 2025, quarter: 4, month: 11 })
    expect(r.definitive).toBe(true)
    expect(r.reasonKey).toBe('recognized_invoice_date')
  })

  it('unsure: invoice date but never definitive', () => {
    const r = determineRecognition({
      invoiceDate: '2026-03-01',
      paymentDate: null,
      paymentStatus: 'unknown',
      method: 'unsure'
    })
    expect(r.recognitionDate).toBe('2026-03-01')
    expect(r.definitive).toBe(false)
    expect(r.reasonKey).toBe('method_unsure')
  })

  it('no governing date at all → no_date', () => {
    for (const method of ['euer', 'accrual', 'unsure'] as const) {
      const r = determineRecognition({
        invoiceDate: null,
        paymentDate: null,
        paymentStatus: 'unknown',
        method
      })
      expect(r.recognitionDate).toBeNull()
      expect(r.period).toBeNull()
      expect(r.definitive).toBe(false)
      expect(r.reasonKey).toBe('no_date')
    }
  })
})

describe('dateInPeriod', () => {
  it('matches month, quarter and year spans', () => {
    expect(dateInPeriod('2026-05-10', { year: 2026, quarter: 2, month: 5 })).toBe(true)
    expect(dateInPeriod('2026-05-10', { year: 2026, quarter: 2, month: null })).toBe(true)
    expect(dateInPeriod('2026-05-10', { year: 2026, quarter: null, month: null })).toBe(true)
    expect(dateInPeriod('2026-05-10', { year: 2026, quarter: 1, month: null })).toBe(false)
    expect(dateInPeriod('2026-05-10', { year: 2026, quarter: 2, month: 6 })).toBe(false)
    expect(dateInPeriod('2025-05-10', { year: 2026, quarter: 2, month: 5 })).toBe(false)
  })
  it('rejects invalid dates', () => {
    expect(dateInPeriod('2026-02-31', { year: 2026, quarter: null, month: null })).toBe(false)
  })
})
