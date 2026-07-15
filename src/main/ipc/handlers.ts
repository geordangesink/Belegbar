/**
 * IPC surface: every channel from src/shared/ipc.ts is registered here with
 * zod validation. Handlers throw Error whose message is a stable errorKey
 * ('invalid_payload', 'not_found', 'critical_issues', 'internal_error', …)
 * which the renderer maps to i18n strings.
 */
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z, ZodError } from 'zod'
import {
  IPC,
  deleteDocumentSchema,
  documentIdSchema,
  exportPeriodSchema,
  importFilesSchema,
  listDocumentsSchema,
  periodSchema,
  reExtractSchema,
  setDirectionSchema,
  setPaymentDateSchema,
  setVatTreatmentSchema,
  updateDocumentSchema,
  updateSettingsSchema,
  yearSchema,
  directionSchema
} from '@shared/ipc'
import type { AppSettings } from '@shared/domain'
import {
  computeIncomeTaxEstimate,
  computeOverview,
  computeVatSummary
} from '@core/summary/summaries'
import type { DbHandle } from '../db/connection'
import type { Repositories } from '../db/repository'
import type { ImportPipeline } from '../import/pipeline'
import type { DocumentService } from '../documents/service'
import type { Logger } from '../log'
import { createBackup, restoreBackup } from '../data/backup'
import { exportPeriod } from '../data/export'
import { dataPaths } from '../storage/paths'

const retryImportSchema = z.object({ fileId: z.string().min(1) })
const dismissImportSchema = z.object({ importId: z.string().min(1) })
const chooseFilesSchema = z.object({ direction: directionSchema })

export interface HandlerContext {
  dataDir: string
  dbHandle: DbHandle
  repos: Repositories
  pipeline: ImportPipeline
  documents: DocumentService
  log: Logger
  getWindow(): BrowserWindow | null
  /** used by restoreBackup to shut the app down cleanly before relaunch */
  prepareForRestore(): Promise<void>
}

