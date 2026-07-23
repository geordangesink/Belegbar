/**
 * Locale-aware formatting helpers. Pure functions — safe to unit test in node.
 * Active locale is 'de' (de-DE) or 'en' (en-US).
 */
import type { ActiveLanguage } from '../i18n'

function intlLocale(lang: ActiveLanguage): string {
  return lang === 'de' ? 'de-DE' : 'en-US'
}

/** Kaufmännisches Runden (half away from zero) to 2 decimals. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100
}

export function formatEur(value: number, lang: ActiveLanguage): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'currency',
    currency: 'EUR'
  }).format(round2(value))
}

/** Formats an amount in its original currency; tolerates unknown codes. */
export function formatCurrencyAmount(
  value: number,
  currency: string | null,
  lang: ActiveLanguage
): string {
  const code = (currency ?? 'EUR').toUpperCase()
  try {
    return new Intl.NumberFormat(intlLocale(lang), {
      style: 'currency',
      currency: code
    }).format(round2(value))
  } catch {
    const num = new Intl.NumberFormat(intlLocale(lang), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(round2(value))
    return `${num} ${code}`
  }
}

export function formatNumber(value: number, lang: ActiveLanguage, digits = 2): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value)
}

export function formatMonth(
  month: number,
  lang: ActiveLanguage,
  width: 'short' | 'long' = 'long'
): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) return ''
  return new Intl.DateTimeFormat(intlLocale(lang), { month: width }).format(
    new Date(2020, month - 1, 1)
  )
}

/** Formats an ISO YYYY-MM-DD date; returns the input when not parseable. */
export function formatIsoDate(iso: string | null | undefined, lang: ActiveLanguage): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: 'medium' }).format(date)
}

/** Formats an ISO timestamp (audit trail). */
export function formatIsoDateTime(iso: string | null | undefined, lang: ActiveLanguage): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(intlLocale(lang), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function currentQuarter(): 1 | 2 | 3 | 4 {
  return (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4
}

/**
 * Parses a user-typed decimal in either German or English notation
 * ("1.234,56", "1,234.56", "1234.56", "1234,56"). Returns null when invalid.
 */
export function parseDecimalInput(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return null
  let normalized = s.replace(/\s/g, '')
  const lastComma = normalized.lastIndexOf(',')
  const lastDot = normalized.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    // single comma → decimal separator; multiple commas → thousands
    normalized =
      normalized.indexOf(',') === lastComma
        ? normalized.replace(',', '.')
        : normalized.replace(/,/g, '')
  }
  if (!/^-?\d*(\.\d*)?$/.test(normalized) || normalized === '-' || normalized === '.') return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Sanitized preview of the stored filename after edits (server does the real rename). */
export function previewFilename(parts: {
  invoiceDate: string | null
  counterparty: string | null
  invoiceNumber: string | null
}): string {
  const clean = (s: string): string =>
    s
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
  const segments = [
    parts.invoiceDate ?? '',
    parts.counterparty ? clean(parts.counterparty) : '',
    parts.invoiceNumber ? clean(parts.invoiceNumber) : ''
  ].filter((s) => s.length > 0)
  return `${segments.join('_') || 'beleg'}.pdf`
}

/** "a1b2c3d4" style short id for links. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
