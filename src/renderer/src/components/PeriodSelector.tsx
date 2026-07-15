import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePeriod, yearOptions, type Quarter } from '../context/PeriodContext'
import { useSettings } from '../context/SettingsContext'

/** Topbar period control: year dropdown + quarter segmented control incl. 'Jahr'. */
export function PeriodSelector(): ReactNode {
  const { t } = useTranslation()
  const { year, quarter, setYear, setQuarter } = usePeriod()
  const { settings } = useSettings()

  const quarters: (Quarter | null)[] = [1, 2, 3, 4, null]

  return (
    <div className="row" role="group" aria-label={t('period.label')}>
      <select
        className="select"
        aria-label={t('period.year')}
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
      >
        {yearOptions(settings.defaultYear).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <div className="seg" role="group" aria-label={t('period.quarter')}>
        {quarters.map((q) => (
          <button
            key={q ?? 'year'}
            type="button"
            className={`seg-btn${quarter === q ? ' active' : ''}`}
            aria-pressed={quarter === q}
            onClick={() => setQuarter(q)}
          >
            {q === null ? t('period.fullYear') : t('period.q', { n: q })}
          </button>
        ))}
      </div>
    </div>
  )
}
