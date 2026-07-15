import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentDirection, ProcessingStatus, ReviewStatus } from '@shared/domain'

/** Status is never conveyed by color alone: glyph + (usually) text label. */

const REVIEW_GLYPH: Record<ReviewStatus, { char: string; cls: string }> = {
  confirmed: { char: '✓', cls: 'ok' },
  needs_review: { char: '⚠', cls: 'warn' },
  failed: { char: '✕', cls: 'crit' },
  processing: { char: '…', cls: 'neutral' }
}

export function ReviewStatusGlyph({ status }: { status: ReviewStatus }): ReactNode {
  const { t } = useTranslation()
  const g = REVIEW_GLYPH[status]
  return (
    <span
      className={`status-glyph ${g.cls}`}
      role="img"
      aria-label={t(`reviewStatus.${status}`)}
      title={t(`reviewStatus.${status}`)}
    >
      {g.char}
    </span>
  )
}

export function ReviewStatusChip({ status }: { status: ReviewStatus }): ReactNode {
  const { t } = useTranslation()
  const g = REVIEW_GLYPH[status]
  const chipCls =
    status === 'confirmed'
      ? 'chip-ok'
      : status === 'needs_review'
        ? 'chip-warn'
        : status === 'failed'
          ? 'chip-crit'
          : 'chip-neutral'
  return (
    <span className={`chip ${chipCls}`}>
      <span aria-hidden="true">{g.char}</span> {t(`reviewStatus.${status}`)}
    </span>
  )
}

const PROCESSING_GLYPH: Partial<Record<ProcessingStatus, { char: string; cls: string }>> = {
  completed: { char: '✓', cls: 'ok' },
  completed_with_warnings: { char: '⚠', cls: 'warn' },
  failed: { char: '✕', cls: 'crit' },
  duplicate: { char: '=', cls: 'neutral' }
}

export function ProcessingGlyph({ status }: { status: ProcessingStatus }): ReactNode {
  const { t } = useTranslation()
  const g = PROCESSING_GLYPH[status] ?? { char: '…', cls: 'neutral' }
  return (
    <span
      className={`status-glyph ${g.cls}`}
      role="img"
      aria-label={t(`processing.${status}`)}
      title={t(`processing.${status}`)}
    >
      {g.char}
    </span>
  )
}

export function DirectionChip({ direction }: { direction: DocumentDirection }): ReactNode {
  const { t } = useTranslation()
  return <span className={`dir-chip ${direction}`}>{t(`direction.${direction}`)}</span>
}

export type ConfidenceLevel = 'recognized' | 'check' | 'missing' | 'manual'

export function confidenceLevel(
  value: unknown,
  confidence: number | undefined,
  edited: boolean
): ConfidenceLevel {
  if (edited) return 'manual'
  if (value === null || value === undefined || value === '') return 'missing'
  if ((confidence ?? 0) >= 0.85) return 'recognized'
  return 'check'
}

const CONFIDENCE_UI: Record<ConfidenceLevel, { char: string; cls: string }> = {
  recognized: { char: '✓', cls: 'chip-ok' },
  check: { char: '⚠', cls: 'chip-warn' },
  missing: { char: '—', cls: 'chip-neutral' },
  manual: { char: '✎', cls: 'chip-neutral' }
}

/** Field confidence chip — never shows percentages. */
export function ConfidenceChip({ level }: { level: ConfidenceLevel }): ReactNode {
  const { t } = useTranslation()
  const ui = CONFIDENCE_UI[level]
  return (
    <span className={`chip ${ui.cls}`}>
      <span aria-hidden="true">{ui.char}</span> {t(`confidence.${level}`)}
    </span>
  )
}
