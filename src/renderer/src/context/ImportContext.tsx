import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { DocumentDirection, ImportFileProgress, ProcessingStatus } from '@shared/domain'
import { api, errorToKey } from '../lib/api'
import { emitDataChanged } from '../lib/bus'
import { useToast } from './ToastContext'
import { useTranslation } from 'react-i18next'

export interface ImportRow {
  fileId: string
  importId: string
  originalFilename: string
  storedFilename: string | null
  documentId: string | null
  direction: DocumentDirection
  status: ProcessingStatus
  issueCount: number
  progress: number | null
  errorKey: string | null
}

export const TERMINAL_STATUSES: ReadonlySet<ProcessingStatus> = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'duplicate'
])

interface ImportCtx {
  rows: ImportRow[]
  visible: boolean
  startImport(direction: DocumentDirection, paths: string[]): Promise<void>
  retry(fileId: string): Promise<void>
  dismiss(): Promise<void>
}

const Ctx = createContext<ImportCtx | null>(null)

export function useImport(): ImportCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useImport outside ImportProvider')
  return ctx
}

export function ImportProvider({ children }: { children: ReactNode }): ReactNode {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [importIds, setImportIds] = useState<Set<string>>(new Set())
  const toast = useToast()
  const { t } = useTranslation()

  useEffect(() => {
    return api().onImportProgress((p: ImportFileProgress) => {
      setRows((current) => {
        const idx = current.findIndex((r) => r.fileId === p.fileId)
        const next: ImportRow = {
          fileId: p.fileId,
          importId: p.importId,
          originalFilename: p.originalFilename,
          storedFilename: p.storedFilename,
          documentId: p.documentId,
          direction: p.direction,
          status: p.status,
          issueCount: p.issues.length,
          progress: p.progress,
          errorKey: p.errorKey
        }
        if (idx === -1) return [...current, next]
        const copy = [...current]
        copy[idx] = next
        return copy
      })
      setImportIds((ids) => (ids.has(p.importId) ? ids : new Set(ids).add(p.importId)))
      if (TERMINAL_STATUSES.has(p.status)) emitDataChanged()
    })
  }, [])

  const startImport = useCallback(
    async (direction: DocumentDirection, paths: string[]) => {
      try {
        const result = await api().importFiles({ direction, paths, duplicateAction: 'ask' })
        setImportIds((ids) => new Set(ids).add(result.importId))
        setRows((current) => {
          const known = new Set(current.map((r) => r.fileId))
          const added: ImportRow[] = []
          for (const acc of result.accepted) {
            if (known.has(acc.fileId)) continue
            added.push({
              fileId: acc.fileId,
              importId: result.importId,
              originalFilename: acc.path.split(/[\\/]/).pop() ?? acc.path,
              storedFilename: null,
              documentId: null,
              direction,
              status: 'queued',
              issueCount: 0,
              progress: null,
              errorKey: null
            })
          }
          for (const rej of result.rejected) {
            added.push({
              fileId: `rejected:${rej.path}`,
              importId: result.importId,
              originalFilename: rej.path.split(/[\\/]/).pop() ?? rej.path,
              storedFilename: null,
              documentId: null,
              direction,
              status: 'failed',
              issueCount: 0,
              progress: null,
              errorKey: rej.reasonKey
            })
          }
          return [...current, ...added]
        })
      } catch (err) {
        toast.error(t(errorToKey(err)))
      }
    },
    [toast, t]
  )

  const retry = useCallback(
    async (fileId: string) => {
      try {
        await api().retryImport(fileId)
        setRows((current) =>
          current.map((r) =>
            r.fileId === fileId ? { ...r, status: 'queued', errorKey: null, progress: null } : r
          )
        )
      } catch (err) {
        toast.error(t(errorToKey(err)))
      }
    },
    [toast, t]
  )

  const dismiss = useCallback(async () => {
    const ids = [...importIds]
    setRows([])
    setImportIds(new Set())
    for (const id of ids) {
      try {
        await api().dismissImport(id)
      } catch {
        // best effort — the panel is already gone
      }
    }
  }, [importIds])

  const value = useMemo<ImportCtx>(
    () => ({ rows, visible: rows.length > 0, startImport, retry, dismiss }),
    [rows, startImport, retry, dismiss]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
