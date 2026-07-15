/**
 * Locale-aware monetary number parsing.
 * Handles German ("1.300,00"), English ("1,300.00"), plain ("1300.00" / "1300")
 * and currency-adorned ("€23.00", "23,00 EUR", "$59.50") inputs.
 */

export type NumberLocaleHint = 'de' | 'en' | 'auto'

/** Parse a single monetary token. Returns null when ambiguous or invalid. */
export function parseLocalizedAmount(
  raw: string,
  hint: NumberLocaleHint = 'auto'
): number | null {
  throw new Error('not implemented')
}

/** Detect the dominant number locale used in a text block. */
export function detectNumberLocale(text: string): 'de' | 'en' | 'unknown' {
  throw new Error('not implemented')
}

/** Round to 2 decimals using half-up (commercial rounding). */
export function roundMoney(value: number): number {
  throw new Error('not implemented')
}
