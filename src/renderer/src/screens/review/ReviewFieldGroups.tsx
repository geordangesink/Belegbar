import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaxDocument } from '@shared/domain'
import type { FieldAttentionLevel } from '@core/review/attention'
import { activeLanguage } from '../../i18n'
import { formatEur, formatNumber, round2 } from '../../lib/format'
import { MoneyInput } from '../../components/MoneyInput'
import { Icon } from '../../components/Icon'
import { FieldRow, effective, type Patch, type PatchKey } from './FieldRow'

const BMF_RATES_DATASET_URL =
  'https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/steuern-zoelle/umsatzsteuer-umrechnungskurse/umsatzsteuer-umrechnungskurse.html'

export interface GroupProps {
  doc: TaxDocument
  patch: Patch
  setField: <K extends PatchKey>(key: K, value: Patch[K]) => void
  fieldAttention: Readonly<Record<string, FieldAttentionLevel>>
}

function TextField({
  doc,
  patch,
  setField,
  fieldKey,
  label,
  transform,
  maxLength,
  fieldAttention
}: GroupProps & {
  fieldKey: PatchKey
  label: string
  transform?: (s: string) => string
  maxLength?: number
}): ReactNode {
  const value = effective(doc, patch, fieldKey)
  return (
    <FieldRow
      label={label}
      doc={doc}
      patch={patch}
      fieldKey={fieldKey}
      fieldAttention={fieldAttention}
    >
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
  label,
  fieldAttention
}: GroupProps & { fieldKey: PatchKey; label: string }): ReactNode {
  const value = effective(doc, patch, fieldKey)
  return (
    <FieldRow
      label={label}
      doc={doc}
      patch={patch}
      fieldKey={fieldKey}
      fieldAttention={fieldAttention}
    >
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
  const { doc, patch, setField, showInvoiceNumber, fieldAttention } = props
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
      <FieldRow
        label={t('review.description')}
        doc={doc}
        patch={patch}
        fieldKey="description"
        fieldAttention={fieldAttention}
      >
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
  const income = doc.direction === 'income'
  const detailFields = [
    ...(!showInvoiceNumber ? ['invoiceNumber'] : []),
    'serviceDateFrom',
    'serviceDateTo',
    'dueDate',
    income ? 'issuerName' : 'recipientName',
    'issuerCountryCode',
    'issuerVatId',
    'recipientCountryCode',
    'recipientVatId',
    'recipientIsBusiness',
    'expenseCategory'
  ]
  const flaggedDetails = detailFields.filter((field) => props.fieldAttention[field]).length
  const [open, setOpen] = useState(flaggedDetails > 0)
  useEffect(() => {
    if (flaggedDetails > 0) setOpen(true)
  }, [flaggedDetails])
  const business = effective(doc, patch, 'recipientIsBusiness')
  const upper = (s: string): string => s.toUpperCase()

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
        fieldAttention={props.fieldAttention}
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
      <button
        type="button"
        className="details-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        {t('review.moreDetails')}
        {flaggedDetails > 0 ? (
          <span className="details-attention-count">{flaggedDetails}</span>
        ) : null}
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
          {income ? (
            <>
              {recipientExtras}
              <div className="secondary-party-fields">
                {issuerName}
                {issuerExtras}
              </div>
            </>
          ) : (
            <>
              {issuerExtras}
              <div className="secondary-party-fields">
                {recipientName}
                {recipientExtras}
              </div>
            </>
          )}

          <TextField {...props} fieldKey="expenseCategory" label={t('review.category')} />
        </div>
      ) : null}
    </section>
  )
}

export function AmountsGroup(props: GroupProps): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { doc, patch, setField, fieldAttention } = props

  const currency = (effective(doc, patch, 'originalCurrency') ?? 'EUR').toUpperCase()
  const rate = effective(doc, patch, 'exchangeRateToEur')
  const isEur = currency === 'EUR'
  const rateSource = effective(doc, patch, 'exchangeRateSource')
  const isBmfMonthlyRate = rateSource?.startsWith('BMF USt-Umrechnungskurs') === true
  const bmfPeriod = isBmfMonthlyRate ? rateSource?.match(/(\d{4}-\d{2})$/)?.[1] : undefined
  const rateSourceLabel =
    rateSource === 'manual'
      ? t('common.manual')
      : isBmfMonthlyRate
        ? t('review.bmfRateSource', { period: bmfPeriod ?? '' })
        : rateSource

  const amountField = (
    fieldKey: 'netAmountOriginal' | 'vatAmountOriginal' | 'grossAmountOriginal',
    label: string
  ): ReactNode => {
    const value = effective(doc, patch, fieldKey)
    const numeric = typeof value === 'number' ? value : null
    const mirror =
      !isEur && numeric !== null && typeof rate === 'number' ? round2(numeric * rate) : null
    return (
      <FieldRow
        label={label}
        doc={doc}
        patch={patch}
        fieldKey={fieldKey}
        fieldAttention={fieldAttention}
      >
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
        fieldAttention={fieldAttention}
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
      {amountField('netAmountOriginal', t('review.netAmount'))}
      {amountField('vatAmountOriginal', t('review.vatAmount'))}
      {amountField('grossAmountOriginal', t('review.grossAmount'))}

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
            fieldAttention={fieldAttention}
          >
            <div className="row">
              <MoneyInput
                id="field-exchangeRateToEur"
                value={typeof rate === 'number' ? rate : null}
                digits={10}
                ariaLabel={t('review.exchangeRateManual')}
                onCommit={(v) => {
                  setField('exchangeRateToEur', v)
                  setField('exchangeRateSource', v === null ? null : 'manual')
                }}
              />
              <span className="small muted">
                {rateSource
                  ? t('review.exchangeRateSource', {
                      source: rateSourceLabel
                    })
                  : null}
              </span>
            </div>
            {isBmfMonthlyRate ? (
              <span className="rate-attribution">
                <span className="small muted">
                  <a
                    className="link-btn"
                    href={BMF_RATES_DATASET_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('review.bmfRateDataset')}
                  </a>{' '}
                  · {t('review.bmfRateLicense')}
                </span>
                <span className="small muted">{t('review.bmfRateScope')}</span>
              </span>
            ) : null}
          </FieldRow>
        </>
      ) : null}
    </section>
  )
}
