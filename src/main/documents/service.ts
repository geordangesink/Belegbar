/**
 * Document mutation semantics (update/confirm/direction/VAT/delete/restore).
 * Electron-free: handlers.ts wires these to IPC; dialogs/shell stay there.
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import {
  classifyVat,
  isVatTreatmentApplicable,
  listVatTreatments
} from '@core/vat/classify'
import { generateStoredFilename, withCollisionSuffix } from '@core/files/filename'
import { periodOfIsoDate } from '@core/period/period'
import { convertToEur, isIsoCurrency, type ExchangeRateResult } from '@core/currency/convert'
import {
  canonicalDocumentField,
  confidenceKeysForField
} from '@core/review/fields'
import type {
  DeleteDocumentsResult,
  DocumentDirection,
  DocumentIssue,
  ExtractedInvoiceData,
  TaxDocument,
  VatClassificationResult
} from '@shared/domain'
import type { SaveDocumentCopiesResult } from '@shared/api'
import type { UpdateDocumentPayload } from '@shared/ipc'
import type { Repositories } from '../db/repository'
import type { Logger } from '../log'
import { dataPaths, documentRelativeDir, resolveInside } from '../storage/paths'
import {
  atomicMove,
  copyAndVerify,
  copyAndVerifyReplacing,
  moveToTrash
} from '../storage/files'

const FILENAME_RELEVANT_FIELDS: (keyof UpdateDocumentPayload['patch'])[] = [
  'invoiceDate',
  'issuerName',
  'recipientName',
  'description',
  'invoiceNumber'
]

type DocumentCopiesDestination =
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string }

const COPY_COLLISION_ATTEMPTS = 10_000

function issue(
  code: string,
  severity: DocumentIssue['severity'],
  field?: string
): DocumentIssue {
  return { code, severity, messageKey: `issues.${code}`, field }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const DEFAULT_SIGNALS: ExtractedInvoiceData['signals'] = {
  reverseChargeWording: false,
  vatExemptWording: false,
  kleinunternehmerWording: false,
  ossWording: false,
  paidWording: false,
  isServiceLikely: false
}

function signalsFromRaw(raw: unknown): ExtractedInvoiceData['signals'] {
  if (raw && typeof raw === 'object' && 'signals' in raw) {
    const s = (raw as { signals?: unknown }).signals
    if (s && typeof s === 'object') {
      return { ...DEFAULT_SIGNALS, ...(s as Partial<ExtractedInvoiceData['signals']>) }
    }
  }
  return DEFAULT_SIGNALS
}

function safeIsIsoCurrency(code: string): boolean {
  try {
    return isIsoCurrency(code)
  } catch {
    return /^[A-Z]{3}$/.test(code)
  }
}

/** Is this issue resolved by the document's current field values? */
export function isIssueResolved(docIssue: DocumentIssue, doc: TaxDocument): boolean {
  const code = docIssue.code
  if (
    code === 'conflicting_totals' ||
    code.includes('inconsistent') ||
    code.includes('mismatch')
  ) {
    const { netAmountOriginal: net, vatAmountOriginal: vat, grossAmountOriginal: gross } = doc
    if (net === null || vat === null || gross === null) return true
    return Math.abs(net + vat - gross) <= 0.02
  }
  switch (code) {
    case 'missing_invoice_date':
      return doc.invoiceDate !== null
    case 'missing_invoice_number':
      return doc.invoiceNumber !== null
    case 'missing_currency':
    case 'unknown_currency':
      return doc.originalCurrency !== null
    case 'missing_amount':
    case 'missing_amounts':
      return doc.grossAmountOriginal !== null || doc.netAmountOriginal !== null
    case 'missing_gross_amount':
      return doc.grossAmountOriginal !== null
    case 'missing_net_amount':
      return doc.netAmountOriginal !== null
    case 'missing_vat_amount':
      return doc.vatAmountOriginal !== null
    case 'missing_exchange_rate':
      return doc.originalCurrency?.trim().toUpperCase() === 'EUR' || doc.exchangeRateToEur !== null
    case 'non_iso_currency':
      return doc.originalCurrency !== null && safeIsIsoCurrency(doc.originalCurrency)
    case 'llm_disagreement':
      return false
    case 'missing_issuer':
    case 'missing_issuer_name':
      return doc.issuerName !== null
    case 'missing_recipient':
    case 'missing_recipient_name':
      return doc.recipientName !== null
    case 'rename_failed':
    case 'ocr_failed':
    case 'ocr_partial':
    case 'duplicate_detected':
      return false // cleared explicitly, never by field edits
    default: {
      const field = canonicalDocumentField(docIssue.field ?? '')
      if (field && field in doc) {
        const value = doc[field as keyof TaxDocument]
        return value !== null && value !== undefined && value !== ''
      }
      return false
    }
  }
}

