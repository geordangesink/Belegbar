/**
 * Tour orchestration: shows the one-time depth prompt while
 * settings.tourChoice === 'pending' (fresh after onboarding — and once for
 * existing users) and exposes start(depth) so Settings can re-run the tour
 * at any depth without persisting anything.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '../context/SettingsContext'
import { stepsForDepth, type TourDepth } from './steps'
import { TourOverlay } from './TourOverlay'
import { TourPrompt, type TourChoice } from './TourPrompt'

interface TourCtx {
  /** run the tour now at the given depth (does not persist anything) */
  start(depth: TourDepth): void
}

const Ctx = createContext<TourCtx | null>(null)

export function useTour(): TourCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTour outside TourProvider')
  return ctx
}

export function TourProvider({ children }: { children: ReactNode }): ReactNode {
  const { settings, update } = useSettings()
  const [running, setRunning] = useState<TourDepth | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(false)

  const start = useCallback((depth: TourDepth) => setRunning(depth), [])

  // Stable identity: the tour itself navigates (re-rendering this provider);
  // a fresh steps array each render would re-trigger the engine's step effect.
  const steps = useMemo(() => (running !== null ? stepsForDepth(running) : null), [running])

  const pick = (choice: TourChoice): void => {
    setPromptDismissed(true)
    void update({ tourChoice: choice }).catch(() => undefined)
    if (choice !== 'none') setRunning(choice)
  }

  const showPrompt = settings.tourChoice === 'pending' && !promptDismissed && running === null

  const value = useMemo<TourCtx>(() => ({ start }), [start])

  return (
    <Ctx.Provider value={value}>
      {children}
      {showPrompt ? <TourPrompt onPick={pick} onDismiss={() => setPromptDismissed(true)} /> : null}
      {steps !== null ? <TourOverlay steps={steps} onExit={() => setRunning(null)} /> : null}
    </Ctx.Provider>
  )
}
