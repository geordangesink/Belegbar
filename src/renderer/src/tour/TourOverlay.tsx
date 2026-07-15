/**
 * Lightweight spotlight tour engine (no dependencies).
 *
 * A fixed overlay dims the app; a cutout (huge box-shadow) highlights the
 * current target, found via its data-tour attribute and measured with
 * getBoundingClientRect (re-measured on resize/scroll). A floating card shows
 * title, body, step count and navigation. Esc exits, arrow keys navigate.
 * Steps may navigate screens via the router before measuring; missing targets
 * are skipped silently in the current travel direction.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useRouter } from '../context/RouterContext'
import { useToast } from '../context/ToastContext'
import type { TourStepDef } from './steps'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const CARD_WIDTH = 340
const CARD_EST_HEIGHT = 220
const SPOT_PADDING = 6
const MARGIN = 12

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
}

function measure(el: Element): SpotRect {
  const r = el.getBoundingClientRect()
  return {
    top: r.top - SPOT_PADDING,
    left: r.left - SPOT_PADDING,
    width: r.width + SPOT_PADDING * 2,
    height: r.height + SPOT_PADDING * 2
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

export function TourOverlay({
  steps,
  onExit
}: {
  steps: TourStepDef[]
  onExit: () => void
}): ReactNode {
  const { t } = useTranslation()
  const { go } = useRouter()
  const toast = useToast()

  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<SpotRect | null>(null)
  const dirRef = useRef<1 | -1>(1)
  const targetRef = useRef<Element | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  /** most recent document id: undefined = not fetched yet, null = none exists */
  const recentDocRef = useRef<string | null | undefined>(undefined)
  const notedMissingDocRef = useRef(false)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const step = steps[index]

  const advance = (dir: 1 | -1): void => {
    dirRef.current = dir
    const next = index + dir
    if (next >= steps.length) {
      onExit()
      return
    }
    if (next < 0) return
    setIndex(next)
  }

  // Resolve the step: navigate, then poll for the target and measure it.
  useEffect(() => {
    let cancelled = false
    setRect(null)
    targetRef.current = null

    const current = steps[index]
    if (!current) {
      onExitRef.current()
      return
    }

    // A missing target skips the stop silently, in the travel direction.
    const skip = (): void => {
      let next = index + dirRef.current
      if (next < 0) {
        dirRef.current = 1
        next = index + 1
      }
      if (next >= steps.length) onExitRef.current()
      else setIndex(next)
    }

    const run = async (): Promise<void> => {
      if (current.needsDocument) {
        if (recentDocRef.current === undefined) {
          try {
            const res = await api().listDocuments({ limit: 1 })
            recentDocRef.current = res.documents[0]?.id ?? null
          } catch {
            recentDocRef.current = null
          }
        }
        if (cancelled) return
        if (recentDocRef.current === null) {
          if (!notedMissingDocRef.current) {
            notedMissingDocRef.current = true
            toast.show(t('tour.noDocumentNote'))
          }
          skip()
          return
        }
        go({ name: 'review', id: recentDocRef.current })
      } else if (current.route) {
        go(current.route)
      }

      for (let attempt = 0; attempt < 40; attempt++) {
        if (cancelled) return
        const el = document.querySelector(`[data-tour="${current.target}"]`)
        if (el) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' })
          await nextFrame()
          if (cancelled) return
          targetRef.current = el
          setRect(measure(el))
          return
        }
        await sleep(50)
      }
      if (!cancelled) skip()
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps])

  // Keep the spotlight glued to the target on resize and scroll.
  useEffect(() => {
    const remeasure = (): void => {
      const el = targetRef.current
      if (el && el.isConnected) setRect(measure(el))
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
  }, [])

  // Esc exits, arrow keys navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onExitRef.current()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        advance(-1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps])

  // Move focus into the card whenever a stop is shown.
  const rectVisible = rect !== null
  useEffect(() => {
    if (rectVisible) cardRef.current?.focus()
  }, [rectVisible, index])

  // Tab stays inside the card (same trap as Dialog).
  const trapTab = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Tab' || !cardRef.current) return
    const focusables = [...cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  if (!step) return null

  const cardPos = ((): { top: number; left: number } => {
    if (!rect) return { top: 0, left: 0 }
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = rect.top + rect.height + MARGIN
    if (top + CARD_EST_HEIGHT > vh - 16) top = Math.max(16, rect.top - CARD_EST_HEIGHT - MARGIN)
    const left = Math.min(Math.max(16, rect.left), Math.max(16, vw - CARD_WIDTH - 16))
    return { top, left }
  })()

  const isLast = index === steps.length - 1

  return (
    <div className="tour-root" role="presentation">
      {rect ? (
        <>
          <div
            className="tour-cutout"
            aria-hidden="true"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
          <div
            className="tour-card"
            role="dialog"
            aria-modal="true"
            aria-label={t(`tour.steps.${step.id}.title`)}
            ref={cardRef}
            tabIndex={-1}
            style={{ top: cardPos.top, left: cardPos.left }}
            onKeyDown={trapTab}
          >
            <div className="tc-title">{t(`tour.steps.${step.id}.title`)}</div>
            <div className="tc-body">{t(`tour.steps.${step.id}.body`)}</div>
            <div className="tc-footer">
              <span className="tc-count num">
                {t('tour.stepCount', { current: index + 1, total: steps.length })}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
                {t('tour.exit')}
              </button>
              {index > 0 ? (
                <button type="button" className="btn btn-sm" onClick={() => advance(-1)}>
                  {t('common.back')}
                </button>
              ) : null}
              <button type="button" className="btn btn-primary btn-sm" onClick={() => advance(1)}>
                {isLast ? t('tour.done') : t('common.next')}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
