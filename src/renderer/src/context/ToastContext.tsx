import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../components/Icon'

export type ToastKind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  show(text: string, kind?: ToastKind): void
  success(text: string): void
  error(text: string): void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}

const GLYPH: Record<ToastKind, { char: string; cls: string }> = {
  info: { char: 'ℹ', cls: 'neutral' },
  success: { char: '✓', cls: 'ok' },
  error: { char: '✕', cls: 'crit' }
}

const TOAST_DURATION = 4500

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setToasts((list) => list.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, kind, text }])
    const timer = window.setTimeout(() => {
      timers.current.delete(id)
      setToasts((list) => list.filter((t) => t.id !== id))
    }, TOAST_DURATION)
    timers.current.set(id, timer)
  }, [])

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer)
      timers.current.clear()
    },
    []
  )

  const apiValue = useMemo<ToastApi>(
    () => ({
      show,
      success: (text) => show(text, 'success'),
      error: (text) => show(text, 'error')
    }),
    [show]
  )

  return (
    <ToastContext.Provider value={apiValue}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            style={{ '--toast-duration': `${TOAST_DURATION}ms` } as CSSProperties}
          >
            <span className={`status-glyph ${GLYPH[toast.kind].cls}`} aria-hidden="true">
              {GLYPH[toast.kind].char}
            </span>
            <span className="toast-message">{toast.text}</span>
            <button
              type="button"
              className="icon-btn toast-dismiss"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => dismiss(toast.id)}
            >
              <Icon name="close" size={12} />
            </button>
            <span className="toast-progress" aria-hidden="true">
              <span className="toast-progress-bar" />
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
