import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TARIFF_SOURCE_URL,
  readTariffCache,
  resolveTargetYear,
  runTariffUpdate,
  initTariffUpdate,
  stripHtmlToText,
  tariffCachePath,
  writeTariffCache,
  type TariffCacheFile
} from '../../src/main/tax/tariff-update'
import { parseSection32aNormText } from '../../src/core/tax/parse-norm-text'
import {
  GII_32A_HTML_EXCERPT_2026,
  NORM_TEXT_32A_2026
} from '../../src/core/tax/parse-norm-text.fixtures'
import {
  getBuiltInTariffParams,
  getIncomeTaxEngine
} from '../../src/core/tax/income-tax'
import {
  clearTariffOverrides,
  getTariffOverride
} from '../../src/core/tax/tariff-override'

const NOW = new Date('2026-07-15T09:00:00.000Z')
const now = (): Date => NOW

const FULL_PAGE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
  '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="de"><head>' +
  '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />' +
  '<title>&#167; 32a EStG - Einzelnorm</title>' +
  '<style>.x { color: red }</style></head><body>' +
  '<script type="text/javascript">document.write("von 1 Euro bis 2 Euro: fake");</script>' +
  '<!-- von 3 Euro bis 4 Euro: comment junk -->' +
  '<h1>Einkommensteuergesetz (EStG)<br /><span class="jnenbez">&#167; 32a</span>&#160;' +
  '<span class="jnentitel">Einkommensteuertarif</span></h1>' +
  GII_32A_HTML_EXCERPT_2026 +
  '<div id="fusszeile">Impressum</div></body></html>'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-tariff-'))
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=iso-8859-1' }
  })
}

function makeCache(overrides: Partial<TariffCacheFile> = {}): TariffCacheFile {
  return {
    version: 1,
    fetchedAt: '2026-07-10T00:00:00.000Z',
    sourceUrl: TARIFF_SOURCE_URL,
    sourceLabel: 'gii-20260710',
    year: 2026,
    firstApplicableYear: 2026,
    params: getBuiltInTariffParams(2026)!,
    ...overrides
  }
}

afterEach(() => clearTariffOverrides())

describe('stripHtmlToText', () => {
  it('removes tags, scripts, styles and comments and decodes entities', () => {
    const text = stripHtmlToText(FULL_PAGE)
    expect(text).not.toContain('<')
    expect(text).not.toContain('fake')
    expect(text).not.toContain('comment junk')
    expect(text).toContain('§ 32a')
    expect(text).toContain('bis 12 348 Euro (Grundfreibetrag)')
    expect(text).toContain('0,42 • x – 11 135,63')
  })

  it('decodes decimal, hex and named entities', () => {
    expect(stripHtmlToText('&#167;&#x20AC;&auml;&szlig;&nbsp;x')).toBe('§€äß x')
    expect(stripHtmlToText('&unknown; stays')).toBe('&unknown; stays')
  })
})

describe('official page fixture end-to-end', () => {
  it('strip → parse reproduces the built-in 2026 params exactly', () => {
    const parsed = parseSection32aNormText(stripHtmlToText(FULL_PAGE))
    expect(parsed).not.toBeNull()
    expect(parsed!.params).toEqual(getBuiltInTariffParams(2026))
    expect(parsed!.firstApplicableYear).toBe(2026)
  })

  it('the committed HTML excerpt matches the committed plain-text fixture', () => {
    expect(parseSection32aNormText(stripHtmlToText(GII_32A_HTML_EXCERPT_2026))).toEqual(
      parseSection32aNormText(NORM_TEXT_32A_2026)
    )
  })
})

describe('resolveTargetYear', () => {
  const parsedNoValidity = parseSection32aNormText(
    NORM_TEXT_32A_2026.replace(/ab dem Veranlagungszeitraum 2026 /, '')
  )!

  it('uses the stated validity year regardless of the clock', () => {
    const parsed = parseSection32aNormText(NORM_TEXT_32A_2026)!
    expect(resolveTargetYear(parsed, new Date('2030-01-01T00:00:00Z'))).toBe(2026)
  })

  it('without validity info: null when params equal the built-in of the current year', () => {
    expect(resolveTargetYear(parsedNoValidity, NOW)).toBeNull()
  })

  it('without validity info: current year when the built-in differs', () => {
    const p = parsedNoValidity.params
    const differing = {
      params: { ...p, zone3: { ...p.zone3, c: p.zone3.c + 1.5 } },
      firstApplicableYear: null
    }
    expect(resolveTargetYear(differing, NOW)).toBe(2026)
  })

  it('without validity info: applies to years newer than any built-in engine', () => {
    expect(
      resolveTargetYear(parsedNoValidity, new Date('2027-03-01T00:00:00Z'))
    ).toBe(2027)
  })
})

describe('tariff cache file', () => {
  it('round-trips through <dataDir>/database/tariff-cache.json', async () => {
    const dir = tempDir()
    const cache = makeCache()
    await writeTariffCache(dir, cache)
    expect(fs.existsSync(path.join(dir, 'database', 'tariff-cache.json'))).toBe(true)
    expect(tariffCachePath(dir)).toBe(path.join(dir, 'database', 'tariff-cache.json'))
    expect(await readTariffCache(dir)).toEqual(cache)
  })

  it('returns null for missing, corrupt or misshapen cache files', async () => {
    const dir = tempDir()
    expect(await readTariffCache(dir)).toBeNull()
    fs.mkdirSync(path.join(dir, 'database'), { recursive: true })
    fs.writeFileSync(tariffCachePath(dir), 'not json {', 'utf8')
    expect(await readTariffCache(dir)).toBeNull()
    fs.writeFileSync(tariffCachePath(dir), JSON.stringify({ version: 2 }), 'utf8')
    expect(await readTariffCache(dir)).toBeNull()
    fs.writeFileSync(
      tariffCachePath(dir),
      JSON.stringify({ ...makeCache(), params: { basicAllowance: 'x' } }),
      'utf8'
    )
    expect(await readTariffCache(dir)).toBeNull()
  })
})

