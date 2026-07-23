import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AmountBreakdown, VatSummary } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { useDataVersion } from '../../lib/bus'
import { activeLanguage } from '../../i18n'
import { formatEur, shortId } from '../../lib/format'
import { usePeriod } from '../../context/PeriodContext'
import { useRouter } from '../../context/RouterContext'
import { useToast } from '../../context/ToastContext'

function BreakdownLine({
  label,
  sign,
  breakdown,
  onOpenDoc
}: {
  label: string
  sign: '+' | '−' | ''
  breakdown: AmountBreakdown
  onOpenDoc: (id: string) => void
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const [expanded, setExpanded] = useState(false)
  const included = breakdown.confirmed + breakdown.provisional

  const bucket = (
    key: 'bucketConfirmed' | 'bucketProvisional' | 'bucketExcluded',
    amount: number,
    ids: string[]
  ): ReactNode => (
    <div className="row small" style={{ alignItems: 'flex-start', padding: '2px 0' }}>
      <span className="muted" style={{ width: 110, flexShrink: 0 }}>
        {t(`taxes.${key}`)}
      </span>
      <span className="num" style={{ width: 110, flexShrink: 0, textAlign: 'right' }}>
        {formatEur(amount, lang)}
      </span>
      <span style={{ flex: 1 }}>
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            className="link-btn small"
            style={{ marginRight: 8 }}
            onClick={() => onOpenDoc(id)}
          >
            {t('taxes.docLink', { id: shortId(id) })}
          </button>
        ))}
      </span>
    </div>
  )

  return (
    <tr>
      <td>
        <button
          type="button"
          className="expand-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {sign ? `${sign} ` : ''}
          {label}
        </button>
        {expanded ? (
          <div className="mt-8">
            {bucket('bucketConfirmed', breakdown.confirmed, breakdown.confirmedIds)}
            {bucket('bucketProvisional', breakdown.provisional, breakdown.provisionalIds)}
            {bucket('bucketExcluded', breakdown.excluded, breakdown.excludedIds)}
          </div>
        ) : null}
      </td>
      <td className="amount">{formatEur(included, lang)}</td>
    </tr>
  )
}

export function VatTab(): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { year, quarter } = usePeriod()
  const { push, go } = useRouter()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [summary, setSummary] = useState<VatSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await api().getVatSummary({ year, quarter, month: null })
        if (!cancelled) setSummary(s)
      } catch (err) {
        if (!cancelled) toast.error(t(errorToKey(err)))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, quarter, dataVersion])

  const openDoc = (id: string): void => push({ name: 'review', id })

  if (!summary) {
    return (
      <div className="card loading-state" aria-label={t('app.loading')}>
        <span className="loading-orb" />
        <span>{t('app.loading')}</span>
      </div>
    )
  }

  const refund = summary.estimatedPayable < 0

  const periodLabel =
    quarter !== null ? `${t('period.q', { n: quarter })} ${year}` : `${year}`

  const revenueAmount = (breakdown: AmountBreakdown): number =>
    breakdown.confirmed + breakdown.provisional

  const revenueRow = (label: string, breakdown: AmountBreakdown): ReactNode => {
    const amount = revenueAmount(breakdown)
    if (amount === 0) return null
    return (
      <tr>
        <td>{label}</td>
        <td className="amount">{formatEur(amount, lang)}</td>
      </tr>
    )
  }

  const hasRevenueDetails =
    [
      summary.domesticTaxableRevenue,
      summary.euReverseChargeRevenue,
      summary.thirdCountryNonTaxableRevenue,
      summary.taxExemptRevenue
    ].some((breakdown) => revenueAmount(breakdown) !== 0) ||
    summary.revenueNeedingReview !== 0

  return (
    <div>
      <div className={`card tax-hero ${refund ? 'refund' : 'payable'}`} data-tour="taxes-vat">
        <div className="section-title">
          {refund ? t('taxes.vatResultRefund') : t('taxes.vatResultPayable')}
        </div>
        <div className="hero-number">{formatEur(Math.abs(summary.estimatedPayable), lang)}</div>
        <div className="tax-hero-caption">{periodLabel}</div>
        {summary.documentsNeedingReview > 0 ? (
          <button
            type="button"
            className="link-btn small mt-8"
            onClick={() => go({ name: 'documents', preset: { reviewStatus: 'needs_review' } })}
          >
            <span className="status-glyph warn" aria-hidden="true">
              ⚠
            </span>{' '}
            {t('taxes.provisionalLink', { count: summary.documentsNeedingReview })}
          </button>
        ) : null}
      </div>

      <div className="tax-detail-grid">
        <section>
          <h2 className="section-title">{t('taxes.calcTitle')}</h2>
          <div className="card calc-card">
            <table className="calc-table">
              <tbody>
                <BreakdownLine label={t('taxes.lineOutputVat')} sign="" breakdown={summary.outputVat} onOpenDoc={openDoc} />
                <BreakdownLine label={t('taxes.lineInputVat')} sign="−" breakdown={summary.inputVat} onOpenDoc={openDoc} />
                <BreakdownLine label={t('taxes.lineRcVat')} sign="+" breakdown={summary.reverseChargeVat} onOpenDoc={openDoc} />
                <BreakdownLine
                  label={t('taxes.lineRcInputVat')}
                  sign="−"
                  breakdown={summary.reverseChargeInputVat}
                  onOpenDoc={openDoc}
                />
                <tr className="total">
                  <td>= {t('taxes.lineResult')}</td>
                  <td className="amount">{formatEur(summary.estimatedPayable, lang)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {hasRevenueDetails ? (
          <section>
            <h2 className="section-title">{t('taxes.revenueByTypeTitle')}</h2>
            <div className="card calc-card">
              <table className="calc-table">
                <tbody>
                  {revenueRow(t('taxes.revDomestic'), summary.domesticTaxableRevenue)}
                  {revenueRow(t('taxes.revEuB2b'), summary.euReverseChargeRevenue)}
                  {revenueRow(t('taxes.revThirdCountry'), summary.thirdCountryNonTaxableRevenue)}
                  {revenueRow(t('taxes.revExempt'), summary.taxExemptRevenue)}
                  {summary.revenueNeedingReview !== 0 ? (
                    <tr>
                      <td>
                        <span className="status-glyph warn" aria-hidden="true">
                          ⚠
                        </span>{' '}
                        {t('taxes.revNeedsReview')}
                      </td>
                      <td className="amount">{formatEur(summary.revenueNeedingReview, lang)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
