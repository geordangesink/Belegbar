/**
 * Local-only regression test against real (confidential) fixture texts.
 * Two corpora are supported, each enabled by its own env var and skipped
 * cleanly when unset:
 *   BELEGBAR_FIXTURE_TEXTS        — PyMuPDF text dumps (legacy corpus)
 *   BELEGBAR_FIXTURE_TEXTS_PDFJS  — pdf.js + tesseract dumps (production-identical)
 * Files prefixed income__ parse as income.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseInvoiceText } from '../../src/core/parsing/parse-invoice'

const corpora = [
  { label: 'pymupdf', dir: process.env['BELEGBAR_FIXTURE_TEXTS'] },
  { label: 'pdfjs', dir: process.env['BELEGBAR_FIXTURE_TEXTS_PDFJS'] }
] as const

for (const corpus of corpora) {
  const dir = corpus.dir

  describe.skipIf(!dir)(`local fixture texts (${corpus.label})`, () => {
    it('extracts date, currency and an amount from >=85% of fixtures', () => {
      const files = readdirSync(dir as string).filter((n) => n.endsWith('.txt'))
      expect(files.length).toBeGreaterThan(0)

      interface Row {
        file: string
        date: string
        currency: string
        gross: string
        net: string
        ok: boolean
        issues: string
      }
      const rows: Row[] = []
      let pass = 0
      for (const file of files) {
        const text = readFileSync(join(dir as string, file), 'utf8')
        const direction = file.startsWith('income__') ? 'income' : 'expense'
        const result = parseInvoiceText(text, {
          direction,
          ownName: 'Geordan Gesink',
          ocrUsed: false,
          ocrPages: []
        })
        const ok =
          result.invoiceDate.value !== null &&
          result.currency.value !== null &&
          (result.grossAmount.value !== null || result.netAmount.value !== null)
        if (ok) pass++
        rows.push({
          file,
          date: result.invoiceDate.value ?? '-',
          currency: result.currency.value ?? '-',
          gross: result.grossAmount.value?.toFixed(2) ?? '-',
          net: result.netAmount.value?.toFixed(2) ?? '-',
          ok,
          issues: result.issues.map((i) => i.code).join(',')
        })
      }

      // eslint-disable-next-line no-console
      console.table(rows)
      const rate = pass / files.length
      // eslint-disable-next-line no-console
      console.log(`[${corpus.label}] fixture pass rate: ${pass}/${files.length} = ${(rate * 100).toFixed(1)}%`)
      expect(rate).toBeGreaterThanOrEqual(0.85)
    })

    it('headline fields are correct-shaped and confident (calibration gate)', () => {
      const files = readdirSync(dir as string).filter((n) => n.endsWith('.txt'))
      expect(files.length).toBeGreaterThan(0)

      // >=95% of extracted (non-null) headline values must carry >=0.85
      // confidence — anything below shows as a review chip in the UI
      const headline = ['invoiceNumber', 'invoiceDate', 'currency', 'grossAmount'] as const
      let extracted = 0
      let confident = 0
      const weak: string[] = []
      // label text must never leak into extracted values
      const labelEcho =
        /^(?:invoice|receipt|rechnungs?|beleg|barverkauf|order|bestell|kunden|auftrags?)[a-zäöü]*[-\s]?(?:number|nummer|nr|no|date|datum)?\.?\s*[:#]/i
      for (const file of files) {
        const text = readFileSync(join(dir as string, file), 'utf8')
        const direction = file.startsWith('income__') ? 'income' : 'expense'
        const result = parseInvoiceText(text, {
          direction,
          ownName: 'Geordan Gesink',
          ocrUsed: false,
          ocrPages: []
        })
        for (const field of headline) {
          const f = result[field]
          if (f.value === null) continue
          extracted++
          if (f.confidence >= 0.85) confident++
          else weak.push(`${file}:${field}=${String(f.value)}@${f.confidence}`)
        }
        const no = result.invoiceNumber.value
        if (no !== null) {
          expect(no, `${file}: label echo in invoice number "${no}"`).not.toMatch(labelEcho)
          expect(no, `${file}: control chars in invoice number`).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[${corpus.label}] headline fields: ${confident}/${extracted} at >=0.85` +
          `${weak.length > 0 ? `; weak: ${weak.slice(0, 10).join(', ')}` : ''}`
      )
      expect(confident / Math.max(1, extracted)).toBeGreaterThanOrEqual(0.95)
    })

    it('secondary fields are clean and confidently extracted', () => {
      const files = readdirSync(dir as string).filter((n) => n.endsWith('.txt'))
      expect(files.length).toBeGreaterThan(0)

      // junk that must never surface as a description (addresses, legal boilerplate)
      const junkDescription =
        /reverse charge|directive|steuerschuldnerschaft|incoterms|^germany$|^deutschland$|^ireland$|str(?:\.|aße|asse)?\s+\d+\s*$|^\d[\d\s-]*$|\bUST-?ID\b|^[A-ZÄÖÜ .-]+,\s*\d{4,5}$/i

      const secondary = [
        'invoiceNumber',
        'description',
        'issuerName',
        'recipientName',
        'dueDate',
        'serviceDateFrom',
        'serviceDateTo',
        'netAmount',
        'vatAmount'
      ] as const

      let extracted = 0
      let confident = 0
      const weak: string[] = []
      let missingDescription = 0
      for (const file of files) {
        const text = readFileSync(join(dir as string, file), 'utf8')
        const direction = file.startsWith('income__') ? 'income' : 'expense'
        const result = parseInvoiceText(text, {
          direction,
          ownName: 'Geordan Gesink',
          ocrUsed: false,
          ocrPages: []
        })
        const desc = result.description.value
        if (desc === null) missingDescription++
        else expect(desc, `${file}: junk description "${desc}"`).not.toMatch(junkDescription)
        for (const field of secondary) {
          const f = result[field]
          if (f.value === null) continue
          extracted++
          if (f.confidence >= 0.85) confident++
          else weak.push(`${file}:${field}=${String(f.value)}@${f.confidence}`)
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[${corpus.label}] secondary fields: ${confident}/${extracted} at >=0.85 confidence; ` +
          `${missingDescription} missing descriptions${weak.length > 0 ? `; weak: ${weak.slice(0, 10).join(', ')}` : ''}`
      )
      // most fixtures must yield a description, and extracted secondary values
      // must overwhelmingly be confident enough for a ✓ chip in the review UI
      expect(missingDescription / files.length).toBeLessThanOrEqual(0.1)
      expect(confident / Math.max(1, extracted)).toBeGreaterThanOrEqual(0.85)
    })
  })
}
