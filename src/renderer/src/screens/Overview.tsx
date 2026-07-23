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
import { IncomeExpenseChart } from '../components/IncomeExpenseChart'
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
          api().listDocuments({ limit: 4, sort: 'recent' })
        ])
        if (cancelled) return
        setSummary(s)
        setRecent(docs.documents.filter((document) => document.deletedAt === null))
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
        { key: 'revenue', label: t('overview.tileRevenue'), value: included(summary.revenueEur) },
        { key: 'expenses', label: t('overview.tileExpenses'), value: included(summary.expensesEur) },
        { key: 'profit', label: t('overview.tileProfit'), value: summary.profitEur },
        { key: 'vat', label: t('overview.tileVat'), value: summary.vatPayableEur },
        { key: 'reserve', label: t('overview.tileReserve'), value: summary.suggestedTaxReserveEur }
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
    <div className="content-inner overview-page">
      <header className="page-header compact-page-header">
        <h1>{t('nav.overview')}</h1>
      </header>

      <section className="import-surface" data-tour="dropzones">
        <div className="import-heading">
          <h2>{t('documents.addDocuments')}</h2>
        </div>
        <div className="dropzones">
          <DropZone direction="income" />
          <DropZone direction="expense" />
        </div>
      </section>

      {summary ? (
        <div className="tiles-row summary-tiles">
          {tiles.map((tile) => (
            <div key={tile.key} className={`tile tile-${tile.key}`}>
              <span className="tile-label">{tile.label}</span>
              <span className="tile-value">{formatEur(tile.value, lang)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="tiles-row summary-tiles" role="status" aria-label={t('app.loading')}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="tile tile-skeleton">
              <span className="skeleton-line short" />
              <span className="skeleton-line value" />
            </div>
          ))}
        </div>
      )}

      {summary && attention.length > 0 ? (
        <section className="overview-section" data-tour="attention">
          <div className="section-heading">
            <h2>{t('overview.attentionTitle')}</h2>
            <span className="count-pill">{attention.length}</span>
          </div>
          <div className="card attention-list">
            {attention.map((item) => (
              <button
                key={item.key}
                type="button"
                className="doc-row attention-row"
                onClick={item.onClick}
              >
                <span className="attention-row-icon" aria-hidden="true">
                  !
                </span>
                <span className="doc-main">
                  <strong>{item.text}</strong>
                </span>
                <span className="row-action">
                  <Icon name="chevron-right" size={14} />
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {summary ? (
        <div className="overview-section overview-detail-grid">
          <IncomeExpenseChart months={summary.monthly} year={period.year} />
          <section className="card overview-recent-card recent-section">
            <div className="overview-card-heading">
              <h2>{t('overview.recentTitle')}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => go({ name: 'documents' })}
              >
                {t('overview.viewAll')} <Icon name="chevron-right" size={13} />
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="empty-state">
                <span>{t('documents.emptyTitle')}</span>
              </div>
            ) : (
              <div className="doc-list">
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
      ) : null}
    </div>
  )
}
