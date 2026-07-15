import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { IncomeTaxEstimate } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { useDataVersion } from '../../lib/bus'
import { activeLanguage } from '../../i18n'
import { formatEur } from '../../lib/format'
import { usePeriod, yearOptions } from '../../context/PeriodContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'

export function IncomeTab(): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { year: periodYear } = usePeriod()
  const { settings } = useSettings()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [year, setYear] = useState(periodYear)
  const [estimate, setEstimate] = useState<IncomeTaxEstimate | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    setYear(periodYear)
  }, [periodYear])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const e = await api().getIncomeTaxEstimate(year)
        if (!cancelled) setEstimate(e)
      } catch (err) {
        if (!cancelled) toast.error(t(errorToKey(err)))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, dataVersion])

  if (!estimate) return <div className="empty-state">{t('app.loading')}</div>

  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: t('taxes.estProfit'), value: estimate.estimatedProfit },
    { label: t('taxes.estTaxableIncome'), value: estimate.estimatedTaxableIncome },
    { label: t('taxes.estIncomeTax'), value: estimate.estimatedIncomeTax },
    { label: t('taxes.estSoli'), value: estimate.solidaritySurcharge },
    { label: t('taxes.estChurch'), value: estimate.churchTax },
    { label: t('taxes.estPrepayments'), value: estimate.prepayments },
    { label: t('taxes.estReserve'), value: estimate.suggestedReserve, strong: true }
  ]

  const notes = [...estimate.assumptions, ...estimate.incompleteItems]

  return (
    <div>
      <div className="row mb-16">
        <label className="muted small" htmlFor="est-year">
          {t('taxes.estYear')}
        </label>
        <select
          id="est-year"
          className="select"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {yearOptions(settings.defaultYear).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="chip chip-neutral">{t('taxes.estimateBadge')}</span>
      </div>

      <div className="card" style={{ padding: '8px 20px' }} data-tour="taxes-income">
        <table className="calc-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.strong ? 'total' : undefined}>
                <td>{row.label}</td>
                <td className="amount">{formatEur(row.value, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notes.length > 0 ? (
        <section className="mt-24">
          <h2 className="section-title">{t('taxes.estAssumptionsTitle')}</h2>
          <div className="card" style={{ padding: '12px 20px' }}>
            <ul style={{ paddingLeft: 18, margin: 0 }} className="muted small">
              {notes.map((note, i) => (
                <li key={i} style={{ padding: '2px 0' }}>
                  {t(`reasons.${note}`, { defaultValue: note })}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="mt-24">
        <button
          type="button"
          className="expand-btn"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          {t('taxes.estDetails')}
        </button>
        {detailsOpen ? (
          <div className="card mt-8" style={{ padding: '12px 20px' }}>
            <div className="small muted stack">
              <span>{t('taxes.estIncludedDocs')}:</span>
              <span>
                {t('taxes.estIncome', {
                  count:
                    estimate.recognizedIncome.confirmedIds.length +
                    estimate.recognizedIncome.provisionalIds.length
                })}{' '}
                ·{' '}
                {t('taxes.estExpenses', {
                  count:
                    estimate.recognizedExpenses.confirmedIds.length +
                    estimate.recognizedExpenses.provisionalIds.length
                })}
              </span>
              <span>{t('taxes.estEngine', { version: estimate.engineVersion })}</span>
              <span>
                {t('taxes.estMethod', {
                  method: t(`incomeTaxMethod.${settings.incomeTaxMethod}`)
                })}
              </span>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
