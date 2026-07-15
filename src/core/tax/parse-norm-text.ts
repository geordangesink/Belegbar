/**
 * PURE parser for the plain text of § 32a Abs. 1 EStG (German norm text,
 * e.g. from https://www.gesetze-im-internet.de/estg/__32a.html after HTML
 * stripping). Extracts the five-zone tariff parameters and — when stated —
 * the first assessment year the version applies to ("ab dem
 * Veranlagungszeitraum 2026").
 *
 * Liberal in whitespace and character variants (NBSP/narrow spaces, the
 * various middle-dot and dash characters, German number formatting),
 * strict in structure: every zone formula must be present and the zone
 * boundaries must chain exactly ("bis 12 348" → "von 12 349"). Returns
 * null on any structural doubt — the caller then keeps the built-ins.
 */
import type { Section32aParams } from './tariff-override'

export interface ParsedTariffNorm {
  params: Section32aParams
  /** e.g. 2026 from 'ab dem Veranlagungszeitraum 2026'; null when absent */
  firstApplicableYear: number | null
}

/** German-formatted number: optional space/dot thousands groups, comma decimals. */
const NUM = String.raw`\d{1,3}(?:[ .]\d{3})*(?:,\d+)?`
const G = `(${NUM})`
/** multiplication sign placeholder after normalization */
const DOT = '\\u00B7'

const RE_BASIC = new RegExp(`bis ${G} Euro \\(\\s*Grundfreibetrag\\s*\\)`, 'i')
const RE_ZONE2 = new RegExp(
  `von ${G} Euro bis ${G} Euro\\s*:?\\s*\\(\\s*${G}\\s*${DOT}\\s*y\\s*\\+\\s*${G}\\s*\\)\\s*${DOT}\\s*y`,
  'i'
)
const RE_ZONE3 = new RegExp(
  `von ${G} Euro bis ${G} Euro\\s*:?\\s*\\(\\s*${G}\\s*${DOT}\\s*z\\s*\\+\\s*${G}\\s*\\)\\s*${DOT}\\s*z\\s*\\+\\s*${G}`,
  'i'
)
const RE_ZONE4 = new RegExp(
  `von ${G} Euro bis ${G} Euro\\s*:?\\s*${G}\\s*${DOT}\\s*x\\s*-\\s*${G}`,
  'i'
)
const RE_ZONE5 = new RegExp(
  `von ${G} Euro an\\s*:?\\s*${G}\\s*${DOT}\\s*x\\s*-\\s*${G}`,
  'i'
)
const RE_VALIDITY = /ab dem Veranlagungszeitraum\s+(\d{4})/i

/**
 * Tolerant character normalization: unify exotic spaces, multiplication
 * dots and dash variants, drop soft hyphens, collapse whitespace runs.
 */
function normalize(text: string): string {
  return text
    .replace(/\u00AD/g, '') // soft hyphen: drop entirely
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ') // exotic spaces
    .replace(/[\u2022\u22C5\u2219\u2027\u00D7*]/g, '\u00B7') // bullet/dot-operator/times/asterisk
    .replace(/[\u2010-\u2015\u2212\u2043]/g, '-') // hyphen, dashes, minus sign
    .replace(/\s+/g, ' ')
}

/** '11 135,63' / '11.135,63' / '0,42' → number; NaN on nonsense. */
function parseGermanNumber(raw: string): number {
  return Number(raw.replace(/[ .]/g, '').replace(',', '.'))
}

export function parseSection32aNormText(text: string): ParsedTariffNorm | null {
  const t = normalize(text)

  const basic = RE_BASIC.exec(t)
  const zone2 = RE_ZONE2.exec(t)
  const zone3 = RE_ZONE3.exec(t)
  const zone4 = RE_ZONE4.exec(t)
  const zone5 = RE_ZONE5.exec(t)
  if (!basic || !zone2 || !zone3 || !zone4 || !zone5) return null

  const basicAllowance = parseGermanNumber(basic[1]!)
  const zone2From = parseGermanNumber(zone2[1]!)
  const zone2End = parseGermanNumber(zone2[2]!)
  const zone2A = parseGermanNumber(zone2[3]!)
  const zone2B = parseGermanNumber(zone2[4]!)
  const zone3From = parseGermanNumber(zone3[1]!)
  const zone3End = parseGermanNumber(zone3[2]!)
  const zone3A = parseGermanNumber(zone3[3]!)
  const zone3B = parseGermanNumber(zone3[4]!)
  const zone3C = parseGermanNumber(zone3[5]!)
  const zone4From = parseGermanNumber(zone4[1]!)
  const zone4End = parseGermanNumber(zone4[2]!)
  const zone4Rate = parseGermanNumber(zone4[3]!)
  const zone4Sub = parseGermanNumber(zone4[4]!)
  const zone5From = parseGermanNumber(zone5[1]!)
  const zone5Rate = parseGermanNumber(zone5[2]!)
  const zone5Sub = parseGermanNumber(zone5[3]!)

  const all = [
    basicAllowance,
    zone2From,
    zone2End,
    zone2A,
    zone2B,
    zone3From,
    zone3End,
    zone3A,
    zone3B,
    zone3C,
    zone4From,
    zone4End,
    zone4Rate,
    zone4Sub,
    zone5From,
    zone5Rate,
    zone5Sub
  ]
  if (!all.every(Number.isFinite)) return null

  // strict structure: the zones must chain seamlessly ("bis N" → "von N+1")
  if (zone2From !== basicAllowance + 1) return null
  if (zone3From !== zone2End + 1) return null
  if (zone4From !== zone3End + 1) return null
  if (zone5From !== zone4End + 1) return null

  const validity = RE_VALIDITY.exec(t)
  const validityYear = validity ? Number(validity[1]) : Number.NaN
  const firstApplicableYear =
    Number.isInteger(validityYear) && validityYear >= 2020 && validityYear <= 2099
      ? validityYear
      : null

  return {
    params: {
      basicAllowance,
      zone2End,
      zone3End,
      zone4End,
      zone2: { a: zone2A, b: zone2B },
      zone3: { a: zone3A, b: zone3B, c: zone3C },
      zone4: { rate: zone4Rate, sub: zone4Sub },
      zone5: { rate: zone5Rate, sub: zone5Sub }
    },
    firstApplicableYear
  }
}