export function syncCoreIssues(doc: TaxDocument): TaxDocument {
  const next = {
    ...doc,
    issues: doc.issues.filter(
      (item) => item.code !== 'missing_exchange_rate' || !isIssueResolved(item, doc)
    )
  }
  const ensure = (code: string, field: string): void => {
    const existingIndex = next.issues.findIndex((item) => item.code === code)
    if (existingIndex === -1) {
      next.issues.push(issue(code, 'critical', field))
    } else if (next.issues[existingIndex]!.severity !== 'critical') {
      next.issues[existingIndex] = {
        ...next.issues[existingIndex]!,
        severity: 'critical',
        field: next.issues[existingIndex]!.field ?? field
      }
    }
  }
  if (next.invoiceDate === null) ensure('missing_invoice_date', 'invoiceDate')
  if (next.originalCurrency === null) ensure('unknown_currency', 'currency')
  if (next.grossAmountOriginal === null && next.netAmountOriginal === null) {
    ensure('missing_amount', 'grossAmount')
  }
  if (
    next.originalCurrency !== null &&
    next.originalCurrency.trim().toUpperCase() !== 'EUR' &&
    next.exchangeRateToEur === null
  ) {
    ensure('missing_exchange_rate', 'exchangeRateToEur')
  }
  const { netAmountOriginal: net, vatAmountOriginal: vat, grossAmountOriginal: gross } = next
  if (
    net !== null &&
    vat !== null &&
    gross !== null &&
    Math.abs(net + vat - gross) > 0.02
  ) {
    ensure('conflicting_totals', 'grossAmount')
  }
  next.reviewReasons = [...new Set(next.issues.map((item) => item.code))]
  return next
}

export function invalidateFieldEvidence(
  doc: TaxDocument,
  changedFields: readonly string[]
): TaxDocument {
  const changed = new Set(changedFields.map(canonicalDocumentField))
  const next: TaxDocument = {
    ...doc,
    fieldConfidence: { ...doc.fieldConfidence },
    issues: doc.issues.filter(
      (item) =>
        item.code !== 'llm_disagreement' ||
        !changed.has(canonicalDocumentField(item.field ?? ''))
    )
  }
  for (const field of changed) {
    for (const key of confidenceKeysForField(field)) delete next.fieldConfidence[key]
  }
  if (next.extractionRawJson === null || typeof next.extractionRawJson !== 'object') return next
  const raw = { ...(next.extractionRawJson as Record<string, unknown>) }
  const llmCheck = raw['llmCheck']
  if (llmCheck === null || typeof llmCheck !== 'object') {
    next.extractionRawJson = raw
    return next
  }
  const check = { ...(llmCheck as Record<string, unknown>) }
  const storedFields = check['fields']
  if (storedFields === null || typeof storedFields !== 'object') {
    next.extractionRawJson = raw
    return next
  }
  const fields = { ...(storedFields as Record<string, unknown>) }
  for (const field of Object.keys(fields)) {
    if (changed.has(canonicalDocumentField(field))) delete fields[field]
  }
  if (Object.keys(fields).length === 0) delete raw['llmCheck']
  else raw['llmCheck'] = { ...check, fields }
  next.extractionRawJson = raw
  return next
}

export interface DocumentServiceDeps {
  dataDir: string
  repos: Repositories
  log: Logger
}

