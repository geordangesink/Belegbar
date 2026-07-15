import { describe, expect, it, vi } from 'vitest'
import type { AppSettings, TaxDocument, TaxPeriod } from '../../shared/domain'
import { DEFAULT_SETTINGS } from '../../shared/domain'

// The period module is implemented separately; summaries only rely on its
// contract, so it is mocked here with a faithful reference behavior.
vi.mock('../period/period', () => {
  const periodOf = (iso: string) => {
    const year = Number(iso.slice(0, 4))
    const month = Number(iso.slice(5, 7))
    return {
      year,
      quarter: Math.ceil(month / 3) as 1 | 2 | 3 | 4,
      month
    }
  }
  return {
    determineRecognition: (input: {
      invoiceDate: string | null
      paymentDate: string | null
      paymentStatus: 'unknown' | 'paid' | 'unpaid'
      method: 'euer' | 'accrual' | 'unsure'
    }) => {
      const cashBasis = input.method === 'euer' || input.method === 'unsure'
      if (cashBasis) {
        if (input.paymentDate !== null) {
          return {
            recognitionDate: input.paymentDate,
            period: periodOf(input.paymentDate),
            definitive: true,
            reasonKey: 'payment_date'
          }
        }
        if (input.invoiceDate !== null) {
          return {
            recognitionDate: input.invoiceDate,
            period: periodOf(input.invoiceDate),
            definitive: false,
            reasonKey: 'payment_date_missing'
          }
        }
        return {
          recognitionDate: null,
          period: null,
          definitive: false,
          reasonKey: 'no_dates'
        }
      }
      if (input.invoiceDate !== null) {
        return {
          recognitionDate: input.invoiceDate,
          period: periodOf(input.invoiceDate),
          definitive: true,
          reasonKey: 'invoice_date'
        }
      }
      if (input.paymentDate !== null) {
        return {
          recognitionDate: input.paymentDate,
          period: periodOf(input.paymentDate),
          definitive: false,
          reasonKey: 'invoice_date_missing'
        }
      }
      return {
        recognitionDate: null,
        period: null,
        definitive: false,
        reasonKey: 'no_dates'
      }
    },
    dateInPeriod: (iso: string, period: TaxPeriod) => {
      const year = Number(iso.slice(0, 4))
      const month = Number(iso.slice(5, 7))
      if (year !== period.year) return false
      if (period.month !== null) return month === period.month
      if (period.quarter !== null) return Math.ceil(month / 3) === period.quarter
      return true
    }
  }
})

import {
  computeIncomeTaxEstimate,
  computeOverview,
  computeVatSummary,
  currentFilingPeriod
} from './summaries'

let idCounter = 0
function makeDoc(overrides: Partial<TaxDocument>): TaxDocument {
  idCounter += 1
  return {
    id: `doc-${idCounter}`,
    direction: 'income',
    originalFilename: 'invoice.pdf',
    storedFilename: 'invoice.pdf',
    storedRelativePath: 'income/invoice.pdf',
    sha256: 'x'.repeat(64),
    mimeType: 'application/pdf',
    pageCount: 1,
    invoiceNumber: null,
    invoiceDate: null,
    serviceDateFrom: null,
    serviceDateTo: null,
    receiptDate: null,
    paymentDate: null,
    dueDate: null,
    paymentStatus: 'unknown',
    issuerName: null,
    issuerAddress: null,
    issuerCountryCode: null,
    issuerTaxNumber: null,
    issuerVatId: null,
    recipientName: null,
    recipientAddress: null,
    recipientCountryCode: null,
    recipientTaxNumber: null,
    recipientVatId: null,
    recipientIsBusiness: null,
    description: null,
    expenseCategory: null,
    originalCurrency: 'EUR',
    netAmountOriginal: null,
    vatAmountOriginal: null,
    grossAmountOriginal: null,
    exchangeRateToEur: 1,
    exchangeRateDate: null,
    exchangeRateSource: null,
    netAmountEur: null,
    vatAmountEur: null,
    grossAmountEur: null,
    vatRates: [],
    vatTreatmentCode: null,
    vatTreatmentLabel: null,
    vatLegalBasis: null,
    taxPeriodYear: null,
    taxPeriodQuarter: null,
    taxPeriodMonth: null,
    extractedText: null,
    extractionProvider: 'test',
    extractionVersion: '1',
    extractionConfidence: null,
    fieldConfidence: {},
    extractionRawJson: null,
    reviewStatus: 'confirmed',
    reviewReasons: [],
    issues: [],
    userConfirmedAt: null,
    deletedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides
  }
}

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  vatMethod: 'ist',
  incomeTaxMethod: 'euer',
  ...overrides
})

