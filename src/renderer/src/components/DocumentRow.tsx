import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import { attentionForDocument } from '@core/review/attention'
import { activeLanguage } from '../i18n'
import { formatCurrencyAmount, formatEur, formatIsoDate } from '../lib/format'
import { AttentionBadge } from './AttentionBadge'
import { DirectionChip } from './StatusBits'
import { treatmentLabelKey } from '../lib/vatTreatments'
import { Icon } from './Icon'

export function counterpartyName(doc: TaxDocument): string | null {
  return doc.direction === 'income' ? doc.recipientName : doc.issuerName
}

const openButtonStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 1,
  inset: 0,
  width: '100%',
  padding: 0,
  border: 0,
  borderRadius: 'inherit',
  background: 'transparent',
  cursor: 'pointer'
}

const rowControlStyle: CSSProperties = {
  position: 'relative',
  zIndex: 2
}

export function DocumentRow({
  doc,
  onOpen,
  selectable,
  selected,
  onToggleSelect,
  trailing,
  compact
}: {
  doc: TaxDocument
  onOpen: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  trailing?: ReactNode
  /** quiet variant (overview): badge + company + date + amount only; VAT treatment moves to the hover title */
  compact?: boolean
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()

  const attention = attentionForDocument(doc)
  const company = counterpartyName(doc)?.trim() || doc.storedFilename
  const isEur = (doc.originalCurrency ?? 'EUR') === 'EUR'
  const gross = doc.grossAmountOriginal
  const grossEur = doc.grossAmountEur

  const treatment = doc.vatTreatmentCode
    ? t(treatmentLabelKey(doc.vatTreatmentCode), {
        defaultValue: doc.vatTreatmentLabel ?? doc.vatTreatmentCode
      })
    : null

  return (
    <div
      className={`doc-row${doc.deletedAt ? ' deleted' : ''}`}
      data-document-id={doc.id}
      title={compact ? (treatment ?? undefined) : undefined}
    >
      {selectable ? (
        <span style={rowControlStyle}>
          <input
            type="checkbox"
            checked={selected ?? false}
            aria-label={`${t('documents.selectRow')}: ${company}`}
            onChange={() => onToggleSelect?.(doc.id)}
          />
        </span>
      ) : null}
      <button
        type="button"
        style={openButtonStyle}
        aria-label={`${t('common.open')}: ${company}`}
        onClick={() => onOpen(doc.id)}
      />
      <AttentionBadge level={attention} />
      <DirectionChip direction={doc.direction} />
      <div className="doc-main">
        <div className="doc-name">{company}</div>
        <div className="doc-sub">
          {(compact
            ? [doc.invoiceDate ? formatIsoDate(doc.invoiceDate, lang) : '—']
            : [
                doc.invoiceDate ? formatIsoDate(doc.invoiceDate, lang) : '—',
                treatment
              ]
          )
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="doc-amount">
        {gross !== null ? (
          <>
            <div>
              {grossEur !== null ? formatEur(grossEur, lang) : isEur ? formatEur(gross, lang) : '—'}
            </div>
            {!isEur ? (
              <div className="orig">{formatCurrencyAmount(gross, doc.originalCurrency, lang)}</div>
            ) : null}
          </>
        ) : (
          <div className="muted">—</div>
        )}
      </div>
      {trailing !== undefined && trailing !== null ? (
        <span style={rowControlStyle}>{trailing}</span>
      ) : (
        <span className="doc-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={14} />
        </span>
      )}
    </div>
  )
}
