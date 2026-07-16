import { describe, expect, it } from 'vitest'
import type { DocumentIssue, LlmCheckResult, TaxDocument } from '../../shared/domain'
import {
  buildCheckPrompt,
  buildOutputSchema,
  CHECKED_FIELDS,
  LLM_MODEL_NAME,
  mergeVerdict,
  parseModelOutput
} from './verdict'
import { attentionForDocument } from '../review/attention'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<TaxDocument> = {}): TaxDocument {
  return {
    id: 'doc-1',
    direction: 'expense',
    originalFilename: 'rechnung.pdf',
    storedFilename: '2026-07-15_acme_rechnung.pdf',
    storedRelativePath: '2026/expense/2026-07-15_acme_rechnung.pdf',
    sha256: 'ab'.repeat(32),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: 'RE-2026-042',
    invoiceDate: '2026-07-01',
    serviceDateFrom: null,
    serviceDateTo: null,
    receiptDate: null,
    paymentDate: null,
    dueDate: '2026-07-15',
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
    description: 'Cloud hosting June 2026',
    expenseCategory: null,
    originalCurrency: 'EUR',
    netAmountOriginal: 1234.56,
    vatAmountOriginal: 234.57,
    grossAmountOriginal: 1469.13,
    exchangeRateToEur: null,
    exchangeRateDate: null,
    exchangeRateSource: null,
    netAmountEur: 1234.56,
    vatAmountEur: 234.57,
    grossAmountEur: 1469.13,
    vatRates: [],
    vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
    vatTreatmentLabel: null,
    vatLegalBasis: null,
    taxPeriodYear: 2026,
    taxPeriodQuarter: 3,
    taxPeriodMonth: 7,
    extractedText: 'Rechnung RE-2026-042 vom 01.07.2026 …',
    extractionProvider: 'local-parser',
    extractionVersion: '1.0.0',
    extractionConfidence: 0.8,
    fieldConfidence: {
      invoiceNumber: 0.8,
      invoiceDate: 0.8,
      currency: 0.8,
      netAmountOriginal: 0.8,
      vatAmountOriginal: 0.8,
      grossAmountOriginal: 0.8,
      issuerName: 0.8,
      recipientName: 0.8,
      description: 0.8,
      dueDate: 0.8
    },
    extractionRawJson: null,
    reviewStatus: 'needs_review',
    reviewReasons: [],
    issues: [],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2026-07-15T10:00:00.000Z',
    updatedAt: '2026-07-15T10:00:00.000Z',
    ...overrides
  }
}

function makeResult(
  fields: LlmCheckResult['fields'],
  overrides: Partial<LlmCheckResult> = {}
): LlmCheckResult {
  return {
    documentId: 'doc-1',
    model: LLM_MODEL_NAME,
    fields,
    durationMs: 1200,
    checkedAt: '2026-07-15T10:05:00.000Z',
    ...overrides
  }
}

interface SchemaNode {
  type?: string | string[]
  enum?: string[]
  properties?: Record<string, SchemaNode>
  required?: string[]
}

// ---------------------------------------------------------------------------
// buildOutputSchema
// ---------------------------------------------------------------------------

