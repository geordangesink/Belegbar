/**
 * Local LLM checker: model-manager state machine (no network — injected
 * fetch), GGUF validation, resume/cancel, capability probe, and the checker
 * queue skip rules + merge/update flow (injected infer — the real model is
 * never loaded here; real-model behavior is verified by the maintainer).
 *
 * The checker is exercised against an in-memory repository fake that mirrors
 * the domain-level read/write semantics of DocumentRepository (classification
 * merged into extractionRawJson on read, updatedAt bumped on update), keeping
 * this file free of native modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Repositories } from '../../src/main/db/repository'
import { nullLogger } from '../../src/main/log'
import {
  LlmModelManager,
  LLM_MODEL_FILE_NAME,
  type FetchLike,
  type LlmModelManagerDeps
} from '../../src/main/llm/model-manager'
import { LlmChecker, type LlmCheckerDeps } from '../../src/main/llm/checker'
import {
  buildCheckPrompt,
  mergeVerdict,
  parseModelOutput,
  LLM_MODEL_NAME
} from '../../src/core/llm/verdict'
import type { AuditEvent, LlmCheckResult, TaxDocument } from '../../src/shared/domain'

// The verdict module is implemented in parallel (src/core/llm/verdict.ts is a
// frozen contract); the checker is tested against mocked verdict semantics so
// these tests exercise exactly the checker's own responsibilities.
vi.mock('../../src/core/llm/verdict', () => ({
  LLM_CHECKER_VERSION: '1.0.0',
  LLM_MODEL_NAME: 'qwen2.5-1.5b-instruct-q4_k_m',
  CHECKED_FIELDS: ['invoiceNumber', 'invoiceDate'],
  buildOutputSchema: vi.fn(() => ({ type: 'object' })),
  buildCheckPrompt: vi.fn(() => 'PROMPT'),
  parseModelOutput: vi.fn(() => null),
  mergeVerdict: vi.fn(() => ({ fieldConfidence: {}, newIssues: [], changed: false }))
}))

const GIB = 1024 * 1024 * 1024
const EXPECTED = 100 // tiny injected expected model size for tests

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-llm-'))
  vi.mocked(buildCheckPrompt).mockReturnValue('PROMPT')
  vi.mocked(parseModelOutput).mockReturnValue(null)
  vi.mocked(mergeVerdict).mockReturnValue({
    fieldConfidence: {},
    newIssues: [],
    changed: false
  })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function goodPayload(): Buffer {
  return Buffer.concat([Buffer.from('GGUF', 'latin1'), Buffer.alloc(EXPECTED - 4, 7)])
}

function modelFile(): string {
  return path.join(dir, 'models', LLM_MODEL_FILE_NAME)
}

function partFile(): string {
  return `${modelFile()}.part`
}

function writeModelOnDisk(content: Buffer): void {
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
  fs.writeFileSync(modelFile(), content)
}

function makeManager(overrides: Partial<LlmModelManagerDeps> = {}): LlmModelManager {
  return new LlmModelManager({
    dataDir: dir,
    log: nullLogger,
    notify: () => undefined,
    totalMemBytes: () => 16 * GIB,
    expectedModelBytes: EXPECTED,
    progressIntervalMs: 0,
    ...overrides
  })
}

function streamingFetch(options: {
  status?: number
  chunks: Uint8Array[]
  contentLength?: number
  onCall?: (init: { headers?: Record<string, string>; signal?: AbortSignal }) => void
}): FetchLike {
  return async (_url, init) => {
    options.onCall?.(init)
    const status = options.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-length' && options.contentLength !== undefined
            ? String(options.contentLength)
            : null
      },
      body: (async function* () {
        for (const chunk of options.chunks) yield chunk
      })()
    }
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// ---------------------------------------------------------------------------
// model manager
// ---------------------------------------------------------------------------

describe('LlmModelManager', () => {
  it('reports unsupported on machines with less than 6 GiB RAM and never downloads', async () => {
    const fetchImpl = vi.fn()
    const manager = makeManager({
      totalMemBytes: () => 4 * GIB,
      fetchImpl: fetchImpl as unknown as FetchLike
    })
    expect(manager.statusSnapshot().state).toBe('unsupported')
    expect(manager.statusSnapshot().reasonKey).toBe('llm_unsupported_ram')
    await manager.startDownload()
    expect(manager.statusSnapshot().state).toBe('unsupported')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(fs.existsSync(modelFile())).toBe(false)
  })

  it('starts as not_downloaded without a model on disk', () => {
    const manager = makeManager()
    const status = manager.statusSnapshot()
    expect(status.state).toBe('not_downloaded')
    expect(status.modelFileName).toBe(LLM_MODEL_FILE_NAME)
    expect(status.totalBytes).toBe(EXPECTED)
    expect(manager.isReady()).toBe(false)
  })

  it('downloads, validates and becomes ready (with progress notifications)', async () => {
    const payload = goodPayload()
    const notify = vi.fn()
    const manager = makeManager({
      notify,
      fetchImpl: streamingFetch({
        chunks: [payload.subarray(0, 40), payload.subarray(40)],
        contentLength: EXPECTED
      })
    })
    await manager.startDownload()
    const status = manager.statusSnapshot()
    expect(status.state).toBe('ready')
    expect(status.modelSizeBytes).toBe(EXPECTED)
    expect(status.downloadedBytes).toBe(EXPECTED)
    expect(status.reasonKey).toBeNull()
    expect(manager.isReady()).toBe(true)
    expect(fs.readFileSync(modelFile())).toEqual(payload)
    expect(fs.existsSync(partFile())).toBe(false)
    expect(notify.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a completed download without the GGUF magic and deletes the file', async () => {
    const corrupt = Buffer.concat([Buffer.from('XXXX'), Buffer.alloc(EXPECTED - 4, 7)])
    const manager = makeManager({
      fetchImpl: streamingFetch({ chunks: [corrupt], contentLength: EXPECTED })
    })
    await manager.startDownload()
    const status = manager.statusSnapshot()
    expect(status.state).toBe('error')
    expect(status.reasonKey).toBe('llm_download_failed')
    expect(fs.existsSync(modelFile())).toBe(false)
    expect(fs.existsSync(partFile())).toBe(false)
  })

  it('rejects a download whose size is outside the 2% tolerance', async () => {
    const short = goodPayload().subarray(0, 10)
    const manager = makeManager({
      fetchImpl: streamingFetch({ chunks: [short], contentLength: EXPECTED })
    })
    await manager.startDownload()
    expect(manager.statusSnapshot().state).toBe('error')
    expect(manager.statusSnapshot().reasonKey).toBe('llm_download_failed')
    expect(fs.existsSync(modelFile())).toBe(false)
  })

  it('resumes from an existing .part file via a Range request', async () => {
    const payload = goodPayload()
    fs.mkdirSync(path.dirname(partFile()), { recursive: true })
    fs.writeFileSync(partFile(), payload.subarray(0, 40))

    let seenRange: string | undefined
    const manager = makeManager({
      fetchImpl: streamingFetch({
        status: 206,
        chunks: [payload.subarray(40)],
        contentLength: EXPECTED - 40,
        onCall: (init) => {
          seenRange = init.headers?.['Range']
        }
      })
    })
    expect(manager.statusSnapshot().downloadedBytes).toBe(40)
    await manager.startDownload()
    expect(seenRange).toBe('bytes=40-')
    expect(manager.statusSnapshot().state).toBe('ready')
    expect(fs.readFileSync(modelFile())).toEqual(payload)
  })

  it('restarts from zero when the server ignores the Range header', async () => {
    const payload = goodPayload()
    fs.mkdirSync(path.dirname(partFile()), { recursive: true })
    fs.writeFileSync(partFile(), Buffer.alloc(40, 9)) // stale bytes that must be discarded

    const manager = makeManager({
      fetchImpl: streamingFetch({ status: 200, chunks: [payload], contentLength: EXPECTED })
    })
    await manager.startDownload()
    expect(manager.statusSnapshot().state).toBe('ready')
    expect(fs.readFileSync(modelFile())).toEqual(payload)
  })

  it('cancels a running download and keeps the .part file for a later resume', async () => {
    const payload = goodPayload()
    const fetchImpl: FetchLike = async (_url, init) => {
      const signal = init.signal
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          yield payload.subarray(0, 20)
          await new Promise<void>((resolve) => {
            if (!signal || signal.aborted) return resolve()
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        })()
      }
    }
    const manager = makeManager({ fetchImpl })
    const download = manager.startDownload()
    await waitFor(() => manager.statusSnapshot().downloadedBytes >= 20)
    expect(manager.statusSnapshot().state).toBe('downloading')
    manager.cancelDownload()
    await download
    expect(manager.statusSnapshot().state).toBe('not_downloaded')
    expect(fs.existsSync(partFile())).toBe(true)
    expect(fs.statSync(partFile()).size).toBe(20)
    expect(fs.existsSync(modelFile())).toBe(false)
  })

  it('keeps the .part file on a network failure and reports error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down')
    }
    fs.mkdirSync(path.dirname(partFile()), { recursive: true })
    fs.writeFileSync(partFile(), goodPayload().subarray(0, 30))
    const manager = makeManager({ fetchImpl })
    await manager.startDownload()
    expect(manager.statusSnapshot().state).toBe('error')
    expect(manager.statusSnapshot().reasonKey).toBe('llm_download_failed')
    expect(fs.existsSync(partFile())).toBe(true)
  })

  it('recognizes a valid model on disk at construction', () => {
    writeModelOnDisk(goodPayload())
    const manager = makeManager()
    expect(manager.statusSnapshot().state).toBe('ready')
    expect(manager.statusSnapshot().modelSizeBytes).toBe(EXPECTED)
  })

  it('discards an invalid model found on disk at construction', () => {
    writeModelOnDisk(Buffer.from('not a gguf'))
    const manager = makeManager()
    expect(manager.statusSnapshot().state).toBe('not_downloaded')
    expect(fs.existsSync(modelFile())).toBe(false)
  })

  it('removeModel deletes model and .part and returns to not_downloaded', async () => {
    writeModelOnDisk(goodPayload())
    fs.writeFileSync(partFile(), Buffer.alloc(10))
    const manager = makeManager()
    expect(manager.statusSnapshot().state).toBe('ready')
    await manager.removeModel()
    expect(manager.statusSnapshot().state).toBe('not_downloaded')
    expect(manager.statusSnapshot().modelSizeBytes).toBe(0)
    expect(fs.existsSync(modelFile())).toBe(false)
    expect(fs.existsSync(partFile())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// in-memory repository fake (mirrors DocumentRepository domain semantics)
// ---------------------------------------------------------------------------

interface FakeRepos {
  documents: {
    insert(doc: TaxDocument, vatClassification?: unknown): void
    getById(id: string): TaxDocument | null
    update(doc: TaxDocument, vatClassification?: unknown): TaxDocument
  }
  audit: {
    append(event: {
      documentId: string | null
      eventType: string
      previousValue?: unknown
      nextValue?: unknown
      source: 'system' | 'user'
    }): AuditEvent
    listByDocument(documentId: string): AuditEvent[]
  }
}

function makeFakeRepos(): { fake: FakeRepos; repos: Repositories } {
  const docs = new Map<string, TaxDocument>()
  const events: AuditEvent[] = []
  const fake: FakeRepos = {
    documents: {
      insert: (doc, vatClassification) => {
        const stored = structuredClone(doc)
        if (vatClassification !== undefined) {
          // like rowToDocument: classification is merged into the raw JSON on read
          const base =
            typeof stored.extractionRawJson === 'object' && stored.extractionRawJson !== null
              ? (stored.extractionRawJson as Record<string, unknown>)
              : {}
          stored.extractionRawJson = { ...base, vatClassification }
        }
        docs.set(doc.id, stored)
      },
      getById: (id) => {
        const doc = docs.get(id)
        return doc ? structuredClone(doc) : null
      },
      update: (doc) => {
        const next = structuredClone({ ...doc, updatedAt: new Date().toISOString() })
        docs.set(doc.id, next)
        return next
      }
    },
    audit: {
      append: (event) => {
        const record: AuditEvent = {
          id: `evt-${events.length + 1}`,
          documentId: event.documentId,
          eventType: event.eventType,
          previousValue: event.previousValue ?? null,
          nextValue: event.nextValue ?? null,
          createdAt: new Date().toISOString(),
          source: event.source
        }
        events.push(structuredClone(record))
        return record
      },
      listByDocument: (documentId) =>
        events.filter((e) => e.documentId === documentId).map((e) => structuredClone(e))
    }
  }
  return { fake, repos: fake as unknown as Repositories }
}

function fullDocument(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return {
    id: 'doc-1',
    direction: 'expense',
    originalFilename: 'Rechnung.pdf',
    storedFilename: '2026_02_10-Musterladen-RE-42.pdf',
    storedRelativePath: 'documents/2026/Q1/expense/2026_02_10-Musterladen-RE-42.pdf',
    sha256: 'a'.repeat(64),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: 'RE-42',
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
    issuerVatId: 'DE123456789',
    recipientName: 'Max Beispiel',
    recipientAddress: null,
    recipientCountryCode: 'DE',
    recipientTaxNumber: null,
    recipientVatId: null,
    recipientIsBusiness: true,
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
    vatTreatmentLabel: 'Vorsteuerabzugsfähige Ausgabe',
    vatLegalBasis: '§ 15 UStG',
    taxPeriodYear: 2026,
    taxPeriodQuarter: 1,
    taxPeriodMonth: 2,
    extractedText: 'Rechnung RE-42 über 100,00 EUR',
    extractionProvider: 'local-parser',
    extractionVersion: '1.0.0',
    extractionConfidence: 0.8,
    fieldConfidence: { invoiceNumber: 0.6, invoiceDate: 0.7 },
    extractionRawJson: { signals: { reverseChargeWording: false }, note: 'raw blob' },
    reviewStatus: 'needs_review',
    reviewReasons: ['missing_payment_date'],
    issues: [
      {
        code: 'missing_payment_date',
        severity: 'warning',
        messageKey: 'issues.missing_payment_date',
        field: 'paymentDate'
      }
    ],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2026-02-10T10:00:00.000Z',
    updatedAt: '2026-02-10T10:00:00.000Z',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// checker
// ---------------------------------------------------------------------------

describe('LlmChecker', () => {
  let repos: Repositories
  let fake: FakeRepos

  beforeEach(() => {
    const made = makeFakeRepos()
    repos = made.repos
    fake = made.fake
  })

  function makeChecker(overrides: Partial<LlmCheckerDeps> = {}): LlmChecker {
    writeModelOnDisk(goodPayload()) // manager boots straight into 'ready'
    const manager = makeManager()
    return new LlmChecker({
      repos,
      manager,
      log: nullLogger,
      notify: () => undefined,
      infer: async () => 'RAW',
      ...overrides
    })
  }

  it('skips deleted, confirmed, empty-text, unknown and duplicate ids at enqueue', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-ok' }))
    fake.documents.insert(
      fullDocument({ id: 'doc-deleted', deletedAt: '2026-03-01T00:00:00.000Z' })
    )
    fake.documents.insert(fullDocument({ id: 'doc-confirmed', reviewStatus: 'confirmed' }))
    fake.documents.insert(fullDocument({ id: 'doc-empty', extractedText: '' }))

    const checker = makeChecker()
    const result = checker.enqueueMany([
      'doc-ok',
      'doc-deleted',
      'doc-confirmed',
      'doc-empty',
      'doc-missing',
      'doc-ok' // duplicate of an already queued/processing id
    ])
    expect(result).toEqual({ queued: 1, skipped: 5 })
    await waitFor(() => checker.getStatus().queueLength === 0)
  })

  it('exposes the composed LlmStatus (manager snapshot + queueLength)', () => {
    const checker = makeChecker()
    const status = checker.getStatus()
    expect(status.state).toBe('ready')
    expect(status.queueLength).toBe(0)
    expect(status.modelFileName).toBe(LLM_MODEL_FILE_NAME)
    expect(checker.isReady()).toBe(true)
  })

  it('merges a verdict: confidence + issues + reviewReasons + raw llmCheck + audit', async () => {
    const doc = fullDocument({ id: 'doc-merge' })
    fake.documents.insert(doc, { code: 'DE_EXPENSE_INPUT_VAT', manualOverride: false })

    vi.mocked(parseModelOutput).mockReturnValue({
      invoiceNumber: { agrees: true, suggested: null },
      invoiceDate: { agrees: false, suggested: '2026-02-11' }
    })
    // mirrors real mergeVerdict semantics: newIssues is the COMPLETE updated
    // issue list (pre-existing issues included), assigned to doc.issues as-is
    vi.mocked(mergeVerdict).mockReturnValue({
      fieldConfidence: { invoiceNumber: 0.92, invoiceDate: 0.55 },
      newIssues: [
        ...doc.issues,
        {
          code: 'llm_disagreement',
          severity: 'warning',
          messageKey: 'issues.llm_disagreement',
          field: 'invoiceDate',
          params: { field: 'invoiceDate', suggested: '2026-02-11' }
        }
      ],
      changed: true
    })

    const notify = vi.fn()
    const infer = vi.fn(async () => 'RAW-JSON')
    const checker = makeChecker({ notify, infer })
    expect(checker.enqueue('doc-merge')).toBe(true)
    await waitFor(() => checker.getStatus().queueLength === 0)

    // the model NEVER overwrites values — only confidence/issues move
    const updated = fake.documents.getById('doc-merge')!
    expect(updated.invoiceDate).toBe('2026-02-10')
    expect(updated.fieldConfidence).toEqual({ invoiceNumber: 0.92, invoiceDate: 0.55 })
    expect(updated.issues.map((i) => i.code)).toEqual([
      'missing_payment_date',
      'llm_disagreement'
    ])
    expect(updated.reviewReasons).toContain('llm_disagreement')
    expect(updated.reviewReasons).toContain('missing_payment_date')
    expect(updated.updatedAt).not.toBe(doc.updatedAt)

    // LlmCheckResult stored under extractionRawJson.llmCheck, other keys kept
    const raw = updated.extractionRawJson as Record<string, unknown>
    expect(raw['note']).toBe('raw blob')
    expect(raw['vatClassification']).toEqual({
      code: 'DE_EXPENSE_INPUT_VAT',
      manualOverride: false
    })
    const llmCheck = raw['llmCheck'] as LlmCheckResult
    expect(llmCheck.documentId).toBe('doc-merge')
    expect(llmCheck.model).toBe(LLM_MODEL_NAME)
    expect(llmCheck.fields['invoiceDate']).toEqual({
      agrees: false,
      suggested: '2026-02-11'
    })
    expect(typeof llmCheck.durationMs).toBe('number')

    // audit trail records the check with a per-field agrees summary
    const events = fake.audit.listByDocument('doc-merge')
    const check = events.find((e) => e.eventType === 'llm_check')!
    expect(check.source).toBe('system')
    expect(check.nextValue).toEqual({
      model: LLM_MODEL_NAME,
      agrees: { invoiceNumber: true, invoiceDate: false },
      durationMs: llmCheck.durationMs
    })

    expect(infer).toHaveBeenCalledWith('PROMPT', expect.any(AbortSignal))
    expect(vi.mocked(buildCheckPrompt)).toHaveBeenCalled()
    expect(notify.mock.calls.length).toBeGreaterThanOrEqual(2) // enqueue + finish
  })

  it('does not write the document when the verdict changes nothing (audit only)', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-same' }))
    vi.mocked(parseModelOutput).mockReturnValue({
      invoiceNumber: { agrees: true, suggested: null }
    })
    vi.mocked(mergeVerdict).mockReturnValue({
      fieldConfidence: { invoiceNumber: 0.6, invoiceDate: 0.7 },
      newIssues: [],
      changed: false
    })
    const checker = makeChecker()
    checker.enqueue('doc-same')
    await waitFor(() => checker.getStatus().queueLength === 0)

    const after = fake.documents.getById('doc-same')!
    expect(after.updatedAt).toBe('2026-02-10T10:00:00.000Z') // untouched
    expect((after.extractionRawJson as Record<string, unknown>)['llmCheck']).toBeUndefined()
    const events = fake.audit.listByDocument('doc-same')
    expect(events.some((e) => e.eventType === 'llm_check')).toBe(true)
  })

  it('skips a document that was confirmed while inference was running', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-race' }))
    vi.mocked(parseModelOutput).mockReturnValue({
      invoiceNumber: { agrees: false, suggested: 'OTHER' }
    })
    vi.mocked(mergeVerdict).mockReturnValue({
      fieldConfidence: { invoiceNumber: 0.55 },
      newIssues: [],
      changed: true
    })

    let release!: (raw: string) => void
    const checker = makeChecker({
      infer: () => new Promise<string>((resolve) => (release = resolve))
    })
    checker.enqueue('doc-race')
    await waitFor(() => checker.getStatus().queueLength === 1)
    // user confirms during inference — the verdict must be discarded
    fake.documents.update({
      ...fake.documents.getById('doc-race')!,
      reviewStatus: 'confirmed'
    })
    release('RAW')
    await waitFor(() => checker.getStatus().queueLength === 0)

    const after = fake.documents.getById('doc-race')!
    expect(after.fieldConfidence).toEqual({ invoiceNumber: 0.6, invoiceDate: 0.7 })
    expect(
      fake.audit.listByDocument('doc-race').some((e) => e.eventType === 'llm_check')
    ).toBe(false)
  })

  it('times out a hanging inference, skips the document and keeps going', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-hang' }))
    fake.documents.insert(fullDocument({ id: 'doc-after' }))
    vi.mocked(parseModelOutput).mockReturnValue({
      invoiceNumber: { agrees: true, suggested: null }
    })

    let calls = 0
    const checker = makeChecker({
      timeoutMs: 30,
      infer: (_prompt, signal) => {
        calls++
        if (calls === 1) {
          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true
            })
          })
        }
        return Promise.resolve('RAW')
      }
    })
    checker.enqueueMany(['doc-hang', 'doc-after'])
    await waitFor(() => checker.getStatus().queueLength === 0)

    expect(calls).toBe(2) // the queue survived the timeout
    expect(
      fake.audit.listByDocument('doc-hang').some((e) => e.eventType === 'llm_check')
    ).toBe(false)
    expect(
      fake.audit.listByDocument('doc-after').some((e) => e.eventType === 'llm_check')
    ).toBe(true)
  })

  it('skips unparseable model output without touching the document', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-garbage' }))
    vi.mocked(parseModelOutput).mockReturnValue(null)
    const checker = makeChecker()
    checker.enqueue('doc-garbage')
    await waitFor(() => checker.getStatus().queueLength === 0)
    const after = fake.documents.getById('doc-garbage')!
    expect(after.updatedAt).toBe('2026-02-10T10:00:00.000Z')
    expect(fake.audit.listByDocument('doc-garbage')).toEqual([])
  })

  it('refuses new work after dispose', async () => {
    fake.documents.insert(fullDocument({ id: 'doc-late' }))
    const checker = makeChecker()
    await checker.dispose()
    expect(checker.isReady()).toBe(false)
    expect(checker.enqueue('doc-late')).toBe(false)
    expect(checker.getStatus().queueLength).toBe(0)
  })
})
