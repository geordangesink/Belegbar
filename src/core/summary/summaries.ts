/**
 * Period summaries (overview, VAT, income tax) computed from documents.
 * Pure functions over TaxDocument[] + settings — main only loads and calls.
 *
 * Safeguards (spec): documents with critical issues / failed status are
 * EXCLUDED; needs_review documents count as PROVISIONAL; confirmed documents
 * count as CONFIRMED. Totals must expose all three buckets.
 */
import type {
  AppSettings,
  IncomeTaxEstimate,
  OverviewSummary,
  TaxDocument,
  TaxPeriod,
  VatSummary
} from '../../shared/domain'

export function computeOverview(
  documents: TaxDocument[],
  period: TaxPeriod,
  settings: AppSettings
): OverviewSummary {
  throw new Error('not implemented')
}

export function computeVatSummary(
  documents: TaxDocument[],
  period: TaxPeriod,
  settings: AppSettings
): VatSummary {
  throw new Error('not implemented')
}

export function computeIncomeTaxEstimate(
  documents: TaxDocument[],
  year: number,
  settings: AppSettings
): IncomeTaxEstimate {
  throw new Error('not implemented')
}

/** The filing period that is currently relevant given filing frequency. */
export function currentFilingPeriod(
  settings: AppSettings,
  today: string
): TaxPeriod {
  throw new Error('not implemented')
}
