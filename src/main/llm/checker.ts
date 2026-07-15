/**
 * Local LLM extraction double-checker: FIFO queue (concurrency 1) over
 * document ids, lazy node-llama-cpp runtime that unloads after 90s idle.
 *
 * HARD PRODUCT RULES enforced here:
 *  - the model NEVER overwrites an extracted value; mergeVerdict only moves
 *    confidences and attaches reviewable 'llm_disagreement' issues
 *  - everything degrades to a no-op when the model is not ready
 *  - no document content ever reaches a network; inference is fully local
 *  - failures are logged with stable codes only and never crash the app
 */
import {
  buildCheckPrompt,
  buildOutputSchema,
  mergeVerdict,
  parseModelOutput,
  LLM_MODEL_NAME
} from '@core/llm/verdict'
import type { LlmCheckResult, LlmStatus, TaxDocument } from '@shared/domain'
import type {
  GbnfJsonObjectSchema,
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaGrammar,
  LlamaModel
} from 'node-llama-cpp'
import type { Repositories } from '../db/repository'
import type { Logger } from '../log'
import type { LlmModelManager } from './model-manager'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_IDLE_UNLOAD_MS = 90_000
const CONTEXT_SIZE = 4096
const MAX_TOKENS = 700

/** Injectable inference function so tests never load the real model. */
export type LlmInfer = (prompt: string, signal: AbortSignal) => Promise<string>

export interface LlmCheckerDeps {
  repos: Repositories
  manager: LlmModelManager
  log: Logger
  /** called on queue changes and after each finished document (llmProgress) */
  notify: () => void
  /** test injection points */
  infer?: LlmInfer
  timeoutMs?: number
  idleUnloadMs?: number
}

interface LlmRuntime {
  llama: Llama
  model: LlamaModel
  context: LlamaContext
  session: LlamaChatSession
  grammar: LlamaGrammar
}

export class LlmChecker {
  private readonly queue: string[] = []
  private processing: string | null = null
  private running = false
  private disposed = false

