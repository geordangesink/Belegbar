import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearSoliOverrides,
  getSoliOverride
} from '../../src/core/tax/soli-rules'
import {
  getBuiltInSoliRules,
  getIncomeTaxEngine
} from '../../src/core/tax/income-tax'
import {
  SOLI_SECTION_3_SOURCE_URL,
  SOLI_SECTION_4_SOURCE_URL,
  SOLI_SECTION_6_SOURCE_URL,
  initSoliUpdate,
  readSoliCache,
  runSoliUpdate,
  soliCachePath,
  writeSoliCache,
  type SoliCacheFile
} from '../../src/main/tax/soli-update'

const NOW = new Date('2026-07-15T09:00:00.000Z')
const now = (): Date => NOW

const SECTION_3 = `
  <html><body><h1>§ 3 Bemessungsgrundlage und Freigrenze</h1>
  <p>(3) Der Solidaritätszuschlag ist von einkommensteuerpflichtigen Personen
  nur zu erheben, wenn die Bemessungsgrundlage nach Absatz 2, vermindert um
  die anzurechnende oder vergütete Körperschaftsteuer, folgenden Betrag übersteigt:</p>
  <ol><li>in den Fällen des § 32a Absatz 5 und 6 des Einkommensteuergesetzes
  40&nbsp;700 Euro,</li><li>in anderen Fällen 20&nbsp;350 Euro.</li></ol>
  </body></html>`

const SECTION_4 = `
  <html><body><h1>§ 4 Zuschlagsatz</h1>
  <p>Der Solidaritätszuschlag beträgt 5,5 Prozent der Bemessungsgrundlage.</p>
  <p>Abweichend davon beträgt der Solidaritätszuschlag nicht mehr als
  11,9 Prozent des Unterschiedsbetrages. Bruchteile eines Cents bleiben
  außer Ansatz.</p></body></html>`

const SECTION_6 = `
  <html><body><h1>§ 6 Anwendungsvorschriften</h1>
  <p>§ 3 Absatz 3 in der am 1. Januar 2025 geltenden Fassung ist erstmals im
  Veranlagungszeitraum 2025 anzuwenden.</p>
  <p>§ 3 Absatz 3 in der am 1. Januar 2026 geltenden Fassung ist erstmals im
  Veranlagungszeitraum 2026 anzuwenden.</p></body></html>`

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-soli-'))
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
}

function makeFetch(): typeof fetch {
  return async (input) => {
    const url = String(input)
    if (url === SOLI_SECTION_3_SOURCE_URL) return htmlResponse(SECTION_3)
    if (url === SOLI_SECTION_4_SOURCE_URL) return htmlResponse(SECTION_4)
    if (url === SOLI_SECTION_6_SOURCE_URL) return htmlResponse(SECTION_6)
    return htmlResponse('not found', 404)
  }
}

function makeCache(overrides: Partial<SoliCacheFile> = {}): SoliCacheFile {
  return {
    version: 1,
    fetchedAt: '2026-07-10T00:00:00.000Z',
    sourceUrls: {
      section3: SOLI_SECTION_3_SOURCE_URL,
      section4: SOLI_SECTION_4_SOURCE_URL,
      section6: SOLI_SECTION_6_SOURCE_URL
    },
    sourceLabel: 'gii-solzg-20260710',
    year: 2026,
    firstApplicableYear: 2026,
    rules: getBuiltInSoliRules(2026)!,
    ...overrides
  }
}

afterEach(() => clearSoliOverrides())

describe('Soli cache', () => {
  it('round-trips atomically', async () => {
    const dir = tempDir()
    const cache = makeCache()
    await writeSoliCache(dir, cache)
    expect(await readSoliCache(dir)).toEqual(cache)
    expect(soliCachePath(dir)).toBe(path.join(dir, 'database', 'soli-cache.json'))
  })

  it('rejects corrupt and misshapen files', async () => {
    const dir = tempDir()
    expect(await readSoliCache(dir)).toBeNull()
    fs.mkdirSync(path.dirname(soliCachePath(dir)), { recursive: true })
    fs.writeFileSync(soliCachePath(dir), '{broken', 'utf8')
    expect(await readSoliCache(dir)).toBeNull()
    fs.writeFileSync(
      soliCachePath(dir),
      JSON.stringify({ ...makeCache(), year: '2026' }),
      'utf8'
    )
    expect(await readSoliCache(dir)).toBeNull()
  })
})

describe('runSoliUpdate', () => {
  it('fetches, parses, validates, caches and registers all official sections', async () => {
    const dir = tempDir()
    const requested: string[] = []
    const baseFetch = makeFetch()
    const fetchImpl: typeof fetch = async (input, init) => {
      requested.push(String(input))
      return baseFetch(input, init)
    }

    expect(await runSoliUpdate({ dataDir: dir, fetchImpl, now })).toBe('refreshed')
    expect(requested.sort()).toEqual(
      [
        SOLI_SECTION_3_SOURCE_URL,
        SOLI_SECTION_4_SOURCE_URL,
        SOLI_SECTION_6_SOURCE_URL
      ].sort()
    )
    expect(getSoliOverride(2026)).toEqual({
      year: 2026,
      sourceLabel: 'gii-solzg-20260715',
      rules: getBuiltInSoliRules(2026)
    })
    expect(getIncomeTaxEngine(2026).engine.version).toBe(
      '2026.1+gii-solzg-20260715'
    )
    expect(await readSoliCache(dir)).toMatchObject({
      version: 1,
      fetchedAt: NOW.toISOString(),
      sourceLabel: 'gii-solzg-20260715',
      year: 2026,
      firstApplicableYear: 2026,
      rules: getBuiltInSoliRules(2026)
    })
  })

  it('registers a fresh cache without touching the network', async () => {
    const dir = tempDir()
    await writeSoliCache(dir, makeCache())
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      throw new Error('offline')
    }

    expect(await runSoliUpdate({ dataDir: dir, fetchImpl, now })).toBe('cache-fresh')
    expect(calls).toBe(0)
    expect(getSoliOverride(2026)?.sourceLabel).toBe('gii-solzg-20260710')
  })

  it('re-fetches when cached rules fail validation', async () => {
    const dir = tempDir()
    const cache = makeCache()
    cache.rules = { ...cache.rules, thresholdJoint: 1 }
    await writeSoliCache(dir, cache)

    expect(await runSoliUpdate({ dataDir: dir, fetchImpl: makeFetch(), now })).toBe(
      'refreshed'
    )
    expect(getSoliOverride(2026)?.rules).toEqual(getBuiltInSoliRules(2026))
  })

  it('keeps bundled rules when any page is missing or changed', async () => {
    const dir = tempDir()
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input) === SOLI_SECTION_4_SOURCE_URL) {
        return htmlResponse('<html><body>Wartungsarbeiten</body></html>')
      }
      return makeFetch()(input)
    }

    expect(await runSoliUpdate({ dataDir: dir, fetchImpl, now })).toBe('failed')
    expect(getSoliOverride(2026)).toBeUndefined()
    expect(fs.existsSync(soliCachePath(dir))).toBe(false)
    expect(getIncomeTaxEngine(2026).engine.version).toBe('2026.1')
  })
})

describe('initSoliUpdate', () => {
  it('returns synchronously and contains background failures', async () => {
    const dir = tempDir()
    let resolved = false
    const fetchImpl: typeof fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      resolved = true
      throw new Error('offline')
    }

    expect(initSoliUpdate({ dataDir: dir, fetchImpl, now })).toBeUndefined()
    expect(resolved).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(resolved).toBe(true)
    expect(getSoliOverride(2026)).toBeUndefined()
  })
})
