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

const MEDIUM_AGREEMENT_CONFIDENCE = 0.85
const HIGH_AGREEMENT_CONFIDENCE = 0.92
const STRONG_DISAGREEMENT_CONFIDENCE = 0.55

const LLM_DISAGREEMENT_CODE = 'llm_disagreement'

/** Checked fields holding money amounts (numeric normalization on merge). */
const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
  'netAmountOriginal',
  'vatAmountOriginal',
  'grossAmountOriginal'
])

/** Checked fields holding calendar dates (date normalization on merge). */
const DATE_FIELDS: ReadonlySet<string> = new Set(['invoiceDate', 'dueDate'])

/** JSON schema forced onto the model output via grammar-constrained sampling. */
export function buildOutputSchema(): object {
  const fieldProperties: Record<string, object> = {}
  for (const field of CHECKED_FIELDS) {
    fieldProperties[field] = {
      type: 'object',
      properties: {
        agrees: { type: 'boolean' },
        suggested: { type: ['string', 'null'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] }
      },
      required: ['agrees', 'suggested', 'confidence']
    }
  }
  return {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        properties: fieldProperties,
        required: [...CHECKED_FIELDS]
      }
    },
    required: ['fields']
  }
}

const DEFAULT_MAX_TEXT_CHARS = 6000
const TRUNCATION_MARKER = '\n…\n'

/**
 * Truncates the middle of long invoice text, keeping the first 4/5 and the
 * last 1/5 of the budget — totals and payment terms live at the end.
 */
function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const headLength = Math.floor((maxChars * 4) / 5)
  const tailLength = maxChars - headLength
  return (
    text.slice(0, headLength) + TRUNCATION_MARKER + text.slice(text.length - tailLength)
  )
}

/** Reads the candidate value for a checked field off the document. */
function docFieldValue(doc: TaxDocument, field: string): unknown {
  // the checker calls it 'currency'; the document stores 'originalCurrency'
  if (field === 'currency') return doc.originalCurrency
  return (doc as unknown as Record<string, unknown>)[field]
}

function formatCandidate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(not extracted)'
  return String(value)
}

/**
 * Builds the chat prompt: instruction + truncated invoice text + the
 * deterministically extracted candidate values.
 */
export function buildCheckPrompt(
  doc: TaxDocument,
  maxChars: number = DEFAULT_MAX_TEXT_CHARS
): string {
  const text = truncateMiddle(doc.extractedText ?? '', maxChars)
  const candidates = CHECKED_FIELDS.map(
    (field) => `${field}: ${formatCandidate(docFieldValue(doc, field))}`
  ).join('\n')
  return [
    'You verify fields extracted from an invoice. Compare each candidate to the ' +
      'invoice text. agrees=true when the candidate is correct (allow formatting ' +
      'differences: date formats, thousand separators, currency symbols, case, ' +
      'minor OCR noise). When wrong or missing, agrees=false and put the correct ' +
      "value from the text in 'suggested' (null if not present in the text). " +
      "Set confidence to low, medium, or high for how certain you are about that verdict.",
    'Invoice text:\n"""\n' + text + '\n"""',
    'Candidates:\n' + candidates,
    'Return only a JSON object with a verdict for every candidate field.'
  ].join('\n\n')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse + sanity-validate raw (schema-constrained) model output. */
export function parseModelOutput(raw: string): Record<string, LlmFieldVerdict> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  const fields = parsed['fields']
  if (!isPlainObject(fields)) return null

  const verdicts: Record<string, LlmFieldVerdict> = {}
  for (const field of CHECKED_FIELDS) {
    const entry = fields[field]
    if (!isPlainObject(entry)) continue
    const agrees = entry['agrees']
    if (typeof agrees !== 'boolean') continue
    const suggestedRaw = entry['suggested']
    if (suggestedRaw !== null && suggestedRaw !== undefined && typeof suggestedRaw !== 'string') {
      continue
    }
    const confidence = entry['confidence']
    if (
      confidence !== undefined &&
      confidence !== 'low' &&
      confidence !== 'medium' &&
      confidence !== 'high'
    ) {
      continue
    }
    verdicts[field] = {
      agrees,
      suggested: typeof suggestedRaw === 'string' ? suggestedRaw : null,
      ...(confidence ? { confidence } : {})
    }
  }
  return verdicts
}