const Q2_2025: TaxPeriod = { year: 2025, quarter: 2, month: null }
const YEAR_2025: TaxPeriod = { year: 2025, quarter: null, month: null }

describe('bucketing', () => {
  const domesticIncome = (overrides: Partial<TaxDocument>) =>
    makeDoc({
      direction: 'income',
      vatTreatmentCode: 'DE_DOMESTIC_19',
      invoiceDate: '2025-04-01',
      paymentDate: '2025-05-01',
      netAmountEur: 100,
      vatAmountEur: 19,
      grossAmountEur: 119,
      ...overrides
    })

  it('routes confirmed/needs_review/failed/critical/deleted correctly', () => {
    const confirmed = domesticIncome({})
    const provisional = domesticIncome({ reviewStatus: 'needs_review' })
    const failed = domesticIncome({ reviewStatus: 'failed' })
    const critical = domesticIncome({
      reviewStatus: 'needs_review',
      issues: [
        { code: 'missing_amount', severity: 'critical', messageKey: 'issues.missing_amount' }
      ]
    })
    const confirmedButCritical = domesticIncome({
      issues: [
        { code: 'missing_amount', severity: 'critical', messageKey: 'issues.missing_amount' }
      ]
    })
    const deleted = domesticIncome({ deletedAt: '2025-05-02T00:00:00.000Z' })

    const summary = computeVatSummary(
      [confirmed, provisional, failed, critical, confirmedButCritical, deleted],
      Q2_2025,
      settings()
    )

    expect(summary.domesticTaxableRevenue.confirmed).toBe(100)
    expect(summary.domesticTaxableRevenue.confirmedIds).toEqual([confirmed.id])
    expect(summary.domesticTaxableRevenue.provisional).toBe(100)
    expect(summary.domesticTaxableRevenue.provisionalIds).toEqual([provisional.id])
    expect(summary.domesticTaxableRevenue.excluded).toBe(300)
    expect(summary.domesticTaxableRevenue.excludedIds).toEqual([
      failed.id,
      critical.id,
      confirmedButCritical.id
    ])
    // deleted documents are ignored entirely
    const allIds = [
      ...summary.domesticTaxableRevenue.confirmedIds,
      ...summary.domesticTaxableRevenue.provisionalIds,
      ...summary.domesticTaxableRevenue.excludedIds
    ]
    expect(allIds).not.toContain(deleted.id)
    // estimated payable only counts confirmed + provisional
    expect(summary.estimatedPayable).toBe(38)
  })
})

