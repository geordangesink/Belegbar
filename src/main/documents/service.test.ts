import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DocumentIssue, TaxDocument } from '@shared/domain'
import {
  DocumentService,
  invalidateFieldEvidence,
  isIssueResolved,
  syncCoreIssues
} from './service'
import type { Repositories } from '../db/repository'
import { nullLogger } from '../log'

function issue(code: string, field?: string): DocumentIssue {
  return {
    code,
    severity: code === 'llm_disagreement' ? 'warning' : 'critical',
    messageKey: `issues.${code}`,
    ...(field ? { field } : {})
  }
}

function doc(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return {
    invoiceDate: '2026-07-01',
    originalCurrency: 'EUR',
    netAmountOriginal: 100,
    vatAmountOriginal: 19,
    grossAmountOriginal: 119,
    fieldConfidence: {},
    extractionRawJson: null,
    issues: [],
    reviewReasons: [],
    ...overrides
  } as TaxDocument
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

describe('invalidateFieldEvidence', () => {
  it('removes direct and aliased evidence only for manually changed fields', () => {
    const result = invalidateFieldEvidence(
      doc({
        fieldConfidence: {
          currency: 0.6,
          originalCurrency: 0.7,
          netAmount: 0.7,
          description: 0.6
        },
        issues: [
          issue('llm_disagreement', 'currency'),
          issue('llm_disagreement', 'description')
        ],
        extractionRawJson: {
          llmCheck: {
            checkedAt: '2026-07-01T10:00:00.000Z',
            fields: {
              currency: { agrees: true, suggested: null },
              netAmountOriginal: { agrees: true, suggested: null },
              description: { agrees: false, suggested: 'Hosting' }
            }
          }
        }
      }),
      ['originalCurrency', 'netAmountOriginal']
    )

    expect(result.fieldConfidence).toEqual({ description: 0.6 })
    expect(result.issues).toEqual([issue('llm_disagreement', 'description')])
    expect(
      (result.extractionRawJson as {
        llmCheck: { fields: Record<string, unknown> }
      }).llmCheck.fields
    ).toEqual({ description: { agrees: false, suggested: 'Hosting' } })
  })
})

describe('core issue reconciliation', () => {
  it('recognizes the parser issue codes and field aliases used in production', () => {
    expect(isIssueResolved(issue('missing_amount', 'grossAmount'), doc())).toBe(true)
    expect(isIssueResolved(issue('unknown_currency', 'currency'), doc())).toBe(true)
    expect(isIssueResolved(issue('conflicting_totals', 'grossAmount'), doc())).toBe(true)
    expect(
      isIssueResolved(
        issue('conflicting_totals', 'grossAmount'),
        doc({ grossAmountOriginal: 125 })
      )
    ).toBe(false)
  })

  it('adds critical targets when required values are manually cleared', () => {
    const result = syncCoreIssues(
      doc({
        invoiceDate: null,
        originalCurrency: null,
        netAmountOriginal: null,
        grossAmountOriginal: null
      })
    )
    expect(result.issues.map(({ code, field }) => ({ code, field }))).toEqual([
      { code: 'missing_invoice_date', field: 'invoiceDate' },
      { code: 'unknown_currency', field: 'currency' },
      { code: 'missing_amount', field: 'grossAmount' }
    ])
  })

  it('requires a critical exchange rate for every non-EUR amount, including USDT', () => {
    const result = syncCoreIssues(
      doc({
        originalCurrency: 'USDT',
        exchangeRateToEur: null,
        issues: [
          {
            code: 'missing_exchange_rate',
            severity: 'warning',
            messageKey: 'issues.missing_exchange_rate',
            field: 'exchangeRateToEur'
          }
        ]
      })
    )
    expect(result.issues).toContainEqual({
      code: 'missing_exchange_rate',
      severity: 'critical',
      messageKey: 'issues.missing_exchange_rate',
      field: 'exchangeRateToEur'
    })
    expect(result.reviewReasons).toContain('missing_exchange_rate')
  })

  it('does not require an exchange rate for EUR or a converted foreign amount', () => {
    expect(syncCoreIssues(doc()).issues).toEqual([])
    expect(
      syncCoreIssues(doc({ originalCurrency: 'USD', exchangeRateToEur: 0.92 })).issues
    ).toEqual([])
  })

  it('removes an old missing-rate issue once a manual rate is present', () => {
    const missingRate = issue('missing_exchange_rate', 'exchangeRateToEur')
    const withRate = doc({
      originalCurrency: 'USDT',
      exchangeRateToEur: 0.92,
      exchangeRateSource: 'manual',
      issues: [missingRate]
    })
    expect(isIssueResolved(missingRate, withRate)).toBe(true)
    expect(syncCoreIssues(withRate).issues).toEqual([])
  })
})

describe('VAT treatment acceptance', () => {
  it('clears the stale rationale, stores the override, and invalidates confirmation', async () => {
    let stored = doc({
      id: 'doc-1',
      direction: 'expense',
      deletedAt: null,
      reviewStatus: 'confirmed',
      userConfirmedAt: '2026-07-01T10:00:00.000Z',
      reviewReasons: ['vat_classification_unconfirmed', 'refund_detected']
    })
    let classification: unknown
    const repos = {
      documents: {
        getById: () => stored,
        update: (next: TaxDocument, nextClassification?: unknown) => {
          stored = next
          classification = nextClassification
          return next
        }
      },
      audit: { append: () => undefined }
    } as unknown as Repositories
    const service = new DocumentService({ dataDir: '/tmp', repos, log: nullLogger })

    const result = await service.setVatTreatment('doc-1', 'DE_EXPENSE_NO_INPUT_VAT')

    expect(result.reviewReasons).toEqual(['refund_detected'])
    expect(result.reviewStatus).toBe('needs_review')
    expect(result.userConfirmedAt).toBeNull()
    expect(classification).toMatchObject({
      code: 'DE_EXPENSE_NO_INPUT_VAT',
      manualOverride: true,
      requiresUserConfirmation: false
    })
  })

  it('rejects unresolved and direction-incompatible choices', async () => {
    const stored = doc({ id: 'doc-1', direction: 'expense', deletedAt: null })
    const repos = {
      documents: { getById: () => stored },
      audit: { append: () => undefined }
    } as unknown as Repositories
    const service = new DocumentService({ dataDir: '/tmp', repos, log: nullLogger })

    await expect(service.setVatTreatment('doc-1', 'UNKNOWN_REVIEW')).rejects.toThrow(
      'invalid_treatment_code'
    )
    await expect(service.setVatTreatment('doc-1', 'DE_DOMESTIC_19')).rejects.toThrow(
      'invalid_treatment_code'
    )
  })
})

describe('document deletion', () => {
  it('deletes every selected active document and continues past failures', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-delete-'))
    try {
      const first = doc({
        id: '11111111-1111-4111-8111-111111111111',
        storedFilename: 'first.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/first.pdf',
        deletedAt: null,
        reviewStatus: 'needs_review'
      })
      const second = doc({
        id: '22222222-2222-4222-8222-222222222222',
        storedFilename: 'second.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/second.pdf',
        deletedAt: null,
        reviewStatus: 'confirmed'
      })
      const stored = new Map([
        [first.id, first],
        [second.id, second]
      ])
      for (const document of stored.values()) {
        const filePath = path.join(dataDir, document.storedRelativePath)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, document.id)
      }
      const repos = {
        documents: {
          getById: (id: string) => stored.get(id) ?? null,
          update: (next: TaxDocument) => {
            stored.set(next.id, next)
            return next
          },
          hardDelete: (id: string) => stored.delete(id)
        },
        audit: { append: () => undefined }
      } as unknown as Repositories
      const service = new DocumentService({ dataDir, repos, log: nullLogger })

      const result = await service.deleteMany(
        [
          first.id,
          '33333333-3333-4333-8333-333333333333',
          second.id,
          first.id
        ],
        'trash'
      )

      expect(result).toEqual({ deleted: 2, skipped: 0, failed: 1 })
      expect(stored.get(first.id)?.deletedAt).not.toBeNull()
      expect(stored.get(second.id)?.deletedAt).not.toBeNull()
      expect(
        fs.existsSync(path.join(dataDir, 'documents', '.trash', `${first.id}__first.pdf`))
      ).toBe(true)
      expect(
        fs.existsSync(path.join(dataDir, 'documents', '.trash', `${second.id}__second.pdf`))
      ).toBe(true)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('empties trashed documents globally without touching active documents', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-empty-trash-'))
    try {
      const active = doc({
        id: '11111111-1111-4111-8111-111111111111',
        storedFilename: 'active.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/active.pdf',
        deletedAt: null
      })
      const first = doc({
        id: '22222222-2222-4222-8222-222222222222',
        storedFilename: 'first.pdf',
        storedRelativePath: 'documents/2025/Q4/expense/first.pdf',
        deletedAt: '2026-07-15T10:00:00.000Z'
      })
      const second = doc({
        id: '33333333-3333-4333-8333-333333333333',
        storedFilename: 'second.pdf',
        storedRelativePath: 'documents/2026/Q2/income/second.pdf',
        deletedAt: '2026-07-15T11:00:00.000Z'
      })
      const stored = new Map([
        [active.id, active],
        [first.id, first],
        [second.id, second]
      ])
      const trashDir = path.join(dataDir, 'documents', '.trash')
      const thumbnailsDir = path.join(dataDir, 'thumbnails')
      fs.mkdirSync(trashDir, { recursive: true })
      fs.mkdirSync(thumbnailsDir, { recursive: true })
      for (const document of [first, second]) {
        fs.writeFileSync(
          path.join(trashDir, `${document.id}__${document.storedFilename}`),
          document.id
        )
        fs.writeFileSync(path.join(thumbnailsDir, `${document.id}.png`), document.id)
      }
      const repos = {
        documents: {
          getById: (id: string) => stored.get(id) ?? null,
          listAllTrashed: () => [...stored.values()].filter((item) => item.deletedAt !== null),
          hardDelete: (id: string) => stored.delete(id)
        },
        audit: {
          append: () => {
            throw new Error('audit unavailable')
          }
        }
      } as unknown as Repositories
      const service = new DocumentService({ dataDir, repos, log: nullLogger })

      const result = await service.emptyTrash()

      expect(result).toEqual({ deleted: 2, skipped: 0, failed: 0 })
      expect([...stored.keys()]).toEqual([active.id])
      expect(fs.existsSync(path.join(trashDir, `${first.id}__first.pdf`))).toBe(false)
      expect(fs.existsSync(path.join(trashDir, `${second.id}__second.pdf`))).toBe(false)
      expect(fs.existsSync(path.join(thumbnailsDir, `${first.id}.png`))).toBe(false)
      expect(fs.existsSync(path.join(thumbnailsDir, `${second.id}.png`))).toBe(false)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('document copies', () => {
  it('copies active and trashed PDFs with collision suffixes and deduplicates IDs', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-copy-many-'))
    try {
      const activeContent = 'active pdf'
      const trashedContent = 'trashed pdf'
      const active = doc({
        id: '11111111-1111-4111-8111-111111111111',
        storedFilename: 'invoice.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/invoice.pdf',
        sha256: sha256(activeContent),
        deletedAt: null
      })
      const trashed = doc({
        id: '22222222-2222-4222-8222-222222222222',
        storedFilename: 'invoice.pdf',
        storedRelativePath: 'documents/2025/Q4/income/invoice.pdf',
        sha256: sha256(trashedContent),
        deletedAt: '2026-07-15T10:00:00.000Z'
      })
      const activePath = path.join(dataDir, active.storedRelativePath)
      const trashPath = path.join(
        dataDir,
        'documents',
        '.trash',
        `${trashed.id}__${trashed.storedFilename}`
      )
      const destination = path.join(dataDir, 'copies')
      fs.mkdirSync(path.dirname(activePath), { recursive: true })
      fs.mkdirSync(path.dirname(trashPath), { recursive: true })
      fs.mkdirSync(destination, { recursive: true })
      fs.writeFileSync(activePath, activeContent)
      fs.writeFileSync(trashPath, trashedContent)
      fs.writeFileSync(path.join(destination, 'invoice.pdf'), 'existing')

      const stored = new Map([
        [active.id, active],
        [trashed.id, trashed]
      ])
      const repos = {
        documents: { getById: (id: string) => stored.get(id) ?? null }
      } as unknown as Repositories
      const service = new DocumentService({ dataDir, repos, log: nullLogger })

      const result = await service.saveDocumentCopies(
        [active.id, trashed.id, active.id],
        { kind: 'directory', path: destination }
      )

      expect(result).toEqual({ canceled: false, saved: 2, failed: 0 })
      expect(fs.readFileSync(path.join(destination, 'invoice.pdf'), 'utf8')).toBe(
        'existing'
      )
      expect(fs.readFileSync(path.join(destination, 'invoice-2.pdf'), 'utf8')).toBe(
        activeContent
      )
      expect(fs.readFileSync(path.join(destination, 'invoice-3.pdf'), 'utf8')).toBe(
        trashedContent
      )
      expect(fs.readFileSync(activePath, 'utf8')).toBe(activeContent)
      expect(fs.readFileSync(trashPath, 'utf8')).toBe(trashedContent)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('safely replaces a chosen destination from a trashed PDF', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-copy-one-'))
    try {
      const content = 'trash source'
      const document = doc({
        id: '11111111-1111-4111-8111-111111111111',
        storedFilename: 'invoice.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/invoice.pdf',
        sha256: sha256(content),
        deletedAt: '2026-07-15T10:00:00.000Z'
      })
      const source = path.join(
        dataDir,
        'documents',
        '.trash',
        `${document.id}__${document.storedFilename}`
      )
      const destination = path.join(dataDir, 'chosen.pdf')
      fs.mkdirSync(path.dirname(source), { recursive: true })
      fs.writeFileSync(source, content)
      fs.writeFileSync(destination, 'replace me')
      const repos = {
        documents: { getById: () => document }
      } as unknown as Repositories
      const service = new DocumentService({ dataDir, repos, log: nullLogger })

      const result = await service.saveDocumentCopies([document.id], {
        kind: 'file',
        path: destination
      })

      expect(result).toEqual({ canceled: false, saved: 1, failed: 0 })
      expect(fs.readFileSync(destination, 'utf8')).toBe(content)
      expect(fs.readFileSync(source, 'utf8')).toBe(content)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('continues past missing and unverifiable sources without leaving partial copies', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-copy-partial-'))
    try {
      const good = doc({
        id: '11111111-1111-4111-8111-111111111111',
        storedFilename: 'good.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/good.pdf',
        sha256: sha256('good'),
        deletedAt: null
      })
      const missing = doc({
        id: '22222222-2222-4222-8222-222222222222',
        storedFilename: 'missing.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/missing.pdf',
        sha256: sha256('missing'),
        deletedAt: null
      })
      const unverifiable = doc({
        id: '33333333-3333-4333-8333-333333333333',
        storedFilename: 'bad.pdf',
        storedRelativePath: 'documents/2026/Q3/expense/bad.pdf',
        sha256: sha256('expected'),
        deletedAt: null
      })
      const goodPath = path.join(dataDir, good.storedRelativePath)
      const badPath = path.join(dataDir, unverifiable.storedRelativePath)
      const destination = path.join(dataDir, 'copies')
      fs.mkdirSync(path.dirname(goodPath), { recursive: true })
      fs.mkdirSync(destination, { recursive: true })
      fs.writeFileSync(goodPath, 'good')
      fs.writeFileSync(badPath, 'different')
      const stored = new Map([
        [good.id, good],
        [missing.id, missing],
        [unverifiable.id, unverifiable]
      ])
      const repos = {
        documents: { getById: (id: string) => stored.get(id) ?? null }
      } as unknown as Repositories
      const service = new DocumentService({ dataDir, repos, log: nullLogger })

      const result = await service.saveDocumentCopies(
        [good.id, missing.id, unverifiable.id],
        { kind: 'directory', path: destination }
      )

      expect(result).toEqual({ canceled: false, saved: 1, failed: 2 })
      expect(fs.readFileSync(path.join(destination, 'good.pdf'), 'utf8')).toBe('good')
      expect(fs.existsSync(path.join(destination, 'missing.pdf'))).toBe(false)
      expect(fs.existsSync(path.join(destination, 'bad.pdf'))).toBe(false)
      expect(fs.readFileSync(goodPath, 'utf8')).toBe('good')
      expect(fs.readFileSync(badPath, 'utf8')).toBe('different')
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
