/**
 * Typed repositories mapping DB rows ↔ domain objects.
 * JSON-ish columns are parsed/stringified here and nowhere else.
 */
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type AuditEvent,
  type DocumentDirection,
  type DocumentListFilter,
  type TaxDocument,
  type VatRateLine
} from '../../shared/domain'
import {
  auditEvents,
  documents,
  exchangeRates,
  importJobs,
  ocrCache,
  settings
} from './schema'

type DocumentRow = typeof documents.$inferSelect
type Db = BetterSQLite3Database

function nowIso(): string {
  return new Date().toISOString()
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * The renderer's "Why was this proposed?" panel reads the classification from
 * extractionRawJson.vatClassification; the DB keeps it in its own column, so
 * merge on read and strip again on write to avoid storing it twice.
 */
function mergeClassificationIntoRaw(raw: unknown, classification: unknown): unknown {
  if (classification === null || classification === undefined) return raw
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { ...base, vatClassification: classification }
}

function stripClassificationFromRaw(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  if (!('vatClassification' in (raw as Record<string, unknown>))) return raw
  const { vatClassification: _omit, ...rest } = raw as Record<string, unknown>
  return rest
}

function rowToDocument(row: DocumentRow): TaxDocument {
  return {
    id: row.id,
    direction: row.direction,
    originalFilename: row.originalFilename,
    storedFilename: row.storedFilename,
    storedRelativePath: row.storedRelativePath,
    sha256: row.sha256,
    mimeType: 'application/pdf',
    pageCount: row.pageCount,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    serviceDateFrom: row.serviceDateFrom,
    serviceDateTo: row.serviceDateTo,
    receiptDate: row.receiptDate,
    paymentDate: row.paymentDate,
    dueDate: row.dueDate,
    paymentStatus: row.paymentStatus,
    issuerName: row.issuerName,
    issuerAddress: row.issuerAddress,
    issuerCountryCode: row.issuerCountryCode,
    issuerTaxNumber: row.issuerTaxNumber,
    issuerVatId: row.issuerVatId,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    recipientCountryCode: row.recipientCountryCode,
    recipientTaxNumber: row.recipientTaxNumber,
    recipientVatId: row.recipientVatId,
    recipientIsBusiness: row.recipientIsBusiness,
    description: row.description,
    expenseCategory: row.expenseCategory,
    originalCurrency: row.originalCurrency,
    netAmountOriginal: row.netAmountOriginal,
    vatAmountOriginal: row.vatAmountOriginal,
    grossAmountOriginal: row.grossAmountOriginal,
    exchangeRateToEur: row.exchangeRateToEur,
    exchangeRateDate: row.exchangeRateDate,
    exchangeRateSource: row.exchangeRateSource,
    netAmountEur: row.netAmountEur,
    vatAmountEur: row.vatAmountEur,
    grossAmountEur: row.grossAmountEur,
    vatRates: parseJson<VatRateLine[]>(row.vatRatesJson, []),
    vatTreatmentCode: row.vatTreatmentCode,
    vatTreatmentLabel: row.vatTreatmentLabel,
    vatLegalBasis: row.vatLegalBasis,
    taxPeriodYear: row.taxPeriodYear,
    taxPeriodQuarter: (row.taxPeriodQuarter as 1 | 2 | 3 | 4 | null) ?? null,
    taxPeriodMonth: row.taxPeriodMonth,
    extractedText: row.extractedText,
    extractionProvider: row.extractionProvider,
    extractionVersion: row.extractionVersion,
    extractionConfidence: row.extractionConfidence,
    fieldConfidence: parseJson<Record<string, number>>(row.fieldConfidenceJson, {}),
    extractionRawJson: mergeClassificationIntoRaw(
      parseJson<unknown>(row.extractionRawJson, null),
      parseJson<unknown>(row.vatClassificationJson, null)
    ),
    reviewStatus: row.reviewStatus,
    reviewReasons: parseJson<string[]>(row.reviewReasonsJson, []),
    issues: parseJson<TaxDocument['issues']>(row.issuesJson, []),
    userConfirmedAt: row.userConfirmedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function documentToRow(doc: TaxDocument, vatClassification?: unknown): DocumentRow {
  return {
    id: doc.id,
    direction: doc.direction,
    originalFilename: doc.originalFilename,
    storedFilename: doc.storedFilename,
    storedRelativePath: doc.storedRelativePath,
    sha256: doc.sha256,
    mimeType: doc.mimeType,
    pageCount: doc.pageCount,
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate,
    serviceDateFrom: doc.serviceDateFrom,
    serviceDateTo: doc.serviceDateTo,
    receiptDate: doc.receiptDate,
    paymentDate: doc.paymentDate,
    dueDate: doc.dueDate,
    paymentStatus: doc.paymentStatus,
    issuerName: doc.issuerName,
    issuerAddress: doc.issuerAddress,
    issuerCountryCode: doc.issuerCountryCode,
    issuerTaxNumber: doc.issuerTaxNumber,
    issuerVatId: doc.issuerVatId,
    recipientName: doc.recipientName,
    recipientAddress: doc.recipientAddress,
    recipientCountryCode: doc.recipientCountryCode,
    recipientTaxNumber: doc.recipientTaxNumber,
    recipientVatId: doc.recipientVatId,
    recipientIsBusiness: doc.recipientIsBusiness,
    description: doc.description,
    expenseCategory: doc.expenseCategory,
    originalCurrency: doc.originalCurrency,
    netAmountOriginal: doc.netAmountOriginal,
    vatAmountOriginal: doc.vatAmountOriginal,
    grossAmountOriginal: doc.grossAmountOriginal,
    exchangeRateToEur: doc.exchangeRateToEur,
    exchangeRateDate: doc.exchangeRateDate,
    exchangeRateSource: doc.exchangeRateSource,
    netAmountEur: doc.netAmountEur,
    vatAmountEur: doc.vatAmountEur,
    grossAmountEur: doc.grossAmountEur,
    vatRatesJson: JSON.stringify(doc.vatRates ?? []),
    vatTreatmentCode: doc.vatTreatmentCode,
    vatTreatmentLabel: doc.vatTreatmentLabel,
    vatLegalBasis: doc.vatLegalBasis,
    vatClassificationJson:
      vatClassification === undefined ? null : JSON.stringify(vatClassification),
    taxPeriodYear: doc.taxPeriodYear,
    taxPeriodQuarter: doc.taxPeriodQuarter,
    taxPeriodMonth: doc.taxPeriodMonth,
    extractedText: doc.extractedText,
    extractionProvider: doc.extractionProvider,
    extractionVersion: doc.extractionVersion,
    extractionConfidence: doc.extractionConfidence,
    fieldConfidenceJson: JSON.stringify(doc.fieldConfidence ?? {}),
    extractionRawJson:
      doc.extractionRawJson === null || doc.extractionRawJson === undefined
        ? null
        : JSON.stringify(stripClassificationFromRaw(doc.extractionRawJson)),
    reviewStatus: doc.reviewStatus,
    reviewReasonsJson: JSON.stringify(doc.reviewReasons ?? []),
    issuesJson: JSON.stringify(doc.issues ?? []),
    userConfirmedAt: doc.userConfirmedAt,
    deletedAt: doc.deletedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export interface DocumentListPage {
  documents: TaxDocument[]
  total: number
}

export class DocumentRepository {
  constructor(private readonly db: Db) {}

  insert(doc: TaxDocument, vatClassification?: unknown): void {
    this.db.insert(documents).values(documentToRow(doc, vatClassification)).run()
  }

  /** Full-row update by id; bumps updatedAt. */
  update(doc: TaxDocument, vatClassification?: unknown): TaxDocument {
    const next: TaxDocument = { ...doc, updatedAt: nowIso() }
    const row = documentToRow(next, vatClassification)
    const { id: _id, createdAt: _createdAt, ...rest } = row
    if (vatClassification === undefined) {
      // keep the previously stored classification JSON
      delete (rest as Partial<DocumentRow>).vatClassificationJson
    }
    this.db.update(documents).set(rest).where(eq(documents.id, doc.id)).run()
    return next
  }

  getById(id: string): TaxDocument | null {
    const row = this.db.select().from(documents).where(eq(documents.id, id)).get()
    return row ? rowToDocument(row) : null
  }

  /** Duplicate detection: same content hash, not deleted. */
  findActiveBySha256(sha256: string): TaxDocument | null {
    const row = this.db
      .select()
      .from(documents)
      .where(and(eq(documents.sha256, sha256), isNull(documents.deletedAt)))
      .get()
    return row ? rowToDocument(row) : null
  }

  listAllActive(): TaxDocument[] {
    return this.db
      .select()
      .from(documents)
      .where(isNull(documents.deletedAt))
      .all()
      .map(rowToDocument)
  }

  list(filter: DocumentListFilter): DocumentListPage {
    const conditions: SQL[] = []
    if (!filter.includeDeleted) conditions.push(isNull(documents.deletedAt))
    if (filter.direction) conditions.push(eq(documents.direction, filter.direction))
    if (filter.reviewStatus) conditions.push(eq(documents.reviewStatus, filter.reviewStatus))
    if (filter.vatTreatmentCode) {
      conditions.push(eq(documents.vatTreatmentCode, filter.vatTreatmentCode))
    }
    if (filter.year !== undefined) conditions.push(eq(documents.taxPeriodYear, filter.year))
    if (filter.quarter !== undefined) {
      conditions.push(eq(documents.taxPeriodQuarter, filter.quarter))
    }
    if (filter.search && filter.search.trim() !== '') {
      const pattern = `%${escapeLike(filter.search.trim())}%`
      const searchCondition = or(
        sql`${documents.issuerName} LIKE ${pattern} ESCAPE '\\'`,
        sql`${documents.recipientName} LIKE ${pattern} ESCAPE '\\'`,
        sql`${documents.description} LIKE ${pattern} ESCAPE '\\'`,
        sql`${documents.invoiceNumber} LIKE ${pattern} ESCAPE '\\'`,
        sql`${documents.originalFilename} LIKE ${pattern} ESCAPE '\\'`
      )
      if (searchCondition) conditions.push(searchCondition)
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const rows = this.db
      .select()
      .from(documents)
      .where(where)
      .orderBy(
        // invoice date desc, nulls last, stable tiebreak on creation time
        sql`CASE WHEN ${documents.invoiceDate} IS NULL THEN 1 ELSE 0 END`,
        desc(documents.invoiceDate),
        desc(documents.createdAt)
      )
      .limit(limit)
      .offset(offset)
      .all()

    const totalRow = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(documents)
      .where(where)
      .get()

    return { documents: rows.map(rowToDocument), total: totalRow?.count ?? 0 }
  }

  hardDelete(id: string): void {
    this.db.delete(documents).where(eq(documents.id, id)).run()
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'app'

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  get(): AppSettings {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .get()
    const stored = row ? parseJson<Partial<AppSettings>>(row.valueJson, {}) : {}
    return { ...DEFAULT_SETTINGS, ...stored }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const merged = { ...this.get(), ...patch }
    this.db
      .insert(settings)
      .values({ key: SETTINGS_KEY, valueJson: JSON.stringify(merged) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { valueJson: JSON.stringify(merged) }
      })
      .run()
    return merged
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditAppend {
  documentId: string | null
  eventType: string
  previousValue?: unknown
  nextValue?: unknown
  source: 'system' | 'user'
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  append(event: AuditAppend): AuditEvent {
    const record: AuditEvent = {
      id: uuidv4(),
      documentId: event.documentId,
      eventType: event.eventType,
      previousValue: event.previousValue ?? null,
      nextValue: event.nextValue ?? null,
      createdAt: nowIso(),
      source: event.source
    }
    this.db
      .insert(auditEvents)
      .values({
        id: record.id,
        documentId: record.documentId,
        eventType: record.eventType,
        previousValueJson:
          record.previousValue === null ? null : JSON.stringify(record.previousValue),
        nextValueJson: record.nextValue === null ? null : JSON.stringify(record.nextValue),
        createdAt: record.createdAt,
        source: record.source
      })
      .run()
    return record
  }

  listByDocument(documentId: string): AuditEvent[] {
    return this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, documentId))
      .orderBy(asc(auditEvents.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        documentId: row.documentId,
        eventType: row.eventType,
        previousValue: parseJson<unknown>(row.previousValueJson, null),
        nextValue: parseJson<unknown>(row.nextValueJson, null),
        createdAt: row.createdAt,
        source: row.source
      }))
  }
}

// ---------------------------------------------------------------------------
// Exchange rates
// ---------------------------------------------------------------------------

export interface StoredExchangeRate {
  currency: string
  date: string
  rateToEur: number
  source: string
}

export class ExchangeRateRepository {
  constructor(private readonly db: Db) {}

  /**
   * Latest cached rate for `currency` at or before `date`,
   * at most `maxDaysBack` days older.
   */
  find(currency: string, date: string, maxDaysBack = 7): StoredExchangeRate | null {
    const rows = this.db
      .select()
      .from(exchangeRates)
      .where(eq(exchangeRates.currency, currency.toUpperCase()))
      .all()
    const limitMs = maxDaysBack * 24 * 60 * 60 * 1000
    const target = Date.parse(date)
    if (Number.isNaN(target)) return null
    let best: StoredExchangeRate | null = null
    for (const row of rows) {
      const rowMs = Date.parse(row.date)
      if (Number.isNaN(rowMs) || rowMs > target || target - rowMs > limitMs) continue
      if (!best || row.date > best.date) {
        best = {
          currency: row.currency,
          date: row.date,
          rateToEur: row.rateToEur,
          source: row.source
        }
      }
    }
    return best
  }

  save(rate: StoredExchangeRate): void {
    const existing = this.db
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.currency, rate.currency.toUpperCase()),
          eq(exchangeRates.date, rate.date),
          eq(exchangeRates.source, rate.source)
        )
      )
      .get()
    if (existing) return
    this.db
      .insert(exchangeRates)
      .values({
        id: uuidv4(),
        currency: rate.currency.toUpperCase(),
        date: rate.date,
        rateToEur: rate.rateToEur,
        source: rate.source,
        createdAt: nowIso()
      })
      .run()
  }
}

// ---------------------------------------------------------------------------
// Import jobs
// ---------------------------------------------------------------------------

export type ImportJobRow = typeof importJobs.$inferSelect

const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'duplicate'
])

export class ImportJobRepository {
  constructor(private readonly db: Db) {}

  create(row: {
    id: string
    importId: string
    sourcePath: string
    direction: DocumentDirection
    status: string
  }): void {
    const now = nowIso()
    this.db
      .insert(importJobs)
      .values({ ...row, documentId: null, errorKey: null, createdAt: now, updatedAt: now })
      .run()
  }

  update(
    id: string,
    patch: { status?: string; documentId?: string | null; errorKey?: string | null }
  ): void {
    this.db
      .update(importJobs)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(importJobs.id, id))
      .run()
  }

  get(id: string): ImportJobRow | null {
    return this.db.select().from(importJobs).where(eq(importJobs.id, id)).get() ?? null
  }

  /** Jobs that were in flight when the app last stopped. */
  listUnfinished(): ImportJobRow[] {
    return this.db
      .select()
      .from(importJobs)
      .all()
      .filter((row) => !TERMINAL_JOB_STATUSES.has(row.status))
  }

  deleteFinishedByImportId(importId: string): void {
    const rows = this.db
      .select()
      .from(importJobs)
      .where(eq(importJobs.importId, importId))
      .all()
    for (const row of rows) {
      if (TERMINAL_JOB_STATUSES.has(row.status)) {
        this.db.delete(importJobs).where(eq(importJobs.id, row.id)).run()
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OCR cache
// ---------------------------------------------------------------------------

export class OcrCacheRepository {
  constructor(private readonly db: Db) {}

  get(key: string): { text: string; confidence: number | null } | null {
    const row = this.db.select().from(ocrCache).where(eq(ocrCache.key, key)).get()
    return row ? { text: row.text, confidence: row.confidence } : null
  }

  put(key: string, text: string, confidence: number | null): void {
    this.db
      .insert(ocrCache)
      .values({ key, text, confidence, createdAt: nowIso() })
      .onConflictDoUpdate({ target: ocrCache.key, set: { text, confidence } })
      .run()
  }
}

// ---------------------------------------------------------------------------

export interface Repositories {
  documents: DocumentRepository
  settings: SettingsRepository
  audit: AuditRepository
  exchangeRates: ExchangeRateRepository
  importJobs: ImportJobRepository
  ocrCache: OcrCacheRepository
}

export function createRepositories(db: Db): Repositories {
  return {
    documents: new DocumentRepository(db),
    settings: new SettingsRepository(db),
    audit: new AuditRepository(db),
    exchangeRates: new ExchangeRateRepository(db),
    importJobs: new ImportJobRepository(db),
    ocrCache: new OcrCacheRepository(db)
  }
}