describe('computeVatSummary', () => {
  it('aggregates output/input/reverse-charge VAT and revenue lines', () => {
    const docs = [
      makeDoc({
        vatTreatmentCode: 'DE_DOMESTIC_19',
        paymentDate: '2025-04-15',
        netAmountEur: 1000,
        vatAmountEur: 190,
        grossAmountEur: 1190
      }),
      makeDoc({
        vatTreatmentCode: 'DE_DOMESTIC_7',
        reviewStatus: 'needs_review',
        paymentDate: '2025-05-01',
        netAmountEur: 500,
        vatAmountEur: 35,
        grossAmountEur: 535
      }),
      makeDoc({
        vatTreatmentCode: 'THIRD_COUNTRY_B2B_SERVICE',
        paymentDate: '2025-06-01',
        netAmountEur: 2000,
        grossAmountEur: 2000
      }),
      makeDoc({
        vatTreatmentCode: 'DE_DOMESTIC_0_EXEMPT',
        paymentDate: '2025-06-02',
        netAmountEur: 300,
        grossAmountEur: 300
      }),
      makeDoc({
        vatTreatmentCode: 'EU_B2B_REVERSE_CHARGE_REVENUE',
        paymentDate: '2025-06-03',
        netAmountEur: 800,
        grossAmountEur: 800
      }),
      makeDoc({
        direction: 'expense',
        vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
        paymentDate: '2025-04-20',
        netAmountEur: 100,
        vatAmountEur: 19,
        grossAmountEur: 119
      }),
      makeDoc({
        direction: 'expense',
        vatTreatmentCode: 'EXPENSE_REVERSE_CHARGE_13B',
        paymentDate: '2025-05-10',
        netAmountEur: 200,
        grossAmountEur: 200
      }),
      makeDoc({
        direction: 'expense',
        vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
        reviewStatus: 'needs_review',
        paymentDate: '2025-05-11',
        netAmountEur: 50,
        vatAmountEur: 9.5,
        grossAmountEur: 59.5
      })
    ]

    const summary = computeVatSummary(docs, Q2_2025, settings())

    expect(summary.outputVat.confirmed).toBe(190)
    expect(summary.outputVat.provisional).toBe(35)
    expect(summary.inputVat.confirmed).toBe(19)
    expect(summary.inputVat.provisional).toBe(9.5)
    // § 13b: 19 % of net both as owed and as deductible → net zero
    expect(summary.reverseChargeVat.confirmed).toBe(38)
    expect(summary.reverseChargeInputVat.confirmed).toBe(38)
    expect(summary.estimatedPayable).toBe(190 + 35 + 38 - 19 - 9.5 - 38)

    expect(summary.domesticTaxableRevenue.confirmed).toBe(1000)
    expect(summary.domesticTaxableRevenue.provisional).toBe(500)
    expect(summary.euReverseChargeRevenue.confirmed).toBe(800)
    // third-country line stays separate from the tax-exempt line
    expect(summary.thirdCountryNonTaxableRevenue.confirmed).toBe(2000)
    expect(summary.taxExemptRevenue.confirmed).toBe(300)

    expect(summary.revenueNeedingReview).toBe(535)
    expect(summary.expensesNeedingReview).toBe(59.5)
  })

  it('zeroes output and input VAT for Kleinunternehmer but keeps revenue and § 13b debt', () => {
    const docs = [
      makeDoc({
        vatTreatmentCode: 'DE_DOMESTIC_19',
        paymentDate: '2025-04-15',
        netAmountEur: 1000,
        vatAmountEur: 190,
        grossAmountEur: 1190
      }),
      makeDoc({
        vatTreatmentCode: 'KLEINUNTERNEHMER',
        paymentDate: '2025-04-16',
        netAmountEur: 700,
        grossAmountEur: 700
      }),
      makeDoc({
        direction: 'expense',
        vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
        paymentDate: '2025-04-20',
        netAmountEur: 100,
        vatAmountEur: 19,
        grossAmountEur: 119
      }),
      makeDoc({
        direction: 'expense',
        vatTreatmentCode: 'EXPENSE_REVERSE_CHARGE_13B',
        paymentDate: '2025-05-10',
        netAmountEur: 200,
        grossAmountEur: 200
      })
    ]

    const summary = computeVatSummary(docs, Q2_2025, settings({ vatMethod: 'kleinunternehmer' }))

    expect(summary.outputVat.confirmed).toBe(0)
    expect(summary.outputVat.confirmedIds).toEqual([])
    expect(summary.inputVat.confirmed).toBe(0)
    // § 13b VAT is owed even by Kleinunternehmer, without a deduction
    expect(summary.reverseChargeVat.confirmed).toBe(38)
    expect(summary.reverseChargeInputVat.confirmed).toBe(0)
    expect(summary.estimatedPayable).toBe(38)
    // revenue lines are kept
    expect(summary.domesticTaxableRevenue.confirmed).toBe(1700)
  })

  it('assigns by invoice date for Soll and payment date for Ist', () => {
    const doc = makeDoc({
      vatTreatmentCode: 'DE_DOMESTIC_19',
      invoiceDate: '2025-03-31',
      paymentDate: '2025-04-02',
      netAmountEur: 100,
      vatAmountEur: 19,
      grossAmountEur: 119
    })
    const q1: TaxPeriod = { year: 2025, quarter: 1, month: null }

    const soll = computeVatSummary([doc], q1, settings({ vatMethod: 'soll' }))
    expect(soll.outputVat.confirmed).toBe(19)

    const ist = computeVatSummary([doc], q1, settings({ vatMethod: 'ist' }))
    expect(ist.outputVat.confirmed).toBe(0)

    const istQ2 = computeVatSummary([doc], Q2_2025, settings({ vatMethod: 'ist' }))
    expect(istQ2.outputVat.confirmed).toBe(19)
  })

  it('demotes confirmed documents to provisional when Ist lacks a payment date', () => {
    const doc = makeDoc({
      vatTreatmentCode: 'DE_DOMESTIC_19',
      invoiceDate: '2025-04-01',
      paymentDate: null,
      netAmountEur: 100,
      vatAmountEur: 19,
      grossAmountEur: 119
    })
    const summary = computeVatSummary([doc], Q2_2025, settings({ vatMethod: 'ist' }))
    expect(summary.outputVat.confirmed).toBe(0)
    expect(summary.outputVat.provisional).toBe(19)
  })
})

