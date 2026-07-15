/**
 * Local-LLM extraction double-check: prompt construction, the constrained
 * output schema, and the pure merge of a model verdict into a document.
 *
 * Hard rule (product spec): the model NEVER silently overwrites a value.
 * Agreement raises field confidence; disagreement lowers it and attaches a
 * reviewable issue carrying the suggestion. Pure functions only — no
 * node-llama-cpp imports here.
 */
import type {
  DocumentIssue,
  LlmCheckResult,
  LlmFieldVerdict,
  TaxDocument
} from '../../shared/domain'

export const LLM_CHECKER_VERSION = '1.0.0'
export const LLM_MODEL_NAME = 'qwen2.5-1.5b-instruct-q4_k_m'

/** Fields the checker verifies, in prompt order. */
export const CHECKED_FIELDS = [
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'netAmountOriginal',
  'vatAmountOriginal',
  'grossAmountOriginal',
  'issuerName',
  'recipientName',
  'description',
  'dueDate'
] as const
export type CheckedField = (typeof CHECKED_FIELDS)[number]

/** JSON schema forced onto the model output via grammar-constrained sampling. */
export function buildOutputSchema(): object {
  throw new Error('not implemented')
}

/**
 * Builds the chat prompt: instruction + truncated invoice text + the
 * deterministically extracted candidate values.
 */
export function buildCheckPrompt(doc: TaxDocument, maxChars?: number): string {
  throw new Error('not implemented')
}

/** Parse + sanity-validate raw (schema-constrained) model output. */
export function parseModelOutput(raw: string): Record<string, LlmFieldVerdict> | null {
  throw new Error('not implemented')
}

export interface VerdictMergeResult {
  /** updated field confidence map */
  fieldConfidence: Record<string, number>
  /** issues to add (llm_disagreement per conflicting field) */
  newIssues: DocumentIssue[]
  /** true when at least one field changed confidence or gained an issue */
  changed: boolean
}

/**
 * Merge a model verdict into the document's confidence/issue state.
 *  - agreement: confidence = max(current, 0.92)
 *  - disagreement: confidence = min(current, 0.55) + 'llm_disagreement'
 *    warning issue with { field, suggested } params
 *  - fields the user corrected manually (no entry in fieldConfidence) are
 *    never touched
 */
export function mergeVerdict(
  doc: TaxDocument,
  result: LlmCheckResult
): VerdictMergeResult {
  throw new Error('not implemented')
}
