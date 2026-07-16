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

/**
 * Active ISO 4217 currency codes (list state 2025; includes fund and
 * precious-metal codes). Crypto tickers (BTC, USDT, USDC, …) are NOT ISO
 * currencies and must be rejected so amounts get flagged for review.
 */
export const ISO_4217_CURRENCIES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV',
  'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHE', 'CHF',
  'CHW', 'CLF', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP',
  'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL',
  'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD',
  'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD',
  'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR',
  'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN',
  'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD',
  'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP',
  'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI', 'UYU',
  'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG', 'XAU',
  'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XCG', 'XDR', 'XOF', 'XPD', 'XPF',
  'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWG'
] as const

const CURRENCY_SET: ReadonlySet<string> = new Set(ISO_4217_CURRENCIES)
const DOCUMENT_QUOTED_ASSETS = new Set(['BTC', 'ETH', 'USDC', 'USDT'])

export function isIsoCurrency(code: string): boolean {
  return CURRENCY_SET.has(code.trim().toUpperCase())
}

/**
 * Round a monetary value to 2 decimals, half away from zero (kaufmännisch).
 * Uses a decimal-string round trip so binary artifacts like 1.005 → 100.49999
 * do not round the wrong way.
 */
export function roundMoney(value: number): number {
  const sign = value < 0 ? -1 : 1
  const scaled = Number((Math.abs(value) * 100).toPrecision(12))
  return (sign * Math.round(scaled)) / 100
}

export function convertToEur(
  amount: number,
  rate: ExchangeRateResult
): number {
  return roundMoney(amount * rate.rateToEur)
}

/** "1 USD = 0.9024 EUR" (also German "0,9024" and the inverted EUR-first form). */
const INLINE_RATE_PATTERN =
  /(^|[^0-9.,])1(?:[.,]0{1,2})?\s*([A-Za-z]{3,6})(?![A-Za-z])\s*=\s*([0-9]+(?:[.,][0-9]+)?)\s*([A-Za-z]{3,6})(?![A-Za-z])/g

function acceptsDocumentQuote(code: string): boolean {
  return isIsoCurrency(code) || DOCUMENT_QUOTED_ASSETS.has(code)
}

function parseRateNumber(raw: string): number | null {
  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  let normalized: string
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? raw.replace(/\./g, '').replace(/,/g, '.')
        : raw.replace(/,/g, '')
  } else {
    normalized = raw.replace(/,/g, '.')
  }
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Parse the "charged €X using 1 USD = Y EUR" style wording some receipts
 * carry; a rate printed on the document itself is the best audit source.
 */
export function extractInlineRate(
  text: string
): { rateToEur: number; currency: string } | null {
  const pattern = new RegExp(INLINE_RATE_PATTERN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const from = match[2]?.toUpperCase()
    const rawValue = match[3]
    const to = match[4]?.toUpperCase()
    if (!from || !rawValue || !to) continue
    const value = parseRateNumber(rawValue)
    if (value === null) continue
    if (to === 'EUR' && from !== 'EUR' && acceptsDocumentQuote(from)) {
      return { currency: from, rateToEur: value }
    }
    if (from === 'EUR' && to !== 'EUR' && acceptsDocumentQuote(to)) {
      // quoted as EUR base → invert to get EUR per 1 unit of the currency
      return { currency: to, rateToEur: 1 / value }
    }
  }
  return null
}
