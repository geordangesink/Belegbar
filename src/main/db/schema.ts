/**
 * SQLite schema (drizzle). JSON-ish fields are stored as TEXT with
 * JSON.stringify/parse at the repository layer. Monetary values are stored
 * as REAL euros/currency units; all tax math in core rounds explicitly.
 */
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    direction: text('direction', { enum: ['income', 'expense'] }).notNull(),

    originalFilename: text('original_filename').notNull(),
    storedFilename: text('stored_filename').notNull(),
    storedRelativePath: text('stored_relative_path').notNull(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull().default('application/pdf'),
    pageCount: integer('page_count'),

    invoiceNumber: text('invoice_number'),
    invoiceDate: text('invoice_date'),
    serviceDateFrom: text('service_date_from'),
    serviceDateTo: text('service_date_to'),
    receiptDate: text('receipt_date'),
    paymentDate: text('payment_date'),
    dueDate: text('due_date'),
    paymentStatus: text('payment_status', { enum: ['unknown', 'paid', 'unpaid'] })
      .notNull()
      .default('unknown'),

    issuerName: text('issuer_name'),
    issuerAddress: text('issuer_address'),
    issuerCountryCode: text('issuer_country_code'),
    issuerTaxNumber: text('issuer_tax_number'),
    issuerVatId: text('issuer_vat_id'),

    recipientName: text('recipient_name'),
    recipientAddress: text('recipient_address'),
    recipientCountryCode: text('recipient_country_code'),
    recipientTaxNumber: text('recipient_tax_number'),
    recipientVatId: text('recipient_vat_id'),
    recipientIsBusiness: integer('recipient_is_business', { mode: 'boolean' }),

    description: text('description'),
    expenseCategory: text('expense_category'),

    originalCurrency: text('original_currency'),
    netAmountOriginal: real('net_amount_original'),
    vatAmountOriginal: real('vat_amount_original'),
    grossAmountOriginal: real('gross_amount_original'),

    exchangeRateToEur: real('exchange_rate_to_eur'),
    exchangeRateDate: text('exchange_rate_date'),
    exchangeRateSource: text('exchange_rate_source'),

    netAmountEur: real('net_amount_eur'),
    vatAmountEur: real('vat_amount_eur'),
    grossAmountEur: real('gross_amount_eur'),

    vatRatesJson: text('vat_rates_json').notNull().default('[]'),

    vatTreatmentCode: text('vat_treatment_code'),
    vatTreatmentLabel: text('vat_treatment_label'),
    vatLegalBasis: text('vat_legal_basis'),
    vatClassificationJson: text('vat_classification_json'),
    taxPeriodYear: integer('tax_period_year'),
    taxPeriodQuarter: integer('tax_period_quarter'),
    taxPeriodMonth: integer('tax_period_month'),

    extractedText: text('extracted_text'),
    extractionProvider: text('extraction_provider').notNull().default('none'),
    extractionVersion: text('extraction_version').notNull().default('0'),
    extractionConfidence: real('extraction_confidence'),
    fieldConfidenceJson: text('field_confidence_json').notNull().default('{}'),
    extractionRawJson: text('extraction_raw_json'),

    reviewStatus: text('review_status', {
      enum: ['processing', 'needs_review', 'confirmed', 'failed']
    })
      .notNull()
      .default('processing'),
    reviewReasonsJson: text('review_reasons_json').notNull().default('[]'),
    issuesJson: text('issues_json').notNull().default('[]'),
    userConfirmedAt: text('user_confirmed_at'),
    deletedAt: text('deleted_at'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    index('idx_documents_sha256').on(t.sha256),
    index('idx_documents_direction').on(t.direction),
    index('idx_documents_review_status').on(t.reviewStatus),
    index('idx_documents_period').on(t.taxPeriodYear, t.taxPeriodQuarter),
    index('idx_documents_invoice_date').on(t.invoiceDate),
    index('idx_documents_deleted_at').on(t.deletedAt)
  ]
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id'),
    eventType: text('event_type').notNull(),
    previousValueJson: text('previous_value_json'),
    nextValueJson: text('next_value_json'),
    createdAt: text('created_at').notNull(),
    source: text('source', { enum: ['system', 'user'] }).notNull()
  },
  (t) => [
    index('idx_audit_document').on(t.documentId),
    index('idx_audit_created').on(t.createdAt)
  ]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull()
})

export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: text('id').primaryKey(),
    currency: text('currency').notNull(),
    date: text('date').notNull(),
    rateToEur: real('rate_to_eur').notNull(),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('idx_rates_currency_date').on(t.currency, t.date)]
)

/** Tracks in-flight imports so interrupted batches can be recovered. */
export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: text('id').primaryKey(),
    importId: text('import_id').notNull(),
    sourcePath: text('source_path').notNull(),
    direction: text('direction', { enum: ['income', 'expense'] }).notNull(),
    status: text('status').notNull(),
    documentId: text('document_id'),
    errorKey: text('error_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [index('idx_import_jobs_status').on(t.status)]
)

export const ocrCache = sqliteTable(
  'ocr_cache',
  {
    /** sha256 of the source PDF + page number */
    key: text('key').primaryKey(),
    text: text('text').notNull(),
    confidence: real('confidence'),
    createdAt: text('created_at').notNull()
  }
)
