/**
 * Period summaries (overview, VAT, income tax) computed from documents.
 * Pure functions over TaxDocument[] + settings — main only loads and calls.
 *
 * Safeguards (spec): documents with critical issues / failed status are
 * EXCLUDED; needs_review documents count as PROVISIONAL; confirmed documents
 * count as CONFIRMED. Totals must expose all three buckets.
 */
import type {
  AmountBreakdown,
  AppSettings,
  IncomeTaxEstimate,
  OverviewSummary,
  TaxDocument,
  TaxPeriod,
  VatSummary
} from '../../shared/domain'
import { dateInPeriod, determineRecognition } from '../period/period'
import { getIncomeTaxEngine } from '../tax/income-tax'
import { roundMoney } from '../currency/convert'

type Bucket = 'confirmed' | 'provisional' | 'excluded'

/** null → deleted, ignore entirely. */
function bucketOf(doc: TaxDocument): Bucket | null {
  if (doc.deletedAt !== null) return null
  const hasCritical = doc.issues.some((i) => i.severity === 'critical')
  if (hasCritical || doc.reviewStatus === 'failed') return 'excluded'
  if (doc.reviewStatus === 'confirmed') return 'confirmed'
  if (doc.reviewStatus === 'needs_review') return 'provisional'
  // still processing → not usable for totals yet
  return 'excluded'
}

interface MutableBreakdown {
  confirmed: number
  provisional: number
  excluded: number
  confirmedIds: string[]
  provisionalIds: string[]
  excludedIds: string[]
}

function emptyBreakdown(): MutableBreakdown {
  return {
    confirmed: 0,
    provisional: 0,
    excluded: 0,
    confirmedIds: [],
    provisionalIds: [],
    excludedIds: []
  }
}

function addAmount(
  breakdown: MutableBreakdown,
  bucket: Bucket,
  amount: number,
  id: string
): void {
  switch (bucket) {
    case 'confirmed':
      breakdown.confirmed += amount
      breakdown.confirmedIds.push(id)
      break
    case 'provisional':
      breakdown.provisional += amount
      breakdown.provisionalIds.push(id)
      break
    case 'excluded':
      breakdown.excluded += amount
      breakdown.excludedIds.push(id)
      break
  }
}

function finalize(breakdown: MutableBreakdown): AmountBreakdown {
  return {
    confirmed: roundMoney(breakdown.confirmed),
    provisional: roundMoney(breakdown.provisional),
    excluded: roundMoney(breakdown.excluded),
    confirmedIds: breakdown.confirmedIds,
    provisionalIds: breakdown.provisionalIds,
    excludedIds: breakdown.excludedIds
  }
}

function netOf(doc: TaxDocument): number {
  return doc.netAmountEur ?? doc.grossAmountEur ?? 0
}

function grossOf(doc: TaxDocument): number {
  if (doc.grossAmountEur !== null) return doc.grossAmountEur
  if (doc.netAmountEur !== null && doc.vatAmountEur !== null) {
    return roundMoney(doc.netAmountEur + doc.vatAmountEur)
  }
  return doc.netAmountEur ?? 0
}

/**
 * Kleinunternehmer report gross amounts (no VAT separation); VAT-registered
 * users report net amounts.
 */
function recognizedValueOf(doc: TaxDocument, settings: AppSettings): number {
  return settings.vatMethod === 'kleinunternehmer' ? grossOf(doc) : netOf(doc)
}

/**
 * VAT period assignment mirroring recognition: invoice date governs for
 * Soll-Versteuerung, payment date (falling back to invoice date, then only
 * provisionally) for Ist/Kleinunternehmer/unsure.
 */
function vatAssignment(
  doc: TaxDocument,
  settings: AppSettings
): { date: string | null; definitive: boolean } {
  const accrual = settings.vatMethod === 'soll'
  const governing = accrual ? doc.invoiceDate : doc.paymentDate
  const fallback = accrual ? doc.paymentDate : doc.invoiceDate
  if (governing !== null) return { date: governing, definitive: true }
  if (fallback !== null) return { date: fallback, definitive: false }
  return { date: null, definitive: false }
}

