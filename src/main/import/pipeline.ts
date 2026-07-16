/**
 * Batch import orchestrator.
 *
 * Safety invariants:
 *  - the user's source file is NEVER deleted unless the imported copy has
 *    been hash-verified, moved into place and recorded in the database
 *  - a failure at any stage leaves the source untouched and cleans up .tmp
 *  - duplicates are detected by content hash before any copy is made
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { parseInvoiceText, PARSER_VERSION } from '@core/parsing/parse-invoice'
import { classifyVat, VAT_ENGINE_VERSION } from '@core/vat/classify'
import { generateStoredFilename, withCollisionSuffix } from '@core/files/filename'
import { periodOfIsoDate } from '@core/period/period'
import { confidenceKeysForField } from '@core/review/fields'
import {
  convertToEur,
  extractInlineRate,
  isIsoCurrency,
  type ExchangeRateResult
} from '@core/currency/convert'
import type {
  AppSettings,
  DocumentDirection,
  DocumentIssue,
  ExtractedInvoiceData,
  ImportFileProgress,
  ProcessingStatus,
  TaxDocument,
  VatClassificationResult
} from '@shared/domain'
import type { ImportFilesPayload } from '@shared/ipc'
import type { ImportStartResult } from '@shared/api'
import type { Repositories } from '../db/repository'
import type { ExtractionService, DocumentTextResult } from '../extraction/service'
import type { Logger } from '../log'
import {
  resolveOfficialExchangeRate,
  type OfficialExchangeRateProviders
} from '../rates/resolve'
import { dataPaths, documentRelativeDir, isInside, resolveInside } from '../storage/paths'
import {
  atomicMove,
  copyAndVerify,
  fileSize,
  hasDiskSpaceFor,
  hasPdfMagic,
  sha256File
} from '../storage/files'

const CONCURRENCY = 2
const MAX_COLLISION_ATTEMPTS = 50

type DuplicateAction = 'ask' | 'import_anyway' | 'skip'

interface QueuedFile {
  fileId: string
  importId: string
  sourcePath: string
  direction: DocumentDirection
  duplicateAction: DuplicateAction
  /** guards the batch bookkeeping against double settlement */
  settled?: boolean
}

/** Outcome counts of one finished import batch (duplicates only in total). */
export interface BatchSummary {
  total: number
  ok: number
  review: number
  failed: number
}

interface BatchTracker extends BatchSummary {
  outstanding: number
}

export interface PipelineDeps {
  dataDir: string
  repos: Repositories
  extraction: ExtractionService
  ratesProviders: OfficialExchangeRateProviders
  emit: (progress: ImportFileProgress) => void
  log: Logger
  /** opt-in local LLM double-check; absent or not ready = zero behavior change */
  llm?: { isReady(): boolean; enqueue(documentId: string): boolean }
  /**
   * Optional hook fired once per import batch when every queued file has
   * settled (completed / completed_with_warnings / failed / duplicate).
   * 'ok' counts plain completions, 'review' completions with warnings;
   * duplicates count into total only. Absent = zero behavior change.
   */
  onBatchDone?: (summary: BatchSummary) => void
}

