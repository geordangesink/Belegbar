/**
 * Background refresh of the § 32a EStG tariff parameters from the official
 * law server (gesetze-im-internet.de).
 *
 * Behavior contract:
 * - never blocks the UI: initTariffUpdate() returns synchronously and all
 *   work happens fire-and-forget with a 5 s network timeout
 * - sends nothing but a plain GET of the public norm page
 * - any failure (offline, HTML change, parse/validation failure) is silent
 *   and leaves the built-in engines untouched — failure = status quo
 * - a successful fetch is cached at <dataDir>/database/tariff-cache.json;
 *   later boots register the cached override immediately and only refresh
 *   in the background at most once every 7 days
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  registerTariffOverride,
  tariffParamsEqual,
  type Section32aParams
} from '../../core/tax/tariff-override'
import {
  parseSection32aNormText,
  type ParsedTariffNorm
} from '../../core/tax/parse-norm-text'
import {
  getBuiltInTariffParams,
  listSupportedTaxYears
} from '../../core/tax/income-tax'
import type { Logger } from '../log'

export const TARIFF_SOURCE_URL = 'https://www.gesetze-im-internet.de/estg/__32a.html'

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000

export interface TariffCacheFile {
  version: 1
  /** ISO timestamp of the successful fetch */
  fetchedAt: string
  sourceUrl: string
  /** e.g. 'gii-20260715' — appended to the engine version label */
  sourceLabel: string
  /** assessment year the params apply to; null = informational cache only */
  year: number | null
  firstApplicableYear: number | null
  params: Section32aParams
}

export interface TariffUpdateOptions {
  dataDir: string
  /** injected for tests; production uses global fetch */
  fetchImpl?: typeof fetch
  /** injected for tests */
  now?: () => Date
  timeoutMs?: number
  log?: Logger
}

export type TariffUpdateOutcome = 'cache-fresh' | 'refreshed' | 'not-applicable' | 'failed'

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  sect: '§',
  euro: '€',
  bull: '•',
  middot: '·',
  sdot: '⋅',
  times: '×',
  ndash: '–',
  mdash: '—',
  minus: '−',
  shy: '­',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß'
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/** Strip tags/scripts/comments and decode HTML entities to plain text. */
export function stripHtmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  return decodeEntities(withoutBlocks.replace(/<[^>]*>/g, ' '))
}

// ---------------------------------------------------------------------------
// cache file
// ---------------------------------------------------------------------------

export function tariffCachePath(dataDir: string): string {
  return path.join(dataDir, 'database', 'tariff-cache.json')
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isSection32aParams(v: unknown): v is Section32aParams {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  const zone2 = p['zone2'] as Record<string, unknown> | undefined
  const zone3 = p['zone3'] as Record<string, unknown> | undefined
  const zone4 = p['zone4'] as Record<string, unknown> | undefined
  const zone5 = p['zone5'] as Record<string, unknown> | undefined
  return (
    isFiniteNumber(p['basicAllowance']) &&
    isFiniteNumber(p['zone2End']) &&
    isFiniteNumber(p['zone3End']) &&
    isFiniteNumber(p['zone4End']) &&
    typeof zone2 === 'object' && zone2 !== null &&
    isFiniteNumber(zone2['a']) && isFiniteNumber(zone2['b']) &&
    typeof zone3 === 'object' && zone3 !== null &&
    isFiniteNumber(zone3['a']) && isFiniteNumber(zone3['b']) && isFiniteNumber(zone3['c']) &&
    typeof zone4 === 'object' && zone4 !== null &&
    isFiniteNumber(zone4['rate']) && isFiniteNumber(zone4['sub']) &&
    typeof zone5 === 'object' && zone5 !== null &&
    isFiniteNumber(zone5['rate']) && isFiniteNumber(zone5['sub'])
  )
}

function isTariffCacheFile(v: unknown): v is TariffCacheFile {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    c['version'] === 1 &&
    typeof c['fetchedAt'] === 'string' &&
    Number.isFinite(Date.parse(c['fetchedAt'])) &&
    typeof c['sourceUrl'] === 'string' &&
    typeof c['sourceLabel'] === 'string' &&
    (c['year'] === null || isFiniteNumber(c['year'])) &&
    (c['firstApplicableYear'] === null || isFiniteNumber(c['firstApplicableYear'])) &&
    isSection32aParams(c['params'])
  )
}

