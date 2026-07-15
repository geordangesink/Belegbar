/**
 * Currency conversion with auditable, replaceable rate sources.
 * Rates are never invented; a missing rate flags the document for review.
 */

export interface ExchangeRateQuery {
  currency: string
  /** ISO date the rate should apply to */
  date: string
}

export interface ExchangeRateResult {
  currency: string
  date: string
  /** multiply original amount by this to get EUR */
  rateToEur: number
  source: string
}

/** Provider boundary: ECB fetcher, manual entry, cached rates, tests. */
export interface ExchangeRateProvider {
  name: string
  getRate(query: ExchangeRateQuery): Promise<ExchangeRateResult | null>
}

export type ConversionPolicy = 'invoice_date' | 'payment_date'

export function isIsoCurrency(code: string): boolean {
  throw new Error('not implemented')
}

export function convertToEur(
  amount: number,
  rate: ExchangeRateResult
): number {
  throw new Error('not implemented')
}

/**
 * Parse the "charged €X using 1 USD = Y EUR" style wording some receipts
 * carry; a rate printed on the document itself is the best audit source.
 */
export function extractInlineRate(
  text: string
): { rateToEur: number; currency: string } | null {
  throw new Error('not implemented')
}
