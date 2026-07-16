import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-tour-e2e-'))
  app = await electron.launch({
    args: [path.join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, BELEGBAR_DATA_DIR: dataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('mini tour remains navigable when conditional targets are empty', async () => {
  const onboarding = page.getByTestId('onboarding')
  await expect(onboarding).toBeVisible({ timeout: 20_000 })

  for (let step = 0; step < 8; step++) {
    if (!(await onboarding.isVisible().catch(() => false))) break
    await onboarding
      .getByRole('button', {
        name: /weiter|continue|next|los geht|let.?s go|get started|fertig|finish/i
      })
      .first()
      .click()
    await page.waitForTimeout(150)
  }

  await expect(onboarding).toBeHidden()
  await page.getByRole('button', { name: /mini/i }).click()

  const tour = page.locator('.tour-card')
  await expect(tour).toContainText(/Import documents|Belege importieren/i)
  await expect(tour).toContainText(/Stop 1 of 3|Stopp 1 von 3/i)

  await tour.getByRole('button', { name: /next|weiter/i }).click()
  await expect(tour).toContainText(/Needs your attention|Braucht deine Aufmerksamkeit/i)
  await expect(tour).toContainText(/Stop 2 of 3|Stopp 2 von 3/i)

  await tour.getByRole('button', { name: /next|weiter/i }).click()
  await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()
  await expect(tour).toContainText(/Review & confirm|Prüfen & bestätigen/i)
  await expect(tour).toContainText(/Stop 3 of 3|Stopp 3 von 3/i)

  await tour.getByRole('button', { name: /done|fertig/i }).click()
  await expect(tour).toBeHidden()
})
