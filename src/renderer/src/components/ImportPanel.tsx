import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import { attentionForDocument } from '@core/review/attention'
import { TERMINAL_STATUSES, useImport, type ImportRow } from '../context/ImportContext'
import { useRouter } from '../context/RouterContext'
import { api, issueMessageKey } from '../lib/api'
import { useDataVersion } from '../lib/bus'
import { AttentionBadge } from './AttentionBadge'
import { ProcessingGlyph } from './StatusBits'
import { Icon } from './Icon'

function Row({ row, doc }: { row: ImportRow; doc: TaxDocument | null }): ReactNode {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { retry } = useImport()
  const terminal = TERMINAL_STATUSES.has(row.status)
  const name = row.storedFilename ?? row.originalFilename

  // Once the document exists and processing is done, the row shows exactly
  // what the documents list shows: the badge derived from the CURRENT
  // document state (refetched on every data change / finished LLM check).
  const attention = terminal && doc !== null ? attentionForDocument(doc) : null
  const issueCount = doc !== null ? doc.issues.length : row.issueCount

  const stageText = row.errorKey
    ? t(issueMessageKey(row.errorKey))
    : row.status === 'duplicate'
      ? t('processing.duplicate')
      : attention !== null
        ? t(`attention.label.${attention}`)
        : t(`processing.${row.status}`)

  return (
    <div className="import-row">
      <div className="ir-top">
        {attention !== null ? (
          <AttentionBadge level={attention} />
        ) : (
          <ProcessingGlyph status={row.status} />
        )}
        <span className="ir-name" title={name}>
          {name}
        </span>
        {row.documentId ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => push({ name: 'review', id: row.documentId as string })}
          >
            {t('import.openDocument')}
          </button>
        ) : null}
        {row.status === 'failed' && !row.fileId.startsWith('rejected:') ? (
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
      </div>
      <div className="ir-stage">
        {stageText}
        {terminal && issueCount > 0 ? ` · ${t('import.issueCount', { count: issueCount })}` : ''}
      </div>
      {!terminal ? (
        <div className="progress-track" aria-hidden="true">
          {row.progress !== null ? (
            <div
              className="progress-fill"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%` }}
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
      await Promise.all(
        ids.map(async (id) => {
          try {
            const doc = await api().getDocument(id)
            if (doc !== null) fetched[id] = doc
          } catch {
            // keep the previous state for this row
          }
        })
      )
      if (!cancelled) setDocs((current) => ({ ...current, ...fetched }))
    })()
    return () => {
      cancelled = true
    }
  }, [idsKey, dataVersion])

  if (!visible) return null

  const done = rows.filter((r) => TERMINAL_STATUSES.has(r.status)).length
  const running = done < rows.length

  return (
    <section className="import-panel" aria-label={t('import.headerProgress', { done, total: rows.length })}>
      <div className="import-panel-header">
        <span>{t('import.headerProgress', { done, total: rows.length })}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('import.dismiss')}
          title={t('import.dismiss')}
          onClick={() => void dismiss()}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {running ? (
        <div
          className="import-batch-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={done}
          aria-label={t('import.batchProgress', { done, total: rows.length })}
        >
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.round((done / rows.length) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="import-panel-body">
        {rows.map((row) => (
          <Row
            key={row.fileId}
            row={row}
            doc={row.documentId !== null ? (docs[row.documentId] ?? null) : null}
          />
        ))}
      </div>
    </section>
  )
}
