import { _electron as electron } from '@playwright/test'
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLES = process.env.BELEGBAR_EXAMPLES ?? path.join(ROOT, 'example')

function firstPdfIn(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const filename = fs
    .readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith('.pdf'))
    .sort()[0]
  return filename ? path.join(dir, filename) : null
}

const sources = [
  { direction: 'income' as const, path: firstPdfIn(path.join(EXAMPLES, 'income')) },
  { direction: 'expense' as const, path: firstPdfIn(path.join(EXAMPLES, 'expense')) }
].filter((source): source is { direction: 'income' | 'expense'; path: string } => source.path !== null)

test('Documents retains filters and supports safe single and bulk actions', async () => {
  test.skip(sources.length === 0, 'example PDFs not present on this machine')
  test.setTimeout(180_000)

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-documents-e2e-'))
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-documents-stage-'))
  const app = await electron.launch({
    args: [path.join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, BELEGBAR_DATA_DIR: dataDir, NODE_ENV: 'production' }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const onboarding = page.getByTestId('onboarding')
    await expect(onboarding).toBeVisible({ timeout: 20_000 })
    for (let step = 0; step < 5; step++) {
      await onboarding
        .getByRole('button', {
          name: /weiter|continue|next|los geht|let.?s go|get started|fertig|finish/i
        })
        .first()
        .click()
      await page.waitForTimeout(100)
    }
    await expect(onboarding).toBeHidden()
    await page.getByRole('button', { name: /no tour|keine tour/i }).click()

    for (const [index, source] of sources.entries()) {
      const stagedPath = path.join(stageDir, `${index}-${source.direction}.pdf`)
      fs.copyFileSync(source.path, stagedPath)
      await page.evaluate(
        ({ direction, stagedPath }) =>
          window.belegbar.importFiles({
            direction,
            paths: [stagedPath],
            duplicateAction: 'ask'
          }),
        { direction: source.direction, stagedPath }
      )
    }
    for (let index = 0; index < 3; index++) {
      const source = sources[0]!
      const stagedPath = path.join(stageDir, `extra-${index}-${source.direction}.pdf`)
      fs.copyFileSync(source.path, stagedPath)
      await page.evaluate(
        ({ direction, stagedPath }) =>
          window.belegbar.importFiles({
            direction,
            paths: [stagedPath],
            duplicateAction: 'import_anyway'
          }),
        { direction: source.direction, stagedPath }
      )
    }
    const expectedDocuments = sources.length + 3

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const result = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
            return result.documents.filter((document) => document.reviewStatus !== 'processing').length
          }),
        { timeout: 90_000, intervals: [500] }
      )
      .toBe(expectedDocuments)

    const importPanel = page.locator('.import-panel')
    await expect(
      importPanel.getByRole('button', { name: /edit document|beleg bearbeiten/i }).first()
    ).toBeVisible()
    await importPanel
      .getByRole('button', { name: /^(delete|löschen):/i })
      .first()
      .click()
    const importDeleteDialog = page.getByRole('dialog', {
      name: /delete document|beleg löschen/i
    })
    await expect(importDeleteDialog).toBeVisible()
    await importDeleteDialog
      .getByRole('button', { name: /^cancel$|^abbrechen$/i })
      .click()

    const target = await page.evaluate(async () => {
      const result = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
      const counts = new Map<string, number>()
      for (const document of result.documents) {
        const key = `${document.taxPeriodYear ?? 'none'}:${document.direction}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const largestGroup = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      return (
        result.documents.find(
          (document) =>
            `${document.taxPeriodYear ?? 'none'}:${document.direction}` === largestGroup
        ) ?? result.documents[0]
      )
    })
    expect(target).toBeTruthy()
    if (!target) throw new Error('Imported document missing')

    await page.getByRole('button', { name: /documents|belege/i }).first().click()
    await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()

    const yearSelect = page.getByRole('combobox', { name: /year|jahr/i })
    const yearAvailable = await yearSelect.locator('option').evaluateAll(
      (options, year) => options.some((option) => option.getAttribute('value') === String(year)),
      target.taxPeriodYear
    )
    if (yearAvailable) await yearSelect.selectOption(String(target.taxPeriodYear))
    await page.getByRole('button', { name: /^year$|^jahr$/i }).click()

    const directionSelect = page.getByRole('combobox', { name: /type|art/i })
    const sortSelect = page.getByRole('combobox', { name: /sort documents|belege sortieren/i })
    await directionSelect.selectOption(target.direction)
    await sortSelect.selectOption('oldest')

    const rows = page.locator('.doc-list .doc-row:not(.skeleton-row)')
    if (!yearAvailable) {
      await page.getByRole('button', { name: /show all years|alle jahre anzeigen/i }).click()
    }
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })

    const statusFilter = page.locator('.attention-filters .attn-chip').first()
    const statusFilterLabel = await statusFilter.getAttribute('aria-label')
    expect(statusFilterLabel).toBeTruthy()
    await statusFilter.click()
    await expect(statusFilter).toHaveAttribute('aria-pressed', 'true')

    await rows.first().getByRole('button', { name: /open|öffnen/i }).click()
    await expect(page.locator('.review-layout')).toBeVisible({ timeout: 20_000 })
    const reviewActions = page.locator('.review-actions-menu')
    await reviewActions.locator('summary').click()
    await expect(
      reviewActions.getByRole('button', { name: /save a copy|kopie speichern/i })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^back$|^zurück$/i }).first().click()

    await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()
    await expect(directionSelect).toHaveValue(target.direction)
    await expect(sortSelect).toHaveValue('oldest')
    const restoredStatusFilter = page.getByRole('button', {
      name: statusFilterLabel as string,
      exact: true
    })
    await expect(restoredStatusFilter).toHaveAttribute('aria-pressed', 'true')

    await restoredStatusFilter.click()
    await directionSelect.selectOption('')
    await expect(rows.first()).toBeVisible()

    const visualDir = process.env['BELEGBAR_VISUAL_DIR']
    if (visualDir) {
      fs.mkdirSync(visualDir, { recursive: true })
      await page.screenshot({
        path: path.join(visualDir, 'document-actions.png'),
        fullPage: true
      })
    }

    const eligibleRows = page.locator(
      '.doc-list .doc-row:not(.skeleton-row):not(:has(.attn-critical)):not(:has(.attn-confirmed))'
    )
    const criticalRows = page.locator(
      '.doc-list .doc-row:not(.skeleton-row):has(.attn-critical)'
    )

    if ((await eligibleRows.count()) > 0) {
      const confirmedBefore = await page.evaluate(async () => {
        const result = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
        return result.documents.filter((document) => document.reviewStatus === 'confirmed').length
      })
      await eligibleRows.first().getByRole('checkbox').check()

      const bulkToolbar = page.getByRole('toolbar', { name: /selected|ausgewählt/i })
      const bulkConfirm = bulkToolbar.getByRole('button', {
        name: /^confirm$|^bestätigen$/i
      })
      await expect(bulkConfirm).toBeEnabled()
      await bulkConfirm.click()
      await expect(page.locator('.review-layout')).toBeHidden()
      await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()

      const warningDialog = page.getByRole('dialog', {
        name: /confirm documents|belege bestätigen/i
      })
      if (await warningDialog.isVisible().catch(() => false)) {
        await warningDialog
          .getByRole('button', { name: /^confirm$|^bestätigen$/i })
          .click()
      }

      await expect
        .poll(() =>
          page.evaluate(async () => {
            const result = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
            return result.documents.filter((document) => document.reviewStatus === 'confirmed').length
          })
        )
        .toBe(confirmedBefore + 1)
      await expect(page.locator('.review-layout')).toBeHidden()
    } else {
      await expect(criticalRows.first()).toBeVisible()
      await criticalRows.first().getByRole('checkbox').check()
      const bulkConfirm = page
        .getByRole('toolbar', { name: /selected|ausgewählt/i })
        .getByRole('button', { name: /^confirm$|^bestätigen$/i })
      await expect(bulkConfirm).toBeDisabled()
      await expect(bulkConfirm).toHaveAttribute(
        'title',
        /resolve critical issues before confirming|löse zuerst die kritischen probleme/i
      )
      await expect(page.locator('.review-layout')).toBeHidden()
    }

    const selectedToolbar = page.getByRole('toolbar', { name: /selected|ausgewählt/i })
    if (await selectedToolbar.isVisible().catch(() => false)) {
      await expect(
        selectedToolbar.getByRole('button', { name: /save a copy|kopie speichern/i })
      ).toBeVisible()
      await selectedToolbar
        .getByRole('button', { name: /^close$|^schließen$/i })
        .click()
    }

    const singleDeleteId = await rows.first().getAttribute('data-document-id')
    expect(singleDeleteId).toBeTruthy()
    if (!singleDeleteId) throw new Error('Single-delete target missing')

    const singleRow = page.locator(`.doc-row[data-document-id="${singleDeleteId}"]`)
    if (yearAvailable) {
      await page.evaluate(
        (id) => window.belegbar.updateDocument({ id, patch: { invoiceDate: null } }),
        singleDeleteId
      )
      await sortSelect.selectOption('newest')
      await expect(singleRow).toBeVisible()
      await sortSelect.selectOption('oldest')
    }
    await expect(singleRow).toBeVisible()
    await singleRow.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await singleRow
      .getByRole('button', { name: /^(delete|löschen):/i })
      .click()
    const singleDialog = page.getByRole('dialog', {
      name: /delete document|beleg löschen/i
    })
    await expect(singleDialog).toBeVisible()
    await singleDialog
      .getByRole('button', { name: /^cancel$|^abbrechen$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const document = await window.belegbar.getDocument(id)
          return document?.deletedAt ?? null
        }, singleDeleteId)
      )
      .toBeNull()

    await singleRow
      .getByRole('button', { name: /^(delete|löschen):/i })
      .click()
    await singleDialog
      .getByRole('button', { name: /^delete$|^löschen$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const document = await window.belegbar.getDocument(id)
          return typeof document?.deletedAt === 'string'
        }, singleDeleteId)
      )
      .toBe(true)
    await expect(page.locator('.review-layout')).toBeHidden()

    const visibleIds = await rows.evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('data-document-id'))
        .filter((id): id is string => id !== null)
    )
    const bulkTargets = {
      ids: visibleIds.slice(0, 2),
      untouched: visibleIds[2] ?? null
    }
    expect(bulkTargets.ids).toHaveLength(2)
    expect(bulkTargets.untouched).toBeTruthy()

    for (const id of bulkTargets.ids) {
      await page
        .locator(`.doc-row[data-document-id="${id}"]`)
        .getByRole('checkbox')
        .check()
    }
    const bulkDeleteToolbar = page.getByRole('toolbar', {
      name: /2 selected|2 ausgewählt/i
    })
    await bulkDeleteToolbar
      .getByRole('button', { name: /^delete$|^löschen$/i })
      .click()
    const bulkDeleteDialog = page.getByRole('dialog', {
      name: /delete documents|belege löschen/i
    })
    await expect(bulkDeleteDialog).toContainText(/2 documents|2 belege/i)
    await bulkDeleteDialog
      .getByRole('button', { name: /^cancel$|^abbrechen$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async (ids) => {
          const result = await window.belegbar.listDocuments({ limit: 100, offset: 0 })
          return ids.every((id) => result.documents.some((document) => document.id === id))
        }, bulkTargets.ids)
      )
      .toBe(true)

    await bulkDeleteToolbar
      .getByRole('button', { name: /^delete$|^löschen$/i })
      .click()
    await bulkDeleteDialog
      .getByRole('button', { name: /^delete$|^löschen$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async ({ ids, untouched }) => {
          const result = await window.belegbar.listDocuments({
            includeDeleted: true,
            limit: 100,
            offset: 0
          })
          const deleted = ids.every(
            (id) => result.documents.find((document) => document.id === id)?.deletedAt !== null
          )
          const activeUntouched =
            untouched !== null &&
            result.documents.find((document) => document.id === untouched)?.deletedAt === null
          return deleted && activeUntouched
        }, bulkTargets)
      )
      .toBe(true)
    await expect(page.locator('.review-layout')).toBeHidden()

    const deletedIds = [singleDeleteId, ...bulkTargets.ids]
    await expect(importPanel.locator('.import-row')).toHaveCount(
      expectedDocuments - deletedIds.length
    )

    const sidebar = page.locator('.sidebar')
    await sidebar.getByRole('button', { name: /overview|übersicht/i }).click()
    await expect(page.getByRole('heading', { name: /overview|übersicht/i })).toBeVisible()
    for (const id of deletedIds) {
      await expect(page.locator(`.recent-section [data-document-id="${id}"]`)).toHaveCount(0)
    }

    const remainingResult = await page.evaluate(async () => {
      const active = await window.belegbar.listDocuments({ limit: 500, offset: 0 })
      return window.belegbar.deleteDocuments(
        active.documents.map((document) => document.id),
        'trash'
      )
    })
    expect(remainingResult.failed).toBe(0)

    await sidebar.getByRole('button', { name: /documents|belege/i }).click()
    await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()
    await sidebar.getByRole('button', { name: /overview|übersicht/i }).click()
    await expect(page.getByRole('heading', { name: /overview|übersicht/i })).toBeVisible()
    await expect(page.locator('[data-tour="attention"]')).toHaveCount(0)
    await expect(page.locator('.recent-section .doc-row')).toHaveCount(0)

    await sidebar.getByRole('button', { name: /documents|belege/i }).click()
    await expect(page.getByRole('heading', { name: /documents|belege/i })).toBeVisible()
    const emptyTrashButton = page.locator('.trash-empty-button')
    await expect(emptyTrashButton).toBeVisible()

    const trashedBefore = await page.evaluate(async () => {
      const result = await window.belegbar.listDocuments({
        includeDeleted: true,
        limit: 500,
        offset: 0
      })
      return result.total
    })
    expect(trashedBefore).toBe(expectedDocuments)

    await emptyTrashButton.click()
    const emptyTrashDialog = page.getByRole('dialog', {
      name: /empty trash|papierkorb leeren/i
    })
    await expect(emptyTrashDialog).toContainText(/all periods|allen zeiträumen/i)
    await emptyTrashDialog
      .getByRole('button', { name: /^cancel$|^abbrechen$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await window.belegbar.listDocuments({
            includeDeleted: true,
            limit: 500,
            offset: 0
          })
          return result.total
        })
      )
      .toBe(trashedBefore)

    await emptyTrashButton.click()
    await emptyTrashDialog
      .getByRole('button', { name: /^empty trash$|^papierkorb leeren$/i })
      .click()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = await window.belegbar.listDocuments({
            includeDeleted: true,
            limit: 500,
            offset: 0
          })
          return result.total
        })
      )
      .toBe(0)
    await expect(emptyTrashButton).toBeHidden()
    await expect(importPanel).toBeHidden()
  } finally {
    await app.close().catch(() => undefined)
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(stageDir, { recursive: true, force: true })
  }
})
