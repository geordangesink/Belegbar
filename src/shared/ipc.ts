/**
 * IPC contract between renderer and main.
 *
 * Every channel is explicitly listed here; the main process registers ONLY
 * these channels and validates every payload with the zod schema next to it.
 * The renderer never passes absolute filesystem paths except for the initial
 * import of user-chosen files (validated in main as real PDFs).
 */
import { z } from 'zod'

export const IPC = {
  // import
  importFiles: 'steuerfach:import-files',
  importProgress: 'steuerfach:import-progress', // main -> renderer event
  retryImport: 'steuerfach:retry-import',
  dismissImport: 'steuerfach:dismiss-import',
  // documents
  listDocuments: 'steuerfach:list-documents',
  getDocument: 'steuerfach:get-document',
  updateDocument: 'steuerfach:update-document',
  confirmDocument: 'steuerfach:confirm-document',
  setPaymentDate: 'steuerfach:set-payment-date',
  setDirection: 'steuerfach:set-direction',
  setVatTreatment: 'steuerfach:set-vat-treatment',
  deleteDocument: 'steuerfach:delete-document',
  restoreDocument: 'steuerfach:restore-document',
  getDocumentPdf: 'steuerfach:get-document-pdf',
  revealDocument: 'steuerfach:reveal-document',
  openDocumentExternal: 'steuerfach:open-document-external',
  getAuditTrail: 'steuerfach:get-audit-trail',
  // summaries
  getOverview: 'steuerfach:get-overview',
  getVatSummary: 'steuerfach:get-vat-summary',
  getIncomeTaxEstimate: 'steuerfach:get-income-tax-estimate',
  // settings
  getSettings: 'steuerfach:get-settings',
  updateSettings: 'steuerfach:update-settings',
  // data management
  createBackup: 'steuerfach:create-backup',
  restoreBackup: 'steuerfach:restore-backup',
  exportPeriod: 'steuerfach:export-period',
  openDataFolder: 'steuerfach:open-data-folder',
  chooseFiles: 'steuerfach:choose-files',
  getSystemLocale: 'steuerfach:get-system-locale'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const directionSchema = z.enum(['income', 'expense'])
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const importFilesSchema = z.object({
  direction: directionSchema,
  /** absolute paths of files the user dropped or picked */
  paths: z.array(z.string().min(1)).min(1).max(500),
  /** how to resolve a detected duplicate; default is to ask */
  duplicateAction: z.enum(['ask', 'import_anyway', 'skip']).default('ask')
})
export type ImportFilesPayload = z.infer<typeof importFilesSchema>

export const documentIdSchema = z.object({ id: z.string().uuid() })

export const listDocumentsSchema = z.object({
  search: z.string().max(500).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  direction: directionSchema.optional(),
  reviewStatus: z.enum(['processing', 'needs_review', 'confirmed', 'failed']).optional(),
  vatTreatmentCode: z.string().max(64).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0)
})

/** Editable fields — everything the review UI may change. */
export const updateDocumentSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      invoiceNumber: z.string().max(200).nullable(),
      invoiceDate: isoDateSchema.nullable(),
      serviceDateFrom: isoDateSchema.nullable(),
      serviceDateTo: isoDateSchema.nullable(),
      dueDate: isoDateSchema.nullable(),
      paymentDate: isoDateSchema.nullable(),
      paymentStatus: z.enum(['unknown', 'paid', 'unpaid']),
      issuerName: z.string().max(300).nullable(),
      issuerAddress: z.string().max(1000).nullable(),
      issuerCountryCode: z.string().length(2).nullable(),
      issuerVatId: z.string().max(32).nullable(),
      issuerTaxNumber: z.string().max(32).nullable(),
      recipientName: z.string().max(300).nullable(),
      recipientAddress: z.string().max(1000).nullable(),
      recipientCountryCode: z.string().length(2).nullable(),
      recipientVatId: z.string().max(32).nullable(),
      recipientIsBusiness: z.boolean().nullable(),
      description: z.string().max(2000).nullable(),
      expenseCategory: z.string().max(100).nullable(),
      originalCurrency: z.string().min(3).max(5).nullable(),
      netAmountOriginal: z.number().finite().nullable(),
      vatAmountOriginal: z.number().finite().nullable(),
      grossAmountOriginal: z.number().finite().nullable(),
      exchangeRateToEur: z.number().positive().finite().nullable(),
      exchangeRateDate: isoDateSchema.nullable(),
      exchangeRateSource: z.string().max(100).nullable()
    })
    .partial()
})
export type UpdateDocumentPayload = z.infer<typeof updateDocumentSchema>

export const setPaymentDateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  /** 'invoice_date' uses each document's own invoice date */
  mode: z.enum(['date', 'invoice_date', 'not_paid', 'unknown']),
  date: isoDateSchema.optional()
})

export const setDirectionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  direction: directionSchema
})

export const setVatTreatmentSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(64),
  /** user-visible justification stored in the audit log */
  reason: z.string().max(1000).optional()
})

export const periodSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  month: z.number().int().min(1).max(12).nullable()
})

export const yearSchema = z.object({
  year: z.number().int().min(2000).max(2100)
})

export const updateSettingsSchema = z
  .object({
    language: z.enum(['system', 'de', 'en']),
    theme: z.enum(['system', 'light', 'dark']),
    defaultYear: z.number().int().min(2000).max(2100),
    moveOriginalsAfterImport: z.boolean(),
    onboardingCompleted: z.boolean(),
    businessName: z.string().max(300),
    businessAddress: z.string().max(1000),
    businessTaxNumber: z.string().max(32),
    businessVatId: z.string().max(32),
    businessType: z.enum(['freelancer', 'trade', 'unsure']),
    vatMethod: z.enum(['ist', 'soll', 'kleinunternehmer', 'unsure']),
    vatFilingFrequency: z.enum(['monthly', 'quarterly', 'yearly']),
    incomeTaxMethod: z.enum(['euer', 'accrual', 'unsure']),
    assessmentType: z.enum(['single', 'joint']),
    federalState: z.string().length(2),
    churchTax: z.enum(['none', 'rate8', 'rate9']),
    otherTaxableIncome: z.number().min(0).finite(),
    deductibleContributions: z.number().min(0).finite(),
    incomeTaxPrepayments: z.number().min(0).finite(),
    includeSolidaritySurcharge: z.boolean()
  })
  .partial()
export type UpdateSettingsPayload = z.infer<typeof updateSettingsSchema>

export const exportPeriodSchema = z.object({
  period: periodSchema,
  format: z.enum(['csv', 'json', 'zip', 'summary'])
})

export const deleteDocumentSchema = z.object({
  id: z.string().uuid(),
  /** trash first; hard delete only from trash */
  mode: z.enum(['trash', 'hard']).default('trash')
})
