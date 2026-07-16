import fs from 'node:fs/promises'
import path from 'node:path'
import { parseSolzgText } from '../../core/tax/parse-solzg-text'
import {
  registerSoliOverride,
  type SoliRules
} from '../../core/tax/soli-rules'
import type { Logger } from '../log'
import { stripHtmlToText } from './tariff-update'

export const SOLI_SECTION_3_SOURCE_URL =
  'https://www.gesetze-im-internet.de/solzg_1995/__3.html'
export const SOLI_SECTION_4_SOURCE_URL =
  'https://www.gesetze-im-internet.de/solzg_1995/__4.html'
export const SOLI_SECTION_6_SOURCE_URL =
  'https://www.gesetze-im-internet.de/solzg_1995/__6.html'

const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000

export interface SoliCacheFile {
  version: 1
  fetchedAt: string
  sourceUrls: {
    section3: string
    section4: string
    section6: string
  }
  sourceLabel: string
  year: number
  firstApplicableYear: number
  rules: SoliRules
}

export interface SoliUpdateOptions {
  dataDir: string
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  log?: Logger
}

export type SoliUpdateOutcome = 'cache-fresh' | 'refreshed' | 'failed'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSoliRules(value: unknown): value is SoliRules {
  if (typeof value !== 'object' || value === null) return false
  const rules = value as Record<string, unknown>
  return (
    isFiniteNumber(rules['thresholdSingle']) &&
    isFiniteNumber(rules['thresholdJoint']) &&
    isFiniteNumber(rules['rate']) &&
    isFiniteNumber(rules['mitigationRate']) &&
    rules['centRounding'] === 'down'
  )
}

function isSoliCacheFile(value: unknown): value is SoliCacheFile {
  if (typeof value !== 'object' || value === null) return false
  const cache = value as Record<string, unknown>
  const urls = cache['sourceUrls'] as Record<string, unknown> | undefined
  return (
    cache['version'] === 1 &&
    typeof cache['fetchedAt'] === 'string' &&
    Number.isFinite(Date.parse(cache['fetchedAt'])) &&
    typeof urls === 'object' &&
    urls !== null &&
    urls['section3'] === SOLI_SECTION_3_SOURCE_URL &&
    urls['section4'] === SOLI_SECTION_4_SOURCE_URL &&
    urls['section6'] === SOLI_SECTION_6_SOURCE_URL &&
    typeof cache['sourceLabel'] === 'string' &&
    /^gii-solzg-\d{8}$/.test(cache['sourceLabel']) &&
    Number.isInteger(cache['year']) &&
    Number.isInteger(cache['firstApplicableYear']) &&
    cache['year'] === cache['firstApplicableYear'] &&
    isSoliRules(cache['rules'])
  )
}

export function soliCachePath(dataDir: string): string {
  return path.join(dataDir, 'database', 'soli-cache.json')
}

export async function readSoliCache(dataDir: string): Promise<SoliCacheFile | null> {
  try {
    const raw = await fs.readFile(soliCachePath(dataDir), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isSoliCacheFile(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeSoliCache(
  dataDir: string,
  cache: SoliCacheFile
): Promise<void> {
  const target = soliCachePath(dataDir)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await fs.writeFile(temporary, JSON.stringify(cache, null, 2), 'utf8')
  await fs.rename(temporary, target)
}

function decodeResponse(response: Response): Promise<string> {
  return response.arrayBuffer().then((buffer) => {
    const contentType = response.headers.get('content-type') ?? ''
    const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
    try {
      return new TextDecoder(charset).decode(buffer)
    } catch {
      return new TextDecoder('utf-8').decode(buffer)
    }
  })
}

async function fetchLawSections(
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<[string, string, string] | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const urls = [
    SOLI_SECTION_3_SOURCE_URL,
    SOLI_SECTION_4_SOURCE_URL,
    SOLI_SECTION_6_SOURCE_URL
  ] as const

  try {
    const responses = await Promise.all(
      urls.map((url) =>
        fetchImpl(url, {
          signal: controller.signal,
          headers: { Accept: 'text/html' }
        })
      )
    )
    if (responses.some((response) => !response.ok)) return null
    const html = await Promise.all(responses.map(decodeResponse))
    return html.map(stripHtmlToText) as [string, string, string]
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function compactDate(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

export async function runSoliUpdate(
  options: SoliUpdateOptions
): Promise<SoliUpdateOutcome> {
  const now = options.now?.() ?? new Date()
  const nowMs = now.getTime()
  const cache = await readSoliCache(options.dataDir)
  let cacheApplied = false

  if (cache) {
    try {
      registerSoliOverride(cache.year, cache.rules, cache.sourceLabel)
      cacheApplied = true
    } catch {
      cacheApplied = false
    }
  }

  const fetchedAtMs = cache ? Date.parse(cache.fetchedAt) : Number.NaN
  const cacheFresh =
    Number.isFinite(fetchedAtMs) &&
    fetchedAtMs <= nowMs &&
    nowMs - fetchedAtMs < REFRESH_INTERVAL_MS
  if (cacheFresh && cacheApplied) return 'cache-fresh'

  const sections = await fetchLawSections(
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? FETCH_TIMEOUT_MS
  )
  if (!sections) return 'failed'

  const parsed = parseSolzgText(...sections)
  if (!parsed) return 'failed'

  const sourceLabel = `gii-solzg-${compactDate(now)}`
  try {
    registerSoliOverride(parsed.firstApplicableYear, parsed.rules, sourceLabel)
  } catch {
    return 'failed'
  }

  const nextCache: SoliCacheFile = {
    version: 1,
    fetchedAt: now.toISOString(),
    sourceUrls: {
      section3: SOLI_SECTION_3_SOURCE_URL,
      section4: SOLI_SECTION_4_SOURCE_URL,
      section6: SOLI_SECTION_6_SOURCE_URL
    },
    sourceLabel,
    year: parsed.firstApplicableYear,
    firstApplicableYear: parsed.firstApplicableYear,
    rules: parsed.rules
  }

  try {
    await writeSoliCache(options.dataDir, nextCache)
  } catch {
    // A cache failure only causes another official-source refresh next boot.
  }

  return 'refreshed'
}

export function initSoliUpdate(options: SoliUpdateOptions): void {
  void runSoliUpdate(options)
    .then((outcome) => options.log?.info('soli_update', { outcome }))
    .catch(() => options.log?.warn('soli_update_failed'))
}
