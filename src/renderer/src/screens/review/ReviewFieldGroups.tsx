import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import { activeLanguage } from '../../i18n'
import { formatEur, formatNumber, round2 } from '../../lib/format'
import { MoneyInput } from '../../components/MoneyInput'
import { Icon } from '../../components/Icon'
import { FieldRow, effective, type Patch, type PatchKey } from './FieldRow'

export interface GroupProps {
  doc: TaxDocument
  patch: Patch
  setField: <K extends PatchKey>(key: K, value: Patch[K]) => void
}

function TextField({
  doc,
  patch,
  setField,
  fieldKey,
  label,
  transform,
  maxLength,
  confKeys
}: GroupProps & {
  fieldKey: PatchKey
  label: string
  transform?: (s: string) => string
  maxLength?: number
  confKeys?: string[]
}): ReactNode {
  const value = effective(doc, patch, fieldKey)
  return (
    <FieldRow label={label} doc={doc} patch={patch} fieldKey={fieldKey} confKeys={confKeys}>
      <input
        id={`field-${fieldKey}`}
        className="input"
        maxLength={maxLength}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => {
          const raw = transform ? transform(e.target.value) : e.target.value
          setField(fieldKey, (raw === '' ? null : raw) as Patch[typeof fieldKey])
        }}
      />
    </FieldRow>
  )
}

function DateField({
  doc,
  patch,
  setField,
  fieldKey,
  label
}: GroupProps & { fieldKey: PatchKey; label: string }): ReactNode {
  const value = effective(doc, patch, fieldKey)
  return (
    <FieldRow label={label} doc={doc} patch={patch} fieldKey={fieldKey}>
      <input
        id={`field-${fieldKey}`}
        className="input"
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) =>
          setField(fieldKey, (e.target.value === '' ? null : e.target.value) as Patch[typeof fieldKey])
        }
      />
    </FieldRow>
  )
}

/**
 * The essentials the user is directly faced with: invoice date, the
 * counterparty that matters for the direction, the invoice number (only while
 * it is flagged or uncertain) and the description. Everything else lives in
 * the collapsed "More details" section below.
 */
export function EssentialsGroup(
  props: GroupProps & { showInvoiceNumber: boolean }
): ReactNode {
  const { t } = useTranslation()
  const { doc, patch, setField, showInvoiceNumber } = props
  const income = doc.direction === 'income'
  const description = effective(doc, patch, 'description')
  return (
    <section className="field-group">
      <h2 className="section-title">{t('review.groupDocument')}</h2>
      <DateField {...props} fieldKey="invoiceDate" label={t('review.invoiceDate')} />
      {income ? (
        <TextField {...props} fieldKey="recipientName" label={t('review.recipientName')} />
      ) : (
        <TextField {...props} fieldKey="issuerName" label={t('review.issuerName')} />
      )}
      {showInvoiceNumber ? (
        <TextField {...props} fieldKey="invoiceNumber" label={t('review.invoiceNumber')} />
      ) : null}
      <FieldRow label={t('review.description')} doc={doc} patch={patch} fieldKey="description">
        <textarea
          id="field-description"
          className="textarea"
          rows={2}
          value={typeof description === 'string' ? description : ''}
          onChange={(e) => setField('description', e.target.value === '' ? null : e.target.value)}
        />
      </FieldRow>
    </section>
  )
}

// Expander state survives switching documents within a session
// (module-level memory; intentionally reset only by an app restart).
const detailsMemory = { open: false }

/**
 * Single collapsed "More details" section: invoice number (while not flagged),
 * service period, due date, the user's own side of the parties, VAT IDs,
 * country codes, business-status select and category. Nothing is removed —
 * only foldered.
 */
