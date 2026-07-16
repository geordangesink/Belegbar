/**
 * ECB Data Portal exchange-rate provider.
 *
 * REST endpoint (CSV):
 *   https://data-api.ecb.europa.eu/service/data/EXR/D.{CUR}.EUR.SP00.A
 *     ?startPeriod={date-7d}&endPeriod={date}&format=csvdata
 *
 * ECB quotes CUR per 1 EUR, so rateToEur = 1 / obsValue.
 * Rates are NEVER invented: offline/timeout/no data → null.
 */
import type {
  ExchangeRateProvider,
  ExchangeRateQuery,
  ExchangeRateResult
} from '../../core/currency/convert'

export const ECB_SOURCE = 'ECB'

export interface EcbObservation {
  /** ISO date of the observation */
  date: string
  /** CUR per EUR as published by the ECB */
  obsValue: number
}

/**
 * Parse ECB `format=csvdata` output. Header names the columns; we need
 * TIME_PERIOD and OBS_VALUE. Unknown/malformed rows are skipped.
 */
export function parseEcbCsv(csv: string): EcbObservation[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return []
  const header = lines[0]!.split(',').map((h) => h.trim().toUpperCase())
  const dateIdx = header.indexOf('TIME_PERIOD')
  const valueIdx = header.indexOf('OBS_VALUE')
  if (dateIdx === -1 || valueIdx === -1) return []

  const observations: EcbObservation[] = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const date = cols[dateIdx]?.trim()
    const rawValue = cols[valueIdx]?.trim()
    if (!date || !rawValue || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) continue
    observations.push({ date, obsValue: value })
  }
  return observations
}

/** Latest observation at or before `date`, or null. */
export function latestObservationOnOrBefore(
  observations: EcbObservation[],
  date: string
): EcbObservation | null {
  let best: EcbObservation | null = null
  for (const obs of observations) {
    if (obs.date > date) continue
    if (!best || obs.date > best.date) best = obs
  }
  return best
}

function isoDaysBefore(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  const d = new Date(ms - days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

export interface EcbProviderOptions {
  /** persist every fetched rate for offline reuse */
  onRateFetched?: (rate: ExchangeRateResult) => void
  timeoutMs?: number
  /** injected for tests */
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export class EcbExchangeRateProvider implements ExchangeRateProvider {
  readonly name = ECB_SOURCE

  constructor(private readonly options: EcbProviderOptions = {}) {}

  async getRate(query: ExchangeRateQuery): Promise<ExchangeRateResult | null> {
    const currency = query.currency.toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return null
    if (currency === 'EUR') {
      return { currency: 'EUR', date: query.date, rateToEur: 1, source: ECB_SOURCE }
    }

    const fetchImpl = this.options.fetchImpl ?? fetch
    const timeoutMs = this.options.timeoutMs ?? 4000
    const base = this.options.baseUrl ?? 'https://data-api.ecb.europa.eu/service/data/EXR'
    const start = isoDaysBefore(query.date, 7)
    const url = `${base}/D.${currency}.EUR.SP00.A?startPeriod=${start}&endPeriod=${query.date}&format=csvdata`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'text/csv' }
      })
      if (!response.ok) return null
      const csv = await response.text()
      const latest = latestObservationOnOrBefore(parseEcbCsv(csv), query.date)
      if (!latest) return null
      const result: ExchangeRateResult = {
        currency,
        date: latest.date,
        rateToEur: 1 / latest.obsValue,
        source: ECB_SOURCE
      }
      this.options.onRateFetched?.(result)
      return result
    } catch {
      return null // offline / timeout / malformed — never invent a rate
    } finally {
      clearTimeout(timer)
    }
  }
}
