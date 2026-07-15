/**
 * Local LLM model manager: download / resume / cancel / remove / validate the
 * Qwen 2.5 1.5B Instruct GGUF used by the extraction double-checker.
 *
 * PRIVACY: this is the ONLY place in the LLM feature that ever touches the
 * network, and the only request it makes is the model download from Hugging
 * Face. No document data is ever part of any request.
 *
 * Electron-free and fully injectable (fetch, totalmem, expected size) so the
 * whole state machine is testable without network access.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LlmModelState, LlmStatus } from '@shared/domain'
import type { Logger } from '../log'

export const LLM_MODEL_FILE_NAME = 'qwen2.5-1.5b-instruct-q4_k_m.gguf'

/**
 * Exact size of qwen2.5-1.5b-instruct-q4_k_m.gguf in the official
 * Qwen/Qwen2.5-1.5B-Instruct-GGUF repository, verified against the Hugging
 * Face API (tree/main) on 2026-07-15.
 */
export const LLM_MODEL_EXPECTED_BYTES = 1_117_320_736

export const LLM_MODEL_DOWNLOAD_URL =
  `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/${LLM_MODEL_FILE_NAME}`

/** Completed download may deviate at most this fraction from the expected size. */
const SIZE_TOLERANCE = 0.02

/** Minimum total system RAM to run the checker at all. */
const MIN_TOTAL_MEM_BYTES = 6 * 1024 * 1024 * 1024 // 6 GiB

const GGUF_MAGIC = 'GGUF'

/** Progress notifications are throttled to roughly this interval (~4/s). */
const DEFAULT_PROGRESS_INTERVAL_MS = 250

// ---------------------------------------------------------------------------
// injectable fetch (kept minimal so tests can fake it without undici types)
// ---------------------------------------------------------------------------

export interface DownloadResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: AsyncIterable<Uint8Array> | null
}

export type FetchLike = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<DownloadResponse>

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init)
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body as unknown as AsyncIterable<Uint8Array> | null
  }
}

// ---------------------------------------------------------------------------

export type LlmManagerStatus = Omit<LlmStatus, 'queueLength'>

export interface LlmModelManagerDeps {
  dataDir: string
  log: Logger
  /** called on every state/progress change; the composer re-emits LlmStatus */
  notify: () => void
  /** test injection points */
  fetchImpl?: FetchLike
  totalMemBytes?: () => number
  expectedModelBytes?: number
  progressIntervalMs?: number
}

export class LlmModelManager {
  private state: LlmModelState = 'not_downloaded'
  private reasonKey: string | null = null
  private downloadedBytes = 0
  private totalBytes: number
  private modelSizeBytes = 0

  private readonly expectedBytes: number
  private readonly fetchImpl: FetchLike
  private readonly progressIntervalMs: number
  private lastProgressEmit = 0

  private abortController: AbortController | null = null
  private currentDownload: Promise<void> | null = null

  constructor(private readonly deps: LlmModelManagerDeps) {
    this.expectedBytes = deps.expectedModelBytes ?? LLM_MODEL_EXPECTED_BYTES
    this.fetchImpl = deps.fetchImpl ?? defaultFetch
    this.progressIntervalMs = deps.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
    this.totalBytes = this.expectedBytes

    const totalMem = (deps.totalMemBytes ?? os.totalmem)()
    if (totalMem < MIN_TOTAL_MEM_BYTES) {
      this.state = 'unsupported'
      this.reasonKey = 'llm_unsupported_ram'
      return
    }
    this.refreshFromDiskSync()
  }

  // -- paths ------------------------------------------------------------------

  private get modelsDir(): string {
    return path.join(this.deps.dataDir, 'models')
  }

  get modelPath(): string {
    return path.join(this.modelsDir, LLM_MODEL_FILE_NAME)
  }

  private get partPath(): string {
    return `${this.modelPath}.part`
  }

  // -- status -------------------------------------------------------------------

