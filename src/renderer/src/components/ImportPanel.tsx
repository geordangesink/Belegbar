import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TERMINAL_STATUSES, useImport, type ImportRow } from '../context/ImportContext'
import { useRouter } from '../context/RouterContext'
import { ProcessingGlyph } from './StatusBits'
import { Icon } from './Icon'
import { issueMessageKey } from '../lib/api'

function Row({ row }: { row: ImportRow }): ReactNode {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { retry } = useImport()
  const terminal = TERMINAL_STATUSES.has(row.status)
  const name = row.storedFilename ?? row.originalFilename

  return (
    <div className="import-row">
      <div className="ir-top">
        <ProcessingGlyph status={row.status} />
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
        {row.errorKey ? t(issueMessageKey(row.errorKey)) : t(`processing.${row.status}`)}
        {terminal && row.issueCount > 0 ? ` · ${t('import.issueCount', { count: row.issueCount })}` : ''}
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
  if (!visible) return null

  const done = rows.filter((r) => TERMINAL_STATUSES.has(r.status)).length

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
      <div className="import-panel-body">
        {rows.map((row) => (
          <Row key={row.fileId} row={row} />
        ))}
      </div>
    </section>
  )
}
