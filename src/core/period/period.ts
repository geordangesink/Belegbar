/**
 * Tax-period determination, separate from physical storage location.
 * For EÜR/Ist users the payment date governs recognition; for accrual/Soll
 * the invoice/service date. When the governing date is missing, the period
 * falls back to the invoice date and the document is flagged provisional.
 */
import type { TaxPeriod } from '../../shared/domain'
import { isValidIsoDate } from '../parsing/dates'

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month out of range: ${month}`)
  }
  return (Math.ceil(month / 3) as 1 | 2 | 3 | 4)
}

export function periodOfIsoDate(iso: string): TaxPeriod {
  if (!isValidIsoDate(iso)) {
    throw new RangeError(`invalid ISO date: ${iso}`)
  }
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return { year, quarter: quarterOfMonth(month), month }
}

export interface RecognitionInput {
  invoiceDate: string | null
  paymentDate: string | null
  paymentStatus: 'unknown' | 'paid' | 'unpaid'
  method: 'euer' | 'accrual' | 'unsure'
}

export interface RecognitionResult {
  /** date used for recognition, ISO */
  recognitionDate: string | null
  period: TaxPeriod | null
  /** false → only provisional (e.g. EÜR without payment date) */
  definitive: boolean
  reasonKey: string
}

export function determineRecognition(input: RecognitionInput): RecognitionResult {
  const { invoiceDate, paymentDate, paymentStatus, method } = input

  const result = (
    date: string | null,
    definitive: boolean,
    reasonKey: string
  ): RecognitionResult => ({
    recognitionDate: date,
    period: date !== null ? periodOfIsoDate(date) : null,
    definitive,
    reasonKey
  })

  if (method === 'euer') {
    if (paymentStatus === 'paid' && paymentDate !== null) {
      return result(paymentDate, true, 'recognized_payment_date')
    }
    if (paymentStatus === 'unpaid') {
      return result(null, false, 'not_yet_paid')
    }
    if (invoiceDate !== null) {
      return result(invoiceDate, false, 'payment_date_missing')
    }
    return result(null, false, 'no_date')
  }

  if (method === 'accrual') {
    if (invoiceDate !== null) {
      return result(invoiceDate, true, 'recognized_invoice_date')
    }
    return result(null, false, 'no_date')
  }

  // method unsure → use invoice date but never definitive
  if (invoiceDate !== null) {
    return result(invoiceDate, false, 'method_unsure')
  }
  return result(null, false, 'no_date')
}

/** Does an ISO date fall inside a period? month/quarter null = whole span. */
export function dateInPeriod(iso: string, period: TaxPeriod): boolean {
  if (!isValidIsoDate(iso)) return false
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  if (year !== period.year) return false
  if (period.month !== null) return month === period.month
  if (period.quarter !== null) return quarterOfMonth(month) === period.quarter
  return true
}