export class DocumentService {
  constructor(private readonly deps: DocumentServiceDeps) {}

  absolutePathOf(doc: TaxDocument): string {
    return resolveInside(this.deps.dataDir, ...doc.storedRelativePath.split('/'))
  }

  private storedPdfPathOf(doc: TaxDocument): string {
    if (!doc.deletedAt) return this.absolutePathOf(doc)
    return resolveInside(
      dataPaths(this.deps.dataDir).documentsTrash,
      `${doc.id}__${doc.storedFilename}`
    )
  }

  private getOrThrow(id: string): TaxDocument {
    const doc = this.deps.repos.documents.getById(id)
    if (!doc) throw new Error('not_found')
    return doc
  }

  private reclassify(doc: TaxDocument): VatClassificationResult {
    const signals = signalsFromRaw(doc.extractionRawJson)
    return classifyVat({
      direction: doc.direction,
      taxYear: doc.invoiceDate ? Number(doc.invoiceDate.slice(0, 4)) : null,
      issuerCountryCode: doc.issuerCountryCode,
      issuerVatId: doc.issuerVatId,
      recipientCountryCode: doc.recipientCountryCode,
      recipientVatId: doc.recipientVatId,
      recipientIsBusiness: doc.recipientIsBusiness,
      recipientName: doc.recipientName,
      vatRates: doc.vatRates,
      netAmount: doc.netAmountOriginal,
      vatAmount: doc.vatAmountOriginal,
      grossAmount: doc.grossAmountOriginal,
      currency: doc.originalCurrency,
      reverseChargeWording: signals.reverseChargeWording,
      vatExemptWording: signals.vatExemptWording,
      kleinunternehmerWording: signals.kleinunternehmerWording,
      ossWording: signals.ossWording,
      isServiceLikely: signals.isServiceLikely,
      descriptionText: doc.description,
      userVatMethod: this.deps.repos.settings.get().vatMethod
    })
  }

  /** EUR amounts from originals + stored rate. Never guesses a rate. */
  private recomputeEurAmounts(doc: TaxDocument): TaxDocument {
    const next = { ...doc }
    const currency = next.originalCurrency ? next.originalCurrency.toUpperCase() : null
    if (currency === 'EUR') {
      next.netAmountEur = next.netAmountOriginal !== null ? round2(next.netAmountOriginal) : null
      next.vatAmountEur = next.vatAmountOriginal !== null ? round2(next.vatAmountOriginal) : null
      next.grossAmountEur =
        next.grossAmountOriginal !== null ? round2(next.grossAmountOriginal) : null
      next.exchangeRateToEur = null
      next.exchangeRateDate = null
      next.exchangeRateSource = null
      return next
    }
    let rate: ExchangeRateResult | null = null
    if (currency !== null && next.exchangeRateToEur !== null) {
      rate = {
        currency,
        date: next.exchangeRateDate ?? next.invoiceDate ?? todayIso(),
        rateToEur: next.exchangeRateToEur,
        source: next.exchangeRateSource ?? 'manual'
      }
    } else if (currency !== null && safeIsIsoCurrency(currency)) {
      // offline-safe: cached rates only, no network during an edit
      const cached = this.deps.repos.exchangeRates.find(
        currency,
        next.invoiceDate ?? todayIso()
      )
      if (cached) {
        rate = { ...cached }
        next.exchangeRateToEur = cached.rateToEur
        next.exchangeRateDate = cached.date
        next.exchangeRateSource = cached.source
      }
    }
    if (rate) {
      next.netAmountEur =
        next.netAmountOriginal !== null ? convertToEur(next.netAmountOriginal, rate) : null
      next.vatAmountEur =
        next.vatAmountOriginal !== null ? convertToEur(next.vatAmountOriginal, rate) : null
      next.grossAmountEur =
        next.grossAmountOriginal !== null ? convertToEur(next.grossAmountOriginal, rate) : null
    } else {
      next.netAmountEur = null
      next.vatAmountEur = null
      next.grossAmountEur = null
    }
    return next
  }