  isReady(): boolean {
    return this.state === 'ready'
  }

  statusSnapshot(): LlmManagerStatus {
    return {
      state: this.state,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      reasonKey: this.reasonKey,
      modelFileName: LLM_MODEL_FILE_NAME,
      modelSizeBytes: this.modelSizeBytes
    }
  }

  /**
   * Called by the checker when the first model load blows up (missing CPU
   * features, broken native binding, …): the feature degrades to 'unsupported'.
   */
  markLoadUnsupported(): void {
    this.state = 'unsupported'
    this.reasonKey = 'llm_unsupported_cpu'
    this.deps.log.warn('llm_marked_unsupported', { reasonKey: this.reasonKey })
    this.deps.notify()
  }

  // -- download -------------------------------------------------------------

  /**
   * Start (or resume) the model download. Never rejects: every failure is
   * captured in the state machine and surfaced via llmProgress events.
   */
  startDownload(): Promise<void> {
    if (this.state === 'downloading') return this.currentDownload ?? Promise.resolve()
    if (this.state === 'ready' || this.state === 'unsupported') {
      this.deps.notify()
      return Promise.resolve()
    }
    const download = this.runDownload()
      .catch(() => {
        // runDownload handles its own errors; this is belt-and-braces
        this.state = 'error'
        this.reasonKey = 'llm_download_failed'
        this.deps.notify()
      })
      .finally(() => {
        this.currentDownload = null
        this.abortController = null
      })
    this.currentDownload = download
    return download
  }

  cancelDownload(): void {
    if (this.state !== 'downloading') return
    this.abortController?.abort()
  }

  async removeModel(): Promise<void> {
    this.abortController?.abort()
    if (this.currentDownload) await this.currentDownload.catch(() => undefined)
    await fsp.rm(this.modelPath, { force: true }).catch(() => undefined)
    await fsp.rm(this.partPath, { force: true }).catch(() => undefined)
    this.modelSizeBytes = 0
    this.downloadedBytes = 0
    this.totalBytes = this.expectedBytes
    if (this.state !== 'unsupported') {
      this.state = 'not_downloaded'
      this.reasonKey = null
    }
    this.deps.log.info('llm_model_removed')
    this.deps.notify()
  }

  // -- internals ------------------------------------------------------------

  private async runDownload(): Promise<void> {
    const controller = new AbortController()
    this.abortController = controller
    this.state = 'downloading'
    this.reasonKey = null
    this.totalBytes = this.expectedBytes

    await fsp.mkdir(this.modelsDir, { recursive: true })

    let offset = 0
    try {
      offset = (await fsp.stat(this.partPath)).size
    } catch {
      offset = 0
    }
    this.downloadedBytes = offset
    this.emitProgress(true)

    const headers: Record<string, string> = {}
    if (offset > 0) headers['Range'] = `bytes=${offset}-`

    let response: DownloadResponse
    try {
      response = await this.fetchImpl(LLM_MODEL_DOWNLOAD_URL, {
        headers,
        signal: controller.signal
      })
    } catch {
      if (controller.signal.aborted) return this.finishCancelled()
      return this.failDownload('fetch_failed', false)
    }
    if (controller.signal.aborted) return this.finishCancelled()

    if (offset > 0 && response.status === 200) {
      // server ignored the Range header — restart from scratch
      offset = 0
      this.downloadedBytes = 0
      await fsp.rm(this.partPath, { force: true }).catch(() => undefined)
    }
    if (!response.ok || response.body === null) {
      return this.failDownload(`http_${response.status}`, false)
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 0) {
      this.totalBytes = offset + contentLength
    }

    const stream = fs.createWriteStream(this.partPath, {
      flags: offset > 0 ? 'a' : 'w'
    })
    try {
      for await (const chunk of response.body) {
        if (controller.signal.aborted) break
        await writeChunk(stream, chunk)
        this.downloadedBytes += chunk.byteLength
        this.emitProgress()
      }
    } catch {
      await closeStream(stream)
      if (controller.signal.aborted) return this.finishCancelled()
      return this.failDownload('stream_failed', false)
    }
    await closeStream(stream)
    if (controller.signal.aborted) return this.finishCancelled()

    // validation on completion: GGUF magic + size within tolerance
    const validSize = await this.validModelSize(this.partPath)
    if (validSize === null) {
      return this.failDownload('validation_failed', true)
    }
    try {
      await fsp.rename(this.partPath, this.modelPath)
    } catch {
      return this.failDownload('rename_failed', true)
    }
    this.modelSizeBytes = validSize
    this.downloadedBytes = validSize
    this.state = 'ready'
    this.reasonKey = null
    this.deps.log.info('llm_model_download_completed', { bytes: validSize })
    this.deps.notify()
  }

