/**
 * Native notification round: notifier string formatting (de/en) against an
 * injected fake Notification class, pipeline batch-count bookkeeping through
 * the public import flow, and the LLM checker's queue-drained callback.
 *
 * Everything runs headless: electron is never imported and the repositories
 * are an in-memory fake (llm.test.ts pattern), so no native modules load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ImportJobRow, Repositories } from '../../src/main/db/repository'
import { ImportPipeline, type BatchSummary } from '../../src/main/import/pipeline'
import { LlmChecker } from '../../src/main/llm/checker'
import { LlmModelManager, LLM_MODEL_FILE_NAME } from '../../src/main/llm/model-manager'
import { nullLogger } from '../../src/main/log'
import { Notifier, type NotificationOptions, type NotifierDeps } from '../../src/main/notify'
import { ensureDataDirs } from '../../src/main/storage/paths'
import { GROSS_ONLY_RECEIPT } from '../../src/core/parsing/parse-invoice.fixtures'
import type { DocumentTextResult, ExtractionService } from '../../src/main/extraction/service'
import {
  DEFAULT_SETTINGS,
  type AuditEvent,
  type ImportFileProgress,
  type TaxDocument
} from '../../src/shared/domain'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-notify-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// ---------------------------------------------------------------------------
// in-memory repositories fake (subset used by pipeline + checker)
// ---------------------------------------------------------------------------

function makeFakeRepos(): Repositories {
  const docs = new Map<string, TaxDocument>()
  const jobs = new Map<string, ImportJobRow>()
  const events: AuditEvent[] = []
  const fake = {
    settings: {
      get: () => ({ ...DEFAULT_SETTINGS, moveOriginalsAfterImport: false })
    },
    documents: {
      insert: (doc: TaxDocument) => {
        docs.set(doc.id, structuredClone(doc))
      },
      update: (doc: TaxDocument) => {
        const next = structuredClone(doc)
        docs.set(doc.id, next)
        return next
      },
      getById: (id: string) => {
        const doc = docs.get(id)
        return doc ? structuredClone(doc) : null
      },
      findActiveBySha256: (sha256: string) => {
        for (const doc of docs.values()) {
          if (doc.sha256 === sha256 && doc.deletedAt === null) return structuredClone(doc)
        }
        return null
      },
      findPossibleDuplicates: () => []
    },
    importJobs: {
      create: (row: {
        id: string
        importId: string
        sourcePath: string
        direction: 'income' | 'expense'
        status: string
      }) => {
        jobs.set(row.id, {
          ...row,
          documentId: null,
          errorKey: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      },
      update: (
        id: string,
        patch: { status?: string; documentId?: string | null; errorKey?: string | null }
      ) => {
        const row = jobs.get(id)
        if (row) jobs.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() })
      },
      get: (id: string) => jobs.get(id) ?? null,
      listUnfinished: () => [],
      deleteFinishedByImportId: () => undefined
    },
    audit: {
      append: (event: {
        documentId: string | null
        eventType: string
        previousValue?: unknown
        nextValue?: unknown
        source: 'system' | 'user'
      }) => {
        const record: AuditEvent = {
          id: `evt-${events.length + 1}`,
          documentId: event.documentId,
          eventType: event.eventType,
          previousValue: event.previousValue ?? null,
          nextValue: event.nextValue ?? null,
          createdAt: new Date().toISOString(),
          source: event.source
        }
        events.push(record)
        return record
      },
      listByDocument: (documentId: string) => events.filter((e) => e.documentId === documentId)
    },
    exchangeRates: {
      find: () => null,
      save: () => undefined
    }
  }
  return fake as unknown as Repositories
}

// ---------------------------------------------------------------------------
// Notifier: string formatting + gating, with an injected fake Notification
// ---------------------------------------------------------------------------

interface FakeNotification {
  opts: NotificationOptions
  shown: boolean
  click: (() => void) | null
}

function makeNotifier(overrides: Partial<NotifierDeps> = {}): {
  notifier: Notifier
  shown: FakeNotification[]
  onClick: ReturnType<typeof vi.fn>
} {
  const shown: FakeNotification[] = []
  const onClick = vi.fn()
  const notifier = new Notifier({
    getLanguage: () => 'de',
    isWindowFocused: () => false,
    onClick,
    isSupported: () => true,
    createNotification: (opts) => {
      const fake: FakeNotification = { opts, shown: false, click: null }
      shown.push(fake)
      return {
        show: () => {
          fake.shown = true
        },
        on: (_event, listener) => {
          fake.click = listener
        }
      }
    },
    ...overrides
  })
  return { notifier, shown, onClick }
}

describe('Notifier.notifyBatchDone', () => {
  it('formats the German summary with a to-review count', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyBatchDone({ total: 3, ok: 2, review: 1, failed: 0 })
    expect(shown).toHaveLength(1)
    expect(shown[0]!.opts.title).toBe('Import abgeschlossen')
    expect(shown[0]!.opts.body).toBe('3 Belege importiert – 1 zu prüfen')
    expect(shown[0]!.opts.silent).toBe(false)
    expect(shown[0]!.shown).toBe(true)
  })

  it('appends the German failure count', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyBatchDone({ total: 3, ok: 1, review: 1, failed: 1 })
    expect(shown[0]!.opts.body).toBe('3 Belege importiert – 1 zu prüfen – 1 fehlgeschlagen')
  })

  it('uses the German singular for a one-file batch', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyBatchDone({ total: 1, ok: 1, review: 0, failed: 0 })
    expect(shown[0]!.opts.body).toBe('1 Beleg importiert')
  })

  it('formats the English equivalents', () => {
    const { notifier, shown } = makeNotifier({ getLanguage: () => 'en' })
    notifier.notifyBatchDone({ total: 3, ok: 1, review: 1, failed: 1 })
    expect(shown[0]!.opts.title).toBe('Import finished')
    expect(shown[0]!.opts.body).toBe('3 documents imported – 1 to review – 1 failed')
    notifier.notifyBatchDone({ total: 1, ok: 1, review: 0, failed: 0 })
    expect(shown[1]!.opts.body).toBe('1 document imported')
  })

  it('fires even while the window is focused', () => {
    const { notifier, shown } = makeNotifier({ isWindowFocused: () => true })
    notifier.notifyBatchDone({ total: 2, ok: 2, review: 0, failed: 0 })
    expect(shown).toHaveLength(1)
  })

  it('stays silent for an empty batch', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyBatchDone({ total: 0, ok: 0, review: 0, failed: 0 })
    expect(shown).toHaveLength(0)
  })

  it('does nothing when notifications are unsupported', () => {
    const { notifier, shown } = makeNotifier({ isSupported: () => false })
    notifier.notifyBatchDone({ total: 2, ok: 2, review: 0, failed: 0 })
    expect(shown).toHaveLength(0)
  })

  it('wires the click handler to onClick (focus/restore)', () => {
    const { notifier, shown, onClick } = makeNotifier()
    notifier.notifyBatchDone({ total: 1, ok: 1, review: 0, failed: 0 })
    expect(shown[0]!.click).not.toBeNull()
    shown[0]!.click!()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Notifier.notifyLlmDone', () => {
  it('formats German plural and singular bodies', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyLlmDone(3)
    notifier.notifyLlmDone(1)
    expect(shown[0]!.opts.title).toBe('KI-Prüfung abgeschlossen')
    expect(shown[0]!.opts.body).toBe('3 Belege geprüft')
    expect(shown[1]!.opts.body).toBe('1 Beleg geprüft')
  })

  it('formats English plural and singular bodies', () => {
    const { notifier, shown } = makeNotifier({ getLanguage: () => 'en' })
    notifier.notifyLlmDone(3)
    notifier.notifyLlmDone(1)
    expect(shown[0]!.opts.title).toBe('AI check finished')
    expect(shown[0]!.opts.body).toBe('3 documents checked')
    expect(shown[1]!.opts.body).toBe('1 document checked')
  })

  it('is suppressed while the window is focused (the UI updates live)', () => {
    const { notifier, shown } = makeNotifier({ isWindowFocused: () => true })
    notifier.notifyLlmDone(3)
    expect(shown).toHaveLength(0)
  })

  it('ignores a zero count', () => {
    const { notifier, shown } = makeNotifier()
    notifier.notifyLlmDone(0)
    expect(shown).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ImportPipeline: per-importId batch bookkeeping through the public flow
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

function makePipeline(onBatchDone: (summary: BatchSummary) => void): {
  pipeline: ImportPipeline
  terminals: ImportFileProgress[]
} {
  const dataDir = path.join(dir, 'data')
  ensureDataDirs(dataDir)
  const extraction = {
    extractDocumentText: async () => fakeTextResult(GROSS_ONLY_RECEIPT),
    thumbnail: async () => undefined
  } as unknown as ExtractionService
  const terminals: ImportFileProgress[] = []
  const pipeline = new ImportPipeline({
    dataDir,
    repos: makeFakeRepos(),
    extraction,
    ratesProviders: {
      bmf: { name: 'test-bmf', getRate: async () => null },
      ecb: { name: 'test-ecb', getRate: async () => null }
    },
    emit: (progress) => {
      if (TERMINAL.has(progress.status)) terminals.push(progress)
    },
    log: nullLogger,
    onBatchDone
  })
  return { pipeline, terminals }
}

function writeSource(name: string, content: string): string {
  const sourcePath = path.join(dir, 'incoming', name)
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
  fs.writeFileSync(sourcePath, content)
  return sourcePath
}

describe('ImportPipeline batch bookkeeping (onBatchDone)', () => {
  it('fires once per batch with counts matching the emitted terminal statuses', async () => {
    const summaries: BatchSummary[] = []
    const { pipeline, terminals } = makePipeline((s) => summaries.push(s))

    await pipeline.start({
      paths: [
        writeSource('a.pdf', '%PDF-1.4 first receipt bytes'),
        writeSource('b.pdf', '%PDF-1.4 second receipt bytes')
      ],
      direction: 'expense',
      duplicateAction: 'ask'
    })
    await waitFor(() => summaries.length > 0)

    expect(summaries).toHaveLength(1)
    const summary = summaries[0]!
    expect(summary.total).toBe(2)
    expect(summary.failed).toBe(0)
    expect(summary.ok + summary.review).toBe(2)
    // 'ok' counts plain completed, 'review' completed_with_warnings
    expect(terminals).toHaveLength(2)
    expect(summary.ok).toBe(terminals.filter((t) => t.status === 'completed').length)
    expect(summary.review).toBe(
      terminals.filter((t) => t.status === 'completed_with_warnings').length
    )
  })

  it('counts failed files into failed and total only', async () => {
    const summaries: BatchSummary[] = []
    const { pipeline, terminals } = makePipeline((s) => summaries.push(s))

    await pipeline.start({
      paths: [
        writeSource('good.pdf', '%PDF-1.4 valid magic'),
        writeSource('bad.pdf', 'no pdf magic at all') // fails at hasPdfMagic
      ],
      direction: 'expense',
      duplicateAction: 'ask'
    })
    await waitFor(() => summaries.length > 0)

    expect(summaries).toEqual([expect.objectContaining({ total: 2, failed: 1 })])
    expect(summaries[0]!.ok + summaries[0]!.review).toBe(1)
    expect(terminals.filter((t) => t.status === 'failed')).toHaveLength(1)
  })

  it('excludes files rejected at start() from the batch entirely', async () => {
    const summaries: BatchSummary[] = []
    const { pipeline } = makePipeline((s) => summaries.push(s))

    const result = await pipeline.start({
      paths: [
        writeSource('good.pdf', '%PDF-1.4 valid magic'),
        writeSource('not-a-pdf.txt', 'plain text') // rejected before queuing
      ],
      direction: 'expense',
      duplicateAction: 'ask'
    })
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    await waitFor(() => summaries.length > 0)

    expect(summaries).toEqual([expect.objectContaining({ total: 1, failed: 0 })])
    expect(summaries[0]!.ok + summaries[0]!.review).toBe(1)
  })

  it('counts duplicates into total only and retry() re-arms the importId', async () => {
    const summaries: BatchSummary[] = []
    const { pipeline, terminals } = makePipeline((s) => summaries.push(s))

    // first import stores the document
    await pipeline.start({
      paths: [writeSource('orig.pdf', '%PDF-1.4 identical bytes')],
      direction: 'expense',
      duplicateAction: 'ask'
    })
    await waitFor(() => summaries.length === 1)

    // byte-identical re-import settles as duplicate: total only
    const second = await pipeline.start({
      paths: [writeSource('again.pdf', '%PDF-1.4 identical bytes')],
      direction: 'expense',
      duplicateAction: 'ask'
    })
    await waitFor(() => summaries.length === 2)
    expect(summaries[1]).toEqual({ total: 1, ok: 0, review: 0, failed: 0 })
    expect(terminals.filter((t) => t.status === 'duplicate')).toHaveLength(1)

    // an explicit retry re-arms the same importId and settles it again
    await pipeline.retry(second.accepted[0]!.fileId)
    await waitFor(() => summaries.length === 3)
    expect(summaries[2]!.total).toBe(1)
    expect(summaries[2]!.failed).toBe(0)
    expect(summaries[2]!.ok + summaries[2]!.review).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// LlmChecker: onQueueDrained fires once per run with the processed count
// ---------------------------------------------------------------------------

const GIB = 1024 * 1024 * 1024
const EXPECTED_MODEL_BYTES = 100

function readyManager(): LlmModelManager {
  const modelFile = path.join(dir, 'models', LLM_MODEL_FILE_NAME)
  fs.mkdirSync(path.dirname(modelFile), { recursive: true })
  fs.writeFileSync(
    modelFile,
    Buffer.concat([Buffer.from('GGUF', 'latin1'), Buffer.alloc(EXPECTED_MODEL_BYTES - 4, 7)])
  )
  return new LlmModelManager({
    dataDir: dir,
    log: nullLogger,
    notify: () => undefined,
    totalMemBytes: () => 16 * GIB,
    expectedModelBytes: EXPECTED_MODEL_BYTES
  })
}

let docCounter = 0

/** Synthetic checkable document inserted into the fake repositories. */
function insertCheckableDoc(repos: Repositories): string {
  docCounter += 1
  const suffix = String(docCounter).padStart(12, '0')
  const doc: TaxDocument = {
    id: `00000000-0000-4000-9000-${suffix}`,
    direction: 'expense',
    originalFilename: 'Rechnung.pdf',
    storedFilename: `2026_02_10-Musterladen-RE-${suffix}.pdf`,
    storedRelativePath: `documents/2026/Q1/expense/2026_02_10-RE-${suffix}.pdf`,
    sha256: suffix.slice(-2).repeat(32),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: `RE-${suffix}`,
    invoiceDate: '2026-02-10',
    serviceDateFrom: null,
    serviceDateTo: null,
    receiptDate: null,
    paymentDate: null,
    dueDate: null,
    paymentStatus: 'unknown',
    issuerName: 'Musterladen GmbH',
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
    description: 'Bürobedarf',
    expenseCategory: null,
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
    vatRates: [],
    vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
    vatTreatmentLabel: null,
    vatLegalBasis: null,
    taxPeriodYear: 2026,
    taxPeriodQuarter: 1,
    taxPeriodMonth: 2,
    extractedText: `Rechnung RE-${suffix} über 100,00 EUR`,
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
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z'
  }
  repos.documents.insert(doc)
  return doc.id
}

