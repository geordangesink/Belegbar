import { describe, expect, it } from 'vitest'
import de from '../locales/de.json'
import en from '../locales/en.json'

const ISSUE_CODES = [
  'missing_invoice_date',
  'missing_amount',
  'conflicting_totals',
  'unknown_currency',
  'non_iso_currency',
  'missing_invoice_number',
  'missing_description',
  'ambiguous_date_format',
  'unclear_recipient_country',
  'unclear_business_status',
  'refund_detected',
  'possibly_not_invoice',
  'ocr_used',
  'duplicate_detected',
  'missing_exchange_rate',
  'password_protected',
  'corrupt_pdf',
  'not_a_pdf',
  'empty_pdf',
  'disk_space',
  'ocr_failed',
  'rename_failed',
  'interrupted',
  'internal_error',
  'invalid_payload',
  'critical_issues',
  'llm_disagreement'
] as const

const LLM_ERROR_CODES = [
  'llm_not_ready',
  'llm_unsupported_ram',
  'llm_unsupported_cpu',
  'llm_download_failed'
] as const

const PROCESSING_STATUSES = [
  'queued',
  'copying',
  'validating',
  'extracting_text',
  'running_ocr',
  'extracting_fields',
  'classifying_tax',
  'saving',
  'completed',
  'completed_with_warnings',
  'failed',
  'duplicate'
] as const

const ATTENTION_LEVELS = ['confirmed', 'ok', 'minor', 'warning', 'critical'] as const

const SELECT_MENU_KEYS = [
  'selectMenuLabel',
  'selectMenuAll',
  'selectMenuConfirmed',
  'selectMenuOk',
  'selectMenuMinor',
  'selectMenuWarning',
  'selectMenuCritical',
  'selectMenuNone'
] as const

const REASON_KEYS = [
  'recognized_payment_date',
  'not_yet_paid',
  'payment_date_missing',
  'recognized_invoice_date',
  'method_unsure',
  'no_date'
] as const

const TREATMENT_CODES = [
  'DE_DOMESTIC_19',
  'DE_DOMESTIC_7',
  'DE_DOMESTIC_0_EXEMPT',
  'DE_EXPENSE_INPUT_VAT',
  'DE_EXPENSE_NO_INPUT_VAT',
  'EU_B2B_REVERSE_CHARGE_REVENUE',
  'THIRD_COUNTRY_B2B_SERVICE',
  'EXPENSE_REVERSE_CHARGE_13B',
  'KLEINUNTERNEHMER',
  'UNKNOWN_REVIEW'
] as const

type Tree = Record<string, unknown>

function flatten(obj: Tree, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') {
      keys.push(...flatten(value as Tree, full))
    } else {
      keys.push(full)
    }
  }
  return keys
}

describe('locale resources', () => {
  const deKeys = new Set(flatten(de as Tree))
  const enKeys = new Set(flatten(en as Tree))

  it('de and en have identical key sets', () => {
    const onlyDe = [...deKeys].filter((k) => !enKeys.has(k))
    const onlyEn = [...enKeys].filter((k) => !deKeys.has(k))
    expect(onlyDe).toEqual([])
    expect(onlyEn).toEqual([])
  })

  it('covers all parser issue codes as issues.<code>', () => {
    for (const code of ISSUE_CODES) {
      expect(deKeys.has(`issues.${code}`), `de issues.${code}`).toBe(true)
      expect(enKeys.has(`issues.${code}`), `en issues.${code}`).toBe(true)
    }
  })

  it('covers all LLM checker error codes as errors.<code>', () => {
    for (const code of LLM_ERROR_CODES) {
      expect(deKeys.has(`errors.${code}`), `de errors.${code}`).toBe(true)
      expect(enKeys.has(`errors.${code}`), `en errors.${code}`).toBe(true)
    }
  })

  it('covers all processing statuses', () => {
    for (const status of PROCESSING_STATUSES) {
      expect(deKeys.has(`processing.${status}`), `processing.${status}`).toBe(true)
    }
  })

  it('covers all attention levels with label and tooltip', () => {
    for (const level of ATTENTION_LEVELS) {
      expect(deKeys.has(`attention.label.${level}`), `de attention.label.${level}`).toBe(true)
      expect(enKeys.has(`attention.label.${level}`), `en attention.label.${level}`).toBe(true)
      expect(deKeys.has(`attention.tooltip.${level}`), `de attention.tooltip.${level}`).toBe(true)
      expect(enKeys.has(`attention.tooltip.${level}`), `en attention.tooltip.${level}`).toBe(true)
    }
  })

  it('covers the documents select menu and bulk-confirm warning', () => {
    for (const key of SELECT_MENU_KEYS) {
      expect(deKeys.has(`documents.${key}`), `de documents.${key}`).toBe(true)
      expect(enKeys.has(`documents.${key}`), `en documents.${key}`).toBe(true)
    }
    for (const key of ['bulkConfirmWarningTitle', 'bulkConfirmWarningBody'] as const) {
      expect(deKeys.has(`documents.${key}`), `de documents.${key}`).toBe(true)
      expect(enKeys.has(`documents.${key}`), `en documents.${key}`).toBe(true)
    }
    for (const key of ['sortLabel', 'sortNewest', 'sortOldest'] as const) {
      expect(deKeys.has(`documents.${key}`), `de documents.${key}`).toBe(true)
      expect(enKeys.has(`documents.${key}`), `en documents.${key}`).toBe(true)
    }
    expect(deKeys.has('import.batchProgress'), 'de import.batchProgress').toBe(true)
    expect(enKeys.has('import.batchProgress'), 'en import.batchProgress').toBe(true)
  })

  it('covers all classification reason keys', () => {
    for (const reason of REASON_KEYS) {
      expect(deKeys.has(`reasons.${reason}`), `reasons.${reason}`).toBe(true)
    }
  })

  it('covers all VAT treatment codes with label and description', () => {
    for (const code of TREATMENT_CODES) {
      expect(deKeys.has(`vat.treatment.${code}`), `vat.treatment.${code}`).toBe(true)
      expect(deKeys.has(`vat.treatmentDesc.${code}`), `vat.treatmentDesc.${code}`).toBe(true)
    }
  })

  it('has no empty strings', () => {
    const check = (tree: Tree, name: string): void => {
      for (const key of flatten(tree)) {
        const value = key.split('.').reduce<unknown>((acc, part) => {
          return acc !== null && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined
        }, tree)
        expect(typeof value === 'string' && value.trim().length > 0, `${name}:${key}`).toBe(true)
      }
    }
    check(de as Tree, 'de')
    check(en as Tree, 'en')
  })
})
