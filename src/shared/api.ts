/**
 * The typed API surface exposed to the renderer via contextBridge as
 * `window.belegbar`. Preload implements it; the renderer consumes it.
 */
import type {
  AppSettings,
  LlmStatus,
  AuditEvent,
  DeleteDocumentsResult,
  DocumentDirection,
  ImportFileProgress,
  IncomeTaxEstimate,
  OverviewSummary,
  TaxDocument,
  TaxPeriod,
  VatSummary
} from './domain'
import type { ImportFilesPayload, UpdateDocumentPayload, UpdateSettingsPayload } from './ipc'

export interface DocumentListResult {
  documents: TaxDocument[]
  total: number
}

export interface ImportStartResult {
  importId: string
  accepted: { path: string; fileId: string }[]
  rejected: { path: string; reasonKey: string }[]
}

export interface BackupResult {
  ok: boolean
  path?: string
  errorKey?: string
}

export interface ExportResult {
  ok: boolean
  path?: string
  errorKey?: string
}

export interface SaveDocumentCopiesResult {
  canceled: boolean
  saved: number
  failed: number
}

export interface BelegbarApi {
  // import
  importFiles(payload: ImportFilesPayload): Promise<ImportStartResult>
  onImportProgress(cb: (p: ImportFileProgress) => void): () => void
  retryImport(fileId: string): Promise<void>
  dismissImport(importId: string): Promise<void>
  /** open native file picker, returns chosen pdf paths */
  chooseFiles(direction: DocumentDirection): Promise<string[]>
  /**
   * Resolve the absolute path of a dropped File (Electron webUtils).
   * Synchronous; returns '' when the file has no filesystem path.
   */
  getPathForFile(file: File): string

  // documents
  listDocuments(filter: Record<string, unknown>): Promise<DocumentListResult>
  getDocument(id: string): Promise<TaxDocument | null>
  updateDocument(payload: UpdateDocumentPayload): Promise<TaxDocument>
  confirmDocument(id: string): Promise<TaxDocument>
  setPaymentDate(payload: {
    ids: string[]
    mode: 'date' | 'invoice_date' | 'not_paid' | 'unknown'
    date?: string
  }): Promise<void>
  setDirection(payload: { ids: string[]; direction: DocumentDirection }): Promise<void>
  setVatTreatment(payload: { id: string; code: string; reason?: string }): Promise<TaxDocument>
  /**
   * Re-run text extraction, parsing and classification on stored documents
   * (e.g. after a parser upgrade). Confirmed documents and user-corrected
   * fields are left untouched; returns how many documents changed.
   */
  reExtractDocuments(ids: string[]): Promise<{ updated: number; skipped: number }>
  mergeDocuments(payload: { primaryId: string; sourceIds: string[] }): Promise<TaxDocument>
  deleteDocument(id: string, mode?: 'trash' | 'hard'): Promise<void>
  deleteDocuments(ids: string[], mode?: 'trash' | 'hard'): Promise<DeleteDocumentsResult>
  emptyTrash(): Promise<DeleteDocumentsResult>
  restoreDocument(id: string): Promise<void>
  saveDocumentCopies(ids: string[]): Promise<SaveDocumentCopiesResult>
  /** returns the PDF bytes for in-app preview */
  getDocumentPdf(id: string): Promise<ArrayBuffer>
  revealDocument(id: string): Promise<void>
  openDocumentExternal(id: string): Promise<void>
  getAuditTrail(id: string): Promise<AuditEvent[]>

  // summaries
  getOverview(period: TaxPeriod): Promise<OverviewSummary>
  getVatSummary(period: TaxPeriod): Promise<VatSummary>
  getIncomeTaxEstimate(year: number): Promise<IncomeTaxEstimate>

  // settings
  getSettings(): Promise<AppSettings>
  updateSettings(patch: UpdateSettingsPayload): Promise<AppSettings>

  // data
  createBackup(): Promise<BackupResult>
  restoreBackup(): Promise<BackupResult>
  exportPeriod(payload: {
    period: TaxPeriod
    format: 'csv' | 'json' | 'zip' | 'summary'
  }): Promise<ExportResult>
  openDataFolder(): Promise<void>
  getSystemLocale(): Promise<string>

  // local LLM extraction checker (opt-in; document text never leaves the device)
  getLlmStatus(): Promise<LlmStatus>
  /** start (or resume) the model download; progress arrives via onLlmProgress */
  downloadLlmModel(): Promise<void>
  cancelLlmDownload(): Promise<void>
  removeLlmModel(): Promise<void>
  /** queue documents for an LLM double-check; results update the documents */
  runLlmCheck(ids: string[]): Promise<{ queued: number; skipped: number }>
  onLlmProgress(cb: (status: LlmStatus) => void): () => void
}

declare global {
  interface Window {
    belegbar: BelegbarApi
  }
}
