import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentIssue, TaxDocument } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { emitDataChanged } from '../../lib/bus'
import { formatIsoDate } from '../../lib/format'
import { llmFieldLabelKey, reviewFieldLabelKey } from '../../lib/llm'
import { activeLanguage } from '../../i18n'
import { useRouter } from '../../context/RouterContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import {
  attentionAnalysisForDocument,
  issueAttentionForDocument
} from '@core/review/attention'
import { canonicalDocumentField } from '@core/review/fields'
import { AttentionBadge } from '../../components/AttentionBadge'
import { ConfirmDialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { DirectionChip } from '../../components/StatusBits'
import { PdfViewer } from '../../components/pdf/PdfViewer'
import { AuditDrawer } from './AuditDrawer'
import { effective, type Patch, type PatchKey } from './FieldRow'
import { AmountsGroup, EssentialsGroup, MoreDetailsSection } from './ReviewFieldGroups'
import { PaymentGroup, VatGroup } from './ReviewVatPayment'
import { issueMessageKey } from '../../lib/api'

export function Review({ id }: { id: string }): ReactNode {
  const { t } = useTranslation()
  const { back, canGoBack, go } = useRouter()
  const { settings } = useSettings()
  const toast = useToast()

  const [doc, setDoc] = useState<TaxDocument | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [patch, setPatch] = useState<Patch>({})
  const [saving, setSaving] = useState(false)
  const [savingCopy, setSavingCopy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const actionsMenuRef = useRef<HTMLDetailsElement>(null)

  const closeActionsMenu = (): void => actionsMenuRef.current?.removeAttribute('open')

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent): void => {
      if (!actionsMenuRef.current?.contains(event.target as Node)) closeActionsMenu()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeActionsMenu()
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const refetch = useCallback(async () => {
    setLoadFailed(false)
    try {
      const next = await api().getDocument(id)
      if (next === null) setNotFound(true)
      else setDoc(next)
    } catch (err) {
      toast.error(t(errorToKey(err)))
      setLoadFailed(true)
    }
  }, [id, toast, t])

  useEffect(() => {
    setPatch({})
    setDoc(null)
    setNotFound(false)
    setLoadFailed(false)
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
  const attention = useMemo(
    () => (doc ? attentionAnalysisForDocument(doc) : null),
    [doc]
  )
  const fieldAttention = useMemo(() => {
    const fields = { ...(attention?.fields ?? {}) }
    for (const field of Object.keys(patch)) delete fields[canonicalDocumentField(field)]
    return fields
  }, [attention, patch])
  const visibleIssues = useMemo(
    () => {
      if (!doc) return []
      const seen = new Set<string>()
      return doc.issues.filter((issue) => {
        const field = canonicalDocumentField(
          (issue.params?.field as string | undefined) ?? issue.field ?? ''
        )
        const key = `${issue.code}:${field}`
        if (
          field in patch ||
          issueAttentionForDocument(issue, doc) === null ||
          seen.has(key)
        ) {
          return false
        }
        seen.add(key)
        return true
      })
    },
    [doc, patch]
  )

  // The invoice number is only an essential while something is off about it:
  // an open issue or a shaky extraction. Otherwise it lives in "More details".
  const invoiceNumberProminent = useMemo(() => {
    if (!doc) return false
    return fieldAttention.invoiceNumber !== undefined
  }, [doc, fieldAttention])

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

  const saveCopy = async (): Promise<void> => {
    if (!doc || savingCopy) return
    setSavingCopy(true)
    try {
      const result = await api().saveDocumentCopies([doc.id])
      if (result.canceled) return
      if (result.saved > 0) {
        toast.success(t('documents.copiesSavedToast', { count: result.saved }))
      }
      if (result.failed > 0) {
        toast.error(t('documents.copiesSavePartial', { count: result.failed }))
      }
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setSavingCopy(false)
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

  const reExtract = async (): Promise<void> => {
    if (!doc) return
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
  }

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
    if (loadFailed) {
      return (
        <div className="content-inner review-state-wrap">
          <div className="card empty-state rich-empty-state" role="alert">
            <span className="empty-icon error">!</span>
            <strong>{t('review.loadFailedTitle')}</strong>
            <span>{t('review.loadFailedBody')}</span>
            <div className="row mt-16">
              <button type="button" className="btn" onClick={() => (canGoBack ? back() : go({ name: 'documents' }))}>
                <Icon name="back" size={14} /> {t('review.backToList')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void refetch()}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="review-loading" aria-label={t('app.loading')}>
        <span className="loading-orb" />
        <span>{t('app.loading')}</span>
      </div>
    )
  }

  const groupProps = { doc, patch, setField, fieldAttention }
  const fieldOrder = [
    'invoiceDate',
    'invoiceNumber',
    'issuerName',
    'recipientName',
    'description',
    'originalCurrency',
    'netAmountOriginal',
    'vatAmountOriginal',
    'grossAmountOriginal',
    'exchangeRateToEur',
    'vatTreatmentCode',
    'dueDate',
    'issuerCountryCode',
    'issuerVatId',
    'recipientCountryCode',
    'recipientVatId',
    'recipientIsBusiness',
    'serviceDateFrom',
    'serviceDateTo',
    'expenseCategory'
  ]
  const uncertainFields = Object.keys(fieldAttention).sort((a, b) => {
    const aIndex = fieldOrder.indexOf(a)
    const bIndex = fieldOrder.indexOf(b)
    return (aIndex === -1 ? fieldOrder.length : aIndex) -
      (bIndex === -1 ? fieldOrder.length : bIndex)
  })
  const fieldLabel = (field: string): string => {
    const key = reviewFieldLabelKey(field)
    return key ? t(key) : field
  }
  const focusField = (field: string): void => {
    const element = document.getElementById(`field-${field}`)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => element.focus({ preventScroll: true }), 180)
  }
  const counterparty =
    doc.direction === 'income'
      ? effective(doc, patch, 'recipientName')
      : effective(doc, patch, 'issuerName')
  const invoiceDate = effective(doc, patch, 'invoiceDate')
  const invoiceNumber = effective(doc, patch, 'invoiceNumber')
  const headerTitle =
    typeof counterparty === 'string' && counterparty.trim() !== ''
      ? counterparty
      : t('common.document')
  const headerMeta = [
    typeof invoiceDate === 'string' && invoiceDate !== ''
      ? formatIsoDate(invoiceDate, activeLanguage())
      : null,
    typeof invoiceNumber === 'string' && invoiceNumber.trim() !== ''
      ? `#${invoiceNumber}`
      : null
  ].filter((value): value is string => value !== null)
  const inTrash = doc.deletedAt !== null
  const canReExtract = !inTrash && doc.reviewStatus !== 'confirmed'
  const canRunLlm = canReExtract && settings.llmCheckerEnabled

  return (
    <div className="review-layout" data-tour="review-split">
      <div className="review-fields">
        <div className="rf-scroll">
          <div className="row review-header">
            <button
              type="button"
              className="icon-btn"
              aria-label={t('review.backToList')}
              onClick={() => (canGoBack ? back() : go({ name: 'documents' }))}
            >
              <Icon name="back" />
            </button>
            <div className="review-header-context">
              <strong className="review-header-title">{headerTitle}</strong>
              {headerMeta.length > 0 ? (
                <span className="review-header-meta">{headerMeta.join(' · ')}</span>
              ) : null}
            </div>
            <DirectionChip direction={doc.direction} />
            <button
              type="button"
              className="icon-btn"
              aria-label={t('review.history')}
              title={t('review.history')}
              onClick={() => setHistoryOpen(true)}
            >
              <Icon name="history" size={14} />
            </button>
            {!inTrash ? (
              <button
                type="button"
                className="icon-btn review-delete-action"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                disabled={saving}
                onClick={() => setDeleteOpen(true)}
              >
                <Icon name="trash" size={14} />
              </button>
            ) : null}
            <details ref={actionsMenuRef} className="review-actions-menu" data-tour="review-recheck">
              <summary
                className="icon-btn"
                aria-label={t('review.moreActions')}
                title={t('review.moreActions')}
              >
                <Icon name="more" />
              </summary>
              <div className="review-actions-menu-content">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={savingCopy}
                  onClick={() => {
                    closeActionsMenu()
                    void saveCopy()
                  }}
                >
                  <Icon name="download" size={13} />
                  {savingCopy ? t('documents.savingCopies') : t('documents.saveCopy')}
                </button>
                {canReExtract ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={saving}
                    onClick={() => {
                      closeActionsMenu()
                      void reExtract()
                    }}
                  >
                    {t('review.reExtract')}
                  </button>
                ) : null}
                {canRunLlm ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={saving}
                    onClick={() => {
                      closeActionsMenu()
                      void queueLlmCheck()
                    }}
                  >
                    {t('llm.checkButton')}
                  </button>
                ) : null}
              </div>
            </details>
          </div>

          {inTrash ? (
            <div className="review-trash-notice" role="note">
              <span>{t('review.trashNotice')}</span>
            </div>
          ) : null}

          <fieldset className="review-editor" disabled={inTrash}>
            {uncertainFields.length > 0 ? (
              <div className="review-check-fields" role="note">
                <span className="review-check-fields-label">{t('review.fieldsToCheck')}</span>
                <div className="review-check-fields-list">
                  {uncertainFields.map((field) => (
                    <button
                      key={field}
                      type="button"
                      className={`review-check-field ${fieldAttention[field]}`}
                      onClick={() => focusField(field)}
                    >
                      <span aria-hidden="true" />
                      {fieldLabel(field)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {visibleIssues.length > 0 ? (
              <section className="field-group">
                <h2 className="section-title">{t('review.issuesTitle')}</h2>
                {visibleIssues.map((issue, i) => {
                  const issueLevel = issueAttentionForDocument(issue, doc)
                  const isCritical = issueLevel === 'critical'
                  return (
                    <div
                      key={`${issue.code}-${i}`}
                      className={`inline-note ${isCritical ? 'crit' : issueLevel === 'warning' || issueLevel === 'minor' ? 'warn' : 'info'}`}
                    >
                      <span aria-hidden="true">{isCritical ? '✕' : '⚠'}</span>
                      <span>
                        {t(issueMessageKey(issue.messageKey), {
                          ...issueParams(issue),
                          defaultValue: t(issueMessageKey(issue.code), { defaultValue: issue.code })
                        })}
                      </span>
                    </div>
                  )
                })}
              </section>
            ) : null}

            <EssentialsGroup {...groupProps} showInvoiceNumber={invoiceNumberProminent} />
            <AmountsGroup {...groupProps} />
            <VatGroup doc={doc} onChanged={() => void refetch()} />
            <PaymentGroup doc={doc} onChanged={() => void refetch()} />
            <MoreDetailsSection {...groupProps} showInvoiceNumber={invoiceNumberProminent} />
          </fieldset>
        </div>

        <div className="review-footer">
          <div className="review-footer-state">
            {inTrash ? (
              <span className="muted small">{t('documents.trashTitle')}</span>
            ) : (
              <>
                <AttentionBadge level={attention?.level ?? 'ok'} withLabel />
                {attention?.level === 'critical' ? (
                  <span className="review-footer-error">✕ {t('review.confirmBlocked')}</span>
                ) : null}
              </>
            )}
          </div>
          {inTrash ? (
            <button type="button" className="btn btn-primary" onClick={() => void restore()}>
              <Icon name="restore" size={13} /> {t('common.restore')}
            </button>
          ) : dirty ? (
            <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
              {t('common.save')}
            </button>
          ) : null}
          {!inTrash && doc.reviewStatus !== 'confirmed' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={attention?.level === 'critical'}
              onClick={() => void confirm()}
            >
              ✓ {t('review.confirmDocument')}
            </button>
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