export function MoreDetailsSection(
  props: GroupProps & { showInvoiceNumber: boolean }
): ReactNode {
  const { t } = useTranslation()
  const { doc, patch, setField, showInvoiceNumber } = props
  const [open, setOpen] = useState(detailsMemory.open)
  const business = effective(doc, patch, 'recipientIsBusiness')
  const upper = (s: string): string => s.toUpperCase()
  const income = doc.direction === 'income'

  const toggle = (): void =>
    setOpen((v) => {
      detailsMemory.open = !v
      return !v
    })

  const issuerName = <TextField {...props} fieldKey="issuerName" label={t('review.issuerName')} />
  const issuerExtras = (
    <>
      <TextField
        {...props}
        fieldKey="issuerCountryCode"
        label={t('review.issuerCountry')}
        transform={upper}
        maxLength={2}
      />
      <TextField {...props} fieldKey="issuerVatId" label={t('review.issuerVatId')} transform={upper} />
    </>
  )
  const recipientName = (
    <TextField {...props} fieldKey="recipientName" label={t('review.recipientName')} />
  )
  const recipientExtras = (
    <>
      <TextField
        {...props}
        fieldKey="recipientCountryCode"
        label={t('review.recipientCountry')}
        transform={upper}
        maxLength={2}
      />
      <TextField
        {...props}
        fieldKey="recipientVatId"
        label={t('review.recipientVatId')}
        transform={upper}
      />
      <FieldRow
        label={t('review.recipientIsBusiness')}
        doc={doc}
        patch={patch}
        fieldKey="recipientIsBusiness"
      >
        <select
          id="field-recipientIsBusiness"
          className="select"
          value={business === null ? '' : business ? 'yes' : 'no'}
          onChange={(e) =>
            setField(
              'recipientIsBusiness',
              e.target.value === '' ? null : e.target.value === 'yes'
            )
          }
        >
          <option value="">{t('review.businessUnknown')}</option>
          <option value="yes">{t('review.businessYes')}</option>
          <option value="no">{t('review.businessNo')}</option>
        </select>
      </FieldRow>
    </>
  )

  return (
    <section className="field-group">
      <button type="button" className="details-toggle" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        {t('review.moreDetails')}
      </button>
      {open ? (
        <div className="mt-8">
          {!showInvoiceNumber ? (
            <TextField {...props} fieldKey="invoiceNumber" label={t('review.invoiceNumber')} />
          ) : null}
          <DateField {...props} fieldKey="serviceDateFrom" label={t('review.servicePeriodFrom')} />
          <DateField {...props} fieldKey="serviceDateTo" label={t('review.servicePeriodTo')} />
          <DateField {...props} fieldKey="dueDate" label={t('review.dueDate')} />

          <h3 className="section-title mt-16">{t('review.groupParties')}</h3>
          <p className="small muted" style={{ marginBottom: 10 }}>
            {t('review.counterpartyHint', { direction: t(`direction.${doc.direction}`) })}
          </p>
          {income ? (
            <>
              {/* counterparty (recipient) name is up in the essentials */}
              {recipientExtras}
              <div style={{ opacity: 0.75 }}>
                {issuerName}
                {issuerExtras}
              </div>
            </>
          ) : (
            <>
              {/* counterparty (issuer) name is up in the essentials */}
              {issuerExtras}
              <div style={{ opacity: 0.75 }}>
                {recipientName}
                {recipientExtras}
              </div>
            </>
          )}

          <h3 className="section-title mt-16">{t('review.groupDescription')}</h3>
          <TextField {...props} fieldKey="expenseCategory" label={t('review.category')} />
        </div>
      ) : null}
    </section>
  )
}

export function AmountsGroup(props: GroupProps): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { doc, patch, setField } = props

  const currency = (effective(doc, patch, 'originalCurrency') ?? 'EUR').toUpperCase()
  const rate = effective(doc, patch, 'exchangeRateToEur')
  const isEur = currency === 'EUR'
  const rateSource = effective(doc, patch, 'exchangeRateSource')

  const amountField = (
    fieldKey: 'netAmountOriginal' | 'vatAmountOriginal' | 'grossAmountOriginal',
    label: string,
    confAlias: string
  ): ReactNode => {
    const value = effective(doc, patch, fieldKey)
    const numeric = typeof value === 'number' ? value : null
    const mirror =
      !isEur && numeric !== null && typeof rate === 'number' ? round2(numeric * rate) : null
    return (
      <FieldRow label={label} doc={doc} patch={patch} fieldKey={fieldKey} confKeys={[confAlias]}>
        <div className="row">
          <MoneyInput
            id={`field-${fieldKey}`}
            value={numeric}
            ariaLabel={`${label} (${currency})`}
            onCommit={(v) => setField(fieldKey, v)}
          />
          <span className="small muted num">{currency}</span>
        </div>
        {mirror !== null ? (
          <span className="small muted num">
            {t('review.eurMirror', { amount: formatEur(mirror, lang) })}
          </span>
        ) : null}
      </FieldRow>
    )
  }

  return (
    <section className="field-group">
      <h2 className="section-title">{t('review.groupAmounts')}</h2>
      <FieldRow
        label={t('review.currency')}
        doc={doc}
        patch={patch}
        fieldKey="originalCurrency"
        confKeys={['currency']}
      >
        <input
          id="field-originalCurrency"
          className="input"
          style={{ width: 90 }}
          maxLength={5}
          value={effective(doc, patch, 'originalCurrency') ?? ''}
          onChange={(e) => {
            const v = e.target.value.toUpperCase()
            setField('originalCurrency', v === '' ? null : v)
          }}
        />
      </FieldRow>
      {amountField('netAmountOriginal', t('review.netAmount'), 'netAmount')}
      {amountField('vatAmountOriginal', t('review.vatAmount'), 'vatAmount')}
      {amountField('grossAmountOriginal', t('review.grossAmount'), 'grossAmount')}

      {doc.vatRates.length > 0 ? (
        <p className="small muted">
          {doc.vatRates
            .map(
              (line) =>
                `${formatNumber(line.rate, lang, 0)} %: ${formatNumber(line.netAmountOriginal, lang)} + ${formatNumber(line.vatAmountOriginal, lang)}`
            )
            .join(' · ')}
        </p>
      ) : null}

      {!isEur ? (
        <>
          {typeof rate !== 'number' ? (
            <div className="inline-note warn" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>{t('review.missingRateWarning', { currency })}</span>
            </div>
          ) : null}
          <FieldRow
            label={t('review.exchangeRate')}
            doc={doc}
            patch={patch}
            fieldKey="exchangeRateToEur"
          >
            <div className="row">
              <MoneyInput
                id="field-exchangeRateToEur"
                value={typeof rate === 'number' ? rate : null}
                digits={6}
                ariaLabel={t('review.exchangeRateManual')}
                onCommit={(v) => {
                  setField('exchangeRateToEur', v)
                  setField('exchangeRateSource', v === null ? null : 'manual')
                }}
              />
              <span className="small muted">
                {rateSource
                  ? t('review.exchangeRateSource', {
                      source: rateSource === 'manual' ? t('common.manual') : rateSource
                    })
                  : null}
              </span>
            </div>
          </FieldRow>
        </>
      ) : null}
    </section>
  )
}