/** Read + shape-check the cache; null on any problem. */
export async function readTariffCache(dataDir: string): Promise<TariffCacheFile | null> {
  try {
    const raw = await fs.readFile(tariffCachePath(dataDir), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isTariffCacheFile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeTariffCache(
  dataDir: string,
  cache: TariffCacheFile
): Promise<void> {
  const target = tariffCachePath(dataDir)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

// ---------------------------------------------------------------------------
// fetch + apply
// ---------------------------------------------------------------------------

async function fetchNormText(
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(TARIFF_SOURCE_URL, {
      signal: controller.signal,
      headers: { Accept: 'text/html' }
    })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') ?? ''
    const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
    let text: string
    try {
      text = new TextDecoder(charset).decode(buffer)
    } catch {
      text = new TextDecoder('utf-8').decode(buffer)
    }
    return stripHtmlToText(text)
  } catch {
    return null // offline / timeout / TLS error — silent, keep built-ins
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Which assessment year the parsed params may be applied to:
 * - the year the norm states ("ab dem Veranlagungszeitraum N"), else
 * - the current year, but ONLY when we ship a built-in engine for it whose
 *   params differ, or the year is newer than every built-in engine.
 * null = nothing to override (e.g. page matches the built-ins anyway).
 */
export function resolveTargetYear(parsed: ParsedTariffNorm, now: Date): number | null {
  if (parsed.firstApplicableYear !== null) return parsed.firstApplicableYear
  const year = now.getUTCFullYear()
  const supported = listSupportedTaxYears()
  const newest = supported.length > 0 ? Math.max(...supported) : null
  if (newest === null || year > newest) return year
  const builtIn = getBuiltInTariffParams(year)
  if (builtIn && !tariffParamsEqual(builtIn, parsed.params)) return year
  return null
}

function compactDate(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * One full update pass: register cached override, then fetch/parse/validate/
 * cache/register when the cache is missing or older than 7 days.
 * Exposed for tests; production entry point is initTariffUpdate().
 */
export async function runTariffUpdate(
  options: TariffUpdateOptions
): Promise<TariffUpdateOutcome> {
  const now = options.now?.() ?? new Date()
  const nowMs = now.getTime()

  const cache = await readTariffCache(options.dataDir)
  let cacheApplied = false
  if (cache) {
    if (cache.year === null) {
      cacheApplied = true // nothing to register, but the fetch date counts
    } else {
      try {
        // registerTariffOverride re-validates — a corrupt cache never wins
        registerTariffOverride(cache.year, cache.params, cache.sourceLabel)
        cacheApplied = true
      } catch {
        cacheApplied = false
      }
    }
  }

  const fetchedAtMs = cache ? Date.parse(cache.fetchedAt) : Number.NaN
  const cacheFresh =
    Number.isFinite(fetchedAtMs) &&
    fetchedAtMs <= nowMs &&
    nowMs - fetchedAtMs < REFRESH_INTERVAL_MS
  if (cacheFresh && cacheApplied) return 'cache-fresh'

  const fetchImpl = options.fetchImpl ?? fetch
  const text = await fetchNormText(fetchImpl, options.timeoutMs ?? FETCH_TIMEOUT_MS)
  if (text === null) return 'failed'

  const parsed = parseSection32aNormText(text)
  if (!parsed) return 'failed'

  const year = resolveTargetYear(parsed, now)
  const sourceLabel = `gii-${compactDate(now)}`
  const nextCache: TariffCacheFile = {
    version: 1,
    fetchedAt: now.toISOString(),
    sourceUrl: TARIFF_SOURCE_URL,
    sourceLabel,
    year,
    firstApplicableYear: parsed.firstApplicableYear,
    params: parsed.params
  }

  if (year !== null) {
    try {
      // validation happens inside — throws on implausible params
      registerTariffOverride(year, parsed.params, sourceLabel)
    } catch {
      return 'failed' // do not cache rejected params
    }
  }

  try {
    await writeTariffCache(options.dataDir, nextCache)
  } catch {
    // cache write failure only costs a re-fetch on the next boot
  }

  return year !== null ? 'refreshed' : 'not-applicable'
}

/**
 * Boot entry point: fire-and-forget, returns immediately, never throws.
 * Failure of any kind leaves the built-in §32a engines in charge.
 */
export function initTariffUpdate(options: TariffUpdateOptions): void {
  void runTariffUpdate(options)
    .then((outcome) => options.log?.info('tariff_update', { outcome }))
    .catch(() => options.log?.warn('tariff_update_failed'))
}
