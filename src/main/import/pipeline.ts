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
import {
  convertToEur,
  extractInlineRate,
  isIsoCurrency,
  type ExchangeRateProvider,
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
}

export interface PipelineDeps {
  dataDir: string
  repos: Repositories
  extraction: ExtractionService
  ratesProvider: ExchangeRateProvider
  emit: (progress: ImportFileProgress) => void
  log: Logger
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

  constructor(private readonly deps: PipelineDeps) {}

  // -------------------------------------------------------------------------
  // public API
  // -------------------------------------------------------------------------

  async start(payload: ImportFilesPayload): Promise<ImportStartResult> {
    const importId = uuidv4()
    const accepted: { path: string; fileId: string }[] = []
    const rejected: { path: string; reasonKey: string }[] = []

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
      this.queue.push(queued)
      this.emitProgress(queued, 'queued', { issues: [] })
    }

    this.pump()
    return { importId, accepted, rejected }
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
        })
        .finally(() => {
          this.running--
          this.pump()
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
    } catch (err) {
      this.deps.log.error('import_error', {
        fileId: file.fileId,
        errorKey: err instanceof Error ? err.message : 'internal_error'
      })
      await fail('internal_error')
    }
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
      const cached = this.deps.repos.exchangeRates.find(currency, rateDate)
      if (cached) rate = { ...cached }
    }
    if (!rate && iso) {
      rate = await this.deps.ratesProvider.getRate({ currency, date: rateDate })
    }

    if (!rate) {
      issues.push(issue('missing_exchange_rate', 'warning', 'exchangeRateToEur'))
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
      await atomicMove(tmpPath, absolutePath)
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