describe('runTariffUpdate', () => {
  it('fetch → parse → validate → cache → register (happy path)', async () => {
    const dir = tempDir()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return htmlResponse(FULL_PAGE)
    }

    const outcome = await runTariffUpdate({ dataDir: dir, fetchImpl, now })
    expect(outcome).toBe('refreshed')
    expect(calls).toBe(1)

    const override = getTariffOverride(2026)
    expect(override?.sourceLabel).toBe('gii-20260715')
    expect(override?.params).toEqual(getBuiltInTariffParams(2026))
    expect(getIncomeTaxEngine(2026)).toMatchObject({
      exactYearMatch: true,
      engine: { year: 2026, version: '2026.1+gii-20260715' }
    })

    const cache = await readTariffCache(dir)
    expect(cache).toMatchObject({
      version: 1,
      fetchedAt: NOW.toISOString(),
      sourceUrl: TARIFF_SOURCE_URL,
      sourceLabel: 'gii-20260715',
      year: 2026,
      firstApplicableYear: 2026
    })
    expect(cache?.params).toEqual(getBuiltInTariffParams(2026))
  })

  it('registers from a fresh cache without touching the network', async () => {
    const dir = tempDir()
    await writeTariffCache(
      dir,
      makeCache({ fetchedAt: new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString() })
    )
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      throw new Error('no network in tests')
    }

    const outcome = await runTariffUpdate({ dataDir: dir, fetchImpl, now })
    expect(outcome).toBe('cache-fresh')
    expect(calls).toBe(0)
    expect(getTariffOverride(2026)?.sourceLabel).toBe('gii-20260710')
    expect(getIncomeTaxEngine(2026).engine.version).toBe('2026.1+gii-20260710')
  })

  it('refreshes in the background when the cache is older than 7 days', async () => {
    const dir = tempDir()
    await writeTariffCache(
      dir,
      makeCache({ fetchedAt: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString() })
    )
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return htmlResponse(FULL_PAGE)
    }

    const outcome = await runTariffUpdate({ dataDir: dir, fetchImpl, now })
    expect(outcome).toBe('refreshed')
    expect(calls).toBe(1)
    expect(getTariffOverride(2026)?.sourceLabel).toBe('gii-20260715')
    expect((await readTariffCache(dir))?.fetchedAt).toBe(NOW.toISOString())
  })

  it('re-fetches when the cached params no longer pass validation', async () => {
    const dir = tempDir()
    const bad = makeCache({
      fetchedAt: new Date(NOW.getTime() - 3600 * 1000).toISOString()
    })
    bad.params = { ...bad.params, basicAllowance: 5000 } // shape-valid, implausible
    await writeTariffCache(dir, bad)
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return htmlResponse(FULL_PAGE)
    }

    const outcome = await runTariffUpdate({ dataDir: dir, fetchImpl, now })
    expect(outcome).toBe('refreshed')
    expect(calls).toBe(1)
    expect(getTariffOverride(2026)?.sourceLabel).toBe('gii-20260715')
  })

  it('network failure without cache → failed, built-ins untouched, no cache file', async () => {
    const dir = tempDir()
    const fetchImpl: typeof fetch = async () => {
      throw new Error('offline')
    }
    expect(await runTariffUpdate({ dataDir: dir, fetchImpl, now })).toBe('failed')
    expect(getTariffOverride(2026)).toBeUndefined()
    expect(fs.existsSync(tariffCachePath(dir))).toBe(false)
    expect(getIncomeTaxEngine(2026).engine.version).toBe('2026.1')
  })

  it('unparseable page → failed, nothing cached or registered', async () => {
    const dir = tempDir()
    const fetchImpl: typeof fetch = async () =>
      htmlResponse('<html><body>Wartungsarbeiten</body></html>')
    expect(await runTariffUpdate({ dataDir: dir, fetchImpl, now })).toBe('failed')
    expect(getTariffOverride(2026)).toBeUndefined()
    expect(fs.existsSync(tariffCachePath(dir))).toBe(false)
  })

  it('HTTP error status → failed', async () => {
    const dir = tempDir()
    const fetchImpl: typeof fetch = async () => htmlResponse('Service Unavailable', 503)
    expect(await runTariffUpdate({ dataDir: dir, fetchImpl, now })).toBe('failed')
    expect(getTariffOverride(2026)).toBeUndefined()
  })
})

describe('initTariffUpdate', () => {
  it('returns synchronously and swallows failures silently', async () => {
    const dir = tempDir()
    let resolved = false
    const fetchImpl: typeof fetch = async () => {
      await new Promise((r) => setTimeout(r, 10))
      resolved = true
      throw new Error('offline')
    }
    expect(initTariffUpdate({ dataDir: dir, fetchImpl, now })).toBeUndefined()
    expect(resolved).toBe(false) // did not block on the network
    await new Promise((r) => setTimeout(r, 50))
    expect(resolved).toBe(true)
    expect(getTariffOverride(2026)).toBeUndefined()
  })
})
