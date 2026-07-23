/**
 * Belegbar shared domain model.
 *
 * This file is the single source of truth for types shared between the
 * core domain logic, the Electron main process and the renderer.
 * It must stay free of Electron, Node and React imports.
 */

export type DocumentDirection = 'income' | 'expense'

export type ReviewStatus = 'processing' | 'needs_review' | 'confirmed' | 'failed'

export type ProcessingStatus =
  | 'queued'
  | 'copying'
  | 'validating'
  | 'extracting_text'
  | 'running_ocr'
  | 'extracting_fields'
  | 'classifying_tax'
  | 'saving'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'duplicate'

export type IssueSeverity = 'info' | 'warning' | 'critical'

/**
 * The ONE user-facing status language, computed from a document's issues,
 * confidences and review state (core/review/attention.ts) and used
 * identically in every list, panel and detail view:
 *  - confirmed  → green checkmark (user confirmed the document)
 *  - ok         → green ring (confident analysis, nothing to check)
 *  - minor      → yellow question circle (works, but some unimportant readings are uncertain)
 *  - warning    → yellow triangle (ONLY for potentially tax-relevant problems)
 *  - critical   → red stop mark (ONLY for real concerns; excluded from totals)
 */
export type AttentionLevel = 'confirmed' | 'ok' | 'minor' | 'warning' | 'critical'

export interface DocumentIssue {
  /** stable machine code, e.g. 'missing_invoice_date' */
  code: string
  severity: IssueSeverity
  /** i18n key under issues.* — renderer translates */
  messageKey: string
  /** optional interpolation values for the message */
  params?: Record<string, string | number>
  /** field name this issue refers to, when applicable */
  field?: string
}

export interface VatRateLine {
  rate: number
  netAmountOriginal: number
  vatAmountOriginal: number
  grossAmountOriginal: number
}

export interface TaxDocument {
  id: string
  direction: DocumentDirection

  originalFilename: string
  storedFilename: string
  storedRelativePath: string
  sha256: string
  mimeType: 'application/pdf'
  pageCount: number | null

  invoiceNumber: string | null
  invoiceDate: string | null
  serviceDateFrom: string | null
  serviceDateTo: string | null
  receiptDate: string | null
  paymentDate: string | null
  dueDate: string | null
  /** 'unpaid' | 'paid' | 'unknown' — payment state independent of dates */
  paymentStatus: 'unknown' | 'paid' | 'unpaid'

  issuerName: string | null
  issuerAddress: string | null
  issuerCountryCode: string | null
  issuerTaxNumber: string | null
  issuerVatId: string | null

  recipientName: string | null
  recipientAddress: string | null
  recipientCountryCode: string | null
  recipientTaxNumber: string | null
  recipientVatId: string | null
  recipientIsBusiness: boolean | null

  description: string | null
  expenseCategory: string | null

  originalCurrency: string | null
  netAmountOriginal: number | null
  vatAmountOriginal: number | null
  grossAmountOriginal: number | null

  exchangeRateToEur: number | null
  exchangeRateDate: string | null
  exchangeRateSource: string | null

  netAmountEur: number | null
  vatAmountEur: number | null
  grossAmountEur: number | null

  vatRates: VatRateLine[]

  vatTreatmentCode: string | null
  vatTreatmentLabel: string | null
  vatLegalBasis: string | null
  taxPeriodYear: number | null
  taxPeriodQuarter: 1 | 2 | 3 | 4 | null
  taxPeriodMonth: number | null

  extractedText: string | null
  extractionProvider: string
  extractionVersion: string
  extractionConfidence: number | null
  fieldConfidence: Record<string, number>
  extractionRawJson: unknown

  reviewStatus: ReviewStatus
  reviewReasons: string[]
  issues: DocumentIssue[]
  userConfirmedAt: string | null
  deletedAt: string | null

  createdAt: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  documentId: string | null
  eventType: string
  previousValue: unknown
  nextValue: unknown
  createdAt: string
  source: 'system' | 'user'
}

export interface StoredFileIdentity {
  documentId: string
  originalFilename: string
  generatedFilename: string
  storedRelativePath: string
  sha256: string
}

export interface DeleteDocumentsResult {
  deleted: number
  skipped: number
  failed: number
}

// ---------------------------------------------------------------------------
// VAT classification
// ---------------------------------------------------------------------------

export type VatConfidence = 'high' | 'medium' | 'low'

