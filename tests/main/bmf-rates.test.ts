import { describe, expect, it } from 'vitest'
import type { ExchangeRateResult } from '../../src/core/currency/convert'
import {
  BMF_MONTHLY_DATASET_PAGE_URL,
  BMF_MONTHLY_SOURCE,
  BMF_MONTHLY_USER_AGENT,
  BmfMonthlyExchangeRateProvider,
  bmfMonthlyCsvUrl,
  parseBmfMonthlyCsv
} from '../../src/main/rates/bmf-monthly'
import {
  resolveOfficialExchangeRate,
  type ExchangeRateCache
} from '../../src/main/rates/resolve'

const monthHeaders = [
  'Januar[1]',
  'Februar [2]',
  'März [3]',
  'April [4]',
  'Mai [5]',
  'Juni [6]',
  'Juli [7]',
  'August [8]',
  'September [9]',
  'Oktober [10]',
  'November [11]',
  'Dezember [12]'
]

function row(country: string, months: string[]): string {
  return [country, '1 Euro', ...months, ...Array(12 - months.length).fill('')].join(';')
}

const FIXTURE_CSV = [
  'Monatlich fortgeschriebene Übersicht 2026;;;;;;;;;;;;;',
  ['Land', 'Währung', ...monthHeaders].join(';'),
  row('"Vereinigte; Staaten"', ['1,1000 USD', '1,2000 USD']),
  row('Großbritannien', ['0,85000 GBP', '0,80000 GBP']),
  row('Indonesien', ['17.049,43 IDR']),
  row('Russland', []),
  '[1] Fußnote;;;;;;;;;;;;;'
].join('\r\n')

function windows1252Buffer(value: string): ArrayBuffer {
  const replacements: Record<string, number> = {
    ä: 0xe4,
    ß: 0xdf,
    Ü: 0xdc,
    ü: 0xfc
  }
  const bytes = Uint8Array.from(
    [...value].map((char) => replacements[char] ?? char.charCodeAt(0))
  )
  return bytes.buffer
}

function bmfResponse(
  body = FIXTURE_CSV,
  contentType = 'text/csv;charset=UTF-8'
): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: async () => windows1252Buffer(body)
  } as Response
}

describe('parseBmfMonthlyCsv', () => {
  it('parses semicolon CSV, quoted fields and German-formatted values', () => {
    expect(parseBmfMonthlyCsv(FIXTURE_CSV)).toEqual([
      { currency: 'USD', month: 1, unitsPerEur: 1.1 },
      { currency: 'USD', month: 2, unitsPerEur: 1.2 },
      { currency: 'GBP', month: 1, unitsPerEur: 0.85 },
      { currency: 'GBP', month: 2, unitsPerEur: 0.8 },
      { currency: 'IDR', month: 1, unitsPerEur: 17049.43 }
    ])
  })

  it('returns no quotes for malformed or unrelated CSV', () => {
    expect(parseBmfMonthlyCsv('')).toEqual([])
    expect(parseBmfMonthlyCsv('currency;value\nUSD;1.1')).toEqual([])
  })
})

