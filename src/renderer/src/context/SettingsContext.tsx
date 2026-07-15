import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { AppSettings } from '@shared/domain'
import type { UpdateSettingsPayload } from '@shared/ipc'
import { api } from '../lib/api'
import { changeLanguage, resolveLanguage } from '../i18n'

interface SettingsCtx {
  settings: AppSettings
  systemLocale: string
  update(patch: UpdateSettingsPayload): Promise<void>
  refresh(): Promise<void>
}

const Ctx = createContext<SettingsCtx | null>(null)

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings outside SettingsProvider')
  return ctx
}

function applyTheme(theme: AppSettings['theme'], systemDark: boolean): void {
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
}

export function SettingsProvider({
  initialSettings,
  systemLocale,
  children
}: {
  initialSettings: AppSettings
  systemLocale: string
  children: ReactNode
}): ReactNode {
  const [settings, setSettings] = useState<AppSettings>(initialSettings)

  // Theme: settings + system listener.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(settings.theme, media.matches)
    const onChange = (e: MediaQueryListEvent): void => applyTheme(settings.theme, e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings.theme])

  // Language follows setting (system locale resolved at boot).
  useEffect(() => {
    changeLanguage(resolveLanguage(settings.language, systemLocale))
  }, [settings.language, systemLocale])

  const update = useCallback(async (patch: UpdateSettingsPayload) => {
    const next = await api().updateSettings(patch)
    setSettings(next)
  }, [])

  const refresh = useCallback(async () => {
    setSettings(await api().getSettings())
  }, [])

  const value = useMemo<SettingsCtx>(
    () => ({ settings, systemLocale, update, refresh }),
    [settings, systemLocale, update, refresh]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
