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

/**
 * Core money/date fields for the confidence scan: an uncertain reading of
 * any of these is potentially tax-relevant (warning), everything else is
 * merely minor. Narrower than TAX_RELEVANT_FIELDS on purpose — a shaky
 * invoice number or exchange rate already surfaces as an issue.
 */
const CORE_CONFIDENCE_FIELDS: ReadonlySet<string> = new Set([
  'invoiceDate',
  'currency',
  'grossAmount',
  'grossAmountOriginal',
  'netAmount',
  'netAmountOriginal',
  'vatAmount',
  'vatAmountOriginal'
])

export function attentionLevel(input: AttentionInput): AttentionLevel {
  // 1. + 2. review-state shortcuts
  if (input.reviewStatus === 'confirmed') return 'confirmed'
  if (input.reviewStatus === 'failed') return 'critical'

  // 3. + 4. issue tiers (critical beats warning beats minor)
  let hasWarningIssue = false
  let hasMinorIssue = false
  for (const issue of input.issues) {
    const tier = issueAttention(issue)
    if (tier === 'critical') return 'critical'
    if (tier === 'warning') hasWarningIssue = true
    else if (tier === 'minor') hasMinorIssue = true
  }
  if (hasWarningIssue || input.vatRequiresConfirmation === true) return 'warning'

  // 5. confidence scan — only reached when no issue forced a tier above
  // 'minor'. Exactly 0 means "not extracted", not "uncertain": a truly
  // missing amount already carries a critical issue, and a missing dueDate
  // is normal — neither should escalate here.
  let hasUncertainOtherField = false
  for (const [field, confidence] of Object.entries(input.fieldConfidence)) {
    if (!(confidence > 0 && confidence < MINOR_CONFIDENCE_THRESHOLD)) continue
    if (CORE_CONFIDENCE_FIELDS.has(field)) return 'warning'
    hasUncertainOtherField = true
  }
  if (hasUncertainOtherField || hasMinorIssue) return 'minor'

  // 6. still processing → not yet confident
  if (input.reviewStatus === 'processing') return 'minor'

  // 7. confident analysis
  return 'ok'
}

/** Convenience: derive the input from a full document (renderer use). */
export function attentionForDocument(doc: TaxDocument): AttentionLevel {
  const raw = doc.extractionRawJson as
    | { vatClassification?: { requiresUserConfirmation?: unknown } }
    | null
    | undefined
  return attentionLevel({
    reviewStatus: doc.reviewStatus,
    issues: doc.issues,
    fieldConfidence: doc.fieldConfidence,
    vatRequiresConfirmation: raw?.vatClassification?.requiresUserConfirmation === true
  })
}