  private recomputePeriod(doc: TaxDocument): TaxDocument {
    const next = { ...doc }
    if (next.invoiceDate) {
      const period = periodOfIsoDate(next.invoiceDate)
      next.taxPeriodYear = period.year
      next.taxPeriodQuarter = period.quarter
      next.taxPeriodMonth = period.month
    } else {
      next.taxPeriodYear = null
      next.taxPeriodQuarter = null
      next.taxPeriodMonth = null
    }
    return next
  }

  /**
   * Move the stored file to match filename/period/direction. On failure the
   * old path is kept and a critical rename_failed issue is added.
   */
  private async relocateFile(
    doc: TaxDocument,
    targetFilename: string,
    auditType: 'file_renamed' | 'file_moved'
  ): Promise<TaxDocument> {
    const next = { ...doc }
    const relDir = documentRelativeDir(next.taxPeriodYear, next.taxPeriodQuarter, next.direction)
    const currentAbs = this.absolutePathOf(doc)
    let filename = targetFilename
    try {
      for (let attempt = 1; attempt <= 50; attempt++) {
        if (attempt > 1) filename = withCollisionSuffix(targetFilename, attempt)
        const targetAbs = resolveInside(this.deps.dataDir, relDir, filename)
        if (targetAbs === currentAbs) {
          // already in place
          next.issues = next.issues.filter((i) => i.code !== 'rename_failed')
          return next
        }
        try {
          await fsp.access(targetAbs)
          continue // occupied — try next suffix
        } catch {
          // free
        }
        await atomicMove(currentAbs, targetAbs)
        const previous = {
          storedFilename: doc.storedFilename,
          storedRelativePath: doc.storedRelativePath
        }
        next.storedFilename = filename
        next.storedRelativePath = path
          .join(relDir, filename)
          .split(path.sep)
          .join('/')
        next.issues = next.issues.filter((i) => i.code !== 'rename_failed')
        this.deps.repos.audit.append({
          documentId: doc.id,
          eventType: auditType,
          previousValue: previous,
          nextValue: {
            storedFilename: next.storedFilename,
            storedRelativePath: next.storedRelativePath
          },
          source: 'system'
        })
        return next
      }
      throw new Error('rename_failed')
    } catch {
      this.deps.log.warn('rename_failed', { documentId: doc.id })
      if (!next.issues.some((i) => i.code === 'rename_failed')) {
        next.issues = [...next.issues, issue('rename_failed', 'critical')]
      }
      return next
    }
  }

  private dropResolvedIssues(doc: TaxDocument): TaxDocument {
    const next = { ...doc }
    next.issues = next.issues.filter((i) => !isIssueResolved(i, next))
    next.reviewReasons = [...new Set(next.issues.map((i) => i.code))]
    return next
  }

  // -------------------------------------------------------------------------

