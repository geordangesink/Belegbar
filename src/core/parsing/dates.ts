/**
 * Date parsing for German and English invoice formats.
 * Supported: 24.01.2026 / 24/01/2026 / 2026-01-24 / January 24, 2026 /
 * 24. Januar 2026 / 30 Nov 2025 / "4. September 2025" etc.
 * Output is always ISO YYYY-MM-DD or null.
 */

export function parseInvoiceDate(raw: string): string | null {
  throw new Error('not implemented')
}

/** Find all date candidates in a text with their offsets (for labeling). */
export function findDates(text: string): { iso: string; index: number; raw: string }[] {
  throw new Error('not implemented')
}

export function isValidIsoDate(iso: string): boolean {
  throw new Error('not implemented')
}