/** Real verdict-module output: the model agrees with the invoice number. */
const AGREEING_OUTPUT = JSON.stringify({
  fields: { invoiceNumber: { agrees: true, suggested: null } }
})

describe('LlmChecker.onQueueDrained', () => {
  it('fires once per run with the processed count and resets between runs', async () => {
    const repos = makeFakeRepos()
    const onQueueDrained = vi.fn()
    const checker = new LlmChecker({
      repos,
      manager: readyManager(),
      log: nullLogger,
      notify: () => undefined,
      onQueueDrained,
      infer: async () => AGREEING_OUTPUT
    })

    checker.enqueueMany([insertCheckableDoc(repos), insertCheckableDoc(repos)])
    await waitFor(() => checker.getStatus().queueLength === 0)
    expect(onQueueDrained.mock.calls).toEqual([[2]])

    // the counter starts fresh after the queue went idle
    checker.enqueue(insertCheckableDoc(repos))
    await waitFor(() => checker.getStatus().queueLength === 0)
    expect(onQueueDrained.mock.calls).toEqual([[2], [1]])
    await checker.dispose()
  })

  it('stays quiet when no document was successfully processed', async () => {
    const repos = makeFakeRepos()
    const onQueueDrained = vi.fn()
    const checker = new LlmChecker({
      repos,
      manager: readyManager(),
      log: nullLogger,
      notify: () => undefined,
      onQueueDrained,
      infer: async () => 'not json at all' // unparseable output = not processed
    })

    checker.enqueue(insertCheckableDoc(repos))
    await waitFor(() => checker.getStatus().queueLength === 0)
    expect(onQueueDrained).not.toHaveBeenCalled()
    await checker.dispose()
  })
})
