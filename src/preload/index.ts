/**
 * Preload: exposes the typed BelegbarApi as window.belegbar.
 * Runs sandboxed — only ipcRenderer/contextBridge/webUtils are available,
 * zod is bundled into this file (no external require at runtime).
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { BelegbarApi } from '../shared/api'
import type { ImportFileProgress } from '../shared/domain'

const api: BelegbarApi = {
  // -- import ---------------------------------------------------------------
  importFiles: (payload) => ipcRenderer.invoke(IPC.importFiles, payload),
  onImportProgress: (cb) => {
    const listener = (_event: IpcRendererEvent, progress: ImportFileProgress): void => {
      cb(progress)
    }
    ipcRenderer.on(IPC.importProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC.importProgress, listener)
    }
  },
  retryImport: (fileId) => ipcRenderer.invoke(IPC.retryImport, { fileId }),
  dismissImport: (importId) => ipcRenderer.invoke(IPC.dismissImport, { importId }),
  chooseFiles: (direction) => ipcRenderer.invoke(IPC.chooseFiles, { direction }),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) ?? ''
    } catch {
      return ''
    }
  },

  // -- documents --------------------------------------------------------------
  listDocuments: (filter) => ipcRenderer.invoke(IPC.listDocuments, filter),
  getDocument: (id) => ipcRenderer.invoke(IPC.getDocument, { id }),
  updateDocument: (payload) => ipcRenderer.invoke(IPC.updateDocument, payload),
  confirmDocument: (id) => ipcRenderer.invoke(IPC.confirmDocument, { id }),
  setPaymentDate: (payload) => ipcRenderer.invoke(IPC.setPaymentDate, payload),
  setDirection: (payload) => ipcRenderer.invoke(IPC.setDirection, payload),
  setVatTreatment: (payload) => ipcRenderer.invoke(IPC.setVatTreatment, payload),
  deleteDocument: (id, mode) =>
    ipcRenderer.invoke(IPC.deleteDocument, { id, mode: mode ?? 'trash' }),
  restoreDocument: (id) => ipcRenderer.invoke(IPC.restoreDocument, { id }),
  getDocumentPdf: (id) => ipcRenderer.invoke(IPC.getDocumentPdf, { id }),
  revealDocument: (id) => ipcRenderer.invoke(IPC.revealDocument, { id }),
  openDocumentExternal: (id) => ipcRenderer.invoke(IPC.openDocumentExternal, { id }),
  getAuditTrail: (id) => ipcRenderer.invoke(IPC.getAuditTrail, { id }),

  // -- summaries ----------------------------------------------------------------
  getOverview: (period) => ipcRenderer.invoke(IPC.getOverview, period),
  getVatSummary: (period) => ipcRenderer.invoke(IPC.getVatSummary, period),
  getIncomeTaxEstimate: (year) => ipcRenderer.invoke(IPC.getIncomeTaxEstimate, { year }),

  // -- settings -------------------------------------------------------------
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),

  // -- data -----------------------------------------------------------------
  createBackup: () => ipcRenderer.invoke(IPC.createBackup),
  restoreBackup: () => ipcRenderer.invoke(IPC.restoreBackup),
  exportPeriod: (payload) => ipcRenderer.invoke(IPC.exportPeriod, payload),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  getSystemLocale: () => ipcRenderer.invoke(IPC.getSystemLocale)
}

contextBridge.exposeInMainWorld('belegbar', api)