/** Stable codes for the initial rule set (spec §12). */
export type VatTreatmentCode =
  | 'DE_DOMESTIC_19'
  | 'DE_DOMESTIC_7'
  | 'DE_DOMESTIC_0_EXEMPT'
  | 'DE_EXPENSE_INPUT_VAT'
  | 'DE_EXPENSE_NO_INPUT_VAT'
  | 'EU_B2B_REVERSE_CHARGE_REVENUE'
  | 'THIRD_COUNTRY_B2B_SERVICE'
  | 'EXPENSE_REVERSE_CHARGE_13B'
  | 'KLEINUNTERNEHMER'
  | 'UNKNOWN_REVIEW'

export interface VatClassificationResult {
  code: VatTreatmentCode
  labelDe: string
  labelEn: string
  germanVatRate: number | null
  germanVatAmount: number | null
  legalBasis: string | null
  confidence: VatConfidence
  reasons: string[]
  unresolvedQuestions: string[]
  requiresUserConfirmation: boolean
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface ExtractedField<T> {
  value: T | null
  /** 0..1 */
  confidence: number
  /** page + normalized bbox [x0,y0,x1,y1] in 0..1 page units, when known */
  page?: number
  bbox?: [number, number, number, number]
}

export interface ExtractedInvoiceData {
  invoiceNumber: ExtractedField<string>
  invoiceDate: ExtractedField<string>
  serviceDateFrom: ExtractedField<string>
  serviceDateTo: ExtractedField<string>
  dueDate: ExtractedField<string>
  paymentDate: ExtractedField<string>
  issuerName: ExtractedField<string>
  issuerAddress: ExtractedField<string>
  issuerCountryCode: ExtractedField<string>
  issuerTaxNumber: ExtractedField<string>
  issuerVatId: ExtractedField<string>
  recipientName: ExtractedField<string>
  recipientAddress: ExtractedField<string>
  recipientCountryCode: ExtractedField<string>
  recipientVatId: ExtractedField<string>
  recipientIsBusiness: ExtractedField<boolean>
  description: ExtractedField<string>
  currency: ExtractedField<string>
  netAmount: ExtractedField<number>
  vatAmount: ExtractedField<number>
  grossAmount: ExtractedField<number>
  vatRates: VatRateLine[]
  /** raw wording signals for the VAT engine */
  signals: {
    reverseChargeWording: boolean
    vatExemptWording: boolean
    kleinunternehmerWording: boolean
    ossWording: boolean
    paidWording: boolean
    isServiceLikely: boolean
  }
  extractedText: string
  ocrUsed: boolean
  ocrPages: number[]
  issues: DocumentIssue[]
}

export interface ExtractionProviderInfo {
  provider: string
  version: string
}

// ---------------------------------------------------------------------------
// Settings / profile
// ---------------------------------------------------------------------------

export type ThemeSetting = 'system' | 'light' | 'dark'
export type LanguageSetting = 'system' | 'de' | 'en'
export type IncomeTaxMethod = 'euer' | 'accrual' | 'unsure'
export type VatMethod = 'ist' | 'soll' | 'kleinunternehmer' | 'unsure'
export type VatFilingFrequency = 'monthly' | 'quarterly' | 'yearly'
export type AssessmentType = 'single' | 'joint'

export interface AppSettings {
  language: LanguageSetting
  theme: ThemeSetting
  defaultYear: number
  moveOriginalsAfterImport: boolean
  onboardingCompleted: boolean

  businessName: string
  businessAddress: string
  businessTaxNumber: string
  businessVatId: string
  businessType: 'freelancer' | 'trade' | 'unsure'
  baseCurrency: 'EUR'

  vatMethod: VatMethod
  vatFilingFrequency: VatFilingFrequency
  incomeTaxMethod: IncomeTaxMethod

  assessmentType: AssessmentType
  federalState: string
  churchTax: 'none' | 'rate8' | 'rate9'
  otherTaxableIncome: number
  deductibleContributions: number
  incomeTaxPrepayments: number
  includeSolidaritySurcharge: boolean

  /** local LLM double-check of extracted fields (opt-in; fully offline) */
  llmCheckerEnabled: boolean

