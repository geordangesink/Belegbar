/**
 * Tax-period determination, separate from physical storage location.
 * For EÜR/Ist users the payment date governs recognition; for accrual/Soll
 * the invoice/service date. When the governing date is missing, the period
 * falls back to the invoice date and the document is flagged provisional.
 */
import type { TaxPeriod } from '../../shared/domain'

export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  throw new Error('not implemented')
}

export function periodOfIsoDate(iso: string): TaxPeriod {
  throw new Error('not implemented')
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
  throw new Error('not implemented')
}

/** Does an ISO date fall inside a period? month/quarter null = whole span. */
export function dateInPeriod(iso: string, period: TaxPeriod): boolean {
  throw new Error('not implemented')
}
