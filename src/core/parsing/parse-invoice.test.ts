import { describe, expect, it } from 'vitest'
import { parseInvoiceText, type ParseInvoiceOptions } from './parse-invoice'
import type { ExtractedInvoiceData } from '../../shared/domain'
import {
  AMAZON_STYLE_GERMAN,
  AMBIGUOUS_DATE_INVOICE,
  APPLE_STYLE_GERMAN,
  CONFLICTING_TOTALS,
  CORROBORATED_DATE_INVOICE,
  GOOGLE_ADS_INVOICE,
  GROSS_ONLY_RECEIPT,
  MULTI_RATE_GERMAN,
  NO_AMOUNT_DOC,
  NUMBER_CONFLICT_DOC,
  OCR_LABEL_ECHO_INVOICE,
  ORDER_CONFIRMATION,
  OWN_TEMPLATE_DE_INCOME,
  OWN_TEMPLATE_EN_INCOME,
  PDFJS_COLUMN_TABLE_INVOICE,
  PDFJS_OWN_TEMPLATE_INCOME,
  PDFJS_STRIPE_NUL_RECEIPT,
  STRATO_STYLE_GERMAN,
  STRIPE_EUR_RECEIPT,
  STRIPE_REFUND_RECEIPT,
  STRIPE_USD_RECEIPT,
  SWEEP_CONFLICT_TOTALS_DOC,
  USDT_INVOICE_INCOME
} from './parse-invoice.fixtures'

const expenseOpts: ParseInvoiceOptions = {
  direction: 'expense',
  ownName: 'Max Beispiel',
  ocrUsed: false,
  ocrPages: []
}
const incomeOpts: ParseInvoiceOptions = { ...expenseOpts, direction: 'income' }

const codes = (r: ExtractedInvoiceData): string[] => r.issues.map((i) => i.code)
const critical = (r: ExtractedInvoiceData): string[] =>
  r.issues.filter((i) => i.severity === 'critical').map((i) => i.code)

describe('parseInvoiceText — Stripe-style receipts', () => {
  it('extracts a full EUR receipt', () => {
    const r = parseInvoiceText(STRIPE_EUR_RECEIPT, expenseOpts)
    expect(r.invoiceNumber.value).toBe('AB12CDEF-0009')
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.invoiceDate.value).toBe('2026-04-30')
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.paymentDate.value).toBe('2026-04-30')
    expect(r.currency.value).toBe('EUR')
    expect(r.grossAmount.value).toBe(23)
    expect(r.netAmount.value).toBe(19.33)
    expect(r.vatAmount.value).toBe(3.67)
    expect(r.grossAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.vatRates).toEqual([
      { rate: 19, netAmountOriginal: 19.33, vatAmountOriginal: 3.67, grossAmountOriginal: 23 }
    ])
    expect(r.serviceDateFrom.value).toBe('2026-04-30')
    expect(r.serviceDateTo.value).toBe('2026-05-30')
    expect(r.issuerName.value).toBe('Nimbus Cloud Ireland Limited')
    expect(r.issuerCountryCode.value).toBe('IE')
    expect(r.issuerVatId.value).toBe('IE1234567FA')
    expect(r.recipientName.value).toBe('Max Beispiel')
    expect(r.recipientCountryCode.value).toBe('DE')
    expect(r.description.value).toContain('Nimbus Plus Subscription')
    expect(r.signals.paidWording).toBe(true)
    expect(r.signals.isServiceLikely).toBe(true)
    expect(critical(r)).toEqual([])
  })

  it('handles USD totals with EUR equivalents and OSS ids', () => {
    const r = parseInvoiceText(STRIPE_USD_RECEIPT, expenseOpts)
    expect(r.currency.value).toBe('USD')
    expect(r.grossAmount.value).toBe(59.5)
    expect(r.netAmount.value).toBe(50)
    expect(r.vatAmount.value).toBe(9.5)
    expect(r.invoiceDate.value).toBe('2025-10-07')
    expect(r.issuerName.value).toBe('Nimbus AI, LLC')
    expect(r.issuerCountryCode.value).toBe('US')
    expect(r.issuerVatId.value).toBe('EU372999999')
    expect(r.signals.ossWording).toBe(true)
    expect(r.description.value).toContain('Nimbus API usage credit')
    expect(critical(r)).toEqual([])
  })

  it('flags refunds as a warning', () => {
    const r = parseInvoiceText(STRIPE_REFUND_RECEIPT, expenseOpts)
    expect(codes(r)).toContain('refund_detected')
    expect(r.issues.find((i) => i.code === 'refund_detected')?.severity).toBe('warning')
    expect(r.grossAmount.value).toBe(29.75)
    expect(r.netAmount.value).toBe(25)
    expect(r.vatAmount.value).toBe(4.75)
    expect(r.issuerName.value).toBe('Klerk Systems, Inc.')
    expect(r.invoiceDate.value).toBe('2026-01-21')
  })
})

