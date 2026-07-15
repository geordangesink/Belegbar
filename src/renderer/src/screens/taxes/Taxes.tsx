import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { VatTab } from './VatTab'
import { IncomeTab } from './IncomeTab'

export function Taxes({ initialTab }: { initialTab?: 'vat' | 'income' }): ReactNode {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'vat' | 'income'>(initialTab ?? 'vat')

  return (
    <div className="content-inner">
      <div className="row mb-24">
        <div className="seg" role="tablist" aria-label={t('taxes.title')}>
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
      </div>
      {tab === 'vat' ? <VatTab /> : <IncomeTab />}
      <p className="disclaimer">{t('taxes.disclaimer')}</p>
    </div>
  )
}
