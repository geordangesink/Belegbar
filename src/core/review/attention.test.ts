import { describe, expect, it } from 'vitest'
import type {
  AttentionLevel,
  DocumentIssue,
  IssueSeverity,
  TaxDocument
} from '../../shared/domain'
import {
  attentionForDocument,
  attentionLevel,
  issueAttention,
  type AttentionInput
} from './attention'

function issue(
  code: string,
  severity: IssueSeverity,
  field?: string,
  params?: Record<string, string | number>
): DocumentIssue {
  return {
    code,
    severity,
    messageKey: `issues.${code}`,
    ...(field ? { field } : {}),
    ...(params ? { params } : {})
  }
}

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    reviewStatus: 'needs_review',
    issues: [],
    fieldConfidence: {},
    ...overrides
  }
}

function llmDisagreement(field: string): DocumentIssue {
  // Mirrors the exact shape produced by core/llm/verdict.ts
  return issue('llm_disagreement', 'warning', field, { field, suggested: 'x' })
}

function doc(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return {
    id: 'doc-1',
    direction: 'expense',
    originalFilename: 'rechnung.pdf',
    storedFilename: '2026-01-15_acme_120-00.pdf',
    storedRelativePath: '2026/2026-01-15_acme_120-00.pdf',
    sha256: 'a'.repeat(64),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: 'RE-2026-001',
    invoiceDate: '2026-01-15',
    serviceDateFrom: null,
    serviceDateTo: null,
    receiptDate: null,
    paymentDate: null,
    dueDate: null,
    paymentStatus: 'unknown',
    issuerName: 'ACME GmbH',
    issuerAddress: null,
    issuerCountryCode: 'DE',
    issuerTaxNumber: null,
    issuerVatId: 'DE123456789',
    recipientName: 'Geordan Gesink',
    recipientAddress: null,
    recipientCountryCode: 'DE',
    recipientTaxNumber: null,
    recipientVatId: null,
    recipientIsBusiness: true,
    description: 'Hosting',
    expenseCategory: null,
    originalCurrency: 'EUR',
    netAmountOriginal: 100,
    vatAmountOriginal: 19,
    grossAmountOriginal: 119,
    exchangeRateToEur: 1,
    exchangeRateDate: null,
    exchangeRateSource: null,
    netAmountEur: 100,
    vatAmountEur: 19,
    grossAmountEur: 119,
    vatRates: [],
    vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
    vatTreatmentLabel: null,
    vatLegalBasis: null,
    taxPeriodYear: 2026,
    taxPeriodQuarter: 1,
    taxPeriodMonth: 1,
    extractedText: 'Rechnung',
    extractionProvider: 'pdf-text',
    extractionVersion: '1.0.0',
    extractionConfidence: 0.95,
    fieldConfidence: {
      invoiceNumber: 0.95,
      invoiceDate: 0.95,
      currency: 0.99,
      grossAmountOriginal: 0.95,
      netAmountOriginal: 0.95,
      vatAmountOriginal: 0.95
    },
    extractionRawJson: null,
    reviewStatus: 'needs_review',
    reviewReasons: [],
    issues: [],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides
  }
}

describe('attentionLevel — rule 1: confirmed shortcut', () => {
  it("returns 'confirmed' for a clean confirmed document", () => {
    expect(attentionLevel(input({ reviewStatus: 'confirmed' }))).toBe('confirmed')
  })

  it("returns 'confirmed' even when critical issues, uncertain confidences and the VAT flag are present", () => {
    expect(
      attentionLevel(
        input({
          reviewStatus: 'confirmed',
          issues: [issue('conflicting_totals', 'critical', 'grossAmount')],
          fieldConfidence: { grossAmountOriginal: 0.2 },
          vatRequiresConfirmation: true
        })
      )
    ).toBe('confirmed')
  })
})

describe('attentionLevel — rule 2: failed shortcut', () => {
  it("returns 'critical' for a failed document without any issues", () => {
    expect(attentionLevel(input({ reviewStatus: 'failed' }))).toBe('critical')
  })

  it("returns 'critical' for failed even when everything else looks fine", () => {
    expect(
      attentionLevel(
        input({ reviewStatus: 'failed', fieldConfidence: { invoiceDate: 0.99 } })
      )
    ).toBe('critical')
  })
})

