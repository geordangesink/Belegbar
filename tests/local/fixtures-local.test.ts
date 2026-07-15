/**
 * Local-only regression test against real (confidential) fixture texts.
 * Set STEUERFACH_FIXTURE_TEXTS to a directory of .txt dumps to enable;
 * skipped cleanly otherwise. Files prefixed income__ parse as income.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseInvoiceText } from '../../src/core/parsing/parse-invoice'

const dir = process.env['STEUERFACH_FIXTURE_TEXTS']

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
})