export interface VerdictMergeResult {
  /** updated field confidence map */
  fieldConfidence: Record<string, number>
  /**
   * full updated issue list for the document: doc.issues with one
   * 'llm_disagreement' per conflicting field added (older ones replaced
   * in place — never duplicated). Assign it to doc.issues as-is.
   */
  newIssues: DocumentIssue[]
  /** normalized verdicts actually used for calibration */
  verdicts?: Record<string, LlmFieldVerdict>
  /** true when at least one field changed confidence or gained an issue */
  changed: boolean
}

/** Rounds to 2 decimal places (money comparison granularity). */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Tiny tolerant amount parser: strips currency symbols/codes and resolves
 * German ("1.234,56") vs English ("1,234.56") separators. Null when the
 * string does not read as a number.
 */
function parseAmount(rawInput: string): number | null {
  let cleaned = rawInput.replace(/[^\d.,+-]/g, '')
  if (!/\d/.test(cleaned)) return null
  const sign = cleaned.includes('-') ? -1 : 1
  cleaned = cleaned.replace(/[+-]/g, '')
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  let normalized: string
  if (lastDot !== -1 && lastComma !== -1) {
    // both separators present: the later one is the decimal separator
    const thousandsSep = lastDot > lastComma ? ',' : '.'
    normalized = cleaned.split(thousandsSep).join('')
    normalized = normalized.replace(',', '.')
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ','
    const parts = cleaned.split(sep)
    const isThousandsSep =
      parts.length > 2 || (parts[parts.length - 1] ?? '').length === 3
    normalized = isThousandsSep ? parts.join('') : parts.join('.')
  } else {
    normalized = cleaned
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? sign * value : null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * Tiny local date normalizer to ISO 'YYYY-MM-DD'. Understands ISO,
 * German D.M.Y (2- or 4-digit year) and US M-D-Y / M/D/Y (falling back to
 * D-M-Y when the first component cannot be a month). Null when unparseable.
 */
function normalizeDate(rawInput: string): string | null {
  const raw = rawInput.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(raw)
  if (m) {
    const year = m[3]!.length <= 2 ? 2000 + Number(m[3]) : Number(m[3])
    return toIsoDate(year, Number(m[2]), Number(m[1]))
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)
  if (m) {
    const first = Number(m[1])
    const second = Number(m[2])
    if (first > 12 && second <= 12) return toIsoDate(Number(m[3]), second, first)
    return toIsoDate(Number(m[3]), first, second)
  }
  return null
}

/**
 * Defends against formatting-only disagreements: a suggestion that is the
 * same number (2dp) or the same calendar date as the extracted value counts
 * as agreement even when the model flagged it.
 */
/** The prompt's marker for absent candidates — models echo it back. */
const NOT_EXTRACTED_MARKER = '(not extracted)'

/**
 * Generic string leveling: case, whitespace, hyphens/underscores and common
 * punctuation collapse to single spaces. Small models flag pure formatting
 * variants ("PJ52DODZ 0005" vs "PJ52DODZ-0005") as disagreements — those
 * must never reach the user.
 */
function levelString(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_.,:;/\\]+/g, ' ')
    .trim()
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  januar: 1, februar: 2, 'märz': 3, mai: 5, juni: 6, juli: 7,
  oktober: 10, dezember: 12,
  jan: 1, feb: 2, mar: 3, 'mär': 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12
}

