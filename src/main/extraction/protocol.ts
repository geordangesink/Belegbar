/**
 * Message protocol between the extraction service (main thread) and the
 * extraction worker (worker_threads). Keep JSON-serializable.
 */

export interface WorkerBootData {
  /** directory containing deu.traineddata.gz / eng.traineddata.gz */
  tessdataDir: string
  /** writable cache dir for decompressed tesseract language files */
  tessCachePath: string
}

export type ExtractionJobRequest =
  | { id: number; kind: 'validate_text'; pdfPath: string }
  | { id: number; kind: 'ocr'; pdfPath: string; pages: number[] }
  | { id: number; kind: 'thumbnail'; pdfPath: string; outPath: string }

export interface ValidateTextResult {
  pageCount: number
  /** native text layer per page, index 0 = page 1 */
  pages: string[]
}

export interface OcrPageResult {
  page: number
  text: string
  /** 0..1 or null when the page failed */
  confidence: number | null
  failed: boolean
}

export interface OcrJobResult {
  pages: OcrPageResult[]
}

export type ExtractionJobResponse =
  | { id: number; kind: 'ok'; result: ValidateTextResult | OcrJobResult | { ok: true } }
  | { id: number; kind: 'error'; errorKey: string }
  | { id: number; kind: 'progress'; page: number; of: number }
