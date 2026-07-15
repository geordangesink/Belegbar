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

/**
 * Issue codes that are tax-relevant when present as warnings.
 * NOT in this set on purpose:
 *  - ambiguous_date_format: the parser's corroboration pass caps genuinely
 *    ambiguous dates below 0.85, and the core-field confidence scan escalates
 *    those to warning anyway — a corroborated date must not triangle.
 */
export const TAX_RELEVANT_CODES: ReadonlySet<string> = new Set([
  'missing_exchange_rate',
  'non_iso_currency',
  'possible_duplicate',
  'refund_detected',
  'possibly_not_invoice',
  'unclear_business_status',
  'unclear_recipient_country'
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

/** Document context that can demote an issue from warning to minor. */
export interface IssueAttentionContext {
  /** an EUR exchange rate is known (printed on the document or resolved) */
  hasExchangeRate?: boolean
}

/** Attention tier a single issue maps to. */
export function issueAttention(
  issue: DocumentIssue,
  context?: IssueAttentionContext
): Exclude<AttentionLevel, 'confirmed' | 'ok'> | null {
  if (issue.severity === 'critical') return 'critical'
  if (issue.severity === 'info') return null
  // llm_disagreement counts as tax-relevant only when it hits a tax field
  if (issue.code === 'llm_disagreement') {
    const field = (issue.params?.field as string | undefined) ?? issue.field ?? ''
    return TAX_RELEVANT_FIELDS.has(field) ? 'warning' : 'minor'
  }
  // value-aware demotion: an exotic currency with a known EUR rate (e.g. the
  // rate is printed on the document) has correct EUR amounts — a footnote,
  // not a tax risk. Without a rate it stays a warning (no EUR amounts).
  if (issue.code === 'non_iso_currency' && context?.hasExchangeRate === true) {
    return 'minor'
  }
  return TAX_RELEVANT_CODES.has(issue.code) ? 'warning' : 'minor'
}

export interface AttentionInput {
  reviewStatus: TaxDocument['reviewStatus']
  issues: DocumentIssue[]
  fieldConfidence: Record<string, number>
  /** stored VAT classification, when available (extractionRawJson.vatClassification) */
  vatRequiresConfirmation?: boolean
  /** classification confidence (extractionRawJson.vatClassification.confidence) */
  vatConfidence?: 'high' | 'medium' | 'low'
  /** classification treatment code (extractionRawJson.vatClassification.code) */
  vatCode?: string
  /** an EUR exchange rate is available (doc.exchangeRateToEur !== null) */
  hasExchangeRate?: boolean
  /**
   * net + VAT adds up to gross for the stored original amounts (within 2 ct).
   * Lets the confidence scan keep a derived-but-arithmetically-pinned money
   * field at minor instead of warning (see pinnedByConsistentTriple).
   */
  amountsConsistent?: boolean
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

/** fieldConfidence key variants for the three money slots. */
const NET_FIELDS = ['netAmount', 'netAmountOriginal'] as const
const VAT_FIELDS = ['vatAmount', 'vatAmountOriginal'] as const
const GROSS_FIELDS = ['grossAmount', 'grossAmountOriginal'] as const

function slotConfidence(
  fieldConfidence: Record<string, number>,
  names: readonly string[]
): number {
  let best = 0
  for (const name of names) {
    const confidence = fieldConfidence[name]
    if (typeof confidence === 'number' && confidence > best) best = confidence
  }
  return best
}

/**
 * Tax-materiality demotion for derived amounts: when net + VAT = gross holds,
 * an uncertain net/VAT that was derived from a confidently printed gross (via
 * the printed rate) — or an uncertain gross derived from a confidently
 * printed net + VAT — cannot be materially wrong without its confident
 * companions being wrong too. That is a ring, not an alarm. Dates and
 * currency are never demoted.
 */
function pinnedByConsistentTriple(
  field: string,
  fieldConfidence: Record<string, number>
): boolean {
  if (field === 'netAmount' || field === 'netAmountOriginal' ||
      field === 'vatAmount' || field === 'vatAmountOriginal') {
    return slotConfidence(fieldConfidence, GROSS_FIELDS) >= MINOR_CONFIDENCE_THRESHOLD
  }
  if (field === 'grossAmount' || field === 'grossAmountOriginal') {
    return (
      slotConfidence(fieldConfidence, NET_FIELDS) >= MINOR_CONFIDENCE_THRESHOLD &&
      slotConfidence(fieldConfidence, VAT_FIELDS) >= MINOR_CONFIDENCE_THRESHOLD
    )
  }
  return false
}

export function attentionLevel(input: AttentionInput): AttentionLevel {
  // 1. + 2. review-state shortcuts
  if (input.reviewStatus === 'confirmed') return 'confirmed'
  if (input.reviewStatus === 'failed') return 'critical'

  // 3. + 4. issue tiers (critical beats warning beats minor)
  const context: IssueAttentionContext = { hasExchangeRate: input.hasExchangeRate }
  let hasWarningIssue = false
  let hasMinorIssue = false
  for (const issue of input.issues) {
    const tier = issueAttention(issue, context)
    if (tier === 'critical') return 'critical'
    if (tier === 'warning') hasWarningIssue = true
    else if (tier === 'minor') hasMinorIssue = true
  }
  // VAT confirmation is only an alarm when the classification itself is
  // shaky (low confidence, or the engine gave up: UNKNOWN_REVIEW). A
  // medium/high-confidence classification that merely asks for a systematic
  // judgment call (e.g. the OSS input-VAT question on every Stripe receipt)
  // is a yellow ring, not a triangle.
  if (input.vatRequiresConfirmation === true) {
    if (input.vatConfidence === 'low' || input.vatCode === 'UNKNOWN_REVIEW') {
      hasWarningIssue = true
    } else {
      hasMinorIssue = true
    }
  }
  if (hasWarningIssue) return 'warning'

  // 5. confidence scan — only reached when no issue forced a tier above
  // 'minor'. Exactly 0 means "not extracted", not "uncertain": a truly
  // missing amount already carries a critical issue, and a missing dueDate
  // is normal — neither should escalate here.
  let hasUncertainOtherField = false
  for (const [field, confidence] of Object.entries(input.fieldConfidence)) {
    if (!(confidence > 0 && confidence < MINOR_CONFIDENCE_THRESHOLD)) continue
    if (CORE_CONFIDENCE_FIELDS.has(field)) {
      if (
        input.amountsConsistent === true &&
        pinnedByConsistentTriple(field, input.fieldConfidence)
      ) {
        hasUncertainOtherField = true
        continue
      }
      return 'warning'
    }
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
    | {
        vatClassification?: {
          requiresUserConfirmation?: unknown
          confidence?: unknown
          code?: unknown
        }
      }
    | null
    | undefined
  const classification = raw?.vatClassification
  const confidence = classification?.confidence
  const net = doc.netAmountOriginal
  const vat = doc.vatAmountOriginal
  const gross = doc.grossAmountOriginal
  return attentionLevel({
    reviewStatus: doc.reviewStatus,
    issues: doc.issues,
    fieldConfidence: doc.fieldConfidence,
    vatRequiresConfirmation: classification?.requiresUserConfirmation === true,
    vatConfidence:
      confidence === 'high' || confidence === 'medium' || confidence === 'low'
        ? confidence
        : undefined,
    vatCode: typeof classification?.code === 'string' ? classification.code : undefined,
    hasExchangeRate: doc.exchangeRateToEur !== null,
    amountsConsistent:
      net !== null && vat !== null && gross !== null && Math.abs(net + vat - gross) <= 0.02
  })
}