/** "October 7, 2025" / "7. Oktober 2025" / "7 Oct 2025" → ISO, else null. */
function parseMonthNameDate(raw: string): string | null {
  const mdy = /([A-Za-zäöü]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(raw)
  const dmy = /(\d{1,2})\.?\s+([A-Za-zäöü]+)\.?\s+(\d{4})/.exec(raw)
  let day: number, month: number | undefined, year: number
  if (mdy && MONTH_NAMES[mdy[1]!.toLowerCase()] !== undefined) {
    month = MONTH_NAMES[mdy[1]!.toLowerCase()]
    day = Number(mdy[2])
    year = Number(mdy[3])
  } else if (dmy && MONTH_NAMES[dmy[2]!.toLowerCase()] !== undefined) {
    day = Number(dmy[1])
    month = MONTH_NAMES[dmy[2]!.toLowerCase()]
    year = Number(dmy[3])
  } else {
    return null
  }
  if (month === undefined || day < 1 || day > 31) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function isFormattingOnlyMatch(field: string, docValue: unknown, suggested: string | null): boolean {
  const docEmpty = docValue === null || docValue === undefined || docValue === ''
  const suggestedEmpty =
    suggested === null ||
    suggested.trim() === '' ||
    levelString(suggested) === levelString(NOT_EXTRACTED_MARKER)
  // both sides say "nothing there" → nothing to flag
  if (docEmpty && suggestedEmpty) return true
  if (suggested === null || docEmpty) return false
  if (NUMERIC_FIELDS.has(field)) {
    if (typeof docValue !== 'number') return false
    const parsed = parseAmount(suggested)
    return parsed !== null && round2(parsed) === round2(docValue)
  }
  if (DATE_FIELDS.has(field)) {
    if (typeof docValue !== 'string') return false
    const docIso = normalizeDate(docValue)
    const suggestedIso = normalizeDate(suggested) ?? parseMonthNameDate(suggested)
    return docIso !== null && docIso === suggestedIso
  }
  // everything else: pure formatting differences are agreements
  return levelString(String(docValue)) === levelString(suggested)
}

function isSameDisagreement(existing: DocumentIssue, next: DocumentIssue): boolean {
  return (
    existing.severity === next.severity &&
    existing.messageKey === next.messageKey &&
    existing.params?.field === next.params?.field &&
    existing.params?.suggested === next.params?.suggested
  )
}

/**
 * Merge a model verdict into the document's confidence/issue state.
 *  - medium/high agreement: confidence floor 0.85/0.92
 *  - low-certainty disagreement: recorded only, scanner evidence wins
 *  - actionable disagreement: confidence ceiling 0.55 + reviewable issue
 *  - fields the user corrected manually (no entry in fieldConfidence) are
 *    never touched
 */
export function mergeVerdict(
  doc: TaxDocument,
  result: LlmCheckResult
): VerdictMergeResult {
  const fieldConfidence: Record<string, number> = { ...doc.fieldConfidence }
  const issues: DocumentIssue[] = [...doc.issues]
  const verdicts: Record<string, LlmFieldVerdict> = {}
  let changed = false

  for (const [field, verdict] of Object.entries(result.fields)) {
    // the parser's confidence map keys amounts without the "Original" suffix
    // (netAmount vs TaxDocument.netAmountOriginal) — resolve whichever exists
    const confKey =
      fieldConfidence[field] !== undefined
        ? field
        : field.endsWith('Original') && fieldConfidence[field.slice(0, -8)] !== undefined
          ? field.slice(0, -8)
          : field
    const current = fieldConfidence[confKey]
    // absent from fieldConfidence = user-corrected → never touch
    if (current === undefined) continue

    const agrees =
      verdict.agrees || isFormattingOnlyMatch(field, docFieldValue(doc, field), verdict.suggested)
    const normalizedVerdict: LlmFieldVerdict = { ...verdict, agrees }
    verdicts[field] = normalizedVerdict

    if (agrees) {
      for (let i = issues.length - 1; i >= 0; i--) {
        if (issues[i]?.code === LLM_DISAGREEMENT_CODE && issues[i]?.field === field) {
          issues.splice(i, 1)
          changed = true
        }
      }
      const value = docFieldValue(doc, field)
      const hasCandidate = value !== null && value !== undefined && value !== ''
      const certainty = verdict.confidence ?? 'medium'
      const agreementFloor =
        certainty === 'high'
          ? HIGH_AGREEMENT_CONFIDENCE
          : certainty === 'medium'
            ? MEDIUM_AGREEMENT_CONFIDENCE
            : current
      const next = hasCandidate ? Math.max(current, agreementFloor) : current
      if (next !== current) {
        fieldConfidence[confKey] = next
        changed = true
      }
      continue
    }

    if (verdict.confidence === 'low') {
      for (let i = issues.length - 1; i >= 0; i--) {
        if (issues[i]?.code === LLM_DISAGREEMENT_CODE && issues[i]?.field === field) {
          issues.splice(i, 1)
          changed = true
        }
      }
      continue
    }

    const next = Math.min(current, STRONG_DISAGREEMENT_CONFIDENCE)
    if (next !== current) {
      fieldConfidence[confKey] = next
      changed = true
    }
    const issue: DocumentIssue = {
      code: LLM_DISAGREEMENT_CODE,
      severity: 'warning',
      messageKey: 'issues.llm_disagreement',
      field,
      params: { field, suggested: verdict.suggested ?? '' }
    }
    const existingIndex = issues.findIndex(
      (i) => i.code === LLM_DISAGREEMENT_CODE && i.field === field
    )
    if (existingIndex === -1) {
      issues.push(issue)
      changed = true
    } else if (!isSameDisagreement(issues[existingIndex]!, issue)) {
      issues[existingIndex] = issue
      changed = true
    }
  }

  return { fieldConfidence, newIssues: issues, verdicts, changed }
}