describe('computeIncomeTaxEstimate', () => {
  it('computes profit, tax and reserve from recognized documents', () => {
    const docs = [
      makeDoc({
        paymentDate: '2025-05-10',
        vatTreatmentCode: 'DE_DOMESTIC_19',
        netAmountEur: 40000,
        vatAmountEur: 7600,
        grossAmountEur: 47600
      }),
      makeDoc({
        direction: 'expense',
        paymentDate: '2025-06-01',
        vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
        netAmountEur: 9500,
        vatAmountEur: 1805,
        grossAmountEur: 11305
      })
    ]
    const estimate = computeIncomeTaxEstimate(
      docs,
      2025,
      settings({
        deductibleContributions: 500,
        incomeTaxPrepayments: 1000
      })
    )

    expect(estimate.recognizedIncome.confirmed).toBe(40000)
    expect(estimate.recognizedExpenses.confirmed).toBe(9500)
    expect(estimate.estimatedProfit).toBe(30500)
    expect(estimate.estimatedTaxableIncome).toBe(30000)
    // Grundtabelle 2025: zvE 30 000 € → 4 303 €
    expect(estimate.estimatedIncomeTax).toBe(4303)
    expect(estimate.solidaritySurcharge).toBe(0)
    expect(estimate.churchTax).toBe(0)
    expect(estimate.suggestedReserve).toBe(3303)
    expect(estimate.engineVersion).toBe('2025.1')
    expect(estimate.incompleteItems).toEqual([])
    expect(estimate.isEstimateOnly).toBe(false)
    expect(estimate.assumptions.join(' ')).toContain('EÜR')
    expect(estimate.assumptions.join(' ')).toContain('Net amounts')
  })

  it('recognizes by payment year for EÜR and invoice year for accrual', () => {
    const doc = makeDoc({
      invoiceDate: '2025-12-20',
      paymentDate: '2026-01-05',
      netAmountEur: 1000,
      grossAmountEur: 1190
    })

    expect(
      computeIncomeTaxEstimate([doc], 2025, settings()).recognizedIncome.confirmed
    ).toBe(0)
    expect(
      computeIncomeTaxEstimate([doc], 2026, settings()).recognizedIncome.confirmed
    ).toBe(1000)

    const accrual = settings({ incomeTaxMethod: 'accrual' })
    expect(
      computeIncomeTaxEstimate([doc], 2025, accrual).recognizedIncome.confirmed
    ).toBe(1000)
    expect(
      computeIncomeTaxEstimate([doc], 2026, accrual).recognizedIncome.confirmed
    ).toBe(0)
  })

  it('treats EÜR documents without payment date as provisional and incomplete', () => {
    const doc = makeDoc({
      invoiceDate: '2025-03-01',
      paymentDate: null,
      netAmountEur: 1000,
      grossAmountEur: 1190
    })
    const estimate = computeIncomeTaxEstimate(
      [doc],
      2025,
      settings({ deductibleContributions: 500 })
    )
    expect(estimate.recognizedIncome.confirmed).toBe(0)
    expect(estimate.recognizedIncome.provisional).toBe(1000)
    expect(estimate.incompleteItems.join(' ')).toContain('payment date')
    expect(estimate.isEstimateOnly).toBe(true)
  })

  it('uses gross amounts for Kleinunternehmer', () => {
    const doc = makeDoc({
      paymentDate: '2025-04-01',
      netAmountEur: 1000,
      vatAmountEur: 190,
      grossAmountEur: 1190
    })
    const estimate = computeIncomeTaxEstimate(
      [doc],
      2025,
      settings({ vatMethod: 'kleinunternehmer' })
    )
    expect(estimate.recognizedIncome.confirmed).toBe(1190)
    expect(estimate.assumptions.join(' ')).toContain('Gross amounts')
  })

  it('never reports negative taxable income or a negative reserve', () => {
    const doc = makeDoc({
      direction: 'expense',
      paymentDate: '2025-04-01',
      netAmountEur: 5000,
      grossAmountEur: 5950
    })
    const estimate = computeIncomeTaxEstimate(
      [doc],
      2025,
      settings({ incomeTaxPrepayments: 2000 })
    )
    expect(estimate.estimatedProfit).toBe(-5000)
    expect(estimate.estimatedTaxableIncome).toBe(0)
    expect(estimate.estimatedIncomeTax).toBe(0)
    expect(estimate.suggestedReserve).toBe(0)
  })

  it('notes the engine fallback for unsupported years', () => {
    const doc = makeDoc({ paymentDate: '2027-02-01', netAmountEur: 1000 })
    const estimate = computeIncomeTaxEstimate([doc], 2027, settings())
    expect(estimate.engineVersion).toBe('2026.1')
    expect(estimate.assumptions.join(' ')).toContain('2026')
  })

  it('marks the method question when the user is unsure', () => {
    const estimate = computeIncomeTaxEstimate(
      [],
      2025,
      settings({ incomeTaxMethod: 'unsure' })
    )
    expect(estimate.incompleteItems.join(' ')).toMatch(/method/i)
    expect(estimate.isEstimateOnly).toBe(true)
  })
})

