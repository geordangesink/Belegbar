import { describe, expect, it } from 'vitest'
import {
  EcbExchangeRateProvider,
  latestObservationOnOrBefore,
  parseEcbCsv
} from '../../src/main/rates/ecb'
import type { ExchangeRateResult } from '../../src/core/currency/convert'

const FIXTURE_CSV = [
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-08,1.0850,A',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-09,1.0900,A',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-10,1.1000,A'
].join('\n')

describe('parseEcbCsv', () => {
  it('extracts TIME_PERIOD/OBS_VALUE pairs', () => {
    const obs = parseEcbCsv(FIXTURE_CSV)
    expect(obs).toEqual([
      { date: '2026-07-08', obsValue: 1.085 },
      { date: '2026-07-09', obsValue: 1.09 },
      { date: '2026-07-10', obsValue: 1.1 }
    ])
  })

  it('skips malformed rows and handles empty input', () => {
    expect(parseEcbCsv('')).toEqual([])
    expect(parseEcbCsv('no header at all')).toEqual([])
    const withJunk = [
      'KEY,TIME_PERIOD,OBS_VALUE',
      'x,not-a-date,1.5',
      'x,2026-01-02,zero',
      'x,2026-01-03,-2',
      'x,2026-01-04,0.5'
    ].join('\n')
    expect(parseEcbCsv(withJunk)).toEqual([{ date: '2026-01-04', obsValue: 0.5 }])
  })
})

describe('latestObservationOnOrBefore', () => {
  const obs = parseEcbCsv(FIXTURE_CSV)
  it('picks the exact date when present', () => {
    expect(latestObservationOnOrBefore(obs, '2026-07-09')?.obsValue).toBe(1.09)
  })
  it('falls back to the latest earlier date (weekend/holiday)', () => {
    expect(latestObservationOnOrBefore(obs, '2026-07-12')?.obsValue).toBe(1.1)
  })
  it('returns null when everything is later', () => {
    expect(latestObservationOnOrBefore(obs, '2026-07-01')).toBeNull()
  })
})

describe('EcbExchangeRateProvider', () => {
  it('computes rateToEur = 1/obsValue from the fetched CSV and caches it', async () => {
    const saved: ExchangeRateResult[] = []
    let requestedUrl = ''
    const provider = new EcbExchangeRateProvider({
      onRateFetched: (r) => saved.push(r),
      fetchImpl: (async (url: string | URL | Request) => {
        requestedUrl = String(url)
        return new Response(FIXTURE_CSV, { status: 200 })
      }) as typeof fetch
    })
    const rate = await provider.getRate({ currency: 'USD', date: '2026-07-10' })
    expect(rate).toEqual({
      currency: 'USD',
      date: '2026-07-10',
      rateToEur: Math.round((1 / 1.1) * 1e6) / 1e6,
      source: 'ECB'
    })
    expect(requestedUrl).toContain('/D.USD.EUR.SP00.A')
    expect(requestedUrl).toContain('startPeriod=2026-07-03')
    expect(requestedUrl).toContain('endPeriod=2026-07-10')
    expect(requestedUrl).toContain('format=csvdata')
    expect(saved).toHaveLength(1)
  })

  it('returns 1 for EUR without fetching', async () => {
    const provider = new EcbExchangeRateProvider({
      fetchImpl: (() => {
        throw new Error('must not fetch')
      }) as unknown as typeof fetch
    })
    const rate = await provider.getRate({ currency: 'EUR', date: '2026-07-10' })
    expect(rate?.rateToEur).toBe(1)
  })

  it('never invents a rate: network failure → null', async () => {
    const provider = new EcbExchangeRateProvider({
      fetchImpl: (async () => {
        throw new Error('offline')
      }) as typeof fetch
    })
    expect(await provider.getRate({ currency: 'USD', date: '2026-07-10' })).toBeNull()
  })

  it('returns null for HTTP errors, empty data and invalid currencies', async () => {
    const notFound = new EcbExchangeRateProvider({
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch
    })
    expect(await notFound.getRate({ currency: 'USD', date: '2026-07-10' })).toBeNull()

    const empty = new EcbExchangeRateProvider({
      fetchImpl: (async () => new Response('KEY,TIME_PERIOD,OBS_VALUE', { status: 200 })) as typeof fetch
    })
    expect(await empty.getRate({ currency: 'USD', date: '2026-07-10' })).toBeNull()

    const invalid = new EcbExchangeRateProvider({
      fetchImpl: (async () => new Response(FIXTURE_CSV, { status: 200 })) as typeof fetch
    })
    expect(await invalid.getRate({ currency: 'USDT', date: '2026-07-10' })).toBeNull()
    expect(await invalid.getRate({ currency: 'USD', date: '10.07.2026' })).toBeNull()
  })
})