describe('parseInvoiceText — Google Ads reverse charge', () => {
  it('reads stacked labels with values above and 0% reverse-charge VAT', () => {
    const r = parseInvoiceText(GOOGLE_ADS_INVOICE, expenseOpts)
    expect(r.invoiceNumber.value).toBe('1234567890')
    expect(r.invoiceDate.value).toBe('2025-11-30')
    expect(r.currency.value).toBe('EUR')
    expect(r.grossAmount.value).toBe(30.69)
    expect(r.netAmount.value).toBe(30.69)
    expect(r.vatAmount.value).toBe(0)
    expect(r.vatAmount.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.signals.reverseChargeWording).toBe(true)
    expect(r.serviceDateFrom.value).toBe('2025-11-02')
    expect(r.serviceDateTo.value).toBe('2025-11-30')
    expect(r.issuerName.value).toBe('Beispiel Ads Ireland Limited')
    expect(r.issuerCountryCode.value).toBe('IE')
    expect(r.issuerVatId.value).toBe('IE6388999V')
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — Amazon EU German', () => {
  it('extracts the USt table, OSS wording and Zahlbetrag', () => {
    const r = parseInvoiceText(AMAZON_STYLE_GERMAN, expenseOpts)
    expect(r.invoiceNumber.value).toBe('DE63EXAMPLE1D')
    expect(r.invoiceDate.value).toBe('2026-05-02')
    expect(r.currency.value).toBe('EUR')
    expect(r.grossAmount.value).toBe(17.58)
    expect(r.netAmount.value).toBe(14.78)
    expect(r.vatAmount.value).toBe(2.8)
    expect(r.vatRates).toEqual([
      { rate: 19, netAmountOriginal: 14.78, vatAmountOriginal: 2.8, grossAmountOriginal: 17.58 }
    ])
    expect(r.signals.ossWording).toBe(true)
    expect(r.signals.paidWording).toBe(true)
    expect(r.signals.isServiceLikely).toBe(false) // Versandkosten → goods
    expect(r.issuerName.value).toBe('Marktplatz EU S.à r.l.')
    expect(r.issuerCountryCode.value).toBe('LU')
    expect(r.issuerVatId.value).toBe('LU12345678')
    expect(r.recipientCountryCode.value).toBe('DE')
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — Apple-style German', () => {
  it('extracts issuer/recipient VAT ids and the Netto/MwSt block', () => {
    const r = parseInvoiceText(APPLE_STYLE_GERMAN, expenseOpts)
    expect(r.invoiceNumber.value).toBe('UA00000001')
    expect(r.invoiceDate.value).toBe('2026-04-08')
    expect(r.dueDate.value).toBe('2026-04-08')
    expect(r.netAmount.value).toBe(83.19)
    expect(r.vatAmount.value).toBe(15.81)
    expect(r.grossAmount.value).toBe(99)
    expect(r.currency.value).toBe('EUR')
    expect(r.issuerVatId.value).toBe('DE123456789')
    expect(r.recipientVatId.value).toBe('DE987654321')
    expect(r.issuerName.value).toBe('Obstbaum Distribution International Ltd.')
    expect(r.issuerCountryCode.value).toBe('IE')
    expect(r.issuerTaxNumber.value).toBe('12/345/67890')
    expect(r.description.value).toBe('BEISPIEL DEVELOPER PROGRAM')
    expect(r.signals.paidWording).toBe(true)
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — Strato-style German classic', () => {
  it('extracts totals, service period and falls back for the unlabeled date', () => {
    const r = parseInvoiceText(STRATO_STYLE_GERMAN, expenseOpts)
    expect(r.invoiceNumber.value).toBe('DRP000000001')
    expect(r.invoiceDate.value).toBe('2025-12-01')
    // unlabeled, but the only date standing alone on its own line (classic
    // German letter layout) → treated as the document date with confidence
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.serviceDateFrom.value).toBe('2025-11-30')
    expect(r.serviceDateTo.value).toBe('2026-02-27')
    expect(r.netAmount.value).toBe(6.3)
    expect(r.vatAmount.value).toBe(1.2)
    expect(r.grossAmount.value).toBe(7.5)
    expect(r.currency.value).toBe('EUR')
    expect(r.issuerName.value).toBe('Beispiel Hosting GmbH')
    expect(r.issuerVatId.value).toBe('DE123456789')
    expect(r.issuerCountryCode.value).toBe('DE')
    expect(r.description.value).toContain('Beispiel Mail-Archivierung')
    // future direct debit is not paid wording
    expect(r.signals.paidWording).toBe(false)
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — own invoice template (income)', () => {
  it('EN variant: third-country B2B service, tax exempt', () => {
    const r = parseInvoiceText(OWN_TEMPLATE_EN_INCOME, incomeOpts)
    expect(r.invoiceNumber.value).toBe('2026.01.1')
    // id-shaped value directly under a bare "Invoice" label → confident
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.invoiceDate.value).toBe('2026-01-24')
    expect(codes(r)).not.toContain('ambiguous_date_format')
    expect(r.currency.value).toBe('EUR')
    expect(r.grossAmount.value).toBe(6000)
    expect(r.vatAmount.value).toBe(0)
    expect(r.netAmount.value).toBe(6000)
    expect(r.issuerName.value).toBe('Max Beispiel')
    expect(r.issuerCountryCode.value).toBe('DE')
    expect(r.recipientName.value).toBe('Ejemplo S.A. de C.V.')
    expect(r.recipientCountryCode.value).toBe('SV')
    expect(r.recipientIsBusiness.value).toBe(true)
    expect(r.serviceDateFrom.value).toBe('2026-01-01')
    expect(r.serviceDateTo.value).toBe('2026-01-31')
    expect(r.description.value).toBe('Software Development')
    expect(r.signals.vatExemptWording).toBe(true)
    expect(r.signals.isServiceLikely).toBe(true)
    expect(codes(r)).not.toContain('unclear_recipient_country')
    expect(codes(r)).not.toContain('unclear_business_status')
    expect(critical(r)).toEqual([])
  })

  it('DE variant: tolerates the broken "19 & USt" label', () => {
    const r = parseInvoiceText(OWN_TEMPLATE_DE_INCOME, incomeOpts)
    expect(r.invoiceNumber.value).toBe('2025.09.14.1')
    expect(r.invoiceDate.value).toBe('2025-09-14')
    expect(r.dueDate.value).toBe('2025-10-14')
    expect(r.netAmount.value).toBe(231)
    expect(r.vatAmount.value).toBe(43.89)
    expect(r.grossAmount.value).toBe(274.89)
    expect(r.vatRates).toEqual([
      { rate: 19, netAmountOriginal: 231, vatAmountOriginal: 43.89, grossAmountOriginal: 274.89 }
    ])
    expect(r.currency.value).toBe('EUR')
    expect(r.recipientName.value).toBe('Muster Gesellschaft für Kommunikationsdesign mbH')
    expect(r.recipientIsBusiness.value).toBe(true)
    expect(r.recipientCountryCode.value).toBe('DE')
    expect(r.description.value).toBe('Consulting')
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — gross-only German receipt', () => {
  it('derives net from the printed rate with reduced confidence', () => {
    const r = parseInvoiceText(GROSS_ONLY_RECEIPT, expenseOpts)
    expect(r.grossAmount.value).toBe(11.9)
    expect(r.netAmount.value).toBe(10)
    expect(r.vatAmount.value).toBe(1.9)
    expect(r.netAmount.confidence).toBeGreaterThan(0.4)
    expect(r.netAmount.confidence).toBeLessThanOrEqual(0.7)
    expect(r.vatAmount.confidence).toBeLessThanOrEqual(0.7)
    expect(r.invoiceDate.value).toBe('2026-03-05')
    expect(r.currency.value).toBe('EUR')
  })
})

describe('parseInvoiceText — non-ISO currency (USDT)', () => {
  it('extracts USDT but warns about the non-ISO currency', () => {
    const r = parseInvoiceText(USDT_INVOICE_INCOME, incomeOpts)
    expect(r.currency.value).toBe('USDT')
    expect(codes(r)).toContain('non_iso_currency')
    expect(r.issues.find((i) => i.code === 'non_iso_currency')?.severity).toBe('warning')
    expect(r.grossAmount.value).toBe(7550.56)
    expect(r.invoiceNumber.value).toBe('100001')
    expect(r.invoiceDate.value).toBe('2026-07-13')
    expect(r.recipientName.value).toBe('Ejemplo El Salvador, S.A. DE C.V.')
    expect(r.recipientIsBusiness.value).toBe(true)
    expect(r.recipientCountryCode.value).toBe('SV')
    expect(r.issuerVatId.value).toBe('DE461999999')
  })
})

describe('parseInvoiceText — problem documents', () => {
  it('flags order confirmations without invoice wording', () => {
    const r = parseInvoiceText(ORDER_CONFIRMATION, expenseOpts)
    expect(codes(r)).toContain('possibly_not_invoice')
    expect(codes(r)).toContain('missing_invoice_number')
    expect(codes(r)).toContain('missing_invoice_date')
    expect(r.grossAmount.value).toBe(10)
  })

  it('flags ambiguous DD/MM dates without corroboration', () => {
    const r = parseInvoiceText(AMBIGUOUS_DATE_INVOICE, expenseOpts)
    expect(r.invoiceDate.value).toBe('2026-04-05') // DD/MM European default
    expect(r.invoiceDate.confidence).toBeLessThanOrEqual(0.7)
    expect(codes(r)).toContain('ambiguous_date_format')
  })

  it('does not flag ambiguity when another date proves DD/MM order', () => {
    const r = parseInvoiceText(CORROBORATED_DATE_INVOICE, expenseOpts)
    expect(r.invoiceDate.value).toBe('2026-04-05')
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.85)
    expect(codes(r)).not.toContain('ambiguous_date_format')
  })

  it('supports multi-rate VAT tables', () => {
    const r = parseInvoiceText(MULTI_RATE_GERMAN, expenseOpts)
    expect(r.vatRates).toHaveLength(2)
    expect(r.vatRates[0]).toEqual({
      rate: 19,
      netAmountOriginal: 100,
      vatAmountOriginal: 19,
      grossAmountOriginal: 119
    })
    expect(r.vatRates[1]).toEqual({
      rate: 7,
      netAmountOriginal: 50,
      vatAmountOriginal: 3.5,
      grossAmountOriginal: 53.5
    })
    expect(r.netAmount.value).toBe(150)
    expect(r.vatAmount.value).toBe(22.5)
    expect(r.grossAmount.value).toBe(172.5)
    expect(critical(r)).toEqual([])
  })

  it('nulls the gross and reports conflicting totals when candidates disagree', () => {
    const r = parseInvoiceText(CONFLICTING_TOTALS, expenseOpts)
    expect(codes(r)).toContain('conflicting_totals')
    expect(r.issues.find((i) => i.code === 'conflicting_totals')?.severity).toBe('critical')
    expect(r.grossAmount.value).toBeNull()
    expect(r.extractedText).toContain('€100.00') // candidates stay in the raw text
    expect(r.extractedText).toContain('EUR 90,00')
  })

  it('reports missing amount and unknown currency as critical', () => {
    const r = parseInvoiceText(NO_AMOUNT_DOC, expenseOpts)
    expect(critical(r)).toContain('missing_amount')
    expect(critical(r)).toContain('unknown_currency')
    expect(r.grossAmount.value).toBeNull()
    expect(r.grossAmount.confidence).toBe(0)
  })

  it('adds an info issue when OCR was used', () => {
    const r = parseInvoiceText(STRIPE_EUR_RECEIPT, { ...expenseOpts, ocrUsed: true, ocrPages: [1] })
    const ocr = r.issues.find((i) => i.code === 'ocr_used')
    expect(ocr?.severity).toBe('info')
    expect(ocr?.messageKey).toBe('issues.ocr_used')
    expect(r.ocrUsed).toBe(true)
    expect(r.ocrPages).toEqual([1])
  })

  it('income without recipient country gets a warning', () => {
    const r = parseInvoiceText('Invoice\nInvoice number: X-1\nDate\n24/01/2026\nTotal\n€100.00\n', incomeOpts)
    expect(codes(r)).toContain('unclear_recipient_country')
  })

  it('uses issues.<code> message keys throughout', () => {
    const r = parseInvoiceText(ORDER_CONFIRMATION, expenseOpts)
    for (const issue of r.issues) {
      expect(issue.messageKey).toBe(`issues.${issue.code}`)
    }
  })
})

describe('parseInvoiceText — pdf.js extraction artifacts (v1.2.0)', () => {
  it('repairs NUL-for-hyphen glyphs and same-line double-space labels (Stripe)', () => {
    const r = parseInvoiceText(PDFJS_STRIPE_NUL_RECEIPT, expenseOpts)
    expect(r.invoiceNumber.value).toBe('AB12CDEF-0009')
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.invoiceDate.value).toBe('2026-04-30')
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.serviceDateFrom.value).toBe('2026-04-30')
    expect(r.serviceDateTo.value).toBe('2026-05-30')
    expect(r.currency.value).toBe('EUR')
    expect(r.grossAmount.value).toBe(23)
    expect(r.netAmount.value).toBe(19.33)
    expect(r.vatAmount.value).toBe(3.67)
    // second checker corroborates the totals → no low-confidence review chips
    expect(r.grossAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.netAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.vatAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.vatRates).toEqual([
      { rate: 19, netAmountOriginal: 19.33, vatAmountOriginal: 3.67, grossAmountOriginal: 23 }
    ])
    expect(r.description.value).toBe('Nimbus Plus Subscription (per seat)')
    expect(r.description.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.issuerName.value).toBe('Nimbus Cloud Ireland Limited')
    expect(r.recipientName.value).toBe('Max Beispiel')
    expect(r.recipientCountryCode.value).toBe('DE')
    expect(critical(r)).toEqual([])
  })

  it('strips label echoes generically ("Invoice Nr.:F1054762" → "F1054762")', () => {
    const r = parseInvoiceText(OCR_LABEL_ECHO_INVOICE, expenseOpts)
    expect(r.invoiceNumber.value).toBe('F1054762')
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.invoiceDate.value).toBe('2025-08-06')
    // "Total without VAT" must not be mistaken for the gross
    expect(r.grossAmount.value).toBe(148.98)
    expect(r.netAmount.value).toBe(125.19)
    expect(r.vatAmount.value).toBe(23.79)
    expect(r.grossAmount.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.description.value).toBe('WaterBlock Pro AIO 360 Dark')
    expect(r.issuerName.value).toBe('Muster Cooling GmbH')
    expect(r.issuerCountryCode.value).toBe('DE')
    expect(critical(r)).toEqual([])
  })

  it('aligns pdf.js column header rows with their value row (Viking style)', () => {
    const r = parseInvoiceText(PDFJS_COLUMN_TABLE_INVOICE, expenseOpts)
    expect(r.invoiceNumber.value).toBe('4919278971')
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.invoiceDate.value).toBe('2025-07-21')
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.dueDate.value).toBe('2025-08-20')
    expect(r.currency.value).toBe('EUR')
    expect(r.netAmount.value).toBe(49)
    expect(r.vatAmount.value).toBe(9.31)
    expect(r.grossAmount.value).toBe(58.31)
    expect(r.grossAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.description.value).toBe('Muster Steckdosenleiste mit Schalter')
    expect(r.issuerName.value).toBe('Muster Office Deutschland GmbH')
    expect(r.issuerCountryCode.value).toBe('DE')
    expect(critical(r)).toEqual([])
  })

  it('resolves "Label  value  Label  value" cell pairs (own income template)', () => {
    const r = parseInvoiceText(PDFJS_OWN_TEMPLATE_INCOME, incomeOpts)
    expect(r.invoiceNumber.value).toBe('2026.01.1')
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.invoiceDate.value).toBe('2026-01-24')
    expect(r.invoiceDate.confidence).toBeGreaterThanOrEqual(0.85)
    expect(r.grossAmount.value).toBe(6000)
    expect(r.netAmount.value).toBe(6000)
    expect(r.vatAmount.value).toBe(0)
    expect(r.currency.value).toBe('EUR')
    expect(r.description.value).toBe('Software Development')
    expect(r.recipientName.value).toBe('Ejemplo S.A. de C.V.')
    expect(r.recipientCountryCode.value).toBe('SV')
    expect(r.serviceDateFrom.value).toBe('2026-01-01')
    expect(r.serviceDateTo.value).toBe('2026-01-31')
    expect(r.signals.vatExemptWording).toBe(true)
    expect(critical(r)).toEqual([])
  })
})

describe('parseInvoiceText — second checker (corroboration pass)', () => {
  it('caps confidence when two different labeled invoice numbers exist', () => {
    const r = parseInvoiceText(NUMBER_CONFLICT_DOC, expenseOpts)
    expect(r.invoiceNumber.value).toBe('RE-100')
    expect(r.invoiceNumber.confidence).toBeLessThanOrEqual(0.6)
  })

  it('caps gross confidence and flags conflicting totals when the totals row disagrees', () => {
    const r = parseInvoiceText(SWEEP_CONFLICT_TOTALS_DOC, expenseOpts)
    expect(r.grossAmount.value).toBe(125)
    expect(r.grossAmount.confidence).toBeLessThanOrEqual(0.6)
    expect(codes(r)).toContain('conflicting_totals')
  })

  it('raises confidence when the independent sweep agrees (no false review chips)', () => {
    const r = parseInvoiceText(STRIPE_EUR_RECEIPT, expenseOpts)
    expect(r.netAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.vatAmount.confidence).toBeGreaterThanOrEqual(0.9)
    expect(r.invoiceNumber.confidence).toBeGreaterThanOrEqual(0.9)
  })
})
