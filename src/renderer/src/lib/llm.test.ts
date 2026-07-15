import { describe, expect, it } from 'vitest'
import { CHECKED_FIELDS } from '@core/llm/verdict'
import de from '../locales/de.json'
import en from '../locales/en.json'
import {
  bytesToMb,
  getLlmCheck,
  llmDisagreementCount,
  llmFieldLabelKey,
  llmReasonKey
} from './llm'

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    return acc !== null && typeof acc === 'object'
      ? (acc as Record<string, unknown>)[part]
      : undefined
  }, tree)
}

describe('llmFieldLabelKey', () => {
  it('maps every checked field onto an existing review.* label in de and en', () => {
    for (const field of CHECKED_FIELDS) {
      const key = llmFieldLabelKey(field)
      expect(key, field).not.toBeNull()
      expect(typeof lookup(de as Record<string, unknown>, key as string), `de ${key}`).toBe(
        'string'
      )
      expect(typeof lookup(en as Record<string, unknown>, key as string), `en ${key}`).toBe(
        'string'
      )
    }
  })

  it('falls back to null for unknown fields', () => {
    expect(llmFieldLabelKey('somethingElse')).toBeNull()
    expect(llmFieldLabelKey('')).toBeNull()
  })
})

describe('getLlmCheck', () => {
  it('returns null for missing/malformed payloads', () => {
    expect(getLlmCheck(null)).toBeNull()
    expect(getLlmCheck(undefined)).toBeNull()
    expect(getLlmCheck('raw')).toBeNull()
    expect(getLlmCheck({})).toBeNull()
    expect(getLlmCheck({ llmCheck: null })).toBeNull()
    expect(getLlmCheck({ llmCheck: 'x' })).toBeNull()
    expect(getLlmCheck({ llmCheck: {} })).toBeNull()
    expect(getLlmCheck({ llmCheck: { fields: null } })).toBeNull()
  })

  it('parses field verdicts and skips malformed entries', () => {
    const check = getLlmCheck({
      llmCheck: {
        model: 'qwen',
        fields: {
          invoiceDate: { agrees: true, suggested: null },
          netAmountOriginal: { agrees: false, suggested: '119,00' },
          broken: { agrees: 'yes' }
        }
      }
    })
    expect(check).not.toBeNull()
    expect(Object.keys(check?.fields ?? {}).sort()).toEqual(['invoiceDate', 'netAmountOriginal'])
    expect(check ? llmDisagreementCount(check) : -1).toBe(1)
  })

  it('counts zero disagreements when all fields agree', () => {
    const check = getLlmCheck({
      llmCheck: {
        fields: {
          invoiceDate: { agrees: true, suggested: null },
          currency: { agrees: true, suggested: null }
        }
      }
    })
    expect(check ? llmDisagreementCount(check) : -1).toBe(0)
  })
})

describe('llmReasonKey', () => {
  it('prefixes bare codes and keeps full keys', () => {
    expect(llmReasonKey('llm_unsupported_ram')).toBe('errors.llm_unsupported_ram')
    expect(llmReasonKey('errors.llm_download_failed')).toBe('errors.llm_download_failed')
    expect(llmReasonKey(null)).toBe('errors.generic')
  })
})

describe('bytesToMb', () => {
  it('rounds to whole megabytes and never goes negative', () => {
    expect(bytesToMb(0)).toBe(0)
    expect(bytesToMb(1024 * 1024)).toBe(1)
    expect(bytesToMb(986 * 1024 * 1024 + 400000)).toBe(986)
    expect(bytesToMb(-5)).toBe(0)
  })
})