describe('attentionLevel — rule 3: critical issues', () => {
  it("maps a critical-severity issue to 'critical'", () => {
    expect(
      attentionLevel(input({ issues: [issue('missing_amount', 'critical', 'grossAmount')] }))
    ).toBe('critical')
  })

  it('critical beats warning beats minor (all three present)', () => {
    expect(
      attentionLevel(
        input({
          issues: [
            issue('missing_invoice_number', 'warning', 'invoiceNumber'), // minor tier
            issue('missing_exchange_rate', 'warning', 'exchangeRateToEur'), // warning tier
            issue('conflicting_totals', 'critical', 'grossAmount') // critical tier
          ]
        })
      )
    ).toBe('critical')
  })

  it('critical wins regardless of issue order', () => {
    expect(
      attentionLevel(
        input({
          issues: [
            issue('conflicting_totals', 'critical', 'grossAmount'),
            issue('missing_exchange_rate', 'warning', 'exchangeRateToEur')
          ]
        })
      )
    ).toBe('critical')
  })

  it('critical wins over the VAT confirmation flag and uncertain confidences', () => {
    expect(
      attentionLevel(
        input({
          issues: [issue('missing_amount', 'critical', 'grossAmount')],
          vatRequiresConfirmation: true,
          fieldConfidence: { description: 0.4 }
        })
      )
    ).toBe('critical')
  })
})

describe('attentionLevel — rule 4: warning issues and VAT confirmation', () => {
  it("maps a tax-relevant warning issue to 'warning'", () => {
    expect(
      attentionLevel(
        input({ issues: [issue('missing_exchange_rate', 'warning', 'exchangeRateToEur')] })
      )
    ).toBe('warning')
  })

  it('every tax-relevant warning code maps to warning', () => {
    const codes = [
      'missing_exchange_rate',
      'non_iso_currency',
      'possible_duplicate',
      'refund_detected',
      'possibly_not_invoice',
      'unclear_business_status',
      'unclear_recipient_country',
      'ambiguous_date_format'
    ]
    for (const code of codes) {
      expect(attentionLevel(input({ issues: [issue(code, 'warning')] })), code).toBe('warning')
    }
  })

  it("vatRequiresConfirmation alone forces 'warning'", () => {
    expect(attentionLevel(input({ vatRequiresConfirmation: true }))).toBe('warning')
  })

  it('vatRequiresConfirmation false or absent does not force warning', () => {
    expect(attentionLevel(input({ vatRequiresConfirmation: false }))).toBe('ok')
    expect(attentionLevel(input())).toBe('ok')
  })

  it('warning beats minor (warning + minor issues together)', () => {
    expect(
      attentionLevel(
        input({
          issues: [
            issue('missing_invoice_number', 'warning', 'invoiceNumber'), // minor tier
            issue('possible_duplicate', 'warning') // warning tier
          ]
        })
      )
    ).toBe('warning')
  })

  it('warning issue wins over merely-minor confidence values', () => {
    expect(
      attentionLevel(
        input({
          issues: [issue('refund_detected', 'warning')],
          fieldConfidence: { description: 0.3 }
        })
      )
    ).toBe('warning')
  })
})

describe('attentionLevel — llm_disagreement field-dependent tiering', () => {
  it("disagreement on an amount field → 'warning'", () => {
    expect(attentionLevel(input({ issues: [llmDisagreement('grossAmountOriginal')] }))).toBe(
      'warning'
    )
    expect(attentionLevel(input({ issues: [llmDisagreement('netAmountOriginal')] }))).toBe(
      'warning'
    )
    expect(attentionLevel(input({ issues: [llmDisagreement('vatAmountOriginal')] }))).toBe(
      'warning'
    )
  })

  it("disagreement on invoiceDate/currency/invoiceNumber → 'warning'", () => {
    expect(attentionLevel(input({ issues: [llmDisagreement('invoiceDate')] }))).toBe('warning')
    expect(attentionLevel(input({ issues: [llmDisagreement('currency')] }))).toBe('warning')
    expect(attentionLevel(input({ issues: [llmDisagreement('invoiceNumber')] }))).toBe('warning')
  })

  it("disagreement on description → 'minor'", () => {
    expect(attentionLevel(input({ issues: [llmDisagreement('description')] }))).toBe('minor')
  })

  it("disagreement on issuerName/dueDate → 'minor'", () => {
    expect(attentionLevel(input({ issues: [llmDisagreement('issuerName')] }))).toBe('minor')
    expect(attentionLevel(input({ issues: [llmDisagreement('dueDate')] }))).toBe('minor')
  })

  it('falls back to issue.field when params.field is absent', () => {
    expect(
      attentionLevel(input({ issues: [issue('llm_disagreement', 'warning', 'grossAmount')] }))
    ).toBe('warning')
    expect(
      attentionLevel(input({ issues: [issue('llm_disagreement', 'warning', 'description')] }))
    ).toBe('minor')
  })
})

