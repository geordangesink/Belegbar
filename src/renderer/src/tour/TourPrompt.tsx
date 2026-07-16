/**
 * Calm post-onboarding dialog: "Möchtest du eine kurze Tour?" with four cards
 * (none / minimum / medium / full). Esc or clicking outside dismisses it for
 * this session only — the choice is persisted by the caller once picked.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../components/Dialog'
import type { TourDepth } from './steps'

export type TourChoice = 'none' | TourDepth

export function TourPrompt({
  onPick,
  onDismiss
}: {
  onPick: (choice: TourChoice) => void
  onDismiss: () => void
}): ReactNode {
  const { t } = useTranslation()

  const options: { value: TourChoice; title: string; desc: string }[] = [
    { value: 'none', title: t('tour.optionNone'), desc: t('tour.optionNoneDesc') },
    { value: 'minimum', title: t('tour.optionMinimum'), desc: t('tour.optionMinimumDesc') },
    { value: 'medium', title: t('tour.optionMedium'), desc: t('tour.optionMediumDesc') },
    { value: 'full', title: t('tour.optionFull'), desc: t('tour.optionFullDesc') }
  ]

  return (
    <Dialog title={t('tour.promptTitle')} onClose={onDismiss}>
      <div className="option-cards">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="option-card"
            onClick={() => onPick(opt.value)}
          >
            <span className="oc-title">{opt.title}</span>
            <span className="oc-desc">{opt.desc}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