/** A non-definitive period assignment can never be more than provisional. */
function demote(bucket: Bucket, definitive: boolean): Bucket {
  return bucket === 'confirmed' && !definitive ? 'provisional' : bucket
}

export function computeVatSummary(
  documents: TaxDocument[],
  period: TaxPeriod,
  settings: AppSettings
): VatSummary {
  const isKleinunternehmer = settings.vatMethod === 'kleinunternehmer'

  const outputVat = emptyBreakdown()
  const inputVat = emptyBreakdown()
  const reverseChargeVat = emptyBreakdown()
  const reverseChargeInputVat = emptyBreakdown()
  const domesticTaxableRevenue = emptyBreakdown()
  const euReverseChargeRevenue = emptyBreakdown()
  const thirdCountryNonTaxableRevenue = emptyBreakdown()
  const taxExemptRevenue = emptyBreakdown()
  let revenueNeedingReview = 0
  let expensesNeedingReview = 0

  for (const doc of documents) {
    const baseBucket = bucketOf(doc)
    if (baseBucket === null) continue
    const assignment = vatAssignment(doc, settings)
    if (assignment.date === null || !dateInPeriod(assignment.date, period)) continue
    const bucket = demote(baseBucket, assignment.definitive)

    if (doc.direction === 'income') {
      switch (doc.vatTreatmentCode) {
        case 'DE_DOMESTIC_19':
        case 'DE_DOMESTIC_7':
          addAmount(domesticTaxableRevenue, bucket, netOf(doc), doc.id)
          // Kleinunternehmer owe no output VAT (§ 19 UStG); revenue lines stay
          if (!isKleinunternehmer) {
            addAmount(outputVat, bucket, doc.vatAmountEur ?? 0, doc.id)
          }
          break
        case 'KLEINUNTERNEHMER':
          addAmount(domesticTaxableRevenue, bucket, netOf(doc), doc.id)
          break
        case 'EU_B2B_REVERSE_CHARGE_REVENUE':
          addAmount(euReverseChargeRevenue, bucket, netOf(doc), doc.id)
          break
        case 'THIRD_COUNTRY_B2B_SERVICE':
          // 'Übrige nicht steuerbare Umsätze' — kept separate from exemptions
          addAmount(thirdCountryNonTaxableRevenue, bucket, netOf(doc), doc.id)
          break
        case 'DE_DOMESTIC_0_EXEMPT':
          addAmount(taxExemptRevenue, bucket, netOf(doc), doc.id)
          break
        default:
          break
      }
      if (bucket === 'provisional') revenueNeedingReview += grossOf(doc)
    } else {
      switch (doc.vatTreatmentCode) {
        case 'DE_EXPENSE_INPUT_VAT':
          // Kleinunternehmer have no input-VAT deduction (§ 19 Abs. 1 UStG)
          if (!isKleinunternehmer) {
            addAmount(inputVat, bucket, doc.vatAmountEur ?? 0, doc.id)
          }
          break
        case 'EXPENSE_REVERSE_CHARGE_13B': {
          const owed = roundMoney((doc.netAmountEur ?? 0) * 0.19)
          addAmount(reverseChargeVat, bucket, owed, doc.id)
          // matching deduction assumed for non-KU users (§ 15 Abs. 1 Nr. 4)
          if (!isKleinunternehmer) {
            addAmount(reverseChargeInputVat, bucket, owed, doc.id)
          }
          break
        }
        default:
          break
      }
      if (bucket === 'provisional') expensesNeedingReview += grossOf(doc)
    }
  }

  const estimatedPayable = roundMoney(
    outputVat.confirmed +
      outputVat.provisional +
      reverseChargeVat.confirmed +
      reverseChargeVat.provisional -
      inputVat.confirmed -
      inputVat.provisional -
      reverseChargeInputVat.confirmed -
      reverseChargeInputVat.provisional
  )

  return {
    period,
    outputVat: finalize(outputVat),
    inputVat: finalize(inputVat),
    reverseChargeVat: finalize(reverseChargeVat),
    reverseChargeInputVat: finalize(reverseChargeInputVat),
    estimatedPayable,
    domesticTaxableRevenue: finalize(domesticTaxableRevenue),
    euReverseChargeRevenue: finalize(euReverseChargeRevenue),
    thirdCountryNonTaxableRevenue: finalize(thirdCountryNonTaxableRevenue),
    taxExemptRevenue: finalize(taxExemptRevenue),
    revenueNeedingReview: roundMoney(revenueNeedingReview),
    expensesNeedingReview: roundMoney(expensesNeedingReview)
  }
}

