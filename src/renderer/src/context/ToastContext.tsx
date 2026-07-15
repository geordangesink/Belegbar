import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

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

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, kind, text }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, 4500)
  }, [])

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
          <div key={toast.id} className="toast">
            <span className={`status-glyph ${GLYPH[toast.kind].cls}`} aria-hidden="true">
              {GLYPH[toast.kind].char}
            </span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
