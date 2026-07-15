/**
 * Local-only regression test against real (confidential) fixture texts.
 * Set BELEGBAR_FIXTURE_TEXTS to a directory of .txt dumps to enable;
 * skipped cleanly otherwise. Files prefixed income__ parse as income.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseInvoiceText } from '../../src/core/parsing/parse-invoice'

const dir = process.env['BELEGBAR_FIXTURE_TEXTS']

describe.skipIf(!dir)('local fixture texts', () => {
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
    console.log(`fixture pass rate: ${pass}/${files.length} = ${(rate * 100).toFixed(1)}%`)
    expect(rate).toBeGreaterThanOrEqual(0.85)
  })

  it('secondary fields are clean and confidently extracted', () => {
    const files = readdirSync(dir as string).filter((n) => n.endsWith('.txt'))
    expect(files.length).toBeGreaterThan(0)

    // junk that must never surface as a description (addresses, legal boilerplate)
    const junkDescription =
      /reverse charge|directive|steuerschuldnerschaft|incoterms|^germany$|^deutschland$|^ireland$|str(?:\.|aße|asse)?\s+\d+\s*$|^\d[\d\s-]*$/i

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
      `secondary fields: ${confident}/${extracted} at >=0.85 confidence; ` +
        `${missingDescription} missing descriptions${weak.length > 0 ? `; weak: ${weak.slice(0, 10).join(', ')}` : ''}`
    )
    // most fixtures must yield a description, and extracted secondary values
    // must overwhelmingly be confident enough for a ✓ chip in the review UI
    expect(missingDescription / files.length).toBeLessThanOrEqual(0.1)
    expect(confident / Math.max(1, extracted)).toBeGreaterThanOrEqual(0.85)
  })
})
