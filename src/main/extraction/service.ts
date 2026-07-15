/**
 * Extraction service: owns a pool of exactly one extraction worker,
 * serializes jobs through a FIFO queue and consults the per-page OCR cache
 * before running OCR.
 */
import { Worker } from 'node:worker_threads'
import type { Logger } from '../log'
import type { OcrCacheRepository } from '../db/repository'
import type {
  ExtractionJobRequest,
  ExtractionJobResponse,
  OcrJobResult,
  OcrPageResult,
  ValidateTextResult,
  WorkerBootData
} from './protocol'

/** A page whose native text layer is shorter than this needs OCR. */
export const OCR_TEXT_THRESHOLD = 30

export interface DocumentTextPage {
  page: number
  text: string
  source: 'native' | 'ocr' | 'ocr_failed'
  ocrConfidence: number | null
}

export interface DocumentTextResult {
  pageCount: number
  pages: DocumentTextPage[]
  fullText: string
  ocrUsed: boolean
  ocrPages: number[]
  ocrFailedPages: number[]
  /** average OCR confidence 0..1 over successfully OCR'd pages, or null */
  ocrConfidence: number | null
}

interface PendingJob {
  resolve(value: unknown): void
  reject(err: Error): void
  onProgress?: (page: number, of: number) => void
}

export interface ExtractionServiceOptions {
  workerPath: string
  tessdataDir: string
  tessCachePath: string
  ocrCache: OcrCacheRepository
  log: Logger
}