  private finishCancelled(): void {
    this.state = 'not_downloaded'
    this.reasonKey = null
    this.deps.log.info('llm_download_cancelled')
    this.deps.notify()
  }

  private async failDownload(code: string, corrupt: boolean): Promise<void> {
    if (corrupt) {
      // a corrupt file must never be picked up by a later resume
      await fsp.rm(this.partPath, { force: true }).catch(() => undefined)
      await fsp.rm(this.modelPath, { force: true }).catch(() => undefined)
      this.downloadedBytes = 0
    }
    this.state = 'error'
    this.reasonKey = 'llm_download_failed'
    this.deps.log.warn('llm_download_failed', { code })
    this.deps.notify()
  }

  private emitProgress(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastProgressEmit < this.progressIntervalMs) return
    this.lastProgressEmit = now
    this.deps.notify()
  }

  /** size when the file has the GGUF magic and a size within tolerance, else null */
  private async validModelSize(file: string): Promise<number | null> {
    let size: number
    try {
      size = (await fsp.stat(file)).size
    } catch {
      return null
    }
    if (!this.sizeWithinTolerance(size)) return null
    let handle: fsp.FileHandle | null = null
    try {
      handle = await fsp.open(file, 'r')
      const magic = Buffer.alloc(4)
      await handle.read(magic, 0, 4, 0)
      if (magic.toString('latin1') !== GGUF_MAGIC) return null
      return size
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private sizeWithinTolerance(size: number): boolean {
    return (
      size >= this.expectedBytes * (1 - SIZE_TOLERANCE) &&
      size <= this.expectedBytes * (1 + SIZE_TOLERANCE)
    )
  }

  private refreshFromDiskSync(): void {
    try {
      const stat = fs.statSync(this.modelPath, { throwIfNoEntry: false })
      if (stat) {
        if (this.sizeWithinTolerance(stat.size) && this.hasGgufMagicSync(this.modelPath)) {
          this.state = 'ready'
          this.modelSizeBytes = stat.size
          this.downloadedBytes = stat.size
          return
        }
        // invalid file on disk: remove so a fresh download can replace it
        fs.rmSync(this.modelPath, { force: true })
        this.deps.log.warn('llm_model_invalid_on_disk')
      }
      const part = fs.statSync(this.partPath, { throwIfNoEntry: false })
      this.downloadedBytes = part?.size ?? 0
      this.state = 'not_downloaded'
    } catch {
      this.state = 'not_downloaded'
    }
  }

  private hasGgufMagicSync(file: string): boolean {
    let fd: number | null = null
    try {
      fd = fs.openSync(file, 'r')
      const magic = Buffer.alloc(4)
      fs.readSync(fd, magic, 0, 4, 0)
      return magic.toString('latin1') === GGUF_MAGIC
    } catch {
      return false
    } finally {
      if (fd !== null) fs.closeSync(fd)
    }
  }
}

// ---------------------------------------------------------------------------

function writeChunk(stream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()))
  })
}

function closeStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => resolve())
  })
}