  async update(payload: UpdateDocumentPayload): Promise<TaxDocument> {
    const doc = this.getOrThrow(payload.id)
    if (doc.deletedAt) throw new Error('not_found')

    const patch = payload.patch
    const changedFields: string[] = []
    let next: TaxDocument = { ...doc }
    for (const [key, value] of Object.entries(patch)) {
      const field = key as keyof UpdateDocumentPayload['patch']
      const prev = doc[field as keyof TaxDocument]
      if (prev === value) continue
      changedFields.push(field)
      ;(next as unknown as Record<string, unknown>)[field] = value
      this.deps.repos.audit.append({
        documentId: doc.id,
        eventType: 'manual_correction',
        previousValue: { field, value: prev },
        nextValue: { field, value },
        source: 'user'
      })
    }
    if (changedFields.length === 0) return doc

    next = invalidateFieldEvidence(next, changedFields)

    // re-derive everything that depends on the edited fields — but a VAT
    // treatment the user picked explicitly stays until they change it or
    // the document switches direction
    const stored = doc.extractionRawJson as
      | { vatClassification?: { manualOverride?: boolean } }
      | null
    const hasManualOverride = stored?.vatClassification?.manualOverride === true
    let classification: VatClassificationResult | undefined
    if (!hasManualOverride) {
      classification = this.reclassify(next)
      next.vatTreatmentCode = classification.code
      next.vatTreatmentLabel = classification.labelDe
      next.vatLegalBasis = classification.legalBasis
    }
    next = this.recomputeEurAmounts(next)
    next = this.recomputePeriod(next)
    next = this.dropResolvedIssues(next)
    next = syncCoreIssues(next)

    const filenameRelevant =
      changedFields.some((f) =>
        (FILENAME_RELEVANT_FIELDS as string[]).includes(f)
      ) || next.invoiceDate !== doc.invoiceDate
    if (filenameRelevant) {
      const company = next.direction === 'income' ? next.recipientName : next.issuerName
      const generated = generateStoredFilename({
        invoiceDate: next.invoiceDate,
        company,
        service: next.description,
        invoiceNumber: next.invoiceNumber
      })
      next = await this.relocateFile(next, generated.filename, 'file_renamed')
    } else if (
      next.taxPeriodYear !== doc.taxPeriodYear ||
      next.taxPeriodQuarter !== doc.taxPeriodQuarter
    ) {
      next = await this.relocateFile(next, next.storedFilename, 'file_moved')
    }

    next.reviewReasons = [...new Set(next.issues.map((i) => i.code))]
    next.reviewStatus = 'needs_review' // edits always require re-confirmation
    next.userConfirmedAt = null
    return this.deps.repos.documents.update(next, classification)
  }

  async confirm(id: string): Promise<TaxDocument> {
    const doc = this.getOrThrow(id)
    if (doc.deletedAt) throw new Error('not_found')
    if (syncCoreIssues(doc).issues.some((i) => i.severity === 'critical')) {
      throw new Error('critical_issues')
    }
    const next: TaxDocument = {
      ...doc,
      reviewStatus: 'confirmed',
      userConfirmedAt: new Date().toISOString()
    }
    this.deps.repos.audit.append({
      documentId: id,
      eventType: 'confirm',
      previousValue: { reviewStatus: doc.reviewStatus },
      nextValue: { reviewStatus: 'confirmed' },
      source: 'user'
    })
    return this.deps.repos.documents.update(next)
  }

  async setPaymentDate(
    ids: string[],
    mode: 'date' | 'invoice_date' | 'not_paid' | 'unknown',
    date?: string
  ): Promise<void> {
    for (const id of ids) {
      const doc = this.deps.repos.documents.getById(id)
      if (!doc || doc.deletedAt) continue
      let paymentDate: string | null
      let paymentStatus: TaxDocument['paymentStatus']
      switch (mode) {
        case 'date':
          if (!date) throw new Error('invalid_payload')
          paymentDate = date
          paymentStatus = 'paid'
          break
        case 'invoice_date':
          if (!doc.invoiceDate) continue // never invent a payment date
          paymentDate = doc.invoiceDate
          paymentStatus = 'paid'
          break
        case 'not_paid':
          paymentDate = null
          paymentStatus = 'unpaid'
          break
        case 'unknown':
          paymentDate = null
          paymentStatus = 'unknown'
          break
      }
      if (doc.paymentDate === paymentDate && doc.paymentStatus === paymentStatus) continue
      let next: TaxDocument = { ...doc, paymentDate, paymentStatus }
      next = this.dropResolvedIssues(next)
      this.deps.repos.audit.append({
        documentId: id,
        eventType: 'payment_date_change',
        previousValue: { paymentDate: doc.paymentDate, paymentStatus: doc.paymentStatus },
        nextValue: { paymentDate, paymentStatus },
        source: 'user'
      })
      this.deps.repos.documents.update(next)
    }
  }

