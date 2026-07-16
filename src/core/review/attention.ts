import type { AttentionLevel, DocumentIssue, TaxDocument } from '../../shared/domain'
import {
  canonicalDocumentField,
  confidenceForField
} from './fields'

export const TAX_RELEVANT_CODES: ReadonlySet<string> = new Set([
  'missing_exchange_rate',
  'non_iso_currency',
  'possible_duplicate',
  'refund_detected',
  'possibly_not_invoice',
  'unclear_business_status',
  'unclear_recipient_country'
])

export const TAX_RELEVANT_FIELDS: ReadonlySet<string> = new Set([
  'invoiceNumber',
  'invoiceDate',
  'originalCurrency',
  'netAmountOriginal',
  'vatAmountOriginal',
  'grossAmountOriginal',
  'exchangeRateToEur'
])

const CORE_CONFIDENCE_FIELDS: ReadonlySet<string> = new Set([
  'invoiceDate',
  'originalCurrency',
  'grossAmountOriginal',
  'netAmountOriginal',
  'vatAmountOriginal'
])

const CORE_CONFIDENCE_THRESHOLD = 0.85
const SUPPORTING_CONFIDENCE_THRESHOLD = 0.65

export type FieldAttentionLevel = Exclude<AttentionLevel, 'confirmed' | 'ok'>

export interface IssueAttentionContext {
  hasExchangeRate?: boolean
  fieldConfidence?: Readonly<Record<string, number>>
}

export function issueAttention(
  issue: DocumentIssue,
  context?: IssueAttentionContext
): FieldAttentionLevel | null {
  if (issue.code === 'missing_exchange_rate') {
    return context?.hasExchangeRate === true ? null : 'critical'
  }
  if (issue.severity === 'critical') return 'critical'
  if (issue.severity === 'info') return null
  if (
    issue.code === 'ambiguous_date_format' &&
    (confidenceForField(context?.fieldConfidence ?? {}, 'invoiceDate') ?? 0) >=
      CORE_CONFIDENCE_THRESHOLD
  ) {
    return null
  }
  if (issue.code === 'non_iso_currency' && context?.hasExchangeRate === true) return null
  if (issue.code === 'llm_disagreement') {
    const field = canonicalDocumentField(
      (issue.params?.field as string | undefined) ?? issue.field ?? ''
    )
    return TAX_RELEVANT_FIELDS.has(field) ? 'warning' : 'minor'
  }
  return TAX_RELEVANT_CODES.has(issue.code) ? 'warning' : 'minor'
}

export interface AttentionInput {
  reviewStatus: TaxDocument['reviewStatus']
  issues: DocumentIssue[]
  fieldConfidence: Record<string, number>
  vatRequiresConfirmation?: boolean
  vatConfidence?: 'high' | 'medium' | 'low'
  vatCode?: string
  hasExchangeRate?: boolean
  amountsConsistent?: boolean
  missingRequiredFields?: string[]
}

export interface AttentionAnalysis {
  level: AttentionLevel
  fields: Record<string, FieldAttentionLevel>
}

const LEVEL_RANK: Readonly<Record<FieldAttentionLevel, number>> = {
  minor: 1,
  warning: 2,
  critical: 3
}

function stronger(
  current: FieldAttentionLevel | undefined,
  next: FieldAttentionLevel
): FieldAttentionLevel {
  return current === undefined || LEVEL_RANK[next] > LEVEL_RANK[current] ? next : current
}

function addField(
  fields: Record<string, FieldAttentionLevel>,
  field: string | undefined,
  level: FieldAttentionLevel
): void {
  if (!field) return
  const canonical = canonicalDocumentField(field)
  fields[canonical] = stronger(fields[canonical], level)
}

function pinnedByConsistentTriple(
  field: string,
  fieldConfidence: Readonly<Record<string, number>>
): boolean {
  if (field === 'netAmountOriginal' || field === 'vatAmountOriginal') {
    return (confidenceForField(fieldConfidence, 'grossAmountOriginal') ?? 0) >=
      CORE_CONFIDENCE_THRESHOLD
  }
  if (field === 'grossAmountOriginal') {
    return (
      (confidenceForField(fieldConfidence, 'netAmountOriginal') ?? 0) >=
        CORE_CONFIDENCE_THRESHOLD &&
      (confidenceForField(fieldConfidence, 'vatAmountOriginal') ?? 0) >=
        CORE_CONFIDENCE_THRESHOLD
    )
  }
  return false
}

