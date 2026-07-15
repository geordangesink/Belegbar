import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'
import i18next, { initI18n, resolveLanguage } from './i18n'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/domain'

async function boot(): Promise<void> {
  const rootEl = document.getElementById('root')
  if (!rootEl) return

  // Provisional theme before settings load — avoids a light-mode flash.
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)')
    .matches
    ? 'dark'
    : 'light'

  let settings: AppSettings = DEFAULT_SETTINGS
  let systemLocale = 'en'
  let bootFailed = false
  try {
    settings = await window.belegbar.getSettings()
    systemLocale = await window.belegbar.getSystemLocale()
  } catch {
    bootFailed = true
    systemLocale = navigator.language || 'en'
  }

  await initI18n(resolveLanguage(settings.language, systemLocale))

  if (bootFailed || typeof window.belegbar === 'undefined') {
    rootEl.innerHTML = ''
    const div = document.createElement('div')
    div.className = 'empty-state'
    div.setAttribute('role', 'alert')
    div.textContent = i18next.t('app.bootError')
    rootEl.appendChild(div)
    return
  }

  createRoot(rootEl).render(
    <StrictMode>
      <App initialSettings={settings} systemLocale={systemLocale} />
    </StrictMode>
  )
}

void boot()
