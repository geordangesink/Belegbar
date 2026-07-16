import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument, VatClassificationResult } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { emitDataChanged } from '../../lib/bus'
import { activeLanguage } from '../../i18n'
import { formatIsoDate, todayIso } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import { Dialog } from '../../components/Dialog'
import {
  treatmentDescKey,
  treatmentLabelKey,
  vatTreatmentOptionsForDirection
} from '../../lib/vatTreatments'

/**
 * The full stored classification (reasons, unresolved questions) is not part
 * of TaxDocument; best effort: look inside extractionRawJson where main may
 * embed it. Renders gracefully when absent.
 */
function storedClassification(doc: TaxDocument): Partial<VatClassificationResult> | null {
  const raw = doc.extractionRawJson
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const candidate = record.classification ?? record.vatClassification
  if (candidate !== null && typeof candidate === 'object') {
    return candidate as Partial<VatClassificationResult>
  }
  return null
}

export function VatGroup({
  doc,
  onChanged
}: {
  doc: TaxDocument
  onChanged: () => void
}): ReactNode {
  const { t } = useTranslation()
  const toast = useToast()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedCode, setPickedCode] = useState<string>(doc.vatTreatmentCode ?? 'UNKNOWN_REVIEW')
  const [reason, setReason] = useState('')
  const [savingTreatment, setSavingTreatment] = useState(false)

  const classification = storedClassification(doc)
  const reasons = [
    ...new Set([
      ...(Array.isArray(classification?.reasons) ? classification.reasons : []),
      ...doc.reviewReasons
    ])
  ]
  const questions = [
    ...new Set(
      Array.isArray(classification?.unresolvedQuestions)
        ? classification.unresolvedQuestions
        : []
    )
  ]
  const hasRationale = reasons.length > 0 || questions.length > 0
  const treatmentOptions = vatTreatmentOptionsForDirection(doc.direction, doc.vatTreatmentCode)
  const needsDecision = classification?.requiresUserConfirmation === true
  const canAcceptSuggestion =
    needsDecision &&
    doc.vatTreatmentCode !== null &&
    doc.vatTreatmentCode !== 'UNKNOWN_REVIEW'

  const label = doc.vatTreatmentCode
    ? t(treatmentLabelKey(doc.vatTreatmentCode), {
        defaultValue: doc.vatTreatmentLabel ?? doc.vatTreatmentCode
      })
    : (doc.vatTreatmentLabel ?? t('vat.treatment.UNKNOWN_REVIEW'))

  const applyTreatment = async (code: string, auditReason?: string): Promise<void> => {
    if (savingTreatment) return
    setSavingTreatment(true)
    try {
      await api().setVatTreatment({
        id: doc.id,
        code,
        reason: auditReason?.trim() === '' ? undefined : auditReason?.trim()
      })
      setPickerOpen(false)
      setReason('')
      toast.success(t('review.treatmentChangedToast'))
      emitDataChanged()
      onChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    } finally {
      setSavingTreatment(false)
    }
  }

  const openPicker = (): void => {
    const currentIsApplicable = treatmentOptions.some(({ code }) => code === doc.vatTreatmentCode)
    setReason('')
    setPickedCode(
      currentIsApplicable
        ? (doc.vatTreatmentCode as string)
        : (treatmentOptions[0]?.code ?? 'UNKNOWN_REVIEW')
    )
    setPickerOpen(true)
  }

  const closePicker = (): void => {
    setPickerOpen(false)
    setReason('')
  }

  return (
    <section className="field-group">
      <h2 className="section-title">{t('review.groupVat')}</h2>
      <div className="stack">
        <div className="row vat-treatment-summary">
          <div className="vat-treatment-copy">
            <strong className="vat-treatment-label">{label}</strong>
            {needsDecision ? (
              <div className="small vat-treatment-decision-label">
                {t('review.treatmentNeedsDecision')}
              </div>
            ) : null}
            {doc.vatLegalBasis ? (
              <div className="small muted">
                {t('review.legalBasis')}: {doc.vatLegalBasis}
              </div>
            ) : null}
          </div>
          <div className="vat-treatment-actions">
            {canAcceptSuggestion ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingTreatment}
                onClick={() => void applyTreatment(doc.vatTreatmentCode as string)}
              >
                {t('review.acceptTreatment')}
              </button>
            ) : null}
            <button
              id="field-vatTreatmentCode"
              type="button"
              className={`btn btn-sm${needsDecision && !canAcceptSuggestion ? ' btn-primary' : ''}`}
              disabled={savingTreatment}
              onClick={openPicker}
            >
              {needsDecision ? t('review.chooseTreatment') : t('review.changeTreatment')}
            </button>
          </div>
        </div>
        {hasRationale ? (
          <details className="vat-rationale">
            <summary className="expand-btn">{t('review.why')}</summary>
            <div className="inline-note info">
              {reasons.length > 0 ? (
                <div>
                  <strong className="vat-rationale-heading">{t('review.whyReasons')}</strong>
                  <ul className="vat-rationale-list">
                    {reasons.map((r, i) => (
                      <li key={i}>{t(`reasons.${r}`, { defaultValue: r })}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {questions.length > 0 ? (
                <div>
                  <strong className="vat-rationale-heading">{t('review.whyQuestions')}</strong>
                  <ul className="vat-rationale-list">
                    {questions.map((q, i) => (
                      <li key={i}>{t(`reasons.${q}`, { defaultValue: q })}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      {pickerOpen ? (
        <Dialog
          title={t('review.treatmentPickerTitle')}
          wide
          onClose={closePicker}
          footer={
            <>
              <button type="button" className="btn" onClick={closePicker}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingTreatment}
                onClick={() => void applyTreatment(pickedCode, reason)}
              >
                {t('common.confirm')}
              </button>
            </>
          }
        >
          <div className="option-cards">
            {treatmentOptions.map((opt) => (
              <button
                key={opt.code}
                type="button"
                className={`option-card${pickedCode === opt.code ? ' selected' : ''}`}
                aria-pressed={pickedCode === opt.code}
                onClick={() => setPickedCode(opt.code)}
              >
                <span className="oc-title">{t(treatmentLabelKey(opt.code))}</span>
                <span className="oc-desc">
                  {t(treatmentDescKey(opt.code))}
                  {opt.legalBasis ? ` · ${opt.legalBasis}` : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="field-row mt-16">
            <label htmlFor="treatment-reason">{t('review.treatmentReason')}</label>
            <textarea
              id="treatment-reason"
              className="textarea"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </Dialog>
      ) : null}
    </section>
  )
}

export function PaymentGroup({
  doc,
  onChanged
}: {
  doc: TaxDocument
  onChanged: () => void
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const toast = useToast()
  const [pickOpen, setPickOpen] = useState(false)
  const [picked, setPicked] = useState(todayIso())

  const setPayment = async (
    mode: 'date' | 'invoice_date' | 'not_paid' | 'unknown',
    date?: string
  ): Promise<void> => {
    try {
      await api().setPaymentDate({ ids: [doc.id], mode, date })
      emitDataChanged()
      onChanged()
    } catch (err) {
      toast.error(t(errorToKey(err)))
    }
  }

  const statusGlyph =
    doc.paymentStatus === 'paid' ? '✓' : doc.paymentStatus === 'unpaid' ? '…' : '—'

  return (
    <section className="field-group">
      <h2 className="section-title">{t('review.groupPayment')}</h2>
      <div className="stack">
        <div className={`row payment-status ${doc.paymentStatus}`}>
          <span className={`status-glyph ${doc.paymentStatus === 'paid' ? 'ok' : 'neutral'}`} aria-hidden="true">
            {statusGlyph}
          </span>
          <span>
            {t(`paymentStatus.${doc.paymentStatus}`)}
            {doc.paymentDate ? ` · ${formatIsoDate(doc.paymentDate, lang)}` : ''}
          </span>
        </div>
        <div className="row payment-actions" data-tour="payment-actions">
          <button type="button" className="btn btn-sm" onClick={() => void setPayment('date', todayIso())}>
            {t('review.paymentQuickToday')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={doc.invoiceDate === null}
            onClick={() => void setPayment('invoice_date')}
          >
            {t('review.paymentQuickInvoiceDate')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPickOpen(true)}>
            {t('review.paymentQuickPick')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void setPayment('not_paid')}>
            {t('review.paymentQuickNotPaid')}
          </button>
        </div>
      </div>
      {pickOpen ? (
        <Dialog
          title={t('documents.pickDateTitle')}
          onClose={() => setPickOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPickOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPickOpen(false)
                  void setPayment('date', picked)
                }}
              >
                {t('common.confirm')}
              </button>
            </>
          }
        >
          <input
            className="input"
            type="date"
            aria-label={t('review.paymentDate')}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          />
        </Dialog>
      ) : null}
    </section>
  )
}