describe('BmfMonthlyExchangeRateProvider', () => {
  it('decodes Windows-1252, inverts the monthly quote and persists its provenance', async () => {
    const saved: ExchangeRateResult[] = []
    let requestedUrl = ''
    let requestedHeaders = new Headers()
    const provider = new BmfMonthlyExchangeRateProvider({
      onRateFetched: (rate) => saved.push(rate),
      baseUrl: 'https://example.test/data/',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url)
        requestedHeaders = new Headers(init?.headers)
        return bmfResponse()
      }) as typeof fetch
    })

    const rate = await provider.getRate({ currency: 'usd', date: '2026-02-17' })
    expect(rate).toEqual({
      currency: 'USD',
      date: '2026-02-01',
      rateToEur: 1 / 1.2,
      source: `${BMF_MONTHLY_SOURCE} 2026-02`
    })
    expect(requestedUrl).toBe(
      'https://example.test/data/uu-kurse-2026-csv.csv?__blob=publicationFile'
    )
    expect(requestedHeaders.get('accept')).toContain('text/csv')
    expect(requestedHeaders.get('accept-language')).toContain('de-DE')
    expect(requestedHeaders.get('referer')).toBe(BMF_MONTHLY_DATASET_PAGE_URL)
    expect(requestedHeaders.get('user-agent')).toBe(BMF_MONTHLY_USER_AGENT)
    expect(saved).toEqual([rate])
  })

  it('downloads an annual file once per session and reuses it across currencies', async () => {
    let requests = 0
    const provider = new BmfMonthlyExchangeRateProvider({
      fetchImpl: (async () => {
        requests++
        return bmfResponse()
      }) as typeof fetch
    })

    const [usd, gbp] = await Promise.all([
      provider.getRate({ currency: 'USD', date: '2026-01-04' }),
      provider.getRate({ currency: 'GBP', date: '2026-02-21' })
    ])
    expect(usd?.rateToEur).toBe(1 / 1.1)
    expect(gbp?.rateToEur).toBe(1 / 0.8)
    expect(requests).toBe(1)
  })

  it('returns null for unpublished months, unsupported currencies and failed fetches', async () => {
    let requests = 0
    const provider = new BmfMonthlyExchangeRateProvider({
      fetchImpl: (async () => {
        requests++
        return bmfResponse()
      }) as typeof fetch
    })

    expect(await provider.getRate({ currency: 'USD', date: '2026-07-16' })).toBeNull()
    expect(await provider.getRate({ currency: 'CAD', date: '2026-01-16' })).toBeNull()
    expect(await provider.getRate({ currency: 'USDT', date: '2026-01-16' })).toBeNull()
    expect(await provider.getRate({ currency: 'USD', date: '2026-02-30' })).toBeNull()
    expect(requests).toBe(1)

    let attempts = 0
    let now = 1_000
    const recovering = new BmfMonthlyExchangeRateProvider({
      now: () => now,
      failureBackoffMs: 30_000,
      fetchImpl: (async () => {
        attempts++
        if (attempts === 1) throw new Error('offline')
        return bmfResponse()
      }) as typeof fetch
    })
    expect(await recovering.getRate({ currency: 'USD', date: '2026-01-16' })).toBeNull()
    expect(await recovering.getRate({ currency: 'USD', date: '2026-01-16' })).toBeNull()
    expect(attempts).toBe(1)
    now += 30_001
    expect(await recovering.getRate({ currency: 'USD', date: '2026-01-16' })).not.toBeNull()
    expect(attempts).toBe(2)
  })

  it('rejects 200 bot HTML and CSV responses without any published quotes', async () => {
    const html = new BmfMonthlyExchangeRateProvider({
      fetchImpl: (async () =>
        bmfResponse('<!doctype html><html><title>Captcha</title></html>', 'text/html')) as typeof fetch
    })
    expect(await html.getRate({ currency: 'USD', date: '2026-01-16' })).toBeNull()

    const emptyCsv = new BmfMonthlyExchangeRateProvider({
      fetchImpl: (async () =>
        bmfResponse(
          ['Land', 'Währung', ...monthHeaders].join(';'),
          'text/csv;charset=UTF-8'
        )) as typeof fetch
    })
    expect(await emptyCsv.getRate({ currency: 'USD', date: '2026-01-16' })).toBeNull()
  })

  it('builds the official annual dataset URL', () => {
    expect(bmfMonthlyCsvUrl(2024)).toBe(
      'https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/steuern-zoelle/umsatzsteuer-umrechnungskurse/datensaetze/uu-kurse-2024-csv.csv?__blob=publicationFile'
    )
  })
})

describe('resolveOfficialExchangeRate', () => {
  const query = { currency: 'USD', date: '2026-01-16' }
  const monthly: ExchangeRateResult = {
    currency: 'USD',
    date: '2026-01-01',
    rateToEur: 0.9,
    source: `${BMF_MONTHLY_SOURCE} 2026-01`
  }
  const daily: ExchangeRateResult = {
    currency: 'USD',
    date: '2026-01-15',
    rateToEur: 0.91,
    source: 'ECB'
  }

  it('uses cached BMF, live BMF, cached ECB and live ECB in that order', async () => {
    const calls: string[] = []
    const cache = (
      cachedMonthly: ExchangeRateResult | null,
      cachedDaily: ExchangeRateResult | null
    ): ExchangeRateCache => ({
      findBmfMonthly: () => {
        calls.push('monthly-cache')
        return cachedMonthly
      },
      findEcbDaily: () => {
        calls.push('ecb-cache')
        return cachedDaily
      }
    })
    const providers = (
      bmfResult: ExchangeRateResult | null,
      ecbResult: ExchangeRateResult | null
    ) => ({
      bmf: {
        name: 'BMF',
        getRate: async () => {
          calls.push('bmf-live')
          return bmfResult
        }
      },
      ecb: {
        name: 'ECB',
        getRate: async () => {
          calls.push('ecb-live')
          return ecbResult
        }
      }
    })

    expect(
      await resolveOfficialExchangeRate(query, cache(monthly, daily), providers(null, daily))
    ).toBe(monthly)
    expect(calls).toEqual(['monthly-cache'])

    calls.length = 0
    const fetched = { ...monthly, rateToEur: 0.905 }
    expect(
      await resolveOfficialExchangeRate(query, cache(null, daily), providers(fetched, daily))
    ).toBe(fetched)
    expect(calls).toEqual(['monthly-cache', 'bmf-live'])

    calls.length = 0
    expect(
      await resolveOfficialExchangeRate(query, cache(null, daily), providers(null, fetched))
    ).toBe(daily)
    expect(calls).toEqual(['monthly-cache', 'bmf-live', 'ecb-cache'])

    calls.length = 0
    expect(
      await resolveOfficialExchangeRate(query, cache(null, null), providers(null, daily))
    ).toBe(daily)
    expect(calls).toEqual(['monthly-cache', 'bmf-live', 'ecb-cache', 'ecb-live'])
  })
})