describe('computeOverview', () => {
  it('aggregates revenue, expenses, counts and downstream summaries', () => {
    const docA = makeDoc({
      paymentDate: '2025-05-10',
      vatTreatmentCode: 'DE_DOMESTIC_19',
      netAmountEur: 10000,
      vatAmountEur: 1900,
      grossAmountEur: 11900
    })
    const docB = makeDoc({
      direction: 'expense',
      paymentDate: '2025-06-01',
      vatTreatmentCode: 'DE_EXPENSE_INPUT_VAT',
      netAmountEur: 2000,
      vatAmountEur: 380,
      grossAmountEur: 2380
    })
    const docC = makeDoc({
      reviewStatus: 'needs_review',
      paymentDate: '2025-07-01',
      vatTreatmentCode: 'DE_DOMESTIC_19',
      netAmountEur: 1000,
      vatAmountEur: 190,
      grossAmountEur: 1190
    })
    const docD = makeDoc({
      direction: 'expense',
      reviewStatus: 'needs_review',
      paymentDate: '2025-08-01',
      originalCurrency: 'USD',
      exchangeRateToEur: null,
      netAmountEur: null,
      grossAmountEur: null
    })
    const docE = makeDoc({
      invoiceDate: '2025-09-01',
      paymentDate: null,
      vatTreatmentCode: 'DE_DOMESTIC_19',
      netAmountEur: 500,
      vatAmountEur: 95,
      grossAmountEur: 595
    })

    const overview = computeOverview(
      [docA, docB, docC, docD, docE],
      YEAR_2025,
      settings()
    )

    expect(overview.revenueEur.confirmed).toBe(10000)
    expect(overview.revenueEur.confirmedIds).toEqual([docA.id])
    // docC needs review, docE is demoted (payment date missing under EÜR)
    expect(overview.revenueEur.provisional).toBe(1500)
    expect(overview.expensesEur.confirmed).toBe(2000)
    expect(overview.profitEur).toBe(10000 + 1500 - 2000)
    expect(overview.documentsNeedingReview).toBe(2)
    expect(overview.paymentDatesMissing).toBe(1)
    expect(overview.exchangeRatesMissing).toBe(1)
    // ist: output 1900 + 190 + 95 − input 380
    expect(overview.vatPayableEur).toBe(1805)
    // profit 9 500 + no other income → below Grundfreibetrag adjustments? No:
    // taxable = 9 500 → below 12 096 → no tax, so the reserve is zero
    expect(overview.suggestedTaxReserveEur).toBe(0)
  })

  it('uses gross amounts for Kleinunternehmer', () => {
    const doc = makeDoc({
      paymentDate: '2025-05-10',
      vatTreatmentCode: 'KLEINUNTERNEHMER',
      netAmountEur: 1000,
      vatAmountEur: 190,
      grossAmountEur: 1190
    })
    const overview = computeOverview(
      [doc],
      YEAR_2025,
      settings({ vatMethod: 'kleinunternehmer' })
    )
    expect(overview.revenueEur.confirmed).toBe(1190)
  })
})

describe('currentFilingPeriod', () => {
  it('returns the current month for monthly filers', () => {
    expect(
      currentFilingPeriod(settings({ vatFilingFrequency: 'monthly' }), '2026-07-15')
    ).toEqual({ year: 2026, quarter: 3, month: 7 })
  })

  it('returns the current quarter for quarterly filers', () => {
    expect(
      currentFilingPeriod(settings({ vatFilingFrequency: 'quarterly' }), '2026-02-01')
    ).toEqual({ year: 2026, quarter: 1, month: null })
  })

  it('returns the whole year for yearly filers', () => {
    expect(
      currentFilingPeriod(settings({ vatFilingFrequency: 'yearly' }), '2026-11-30')
    ).toEqual({ year: 2026, quarter: null, month: null })
  })
})
