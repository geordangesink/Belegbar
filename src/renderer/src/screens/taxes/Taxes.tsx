import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { VatTab } from './VatTab'
import { IncomeTab } from './IncomeTab'

export function Taxes({ initialTab }: { initialTab?: 'vat' | 'income' }): ReactNode {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'vat' | 'income'>(initialTab ?? 'vat')

  // Route-driven tab changes (e.g. the tour navigating between tabs) must win
  // even when the component instance is reused.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  return (
    <div className="content-inner taxes-page">
      <header className="page-header compact-page-header taxes-header">
        <h1>{t('taxes.title')}</h1>
        <div className="seg tax-tabs" role="tablist" aria-label={t('taxes.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'vat'}
            className={`seg-btn${tab === 'vat' ? ' active' : ''}`}
            onClick={() => setTab('vat')}
          >
            {t('taxes.tabVat')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'income'}
            className={`seg-btn${tab === 'income' ? ' active' : ''}`}
            onClick={() => setTab('income')}
          >
            {t('taxes.tabIncome')}
          </button>
        </div>
      </header>
      <div key={tab} className="tab-panel">
        {tab === 'vat' ? <VatTab /> : <IncomeTab />}
      </div>
      <p className="disclaimer">{t('taxes.disclaimer')}</p>
    </div>
  )
}