describe('buildOutputSchema', () => {
  const schema = buildOutputSchema() as SchemaNode

  it('is an object schema requiring exactly the "fields" key', () => {
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['fields'])
    expect(Object.keys(schema.properties ?? {})).toEqual(['fields'])
  })

  it('the fields object has exactly the CHECKED_FIELDS keys, all required', () => {
    const fields = schema.properties!.fields!
    expect(fields.type).toBe('object')
    expect(Object.keys(fields.properties ?? {})).toEqual([...CHECKED_FIELDS])
    expect(fields.required).toEqual([...CHECKED_FIELDS])
  })

  it('requires a verdict, suggestion, and certainty for every field', () => {
    const fields = buildOutputSchema() as SchemaNode
    const fieldProps = fields.properties!.fields!.properties!
    for (const field of CHECKED_FIELDS) {
      const verdict = fieldProps[field]!
      expect(verdict.type, field).toBe('object')
      expect(verdict.required, field).toEqual(['agrees', 'suggested', 'confidence'])
      expect(Object.keys(verdict.properties ?? {}), field).toEqual([
        'agrees',
        'suggested',
        'confidence'
      ])
      expect(verdict.properties!.agrees, field).toEqual({ type: 'boolean' })
      expect(verdict.properties!.suggested, field).toEqual({ type: ['string', 'null'] })
      expect(verdict.properties!.confidence, field).toEqual({
        type: 'string',
        enum: ['low', 'medium', 'high']
      })
    }
  })

  it('is deterministic and JSON-serializable (GBNF conversion needs plain data)', () => {
    expect(buildOutputSchema()).toEqual(buildOutputSchema())
    const s = buildOutputSchema()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

// ---------------------------------------------------------------------------
// buildCheckPrompt
// ---------------------------------------------------------------------------

describe('buildCheckPrompt', () => {
  it('contains the verification instruction and a terse output instruction', () => {
    const prompt = buildCheckPrompt(makeDoc())
    expect(prompt).toContain('You verify fields extracted from an invoice.')
    expect(prompt).toContain('agrees=true when the candidate is correct')
    expect(prompt).toContain("put the correct value from the text in 'suggested'")
    expect(prompt).toContain('JSON object with a verdict for every candidate field')
  })

  it('includes the full extracted text when it fits the budget', () => {
    const text = 'Line A\nLine B\nTotal: 100,00 EUR'
    const prompt = buildCheckPrompt(makeDoc({ extractedText: text }))
    expect(prompt).toContain(text)
    expect(prompt).not.toContain('…\n') // no truncation marker injected
  })

  it('truncates the middle keeping head 4/5 and tail 1/5 of maxChars', () => {
    const text = 'H'.repeat(600) + 'M'.repeat(600) + 'T'.repeat(600) // 1800 chars
    const prompt = buildCheckPrompt(makeDoc({ extractedText: text }), 500)
    // head = 400 chars from the start, tail = 100 chars from the end
    expect(prompt).toContain(text.slice(0, 400) + '\n…\n' + text.slice(-100))
    expect(prompt).not.toContain('H'.repeat(401))
    expect(prompt).not.toContain('T'.repeat(101))
    expect(prompt).not.toContain('M'.repeat(100)) // middle dropped
  })

  it('truncation keeps the tail because totals live at the end', () => {
    const filler = 'x'.repeat(7000)
    const text = filler + '\nGesamtbetrag: 1.469,13 EUR'
    const prompt = buildCheckPrompt(makeDoc({ extractedText: text })) // default 6000
    expect(prompt).toContain('Gesamtbetrag: 1.469,13 EUR')
    expect(prompt).toContain('\n…\n')
    expect(prompt).toContain(text.slice(0, 4800)) // head = 6000 * 4/5
    expect(prompt).toContain(text.slice(-1200)) // tail = 6000 * 1/5
  })

  it('does not truncate at exactly maxChars', () => {
    const text = 'a'.repeat(500)
    const prompt = buildCheckPrompt(makeDoc({ extractedText: text }), 500)
    expect(prompt).toContain(text)
    expect(prompt).not.toContain('…')
  })

  it('lists every checked field as a candidate line, in CHECKED_FIELDS order', () => {
    const prompt = buildCheckPrompt(makeDoc())
    let lastIndex = -1
    for (const field of CHECKED_FIELDS) {
      const index = prompt.indexOf(`${field}: `)
      expect(index, field).toBeGreaterThan(lastIndex)
      lastIndex = index
    }
    expect(prompt).toContain('invoiceNumber: RE-2026-042')
    expect(prompt).toContain('invoiceDate: 2026-07-01')
    expect(prompt).toContain('netAmountOriginal: 1234.56')
    expect(prompt).toContain('issuerName: ACME GmbH')
  })

  it("maps the 'currency' candidate to doc.originalCurrency", () => {
    const prompt = buildCheckPrompt(makeDoc({ originalCurrency: 'USD' }))
    expect(prompt).toContain('currency: USD')
  })

  it('marks missing values as "(not extracted)"', () => {
    const prompt = buildCheckPrompt(
      makeDoc({ dueDate: null, description: null, grossAmountOriginal: null })
    )
    expect(prompt).toContain('dueDate: (not extracted)')
    expect(prompt).toContain('description: (not extracted)')
    expect(prompt).toContain('grossAmountOriginal: (not extracted)')
  })

  it('tolerates null extractedText', () => {
    const prompt = buildCheckPrompt(makeDoc({ extractedText: null }))
    expect(prompt).toContain('Invoice text:')
    expect(prompt).toContain('invoiceNumber: RE-2026-042')
  })

  it('is deterministic for the same document', () => {
    const doc = makeDoc()
    expect(buildCheckPrompt(doc)).toBe(buildCheckPrompt(doc))
  })
})

// ---------------------------------------------------------------------------
// parseModelOutput
// ---------------------------------------------------------------------------

describe('parseModelOutput', () => {
  const goodPayload = JSON.stringify({
    fields: {
      invoiceNumber: { agrees: true, suggested: null },
      netAmountOriginal: { agrees: false, suggested: '999.99' }
    }
  })

  it('parses clean schema-constrained output', () => {
    expect(parseModelOutput(goodPayload)).toEqual({
      invoiceNumber: { agrees: true, suggested: null },
      netAmountOriginal: { agrees: false, suggested: '999.99' }
    })
  })

  it('parses verdict certainty and rejects invalid certainty values', () => {
    const raw = JSON.stringify({
      fields: {
        invoiceDate: {
          agrees: true,
          suggested: null,
          confidence: 'high'
        },
        currency: {
          agrees: true,
          suggested: null,
          confidence: 'certain'
        }
      }
    })
    expect(parseModelOutput(raw)).toEqual({
      invoiceDate: { agrees: true, suggested: null, confidence: 'high' }
    })
  })

  it('tolerates leading/trailing junk around the JSON object', () => {
    const raw = `Sure! Here is my verdict:\n${goodPayload}\nHope that helps.`
    expect(parseModelOutput(raw)).toEqual({
      invoiceNumber: { agrees: true, suggested: null },
      netAmountOriginal: { agrees: false, suggested: '999.99' }
    })
  })

  it('returns null on garbage', () => {
    expect(parseModelOutput('')).toBeNull()
    expect(parseModelOutput('no json here')).toBeNull()
    expect(parseModelOutput('{ not: valid json')).toBeNull()
    expect(parseModelOutput('[1, 2, 3]')).toBeNull()
    expect(parseModelOutput('"just a string"')).toBeNull()
    expect(parseModelOutput('{}')).toBeNull() // fields key missing
    expect(parseModelOutput('{"fields": null}')).toBeNull()
    expect(parseModelOutput('{"fields": []}')).toBeNull()
    expect(parseModelOutput('{"fields": "nope"}')).toBeNull()
  })

  it('drops unknown field keys', () => {
    const raw = JSON.stringify({
      fields: {
        invoiceNumber: { agrees: true, suggested: null },
        totallyMadeUp: { agrees: false, suggested: 'x' }
      }
    })
    expect(parseModelOutput(raw)).toEqual({
      invoiceNumber: { agrees: true, suggested: null }
    })
  })

  it('tolerates missing field keys (partial verdicts)', () => {
    const raw = JSON.stringify({ fields: { dueDate: { agrees: true, suggested: null } } })
    expect(parseModelOutput(raw)).toEqual({ dueDate: { agrees: true, suggested: null } })
  })

  it('accepts an empty fields object', () => {
    expect(parseModelOutput('{"fields": {}}')).toEqual({})
  })

  it('drops entries with a non-boolean agrees or a non-string/null suggested', () => {
    const raw = JSON.stringify({
      fields: {
        invoiceNumber: { agrees: 'yes', suggested: null },
        invoiceDate: { agrees: true, suggested: 42 },
        currency: 'EUR',
        issuerName: { agrees: false, suggested: 'ACME AG' }
      }
    })
    expect(parseModelOutput(raw)).toEqual({
      issuerName: { agrees: false, suggested: 'ACME AG' }
    })
  })

  it('normalizes a missing suggested key to null', () => {
    const raw = JSON.stringify({ fields: { issuerName: { agrees: true } } })
    expect(parseModelOutput(raw)).toEqual({ issuerName: { agrees: true, suggested: null } })
  })
})

// ---------------------------------------------------------------------------
// mergeVerdict
// ---------------------------------------------------------------------------

describe('mergeVerdict', () => {
  it('medium agreement turns a moderate scanner reading into recognized', () => {
    const doc = makeDoc()
    const merge = mergeVerdict(doc, makeResult({ invoiceNumber: { agrees: true, suggested: null } }))
    expect(merge.fieldConfidence.invoiceNumber).toBe(0.85)
    expect(merge.newIssues).toEqual([])
    expect(merge.changed).toBe(true)
  })

  it('agreement never lowers an already higher confidence', () => {
    const doc = makeDoc({ fieldConfidence: { invoiceNumber: 0.97 } })
    const merge = mergeVerdict(doc, makeResult({ invoiceNumber: { agrees: true, suggested: null } }))
    expect(merge.fieldConfidence.invoiceNumber).toBe(0.97)
    expect(merge.changed).toBe(false)
  })

  it('high-certainty agreement promotes a moderate scanner reading to 0.92', () => {
    const doc = makeDoc({ fieldConfidence: { invoiceNumber: 0.6 } })
    const merge = mergeVerdict(
      doc,
      makeResult({
        invoiceNumber: { agrees: true, suggested: null, confidence: 'high' }
      })
    )
    expect(merge.fieldConfidence.invoiceNumber).toBe(0.92)
  })

  it('lets a certain independent agreement corroborate a weak scanner reading', () => {
    const weak = makeDoc({ fieldConfidence: { invoiceNumber: 0.59 } })
    expect(
      mergeVerdict(
        weak,
        makeResult({
          invoiceNumber: { agrees: true, suggested: null, confidence: 'high' }
        })
      ).fieldConfidence.invoiceNumber
    ).toBe(0.92)
  })

  it('makes a fully corroborated weak scan all-good', () => {
    const weak = makeDoc({
      fieldConfidence: {
        ...makeDoc().fieldConfidence,
        invoiceDate: 0.4,
        currency: 0.4,
        netAmountOriginal: 0.4,
        vatAmountOriginal: 0.4,
        grossAmountOriginal: 0.4
      }
    })
    const highAgreement = { agrees: true, suggested: null, confidence: 'high' as const }
    const merge = mergeVerdict(
      weak,
      makeResult({
        invoiceDate: highAgreement,
        currency: highAgreement,
        netAmountOriginal: highAgreement,
        vatAmountOriginal: highAgreement,
        grossAmountOriginal: highAgreement
      })
    )
    expect(
      attentionForDocument({
        ...weak,
        fieldConfidence: merge.fieldConfidence,
        issues: merge.newIssues
      })
    ).toBe('ok')
  })

  it('never invents confidence for a missing candidate', () => {
    const missing = makeDoc({ invoiceNumber: null, fieldConfidence: { invoiceNumber: 0 } })
    expect(
      mergeVerdict(
        missing,
        makeResult({
          invoiceNumber: { agrees: true, suggested: null, confidence: 'high' }
        })
      ).fieldConfidence.invoiceNumber
    ).toBe(0)
  })

  it('low-certainty agreement keeps the scanner confidence unchanged', () => {
    const doc = makeDoc({ fieldConfidence: { invoiceNumber: 0.7 } })
    const merge = mergeVerdict(
      doc,
      makeResult({
        invoiceNumber: { agrees: true, suggested: null, confidence: 'low' }
      })
    )
    expect(merge.fieldConfidence.invoiceNumber).toBe(0.7)
  })

  it('low-certainty disagreement cannot disturb an all-good scanner result', () => {
    const strong = makeDoc({
      fieldConfidence: {
        ...makeDoc().fieldConfidence,
        invoiceDate: 0.95,
        currency: 0.95,
        netAmountOriginal: 0.95,
        vatAmountOriginal: 0.95,
        grossAmountOriginal: 0.95
      }
    })
    const merge = mergeVerdict(
      strong,
      makeResult({
        invoiceDate: {
          agrees: false,
          suggested: '2026-07-02',
          confidence: 'low'
        }
      })
    )
    expect(merge.fieldConfidence.invoiceDate).toBe(0.95)
    expect(merge.newIssues).toEqual([])
    expect(merge.changed).toBe(false)
    expect(
      attentionForDocument({
        ...strong,
        fieldConfidence: merge.fieldConfidence,
        issues: merge.newIssues
      })
    ).toBe('ok')
  })

  it('low-certainty disagreement leaves a genuinely weak scan uncertain on its own', () => {
    const weak = makeDoc({
      fieldConfidence: {
        ...makeDoc().fieldConfidence,
        invoiceDate: 0.5,
        currency: 0.95,
        netAmountOriginal: 0.95,
        vatAmountOriginal: 0.95,
        grossAmountOriginal: 0.95
      }
    })
    const merge = mergeVerdict(
      weak,
      makeResult({
        invoiceDate: {
          agrees: false,
          suggested: '2026-07-02',
          confidence: 'low'
        }
      })
    )
    expect(merge.fieldConfidence.invoiceDate).toBe(0.5)
    expect(merge.newIssues).toEqual([])
    expect(
      attentionForDocument({
        ...weak,
        fieldConfidence: merge.fieldConfidence,
        issues: merge.newIssues
      })
    ).toBe('warning')
  })

  it('disagreement lowers confidence to at most 0.55 and attaches a reviewable issue', () => {
    const doc = makeDoc()
    const merge = mergeVerdict(
      doc,
      makeResult({ invoiceNumber: { agrees: false, suggested: 'RE-2026-043' } })
    )
    expect(merge.fieldConfidence.invoiceNumber).toBe(0.55)
    expect(merge.newIssues).toEqual([
      {
        code: 'llm_disagreement',
        severity: 'warning',
        messageKey: 'issues.llm_disagreement',
        field: 'invoiceNumber',
        params: { field: 'invoiceNumber', suggested: 'RE-2026-043' }
      }
    ])
    expect(merge.changed).toBe(true)
  })

  it('disagreement never raises an already lower confidence, but still records the issue', () => {
    const doc = makeDoc({ fieldConfidence: { description: 0.3 } })
    const merge = mergeVerdict(
      doc,
      makeResult({ description: { agrees: false, suggested: null } })
    )
    expect(merge.fieldConfidence.description).toBe(0.3)
    expect(merge.newIssues).toHaveLength(1)
    expect(merge.newIssues[0]!.params).toEqual({ field: 'description', suggested: '' })
    expect(merge.changed).toBe(true)
  })

  it('never touches fields absent from fieldConfidence (user-corrected)', () => {
    const doc = makeDoc({ fieldConfidence: { invoiceDate: 0.8 } })
    const merge = mergeVerdict(
      doc,
      makeResult({
        invoiceNumber: { agrees: false, suggested: 'WRONG-1' },
        issuerName: { agrees: true, suggested: null }
      })
    )
    expect(merge.fieldConfidence).toEqual({ invoiceDate: 0.8 })
    expect(merge.newIssues).toEqual([])
    expect(merge.changed).toBe(false)
  })

  describe('numeric normalization (formatting-only disagreements count as agreement)', () => {
    it.each([
      '1.234,56', // German
      '1,234.56', // English
      '1234.56',
      '1234,56',
      'EUR 1.234,56',
      '1.234,56 €',
      '€1,234.56'
    ])('doc 1234.56 vs suggested %s agrees', (suggested) => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({ netAmountOriginal: { agrees: false, suggested } })
      )
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('treats a bare thousands-grouped integer as the same number', () => {
      const doc = makeDoc({ netAmountOriginal: 1234, fieldConfidence: { netAmountOriginal: 0.7 } })
      const merge = mergeVerdict(
        doc,
        makeResult({ netAmountOriginal: { agrees: false, suggested: '1.234' } })
      )
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('compares at 2 decimal places', () => {
      const doc = makeDoc({ vatAmountOriginal: 234.567, fieldConfidence: { vatAmountOriginal: 0.7 } })
      const merge = mergeVerdict(
        doc,
        makeResult({ vatAmountOriginal: { agrees: false, suggested: '234,57' } })
      )
      expect(merge.fieldConfidence.vatAmountOriginal).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('handles negative amounts (credit notes)', () => {
      const doc = makeDoc({ grossAmountOriginal: -50, fieldConfidence: { grossAmountOriginal: 0.7 } })
      const merge = mergeVerdict(
        doc,
        makeResult({ grossAmountOriginal: { agrees: false, suggested: '-50,00 EUR' } })
      )
      expect(merge.fieldConfidence.grossAmountOriginal).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('a genuinely different number stays a disagreement', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({ netAmountOriginal: { agrees: false, suggested: '999,99' } })
      )
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
      expect(merge.newIssues[0]!.params!.suggested).toBe('999,99')
    })

    it('an unparseable suggestion stays a disagreement', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({ netAmountOriginal: { agrees: false, suggested: 'siehe Anlage' } })
      )
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
    })

    it('does not normalize when the doc value is missing', () => {
      const doc = makeDoc({ netAmountOriginal: null })
      const merge = mergeVerdict(
        doc,
        makeResult({ netAmountOriginal: { agrees: false, suggested: '1234.56' } })
      )
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
    })
  })

  describe('date normalization (formatting-only disagreements count as agreement)', () => {
    it.each(['01.07.2026', '1.7.2026', '1.7.26', '2026-07-01', '07-01-2026', '7/1/2026'])(
      'doc 2026-07-01 vs suggested %s agrees',
      (suggested) => {
        const doc = makeDoc()
        const merge = mergeVerdict(doc, makeResult({ invoiceDate: { agrees: false, suggested } }))
        expect(merge.fieldConfidence.invoiceDate).toBe(0.85)
        expect(merge.newIssues).toEqual([])
      }
    )

    it('normalizes both sides — a German-formatted doc value matches an ISO suggestion', () => {
      const doc = makeDoc({ invoiceDate: '01.07.2026' })
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceDate: { agrees: false, suggested: '2026-07-01' } })
      )
      expect(merge.fieldConfidence.invoiceDate).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('reads an unambiguous day-first dashed date correctly', () => {
      const doc = makeDoc({ dueDate: '2026-07-15' })
      const merge = mergeVerdict(
        doc,
        makeResult({ dueDate: { agrees: false, suggested: '15-07-2026' } })
      )
      expect(merge.fieldConfidence.dueDate).toBe(0.85)
      expect(merge.newIssues).toEqual([])
    })

    it('a genuinely different date stays a disagreement', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceDate: { agrees: false, suggested: '02.07.2026' } })
      )
      expect(merge.fieldConfidence.invoiceDate).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
    })

    it('an unparseable date stays a disagreement', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceDate: { agrees: false, suggested: 'Anfang Juli' } })
      )
      expect(merge.fieldConfidence.invoiceDate).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
    })

    it('does not date-normalize non-date fields', () => {
      // same digits, but invoiceNumber is a string field → no normalization
      const doc = makeDoc({ invoiceNumber: '2026-07-01' })
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceNumber: { agrees: false, suggested: '01.07.2026' } })
      )
      expect(merge.fieldConfidence.invoiceNumber).toBe(0.55)
      expect(merge.newIssues).toHaveLength(1)
    })
  })

  describe('issue dedup', () => {
    const oldIssue: DocumentIssue = {
      code: 'llm_disagreement',
      severity: 'warning',
      messageKey: 'issues.llm_disagreement',
      field: 'invoiceNumber',
      params: { field: 'invoiceNumber', suggested: 'OLD-1' }
    }

    it('removes an older same-field disagreement when a later check agrees', () => {
      const otherField: DocumentIssue = {
        ...oldIssue,
        field: 'issuerName',
        params: { field: 'issuerName', suggested: 'ACME AG' }
      }
      const doc = makeDoc({
        issues: [oldIssue, otherField],
        fieldConfidence: { invoiceNumber: 0.55, issuerName: 0.55 }
      })
      const merge = mergeVerdict(
        doc,
        makeResult({
          invoiceNumber: { agrees: true, suggested: null, confidence: 'medium' }
        })
      )
      expect(merge.newIssues).toEqual([otherField])
      expect(merge.fieldConfidence.invoiceNumber).toBe(0.85)
      expect(merge.changed).toBe(true)
    })

    it('clears an older same-field issue when the new disagreement is uncertain', () => {
      const doc = makeDoc({
        issues: [oldIssue],
        fieldConfidence: { invoiceNumber: 0.95 }
      })
      const merge = mergeVerdict(
        doc,
        makeResult({
          invoiceNumber: {
            agrees: false,
            suggested: 'MAYBE-2',
            confidence: 'low'
          }
        })
      )
      expect(merge.fieldConfidence.invoiceNumber).toBe(0.95)
      expect(merge.newIssues).toEqual([])
      expect(merge.changed).toBe(true)
    })

    it('replaces an older llm_disagreement for the same field instead of duplicating', () => {
      const unrelated: DocumentIssue = {
        code: 'missing_invoice_date',
        severity: 'warning',
        messageKey: 'issues.missing_invoice_date',
        field: 'invoiceDate'
      }
      const doc = makeDoc({ issues: [unrelated, oldIssue] })
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceNumber: { agrees: false, suggested: 'NEW-2' } })
      )
      const llmIssues = merge.newIssues.filter((i) => i.code === 'llm_disagreement')
      expect(llmIssues).toHaveLength(1)
      expect(llmIssues[0]!.params).toEqual({ field: 'invoiceNumber', suggested: 'NEW-2' })
      // unrelated issues survive untouched, order preserved
      expect(merge.newIssues[0]).toEqual(unrelated)
      expect(merge.newIssues).toHaveLength(2)
      expect(merge.changed).toBe(true)
    })

    it('keeps llm_disagreement issues of other fields', () => {
      const otherField: DocumentIssue = {
        ...oldIssue,
        field: 'issuerName',
        params: { field: 'issuerName', suggested: 'ACME AG' }
      }
      const doc = makeDoc({ issues: [otherField] })
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceNumber: { agrees: false, suggested: 'NEW-2' } })
      )
      expect(merge.newIssues).toHaveLength(2)
      expect(merge.newIssues.filter((i) => i.code === 'llm_disagreement')).toHaveLength(2)
    })

    it('re-running an identical disagreement changes nothing', () => {
      const doc = makeDoc({
        issues: [oldIssue],
        fieldConfidence: { invoiceNumber: 0.55 }
      })
      const merge = mergeVerdict(
        doc,
        makeResult({ invoiceNumber: { agrees: false, suggested: 'OLD-1' } })
      )
      expect(merge.fieldConfidence.invoiceNumber).toBe(0.55)
      expect(merge.newIssues).toEqual([oldIssue])
      expect(merge.changed).toBe(false)
    })
  })

  describe('changed flag + purity', () => {
    it('is false for an empty verdict', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(doc, makeResult({}))
      expect(merge.changed).toBe(false)
      expect(merge.fieldConfidence).toEqual(doc.fieldConfidence)
      expect(merge.newIssues).toEqual([])
    })

    it('is false when agreement hits the exact recognized floor already', () => {
      const doc = makeDoc({ fieldConfidence: { issuerName: 0.85 } })
      const merge = mergeVerdict(doc, makeResult({ issuerName: { agrees: true, suggested: null } }))
      expect(merge.changed).toBe(false)
    })

    it('is true when only an issue is added (confidence already below cap)', () => {
      const doc = makeDoc({ fieldConfidence: { issuerName: 0.4 } })
      const merge = mergeVerdict(
        doc,
        makeResult({ issuerName: { agrees: false, suggested: 'ACME AG' } })
      )
      expect(merge.fieldConfidence.issuerName).toBe(0.4)
      expect(merge.changed).toBe(true)
    })

    it('handles mixed verdicts across fields in one merge', () => {
      const doc = makeDoc()
      const merge = mergeVerdict(
        doc,
        makeResult({
          invoiceNumber: { agrees: true, suggested: null },
          issuerName: { agrees: false, suggested: 'ACME AG' },
          netAmountOriginal: { agrees: false, suggested: '1.234,56' } // formatting-only
        })
      )
      expect(merge.fieldConfidence.invoiceNumber).toBe(0.85)
      expect(merge.fieldConfidence.issuerName).toBe(0.55)
      expect(merge.fieldConfidence.netAmountOriginal).toBe(0.85)
      expect(merge.fieldConfidence.dueDate).toBe(0.8) // unmentioned field untouched
      expect(merge.newIssues).toHaveLength(1)
      expect(merge.newIssues[0]!.field).toBe('issuerName')
      expect(merge.changed).toBe(true)
    })

    it('never mutates the input document', () => {
      const doc = makeDoc({ issues: [] })
      const confidenceBefore = { ...doc.fieldConfidence }
      mergeVerdict(
        doc,
        makeResult({
          invoiceNumber: { agrees: true, suggested: null },
          issuerName: { agrees: false, suggested: 'ACME AG' }
        })
      )
      expect(doc.fieldConfidence).toEqual(confidenceBefore)
      expect(doc.issues).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// real-world transcript regressions (live Qwen 2.5 1.5B run, 2026-07-15):
// the model flags formatting variants as disagreements — none may surface
// ---------------------------------------------------------------------------
import { describe as describeLive, it as itLive, expect as expectLive } from 'vitest'

function liveDoc(): TaxDocument {
  return {
    ...makeDoc(),
    invoiceNumber: 'PJ52DODZ-0005',
    invoiceDate: '2025-10-07',
    originalCurrency: 'USD',
    issuerName: 'OpenAI, LLC',
    dueDate: null,
    fieldConfidence: {
      invoiceNumber: 0.9,
      invoiceDate: 0.9,
      currency: 0.9,
      issuerName: 0.85,
      dueDate: 0
    }
  }
}

function liveResult(fields: Record<string, { agrees: boolean; suggested: string | null }>) {
  return {
    documentId: 'doc-live',
    model: 'qwen2.5-1.5b-instruct-q4_k_m',
    fields,
    durationMs: 1,
    checkedAt: '2026-07-15T00:00:00.000Z'
  }
}

describeLive('mergeVerdict – live-model formatting variants', () => {
  itLive('treats identical-but-reformatted suggestions as agreement', () => {
    const doc = liveDoc()
    const merge = mergeVerdict(
      doc,
      liveResult({
        invoiceNumber: { agrees: false, suggested: 'PJ52DODZ 0005' },
        invoiceDate: { agrees: false, suggested: 'October 7, 2025' },
        currency: { agrees: false, suggested: 'USD' },
        issuerName: { agrees: false, suggested: 'openai llc' }
      })
    )
    expectLive(merge.fieldConfidence.invoiceNumber).toBeGreaterThanOrEqual(0.85)
    expectLive(merge.fieldConfidence.invoiceDate).toBeGreaterThanOrEqual(0.85)
    expectLive(merge.fieldConfidence.currency).toBeGreaterThanOrEqual(0.85)
    expectLive(merge.fieldConfidence.issuerName).toBeGreaterThanOrEqual(0.85)
    expectLive(merge.newIssues.filter((i) => i.code === 'llm_disagreement')).toHaveLength(0)
  })

  itLive('both-empty ("(not extracted)" echo on a null field) is agreement, not noise', () => {
    const doc = liveDoc()
    const merge = mergeVerdict(
      doc,
      liveResult({ dueDate: { agrees: false, suggested: '(not extracted)' } })
    )
    expectLive(merge.newIssues.filter((i) => i.code === 'llm_disagreement')).toHaveLength(0)
  })

  itLive('German month-name dates normalize too', () => {
    const doc = { ...liveDoc(), invoiceDate: '2025-10-07' }
    const merge = mergeVerdict(
      doc,
      liveResult({ invoiceDate: { agrees: false, suggested: '7. Oktober 2025' } })
    )
    expectLive(merge.newIssues.filter((i) => i.code === 'llm_disagreement')).toHaveLength(0)
  })

  itLive('a genuinely different value still disagrees', () => {
    const doc = liveDoc()
    const merge = mergeVerdict(
      doc,
      liveResult({ invoiceNumber: { agrees: false, suggested: 'TOTALLY-DIFFERENT-42' } })
    )
    expectLive(merge.fieldConfidence.invoiceNumber).toBeLessThanOrEqual(0.55)
    expectLive(merge.newIssues.filter((i) => i.code === 'llm_disagreement')).toHaveLength(1)
  })
})