  private runtime: LlmRuntime | null = null
  private runtimePromise: Promise<LlmRuntime> | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: LlmCheckerDeps) {}

  // -- status -----------------------------------------------------------------

  isReady(): boolean {
    return !this.disposed && this.deps.manager.isReady()
  }

  getStatus(): LlmStatus {
    return {
      ...this.deps.manager.statusSnapshot(),
      queueLength: this.queue.length + (this.processing !== null ? 1 : 0)
    }
  }

  // -- queue ------------------------------------------------------------------

  /** Queue one document; false when it is not checkable or already queued. */
  enqueue(id: string): boolean {
    if (this.disposed) return false
    if (this.processing === id || this.queue.includes(id)) return false
    const doc = this.deps.repos.documents.getById(id)
    if (!this.isCheckable(doc)) return false
    this.queue.push(id)
    this.clearIdleTimer()
    this.deps.notify()
    this.pump()
    return true
  }

  enqueueMany(ids: string[]): { queued: number; skipped: number } {
    let queued = 0
    for (const id of ids) {
      if (this.enqueue(id)) queued++
    }
    return { queued, skipped: ids.length - queued }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.queue.length = 0
    this.clearIdleTimer()
    this.deps.manager.cancelDownload()
    await this.unloadRuntime()
  }

  // -- internals ---------------------------------------------------------------

  private isCheckable(doc: TaxDocument | null): doc is TaxDocument {
    return (
      doc !== null &&
      doc.deletedAt === null &&
      doc.reviewStatus !== 'confirmed' &&
      typeof doc.extractedText === 'string' &&
      doc.extractedText.trim() !== ''
    )
  }

  private pump(): void {
    if (this.running || this.disposed) return
    const id = this.queue.shift()
    if (id === undefined) {
      this.scheduleIdleUnload()
      return
    }
    this.running = true
    this.processing = id
    void this.checkOne(id)
      .catch((err) => {
        this.deps.log.warn('llm_check_failed', {
          documentId: id,
          code: err instanceof Error ? err.message : 'unknown'
        })
      })
      .finally(() => {
        this.running = false
        this.processing = null
        // emit after each finished doc so the renderer can refetch
        this.deps.notify()
        this.pump()
      })
  }

  private async checkOne(id: string): Promise<void> {
    const doc = this.deps.repos.documents.getById(id)
    if (!this.isCheckable(doc)) return

    const startedAt = Date.now()
    const prompt = buildCheckPrompt(doc)

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error('llm_check_timeout')),
      this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    timer.unref()
    let raw: string
    try {
      raw = await this.infer(prompt, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) {
        this.deps.log.warn('llm_check_timeout', { documentId: id })
      } else {
        this.deps.log.warn('llm_infer_failed', {
          documentId: id,
          code: err instanceof Error ? err.message : 'unknown'
        })
      }
      return
    } finally {
      clearTimeout(timer)
    }

    const fields = parseModelOutput(raw)
    if (fields === null || Object.keys(fields).length === 0) {
      this.deps.log.warn('llm_output_unparseable', { documentId: id })
      return
    }

    const result: LlmCheckResult = {
      documentId: id,
      model: LLM_MODEL_NAME,
      fields,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString()
    }

    // reload: the document may have been edited/confirmed during inference
    const fresh = this.deps.repos.documents.getById(id)
    if (!this.isCheckable(fresh)) return

    const merge = mergeVerdict(fresh, result)
    if (merge.changed) {
      // read-modify-write the raw JSON object; spreading keeps every existing
      // key (including vatClassification) intact
      const rawJson: Record<string, unknown> =
        typeof fresh.extractionRawJson === 'object' && fresh.extractionRawJson !== null
          ? { ...(fresh.extractionRawJson as Record<string, unknown>) }
          : {}
      rawJson['llmCheck'] = result
      // mergeVerdict returns the COMPLETE updated issue list (it replaces
      // stale llm_disagreement entries in place) — assign, never append
      const issues = merge.newIssues
      const next: TaxDocument = {
        ...fresh,
        fieldConfidence: merge.fieldConfidence,
        issues,
        reviewReasons: [...new Set(issues.map((i) => i.code))],
        extractionRawJson: rawJson
      }
      this.deps.repos.documents.update(next)
    }

    const agrees: Record<string, boolean> = {}
    for (const [field, verdict] of Object.entries(fields)) agrees[field] = verdict.agrees
    this.deps.repos.audit.append({
      documentId: id,
      eventType: 'llm_check',
      nextValue: { model: result.model, agrees, durationMs: result.durationMs },
      source: 'system'
    })
    this.deps.log.info('llm_check_completed', {
      documentId: id,
      changed: merge.changed,
      durationMs: result.durationMs
    })
  }

  private infer(prompt: string, signal: AbortSignal): Promise<string> {
    if (this.deps.infer) return this.deps.infer(prompt, signal)
    return this.inferWithRuntime(prompt, signal)
  }

  private async inferWithRuntime(prompt: string, signal: AbortSignal): Promise<string> {
    const runtime = await this.loadRuntime()
    return runtime.session.prompt(prompt, {
      grammar: runtime.grammar,
      maxTokens: MAX_TOKENS,
      temperature: 0,
      signal,
      stopOnAbortSignal: false
    })
  }

  private loadRuntime(): Promise<LlmRuntime> {
    this.runtimePromise ??= this.doLoadRuntime()
    return this.runtimePromise
  }

  private async doLoadRuntime(): Promise<LlmRuntime> {
    try {
      const { getLlama, LlamaChatSession: ChatSession } = await import('node-llama-cpp')
      const llama = await getLlama()
      const model = await llama.loadModel({ modelPath: this.deps.manager.modelPath })
      const context = await model.createContext({ contextSize: CONTEXT_SIZE })
      const session = new ChatSession({ contextSequence: context.getSequence() })
      const grammar = await llama.createGrammarForJsonSchema(
        buildOutputSchema() as GbnfJsonObjectSchema<string>
      )
      const runtime: LlmRuntime = { llama, model, context, session, grammar }
      this.runtime = runtime
      this.deps.log.info('llm_runtime_loaded')
      return runtime
    } catch (err) {
      this.runtimePromise = null
      this.deps.log.error('llm_model_load_failed', {
        name: err instanceof Error ? err.name : typeof err
      })
      // a machine that cannot load the model degrades to 'unsupported'
      this.deps.manager.markLoadUnsupported()
      this.queue.length = 0
      throw new Error('llm_model_load_failed')
    }
  }

  private scheduleIdleUnload(): void {
    if (this.runtime === null && this.runtimePromise === null) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      void this.unloadRuntime()
    }, this.deps.idleUnloadMs ?? DEFAULT_IDLE_UNLOAD_MS)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private async unloadRuntime(): Promise<void> {
    const pending = this.runtimePromise
    this.runtimePromise = null
    if (pending !== null && this.runtime === null) {
      // a load is still in flight — wait for it so we can dispose cleanly
      await pending.catch(() => undefined)
    }
    const runtime = this.runtime
    this.runtime = null
    if (runtime === null) return
    try {
      runtime.session.dispose()
      await runtime.context.dispose()
      await runtime.model.dispose()
      this.deps.log.info('llm_runtime_unloaded')
    } catch {
      this.deps.log.warn('llm_runtime_unload_failed')
    }
  }
}
