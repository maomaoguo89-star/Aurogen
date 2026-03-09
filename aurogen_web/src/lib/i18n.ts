import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import zh from '@/locales/zh.json'

export const LOCALE_STORAGE_KEY = 'aurogen-locale'

export type Locale = 'en' | 'zh'

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch { /* noop */ }
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: readLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
