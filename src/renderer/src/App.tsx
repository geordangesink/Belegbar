import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '@shared/domain'
import { SettingsProvider, useSettings } from './context/SettingsContext'
import { PeriodProvider } from './context/PeriodContext'
import { RouterProvider } from './context/RouterContext'
import { ToastProvider } from './context/ToastContext'
import { ImportProvider } from './context/ImportContext'
import { wireLlmDataRefresh } from './lib/bus'
import { Shell } from './shell/Shell'
import { Onboarding } from './screens/Onboarding'

function Root(): ReactNode {
  const { settings } = useSettings()
  const [onboarded, setOnboarded] = useState(settings.onboardingCompleted)

  // Finished LLM checks must refresh every list — subscribe once per app.
  useEffect(() => {
    wireLlmDataRefresh()
  }, [])

  if (!onboarded) {
    return <Onboarding onDone={() => setOnboarded(true)} />
  }

  return (
    <PeriodProvider defaultYear={settings.defaultYear}>
      <RouterProvider>
        <ImportProvider>
          <Shell />
        </ImportProvider>
      </RouterProvider>
    </PeriodProvider>
  )
}

export function App({
  initialSettings,
  systemLocale
}: {
  initialSettings: AppSettings
  systemLocale: string
}): ReactNode {
  return (
    <ToastProvider>
      <SettingsProvider initialSettings={initialSettings} systemLocale={systemLocale}>
        <Root />
      </SettingsProvider>
    </ToastProvider>
  )
}
