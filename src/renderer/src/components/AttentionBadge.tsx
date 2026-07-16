/**
 * The ONE user-facing status badge. Renders an AttentionLevel (computed by
 * core/review/attention.ts) identically in every list, panel and detail view:
 *
 *  - confirmed → green checkmark   (user confirmed the document)
 *  - ok        → green ring        (confident analysis, nothing to check)
 *  - minor     → yellow question circle (unimportant readings are uncertain)
 *  - warning   → yellow triangle   (potentially tax-relevant problem)
 *  - critical  → red stop mark     (real concern; excluded from totals)
 *
 * Status is never conveyed by color alone: the shape differs per tier and a
 * text label (labeled variant) or tooltip + aria-label (icon-only variant)
 * is always present.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AttentionLevel } from '@shared/domain'

export const ATTENTION_LEVELS: readonly AttentionLevel[] = [
  'confirmed',
  'ok',
  'minor',
  'warning',
  'critical'
]

const LEVEL_CLASS: Record<AttentionLevel, string> = {
  confirmed: 'attn-confirmed',
  ok: 'attn-ok',
  minor: 'attn-minor',
  warning: 'attn-warning',
  critical: 'attn-critical'
}

/** Each tier remains distinguishable without color. */
function AttentionGlyph({ level, size }: { level: AttentionLevel; size: number }): ReactNode {
  if (level === 'confirmed') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.8 8.6 6.3 12 13.2 4.4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (level === 'ok') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    )
  }
  if (level === 'minor') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2" fill="none" />
        <path
          d="M6.2 6.3c.2-1.1.9-1.7 2-1.7 1.2 0 2 .7 2 1.7 0 .9-.5 1.3-1.3 1.8-.7.4-.9.8-.9 1.3"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.3" r="0.75" fill="currentColor" />
      </svg>
    )
  }
  if (level === 'critical') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5 1.5h6L14.5 5v6L11 14.5H5L1.5 11V5L5 1.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8 4.6v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.1 14.6 13.5H1.4L8 2.1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6.3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.9" fill="currentColor" />
    </svg>
  )
}

/**
 * Variants:
 *  - icon-only (default): for list rows — label via tooltip + aria-label
 *  - withLabel: icon + text label, chip-styled — for detail headers
 */
export function AttentionBadge({
  level,
  withLabel = false,
  size = 14
}: {
  level: AttentionLevel
  withLabel?: boolean
  size?: number
}): ReactNode {
  const { t } = useTranslation()
  const label = t(`attention.label.${level}`)
  const tooltip = t(`attention.tooltip.${level}`)

  if (withLabel) {
    return (
      <span className={`attention-badge with-label ${LEVEL_CLASS[level]}`} title={tooltip}>
        <AttentionGlyph level={level} size={size} />
        <span>{label}</span>
      </span>
    )
  }
  return (
    <span
      className={`attention-badge ${LEVEL_CLASS[level]}`}
      role="img"
      aria-label={label}
      title={`${label} – ${tooltip}`}
    >
      <AttentionGlyph level={level} size={size} />
    </span>
  )
}
