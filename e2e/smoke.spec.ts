/**
 * Fixture-free smoke test for CI: the packaged bundles boot, the database
 * initializes, onboarding completes, the shell renders and settings persist.
 * (The full vertical-slice suite needs the confidential local example PDFs
 * and skips itself when they are absent — this one always runs.)
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let dataDir: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-smoke-'))
  app = await electron.launch({
    args: [path.join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, BELEGBAR_DATA_DIR: dataDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('boots, completes onboarding, persists a setting', async () => {
  // walk the onboarding wizard until the shell's sidebar appears
  for (let step = 0; step < 10; step++) {
    const done = await page
      .getByRole('button', { name: /übersicht|overview/i })
      .first()
      .isVisible()
      .catch(() => false)
    if (done) break
    await page
      .getByRole('button', { name: /weiter|continue|next|let.?s go|los geht|fertig|finish/i })
      .first()
      .click()
    await page.waitForTimeout(250)
  }
  await expect(page.getByRole('button', { name: /übersicht|overview/i }).first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /einnahmen & ausgaben|income & expenses/i })
  ).toBeVisible()
  await expect(page.locator('[data-overview-chart] [data-series]')).toHaveCount(6)

  // the database round-trips: flip a setting and read it back
  const settings = await page.evaluate(() =>
    window.belegbar.updateSettings({ theme: 'dark' })
  )
  expect(settings.theme).toBe('dark')
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeDefined()

  // empty-state summaries respond without documents
  const year = new Date().getFullYear()
  const overview = await page.evaluate(
    (y) => window.belegbar.getOverview({ year: y, quarter: null, month: null }),
    year
  )
  expect(overview.revenueEur.confirmed).toBe(0)
  expect(overview.monthly).toHaveLength(12)
  expect(overview.monthly.every((month) => month.revenueEur === 0 && month.expensesEur === 0)).toBe(
    true
  )
})
