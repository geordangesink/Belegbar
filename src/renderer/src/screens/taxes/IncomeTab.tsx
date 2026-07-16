import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { IncomeTaxEstimate } from '@shared/domain'
import { api, errorToKey } from '../../lib/api'
import { useDataVersion } from '../../lib/bus'
import { activeLanguage } from '../../i18n'
import { formatEur } from '../../lib/format'
import { usePeriod } from '../../context/PeriodContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'

const ESTG_TARIFF_SOURCE_URL = 'https://www.gesetze-im-internet.de/estg/__32a.html'
const SOLZG_SOURCE_URL = 'https://www.gesetze-im-internet.de/solzg_1995/'
const ESTIMATE_NOTE_KEYS: Readonly<Record<string, string>> = {
  'Church tax is estimated without child allowances or regional caps.':
    'taxes.estChurchCaveat',
  'Solidarity surcharge is estimated without child-allowance effects.':
    'taxes.estSoliCaveat'
}

export function IncomeTab(): ReactNode {
  const { t } = useTranslation()
  const lang = activeLanguage()
  const { year: periodYear } = usePeriod()
  const { settings } = useSettings()
  const toast = useToast()
  const dataVersion = useDataVersion()

  const [estimate, setEstimate] = useState<IncomeTaxEstimate | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadEstimate = async (): Promise<void> => {
      try {
        const e = await api().getIncomeTaxEstimate(periodYear)
        if (!cancelled) setEstimate(e)
      } catch (err) {
        if (!cancelled) toast.error(t(errorToKey(err)))
      }
    }
    void loadEstimate()
    const refreshTimers = [
      window.setTimeout(() => void loadEstimate(), 1500),
      window.setTimeout(() => void loadEstimate(), 5500)
    ]
    return () => {
      cancelled = true
      refreshTimers.forEach((timer) => window.clearTimeout(timer))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodYear, dataVersion])

  if (!estimate) {
    return (
      <div className="card loading-state" aria-label={t('app.loading')}>
        <span className="loading-orb" />
        <span>{t('app.loading')}</span>
      </div>
    )
  }

  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: t('taxes.estProfit'), value: estimate.estimatedProfit },
    { label: t('taxes.estTaxableIncome'), value: estimate.estimatedTaxableIncome },
    { label: t('taxes.estIncomeTax'), value: estimate.estimatedIncomeTax },
    ...(settings.includeSolidaritySurcharge
      ? [{ label: t('taxes.estSoli'), value: estimate.solidaritySurcharge }]
      : []),
    ...(settings.churchTax !== 'none'
      ? [{ label: t('taxes.estChurch'), value: estimate.churchTax }]
      : []),
    ...(estimate.prepayments !== 0
      ? [{ label: t('taxes.estPrepayments'), value: estimate.prepayments }]
      : []),
    { label: t('taxes.estReserve'), value: estimate.suggestedReserve, strong: true }
  ]

  const notes = [...estimate.assumptions, ...estimate.incompleteItems]
  const engineYear = /^\d{4}/.exec(estimate.engineVersion)?.[0] ?? String(estimate.year)
  const officialIncomeUpdate = /\+gii-\d{8}/.test(estimate.engineVersion)
  const officialSoliUpdate = estimate.engineVersion.includes('+gii-solzg-')
  const soliFallbackYear = /\+solzg-fallback-(\d{4})/.exec(estimate.engineVersion)?.[1]

  return (
    <div>
      <div className="card calc-card income-calc-card" data-tour="taxes-income">
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
        <p className="tax-base-note">{t('taxes.estTaxBaseHint')}</p>
      </div>

      {notes.length > 0 ? (
        <section className="mt-24">
          <h2 className="section-title">{t('taxes.estAssumptionsTitle')}</h2>
          <div className="card tax-notes-card">
            <ul className="muted small tax-notes-list">
              {notes.map((note, i) => (
                <li key={i}>
                  {ESTIMATE_NOTE_KEYS[note]
                    ? t(ESTIMATE_NOTE_KEYS[note])
                    : t(`reasons.${note}`, { defaultValue: note })}
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
          <div className="card mt-8 tax-estimate-details">
            <section>
              <h3>{t('taxes.estBridgeTitle')}</h3>
              <div className="tax-bridge">
                <div>
                  <span>{t('taxes.estBridgeProfit')}</span>
                  <strong>{formatEur(estimate.estimatedProfit, lang)}</strong>
                </div>
                <div>
                  <span>{t('taxes.estBridgeOtherIncome')}</span>
                  <strong>{formatEur(estimate.otherTaxableIncome, lang)}</strong>
                </div>
                <div>
                  <span>{t('taxes.estBridgeContributions')}</span>
                  <strong>{formatEur(estimate.deductibleContributions, lang)}</strong>
                </div>
                <div className="tax-bridge-total">
                  <span>{t('taxes.estBridgeTaxable')}</span>
                  <strong>{formatEur(estimate.estimatedTaxableIncome, lang)}</strong>
                </div>
              </div>
              <p>{t('taxes.estTaxBaseExplanation')}</p>
            </section>

            <section>
              <h3>{t('taxes.estSourceTitle')}</h3>
              <div className="tax-source-list">
                <div>
                  <strong>
                    <a
                      className="tax-source-link"
                      href={ESTG_TARIFF_SOURCE_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('taxes.estTaxSource', { year: engineYear })}
                    </a>
                  </strong>
                  <span>
                    {t(
                      officialIncomeUpdate
                        ? 'taxes.estTaxSourceOfficial'
                        : 'taxes.estTaxSourceBundled'
                    )}
                  </span>
                </div>
                {settings.includeSolidaritySurcharge ? (
                  <div>
                    <strong>
                      <a
                        className="tax-source-link"
                        href={SOLZG_SOURCE_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('taxes.estSoliSource', {
                          year: soliFallbackYear ?? engineYear
                        })}
                      </a>
                    </strong>
                    <span>
                      {t(
                        soliFallbackYear
                          ? 'taxes.estSoliSourceFallback'
                          : officialSoliUpdate
                            ? 'taxes.estSoliSourceOfficial'
                            : 'taxes.estSoliSourceBundled'
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            <dl className="tax-estimate-facts">
              <div>
                <dt>{t('taxes.estIncludedDocs')}</dt>
                <dd>
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
                </dd>
              </div>
              <div>
                <dt>{t('taxes.estMethodLabel')}</dt>
                <dd>{t(`incomeTaxMethod.${settings.incomeTaxMethod}`)}</dd>
              </div>
              <div>
                <dt>{t('taxes.estEngineLabel')}</dt>
                <dd>{estimate.engineVersion}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>
    </div>
  )
}
