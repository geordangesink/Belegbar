/**
 * Human-readable stored filename generation:
 *   YYYY_MM_DD-Company_Service-InvoiceNumber.pdf
 * with explicit placeholders for missing parts (never invented values):
 *   Unknown-Date / Unknown-Company / Unknown-Service / Unknown-Invoice
 */

export interface FilenameFields {
  /** ISO invoice date or null */
  invoiceDate: string | null
  /** counterparty: customer for income, supplier for expense */
  company: string | null
  /** service description / category */
  service: string | null
  invoiceNumber: string | null
}

export interface GeneratedFilename {
  filename: string
  /** which components fell back to placeholders */
  placeholders: ('date' | 'company' | 'service' | 'invoiceNumber')[]
}

export const MAX_FILENAME_LENGTH = 180

/** Sanitize one filename component (no path separators, traversal, reserved chars). */
export function sanitizeFilenameComponent(raw: string, maxLength?: number): string {
  throw new Error('not implemented')
}

export function generateStoredFilename(fields: FilenameFields): GeneratedFilename {
  throw new Error('not implemented')
}

/** Append -2, -3 … before .pdf on collision. */
export function withCollisionSuffix(filename: string, attempt: number): string {
  throw new Error('not implemented')
}