  async setDirection(ids: string[], direction: DocumentDirection): Promise<void> {
    for (const id of ids) {
      const doc = this.deps.repos.documents.getById(id)
      if (!doc || doc.deletedAt || doc.direction === direction) continue
      let next: TaxDocument = { ...doc, direction }
      const classification = this.reclassify(next)
      next.vatTreatmentCode = classification.code
      next.vatTreatmentLabel = classification.labelDe
      next.vatLegalBasis = classification.legalBasis
      next = await this.relocateFile(next, next.storedFilename, 'file_moved')
      next.reviewStatus = 'needs_review'
      next.userConfirmedAt = null
      next.reviewReasons = [...new Set(next.issues.map((i) => i.code))]
      this.deps.repos.audit.append({
        documentId: id,
        eventType: 'direction_change',
        previousValue: { direction: doc.direction },
        nextValue: { direction },
        source: 'user'
      })
      this.deps.repos.documents.update(next, classification)
    }
  }

  async setVatTreatment(id: string, code: string, reason?: string): Promise<TaxDocument> {
    const doc = this.getOrThrow(id)
    if (doc.deletedAt) throw new Error('not_found')
    const treatment = listVatTreatments().find((t) => t.code === code)
    if (!treatment || !isVatTreatmentApplicable(doc.direction, treatment.code)) {
      throw new Error('invalid_treatment_code')
    }
    const next: TaxDocument = {
      ...doc,
      vatTreatmentCode: treatment.code,
      vatTreatmentLabel: treatment.labelDe,
      vatLegalBasis: treatment.legalBasis,
      reviewReasons: doc.reviewReasons.filter(
        (reason) => reason !== 'vat_classification_unconfirmed'
      ),
      reviewStatus: 'needs_review',
      userConfirmedAt: null
    }
    this.deps.repos.audit.append({
      documentId: id,
      eventType: 'tax_classification_change',
      previousValue: { code: doc.vatTreatmentCode },
      nextValue: { code: treatment.code, reason: reason ?? null },
      source: 'user'
    })
    return this.deps.repos.documents.update(next, { ...treatment, manualOverride: true })
  }

  async delete(id: string, mode: 'trash' | 'hard'): Promise<void> {
    const doc = this.getOrThrow(id)
    const paths = dataPaths(this.deps.dataDir)
    if (mode === 'trash') {
      if (doc.deletedAt) return
      const abs = this.absolutePathOf(doc)
      try {
        await moveToTrash(abs, paths.documentsTrash, doc.id, doc.storedFilename)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('trash_failed')
      }
      this.deps.repos.documents.update({ ...doc, deletedAt: new Date().toISOString() })
      this.deps.repos.audit.append({
        documentId: id,
        eventType: 'delete',
        previousValue: { storedRelativePath: doc.storedRelativePath },
        nextValue: { trashed: true },
        source: 'user'
      })
      return
    }
    // hard delete: only allowed from trash
    if (!doc.deletedAt) throw new Error('not_trashed')
    const trashPath = path.join(paths.documentsTrash, `${doc.id}__${doc.storedFilename}`)
    await fsp.rm(path.join(paths.thumbnails, `${doc.id}.png`), { force: true })
    await fsp.rm(trashPath, { force: true })
    this.deps.repos.documents.hardDelete(id)
    try {
      this.deps.repos.audit.append({
        documentId: id,
        eventType: 'hard_delete',
        previousValue: { storedRelativePath: doc.storedRelativePath },
        nextValue: null,
        source: 'user'
      })
    } catch {
      this.deps.log.warn('hard_delete_audit_failed', { documentId: id })
    }
  }

  async deleteMany(
    ids: string[],
    mode: 'trash' | 'hard'
  ): Promise<DeleteDocumentsResult> {
    const result: DeleteDocumentsResult = { deleted: 0, skipped: 0, failed: 0 }
    for (const id of new Set(ids)) {
      const doc = this.deps.repos.documents.getById(id)
      if (!doc) {
        result.failed++
        continue
      }
      if ((mode === 'trash' && doc.deletedAt) || (mode === 'hard' && !doc.deletedAt)) {
        result.skipped++
        continue
      }
      try {
        await this.delete(id, mode)
        result.deleted++
      } catch {
        result.failed++
      }
    }
    return result
  }

  async emptyTrash(): Promise<DeleteDocumentsResult> {
    return this.deleteMany(
      this.deps.repos.documents.listAllTrashed().map((document) => document.id),
      'hard'
    )
  }

