import { useId, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OverviewMonthSummary } from '@shared/domain'
import { activeLanguage } from '../i18n'
import { formatEur, formatMonth } from '../lib/format'
import { createOverviewChartScale } from '../lib/overview-chart'

function barStyle(bottomPercent: number, heightPercent: number): CSSProperties {
  return {
    bottom: `${bottomPercent}%`,
    height: `${heightPercent}%`
  }
}

export function IncomeExpenseChart({
  months,
  year
}: {
  months: readonly OverviewMonthSummary[]
  year: number
}): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const titleId = useId()
  const scale = createOverviewChartScale(months)
  const firstMonth = months[0]?.month
  const lastMonth = months[months.length - 1]?.month
  const range =
    firstMonth === undefined || lastMonth === undefined
      ? String(year)
      : firstMonth === lastMonth
        ? `${formatMonth(firstMonth, lang, 'short')} ${year}`
        : `${formatMonth(firstMonth, lang, 'short')} — ${formatMonth(lastMonth, lang, 'short')} · ${year}`

  return (
    <figure className="card overview-chart-card" aria-labelledby={titleId} data-overview-chart>
      <figcaption className="overview-card-heading">
        <div>
          <h2 id={titleId}>{t('overview.chartTitle')}</h2>
          <div className="overview-chart-legend">
            <span>
              <i className="income" aria-hidden="true" />
              {t('overview.chartIncome')}
            </span>
            <span>
              <i className="expense" aria-hidden="true" />
              {t('overview.chartExpenses')}
            </span>
          </div>
        </div>
        <span className="overview-card-range">{range}</span>
      </figcaption>

      <div className="overview-chart-plot">
        <span
          className="overview-chart-zero"
          style={{ bottom: `${scale.zeroPercent}%` }}
          aria-hidden="true"
        />
        {scale.empty ? <span className="overview-chart-empty">{t('overview.chartEmpty')}</span> : null}
        <div
          className="overview-chart-groups"
          role="list"
          aria-label={t('overview.chartTitle')}
          style={{ gridTemplateColumns: `repeat(${Math.max(1, months.length)}, minmax(24px, 1fr))` }}
        >
          {months.map((month) => {
            const income = scale.geometry(month.revenueEur)
            const expenses = scale.geometry(month.expensesEur)
            const monthName = formatMonth(month.month, lang)
            return (
              <div
                key={month.month}
                className="overview-chart-group"
                role="listitem"
                aria-label={t('overview.chartMonthAria', {
                  month: monthName,
                  income: formatEur(month.revenueEur, lang),
                  expenses: formatEur(month.expensesEur, lang)
                })}
              >
                <span
                  className={`overview-chart-bar income${income.negative ? ' negative' : ''}`}
                  style={barStyle(income.bottomPercent, income.heightPercent)}
                  title={`${t('overview.chartIncome')}: ${formatEur(month.revenueEur, lang)}`}
                  data-month={month.month}
                  data-series="income"
                  aria-hidden="true"
                />
                <span
                  className={`overview-chart-bar expense${expenses.negative ? ' negative' : ''}`}
                  style={barStyle(expenses.bottomPercent, expenses.heightPercent)}
                  title={`${t('overview.chartExpenses')}: ${formatEur(month.expensesEur, lang)}`}
                  data-month={month.month}
                  data-series="expenses"
                  aria-hidden="true"
                />
              </div>
            )
          })}
        </div>
      </div>

      <div
        className="overview-chart-months"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, months.length)}, minmax(24px, 1fr))` }}
        aria-hidden="true"
      >
        {months.map((month) => (
          <span key={month.month}>{formatMonth(month.month, lang, 'short')}</span>
        ))}
      </div>
    </figure>
  )
}
