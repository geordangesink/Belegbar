import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import {
  attentionForDocument,
  issueAttentionForDocument
} from '@core/review/attention'
import { TERMINAL_STATUSES, useImport, type ImportRow } from '../context/ImportContext'
import { useRouter } from '../context/RouterContext'
import { useToast } from '../context/ToastContext'
import { api, errorToKey, issueMessageKey } from '../lib/api'
import { emitDataChanged, useDataVersion } from '../lib/bus'
import { AttentionBadge } from './AttentionBadge'
import { ConfirmDialog } from './Dialog'
import { ProcessingGlyph } from './StatusBits'
import { Icon } from './Icon'

function Row({
  row,
  doc,
  onDelete
}: {
  row: ImportRow
  doc: TaxDocument | null
  onDelete: (row: ImportRow) => void
}): ReactNode {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { retry } = useImport()
  const terminal = TERMINAL_STATUSES.has(row.status)
  const name = row.storedFilename ?? row.originalFilename
  const retriable = row.status === 'failed' && !row.fileId.startsWith('rejected:')
  const deletable =
    (row.status === 'completed' || row.status === 'completed_with_warnings') &&
    doc?.deletedAt === null
  const statusClass = row.status.replaceAll('_', '-')

  // Once the document exists and processing is done, the row shows exactly
  // what the documents list shows: the badge derived from the CURRENT
  // document state (refetched on every data change / finished LLM check).
  const attention = terminal && doc !== null ? attentionForDocument(doc) : null
  const issueCount =
    doc !== null
      ? doc.issues.filter((issue) => issueAttentionForDocument(issue, doc) !== null).length
      : row.issueCount

  const stageText = row.errorKey
    ? t(issueMessageKey(row.errorKey))
    : row.status === 'duplicate'
      ? t('processing.duplicate')
      : attention !== null
        ? t(`attention.label.${attention}`)
        : t(`processing.${row.status}`)

  return (
    <div
      className={`import-row status-${statusClass} ${terminal ? 'is-terminal' : 'is-processing'}`}
      data-status={row.status}
    >
      <div className="ir-top">
        <span className="ir-status">
          {attention !== null ? (
            <AttentionBadge level={attention} />
          ) : (
            <ProcessingGlyph status={row.status} />
          )}
        </span>
        <span className="ir-name" title={name}>
          {name}
        </span>
        {row.documentId || retriable ? (
          <span className="ir-actions">
            {row.documentId ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => push({ name: 'review', id: row.documentId as string })}
              >
                <Icon name="edit" size={13} /> {t('import.editDocument')}
              </button>
            ) : null}
            {deletable ? (
              <button
                type="button"
                className="icon-btn import-row-delete"
                aria-label={`${t('common.delete')}: ${name}`}
                title={t('common.delete')}
                onClick={() => onDelete(row)}
              >
                <Icon name="trash" size={13} />
              </button>
            ) : null}
            {retriable ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('import.retryFile')}
                title={t('import.retryFile')}
                onClick={() => void retry(row.fileId)}
              >
                <Icon name="restore" size={14} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="ir-stage">
        <span className="ir-stage-text">{stageText}</span>
        {terminal && issueCount > 0 ? (
          <span className="ir-issues"> · {t('import.issueCount', { count: issueCount })}</span>
        ) : null}
      </div>
      {!terminal ? (
        <div
          className={`progress-track ir-progress${row.progress === null ? ' is-indeterminate' : ''}`}
          aria-hidden="true"
        >
          {row.progress !== null ? (
            <div
              className="progress-fill is-determinate"
              style={{
                width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%`
              }}
            />
          ) : (
            <div className="progress-fill indeterminate" />
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Floating bottom-right import progress card; persists until dismissed. */
export function ImportPanel(): ReactNode {
  const { t } = useTranslation()
  const { rows, visible, dismiss } = useImport()
  const dataVersion = useDataVersion()
  const toast = useToast()
  const [deleteTarget, setDeleteTarget] = useState<ImportRow | null>(null)
  const [hiddenFileIds, setHiddenFileIds] = useState<ReadonlySet<string>>(() => new Set())
  const [missingDocumentIds, setMissingDocumentIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  // Current document state per finished row — the single source for the
  // status badge, so the panel can never disagree with the documents list.
  const [docs, setDocs] = useState<Record<string, TaxDocument>>({})

  const idsKey = useMemo(
    () =>
      rows
        .map((r) => r.documentId)
        .filter((id): id is string => id !== null)
        .join('\n'),
    [rows]
  )

  useEffect(() => {
    const ids = idsKey === '' ? [] : idsKey.split('\n')
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      const fetched: Record<string, TaxDocument> = {}
      const missing = new Set<string>()
      await Promise.all(
        ids.map(async (id) => {
          try {
            const doc = await api().getDocument(id)
            if (doc === null) {
              missing.add(id)
            } else {
              fetched[id] = doc
            }
          } catch {
            // keep the previous state for this row
          }
        })
      )
      if (!cancelled) {
        setDocs((current) => {
          const next = { ...current, ...fetched }
          for (const id of missing) delete next[id]
          return next
        })
        setMissingDocumentIds((current) => {
          const next = new Set(current)
          for (const id of Object.keys(fetched)) next.delete(id)
          for (const id of missing) next.add(id)
          return next
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [idsKey, dataVersion])

  const visibleRows = rows.filter((row) => {
    if (hiddenFileIds.has(row.fileId)) return false
    if (!TERMINAL_STATUSES.has(row.status) || row.documentId === null) return true
    if (missingDocumentIds.has(row.documentId)) return false
    const doc = docs[row.documentId]
    return doc === undefined || doc.deletedAt === null
  })
  if (!visible || visibleRows.length === 0) return null

  const done = visibleRows.filter((r) => TERMINAL_STATUSES.has(r.status)).length
  const running = done < visibleRows.length
  const failed = visibleRows.filter((row) => row.status === 'failed').length
  const awaitingDocumentStatus = visibleRows.some(
    (row) =>
      TERMINAL_STATUSES.has(row.status) &&
      row.documentId !== null &&
      docs[row.documentId] === undefined
  )
  const withIssues = visibleRows.filter((row) => {
    if (row.documentId === null) return false
    const doc = docs[row.documentId]
    if (!doc) return false
    const attention = attentionForDocument(doc)
    return attention !== 'ok' && attention !== 'confirmed'
  }).length
  const state = running
    ? 'running'
    : failed > 0
      ? 'failed'
      : awaitingDocumentStatus
        ? 'settling'
        : withIssues > 0
          ? 'attention'
          : 'complete'
  const panelClass = [
    'import-panel',
    `state-${state}`,
    running ? 'is-running' : 'is-complete',
    failed > 0 ? 'has-failures' : '',
    withIssues > 0 ? 'has-issues' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const deleteDocument = async (row: ImportRow): Promise<void> => {
    if (!row.documentId) return
    try {
      await api().deleteDocument(row.documentId, 'trash')
      setHiddenFileIds((current) => new Set(current).add(row.fileId))
      toast.success(t('review.deletedToast'))
      emitDataChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  return (
    <>
      <section
        className={panelClass}
        data-state={state}
        aria-label={t('import.headerProgress', { done, total: visibleRows.length })}
      >
        <div className="import-panel-header">
          <span className="import-panel-heading">
            <span className="import-panel-indicator" aria-hidden="true" />
            <span className="import-panel-title">
              {t('import.headerProgress', { done, total: visibleRows.length })}
            </span>
          </span>
          <button
            type="button"
            className="icon-btn import-panel-dismiss"
            aria-label={t('import.dismiss')}
            title={t('import.dismiss')}
            onClick={() => void dismiss()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        {running ? (
          <div
            className="import-batch-progress is-running"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={visibleRows.length}
            aria-valuenow={done}
            aria-label={t('import.batchProgress', { done, total: visibleRows.length })}
          >
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.round((done / visibleRows.length) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}
        <div className="import-panel-body">
          {visibleRows.map((row) => (
            <Row
              key={row.fileId}
              row={row}
              doc={row.documentId !== null ? (docs[row.documentId] ?? null) : null}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      </section>
      {deleteTarget ? (
        <ConfirmDialog
          title={t('review.deleteTitle')}
          body={t('review.deleteBody')}
          danger
          confirmLabel={t('common.delete')}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            void deleteDocument(target)
          }}
        />
      ) : null}
    </>
  )
}
