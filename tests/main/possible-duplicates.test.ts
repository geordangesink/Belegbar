/**
 * Near-duplicate detection: repository query behavior and the pipeline-level
 * issue attachment. All document data below is synthetic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, type DbHandle } from '../../src/main/db/connection'
import { createRepositories, type Repositories } from '../../src/main/db/repository'
import { ImportPipeline } from '../../src/main/import/pipeline'
import { ensureDataDirs } from '../../src/main/storage/paths'
import { nullLogger } from '../../src/main/log'
import {
  GROSS_ONLY_RECEIPT,
  USDT_INVOICE_INCOME
} from '../../src/core/parsing/parse-invoice.fixtures'
import type { ExtractionService, DocumentTextResult } from '../../src/main/extraction/service'
import type { ImportFileProgress, TaxDocument } from '../../src/shared/domain'

let dir: string
let handle: DbHandle
let repos: Repositories

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-neardup-'))
  handle = openDatabase(path.join(dir, 'test.sqlite3'))
  repos = createRepositories(handle.db)
})

afterEach(() => {
  handle.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

let docCounter = 0

/** Synthetic active expense document; every call gets a unique id + sha. */
function makeDoc(overrides: Partial<TaxDocument> = {}): TaxDocument {
  docCounter += 1
  const suffix = String(docCounter).padStart(12, '0')
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    direction: 'expense',
    originalFilename: 'Beleg.pdf',
    storedFilename: `2026_03_05-Beispiel_Laden-R-1001_${suffix}.pdf`,
    storedRelativePath: `documents/2026/Q1/expense/2026_03_05-Beispiel_Laden_${suffix}.pdf`,
    sha256: suffix.slice(-2).repeat(32),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: 'R-1001',
    invoiceDate: '2026-03-05',
    serviceDateFrom: null,
    serviceDateTo: null,
    receiptDate: null,
    paymentDate: null,
    dueDate: null,
    paymentStatus: 'unknown',
    issuerName: 'Beispiel Laden GmbH',
    issuerAddress: null,
    issuerCountryCode: 'DE',
    issuerTaxNumber: null,
    issuerVatId: null,
    recipientName: 'Max Beispiel',
    recipientAddress: null,
    recipientCountryCode: 'DE',
    recipientTaxNumber: null,
    recipientVatId: null,
    recipientIsBusiness: null,
    description: 'Einkauf',
    expenseCategory: null,
    originalCurrency: 'EUR',
    netAmountOriginal: 10.0,
    vatAmountOriginal: 1.9,
    grossAmountOriginal: 11.9,
    exchangeRateToEur: null,
    exchangeRateDate: null,
    exchangeRateSource: null,
    netAmountEur: 10.0,
    vatAmountEur: 1.9,
    grossAmountEur: 11.9,
    vatRates: [],
    vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
    vatTreatmentLabel: null,
    vatLegalBasis: null,
    taxPeriodYear: 2026,
    taxPeriodQuarter: 1,
    taxPeriodMonth: 3,
    extractedText: null,
    extractionProvider: 'local-parser',
    extractionVersion: '1.0.0',
    extractionConfidence: null,
    fieldConfidence: {},
    extractionRawJson: null,
    reviewStatus: 'needs_review',
    reviewReasons: [],
    issues: [],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2026-03-05T10:00:00.000Z',
    updatedAt: '2026-03-05T10:00:00.000Z',
    ...overrides
  }
}

/** Criteria matching makeDoc() defaults, as an incoming file with new bytes. */
function baseCriteria() {
  return {
    direction: 'expense' as const,
    invoiceDate: '2026-03-05',
    grossAmountOriginal: 11.9,
    invoiceNumber: 'R-1001',
    issuerName: 'Beispiel Laden GmbH',
    recipientName: null,
    excludeSha256: 'f'.repeat(64)
  }
}