export class ExtractionService {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingJob>()
  private queueTail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: ExtractionServiceOptions) {}

  // -- worker lifecycle -----------------------------------------------------

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const bootData: WorkerBootData = {
      tessdataDir: this.options.tessdataDir,
      tessCachePath: this.options.tessCachePath
    }
    const worker = new Worker(this.options.workerPath, { workerData: bootData })
    worker.on('message', (msg: ExtractionJobResponse) => this.onMessage(msg))
    worker.on('error', (err) => {
      this.options.log.error('extraction_worker_error', { name: err.name })
      this.failAllPending('extraction_worker_crashed')
      this.worker = null
    })
    worker.on('exit', (code) => {
      if (code !== 0 && !this.disposed) {
        this.options.log.warn('extraction_worker_exit', { code })
        this.failAllPending('extraction_worker_crashed')
      }
      if (this.worker === worker) this.worker = null
    })
    this.worker = worker
    return worker
  }

  private onMessage(msg: ExtractionJobResponse): void {
    const job = this.pending.get(msg.id)
    if (!job) return
    if (msg.kind === 'progress') {
      job.onProgress?.(msg.page, msg.of)
      return
    }
    this.pending.delete(msg.id)
    if (msg.kind === 'ok') job.resolve(msg.result)
    else job.reject(new Error(msg.errorKey))
  }

  private failAllPending(errorKey: string): void {
    for (const [id, job] of this.pending) {
      this.pending.delete(id)
      job.reject(new Error(errorKey))
    }
  }

  private run<T>(
    build: (id: number) => ExtractionJobRequest,
    onProgress?: (page: number, of: number) => void
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('extraction_service_disposed'))
    const execute = (): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = this.nextId++
        this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
        try {
          this.ensureWorker().postMessage(build(id))
        } catch (err) {
          this.pending.delete(id)
          reject(err instanceof Error ? err : new Error('extraction_worker_crashed'))
        }
      })
    // pool of exactly 1: chain onto the queue tail
    const result = this.queueTail.then(execute, execute)
    this.queueTail = result.catch(() => undefined)
    return result
  }

  // -- public API -----------------------------------------------------------

  /** Open + validate a PDF and return its native text layer per page. */
  validateAndText(pdfPath: string): Promise<ValidateTextResult> {
    return this.run<ValidateTextResult>((id) => ({ id, kind: 'validate_text', pdfPath }))
  }

  /**
   * OCR the given pages (1-based), using the cache where possible.
   * Cache key: `<sha256>:<page>`.
   */
  async ocrPages(
    pdfPath: string,
    sha256: string,
    pages: number[],
    onProgress?: (page: number, of: number) => void
  ): Promise<OcrPageResult[]> {
    const results = new Map<number, OcrPageResult>()
    const uncached: number[] = []
    for (const page of pages) {
      const cached = this.options.ocrCache.get(`${sha256}:${page}`)
      if (cached) {
        results.set(page, {
          page,
          text: cached.text,
          confidence: cached.confidence,
          failed: false
        })
      } else {
        uncached.push(page)
      }
    }
    if (uncached.length > 0) {
      const jobResult = await this.run<OcrJobResult>(
        (id) => ({ id, kind: 'ocr', pdfPath, pages: uncached }),
        onProgress
      )
      for (const pageResult of jobResult.pages) {
        results.set(pageResult.page, pageResult)
        if (!pageResult.failed) {
          this.options.ocrCache.put(
            `${sha256}:${pageResult.page}`,
            pageResult.text,
            pageResult.confidence
          )
        }
      }
    }
    return pages.map(
      (page) =>
        results.get(page) ?? { page, text: '', confidence: null, failed: true }
    )
  }

  /**
   * Full text of a document: native text where present, OCR for pages whose
   * native text layer is too short (< OCR_TEXT_THRESHOLD chars).
   */
  async extractDocumentText(
    pdfPath: string,
    sha256: string,
    onProgress?: (page: number, of: number) => void
  ): Promise<DocumentTextResult> {
    const native = await this.validateAndText(pdfPath)
    const needsOcr: number[] = []
    for (let i = 0; i < native.pageCount; i++) {
      if ((native.pages[i] ?? '').trim().length < OCR_TEXT_THRESHOLD) {
        needsOcr.push(i + 1)
      }
    }

    const ocrResults = new Map<number, OcrPageResult>()
    if (needsOcr.length > 0) {
      const ocr = await this.ocrPages(pdfPath, sha256, needsOcr, onProgress)
      for (const r of ocr) ocrResults.set(r.page, r)
    }

    const pages: DocumentTextPage[] = []
    const ocrPages: number[] = []
    const ocrFailedPages: number[] = []
    const confidences: number[] = []
    for (let pageNo = 1; pageNo <= native.pageCount; pageNo++) {
      const ocr = ocrResults.get(pageNo)
      if (ocr && !ocr.failed) {
        pages.push({
          page: pageNo,
          text: ocr.text,
          source: 'ocr',
          ocrConfidence: ocr.confidence
        })
        ocrPages.push(pageNo)
        if (ocr.confidence !== null) confidences.push(ocr.confidence)
      } else if (ocr && ocr.failed) {
        pages.push({
          page: pageNo,
          text: native.pages[pageNo - 1] ?? '',
          source: 'ocr_failed',
          ocrConfidence: null
        })
        ocrFailedPages.push(pageNo)
      } else {
        pages.push({
          page: pageNo,
          text: native.pages[pageNo - 1] ?? '',
          source: 'native',
          ocrConfidence: null
        })
      }
    }

    const avgConfidence =
      confidences.length > 0
        ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) /
          1000
        : null

    return {
      pageCount: native.pageCount,
      pages,
      fullText: pages.map((p) => p.text).join('\n\n'),
      ocrUsed: ocrPages.length > 0,
      ocrPages,
      ocrFailedPages,
      ocrConfidence: avgConfidence
    }
  }

  /** Render page 1 to a 360px-wide PNG at outPath. */
  thumbnail(pdfPath: string, outPath: string): Promise<void> {
    return this.run<{ ok: true }>((id) => ({ id, kind: 'thumbnail', pdfPath, outPath })).then(
      () => undefined
    )
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.failAllPending('extraction_service_disposed')
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }
  }
}