export function analyzeAttention(input: AttentionInput): AttentionAnalysis {
  const missingExchangeRate =
    (input.hasExchangeRate !== true &&
      input.issues.some((issue) => issue.code === 'missing_exchange_rate')) ||
    input.missingRequiredFields?.includes('exchangeRateToEur') === true
  if (input.reviewStatus === 'confirmed' && !missingExchangeRate) {
    return { level: 'confirmed', fields: {} }
  }

  const fields: Record<string, FieldAttentionLevel> = {}
  let level: AttentionLevel = input.reviewStatus === 'failed' ? 'critical' : 'ok'
  const promote = (next: FieldAttentionLevel): void => {
    if (level === 'confirmed') return
    if (level === 'ok' || (level !== 'critical' && LEVEL_RANK[next] > LEVEL_RANK[level])) {
      level = next
    }
  }

  const issueContext: IssueAttentionContext = {
    hasExchangeRate: input.hasExchangeRate,
    fieldConfidence: input.fieldConfidence
  }
  for (const issue of input.issues) {
    const tier = issueAttention(issue, issueContext)
    if (tier === null) continue
    promote(tier)
    addField(
      fields,
      (issue.params?.field as string | undefined) ?? issue.field,
      tier
    )
  }

  for (const field of input.missingRequiredFields ?? []) {
    promote('critical')
    addField(fields, field, 'critical')
  }

  if (input.vatRequiresConfirmation === true) {
    const tier: FieldAttentionLevel =
      input.vatConfidence === 'low' || input.vatCode === 'UNKNOWN_REVIEW'
        ? 'warning'
        : 'minor'
    promote(tier)
    addField(fields, 'vatTreatmentCode', tier)
  }

  for (const [rawField, confidence] of Object.entries(input.fieldConfidence)) {
    if (!(confidence > 0)) continue
    const field = canonicalDocumentField(rawField)
    const core = CORE_CONFIDENCE_FIELDS.has(field)
    const threshold = core ? CORE_CONFIDENCE_THRESHOLD : SUPPORTING_CONFIDENCE_THRESHOLD
    if (confidence >= threshold) continue
    if (
      core &&
      confidence >= SUPPORTING_CONFIDENCE_THRESHOLD &&
      input.amountsConsistent === true &&
      pinnedByConsistentTriple(field, input.fieldConfidence)
    ) {
      continue
    }
    const tier: FieldAttentionLevel = core ? 'warning' : 'minor'
    promote(tier)
    addField(fields, field, tier)
  }

  if (input.reviewStatus === 'processing' && level === 'ok') level = 'minor'
  return { level, fields }
}

export function attentionLevel(input: AttentionInput): AttentionLevel {
  return analyzeAttention(input).level
}

function documentAttentionInput(doc: TaxDocument): AttentionInput {
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
  const missingRequiredFields: string[] = []
  if (doc.invoiceDate === null) missingRequiredFields.push('invoiceDate')
  if (doc.originalCurrency === null) missingRequiredFields.push('originalCurrency')
  if (gross === null && net === null) missingRequiredFields.push('grossAmountOriginal')
  if (
    doc.originalCurrency !== null &&
    doc.originalCurrency.trim().toUpperCase() !== 'EUR' &&
    doc.exchangeRateToEur === null
  ) {
    missingRequiredFields.push('exchangeRateToEur')
  }
  return {
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
      net !== null && vat !== null && gross !== null && Math.abs(net + vat - gross) <= 0.02,
    missingRequiredFields
  }
}

export function attentionAnalysisForDocument(doc: TaxDocument): AttentionAnalysis {
  return analyzeAttention(documentAttentionInput(doc))
}

export function attentionForDocument(doc: TaxDocument): AttentionLevel {
  return attentionAnalysisForDocument(doc).level
}

export function fieldAttentionForDocument(
  doc: TaxDocument
): Record<string, FieldAttentionLevel> {
  return attentionAnalysisForDocument(doc).fields
}

export function issueAttentionForDocument(
  issue: DocumentIssue,
  doc: TaxDocument
): FieldAttentionLevel | null {
  if (doc.reviewStatus === 'confirmed' && issue.code !== 'missing_exchange_rate') return null
  return issueAttention(issue, {
    hasExchangeRate: doc.exchangeRateToEur !== null,
    fieldConfidence: doc.fieldConfidence
  })
}
