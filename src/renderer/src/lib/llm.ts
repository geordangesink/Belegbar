/**
 * Renderer-side helpers for the local LLM double-check feature.
 * Pure functions: reading the stored llmCheck result out of a document's
 * extractionRawJson and mapping checked field names onto existing review.*
 * labels. No Electron/Node imports.
 */
import type { LlmFieldVerdict } from '@shared/domain'

/** checked field name → i18n label key under review.* */
const REVIEW_FIELD_LABEL_KEYS: Record<string, string> = {
  invoiceNumber: 'review.invoiceNumber',
  invoiceDate: 'review.invoiceDate',
  serviceDateFrom: 'review.servicePeriodFrom',
  serviceDateTo: 'review.servicePeriodTo',
  dueDate: 'review.dueDate',
  currency: 'review.currency',
  originalCurrency: 'review.currency',
  netAmount: 'review.netAmount',
  netAmountOriginal: 'review.netAmount',
  vatAmount: 'review.vatAmount',
  vatAmountOriginal: 'review.vatAmount',
  grossAmount: 'review.grossAmount',
  grossAmountOriginal: 'review.grossAmount',
  issuerName: 'review.issuerName',
  issuerCountryCode: 'review.issuerCountry',
  issuerVatId: 'review.issuerVatId',
  recipientName: 'review.recipientName',
  recipientCountryCode: 'review.recipientCountry',
  recipientVatId: 'review.recipientVatId',
  recipientIsBusiness: 'review.recipientIsBusiness',
  description: 'review.description',
  expenseCategory: 'review.category',
  exchangeRateToEur: 'review.exchangeRate',
  paymentDate: 'review.paymentDate',
  vatTreatmentCode: 'review.vatTreatment'
}

/**
 * i18n key for a checked field's human label; null when no review.* label
 * exists (caller falls back to the raw field name).
 */
export function llmFieldLabelKey(field: string): string | null {
  return reviewFieldLabelKey(field)
}

export function reviewFieldLabelKey(field: string): string | null {
  return REVIEW_FIELD_LABEL_KEYS[field] ?? null
}

function isVerdict(value: unknown): value is LlmFieldVerdict {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const confidence = v.confidence
  return (
    typeof v.agrees === 'boolean' &&
    (v.suggested === null || typeof v.suggested === 'string') &&
    (confidence === undefined ||
      confidence === 'low' ||
      confidence === 'medium' ||
      confidence === 'high')
  )
}

export interface StoredLlmCheck {
  fields: Record<string, LlmFieldVerdict>
}

/**
 * Best-effort read of the stored LLM check result from
 * TaxDocument.extractionRawJson. Returns null when absent or malformed;
 * malformed individual field verdicts are skipped.
 */
export function getLlmCheck(extractionRawJson: unknown): StoredLlmCheck | null {
  if (extractionRawJson === null || typeof extractionRawJson !== 'object') return null
  const candidate = (extractionRawJson as Record<string, unknown>).llmCheck
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return null
  const rawFields = (candidate as Record<string, unknown>).fields
  if (rawFields === null || rawFields === undefined || typeof rawFields !== 'object') return null
  const fields: Record<string, LlmFieldVerdict> = {}
  for (const [name, verdict] of Object.entries(rawFields as Record<string, unknown>)) {
    if (isVerdict(verdict)) fields[name] = verdict
  }
  return { fields }
}

export function llmDisagreementCount(check: StoredLlmCheck): number {
  return Object.values(check.fields).filter((v) => !v.agrees).length
}

/**
 * Normalizes an LlmStatus.reasonKey ('llm_download_failed' or already
 * 'errors.llm_download_failed') to a full i18n key.
 */
export function llmReasonKey(reasonKey: string | null): string {
  if (!reasonKey) return 'errors.generic'
  return reasonKey.includes('.') ? reasonKey : `errors.${reasonKey}`
}

/** Whole megabytes for download/size display (never negative). */
export function bytesToMb(bytes: number): number {
  return Math.max(0, Math.round(bytes / (1024 * 1024)))
}