function issue(
  code: string,
  severity: DocumentIssue['severity'],
  field?: string,
  params?: Record<string, string | number>
): DocumentIssue {
  return { code, severity, messageKey: `issues.${code}`, field, params }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function toPosixRelative(...segments: string[]): string {
  return path.join(...segments).split(path.sep).join('/')
}

export class ImportPipeline {
  private readonly queue: QueuedFile[] = []
  private running = 0
  /** per-importId outstanding/outcome counts for the onBatchDone hook */
  private readonly batches = new Map<string, BatchTracker>()

  constructor(private readonly deps: PipelineDeps) {}

  // -------------------------------------------------------------------------
  // public API
  // -------------------------------------------------------------------------

  async start(payload: ImportFilesPayload): Promise<ImportStartResult> {
    const importId = uuidv4()
    const accepted: { path: string; fileId: string }[] = []
    const rejected: { path: string; reasonKey: string }[] = []
    const batch: QueuedFile[] = []

    for (const sourcePath of payload.paths) {
      const reasonKey = await this.validateSourcePath(sourcePath)
      if (reasonKey) {
        rejected.push({ path: sourcePath, reasonKey })
        continue
      }
      const fileId = uuidv4()
      accepted.push({ path: sourcePath, fileId })
      this.deps.repos.importJobs.create({
        id: fileId,
        importId,
        sourcePath,
        direction: payload.direction,
        status: 'queued'
      })
      const queued: QueuedFile = {
        fileId,
        importId,
        sourcePath,
        direction: payload.direction,
        duplicateAction: payload.duplicateAction ?? 'ask'
      }
      batch.push(queued)
      this.emitProgress(queued, 'queued', { issues: [] })
    }

    // arm and enqueue the whole batch at once: a concurrently running pump
    // (previous batch) must never settle file 1 before file 2 is armed
    for (const queued of batch) this.armBatch(queued.importId)
    this.queue.push(...batch)

    this.pump()
    return { importId, accepted, rejected }
  }

  /**
   * Re-run extraction, parsing and classification on already-stored
   * documents (e.g. after a parser upgrade). Rules:
   *  - confirmed and deleted documents are skipped entirely
   *  - fields the user corrected manually are never overwritten
   *  - a manual VAT treatment override stays in place
   *  - a manually entered exchange rate stays in place
   *  - payment state is always preserved (it never comes from the PDF)
   *  - stored files are not renamed or moved
   */
  async reExtract(ids: string[]): Promise<{ updated: number; skipped: number }> {
    let updated = 0
    let skipped = 0
    for (const id of ids) {
      try {
        const changed = await this.reExtractOne(id)
        if (changed) updated++
        else skipped++
      } catch (err) {
        skipped++
        this.deps.log.warn('re_extraction_failed', {
          documentId: id,
          name: err instanceof Error ? err.message : typeof err
        })
      }
    }
    return { updated, skipped }
  }

  private async reExtractOne(id: string): Promise<boolean> {
    const doc = this.deps.repos.documents.getById(id)
    if (!doc || doc.deletedAt !== null || doc.reviewStatus === 'confirmed') return false

    const absPath = resolveInside(this.deps.dataDir, ...doc.storedRelativePath.split('/'))
    const text = await this.deps.extraction.extractDocumentText(absPath, doc.sha256, () => {})

    const settings = this.deps.repos.settings.get()
    const parsed = parseInvoiceText(text.fullText, {
      direction: doc.direction,
      ownName: settings.businessName || undefined,
      ownVatId: settings.businessVatId || undefined,
      ocrUsed: text.ocrUsed,
      ocrPages: text.ocrPages
    })

    const issues: DocumentIssue[] = []
    const pagesNeedingOcr = text.ocrPages.length + text.ocrFailedPages.length
    if (pagesNeedingOcr > 0 && text.ocrPages.length === 0) {
      issues.push(issue('ocr_failed', 'critical'))
    } else if (text.ocrFailedPages.length > 0) {
      issues.push(issue('ocr_partial', 'warning'))
    }
    issues.push(...parsed.issues)

    const possibleDuplicate = this.findPossibleDuplicate(doc.direction, parsed, doc.sha256)
    if (possibleDuplicate) {
      issues.push(
        issue('possible_duplicate', 'warning', undefined, {
          filename: possibleDuplicate.storedFilename,
          id: possibleDuplicate.id
        })
      )
    }

    // fields the user corrected by hand stay authoritative
    const corrected = new Set<string>()
    for (const event of this.deps.repos.audit.listByDocument(id)) {
      if (event.eventType === 'manual_correction' && event.source === 'user') {
        const field = (event.nextValue as { field?: string } | null)?.field
        if (field) corrected.add(field)
      }
    }

    const invoiceDate = corrected.has('invoiceDate')
      ? doc.invoiceDate
      : parsed.invoiceDate.value
    const period = invoiceDate ? periodOfIsoDate(invoiceDate) : null

    const take = <K extends keyof TaxDocument, V>(field: K, parsedValue: V): V | TaxDocument[K] =>
      corrected.has(field) ? doc[field] : parsedValue

    const next: TaxDocument = {
      ...doc,
      pageCount: text.pageCount,
      invoiceNumber: take('invoiceNumber', parsed.invoiceNumber.value),
      invoiceDate,
      serviceDateFrom: take('serviceDateFrom', parsed.serviceDateFrom.value),
      serviceDateTo: take('serviceDateTo', parsed.serviceDateTo.value),
      dueDate: take('dueDate', parsed.dueDate.value),
      issuerName: take('issuerName', parsed.issuerName.value),
      issuerAddress: take('issuerAddress', parsed.issuerAddress.value),
      issuerCountryCode: take('issuerCountryCode', parsed.issuerCountryCode.value),
      issuerTaxNumber: take('issuerTaxNumber', parsed.issuerTaxNumber.value),
      issuerVatId: take('issuerVatId', parsed.issuerVatId.value),
      recipientName: take('recipientName', parsed.recipientName.value),
      recipientAddress: take('recipientAddress', parsed.recipientAddress.value),
      recipientCountryCode: take('recipientCountryCode', parsed.recipientCountryCode.value),
      recipientVatId: take('recipientVatId', parsed.recipientVatId.value),
      recipientIsBusiness: take('recipientIsBusiness', parsed.recipientIsBusiness.value),
      description: take('description', parsed.description.value),
      originalCurrency: take('originalCurrency', parsed.currency.value),
      netAmountOriginal: take('netAmountOriginal', parsed.netAmount.value),
      vatAmountOriginal: take('vatAmountOriginal', parsed.vatAmount.value),
      grossAmountOriginal: take('grossAmountOriginal', parsed.grossAmount.value),
      vatRates: parsed.vatRates,
      taxPeriodYear: period?.year ?? null,
      taxPeriodQuarter: period?.quarter ?? null,
      taxPeriodMonth: period?.month ?? null,
      extractedText: text.fullText,
      extractionProvider: 'local-parser',
      extractionVersion: PARSER_VERSION,
      updatedAt: new Date().toISOString()
    }

    // currency: a manually entered rate is kept, everything else re-resolves
    if (doc.exchangeRateSource === 'manual' && doc.exchangeRateToEur !== null) {
      next.netAmountEur =
        next.netAmountOriginal !== null && next.originalCurrency !== 'EUR'
          ? convertToEur(next.netAmountOriginal, {
              currency: next.originalCurrency ?? '',
              date: doc.exchangeRateDate ?? '',
              rateToEur: doc.exchangeRateToEur,
              source: 'manual'
            })
          : next.netAmountOriginal
      next.vatAmountEur =
        next.vatAmountOriginal !== null && next.originalCurrency !== 'EUR'
          ? convertToEur(next.vatAmountOriginal, {
              currency: next.originalCurrency ?? '',
              date: doc.exchangeRateDate ?? '',
              rateToEur: doc.exchangeRateToEur,
              source: 'manual'
            })
          : next.vatAmountOriginal
      next.grossAmountEur =
        next.grossAmountOriginal !== null && next.originalCurrency !== 'EUR'
          ? convertToEur(next.grossAmountOriginal, {
              currency: next.originalCurrency ?? '',
              date: doc.exchangeRateDate ?? '',
              rateToEur: doc.exchangeRateToEur,
              source: 'manual'
            })
          : next.grossAmountOriginal
    } else {
      const currencyResult = await this.resolveCurrency(parsed, text.fullText, invoiceDate)
      issues.push(...currencyResult.issues)
      next.exchangeRateToEur = currencyResult.rate?.rateToEur ?? null
      next.exchangeRateDate = currencyResult.rate?.date ?? null
      next.exchangeRateSource = currencyResult.rate?.source ?? null
      next.netAmountEur = currencyResult.netEur
      next.vatAmountEur = currencyResult.vatEur
      next.grossAmountEur = currencyResult.grossEur
    }

    // classification: manual override wins, otherwise re-run the engine
    const stored = doc.extractionRawJson as
      | { vatClassification?: { manualOverride?: boolean } }
      | null
    const hasManualOverride = stored?.vatClassification?.manualOverride === true
    let classification: VatClassificationResult | undefined
    if (!hasManualOverride) {
      classification = this.classify(doc.direction, parsed, settings, invoiceDate)
      next.vatTreatmentCode = classification.code
      next.vatTreatmentLabel = classification.labelDe
      next.vatLegalBasis = classification.legalBasis
    }

    const fieldConfidence: Record<string, number> = {}
    for (const [key, field] of Object.entries(parsed)) {
      if (
        field !== null &&
        typeof field === 'object' &&
        'confidence' in (field as Record<string, unknown>)
      ) {
        fieldConfidence[key] = (field as { confidence: number }).confidence
      }
    }
    // user-corrected fields display as manual, not as parser output
    for (const field of corrected) {
      for (const key of confidenceKeysForField(field)) delete fieldConfidence[key]
    }
    next.fieldConfidence = fieldConfidence
    const { extractedText: _omit, ...rawParsed } = parsed
    next.extractionRawJson = rawParsed
    next.issues = issues
    next.reviewReasons = [...new Set(issues.map((i) => i.code))]
    next.reviewStatus = 'needs_review'
    next.userConfirmedAt = null

    const changedFields = (Object.keys(next) as (keyof TaxDocument)[]).filter(
      (k) =>
        k !== 'updatedAt' &&
        k !== 'extractionRawJson' &&
        k !== 'fieldConfidence' &&
        JSON.stringify(next[k]) !== JSON.stringify(doc[k])
    )
    const saved = this.deps.repos.documents.updateIfUnchanged(
      next,
      doc.updatedAt,
      classification
    )
    if (!saved) return false
    if (settings.llmCheckerEnabled && this.deps.llm?.isReady()) this.deps.llm.enqueue(id)
    this.deps.repos.audit.append({
      documentId: id,
      eventType: 're_extraction',
      previousValue: { extractionVersion: doc.extractionVersion },
      nextValue: {
        extractionVersion: PARSER_VERSION,
        changedFields: changedFields.slice(0, 40)
      },
      source: 'user'
    })
    return changedFields.length > 0
  }

  async retry(fileId: string): Promise<void> {
    const row = this.deps.repos.importJobs.get(fileId)
    if (!row) throw new Error('not_found')
    if (row.status !== 'failed' && row.status !== 'duplicate') {
      throw new Error('invalid_state')
    }
    this.deps.repos.importJobs.update(fileId, { status: 'queued', errorKey: null })
    const queued: QueuedFile = {
      fileId,
      importId: row.importId,
      sourcePath: row.sourcePath,
      direction: row.direction,
      // an explicit retry of a duplicate means the user wants it anyway
      duplicateAction: row.status === 'duplicate' ? 'import_anyway' : 'ask'
    }
    this.armBatch(row.importId)
    this.queue.push(queued)
    this.emitProgress(queued, 'queued', { issues: [] })
    this.pump()
  }

  dismiss(importId: string): void {
    this.deps.repos.importJobs.deleteFinishedByImportId(importId)
  }

  /** Mark jobs interrupted by an app crash/quit and clean .tmp orphans. */
  async recoverOnBoot(): Promise<void> {
    const unfinished = this.deps.repos.importJobs.listUnfinished()
    for (const row of unfinished) {
      this.deps.repos.importJobs.update(row.id, { status: 'failed', errorKey: 'interrupted' })
      this.deps.repos.audit.append({
        documentId: row.documentId,
        eventType: 'import_interrupted',
        nextValue: { importJobId: row.id },
        source: 'system'
      })
    }
    const tmpDir = dataPaths(this.deps.dataDir).documentsTmp
    try {
      const entries = await fsp.readdir(tmpDir)
      for (const entry of entries) {
        await fsp.rm(path.join(tmpDir, entry), { force: true, recursive: true })
      }
      if (entries.length > 0) {
        this.deps.log.info('tmp_orphans_cleaned', { count: entries.length })
        this.deps.repos.audit.append({
          documentId: null,
          eventType: 'tmp_cleaned',
          nextValue: { count: entries.length },
          source: 'system'
        })
      }
    } catch {
      // missing tmp dir is fine
    }
    if (unfinished.length > 0) {
      this.deps.log.warn('import_jobs_interrupted', { count: unfinished.length })
    }
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async validateSourcePath(sourcePath: string): Promise<string | null> {
    if (!path.isAbsolute(sourcePath)) return 'invalid_path'
    if (!sourcePath.toLowerCase().endsWith('.pdf')) return 'not_a_pdf'
    try {
      const stat = await fsp.stat(sourcePath)
      if (!stat.isFile()) return 'file_not_found'
    } catch {
      return 'file_not_found'
    }
    try {
      await fsp.access(sourcePath, fsp.constants.R_OK)
    } catch {
      return 'not_readable'
    }
    return null
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.running++
      void this.processFile(next)
        .catch((err) => {
          this.deps.log.error('import_unhandled', {
            fileId: next.fileId,
            errorKey: err instanceof Error ? err.message : 'internal_error'
          })
          // a file must never leave its batch hanging (settle is idempotent)
          this.settleFile(next, 'failed')
        })
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }

  /** Register one more outstanding file for an importId (start and retry). */
  private armBatch(importId: string): void {
    const tracker = this.batches.get(importId) ?? {
      outstanding: 0,
      total: 0,
      ok: 0,
      review: 0,
      failed: 0
    }
    tracker.outstanding++
    tracker.total++
    this.batches.set(importId, tracker)
  }

  /**
   * Record a file's terminal outcome. When the batch's last outstanding file
   * settles, the tracker is dropped and onBatchDone (if provided) fires once.
   */
  private settleFile(
    file: QueuedFile,
    outcome: 'ok' | 'review' | 'failed' | 'duplicate'
  ): void {
    if (file.settled) return
    file.settled = true
    const tracker = this.batches.get(file.importId)
    if (!tracker) return
    if (outcome === 'ok') tracker.ok++
    else if (outcome === 'review') tracker.review++
    else if (outcome === 'failed') tracker.failed++
    // duplicates count into total only
    tracker.outstanding--
    if (tracker.outstanding <= 0) {
      this.batches.delete(file.importId)
      this.deps.onBatchDone?.({
        total: tracker.total,
        ok: tracker.ok,
        review: tracker.review,
        failed: tracker.failed
      })
    }
  }

  private emitProgress(
    file: QueuedFile,
    status: ProcessingStatus,
    extra: {
      issues?: DocumentIssue[]
      storedFilename?: string | null
      documentId?: string | null
      progress?: number | null
      errorKey?: string | null
    }
  ): void {
    this.deps.emit({
      importId: file.importId,
      fileId: file.fileId,
      originalFilename: path.basename(file.sourcePath),
      storedFilename: extra.storedFilename ?? null,
      documentId: extra.documentId ?? null,
      direction: file.direction,
      status,
      issues: extra.issues ?? [],
      progress: extra.progress ?? null,
      errorKey: extra.errorKey ?? null
    })
  }

  private stage(file: QueuedFile, status: ProcessingStatus): void {
    this.deps.repos.importJobs.update(file.fileId, { status })
    this.emitProgress(file, status, { issues: [] })
  }

  private async processFile(file: QueuedFile): Promise<void> {
    const paths = dataPaths(this.deps.dataDir)
    const tmpPath = path.join(paths.documentsTmp, `${uuidv4()}.pdf`)

    const fail = async (errorKey: string): Promise<void> => {
      await fsp.rm(tmpPath, { force: true }).catch(() => undefined)
      this.deps.repos.importJobs.update(file.fileId, { status: 'failed', errorKey })
      this.emitProgress(file, 'failed', { errorKey, issues: [] })
      this.deps.log.warn('import_failed', { fileId: file.fileId, errorKey })
      this.settleFile(file, 'failed')
    }

    try {
      // 1 — validate source
      this.stage(file, 'validating')
      let size: number
      try {
        size = await fileSize(file.sourcePath)
      } catch {
        return await fail('file_not_found')
      }
      if (size === 0) return await fail('empty_pdf')
      if (!(await hasPdfMagic(file.sourcePath).catch(() => false))) {
        return await fail('not_a_pdf')
      }

      // 2 — hash + duplicate check (before any copy)
      const sha256 = await sha256File(file.sourcePath)
      const existing = this.deps.repos.documents.findActiveBySha256(sha256)
      if (existing && file.duplicateAction !== 'import_anyway') {
        const duplicateIssue = issue('duplicate_detected', 'info', undefined, {
          existingDocumentId: existing.id
        })
        this.deps.repos.importJobs.update(file.fileId, {
          status: 'duplicate',
          documentId: existing.id
        })
        this.emitProgress(file, 'duplicate', {
          issues: [duplicateIssue],
          documentId: existing.id
        })
        this.settleFile(file, 'duplicate')
        return // source untouched, no new record
      }

      // 3 — copy to .tmp and verify
      this.stage(file, 'copying')
      if (!(await hasDiskSpaceFor(paths.documentsTmp, size * 2))) {
        return await fail('disk_space')
      }
      try {
        await copyAndVerify(file.sourcePath, tmpPath, sha256)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        return await fail(code === 'ENOSPC' ? 'disk_space' : 'copy_failed')
      }

      // 4 + 5 — validate PDF, native text, OCR where needed
      this.stage(file, 'extracting_text')
      let text: DocumentTextResult
      try {
        text = await this.deps.extraction.extractDocumentText(tmpPath, sha256, (page, of) => {
          this.emitProgress(file, 'running_ocr', {
            issues: [],
            progress: of > 0 ? Math.min(1, page / of) : null
          })
        })
      } catch (err) {
        const key = err instanceof Error ? err.message : 'corrupt_pdf'
        return await fail(
          key === 'password_protected' || key === 'corrupt_pdf' ? key : 'corrupt_pdf'
        )
      }

      const issues: DocumentIssue[] = []
      const pagesNeedingOcr = text.ocrPages.length + text.ocrFailedPages.length
      if (pagesNeedingOcr > 0 && text.ocrPages.length === 0) {
        issues.push(issue('ocr_failed', 'critical'))
      } else if (text.ocrFailedPages.length > 0) {
        issues.push(issue('ocr_partial', 'warning'))
      }

      // 6 — field extraction
      this.stage(file, 'extracting_fields')
      const settings = this.deps.repos.settings.get()
      const parsed = parseInvoiceText(text.fullText, {
        direction: file.direction,
        ownName: settings.businessName || undefined,
        ownVatId: settings.businessVatId || undefined,
        ocrUsed: text.ocrUsed,
        ocrPages: text.ocrPages
      })
      issues.push(...parsed.issues)

      // 6b — near-duplicate detection (different bytes, same invoice data).
      // Warn only: the import is never blocked and nothing is deleted.
      const possibleDuplicate = this.findPossibleDuplicate(file.direction, parsed, sha256)
      if (possibleDuplicate) {
        issues.push(
          issue('possible_duplicate', 'warning', undefined, {
            filename: possibleDuplicate.storedFilename,
            id: possibleDuplicate.id
          })
        )
      }

      // 7 — VAT classification
      this.stage(file, 'classifying_tax')
      const invoiceDate = parsed.invoiceDate.value
      const classification = this.classify(file.direction, parsed, settings, invoiceDate)

      // 8 — currency
      const currencyResult = await this.resolveCurrency(parsed, text.fullText, invoiceDate)
      issues.push(...currencyResult.issues)

      // 9 — filename
      this.stage(file, 'saving')
      const company =
        file.direction === 'income' ? parsed.recipientName.value : parsed.issuerName.value
      const generated = generateStoredFilename({
        invoiceDate,
        company,
        service: parsed.description.value,
        invoiceNumber: parsed.invoiceNumber.value
      })

      // 10 — period + storage folder
      const period = invoiceDate ? periodOfIsoDate(invoiceDate) : null
      const relDir = documentRelativeDir(
        period?.year ?? null,
        period?.quarter ?? null,
        file.direction
      )

      // 11 — final path (collision-safe) + atomic move + insert
      const finalPlacement = await this.placeFile(tmpPath, relDir, generated.filename, sha256)
      if (!finalPlacement) return await fail('storage_error')

      const documentId = uuidv4()
      const now = new Date().toISOString()
      const document = this.buildDocument({
        documentId,
        file,
        sha256,
        pageCount: text.pageCount,
        parsed,
        classification,
        currencyResult,
        storedFilename: finalPlacement.filename,
        storedRelativePath: finalPlacement.relativePath,
        period,
        fullText: text.fullText,
        issues,
        now
      })
      this.deps.repos.documents.insert(document, classification)
      // post-import hook: opt-in local LLM double-check (no-op unless ready)
      if (settings.llmCheckerEnabled && this.deps.llm?.isReady()) this.deps.llm.enqueue(documentId)
      this.deps.repos.audit.append({
        documentId,
        eventType: 'import',
        nextValue: {
          originalFilename: document.originalFilename,
          sha256,
          sourcePath: file.sourcePath,
          storedRelativePath: document.storedRelativePath
        },
        source: 'system'
      })
      this.deps.repos.audit.append({
        documentId,
        eventType: 'extraction',
        nextValue: {
          provider: 'local-parser',
          version: PARSER_VERSION,
          ocrUsed: text.ocrUsed,
          ocrPageCount: text.ocrPages.length
        },
        source: 'system'
      })
      this.deps.repos.audit.append({
        documentId,
        eventType: 'classification',
        nextValue: {
          code: classification.code,
          confidence: classification.confidence,
          engineVersion: VAT_ENGINE_VERSION
        },
        source: 'system'
      })
      if (possibleDuplicate) {
        this.deps.repos.audit.append({
          documentId,
          eventType: 'possible_duplicate_detected',
          nextValue: { documentId, existingDocumentId: possibleDuplicate.id },
          source: 'system'
        })
      }

      // 12 — optionally remove the source (only after full success)
      if (
        settings.moveOriginalsAfterImport &&
        !isInside(this.deps.dataDir, file.sourcePath) &&
        (await this.verifyStored(finalPlacement.absolutePath, sha256))
      ) {
        try {
          await fsp.rm(file.sourcePath, { force: false })
          this.deps.repos.audit.append({
            documentId,
            eventType: 'source_moved',
            previousValue: { sourcePath: file.sourcePath },
            nextValue: { storedRelativePath: document.storedRelativePath },
            source: 'system'
          })
        } catch {
          this.deps.log.warn('source_remove_failed', { fileId: file.fileId })
        }
      }

      // 13 — thumbnail (async, non-blocking)
      const thumbPath = path.join(paths.thumbnails, `${documentId}.png`)
      void this.deps.extraction
        .thumbnail(finalPlacement.absolutePath, thumbPath)
        .then(async () => {
          const current = this.deps.repos.documents.getById(documentId)
          if (!current || current.deletedAt !== null) {
            await fsp.rm(thumbPath, { force: true })
          }
        })
        .catch(() => this.deps.log.warn('thumbnail_failed', { documentId }))

      // 14 — final status
      const finalStatus: ProcessingStatus =
        issues.length > 0 ? 'completed_with_warnings' : 'completed'
      this.deps.repos.importJobs.update(file.fileId, { status: finalStatus, documentId })
      this.emitProgress(file, finalStatus, {
        issues,
        documentId,
        storedFilename: finalPlacement.filename
      })
      this.deps.log.info('import_completed', {
        fileId: file.fileId,
        documentId,
        status: finalStatus,
        issueCount: issues.length
      })
      this.settleFile(file, finalStatus === 'completed' ? 'ok' : 'review')
    } catch (err) {
      this.deps.log.error('import_error', {
        fileId: file.fileId,
        errorKey: err instanceof Error ? err.message : 'internal_error'
      })
      await fail('internal_error')
    }
  }

  /**
   * Near-duplicate lookup: an active document whose bytes differ (the sha256
   * gate ran earlier) but whose direction, invoice date, gross amount and
   * invoice number or counterparty match — e.g. two scans of the same
   * invoice, or a re-downloaded receipt. Returns the oldest match, or null
   * when the new document lacks the fields needed for a meaningful match.
   */
  private findPossibleDuplicate(
    direction: DocumentDirection,
    parsed: ExtractedInvoiceData,
    sha256: string
  ): TaxDocument | null {
    const invoiceDate = parsed.invoiceDate.value
    const grossAmount = parsed.grossAmount.value
    if (invoiceDate === null || grossAmount === null) return null
    const matches = this.deps.repos.documents.findPossibleDuplicates({
      direction,
      invoiceDate,
      grossAmountOriginal: grossAmount,
      invoiceNumber: parsed.invoiceNumber.value,
      issuerName: parsed.issuerName.value,
      recipientName: parsed.recipientName.value,
      excludeSha256: sha256
    })
    return matches[0] ?? null
  }

  private classify(
    direction: DocumentDirection,
    parsed: ExtractedInvoiceData,
    settings: AppSettings,
    invoiceDate: string | null
  ): VatClassificationResult {
    return classifyVat({
      direction,
      taxYear: invoiceDate ? Number(invoiceDate.slice(0, 4)) : null,
      issuerCountryCode: parsed.issuerCountryCode.value,
      issuerVatId: parsed.issuerVatId.value,
      recipientCountryCode: parsed.recipientCountryCode.value,
      recipientVatId: parsed.recipientVatId.value,
      recipientIsBusiness: parsed.recipientIsBusiness.value,
      recipientName: parsed.recipientName.value,
      vatRates: parsed.vatRates,
      netAmount: parsed.netAmount.value,
      vatAmount: parsed.vatAmount.value,
      grossAmount: parsed.grossAmount.value,
      currency: parsed.currency.value,
      reverseChargeWording: parsed.signals.reverseChargeWording,
      vatExemptWording: parsed.signals.vatExemptWording,
      kleinunternehmerWording: parsed.signals.kleinunternehmerWording,
      ossWording: parsed.signals.ossWording,
      isServiceLikely: parsed.signals.isServiceLikely,
      descriptionText: parsed.description.value,
      userVatMethod: settings.vatMethod
    })
  }

  private async resolveCurrency(
    parsed: ExtractedInvoiceData,
    fullText: string,
    invoiceDate: string | null
  ): Promise<{
    currency: string | null
    rate: ExchangeRateResult | null
    netEur: number | null
    vatEur: number | null
    grossEur: number | null
    issues: DocumentIssue[]
  }> {
    const issues: DocumentIssue[] = []
    const currency = parsed.currency.value ? parsed.currency.value.toUpperCase() : null
    const net = parsed.netAmount.value
    const vat = parsed.vatAmount.value
    const gross = parsed.grossAmount.value

    if (currency === null) {
      // parser is responsible for flagging a missing currency; never guess EUR
      return { currency, rate: null, netEur: null, vatEur: null, grossEur: null, issues }
    }
    if (currency === 'EUR') {
      return { currency, rate: null, netEur: net, vatEur: vat, grossEur: gross, issues }
    }

    const rateDate = invoiceDate ?? todayIso()
    let rate: ExchangeRateResult | null = null

    // a rate printed on the document itself is the best audit source
    const inline = extractInlineRate(fullText)
    if (inline && inline.currency.toUpperCase() === currency) {
      rate = { currency, date: rateDate, rateToEur: inline.rateToEur, source: 'document' }
    }

    const iso = isIsoCurrency(currency)
    if (!iso) issues.push(issue('non_iso_currency', 'warning', 'originalCurrency'))

    if (!rate && iso) {
      rate = await resolveOfficialExchangeRate(
        { currency, date: rateDate },
        this.deps.repos.exchangeRates,
        this.deps.ratesProviders
      )
    }

    if (!rate) {
      issues.push(issue('missing_exchange_rate', 'critical', 'exchangeRateToEur'))
      return { currency, rate: null, netEur: null, vatEur: null, grossEur: null, issues }
    }

    return {
      currency,
      rate,
      netEur: net !== null ? convertToEur(net, rate) : null,
      vatEur: vat !== null ? convertToEur(vat, rate) : null,
      grossEur: gross !== null ? convertToEur(gross, rate) : null,
      issues
    }
  }

  private async placeFile(
    tmpPath: string,
    relDir: string,
    baseFilename: string,
    sha256: string
  ): Promise<{
    filename: string
    relativePath: string
    absolutePath: string
  } | null> {
    let filename = baseFilename
    for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
      if (attempt > 1) filename = withCollisionSuffix(baseFilename, attempt)
      const absolutePath = resolveInside(this.deps.dataDir, relDir, filename)
      let exists = true
      try {
        await fsp.access(absolutePath)
      } catch {
        exists = false
      }
      if (exists) {
        const existingSha = await sha256File(absolutePath).catch(() => null)
        this.deps.log.info('filename_collision', {
          attempt,
          sameContent: existingSha === sha256
        })
        continue
      }
      try {
        await atomicMove(tmpPath, absolutePath)
      } catch (err) {
        // a concurrent import claimed the same name between our access()
        // check and the move — atomicMove is exclusive, so nothing was
        // clobbered; take the next collision suffix
        if (err instanceof Error && err.message === 'destination_exists') {
          this.deps.log.info('filename_collision', { attempt, sameContent: false })
          continue
        }
        throw err
      }
      return {
        filename,
        relativePath: toPosixRelative(relDir, filename),
        absolutePath
      }
    }
    return null
  }

  private async verifyStored(absolutePath: string, sha256: string): Promise<boolean> {
    const actual = await sha256File(absolutePath).catch(() => null)
    return actual === sha256
  }

  private buildDocument(args: {
    documentId: string
    file: QueuedFile
    sha256: string
    pageCount: number
    parsed: ExtractedInvoiceData
    classification: VatClassificationResult
    currencyResult: Awaited<ReturnType<ImportPipeline['resolveCurrency']>>
    storedFilename: string
    storedRelativePath: string
    period: { year: number; quarter: 1 | 2 | 3 | 4 | null; month: number | null } | null
    fullText: string
    issues: DocumentIssue[]
    now: string
  }): TaxDocument {
    const { parsed, classification, currencyResult } = args
    const fieldConfidence: Record<string, number> = {
      invoiceNumber: parsed.invoiceNumber.confidence,
      invoiceDate: parsed.invoiceDate.confidence,
      serviceDateFrom: parsed.serviceDateFrom.confidence,
      serviceDateTo: parsed.serviceDateTo.confidence,
      dueDate: parsed.dueDate.confidence,
      paymentDate: parsed.paymentDate.confidence,
      issuerName: parsed.issuerName.confidence,
      issuerCountryCode: parsed.issuerCountryCode.confidence,
      issuerVatId: parsed.issuerVatId.confidence,
      recipientName: parsed.recipientName.confidence,
      recipientCountryCode: parsed.recipientCountryCode.confidence,
      recipientVatId: parsed.recipientVatId.confidence,
      description: parsed.description.confidence,
      currency: parsed.currency.confidence,
      netAmount: parsed.netAmount.confidence,
      vatAmount: parsed.vatAmount.confidence,
      grossAmount: parsed.grossAmount.confidence
    }
    const confidences = Object.values(fieldConfidence)
    const extractionConfidence =
      confidences.length > 0
        ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) /
          1000
        : null

    const reviewReasons = [...new Set(args.issues.map((i) => i.code))]
    if (classification.requiresUserConfirmation) {
      reviewReasons.push('vat_classification_unconfirmed')
    }

    // keep the raw parse result for later re-classification (signals!) but
    // avoid duplicating the full text inside the JSON blob
    const { extractedText: _omit, ...rawParsed } = parsed

    return {
      id: args.documentId,
      direction: args.file.direction,
      originalFilename: path.basename(args.file.sourcePath),
      storedFilename: args.storedFilename,
      storedRelativePath: args.storedRelativePath,
      sha256: args.sha256,
      mimeType: 'application/pdf',
      pageCount: args.pageCount,
      invoiceNumber: parsed.invoiceNumber.value,
      invoiceDate: parsed.invoiceDate.value,
      serviceDateFrom: parsed.serviceDateFrom.value,
      serviceDateTo: parsed.serviceDateTo.value,
      receiptDate: null,
      paymentDate: parsed.paymentDate.value,
      dueDate: parsed.dueDate.value,
      paymentStatus:
        parsed.paymentDate.value !== null || parsed.signals.paidWording ? 'paid' : 'unknown',
      issuerName: parsed.issuerName.value,
      issuerAddress: parsed.issuerAddress.value,
      issuerCountryCode: parsed.issuerCountryCode.value,
      issuerTaxNumber: parsed.issuerTaxNumber.value,
      issuerVatId: parsed.issuerVatId.value,
      recipientName: parsed.recipientName.value,
      recipientAddress: parsed.recipientAddress.value,
      recipientCountryCode: parsed.recipientCountryCode.value,
      recipientTaxNumber: null,
      recipientVatId: parsed.recipientVatId.value,
      recipientIsBusiness: parsed.recipientIsBusiness.value,
      description: parsed.description.value,
      expenseCategory: null,
      originalCurrency: currencyResult.currency,
      netAmountOriginal: parsed.netAmount.value,
      vatAmountOriginal: parsed.vatAmount.value,
      grossAmountOriginal: parsed.grossAmount.value,
      exchangeRateToEur: currencyResult.rate?.rateToEur ?? null,
      exchangeRateDate: currencyResult.rate?.date ?? null,
      exchangeRateSource: currencyResult.rate?.source ?? null,
      netAmountEur: currencyResult.netEur,
      vatAmountEur: currencyResult.vatEur,
      grossAmountEur: currencyResult.grossEur,
      vatRates: parsed.vatRates,
      vatTreatmentCode: classification.code,
      vatTreatmentLabel: classification.labelDe,
      vatLegalBasis: classification.legalBasis,
      taxPeriodYear: args.period?.year ?? null,
      taxPeriodQuarter: args.period?.quarter ?? null,
      taxPeriodMonth: args.period?.month ?? null,
      extractedText: args.fullText,
      extractionProvider: 'local-parser',
      extractionVersion: PARSER_VERSION,
      extractionConfidence,
      fieldConfidence,
      extractionRawJson: rawParsed,
      reviewStatus: 'needs_review',
      reviewReasons,
      issues: args.issues,
      userConfirmedAt: null,
      deletedAt: null,
      createdAt: args.now,
      updatedAt: args.now
    }
  }
}
