import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { DocumentDirection, ReviewStatus } from '@shared/domain'

/** Client-side-only filters that the list API cannot express. */
export type ClientDocFilter = 'payment_missing' | 'rate_missing'

export interface DocumentsPreset {
  search?: string
  reviewStatus?: ReviewStatus
  direction?: DocumentDirection
  clientFilter?: ClientDocFilter
}

export type Route =
  | { name: 'overview' }
  | { name: 'documents'; preset?: DocumentsPreset }
  | { name: 'review'; id: string }
  | { name: 'taxes'; tab?: 'vat' | 'income' }
  | { name: 'settings' }

export type RouteName = Route['name']

interface RouterCtx {
  route: Route
  /** push onto the stack (e.g. opening a document) */
  push(route: Route): void
  /** replace the whole stack (sidebar navigation) */
  go(route: Route): void
  back(): void
  canGoBack: boolean
}

const Ctx = createContext<RouterCtx | null>(null)

export function useRouter(): RouterCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRouter outside RouterProvider')
  return ctx
}

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [stack, setStack] = useState<Route[]>([{ name: 'overview' }])

  const push = useCallback((route: Route) => {
    setStack((s) => [...s, route])
  }, [])

  const go = useCallback((route: Route) => {
    setStack([route])
  }, [])

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const value = useMemo<RouterCtx>(() => {
    const route = stack[stack.length - 1] ?? { name: 'overview' }
    return { route, push, go, back, canGoBack: stack.length > 1 }
  }, [stack, push, go, back])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