describe('attentionLevel — rule 5: confidence scan', () => {
  it("core field with 0 < c < 0.85 → 'warning'", () => {
    for (const field of [
      'invoiceDate',
      'currency',
      'grossAmount',
      'grossAmountOriginal',
      'netAmount',
      'netAmountOriginal',
      'vatAmount',
      'vatAmountOriginal'
    ]) {
      expect(attentionLevel(input({ fieldConfidence: { [field]: 0.5 } })), field).toBe('warning')
    }
  })

  it("non-core field with 0 < c < 0.85 → 'minor'", () => {
    for (const field of ['description', 'dueDate', 'issuerName', 'invoiceNumber', 'exchangeRateToEur']) {
      expect(attentionLevel(input({ fieldConfidence: { [field]: 0.5 } })), field).toBe('minor')
    }
  })

  it('core field beats non-core field in the same scan', () => {
    expect(
      attentionLevel(input({ fieldConfidence: { description: 0.3, vatAmountOriginal: 0.5 } }))
    ).toBe('warning')
  })

  it("confidence exactly 0.85 is confident → 'ok'", () => {
    expect(attentionLevel(input({ fieldConfidence: { invoiceDate: 0.85 } }))).toBe('ok')
    expect(attentionLevel(input({ fieldConfidence: { description: 0.85 } }))).toBe('ok')
  })

  it('confidence just below 0.85 escalates', () => {
    expect(attentionLevel(input({ fieldConfidence: { invoiceDate: 0.8499 } }))).toBe('warning')
    expect(attentionLevel(input({ fieldConfidence: { description: 0.8499 } }))).toBe('minor')
  })

  it('confidence exactly 0 means "not extracted" and never escalates', () => {
    expect(attentionLevel(input({ fieldConfidence: { dueDate: 0 } }))).toBe('ok')
    expect(attentionLevel(input({ fieldConfidence: { invoiceDate: 0 } }))).toBe('ok')
    expect(
      attentionLevel(input({ fieldConfidence: { grossAmountOriginal: 0, netAmountOriginal: 0 } }))
    ).toBe('ok')
  })

  it('confidence at or above 0.85 everywhere → ok', () => {
    expect(
      attentionLevel(
        input({ fieldConfidence: { invoiceDate: 0.95, currency: 1, description: 0.85 } })
      )
    ).toBe('ok')
  })

  it("a minor-tier issue alone → 'minor'", () => {
    expect(
      attentionLevel(input({ issues: [issue('missing_invoice_number', 'warning', 'invoiceNumber')] }))
    ).toBe('minor')
  })

  it("info-severity issues are ignored entirely → 'ok'", () => {
    expect(attentionLevel(input({ issues: [issue('ocr_used', 'info')] }))).toBe('ok')
  })
})

describe('attentionLevel — rule 6: processing', () => {
  it("processing with nothing else → 'minor'", () => {
    expect(attentionLevel(input({ reviewStatus: 'processing' }))).toBe('minor')
  })

  it('processing does not mask a critical issue', () => {
    expect(
      attentionLevel(
        input({
          reviewStatus: 'processing',
          issues: [issue('missing_amount', 'critical', 'grossAmount')]
        })
      )
    ).toBe('critical')
  })

  it('processing does not mask an uncertain core field', () => {
    expect(
      attentionLevel(
        input({ reviewStatus: 'processing', fieldConfidence: { grossAmountOriginal: 0.4 } })
      )
    ).toBe('warning')
  })
})

describe('attentionLevel — rule 7: ok', () => {
  it("a clean needs_review document → 'ok'", () => {
    expect(attentionLevel(input())).toBe('ok')
  })

  it("clean with confident fields → 'ok'", () => {
    expect(
      attentionLevel(
        input({ fieldConfidence: { invoiceDate: 0.95, grossAmountOriginal: 0.9, dueDate: 0 } })
      )
    ).toBe('ok')
  })
})

