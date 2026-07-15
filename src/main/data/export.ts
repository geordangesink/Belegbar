/**
 * Period exports: csv (field table), json (full documents), zip (PDFs +
 * metadata) and a bilingual human-readable summary. All outputs are clearly
 * labeled as estimates — nothing here is an official filing.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import {
  computeIncomeTaxEstimate,
  computeVatSummary
} from '@core/summary/summaries'
import type { AppSettings, TaxDocument, TaxPeriod } from '@shared/domain'
import type { ExportResult } from '@shared/api'
import { dataPaths, resolveInside } from '../storage/paths'
import type { Logger } from '../log'

export const ESTIMATE_LABEL_EN = 'Estimate — not an official filing'
export const ESTIMATE_LABEL_DE = 'Schätzung — keine offizielle Steuererklärung'

export type ExportFormat = 'csv' | 'json' | 'zip' | 'summary'

function periodSlug(period: TaxPeriod): string {
  let slug = String(period.year)
  if (period.quarter !== null) slug += `-Q${period.quarter}`
  if (period.month !== null) slug += `-M${String(period.month).padStart(2, '0')}`
  return slug
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function documentInPeriod(doc: TaxDocument, period: TaxPeriod): boolean {
  if (doc.taxPeriodYear !== period.year) return false
  if (period.quarter !== null && doc.taxPeriodQuarter !== period.quarter) return false
  if (period.month !== null && doc.taxPeriodMonth !== period.month) return false
  return true
}

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const CSV_COLUMNS: { header: string; get: (d: TaxDocument) => string | number | null }[] = [
  { header: 'id', get: (d) => d.id },
  { header: 'direction', get: (d) => d.direction },
  { header: 'invoice_date', get: (d) => d.invoiceDate },
  { header: 'invoice_number', get: (d) => d.invoiceNumber },
  { header: 'issuer_name', get: (d) => d.issuerName },
  { header: 'recipient_name', get: (d) => d.recipientName },
  { header: 'description', get: (d) => d.description },
  { header: 'payment_date', get: (d) => d.paymentDate },
  { header: 'payment_status', get: (d) => d.paymentStatus },
  { header: 'currency', get: (d) => d.originalCurrency },
  { header: 'net_original', get: (d) => d.netAmountOriginal },
  { header: 'vat_original', get: (d) => d.vatAmountOriginal },
  { header: 'gross_original', get: (d) => d.grossAmountOriginal },
  { header: 'exchange_rate_to_eur', get: (d) => d.exchangeRateToEur },
  { header: 'net_eur', get: (d) => d.netAmountEur },
  { header: 'vat_eur', get: (d) => d.vatAmountEur },
  { header: 'gross_eur', get: (d) => d.grossAmountEur },
  { header: 'vat_treatment', get: (d) => d.vatTreatmentCode },
  { header: 'tax_year', get: (d) => d.taxPeriodYear },
  { header: 'tax_quarter', get: (d) => d.taxPeriodQuarter },
  { header: 'review_status', get: (d) => d.reviewStatus },
  { header: 'issues', get: (d) => d.issues.map((i) => i.code).join('|') },
  { header: 'original_filename', get: (d) => d.originalFilename },
  { header: 'stored_path', get: (d) => d.storedRelativePath }
]

function buildCsv(docs: TaxDocument[]): string {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(',')]
  for (const doc of docs) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(c.get(doc))).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

function eur(value: number): string {
  return `${value.toFixed(2)} EUR`
}

function buildSummaryText(
  docs: TaxDocument[],
  period: TaxPeriod,
  settings: AppSettings
): string {
  const vat = computeVatSummary(docs, period, settings)
  const tax = computeIncomeTaxEstimate(docs, period.year, settings)
  const lines: string[] = []
  lines.push('BELEGBAR — ' + periodSlug(period))
  lines.push('='.repeat(60))
  lines.push(`${ESTIMATE_LABEL_DE}`)
  lines.push(`${ESTIMATE_LABEL_EN}`)
  lines.push('')
  lines.push('--- Umsatzsteuer / VAT ---')
  lines.push(
    `Umsatzsteuer (Ausgangsumsätze) / Output VAT: confirmed ${eur(vat.outputVat.confirmed)}, provisional ${eur(vat.outputVat.provisional)}`
  )
  lines.push(
    `Vorsteuer / Input VAT: confirmed ${eur(vat.inputVat.confirmed)}, provisional ${eur(vat.inputVat.provisional)}`
  )
  lines.push(
    `Reverse-Charge USt / RC VAT: confirmed ${eur(vat.reverseChargeVat.confirmed)}, provisional ${eur(vat.reverseChargeVat.provisional)}`
  )
  lines.push(`Geschätzte Zahllast / Estimated VAT payable: ${eur(vat.estimatedPayable)}`)
  lines.push('')
  lines.push('--- Einkommensteuer (Schätzung) / Income tax (estimate) ---')
  lines.push(`Jahr / Year: ${tax.year} (engine ${tax.engineVersion})`)
  lines.push(
    `Einnahmen / Income: confirmed ${eur(tax.recognizedIncome.confirmed)}, provisional ${eur(tax.recognizedIncome.provisional)}`
  )
  lines.push(
    `Ausgaben / Expenses: confirmed ${eur(tax.recognizedExpenses.confirmed)}, provisional ${eur(tax.recognizedExpenses.provisional)}`
  )
  lines.push(`Geschätzter Gewinn / Estimated profit: ${eur(tax.estimatedProfit)}`)
  lines.push(
    `Geschätztes zu versteuerndes Einkommen / Est. taxable income: ${eur(tax.estimatedTaxableIncome)}`
  )
  lines.push(`Geschätzte Einkommensteuer / Est. income tax: ${eur(tax.estimatedIncomeTax)}`)
  lines.push(`Solidaritätszuschlag / Solidarity surcharge: ${eur(tax.solidaritySurcharge)}`)
  lines.push(`Kirchensteuer / Church tax: ${eur(tax.churchTax)}`)
  lines.push(`Vorauszahlungen / Prepayments: ${eur(tax.prepayments)}`)
  lines.push(`Empfohlene Rücklage / Suggested reserve: ${eur(tax.suggestedReserve)}`)
  if (tax.assumptions.length > 0) {
    lines.push('')
    lines.push('Annahmen / Assumptions:')
    for (const a of tax.assumptions) lines.push(`  - ${a}`)
  }
  if (tax.incompleteItems.length > 0) {
    lines.push('')
    lines.push('Unvollständig / Incomplete:')
    for (const item of tax.incompleteItems) lines.push(`  - ${item}`)
  }
  lines.push('')
  lines.push(`Belege im Zeitraum / Documents in period: ${docs.filter((d) => documentInPeriod(d, period)).length}`)
  lines.push(`Zur Prüfung / Needing review: ${vat.revenueNeedingReview + vat.expensesNeedingReview}`)
  lines.push('')
  lines.push(`${ESTIMATE_LABEL_DE} / ${ESTIMATE_LABEL_EN}`)
  return lines.join('\n') + '\n'
}

export async function exportPeriod(deps: {
  dataDir: string
  documents: TaxDocument[]
  settings: AppSettings
  period: TaxPeriod
  format: ExportFormat
  log: Logger
}): Promise<ExportResult> {
  const paths = dataPaths(deps.dataDir)
  const inPeriod = deps.documents.filter((d) => documentInPeriod(d, deps.period))
  const base = `belegbar-export-${periodSlug(deps.period)}-${deps.format}-${timestamp()}`
  try {
    await fsp.mkdir(paths.exports, { recursive: true })
    let outPath: string
    switch (deps.format) {
      case 'csv': {
        outPath = path.join(paths.exports, `${base}.csv`)
        // BOM so Excel opens UTF-8 umlauts correctly
        await fsp.writeFile(outPath, '\uFEFF' + buildCsv(inPeriod), 'utf8')
        break
      }
      case 'json': {
        outPath = path.join(paths.exports, `${base}.json`)
        await fsp.writeFile(
          outPath,
          JSON.stringify({ period: deps.period, documents: inPeriod }, null, 2),
          'utf8'
        )
        break
      }
      case 'zip': {
        outPath = path.join(paths.exports, `${base}.zip`)
        const zip = new AdmZip()
        for (const doc of inPeriod) {
          try {
            const abs = resolveInside(deps.dataDir, ...doc.storedRelativePath.split('/'))
            zip.addLocalFile(abs, 'documents', doc.storedFilename)
          } catch {
            deps.log.warn('export_pdf_missing', { documentId: doc.id })
          }
        }
        zip.addFile(
          'metadata.json',
          Buffer.from(
            JSON.stringify({ period: deps.period, documents: inPeriod }, null, 2),
            'utf8'
          )
        )
        zip.writeZip(outPath)
        break
      }
      case 'summary': {
        outPath = path.join(paths.exports, `${base}.txt`)
        await fsp.writeFile(
          outPath,
          buildSummaryText(deps.documents, deps.period, deps.settings),
          'utf8'
        )
        break
      }
    }
    deps.log.info('export_created', { format: deps.format, count: inPeriod.length })
    return { ok: true, path: outPath }
  } catch (err) {
    deps.log.error('export_failed', {
      format: deps.format,
      code: (err as NodeJS.ErrnoException).code ?? null
    })
    return { ok: false, errorKey: 'export_failed' }
  }
}
