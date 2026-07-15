/**
 * worker_threads worker: PDF validation + text extraction (pdfjs legacy),
 * OCR (@napi-rs/canvas render → tesseract.js) and thumbnail generation.
 *
 * Heavy work stays off the Electron main thread; jobs arrive as messages
 * (see ./protocol.ts). One job runs at a time (the service serializes).
 */
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import type {
  ExtractionJobRequest,
  ExtractionJobResponse,
  OcrJobResult,
  OcrPageResult,
  ValidateTextResult,
  WorkerBootData
} from './protocol'

const OCR_DPI = 220
const PDF_UNITS_PER_INCH = 72
const THUMBNAIL_WIDTH = 360

const boot = workerData as WorkerBootData

if (!parentPort) {
  throw new Error('extraction-worker must run as a worker thread')
}
const port = parentPort

function post(message: ExtractionJobResponse): void {
  port.postMessage(message)
}

// ---------------------------------------------------------------------------
// pdfjs (legacy build for Node)
// ---------------------------------------------------------------------------

interface CanvasAndContext {
  canvas: Canvas | null
  context: ReturnType<Canvas['getContext']> | null
}

/** pdfjs 4.x instantiates this class itself: new CanvasFactory({enableHWA}) */
class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)))
    return { canvas, context: canvas.getContext('2d') }
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) throw new Error('canvas not set')
    canvasAndContext.canvas.width = Math.max(1, Math.floor(width))
    canvasAndContext.canvas.height = Math.max(1, Math.floor(height))
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (!canvasAndContext.canvas) return
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjsPromise: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

function pdfjsAssetUrl(subdir: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('pdfjs-dist/package.json')
    return path.join(path.dirname(pkg), subdir) + path.sep
  } catch {
    return undefined
  }
}

async function openPdf(pdfPath: string) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await fs.readFile(pdfPath))
  return pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
    CanvasFactory: NodeCanvasFactory
  }).promise
}

function classifyPdfError(err: unknown, fallback: string): string {
  const name = (err as { name?: string } | null)?.name
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (name === 'PasswordException') return 'password_protected'
  if (name === 'InvalidPDFException') return 'corrupt_pdf'
  if (code === 'ENOENT') return 'file_missing'
  return fallback
}

// ---------------------------------------------------------------------------
// Text extraction with light spacing heuristics
// ---------------------------------------------------------------------------

interface TextItemLike {
  str?: string
  hasEOL?: boolean
  transform?: number[]
}

function joinTextItems(items: TextItemLike[]): string {
  let text = ''
  let lastY: number | null = null
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const y = item.transform?.[5] ?? null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      if (!text.endsWith('\n')) text += '\n'
    } else if (text !== '' && !text.endsWith('\n') && !text.endsWith(' ') && item.str !== '') {
      text += ' '
    }
    text += item.str
    if (item.hasEOL) {
      text += '\n'
      lastY = null
      continue
    }
    lastY = y
  }
  return text.trim()
}

async function runValidateText(pdfPath: string): Promise<ValidateTextResult> {
  const doc = await openPdf(pdfPath)
  try {
    const pages: string[] = []
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      pages.push(joinTextItems(content.items as TextItemLike[]))
      page.cleanup()
    }
    return { pageCount: doc.numPages, pages }
  } finally {
    await doc.destroy()
  }
}

// ---------------------------------------------------------------------------
// Rendering + OCR
// ---------------------------------------------------------------------------

async function renderPageToPng(
  doc: Awaited<ReturnType<typeof openPdf>>,
  pageNo: number,
  targetWidth: number | null
): Promise<Buffer> {
  const page = await doc.getPage(pageNo)
  try {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale =
      targetWidth !== null
        ? targetWidth / baseViewport.width
        : OCR_DPI / PDF_UNITS_PER_INCH
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height))
    )
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      // @napi-rs/canvas context is API-compatible with the DOM 2D context
      // (tsconfig.node has no DOM lib, so cast through the render params type)
      canvasContext: context,
      viewport
    } as unknown as Parameters<typeof page.render>[0]).promise
    return canvas.toBuffer('image/png')
  } finally {
    page.cleanup()
  }
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>
let tesseractPromise: Promise<TesseractWorker> | null = null

function getTesseract(): Promise<TesseractWorker> {
  tesseractPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js')
    await fs.mkdir(boot.tessCachePath, { recursive: true })
    return createWorker(['deu', 'eng'], undefined, {
      langPath: boot.tessdataDir,
      gzip: true,
      cachePath: boot.tessCachePath
    })
  })()
  return tesseractPromise
}

async function runOcr(
  id: number,
  pdfPath: string,
  pages: number[]
): Promise<OcrJobResult> {
  const doc = await openPdf(pdfPath)
  try {
    const results: OcrPageResult[] = []
    let done = 0
    for (const pageNo of pages) {
      post({ id, kind: 'progress', page: pageNo, of: pages.length })
      try {
        if (pageNo < 1 || pageNo > doc.numPages) throw new Error('page_out_of_range')
        const png = await renderPageToPng(doc, pageNo, null)
        const tesseract = await getTesseract()
        const { data } = await tesseract.recognize(png)
        results.push({
          page: pageNo,
          text: (data.text ?? '').trim(),
          confidence:
            typeof data.confidence === 'number'
              ? Math.round((data.confidence / 100) * 1000) / 1000
              : null,
          failed: false
        })
      } catch {
        results.push({ page: pageNo, text: '', confidence: null, failed: true })
      }
      done++
      post({ id, kind: 'progress', page: done, of: pages.length })
    }
    return { pages: results }
  } finally {
    await doc.destroy()
  }
}

async function runThumbnail(pdfPath: string, outPath: string): Promise<void> {
  const doc = await openPdf(pdfPath)
  try {
    const png = await renderPageToPng(doc, 1, THUMBNAIL_WIDTH)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, png)
  } finally {
    await doc.destroy()
  }
}

// ---------------------------------------------------------------------------
// Job loop
// ---------------------------------------------------------------------------

port.on('message', (raw: ExtractionJobRequest) => {
  void (async () => {
    try {
      if (raw.kind === 'validate_text') {
        const result = await runValidateText(raw.pdfPath)
        post({ id: raw.id, kind: 'ok', result })
      } else if (raw.kind === 'ocr') {
        const result = await runOcr(raw.id, raw.pdfPath, raw.pages)
        post({ id: raw.id, kind: 'ok', result })
      } else if (raw.kind === 'thumbnail') {
        await runThumbnail(raw.pdfPath, raw.outPath)
        post({ id: raw.id, kind: 'ok', result: { ok: true } })
      }
    } catch (err) {
      const fallback =
        raw.kind === 'ocr'
          ? 'ocr_failed'
          : raw.kind === 'thumbnail'
            ? 'thumbnail_failed'
            : 'corrupt_pdf'
      post({ id: raw.id, kind: 'error', errorKey: classifyPdfError(err, fallback) })
    }
  })()
})