describe('DocumentRepository.findPossibleDuplicates', () => {
  it('matches on direction + date + amount + invoice number', () => {
    const existing = makeDoc()
    repos.documents.insert(existing)
    const matches = repos.documents.findPossibleDuplicates(baseCriteria())
    expect(matches.map((d) => d.id)).toEqual([existing.id])
  })

  it('applies the ±0.01 gross amount tolerance inclusively', () => {
    repos.documents.insert(makeDoc({ grossAmountOriginal: 11.91 }))
    expect(repos.documents.findPossibleDuplicates(baseCriteria())).toHaveLength(1)

    repos.documents.insert(makeDoc({ grossAmountOriginal: 11.92, invoiceNumber: 'R-2002' }))
    expect(
      repos.documents.findPossibleDuplicates({
        ...baseCriteria(),
        invoiceNumber: 'R-2002',
        issuerName: null, // isolate the invoice-number matcher
        grossAmountOriginal: 11.9
      })
    ).toHaveLength(0)
  })

  it('falls back to a case-insensitive counterparty match without invoice numbers', () => {
    repos.documents.insert(makeDoc({ invoiceNumber: null }))
    const matches = repos.documents.findPossibleDuplicates({
      ...baseCriteria(),
      invoiceNumber: null,
      issuerName: 'BEISPIEL LADEN GMBH'
    })
    expect(matches).toHaveLength(1)
  })

  it('uses the recipient as counterparty for income documents', () => {
    repos.documents.insert(
      makeDoc({
        direction: 'income',
        invoiceNumber: null,
        issuerName: 'Max Beispiel',
        recipientName: 'Kunde AG'
      })
    )
    const matches = repos.documents.findPossibleDuplicates({
      ...baseCriteria(),
      direction: 'income',
      invoiceNumber: null,
      issuerName: 'Max Beispiel',
      recipientName: 'kunde ag'
    })
    expect(matches).toHaveLength(1)
    // a different recipient is not a duplicate even though the issuer (self) matches
    expect(
      repos.documents.findPossibleDuplicates({
        ...baseCriteria(),
        direction: 'income',
        invoiceNumber: null,
        issuerName: 'Max Beispiel',
        recipientName: 'Andere Kundin GmbH'
      })
    ).toHaveLength(0)
  })

  it('excludes deleted documents', () => {
    repos.documents.insert(makeDoc({ deletedAt: '2026-03-06T00:00:00.000Z' }))
    expect(repos.documents.findPossibleDuplicates(baseCriteria())).toHaveLength(0)
  })

  it('excludes documents with a different direction', () => {
    repos.documents.insert(makeDoc({ direction: 'income' }))
    expect(repos.documents.findPossibleDuplicates(baseCriteria())).toHaveLength(0)
  })

  it('excludes documents with a different invoice date', () => {
    repos.documents.insert(makeDoc({ invoiceDate: '2026-03-06' }))
    expect(repos.documents.findPossibleDuplicates(baseCriteria())).toHaveLength(0)
  })

  it('excludes the byte-identical document via excludeSha256', () => {
    const existing = makeDoc()
    repos.documents.insert(existing)
    expect(
      repos.documents.findPossibleDuplicates({
        ...baseCriteria(),
        excludeSha256: existing.sha256
      })
    ).toHaveLength(0)
  })

  it('returns nothing when neither invoice number nor counterparty is available', () => {
    repos.documents.insert(makeDoc({ invoiceNumber: null, issuerName: null }))
    expect(
      repos.documents.findPossibleDuplicates({
        ...baseCriteria(),
        invoiceNumber: null,
        issuerName: null
      })
    ).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Pipeline-level: the possible_duplicate issue is attached to the new
// document without blocking the import or touching the existing one.
// ---------------------------------------------------------------------------

const TERMINAL = new Set(['completed', 'completed_with_warnings', 'failed', 'duplicate'])

function fakeTextResult(fullText: string): DocumentTextResult {
  return {
    pageCount: 1,
    pages: [{ page: 1, text: fullText, source: 'native', ocrConfidence: null }],
    fullText,
    ocrUsed: false,
    ocrPages: [],
    ocrFailedPages: [],
    ocrConfidence: null
  }
}

async function runImport(
  sourceContent: string,
  options: { fullText?: string; direction?: 'income' | 'expense' } = {}
): Promise<ImportFileProgress> {
  const dataDir = path.join(dir, 'data')
  ensureDataDirs(dataDir)
  repos.settings.update({ moveOriginalsAfterImport: false })

  const extraction = {
    extractDocumentText: async () => fakeTextResult(options.fullText ?? GROSS_ONLY_RECEIPT),
    thumbnail: async () => undefined
  } as unknown as ExtractionService

  let resolveTerminal!: (p: ImportFileProgress) => void
  const terminal = new Promise<ImportFileProgress>((resolve) => {
    resolveTerminal = resolve
  })

  const pipeline = new ImportPipeline({
    dataDir,
    repos,
    extraction,
    ratesProviders: {
      bmf: { name: 'test-bmf', getRate: async () => null },
      ecb: { name: 'test-ecb', getRate: async () => null }
    },
    emit: (progress) => {
      if (TERMINAL.has(progress.status)) resolveTerminal(progress)
    },
    log: nullLogger
  })

  const sourcePath = path.join(dir, 'incoming', 'scan.pdf')
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
  fs.writeFileSync(sourcePath, sourceContent)

  await pipeline.start({
    paths: [sourcePath],
    direction: options.direction ?? 'expense',
    duplicateAction: 'ask'
  })
  return terminal
}

describe('ImportPipeline near-duplicate detection', () => {
  // GROSS_ONLY_RECEIPT parses to invoice R-1001, 2026-03-05, EUR 11.90 gross —
  // the same invoice as makeDoc(), but the imported file has different bytes.
  it('imports with a possible_duplicate warning when a stored document matches', async () => {
    const existing = makeDoc()
    repos.documents.insert(existing)

    const result = await runImport('%PDF-1.4\nsecond scan of the same invoice')
    expect(result.status).toBe('completed_with_warnings')
    expect(result.documentId).not.toBeNull()

    const imported = repos.documents.getById(result.documentId!)!
    const dupIssue = imported.issues.find((i) => i.code === 'possible_duplicate')
    expect(dupIssue).toEqual({
      code: 'possible_duplicate',
      severity: 'warning',
      messageKey: 'issues.possible_duplicate',
      field: undefined,
      params: { filename: existing.storedFilename, id: existing.id }
    })
    expect(imported.reviewStatus).toBe('needs_review')
    expect(imported.reviewReasons).toContain('possible_duplicate')

    // never blocks, never deletes: both documents stay active
    expect(repos.documents.getById(existing.id)!.deletedAt).toBeNull()
    expect(imported.deletedAt).toBeNull()

    const events = repos.audit.listByDocument(imported.id)
    const dupEvent = events.find((e) => e.eventType === 'possible_duplicate_detected')
    expect(dupEvent).toBeDefined()
    expect(dupEvent!.source).toBe('system')
    expect(dupEvent!.nextValue).toEqual({
      documentId: imported.id,
      existingDocumentId: existing.id
    })
  })

  it('adds no possible_duplicate issue when nothing matches', async () => {
    // same counterparty and amount, but a different day and invoice number
    repos.documents.insert(
      makeDoc({ invoiceDate: '2026-03-01', invoiceNumber: 'R-0900' })
    )

    const result = await runImport('%PDF-1.4\nunrelated receipt bytes')
    expect(['completed', 'completed_with_warnings']).toContain(result.status)
    const imported = repos.documents.getById(result.documentId!)!
    expect(imported.issues.some((i) => i.code === 'possible_duplicate')).toBe(false)
    const events = repos.audit.listByDocument(imported.id)
    expect(events.some((e) => e.eventType === 'possible_duplicate_detected')).toBe(false)
  })
})

describe('ImportPipeline exchange-rate severity', () => {
  it('uses a USDT-to-EUR rate printed on the document', async () => {
    const result = await runImport('%PDF-1.4\nUSDT invoice with rate', {
      fullText: `${USDT_INVOICE_INCOME}\n1 USDT = 0.92 EUR`,
      direction: 'income'
    })
    const imported = repos.documents.getById(result.documentId!)!

    expect(imported.issues.some((issue) => issue.code === 'missing_exchange_rate')).toBe(
      false
    )
    expect(imported.issues.some((issue) => issue.code === 'non_iso_currency')).toBe(true)
    expect(imported.exchangeRateToEur).toBe(0.92)
    expect(imported.exchangeRateSource).toBe('document')
    expect(imported.grossAmountEur).toBe(6946.52)
  })

  it('marks a USDT document without a rate critical and leaves EUR totals unknown', async () => {
    const result = await runImport('%PDF-1.4\nUSDT invoice', {
      fullText: USDT_INVOICE_INCOME,
      direction: 'income'
    })
    const imported = repos.documents.getById(result.documentId!)!
    expect(imported.issues).toContainEqual({
      code: 'missing_exchange_rate',
      severity: 'critical',
      messageKey: 'issues.missing_exchange_rate',
      field: 'exchangeRateToEur',
      params: undefined
    })
    expect(imported.netAmountEur).toBeNull()
    expect(imported.vatAmountEur).toBeNull()
    expect(imported.grossAmountEur).toBeNull()
  })
})