const ERROR_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export function registerIpcHandlers(ctx: HandlerContext): void {
  function handle<S extends z.ZodTypeAny>(
    channel: string,
    schema: S | null,
    fn: (payload: z.infer<S>) => unknown
  ): void {
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      try {
        const payload = schema ? schema.parse(raw) : (undefined as z.infer<S>)
        return await fn(payload)
      } catch (err) {
        if (err instanceof ZodError) {
          ctx.log.warn('ipc_invalid_payload', { channel })
          throw new Error('invalid_payload')
        }
        if (err instanceof Error && ERROR_KEY_PATTERN.test(err.message)) {
          throw err // stable error key — renderer translates
        }
        ctx.log.error('ipc_internal_error', {
          channel,
          name: err instanceof Error ? err.name : typeof err
        })
        throw new Error('internal_error')
      }
    })
  }

  // -- import ---------------------------------------------------------------

  handle(IPC.importFiles, importFilesSchema, (payload) => ctx.pipeline.start(payload))
  handle(IPC.retryImport, retryImportSchema, (p) => ctx.pipeline.retry(p.fileId))
  handle(IPC.dismissImport, dismissImportSchema, (p) => ctx.pipeline.dismiss(p.importId))

  handle(IPC.chooseFiles, chooseFilesSchema, async () => {
    const window = ctx.getWindow()
    const options = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  // -- documents ------------------------------------------------------------

  handle(IPC.listDocuments, listDocumentsSchema, (filter) =>
    ctx.repos.documents.list(filter)
  )
  handle(IPC.getDocument, documentIdSchema, (p) => ctx.repos.documents.getById(p.id))
  handle(IPC.updateDocument, updateDocumentSchema, (p) => ctx.documents.update(p))
  handle(IPC.confirmDocument, documentIdSchema, (p) => ctx.documents.confirm(p.id))
  handle(IPC.setPaymentDate, setPaymentDateSchema, (p) =>
    ctx.documents.setPaymentDate(p.ids, p.mode, p.date)
  )
  handle(IPC.setDirection, setDirectionSchema, (p) =>
    ctx.documents.setDirection(p.ids, p.direction)
  )
  handle(IPC.setVatTreatment, setVatTreatmentSchema, (p) =>
    ctx.documents.setVatTreatment(p.id, p.code, p.reason)
  )
  handle(IPC.reExtractDocuments, reExtractSchema, (p) => ctx.pipeline.reExtract(p.ids))
  handle(IPC.deleteDocument, deleteDocumentSchema, (p) => ctx.documents.delete(p.id, p.mode))
  handle(IPC.restoreDocument, documentIdSchema, (p) => ctx.documents.restore(p.id))

  handle(IPC.getDocumentPdf, documentIdSchema, async (p) => {
    const bytes = await ctx.documents.getPdfBytes(p.id)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  })

  // paths always come from the DB — the renderer never passes one
  handle(IPC.revealDocument, documentIdSchema, (p) => {
    const doc = ctx.repos.documents.getById(p.id)
    if (!doc) throw new Error('not_found')
    shell.showItemInFolder(ctx.documents.absolutePathOf(doc))
  })
  handle(IPC.openDocumentExternal, documentIdSchema, async (p) => {
    const doc = ctx.repos.documents.getById(p.id)
    if (!doc) throw new Error('not_found')
    const errorMessage = await shell.openPath(ctx.documents.absolutePathOf(doc))
    if (errorMessage) throw new Error('open_failed')
  })

  handle(IPC.getAuditTrail, documentIdSchema, (p) => ctx.repos.audit.listByDocument(p.id))

  // -- summaries ------------------------------------------------------------

  handle(IPC.getOverview, periodSchema, (period) =>
    computeOverview(ctx.repos.documents.listAllActive(), period, ctx.repos.settings.get())
  )
  handle(IPC.getVatSummary, periodSchema, (period) =>
    computeVatSummary(ctx.repos.documents.listAllActive(), period, ctx.repos.settings.get())
  )
  handle(IPC.getIncomeTaxEstimate, yearSchema, (p) =>
    computeIncomeTaxEstimate(
      ctx.repos.documents.listAllActive(),
      p.year,
      ctx.repos.settings.get()
    )
  )

  // -- settings -------------------------------------------------------------

  handle(IPC.getSettings, null, () => ctx.repos.settings.get())
  handle(IPC.updateSettings, updateSettingsSchema, (patch) => {
    const previous = ctx.repos.settings.get()
    const next = ctx.repos.settings.update(patch)
    const changedKeys = (Object.keys(patch) as (keyof AppSettings)[]).filter(
      (key) => previous[key] !== next[key]
    )
    if (changedKeys.length > 0) {
      ctx.repos.audit.append({
        documentId: null,
        eventType: 'settings_change',
        previousValue: Object.fromEntries(changedKeys.map((k) => [k, previous[k]])),
        nextValue: Object.fromEntries(changedKeys.map((k) => [k, next[k]])),
        source: 'user'
      })
    }
    return next
  })

  // -- data management --------------------------------------------------------

  handle(IPC.createBackup, null, () =>
    createBackup({
      dataDir: ctx.dataDir,
      dbHandle: ctx.dbHandle,
      appVersion: app.getVersion(),
      log: ctx.log
    })
  )

  handle(IPC.restoreBackup, null, async () => {
    const window = ctx.getWindow()
    const options = {
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Belegbar Backup', extensions: ['zip'] }]
    }
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, errorKey: 'cancelled' }
    }
    const zipPath = picked.filePaths[0]!
    await ctx.prepareForRestore() // closes DB + stops workers
    const result = await restoreBackup({ dataDir: ctx.dataDir, zipPath, log: ctx.log })
    // relaunch either way: on success to load the restored data, on failure
    // to reopen the (untouched) current data with a fresh DB handle.
    // Give the IPC response time to reach the renderer first.
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 500)
    return result
  })

  handle(IPC.exportPeriod, exportPeriodSchema, async (p) => {
    const result = await exportPeriod({
      dataDir: ctx.dataDir,
      documents: ctx.repos.documents.listAllActive(),
      settings: ctx.repos.settings.get(),
      period: p.period,
      format: p.format,
      log: ctx.log
    })
    if (result.ok && result.path) shell.showItemInFolder(result.path)
    return result
  })

  handle(IPC.openDataFolder, null, async () => {
    await shell.openPath(dataPaths(ctx.dataDir).root)
  })

  handle(IPC.getSystemLocale, null, () => app.getLocale())
}