describe('issueAttention (reused table, sanity)', () => {
  it('critical severity always maps to critical, even for otherwise-minor codes', () => {
    expect(issueAttention(issue('missing_invoice_number', 'critical'))).toBe('critical')
  })

  it('info severity maps to null', () => {
    expect(issueAttention(issue('missing_exchange_rate', 'info'))).toBeNull()
  })

  it('non-tax-relevant warning codes map to minor', () => {
    expect(issueAttention(issue('missing_invoice_number', 'warning', 'invoiceNumber'))).toBe(
      'minor'
    )
    expect(issueAttention(issue('missing_due_date', 'warning', 'dueDate'))).toBe('minor')
  })
})

describe('attentionForDocument', () => {
  it('derives the level from the document fields', () => {
    expect(attentionForDocument(doc())).toBe('ok')
    expect(attentionForDocument(doc({ reviewStatus: 'confirmed' }))).toBe('confirmed')
    expect(attentionForDocument(doc({ reviewStatus: 'failed' }))).toBe('critical')
    expect(attentionForDocument(doc({ reviewStatus: 'processing' }))).toBe('minor')
  })

  it('reads vatRequiresConfirmation from extractionRawJson.vatClassification', () => {
    expect(
      attentionForDocument(
        doc({ extractionRawJson: { vatClassification: { requiresUserConfirmation: true } } })
      )
    ).toBe('warning')
    expect(
      attentionForDocument(
        doc({ extractionRawJson: { vatClassification: { requiresUserConfirmation: false } } })
      )
    ).toBe('ok')
  })

  it('treats non-boolean/absent/odd raw JSON as no confirmation needed', () => {
    expect(attentionForDocument(doc({ extractionRawJson: null }))).toBe('ok')
    expect(attentionForDocument(doc({ extractionRawJson: {} }))).toBe('ok')
    expect(attentionForDocument(doc({ extractionRawJson: 'garbage' }))).toBe('ok')
    expect(attentionForDocument(doc({ extractionRawJson: 42 }))).toBe('ok')
    expect(
      attentionForDocument(
        doc({ extractionRawJson: { vatClassification: { requiresUserConfirmation: 'yes' } } })
      )
    ).toBe('ok')
  })

  it('uses issues and fieldConfidence from the document', () => {
    expect(
      attentionForDocument(
        doc({ issues: [issue('conflicting_totals', 'critical', 'grossAmount')] })
      )
    ).toBe('critical')
    expect(
      attentionForDocument(
        doc({ fieldConfidence: { ...doc().fieldConfidence, vatAmountOriginal: 0.5 } })
      )
    ).toBe('warning')
    expect(
      attentionForDocument(doc({ fieldConfidence: { ...doc().fieldConfidence, dueDate: 0.5 } }))
    ).toBe('minor')
  })
})

describe('distribution — real corpus mix maps to the expected tiers', () => {
  const corpus: Array<{ name: string; document: TaxDocument; expected: AttentionLevel }> = [
    {
      name: 'clean domestic invoice',
      document: doc(),
      expected: 'ok'
    },
    {
      name: 'receipt without an invoice number',
      document: doc({
        invoiceNumber: null,
        issues: [issue('missing_invoice_number', 'warning', 'invoiceNumber')],
        fieldConfidence: { ...doc().fieldConfidence, invoiceNumber: 0 }
      }),
      expected: 'minor'
    },
    {
      name: 'USD invoice without an exchange rate',
      document: doc({
        originalCurrency: 'USD',
        exchangeRateToEur: null,
        netAmountEur: null,
        vatAmountEur: null,
        grossAmountEur: null,
        issues: [issue('missing_exchange_rate', 'warning', 'exchangeRateToEur')]
      }),
      expected: 'warning'
    },
    {
      name: 'invoice whose net + VAT do not add up to gross',
      document: doc({
        issues: [issue('conflicting_totals', 'critical', 'grossAmount')]
      }),
      expected: 'critical'
    }
  ]

  it.each(corpus)('$name → $expected', ({ document, expected }) => {
    expect(attentionForDocument(document)).toBe(expected)
  })

  it('the same corpus confirmed by the user is green-check everywhere', () => {
    for (const { document } of corpus) {
      expect(
        attentionForDocument(
          doc({
            ...document,
            reviewStatus: 'confirmed',
            userConfirmedAt: '2026-02-01T10:00:00.000Z'
          })
        )
      ).toBe('confirmed')
    }
  })
})
