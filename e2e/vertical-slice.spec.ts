/**
 * End-to-end vertical slice (spec §28/§31):
 * clean launch → onboarding → import income + expense PDFs → review →
 * confirm → VAT overview → income-tax estimate → restart → data persists.
 *
 * Example PDFs are confidential local fixtures; tests copy them into a temp
 * dir first (the app moves originals by default) and skip when absent.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLES = process.env.BELEGBAR_EXAMPLES ?? path.join(ROOT, 'example')

function firstPdfIn(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const name = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()[0]
  return name ? path.join(dir, name) : null
}

// A native-text income invoice and a native-text expense receipt.
const incomeSrc = firstPdfIn(path.join(EXAMPLES, 'income'))
const expenseSrc = firstPdfIn(path.join(EXAMPLES, 'expense'))

let dataDir: string
let stageDir: string
let app: ElectronApplication
let page: Page

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [path.join(ROOT, 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      BELEGBAR_DATA_DIR: dataDir,
      NODE_ENV: 'production'
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}

async function importViaApi(direction: 'income' | 'expense', absPath: string): Promise<void> {
  // Drag-and-drop cannot carry real file paths in automation; call the same
  // preload API the drop handler uses so the full main-process pipeline runs.
  await page.evaluate(
    async ({ direction, absPath }) => {
      await window.belegbar.importFiles({
        direction,
        paths: [absPath],
        duplicateAction: 'ask'
      })
    },
    { direction, absPath }
  )
}

async function waitForDocumentCount(count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const res = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
          return res.documents.filter((d) => d.reviewStatus !== 'processing').length
        }),
      { timeout: 90_000, intervals: [500] }
    )
    .toBeGreaterThanOrEqual(count)
}

test.beforeAll(() => {
  test.skip(!incomeSrc || !expenseSrc, 'example PDFs not present on this machine')
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-e2e-'))
  stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-stage-'))
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(stageDir, { recursive: true, force: true })
})

test.describe.serial('vertical slice', () => {
  test('launches clean and completes onboarding', async () => {
    await launch()
    // Onboarding step 1: welcome — continue through all four steps.
    await expect(page.getByTestId('onboarding').or(page.locator('text=/Willkommen|Welcome/i')).first())
      .toBeVisible({ timeout: 20_000 })
    // click through however many wizard steps exist until the shell appears;
    // detect the shell via the sidebar nav — onboarding copy mentions
    // "Income", so drop-zone text is not a safe signal
    for (let step = 0; step < 8; step++) {
      const done = await page
        .getByRole('button', { name: /übersicht|overview/i })
        .first()
        .isVisible()
        .catch(() => false)
      if (done) break
      if (await page.locator('#onboarding-step-import').isVisible().catch(() => false)) {
        const importMode = page.getByRole('group', {
          name: /source files after import|quelldateien nach dem import/i
        })
        const copy = importMode.getByRole('button', { name: /^copy$|^kopieren$/i })
        const move = importMode.getByRole('button', { name: /^move$|^verschieben$/i })
        await copy.click()
        await expect(copy).toHaveAttribute('aria-pressed', 'true')
        await move.click()
        await expect(move).toHaveAttribute('aria-pressed', 'true')
      }
      const next = page
        .getByRole('button', { name: /weiter|continue|next|let.?s go|los geht|get started|fertig|finish/i })
        .first()
      await next.click()
      await page.waitForTimeout(250)
    }
    // Shell with the two drop zones appears.
    await expect(page.locator('text=/EINNAHMEN|INCOME/i').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('text=/AUSGABEN|EXPENSES/i').first()).toBeVisible()
  })

  test('imports one income and one expense PDF through the real pipeline', async () => {
    const incomeCopy = path.join(stageDir, 'e2e-income.pdf')
    const expenseCopy = path.join(stageDir, 'e2e-expense.pdf')
    fs.copyFileSync(incomeSrc!, incomeCopy)
    fs.copyFileSync(expenseSrc!, expenseCopy)

    await importViaApi('income', incomeCopy)
    await importViaApi('expense', expenseCopy)
    await waitForDocumentCount(2)

    // Move-originals default: staged copies were consumed after verified import.
    expect(fs.existsSync(incomeCopy)).toBe(false)
    expect(fs.existsSync(expenseCopy)).toBe(false)

    // Stored files exist inside app storage with generated names.
    const stored = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ limit: 10, offset: 0 })
      return res.documents.map((d) => ({
        direction: d.direction,
        storedFilename: d.storedFilename,
        invoiceDate: d.invoiceDate,
        gross: d.grossAmountOriginal,
        currency: d.originalCurrency,
        status: d.reviewStatus
      }))
    })
    expect(stored).toHaveLength(2)
    for (const d of stored) {
      expect(d.storedFilename.endsWith('.pdf')).toBe(true)
      expect(d.invoiceDate).toBeTruthy()
      expect(d.gross ?? 0).toBeGreaterThan(0)
      expect(d.currency).toBeTruthy()
    }
  })

  test('extracted values can be corrected and the document confirmed', async () => {
    const docs = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ direction: 'income', limit: 10, offset: 0 })
      return res.documents
    })
    const doc = docs[0]
    expect(doc).toBeTruthy()

    const updated = await page.evaluate(async (id) => {
      return window.belegbar.updateDocument({
        id,
        patch: { description: 'Softwareentwicklung (E2E korrigiert)' }
      })
    }, doc.id)
    expect(updated.description).toContain('E2E korrigiert')

    // Confirm both documents unless critical issues genuinely block it.
    const all = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ limit: 10, offset: 0 })
      return res.documents.map((d) => ({
        id: d.id,
        critical: d.issues.some((i) => i.severity === 'critical')
      }))
    })
    for (const d of all) {
      if (d.critical) continue
      const confirmed = await page.evaluate(
        async (id) => window.belegbar.confirmDocument(id),
        d.id
      )
      expect(confirmed.reviewStatus).toBe('confirmed')
    }

    const confirmedId = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ limit: 10, offset: 0 })
      return res.documents.find((document) => document.reviewStatus === 'confirmed')?.id ?? null
    })
    if (confirmedId) {
      const edited = await page.evaluate(async (id) => {
        return window.belegbar.updateDocument({
          id,
          patch: { description: 'Edited after confirmation (E2E)' }
        })
      }, confirmedId)
      expect(edited.reviewStatus).toBe('needs_review')
      expect(edited.userConfirmedAt).toBeNull()
      expect(edited.description).toContain('Edited after confirmation')
      if (!edited.issues.some((issue) => issue.severity === 'critical')) {
        await page.evaluate(async (id) => window.belegbar.confirmDocument(id), confirmedId)
      }
    }
  })

  test('overview, VAT summary and income-tax estimate respond with data', async () => {
    // the two fixture documents may fall into different tax years — anchor
    // all summary checks on the income document's year
    const year = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({
        direction: 'income',
        limit: 1,
        offset: 0
      })
      return res.documents[0]?.taxPeriodYear ?? new Date().getFullYear()
    })
    const overview = await page.evaluate(
      async (y) => window.belegbar.getOverview({ year: y, quarter: null, month: null }),
      year
    )
    const totalRevenue =
      overview.revenueEur.confirmed + overview.revenueEur.provisional
    expect(totalRevenue).toBeGreaterThan(0)
    expect(overview.monthly).toHaveLength(12)
    expect(overview.monthly.reduce((sum, month) => sum + month.revenueEur, 0)).toBe(
      totalRevenue
    )

    const vat = await page.evaluate(
      async (y) => window.belegbar.getVatSummary({ year: y, quarter: null, month: null }),
      year
    )
    expect(typeof vat.estimatedPayable).toBe('number')

    const est = await page.evaluate(
      async (y) => window.belegbar.getIncomeTaxEstimate(y),
      year
    )
    expect(est.engineVersion).toBeTruthy()
    expect(
      est.recognizedIncome.confirmed + est.recognizedIncome.provisional
    ).toBeGreaterThan(0)
  })

  test('income-tax UI explains the tax base and hides disabled church tax', async () => {
    await page.evaluate(async () => {
      await window.belegbar.updateSettings({
        language: 'en',
        churchTax: 'none',
        includeSolidaritySurcharge: true,
        incomeTaxPrepayments: 0,
        tourChoice: 'none'
      })
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await page.getByRole('button', { name: 'Taxes', exact: true }).click()
    await page.getByRole('tab', { name: 'Income tax' }).click()

    const calculation = page.locator('.income-calc-card')
    await expect(calculation).toContainText('Whole-year forecast')
    await expect(calculation).toContainText('Projected business profit (whole year)')
    await expect(calculation).toContainText('Projected taxable income (whole year)')
    await expect(calculation).toContainText('Suggested reserve for the whole year')
    await expect(calculation).toContainText('Solidarity surcharge')
    await expect(calculation).not.toContainText('Church tax')
    await expect(calculation).not.toContainText('Prepayments')
    await expect(calculation).toContainText(
      'Taxable income is the amount income tax is calculated from'
    )

    await page.getByRole('button', { name: 'Details' }).click()
    await expect(page.getByText('From profit to taxable income')).toBeVisible()
    await expect(page.getByText('Rules & sources')).toBeVisible()
    await expect(page.getByRole('link', { name: /Income tax · § 32a EStG/ })).toHaveAttribute(
      'href',
      'https://www.gesetze-im-internet.de/estg/__32a.html'
    )
    await expect(
      page.getByRole('link', { name: /Solidarity surcharge · §§ 3–4 SolzG/ })
    ).toBeVisible()

    const visualDir = process.env['BELEGBAR_VISUAL_DIR']
    if (visualDir) {
      fs.mkdirSync(visualDir, { recursive: true })
      await page.screenshot({
        path: path.join(visualDir, 'income-tax-details.png'),
        fullPage: true
      })
    }
  })

  test('data and documents survive an application restart', async () => {
    const before = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ limit: 10, offset: 0 })
      return res.documents.map((d) => d.id).sort()
    })
    await app.close()
    await launch()
    // No onboarding this time — straight to the shell (sidebar nav present).
    await expect(
      page.getByRole('button', { name: /übersicht|overview/i }).first()
    ).toBeVisible({ timeout: 20_000 })
    const after = await page.evaluate(async () => {
      const res = await window.belegbar.listDocuments({ limit: 10, offset: 0 })
      return res.documents.map((d) => d.id).sort()
    })
    expect(after).toEqual(before)

    // The stored PDF bytes are still readable for preview.
    const bytes = await page.evaluate(async (id) => {
      const buf = await window.belegbar.getDocumentPdf(id)
      return buf.byteLength
    }, after[0])
    expect(bytes).toBeGreaterThan(1000)
  })
})
