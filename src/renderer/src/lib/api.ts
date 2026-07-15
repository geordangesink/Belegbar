/**
 * Thin typed access to the preload bridge plus error → i18n key mapping.
 * The renderer never talks to Node/Electron directly.
 */
import type { BelegbarApi } from '@shared/api'

export function api(): BelegbarApi {
  return window.belegbar
}

const KNOWN_ERROR_KEYS = new Set([
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
  'critical_issues'
])

/**
 * Maps an unknown error (IPC rejection) to an i18n key. Main reports errors
 * either as issue codes or as 'issues.<code>' keys; anything else → generic.
 */
export function errorToKey(err: unknown): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof (err as { errorKey?: unknown })?.errorKey === 'string'
          ? String((err as { errorKey: string }).errorKey)
          : ''
  const match = /issues\.([a-z0-9_]+)/.exec(raw)
  if (match && KNOWN_ERROR_KEYS.has(match[1] ?? '')) return `issues.${match[1]}`
  for (const code of KNOWN_ERROR_KEYS) {
    if (raw.includes(code)) return `issues.${code}`
  }
  return 'errors.generic'
}

/** Normalizes an issue key: accepts bare codes or full 'issues.x' keys. */
export function issueMessageKey(codeOrKey: string): string {
  return codeOrKey.startsWith('issues.') ? codeOrKey : `issues.${codeOrKey}`
}
