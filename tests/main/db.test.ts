import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type DbHandle } from '../../src/main/db/connection'
import { appliedSchemaVersion, CURRENT_SCHEMA_VERSION } from '../../src/main/db/migrations'
import { createRepositories, type Repositories } from '../../src/main/db/repository'
import { BMF_MONTHLY_SOURCE } from '../../src/main/rates/bmf-monthly'
import type { TaxDocument } from '../../src/shared/domain'

let dir: string
let handle: DbHandle
let repos: Repositories

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-db-'))
  handle = openDatabase(path.join(dir, 'test.sqlite3'))
  repos = createRepositories(handle.db)
})

afterEach(() => {
  handle.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function fullDocument(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return {
    id: '4c9f2c4e-8f1a-4f6b-9d3e-1a2b3c4d5e6f',
    direction: 'expense',
    originalFilename: 'Rechnung Bürobedarf.pdf',
    storedFilename: '2026_02_10-Musterladen_Buerobedarf-RE-2026-042.pdf',
    storedRelativePath:
      'documents/2026/Q1/expense/2026_02_10-Musterladen_Buerobedarf-RE-2026-042.pdf',
    sha256: 'a'.repeat(64),
    mimeType: 'application/pdf',
    pageCount: 2,
    invoiceNumber: 'RE-2026-042',
    invoiceDate: '2026-02-10',
    serviceDateFrom: '2026-02-01',
    serviceDateTo: '2026-02-10',
    receiptDate: null,
    paymentDate: '2026-02-12',
    dueDate: '2026-02-24',
    paymentStatus: 'paid',
    issuerName: 'Musterladen GmbH',
    issuerAddress: 'Musterstraße 1, 10115 Berlin',
    issuerCountryCode: 'DE',
    issuerTaxNumber: '30/123/45678',
    issuerVatId: 'DE123456789',
    recipientName: 'Max Beispiel',
    recipientAddress: 'Beispielweg 2, 20095 Hamburg',
    recipientCountryCode: 'DE',
    recipientTaxNumber: null,
    recipientVatId: 'DE987654321',
    recipientIsBusiness: true,
    description: 'Bürobedarf und Druckerpapier',
    expenseCategory: 'office_supplies',
    originalCurrency: 'EUR',
    netAmountOriginal: 84.03,
    vatAmountOriginal: 15.97,
    grossAmountOriginal: 100.0,
    exchangeRateToEur: null,
    exchangeRateDate: null,
    exchangeRateSource: null,
    netAmountEur: 84.03,
    vatAmountEur: 15.97,
    grossAmountEur: 100.0,
    vatRates: [
      { rate: 19, netAmountOriginal: 84.03, vatAmountOriginal: 15.97, grossAmountOriginal: 100.0 }
    ],
    vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
    vatTreatmentLabel: 'Vorsteuerabzugsfähige Ausgabe',
    vatLegalBasis: '§ 15 UStG',
    taxPeriodYear: 2026,
    taxPeriodQuarter: 1,
    taxPeriodMonth: 2,
    extractedText: 'Rechnung RE-2026-042 …',
    extractionProvider: 'local-parser',
    extractionVersion: '1.0.0',
    extractionConfidence: 0.87,
    fieldConfidence: { invoiceDate: 0.95, grossAmount: 0.9 },
    extractionRawJson: { signals: { reverseChargeWording: false }, note: 'raw blob' },
    reviewStatus: 'needs_review',
    reviewReasons: ['missing_payment_date'],
    issues: [
      {
        code: 'missing_payment_date',
        severity: 'warning',
        messageKey: 'issues.missing_payment_date',
        field: 'paymentDate',
        params: { hint: 'x' }
      }
    ],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z',
    ...overrides
  }
}

describe('migrations', () => {
  it('applies migration 0001 and records it', () => {
    expect(appliedSchemaVersion(handle.sqlite)).toBe(CURRENT_SCHEMA_VERSION)
    const tables = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    for (const expected of [
      'documents',
      'audit_events',
      'settings',
      'exchange_rates',
      'import_jobs',
      'ocr_cache',
      'schema_migrations'
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('is idempotent: opening the same database twice runs no duplicate migrations', () => {
    const dbFile = path.join(dir, 'idempotent.sqlite3')
    const first = openDatabase(dbFile)
    createRepositories(first.db).documents.insert(fullDocument())
    first.close()

    const second = openDatabase(dbFile) // must not throw or duplicate anything
    const migrationRows = second.sqlite
      .prepare('SELECT COUNT(*) AS c FROM schema_migrations')
      .get() as { c: number }
    expect(migrationRows.c).toBe(CURRENT_SCHEMA_VERSION)
    const doc = createRepositories(second.db).documents.getById(fullDocument().id)
    expect(doc).not.toBeNull()
    second.close()
  })
})

describe('DocumentRepository', () => {
  it('round-trips a full TaxDocument including all JSON fields', () => {
    const doc = fullDocument()
    const classification = { code: 'DE_EXPENSE_INPUT_VAT', confidence: 'high' }
    repos.documents.insert(doc, classification)
    const loaded = repos.documents.getById(doc.id)
    // the stored classification is surfaced on read as extractionRawJson.vatClassification
    expect(loaded).toEqual({
      ...doc,
      extractionRawJson: {
        ...(doc.extractionRawJson as Record<string, unknown>),
        vatClassification: classification
      }
    })
  })

  it('does not duplicate the merged vatClassification back into the raw column', () => {
    const doc = fullDocument({ id: '22222222-2222-4222-8222-222222222222', sha256: 'd'.repeat(64) })
    const classification = { code: 'DE_DOMESTIC_19', confidence: 'high' }
    repos.documents.insert(doc, classification)
    const loaded = repos.documents.getById(doc.id)!
    // write back without touching the classification: merged key must not leak
    repos.documents.update(loaded)
    const reloaded = repos.documents.getById(doc.id)!
    expect(
      (reloaded.extractionRawJson as Record<string, unknown>).vatClassification
    ).toEqual(classification)
    const raw = handle.sqlite
      .prepare('SELECT extraction_raw_json FROM documents WHERE id = ?')
      .get(doc.id) as { extraction_raw_json: string }
    expect(raw.extraction_raw_json.includes('vatClassification')).toBe(false)
  })

  it('update preserves createdAt and bumps updatedAt', async () => {
    const doc = fullDocument()
    repos.documents.insert(doc)
    await new Promise((r) => setTimeout(r, 5))
    const updated = repos.documents.update({ ...doc, description: 'Neuer Text' })
    const loaded = repos.documents.getById(doc.id)!
    expect(loaded.description).toBe('Neuer Text')
    expect(loaded.createdAt).toBe(doc.createdAt)
    expect(loaded.updatedAt).toBe(updated.updatedAt)
    expect(loaded.updatedAt >= doc.updatedAt).toBe(true)
  })

  it('only applies guarded background updates to an unchanged active document', () => {
    const doc = fullDocument()
    repos.documents.insert(doc)

    const updated = repos.documents.updateIfUnchanged(
      { ...doc, description: 'Fresh extraction' },
      doc.updatedAt
    )
    expect(updated?.description).toBe('Fresh extraction')

    const stale = repos.documents.updateIfUnchanged(
      { ...doc, description: 'Stale extraction' },
      doc.updatedAt
    )
    expect(stale).toBeNull()
    expect(repos.documents.getById(doc.id)?.description).toBe('Fresh extraction')

    const current = repos.documents.getById(doc.id)!
    const deleted = repos.documents.update({
      ...current,
      deletedAt: '2026-07-16T12:00:00.000Z'
    })
    expect(
      repos.documents.updateIfUnchanged(
        { ...deleted, description: 'Should not resurrect' },
        deleted.updatedAt
      )
    ).toBeNull()
    expect(repos.documents.getById(doc.id)?.deletedAt).not.toBeNull()
  })

  it('detects duplicates by sha256, ignoring deleted documents', () => {
    const sha = 'b'.repeat(64)
    const doc = fullDocument({ id: '11111111-1111-4111-8111-111111111111', sha256: sha })
    repos.documents.insert(doc)
    expect(repos.documents.findActiveBySha256(sha)?.id).toBe(doc.id)
    expect(repos.documents.findActiveBySha256('c'.repeat(64))).toBeNull()

    repos.documents.update({ ...doc, deletedAt: new Date().toISOString() })
    expect(repos.documents.findActiveBySha256(sha)).toBeNull()
  })

  it('lists with filters, search and pagination; nulls sort last', () => {
    repos.documents.insert(
      fullDocument({
        id: '22222222-2222-4222-8222-222222222222',
        sha256: 'd'.repeat(64),
        createdAt: '2026-02-11T10:00:00.000Z'
      })
    )
    repos.documents.insert(
      fullDocument({
        id: '33333333-3333-4333-8333-333333333333',
        sha256: 'e'.repeat(64),
        direction: 'income',
        invoiceDate: '2026-03-05',
        issuerName: 'Max Beispiel',
        recipientName: 'Kunde AG',
        invoiceNumber: 'INV-77',
        createdAt: '2026-01-01T10:00:00.000Z'
      })
    )
    repos.documents.insert(
      fullDocument({
        id: '44444444-4444-4444-8444-444444444444',
        sha256: 'f'.repeat(64),
        invoiceDate: null,
        taxPeriodYear: null,
        taxPeriodQuarter: null,
        taxPeriodMonth: null,
        createdAt: '2026-04-01T10:00:00.000Z'
      })
    )

    const all = repos.documents.list({})
    expect(all.total).toBe(3)
    // newest invoice date first, null date last
    expect(all.documents.map((d) => d.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444'
    ])
    expect(repos.documents.list({ sort: 'oldest' }).documents.map((d) => d.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    ])
    expect(repos.documents.list({ sort: 'recent' }).documents.map((d) => d.id)).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ])

    expect(repos.documents.list({ direction: 'income' }).total).toBe(1)
    expect(repos.documents.list({ year: 2026, quarter: 1 }).total).toBe(2)
    expect(
      repos.documents.list({
        year: 2026,
        quarter: 1,
        includeUnassigned: true
      }).documents.map((document) => document.id)
    ).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444'
    ])
    expect(repos.documents.list({ search: 'Kunde' }).total).toBe(1)
    expect(repos.documents.list({ search: 'INV-77' }).total).toBe(1)
    expect(repos.documents.list({ search: '%' }).total).toBe(0) // escaped, not a wildcard
    expect(repos.documents.list({ limit: 1, offset: 1 }).documents).toHaveLength(1)

    // deleted excluded by default
    const target = repos.documents.getById('22222222-2222-4222-8222-222222222222')!
    repos.documents.update({ ...target, deletedAt: new Date().toISOString() })
    expect(repos.documents.list({}).total).toBe(2)
    expect(repos.documents.list({ includeDeleted: true }).total).toBe(3)
  })
})

describe('SettingsRepository', () => {
  it('merges stored values over defaults', () => {
    const initial = repos.settings.get()
    expect(initial.language).toBe('system')
    const updated = repos.settings.update({ language: 'de', businessName: 'Max Beispiel' })
    expect(updated.language).toBe('de')
    expect(repos.settings.get().businessName).toBe('Max Beispiel')
    expect(repos.settings.get().vatFilingFrequency).toBe('quarterly') // default preserved
  })
})

describe('AuditRepository', () => {
  it('appends and lists events for a document', () => {
    const docId = fullDocument().id
    repos.audit.append({
      documentId: docId,
      eventType: 'import',
      nextValue: { sha256: 'a'.repeat(64) },
      source: 'system'
    })
    repos.audit.append({
      documentId: docId,
      eventType: 'manual_correction',
      previousValue: { field: 'invoiceDate', value: null },
      nextValue: { field: 'invoiceDate', value: '2026-02-10' },
      source: 'user'
    })
    const events = repos.audit.listByDocument(docId)
    expect(events).toHaveLength(2)
    expect(events[0]!.eventType).toBe('import')
    expect(events[1]!.previousValue).toEqual({ field: 'invoiceDate', value: null })
  })
})

describe('ExchangeRateRepository', () => {
  it('finds the closest rate at or before the requested date within 7 days', () => {
    repos.exchangeRates.save({
      currency: 'USD',
      date: '2026-01-05',
      rateToEur: 0.91,
      source: 'ECB'
    })
    repos.exchangeRates.save({
      currency: 'USD',
      date: '2026-01-08',
      rateToEur: 0.92,
      source: 'ECB'
    })
    expect(repos.exchangeRates.find('USD', '2026-01-08')?.rateToEur).toBe(0.92)
    expect(repos.exchangeRates.find('usd', '2026-01-07')?.rateToEur).toBe(0.91)
    expect(repos.exchangeRates.find('USD', '2026-01-20')).toBeNull() // too old
    expect(repos.exchangeRates.find('GBP', '2026-01-08')).toBeNull()
  })

  it('reuses and prefers an official BMF monthly rate throughout its month', () => {
    repos.exchangeRates.save({
      currency: 'USD',
      date: '2026-01-01',
      rateToEur: 0.9,
      source: `${BMF_MONTHLY_SOURCE} 2026-01`
    })
    repos.exchangeRates.save({
      currency: 'USD',
      date: '2026-01-19',
      rateToEur: 0.92,
      source: 'ECB'
    })

    expect(repos.exchangeRates.find('USD', '2026-01-31')).toEqual({
      currency: 'USD',
      date: '2026-01-01',
      rateToEur: 0.9,
      source: `${BMF_MONTHLY_SOURCE} 2026-01`
    })
    expect(repos.exchangeRates.findEcbDaily('USD', '2026-01-20')).toEqual({
      currency: 'USD',
      date: '2026-01-19',
      rateToEur: 0.92,
      source: 'ECB'
    })
    expect(repos.exchangeRates.find('USD', '2026-02-01')).toBeNull()
  })
})

describe('OcrCacheRepository', () => {
  it('stores per-page OCR text under sha:page keys', () => {
    const key = `${'a'.repeat(64)}:1`
    expect(repos.ocrCache.get(key)).toBeNull()
    repos.ocrCache.put(key, 'Erkannter Text', 0.83)
    expect(repos.ocrCache.get(key)).toEqual({ text: 'Erkannter Text', confidence: 0.83 })
    repos.ocrCache.put(key, 'Besserer Text', 0.9) // upsert
    expect(repos.ocrCache.get(key)?.text).toBe('Besserer Text')
  })
})
