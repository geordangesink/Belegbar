/**
 * Deterministic, locale-aware invoice text parsing.
 * Input: extracted plain text (native PDF text layer or OCR output).
 * Output: structured fields with per-field confidence + consistency issues.
 *
 * No Electron/Node imports allowed — pure functions only.
 */
import type { ExtractedInvoiceData, DocumentDirection } from '../../shared/domain'

export interface ParseInvoiceOptions {
  direction: DocumentDirection
  /** the user's own business identity, used to tell issuer from recipient */
  ownName?: string
  ownVatId?: string
  ocrUsed: boolean
  ocrPages: number[]
}

export const PARSER_VERSION = '1.0.0'

export function parseInvoiceText(
  text: string,
  options: ParseInvoiceOptions
): ExtractedInvoiceData {
  throw new Error('not implemented')
}
