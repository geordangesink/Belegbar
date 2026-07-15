import { describe, expect, it } from 'vitest'
import { findDates, findDatesDetailed, isValidIsoDate, parseInvoiceDate } from './dates'

describe('parseInvoiceDate', () => {
  it('parses numeric German/European formats', () => {
    expect(parseInvoiceDate('24.01.2026')).toBe('2026-01-24')
    expect(parseInvoiceDate('24/01/2026')).toBe('2026-01-24')
    expect(parseInvoiceDate('8.4.2026')).toBe('2026-04-08')
    expect(parseInvoiceDate('2026-01-24')).toBe('2026-01-24')
  })

  it('parses English month-name formats', () => {
    expect(parseInvoiceDate('October 7, 2025')).toBe('2025-10-07')
    expect(parseInvoiceDate('30 Nov 2025')).toBe('2025-11-30')
    expect(parseInvoiceDate('June 5, 2026')).toBe('2026-06-05')
    expect(parseInvoiceDate('Dec 19, 2025')).toBe('2025-12-19')
  })

  it('parses German month-name formats', () => {
    expect(parseInvoiceDate('4. September 2025')).toBe('2025-09-04')
    expect(parseInvoiceDate('24. Januar 2026')).toBe('2026-01-24')
    expect(parseInvoiceDate('02 Mai 2026')).toBe('2026-05-02')
    expect(parseInvoiceDate('25 April 2026')).toBe('2026-04-25')
    expect(parseInvoiceDate('1. März 2026')).toBe('2026-03-01')
    expect(parseInvoiceDate('31. Dezember 2025')).toBe('2025-12-31')
  })

  it('treats X/Y/ZZZZ as DD/MM (European default)', () => {
    expect(parseInvoiceDate('05/04/2026')).toBe('2026-04-05')
  })

  it('falls back to MM/DD when DD/MM is impossible', () => {
    expect(parseInvoiceDate('04/25/2026')).toBe('2026-04-25')
  })

  it('rejects invalid dates', () => {
    expect(parseInvoiceDate('31.02.2026')).toBeNull()
    expect(parseInvoiceDate('32.01.2026')).toBeNull()
    expect(parseInvoiceDate('2026-02-31')).toBeNull()
    expect(parseInvoiceDate('2026-13-01')).toBeNull()
    expect(parseInvoiceDate('hello')).toBeNull()
    expect(parseInvoiceDate('')).toBeNull()
  })
})

describe('findDates / findDatesDetailed', () => {
  it('finds all dates with offsets in document order', () => {
    const text = 'Rechnungsdatum 24.01.2026 fällig am 20.02.2026'
    const hits = findDates(text)
    expect(hits.map((h) => h.iso)).toEqual(['2026-01-24', '2026-02-20'])
    expect(hits[0]?.index).toBe(text.indexOf('24.01'))
  })

  it('flags DD/MM vs MM/DD ambiguity only when both readings are valid', () => {
    const [amb] = findDatesDetailed('05/04/2026')
    expect(amb?.iso).toBe('2026-04-05')
    expect(amb?.ambiguous).toBe(true)
    const [unamb] = findDatesDetailed('24/01/2026')
    expect(unamb?.ambiguous).toBe(false)
    // same day and month → no ambiguity
    const [same] = findDatesDetailed('03/03/2025')
    expect(same?.ambiguous).toBe(false)
    // dotted German form is never treated as MM.DD
    const [dotted] = findDatesDetailed('05.04.2026')
    expect(dotted?.iso).toBe('2026-04-05')
    expect(dotted?.ambiguous).toBe(false)
  })

  it('does not match inside longer digit runs or IBANs', () => {
    expect(findDates('IBAN DE26 3804 0007 0100 6790 01')).toEqual([])
    expect(findDates('Referenz 12.34.5.2026.99')).toEqual([])
  })
})

describe('isValidIsoDate', () => {
  it('accepts valid dates including leap days', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
  })
  it('rejects invalid or malformed dates', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false)
    expect(isValidIsoDate('2025-02-29')).toBe(false)
    expect(isValidIsoDate('2026-00-10')).toBe(false)
    expect(isValidIsoDate('2026-1-1')).toBe(false)
    expect(isValidIsoDate('24.01.2026')).toBe(false)
  })
})