  async saveDocumentCopies(
    ids: readonly string[],
    destination: DocumentCopiesDestination
  ): Promise<SaveDocumentCopiesResult> {
    const uniqueIds = [...new Set(ids)]
    if (destination.kind === 'file' && uniqueIds.length !== 1) {
      throw new Error('invalid_payload')
    }

    if (destination.kind === 'directory') {
      try {
        const stat = await fsp.stat(destination.path)
        if (!stat.isDirectory()) {
          return { canceled: false, saved: 0, failed: uniqueIds.length }
        }
      } catch {
        return { canceled: false, saved: 0, failed: uniqueIds.length }
      }
    }

    let saved = 0
    let failed = 0
    for (const id of uniqueIds) {
      const document = this.deps.repos.documents.getById(id)
      if (!document) {
        failed++
        continue
      }
      try {
        const source = this.storedPdfPathOf(document)
        if (destination.kind === 'file') {
          await copyAndVerifyReplacing(source, destination.path, document.sha256)
        } else {
          await this.copyDocumentToDirectory(document, source, destination.path)
        }
        saved++
      } catch (err) {
        failed++
        this.deps.log.warn('document_copy_failed', {
          documentId: id,
          code:
            (err as NodeJS.ErrnoException).code ??
            (err instanceof Error ? err.message : 'unknown')
        })
      }
    }
    this.deps.log.info('document_copies_saved', { saved, failed })
    return { canceled: false, saved, failed }
  }

  private async copyDocumentToDirectory(
    document: TaxDocument,
    source: string,
    directory: string
  ): Promise<void> {
    for (let attempt = 1; attempt <= COPY_COLLISION_ATTEMPTS; attempt++) {
      const filename = withCollisionSuffix(document.storedFilename, attempt)
      const destination = resolveInside(directory, filename)
      try {
        await copyAndVerify(source, destination, document.sha256)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EEXIST' || code === 'EISDIR') continue
        throw err
      }
    }
    throw new Error('save_copy_failed')
  }

  async restore(id: string): Promise<void> {
    const doc = this.getOrThrow(id)
    if (!doc.deletedAt) return
    const paths = dataPaths(this.deps.dataDir)
    const trashPath = path.join(paths.documentsTrash, `${doc.id}__${doc.storedFilename}`)
    let next: TaxDocument = { ...doc, deletedAt: null }
    try {
      await fsp.access(trashPath)
      const targetAbs = this.absolutePathOf(doc)
      try {
        await atomicMove(trashPath, targetAbs)
      } catch {
        // original slot occupied → place under a suffixed name
        next = await this.relocateFromTrash(next, trashPath)
      }
    } catch {
      // no trash file (already gone) — restore the record anyway
      this.deps.log.warn('restore_missing_trash_file', { documentId: id })
    }
    this.deps.repos.documents.update(next)
    this.deps.repos.audit.append({
      documentId: id,
      eventType: 'restore',
      previousValue: { deletedAt: doc.deletedAt },
      nextValue: { deletedAt: null },
      source: 'user'
    })
  }

  private async relocateFromTrash(doc: TaxDocument, trashPath: string): Promise<TaxDocument> {
    const relDir = documentRelativeDir(doc.taxPeriodYear, doc.taxPeriodQuarter, doc.direction)
    for (let attempt = 2; attempt <= 50; attempt++) {
      const filename = withCollisionSuffix(doc.storedFilename, attempt)
      const abs = resolveInside(this.deps.dataDir, relDir, filename)
      try {
        await fsp.access(abs)
        continue
      } catch {
        await atomicMove(trashPath, abs)
        return {
          ...doc,
          storedFilename: filename,
          storedRelativePath: path.join(relDir, filename).split(path.sep).join('/')
        }
      }
    }
    throw new Error('restore_failed')
  }

  async getPdfBytes(id: string): Promise<Buffer> {
    const doc = this.getOrThrow(id)
    try {
      return await fsp.readFile(this.storedPdfPathOf(doc))
    } catch {
      throw new Error('file_missing')
    }
  }
}
