import type {
  ExchangeRateProvider,
  ExchangeRateQuery,
  ExchangeRateResult
} from '../../core/currency/convert'

export const BMF_MONTHLY_SOURCE = 'BMF USt-Umrechnungskurs'
export const BMF_MONTHLY_ATTRIBUTION = 'Bundesministerium der Finanzen'
export const BMF_MONTHLY_DATASET_PAGE_URL =
  'https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/steuern-zoelle/umsatzsteuer-umrechnungskurse/umsatzsteuer-umrechnungskurse.html'
export const BMF_MONTHLY_LICENSE =
  'Datenlizenz Deutschland - Namensnennung - Version 2.0'
export const BMF_MONTHLY_LICENSE_URL = 'https://www.govdata.de/dl-de/by-2-0'
export const BMF_MONTHLY_USER_AGENT = 'Mozilla/5.0 (compatible; Belegbar/0.1)'

export const BMF_MONTHLY_DATASET_BASE_URL =
  'https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/steuern-zoelle/umsatzsteuer-umrechnungskurse/datensaetze'

export interface BmfMonthlyQuote {
  currency: string
  month: number
  unitsPerEur: number
}

function parseSemicolonCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]!
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === ';' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++
      row.push(cell.trim())
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell.trim())
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

function parseGermanNumber(raw: string): number | null {
  const compact = raw.replace(/[\s\u00a0]/g, '')
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(compact)) return null
  const normalized = compact.replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseQuoteCell(cell: string): { currency: string; unitsPerEur: number } | null {
  const match = cell.trim().match(/^([0-9][0-9.,\s\u00a0]*)\s+([A-Z]{3})$/)
  if (!match?.[1] || !match[2]) return null
  const unitsPerEur = parseGermanNumber(match[1])
  if (unitsPerEur === null) return null
  return { currency: match[2], unitsPerEur }
}

export function parseBmfMonthlyCsv(csv: string): BmfMonthlyQuote[] {
  const rows = parseSemicolonCsv(csv.replace(/^\uFEFF/, ''))
  const headerIndex = rows.findIndex(
    (row) => row[0]?.trim().toLowerCase() === 'land' && row.length >= 14
  )
  if (headerIndex === -1) return []

  const quotes: BmfMonthlyQuote[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    if (row[1]?.trim().toLowerCase() !== '1 euro') continue
    for (let month = 1; month <= 12; month++) {
      const quote = parseQuoteCell(row[month + 1] ?? '')
      if (quote) quotes.push({ ...quote, month })
    }
  }
  return quotes
}

function parseIsoDate(date: string): { year: number; month: number } | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match?.[1] || !match[2] || !match[3]) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (year < 2010 || month < 1 || month > 12 || day < 1 || day > lastDay) return null
  return { year, month }
}

export function bmfMonthlyCsvUrl(
  year: number,
  baseUrl = BMF_MONTHLY_DATASET_BASE_URL
): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/uu-kurse-${year}-csv.csv?__blob=publicationFile`
}

export function isBmfMonthlySource(source: string): boolean {
  return source === BMF_MONTHLY_SOURCE || source.startsWith(`${BMF_MONTHLY_SOURCE} `)
}

export interface BmfMonthlyProviderOptions {
  onRateFetched?: (rate: ExchangeRateResult) => void
  timeoutMs?: number
  cacheTtlMs?: number
  failureBackoffMs?: number
  now?: () => number
  fetchImpl?: typeof fetch
  baseUrl?: string
  userAgent?: string
}

type YearQuotes = ReadonlyMap<string, ReadonlyMap<number, number>>
interface CachedYearQuotes {
  expiresAt: number
  quotes: Promise<YearQuotes>
}

export class BmfMonthlyExchangeRateProvider implements ExchangeRateProvider {
  readonly name = BMF_MONTHLY_SOURCE
  private readonly years = new Map<number, CachedYearQuotes>()

  constructor(private readonly options: BmfMonthlyProviderOptions = {}) {}

  async getRate(query: ExchangeRateQuery): Promise<ExchangeRateResult | null> {
    const currency = query.currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return null
    const date = parseIsoDate(query.date)
    if (!date) return null
    if (currency === 'EUR') {
      return {
        currency,
        date: query.date,
        rateToEur: 1,
        source: BMF_MONTHLY_SOURCE
      }
    }

    const quotes = await this.quotesForYear(date.year)
    const unitsPerEur = quotes.get(currency)?.get(date.month)
    if (unitsPerEur === undefined) return null

    const month = String(date.month).padStart(2, '0')
    const result: ExchangeRateResult = {
      currency,
      date: `${date.year}-${month}-01`,
      rateToEur: 1 / unitsPerEur,
      source: `${BMF_MONTHLY_SOURCE} ${date.year}-${month}`
    }
    this.options.onRateFetched?.(result)
    return result
  }

  private quotesForYear(year: number): Promise<YearQuotes> {
    const now = this.now()
    const cached = this.years.get(year)
    if (cached && cached.expiresAt > now) return cached.quotes

    const fetched = this.fetchYear(year)
    const pending = fetched.catch(() => {
      const current = this.years.get(year)
      if (current?.quotes === pending) {
        current.expiresAt = this.now() + (this.options.failureBackoffMs ?? 30_000)
      }
      return new Map()
    })
    this.years.set(year, {
      expiresAt: now + (this.options.cacheTtlMs ?? 6 * 60 * 60 * 1000),
      quotes: pending
    })
    return pending
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async fetchYear(year: number): Promise<YearQuotes> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4000)

    try {
      const response = await fetchImpl(bmfMonthlyCsvUrl(year, this.options.baseUrl), {
        signal: controller.signal,
        headers: {
          Accept: 'text/csv,application/csv,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
          Referer: BMF_MONTHLY_DATASET_PAGE_URL,
          'User-Agent': this.options.userAgent ?? BMF_MONTHLY_USER_AGENT
        }
      })
      if (!response.ok) throw new Error(`BMF rate response ${response.status}`)
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      const acceptedContentType = [
        'text/csv',
        'application/csv',
        'text/plain',
        'application/octet-stream',
        'application/vnd.ms-excel'
      ].some((type) => contentType.startsWith(type))
      if (!acceptedContentType) throw new Error(`Unexpected BMF content type: ${contentType}`)
      const bytes = await response.arrayBuffer()
      const csv = new TextDecoder('windows-1252').decode(bytes)
      if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(csv)) {
        throw new Error('Unexpected BMF HTML response')
      }
      const parsed = parseBmfMonthlyCsv(csv)
      if (parsed.length === 0) throw new Error('BMF response contained no rates')
      const quotes: Map<string, Map<number, number>> = new Map()
      for (const quote of parsed) {
        let months = quotes.get(quote.currency)
        if (!months) {
          months = new Map()
          quotes.set(quote.currency, months)
        }
        months.set(quote.month, quote.unitsPerEur)
      }
      return quotes
    } finally {
      clearTimeout(timer)
    }
  }
}
