import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import { activeLanguage } from '../i18n'
import { formatCurrencyAmount, formatEur, formatIsoDate } from '../lib/format'
import { DirectionChip, ReviewStatusGlyph } from './StatusBits'
import { treatmentLabelKey } from '../lib/vatTreatments'

export function counterpartyName(doc: TaxDocument): string | null {
  return doc.direction === 'income' ? doc.recipientName : doc.issuerName
}

export function DocumentRow({
  doc,
  onOpen,
  selectable,
  selected,
  onToggleSelect,
  trailing
}: {
  doc: TaxDocument
  onOpen: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  trailing?: ReactNode
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()

  const company = counterpartyName(doc) ?? doc.storedFilename
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
      role="button"
      tabIndex={0}
      onClick={() => onOpen(doc.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(doc.id)
      }}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected ?? false}
          aria-label={t('documents.selectRow')}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(doc.id)}
        />
      ) : null}
      <ReviewStatusGlyph status={doc.reviewStatus} />
      <DirectionChip direction={doc.direction} />
      <div className="doc-main">
        <div className="doc-name">{company}</div>
        <div className="doc-sub">
          {[
            doc.invoiceDate ? formatIsoDate(doc.invoiceDate, lang) : '—',
            treatment,
            t(`reviewStatus.${doc.reviewStatus}`)
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="doc-amount">
        {gross !== null ? (
          <>
            <div>{grossEur !== null ? formatEur(grossEur, lang) : isEur ? formatEur(gross, lang) : '—'}</div>
            {!isEur ? (
              <div className="orig">{formatCurrencyAmount(gross, doc.originalCurrency, lang)}</div>
            ) : null}
          </>
        ) : (
          <div className="muted">—</div>
        )}
      </div>
      {trailing}
    </div>
  )
}