  /** post-onboarding tour: 'pending' until the user picked a depth */
  tourChoice: 'pending' | 'none' | 'minimum' | 'medium' | 'full'
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  theme: 'system',
  defaultYear: 2026,
  moveOriginalsAfterImport: true,
  onboardingCompleted: false,
  businessName: '',
  businessAddress: '',
  businessTaxNumber: '',
  businessVatId: '',
  businessType: 'unsure',
  baseCurrency: 'EUR',
  vatMethod: 'unsure',
  vatFilingFrequency: 'quarterly',
  incomeTaxMethod: 'unsure',
  assessmentType: 'single',
  federalState: 'BW',
  churchTax: 'none',
  otherTaxableIncome: 0,
  deductibleContributions: 0,
  incomeTaxPrepayments: 0,
  includeSolidaritySurcharge: true,
  llmCheckerEnabled: false,
  tourChoice: 'pending'
}

// ---------------------------------------------------------------------------
// Local LLM extraction checker
// ---------------------------------------------------------------------------

export type LlmModelState =
  | 'not_downloaded'
  | 'downloading'
  | 'ready'
  | 'unsupported'
  | 'error'

export interface LlmStatus {
  state: LlmModelState
  /** bytes downloaded / total while downloading */
  downloadedBytes: number
  totalBytes: number
  /** i18n key for unsupported/error detail */
  reasonKey: string | null
  modelFileName: string
  /** on-disk size when ready, bytes */
  modelSizeBytes: number
  /** documents currently queued for checking */
  queueLength: number
}

/** One field's verdict from the local model. */
export type LlmVerdictConfidence = 'low' | 'medium' | 'high'

export interface LlmFieldVerdict {
  /** does the model agree with the deterministically extracted value? */
  agrees: boolean
  /** model's suggested value when it disagrees (never auto-applied) */
  suggested: string | null
  /** certainty of this verdict; absent only on checks stored by older versions */
  confidence?: LlmVerdictConfidence
}

export interface LlmCheckResult {
  documentId: string
  model: string
  /** field name → verdict, only for fields that were checked */
  fields: Record<string, LlmFieldVerdict>
  /** wall-clock milliseconds the check took */
  durationMs: number
  checkedAt: string
}

// ---------------------------------------------------------------------------
// Period + summaries
// ---------------------------------------------------------------------------

export interface TaxPeriod {
  year: number
  /** null = whole year */
  quarter: 1 | 2 | 3 | 4 | null
  /** null = whole quarter/year */
  month: number | null
}

export interface AmountBreakdown {
  confirmed: number
  provisional: number
  excluded: number
  /** document ids contributing to each bucket */
  confirmedIds: string[]
  provisionalIds: string[]
  excludedIds: string[]
}

export interface VatSummary {
  period: TaxPeriod
  outputVat: AmountBreakdown
  inputVat: AmountBreakdown
  reverseChargeVat: AmountBreakdown
  reverseChargeInputVat: AmountBreakdown
  /** outputVat - inputVat + rcVat - rcInputVat over confirmed+provisional */
  estimatedPayable: number

  domesticTaxableRevenue: AmountBreakdown
  euReverseChargeRevenue: AmountBreakdown
  thirdCountryNonTaxableRevenue: AmountBreakdown
  taxExemptRevenue: AmountBreakdown
  documentsNeedingReview: number
  revenueNeedingReview: number
  expensesNeedingReview: number
}

export interface IncomeTaxEstimate {
  year: number
  recognizedIncome: AmountBreakdown
  recognizedExpenses: AmountBreakdown
  recordedProfitToDate: number
  estimatedProfit: number
  otherTaxableIncome: number
  deductibleContributions: number
  estimatedTaxableIncome: number
  estimatedIncomeTax: number
  solidaritySurcharge: number
  churchTax: number
  prepayments: number
  suggestedReserve: number
  engineVersion: string
  assumptions: string[]
  incompleteItems: string[]
  isEstimateOnly: boolean
  isAnnualized: boolean
  projectionMonths: number
  projectionFactor: number
}

export interface OverviewSummary {
  period: TaxPeriod
  revenueEur: AmountBreakdown
  expensesEur: AmountBreakdown
  profitEur: number
  vatPayableEur: number
  suggestedTaxReserveEur: number
  documentsNeedingReview: number
  paymentDatesMissing: number
  exchangeRatesMissing: number
}

// ---------------------------------------------------------------------------
// Import progress (main -> renderer events)
// ---------------------------------------------------------------------------

export interface ImportFileProgress {
  importId: string
  fileId: string
  originalFilename: string
  storedFilename: string | null
  documentId: string | null
  direction: DocumentDirection
  status: ProcessingStatus
  issues: DocumentIssue[]
  /** 0..1 within current stage, when determinate */
  progress: number | null
  errorKey: string | null
}

export type DocumentSort = 'newest' | 'oldest' | 'recent'

export interface DocumentListFilter {
  search?: string
  year?: number
  quarter?: 1 | 2 | 3 | 4
  direction?: DocumentDirection
  reviewStatus?: ReviewStatus
  vatTreatmentCode?: string
  includeDeleted?: boolean
  includeUnassigned?: boolean
  sort?: DocumentSort
  limit?: number
  offset?: number
}

export const GERMAN_FEDERAL_STATES = [
  'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV',
  'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'
] as const

export type FederalState = (typeof GERMAN_FEDERAL_STATES)[number]
