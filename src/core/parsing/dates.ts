/**
 * Date parsing for German and English invoice formats.
 * Supported: 24.01.2026 / 24/01/2026 / 2026-01-24 / January 24, 2026 /
 * 24. Januar 2026 / 30 Nov 2025 / "4. September 2025" etc.
 * Output is always ISO YYYY-MM-DD or null.
 */

const MONTHS: Record<string, number> = {
  // English
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
  // German
  januar: 1, februar: 2, 'märz': 3, marz: 3, mai: 5, juni: 6, juli: 7,
  oktober: 10, dezember: 12,
  'mär': 3, mrz: 3, okt: 10, dez: 12
}

const MONTH_NAME_PATTERN =
  'Jan(?:uary|uar)?|Feb(?:ruary|ruar)?|M(?:ar(?:ch)?|är(?:z)?|rz)|Apr(?:il)?|Ma[iy]|Jun[ie]?|Jul[iy]?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|O[ck]t(?:ober)?|Nov(?:ember)?|De[cz](?:ember)?'

function monthFromName(name: string): number | null {
  const m = MONTHS[name.toLowerCase().replace(/\.$/, '')]
  return m ?? null
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  return toIso(Number(m[1]), Number(m[2]), Number(m[3])) === iso
}

export interface DateCandidate {
  iso: string
  index: number
  raw: string
  /** true when the raw form is DD/MM vs MM/DD ambiguous (both readings valid) */
  ambiguous: boolean
}

/**
 * Find all date candidates with offsets and ambiguity flags.
 * Numeric X/Y/ZZZZ is read as DD/MM (European default).
 */
export function findDatesDetailed(text: string): DateCandidate[] {
  const out: DateCandidate[] = []
  const seen = new Set<string>()
  const push = (iso: string | null, index: number, raw: string, ambiguous = false): void => {
    if (iso === null) return
    const key = `${index}:${raw}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ iso, index, raw, ambiguous })
  }

  // ISO YYYY-MM-DD
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g
  for (let m = isoRe.exec(text); m; m = isoRe.exec(text)) {
    push(toIso(Number(m[1]), Number(m[2]), Number(m[3])), m.index, m[0])
  }

  // DD.MM.YYYY / DD/MM/YYYY (also D.M.YYYY)
  const numRe = /(?<![\d.\/])(\d{1,2})([.\/])(\d{1,2})\2(\d{4})(?![\d.\/])/g
  for (let m = numRe.exec(text); m; m = numRe.exec(text)) {
    const a = Number(m[1])
    const b = Number(m[3])
    const year = Number(m[4])
    const sep = m[2]
    // dot form is unambiguously German DD.MM; slash form defaults to DD/MM
    const iso = toIso(year, b, a)
    if (iso !== null) {
      const ambiguous =
        sep === '/' && a <= 12 && b <= 12 && a !== b && toIso(year, a, b) !== null
      push(iso, m.index, m[0], ambiguous)
    } else if (sep === '/') {
      // DD/MM invalid but MM/DD valid (e.g. 04/25/2026) → accept MM/DD reading
      push(toIso(year, a, b), m.index, m[0])
    }
  }

  // Month D, YYYY  (October 7, 2025 / Oct 7 2025)
  const mdyRe = new RegExp(
    `\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'g'
  )
  for (let m = mdyRe.exec(text); m; m = mdyRe.exec(text)) {
    const month = monthFromName(m[1] ?? '')
    if (month === null) continue
    push(toIso(Number(m[3]), month, Number(m[2])), m.index, m[0])
  }

  // D Month YYYY  (30 Nov 2025 / 4. September 2025 / 02 Mai 2026)
  const dmyRe = new RegExp(
    `(?<!\\d)(\\d{1,2})\\.?\\s+(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{4})\\b`,
    'g'
  )
  for (let m = dmyRe.exec(text); m; m = dmyRe.exec(text)) {
    const month = monthFromName(m[2] ?? '')
    if (month === null) continue
    push(toIso(Number(m[3]), month, Number(m[1])), m.index, m[0])
  }

  out.sort((x, y) => x.index - y.index)
  return out
}

/** Find all date candidates in a text with their offsets (for labeling). */
export function findDates(text: string): { iso: string; index: number; raw: string }[] {
  return findDatesDetailed(text).map(({ iso, index, raw }) => ({ iso, index, raw }))
}

export function parseInvoiceDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const candidates = findDatesDetailed(trimmed)
  if (candidates.length === 0) return null
  // Whole-string parse: the first candidate must cover the meaningful text.
  const first = candidates[0]
  if (!first) return null
  return first.iso
}
