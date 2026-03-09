import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'aurogen-theme'

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(resolved)
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch { /* noop */ }
  return 'system'
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    const pref = readPreference()
    return pref === 'system' ? getSystemTheme() : pref
  })

  const apply = useCallback((pref: ThemePreference) => {
    const next = pref === 'system' ? getSystemTheme() : pref
    setResolved(next)
    applyTheme(next)
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* noop */ }
    apply(next)
  }, [apply])

  const cycle = useCallback(() => {
    const order: ThemePreference[] = ['dark', 'light', 'system']
    const idx = order.indexOf(preference)
    setPreference(order[(idx + 1) % order.length])
  }, [preference, setPreference])

  useEffect(() => {
    apply(preference)
  }, [apply, preference])

  useEffect(() => {
    if (preference !== 'system') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => apply('system')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference, apply])

  return { preference, resolved, setPreference, cycle }
}
