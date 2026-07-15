/**
 * The single source of truth for the user-facing document status
 * (AttentionLevel). Every list, panel and detail view must derive its
 * status glyph from here — never from reviewStatus or raw issues directly.
 *
 * Tier philosophy (user-defined):
 *  - critical  RED TRIANGLE   only for real concerns: the document cannot be
 *              safely included in tax totals (critical-severity issues)
 *  - warning   YELLOW TRIANGLE only for potentially tax-relevant problems
 *              (wrong amounts/dates/VAT would change a filing)
 *  - minor     YELLOW RING    uncertain-but-unimportant readings (a missing
 *              description never changes anyone's tax)
 *  - ok        GREEN RING     confident analysis, one-click confirm
 *  - confirmed GREEN CHECK    the user confirmed the document
 */
import type { AttentionLevel, DocumentIssue, TaxDocument } from '../../shared/domain'

/** Issue codes that are tax-relevant when present as warnings. */
export const TAX_RELEVANT_CODES: ReadonlySet<string> = new Set([
  'missing_exchange_rate',
  'non_iso_currency',
  'possible_duplicate',
  'refund_detected',
  'possibly_not_invoice',
  'unclear_business_status',
  'unclear_recipient_country',
  'ambiguous_date_format'
])

/** Fields whose values change a tax filing when wrong. */
export const TAX_RELEVANT_FIELDS: ReadonlySet<string> = new Set([
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'netAmount',
  'netAmountOriginal',
  'vatAmount',
  'vatAmountOriginal',
  'grossAmount',
  'grossAmountOriginal',
  'exchangeRateToEur'
])

const MINOR_CONFIDENCE_THRESHOLD = 0.85

/** Attention tier a single issue maps to. */
export function issueAttention(issue: DocumentIssue): Exclude<AttentionLevel, 'confirmed' | 'ok'> | null {
  if (issue.severity === 'critical') return 'critical'
  if (issue.severity === 'info') return null
  // llm_disagreement counts as tax-relevant only when it hits a tax field
  if (issue.code === 'llm_disagreement') {
    const field = (issue.params?.field as string | undefined) ?? issue.field ?? ''
    return TAX_RELEVANT_FIELDS.has(field) ? 'warning' : 'minor'
  }
  return TAX_RELEVANT_CODES.has(issue.code) ? 'warning' : 'minor'
}

export interface AttentionInput {
  reviewStatus: TaxDocument['reviewStatus']
  issues: DocumentIssue[]
  fieldConfidence: Record<string, number>
  /** stored VAT classification, when available (extractionRawJson.vatClassification) */
  vatRequiresConfirmation?: boolean
}

export function attentionLevel(input: AttentionInput): AttentionLevel {
  throw new Error('not implemented')
}

/** Convenience: derive the input from a full document (renderer use). */
export function attentionForDocument(doc: TaxDocument): AttentionLevel {
  throw new Error('not implemented')
}
