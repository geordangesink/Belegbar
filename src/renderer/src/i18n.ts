import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { LanguageSetting } from '@shared/domain'
import de from './locales/de.json'
import en from './locales/en.json'

export type ActiveLanguage = 'de' | 'en'

export function resolveLanguage(setting: LanguageSetting, systemLocale: string): ActiveLanguage {
  if (setting === 'de' || setting === 'en') return setting
  return systemLocale.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export async function initI18n(language: ActiveLanguage): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: {
      de: { translation: de },
      en: { translation: en }
    },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnEmptyString: false
  })
}

export function changeLanguage(language: ActiveLanguage): void {
  if (i18next.language !== language) void i18next.changeLanguage(language)
}

/** Current UI language ('de' | 'en'). */
export function activeLanguage(): ActiveLanguage {
  return i18next.language === 'de' ? 'de' : 'en'
}

export default i18next
