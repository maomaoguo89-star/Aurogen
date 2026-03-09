import { useCallback, useState } from 'react'
import i18n, { type Locale, LOCALE_STORAGE_KEY } from '@/lib/i18n'

export type { Locale }

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch { /* noop */ }
  return 'en'
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(readLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next) } catch { /* noop */ }
    void i18n.changeLanguage(next)
  }, [])

  const toggle = useCallback(() => {
    setLocale(locale === 'en' ? 'zh' : 'en')
  }, [locale, setLocale])

  return { locale, setLocale, toggle }
}
