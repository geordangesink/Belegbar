/**
 * Locale-aware monetary number parsing.
 * Handles German ("1.300,00"), English ("1,300.00"), plain ("1300.00" / "1300")
 * and currency-adorned ("€23.00", "23,00 EUR", "$59.50") inputs.
 */

export type NumberLocaleHint = 'de' | 'en' | 'auto'

const CURRENCY_ADORNMENT = /(?:€|\$|£|\bEUR\b|\bUSD\b|\bUSDT\b|\bGBP\b|\bCHF\b)/gi

/** Parse a single monetary token. Returns null when ambiguous or invalid. */
export function parseLocalizedAmount(
  raw: string,
  hint: NumberLocaleHint = 'auto'
): number | null {
  if (typeof raw !== 'string') return null
  let s = raw.replace(CURRENCY_ADORNMENT, ' ').trim()
  // tolerate unicode minus and wrapping parentheses (accounting negatives)
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  if (/^[-−]/.test(s)) {
    negative = true
    s = s.replace(/^[-−]\s*/, '')
  }
  s = s.replace(/\s+/g, '')
  if (s.length === 0) return null
  if (!/^[\d.,']+$/.test(s)) return null
  // apostrophe thousands (Swiss style) are unambiguous
  s = s.replace(/'/g, '')

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  let normalized: string | null = null

  if (hasComma && hasDot) {
    // last separator wins as decimal separator
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = s.split(',')
    const tail = parts[parts.length - 1] ?? ''
    if (parts.length > 2) {
      // "1,300,000" — commas must be thousands; groups must be exactly 3 digits
      if (!parts.slice(1).every((g) => g.length === 3) || (parts[0] ?? '').length === 0) return null
      normalized = s.replace(/,/g, '')
    } else if (tail.length === 3 && (parts[0] ?? '').length <= 3) {
      // "1,300" — ambiguous between en thousands and de decimal-with-3-digits
      if (hint === 'en') normalized = s.replace(/,/g, '')
      else if (hint === 'de') normalized = s.replace(',', '.')
      else return null
    } else {
      // "23,00" / "7,5" / "1234,56" → decimal comma
      normalized = s.replace(/,/g, '.')
    }
  } else if (hasDot) {
    const parts = s.split('.')
    const tail = parts[parts.length - 1] ?? ''
    if (parts.length > 2) {
      // "1.300.000" — dots must be German thousands; groups must be exactly 3 digits
      if (!parts.slice(1).every((g) => g.length === 3) || (parts[0] ?? '').length === 0) return null
      normalized = s.replace(/\./g, '')
    } else if (tail.length === 3 && (parts[0] ?? '').length <= 3 && (parts[0] ?? '').length > 0) {
      // "1.300" — ambiguous between de thousands and en decimal-with-3-digits
      if (hint === 'de') normalized = s.replace(/\./g, '')
      else if (hint === 'en') normalized = s
      else return null
    } else {
      normalized = s
    }
  } else {
    normalized = s
  }

  if (normalized === null || normalized.length === 0) return null
  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/** Detect the dominant number locale used in a text block. */
export function detectNumberLocale(text: string): 'de' | 'en' | 'unknown' {
  let de = 0
  let en = 0
  // decimal comma / decimal dot with exactly 2 fraction digits
  de += (text.match(/\d,\d{2}(?![\d,.])/g) ?? []).length
  en += (text.match(/\d\.\d{2}(?![\d,.])/g) ?? []).length
  // grouped thousands with explicit decimal part
  de += (text.match(/\d{1,3}(?:\.\d{3})+,\d{2}/g) ?? []).length * 2
  en += (text.match(/\d{1,3}(?:,\d{3})+\.\d{2}/g) ?? []).length * 2
  if (de > en) return 'de'
  if (en > de) return 'en'
  return 'unknown'
}

/** Round to 2 decimals using half-up (commercial rounding). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return NaN
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  // EPSILON correction avoids 1.005 → 1.00 float artifacts
  return (sign * Math.round((abs + Number.EPSILON) * 100)) / 100
}
