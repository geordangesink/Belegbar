import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OverviewSummary, TaxDocument } from '@shared/domain'
import { api, errorToKey } from '../lib/api'
import { useDataVersion } from '../lib/bus'
import { activeLanguage } from '../i18n'
import { formatEur } from '../lib/format'
import { usePeriod } from '../context/PeriodContext'
import { useRouter } from '../context/RouterContext'
import { useToast } from '../context/ToastContext'
import { DropZone } from '../components/DropZone'
import { DocumentRow } from '../components/DocumentRow'
import { Icon } from '../components/Icon'

export function Overview(): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { period } = usePeriod()
  const { push, go } = useRouter()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [summary, setSummary] = useState<OverviewSummary | null>(null)
  const [recent, setRecent] = useState<TaxDocument[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [s, docs] = await Promise.all([
          api().getOverview(period),
          api().listDocuments({ limit: 8 })
        ])
        if (cancelled) return
        setSummary(s)
        setRecent(docs.documents)
      } catch (err) {
        if (!cancelled) toast.error(t(errorToKey(err)))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.year, period.quarter, dataVersion])

  const included = (b: { confirmed: number; provisional: number }): number =>
    b.confirmed + b.provisional

  const tiles = summary
    ? [
        { label: t('overview.tileRevenue'), value: included(summary.revenueEur) },
        { label: t('overview.tileExpenses'), value: included(summary.expensesEur) },
        { label: t('overview.tileProfit'), value: summary.profitEur },
        { label: t('overview.tileVat'), value: summary.vatPayableEur },
        { label: t('overview.tileReserve'), value: summary.suggestedTaxReserveEur }
      ]
    : []

  const attention = summary
    ? ([
        summary.documentsNeedingReview > 0
          ? {
              key: 'review',
              text: t('overview.attentionReview', { count: summary.documentsNeedingReview }),
              onClick: () =>
                go({ name: 'documents', preset: { reviewStatus: 'needs_review' } })
            }
          : null,
        summary.paymentDatesMissing > 0
          ? {
              key: 'payment',
              text: t('overview.attentionPayment', { count: summary.paymentDatesMissing }),
              onClick: () =>
                go({ name: 'documents', preset: { clientFilter: 'payment_missing' } })
            }
          : null,
        summary.exchangeRatesMissing > 0
          ? {
              key: 'rates',
              text: t('overview.attentionRates', { count: summary.exchangeRatesMissing }),
              onClick: () => go({ name: 'documents', preset: { clientFilter: 'rate_missing' } })
            }
          : null
      ].filter(Boolean) as { key: string; text: string; onClick: () => void }[])
    : []

  return (
    <div className="content-inner">
      <div className="dropzones mb-24" data-tour="dropzones">
        <DropZone direction="income" />
        <DropZone direction="expense" />
      </div>

      {summary ? (
        <>
          <div className="tiles-row">
            {tiles.map((tile) => (
              <div key={tile.label} className="tile">
                <span className="tile-label">{tile.label}</span>
                <span className="tile-value">{formatEur(tile.value, lang)}</span>
              </div>
            ))}
          </div>
          {summary.documentsNeedingReview > 0 ? (
            <div className="mt-8">
              <button
                type="button"
                className="link-btn small"
                style={{ color: 'var(--text-2)' }}
                onClick={() => go({ name: 'documents', preset: { reviewStatus: 'needs_review' } })}
              >
                {t('overview.provisionalNote', { count: summary.documentsNeedingReview })}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {attention.length > 0 ? (
        <section className="mt-32" data-tour="attention">
          <h2 className="section-title">{t('overview.attentionTitle')}</h2>
          <div className="card">
            {attention.map((item) => (
              <button
                key={item.key}
                type="button"
                className="doc-row"
                style={{ width: '100%', border: 'none', textAlign: 'left' }}
                onClick={item.onClick}
              >
                <span className="status-glyph warn" aria-hidden="true">
                  ⚠
                </span>
                <span className="doc-main">{item.text}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-32">
        <h2 className="section-title">{t('overview.recentTitle')}</h2>
        {recent.length === 0 ? (
          <div className="card empty-state">{t('overview.recentEmpty')}</div>
        ) : (
          <div className="card doc-list">
            {recent.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                compact
                onOpen={(id) => push({ name: 'review', id })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