export function computeIncomeTaxEstimate(
  documents: TaxDocument[],
  year: number,
  settings: AppSettings
): IncomeTaxEstimate {
  const period: TaxPeriod = { year, quarter: null, month: null }
  const income = emptyBreakdown()
  const expenses = emptyBreakdown()
  let paymentDatesMissing = 0
  let excludedCount = 0
  let provisionalCount = 0

  const cashBasisMethod =
    settings.incomeTaxMethod === 'euer' || settings.incomeTaxMethod === 'unsure'

  for (const doc of documents) {
    const baseBucket = bucketOf(doc)
    if (baseBucket === null) continue
    const recognition = determineRecognition({
      invoiceDate: doc.invoiceDate,
      paymentDate: doc.paymentDate,
      paymentStatus: doc.paymentStatus,
      method: settings.incomeTaxMethod
    })
    if (recognition.recognitionDate === null) {
      // cannot be assigned to any year — surfaced as incomplete
      if (baseBucket === 'excluded') excludedCount += 1
      continue
    }
    if (!dateInPeriod(recognition.recognitionDate, period)) continue

    const bucket = demote(baseBucket, recognition.definitive)
    const value = recognizedValueOf(doc, settings)
    addAmount(doc.direction === 'income' ? income : expenses, bucket, value, doc.id)

    if (bucket === 'excluded') excludedCount += 1
    if (bucket === 'provisional') provisionalCount += 1
    if (recognition.reasonKey === 'payment_date_missing' && cashBasisMethod) {
      paymentDatesMissing += 1
    }
  }

  const estimatedProfit = roundMoney(
    income.confirmed + income.provisional - expenses.confirmed - expenses.provisional
  )
  const estimatedTaxableIncome = Math.max(
    0,
    roundMoney(
      estimatedProfit + settings.otherTaxableIncome - settings.deductibleContributions
    )
  )

  const { engine, exactYearMatch } = getIncomeTaxEngine(year)
  const taxResult = engine.calculate({
    year,
    taxableIncome: estimatedTaxableIncome,
    assessmentType: settings.assessmentType,
    churchTax: settings.churchTax,
    includeSolidaritySurcharge: settings.includeSolidaritySurcharge
  })

  const suggestedReserve = Math.max(
    0,
    roundMoney(
      taxResult.incomeTax +
        taxResult.solidaritySurcharge +
        taxResult.churchTax -
        settings.incomeTaxPrepayments
    )
  )

  const assumptions: string[] = []
  if (settings.incomeTaxMethod === 'euer') {
    assumptions.push(
      'EÜR cash basis assumed: income and expenses count in the year of payment.'
    )
  } else if (settings.incomeTaxMethod === 'accrual') {
    assumptions.push(
      'Accrual accounting assumed: income and expenses count in the year of the invoice/service.'
    )
  } else {
    assumptions.push(
      'Profit determination method not set — EÜR cash basis was assumed.'
    )
  }
  if (settings.vatMethod === 'kleinunternehmer') {
    assumptions.push(
      'Gross amounts used because the small-business scheme (§ 19 UStG) applies.'
    )
  } else {
    assumptions.push('Net amounts used; VAT is accounted for separately.')
  }
  if (!exactYearMatch) {
    assumptions.push(
      `No tariff for ${year} available — the ${engine.year} tariff (version ${engine.version}) was used.`
    )
  }
  if (settings.churchTax !== 'none' || settings.includeSolidaritySurcharge) {
    assumptions.push(
      'Church tax and solidarity surcharge are estimated without child allowances or caps.'
    )
  }

  const incompleteItems: string[] = []
  if (paymentDatesMissing > 0) {
    incompleteItems.push(
      `${paymentDatesMissing} document(s) are missing a payment date and were assigned by invoice date.`
    )
  }
  if (excludedCount > 0) {
    incompleteItems.push(
      `${excludedCount} document(s) were excluded due to critical issues or failed processing.`
    )
  }
  if (settings.incomeTaxMethod === 'unsure') {
    incompleteItems.push(
      'The profit determination method (EÜR vs. accrual) is not configured.'
    )
  }
  if (settings.deductibleContributions === 0) {
    incompleteItems.push(
      'No deductible contributions (health insurance, pension) are configured; actual taxable income is usually lower.'
    )
  }

  const isEstimateOnly = !(
    settings.incomeTaxMethod !== 'unsure' &&
    provisionalCount === 0 &&
    incompleteItems.length === 0
  )

  return {
    year,
    recognizedIncome: finalize(income),
    recognizedExpenses: finalize(expenses),
    estimatedProfit,
    otherTaxableIncome: roundMoney(settings.otherTaxableIncome),
    deductibleContributions: roundMoney(settings.deductibleContributions),
    estimatedTaxableIncome,
    estimatedIncomeTax: taxResult.incomeTax,
    solidaritySurcharge: taxResult.solidaritySurcharge,
    churchTax: taxResult.churchTax,
    prepayments: roundMoney(settings.incomeTaxPrepayments),
    suggestedReserve,
    engineVersion: taxResult.engineVersion,
    assumptions,
    incompleteItems,
    isEstimateOnly
  }
}

