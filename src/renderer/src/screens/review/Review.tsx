import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentIssue, TaxDocument } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { emitDataChanged } from '../../lib/bus'
import { formatIsoDateTime, previewFilename } from '../../lib/format'
import { getLlmCheck, llmDisagreementCount, llmFieldLabelKey } from '../../lib/llm'
import { activeLanguage } from '../../i18n'
import { useRouter } from '../../context/RouterContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { attentionForDocument } from '@core/review/attention'
import { AttentionBadge } from '../../components/AttentionBadge'
import { ConfirmDialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { DirectionChip } from '../../components/StatusBits'
import { PdfViewer } from '../../components/pdf/PdfViewer'
import { AuditDrawer } from './AuditDrawer'
import { effective, type Patch, type PatchKey } from './FieldRow'
import {
  AmountsGroup,
  DescriptionGroup,
  DocumentGroup,
  PartiesGroup
} from './ReviewFieldGroups'
import { PaymentGroup, VatGroup } from './ReviewVatPayment'
import { issueMessageKey } from '../../lib/api'

const FILENAME_KEYS: PatchKey[] = ['invoiceDate', 'invoiceNumber', 'issuerName', 'recipientName']

export function Review({ id }: { id: string }): ReactNode {
  const { t } = useTranslation()
  const { back, canGoBack, go } = useRouter()
  const { settings } = useSettings()
  const toast = useToast()

  const [doc, setDoc] = useState<TaxDocument | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [patch, setPatch] = useState<Patch>({})
  const [saving, setSaving] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const next = await api().getDocument(id)
      if (next === null) setNotFound(true)
      else setDoc(next)
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }, [id, toast, t])

  useEffect(() => {
    setPatch({})
    setDoc(null)
    setNotFound(false)
    void refetch()
  }, [refetch])

  // While mounted: when the LLM check queue shrinks, a check finished and may
  // have updated this document → refetch to show new issues/confidence.
  const llmQueueRef = useRef(0)
  useEffect(() => {
    return api().onLlmProgress((status) => {
      if (status.queueLength < llmQueueRef.current) void refetch()
      llmQueueRef.current = status.queueLength
    })
  }, [refetch])

  const setField = useCallback(
    <K extends PatchKey>(key: K, value: Patch[K]): void => {
      setPatch((current) => {
        const next = { ...current }
        const original = doc ? (doc as unknown as Record<string, unknown>)[key] : undefined
        const normalizedOriginal = original === undefined ? null : original
        if (value === normalizedOriginal) {
          delete next[key]
        } else {
          next[key] = value
        }
        return next
      })
    },
    [doc]
  )

  const dirty = Object.keys(patch).length > 0
  const criticalIssues = useMemo(
    () => (doc ? doc.issues.filter((i) => i.severity === 'critical') : []),
    [doc]
  )

  const filenameHint = useMemo(() => {
    if (!doc || !FILENAME_KEYS.some((k) => k in patch)) return null
    return previewFilename({
      invoiceDate: (effective(doc, patch, 'invoiceDate') as string | null) ?? doc.invoiceDate,
      counterparty:
        doc.direction === 'income'
          ? (effective(doc, patch, 'recipientName') as string | null)
          : (effective(doc, patch, 'issuerName') as string | null),
      invoiceNumber: effective(doc, patch, 'invoiceNumber') as string | null
    })
  }, [doc, patch])

  const save = async (): Promise<void> => {
    if (!doc || !dirty) return
    setSaving(true)
    try {
      const updated = await api().updateDocument({ id: doc.id, patch })
      setDoc(updated)
      setPatch({})
      toast.success(t('review.savedToast'))
      emitDataChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setSaving(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (!doc) return
    try {
      if (dirty) {
        const updated = await api().updateDocument({ id: doc.id, patch })
        setDoc(updated)
        setPatch({})
      }
      const confirmed = await api().confirmDocument(doc.id)
      setDoc(confirmed)
      toast.success(t('review.confirmedToast'))
      emitDataChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const remove = async (): Promise<void> => {
    if (!doc) return
    try {
      await api().deleteDocument(doc.id, 'trash')
      toast.success(t('review.deletedToast'))
      emitDataChanged()
      if (canGoBack) back()
      else go({ name: 'documents' })
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const restore = async (): Promise<void> => {
    if (!doc) return
    try {
      await api().restoreDocument(doc.id)
      toast.success(t('review.restoredToast'))
      emitDataChanged()
      await refetch()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const queueLlmCheck = async (): Promise<void> => {
    if (!doc) return
    try {
      const status = await api().getLlmStatus()
      if (status.state !== 'ready') {
        toast.error(t('errors.llm_not_ready'))
        return
      }
      llmQueueRef.current = Math.max(llmQueueRef.current, status.queueLength)
      await api().runLlmCheck([doc.id])
      toast.success(t('llm.queuedToast'))
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const llmCheck = useMemo(() => (doc ? getLlmCheck(doc.extractionRawJson) : null), [doc])

  /**
   * Issue params for t(): for llm_disagreement the raw field name is replaced
   * with the translated review.* label where one exists.
   */
  const issueParams = (issue: DocumentIssue): Record<string, string | number> => {
    const params: Record<string, string | number> = { ...issue.params }
    if (issue.code === 'llm_disagreement') {
      const rawField =
        typeof params.field === 'string' && params.field !== ''
          ? params.field
          : (issue.field ?? '')
      const labelKey = llmFieldLabelKey(rawField)
      params.field = labelKey ? t(labelKey) : rawField
      if (typeof params.suggested !== 'string' && typeof params.suggested !== 'number') {
        params.suggested = '—'
      }
    }
    return params
  }

  if (notFound) {
    return (
      <div className="content-inner">
        <div className="empty-state">
          <p>{t('review.notFound')}</p>
          <button type="button" className="btn mt-16" onClick={() => (canGoBack ? back() : go({ name: 'documents' }))}>
            <Icon name="back" size={14} /> {t('review.backToList')}
          </button>
        </div>
      </div>
    )
  }

  if (!doc) {
    return <div className="empty-state">{t('app.loading')}</div>
  }

  const groupProps = { doc, patch, setField }

  return (
    <div className="review-layout">
      <div className="review-fields">
        <div className="rf-scroll">
        <div className="row mb-16" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('review.backToList')}
            onClick={() => (canGoBack ? back() : go({ name: 'documents' }))}
          >
            <Icon name="back" />
          </button>
          <DirectionChip direction={doc.direction} />
          <AttentionBadge level={attentionForDocument(doc)} withLabel />
          {llmCheck !== null && llmDisagreementCount(llmCheck) === 0 ? (
            <span className="chip chip-neutral">
              <span aria-hidden="true">✓</span> {t('llm.checkedChip')}
            </span>
          ) : null}
          {dirty ? <span className="chip chip-neutral">✎ {t('review.unsavedHint')}</span> : null}
        </div>
        <p className="small muted mb-16" style={{ wordBreak: 'break-all' }}>
          {doc.storedFilename}
          {doc.userConfirmedAt ? (
            <>
              <br />✓{' '}
              {t('review.confirmedAt', { date: formatIsoDateTime(doc.userConfirmedAt, activeLanguage()) })}
            </>
          ) : null}
        </p>

        {doc.issues.length > 0 ? (
          <section className="field-group">
            <h2 className="section-title">{t('review.issuesTitle')}</h2>
            {doc.issues.map((issue, i) => (
              <div
                key={`${issue.code}-${i}`}
                className={`inline-note ${issue.severity === 'critical' ? 'crit' : issue.severity === 'warning' ? 'warn' : 'info'}`}
              >
                <span aria-hidden="true">
                  {issue.severity === 'critical' ? '✕' : issue.severity === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <span>
                  {t(issueMessageKey(issue.messageKey), {
                    ...issueParams(issue),
                    defaultValue: t(issueMessageKey(issue.code), { defaultValue: issue.code })
                  })}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        <DocumentGroup {...groupProps} />
        <PartiesGroup {...groupProps} />
        <DescriptionGroup {...groupProps} />
        <AmountsGroup {...groupProps} />
        <VatGroup doc={doc} onChanged={() => void refetch()} />
        <PaymentGroup doc={doc} onChanged={() => void refetch()} />

        {filenameHint ? (
          <div className="inline-note info">
            <span aria-hidden="true">ℹ</span>
            <span>{t('review.filenameHint', { name: filenameHint })}</span>
          </div>
        ) : null}
        </div>

        <div className="review-footer">
          <button
            type="button"
            className="btn btn-primary"
            disabled={criticalIssues.length > 0 || doc.reviewStatus === 'confirmed'}
            onClick={() => void confirm()}
          >
            ✓ {t('review.confirmDocument')}
          </button>
          <button type="button" className="btn" disabled={!dirty || saving} onClick={() => void save()}>
            {t('common.save')}
          </button>
          <button type="button" className="btn" onClick={() => setHistoryOpen(true)}>
            <Icon name="history" size={14} /> {t('review.history')}
          </button>
          {doc.reviewStatus !== 'confirmed' ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() =>
                void (async () => {
                  try {
                    const res = await api().reExtractDocuments([doc.id])
                    toast.success(
                      t('documents.reExtractDone', {
                        updated: res.updated,
                        skipped: res.skipped
                      })
                    )
                    emitDataChanged()
                    await refetch()
                  } catch (err) {
                    toast.error(t(errorToKey(err)))
                  }
                })()
              }
            >
              {t('review.reExtract')}
            </button>
          ) : null}
          {settings.llmCheckerEnabled && doc.reviewStatus !== 'confirmed' ? (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => void queueLlmCheck()}
            >
              {t('llm.checkButton')}
            </button>
          ) : null}
          {doc.deletedAt === null ? (
            <button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
              <Icon name="trash" size={14} /> {t('common.delete')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void restore()}>
              <Icon name="restore" size={14} /> {t('common.restore')}
            </button>
          )}
          {criticalIssues.length > 0 ? (
            <p className="small" style={{ color: 'var(--crit)', width: '100%' }}>
              ✕ {t('review.confirmBlocked')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="review-pdf">
        <PdfViewer documentId={doc.id} />
      </div>

      {historyOpen ? <AuditDrawer documentId={doc.id} onClose={() => setHistoryOpen(false)} /> : null}
      {deleteOpen ? (
        <ConfirmDialog
          title={t('review.deleteTitle')}
          body={t('review.deleteBody')}
          danger
          confirmLabel={t('common.delete')}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            setDeleteOpen(false)
            void remove()
          }}
        />
      ) : null}
    </div>
  )
}
