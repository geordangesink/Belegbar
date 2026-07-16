import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function ImportModeControl({
  moveOriginals,
  onChange
}: {
  moveOriginals: boolean
  onChange: (moveOriginals: boolean) => void
}): ReactNode {
  const { t } = useTranslation()

  return (
    <div
      className="seg import-mode-control"
      role="group"
      aria-label={t('settings.importHandling')}
    >
      <button
        type="button"
        className={`seg-btn${moveOriginals ? '' : ' active'}`}
        aria-pressed={!moveOriginals}
        onClick={() => onChange(false)}
      >
        {t('settings.importCopy')}
      </button>
      <button
        type="button"
        className={`seg-btn${moveOriginals ? ' active' : ''}`}
        aria-pressed={moveOriginals}
        onClick={() => onChange(true)}
      >
        {t('settings.importMove')}
      </button>
    </div>
  )
}