export function computeOverview(
  documents: TaxDocument[],
  period: TaxPeriod,
  settings: AppSettings
): OverviewSummary {
  const revenue = emptyBreakdown()
  const expensesAcc = emptyBreakdown()
  let documentsNeedingReview = 0
  let paymentDatesMissing = 0
  let exchangeRatesMissing = 0

  const cashBasisMethod =
    settings.incomeTaxMethod === 'euer' || settings.incomeTaxMethod === 'unsure'

  for (const doc of documents) {
    const baseBucket = bucketOf(doc)
    if (baseBucket === null) continue
    const recognition = determineRecognition({
      invoiceDate: doc.invoiceDate,
      paymentDate: doc.paymentDate,
      paymentStatus: doc.paymentStatus,
      method: settings.incomeTaxMethod
    })
    const assignable =
      recognition.recognitionDate !== null &&
      dateInPeriod(recognition.recognitionDate, period)
    // unassignable documents (no usable date) still need user attention
    const inScope = assignable || recognition.recognitionDate === null
    if (inScope) {
      if (doc.reviewStatus === 'needs_review') documentsNeedingReview += 1
      if (recognition.reasonKey === 'payment_date_missing' && cashBasisMethod) {
        paymentDatesMissing += 1
      }
      if (
        doc.originalCurrency !== null &&
        doc.originalCurrency !== 'EUR' &&
        doc.exchangeRateToEur === null
      ) {
        exchangeRatesMissing += 1
      }
    }
    if (!assignable) continue

    const bucket = demote(baseBucket, recognition.definitive)
    const value = recognizedValueOf(doc, settings)
    addAmount(doc.direction === 'income' ? revenue : expensesAcc, bucket, value, doc.id)
  }

  const vatSummary = computeVatSummary(documents, period, settings)
  const taxEstimate = computeIncomeTaxEstimate(documents, period.year, settings)

  return {
    period,
    revenueEur: finalize(revenue),
    expensesEur: finalize(expensesAcc),
    profitEur: roundMoney(
      revenue.confirmed +
        revenue.provisional -
        expensesAcc.confirmed -
        expensesAcc.provisional
    ),
    vatPayableEur: vatSummary.estimatedPayable,
    suggestedTaxReserveEur: taxEstimate.suggestedReserve,
    documentsNeedingReview,
    paymentDatesMissing,
    exchangeRatesMissing
  }
}

/** The filing period that is currently relevant given filing frequency. */
export function currentFilingPeriod(
  settings: AppSettings,
  today: string
): TaxPeriod {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const quarter = Math.min(4, Math.max(1, Math.ceil(month / 3))) as 1 | 2 | 3 | 4
  switch (settings.vatFilingFrequency) {
    case 'monthly':
      return { year, quarter, month }
    case 'quarterly':
      return { year, quarter, month: null }
    case 'yearly':
      return { year, quarter: null, month: null }
  }
}
