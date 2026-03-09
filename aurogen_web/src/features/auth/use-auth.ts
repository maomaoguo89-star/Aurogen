import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createElement } from 'react'
import { fetchJson, AUTH_STORAGE_KEY } from '@/lib/api'
import i18n from '@/lib/i18n'

export type AuthStatus = 'checking' | 'first_login' | 'need_password' | 'authenticated'

type AuthContextValue = {
  status: AuthStatus
  error: string | null
  login: (password: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

type CheckAuthResponse = { status: 'first_login' | 'success' | 'failed' }
type SetPasswordResponse = { status: 'success' }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const savedKey = localStorage.getItem(AUTH_STORAGE_KEY) ?? ''

    fetchJson<CheckAuthResponse>('/check-auth', {
      method: 'POST',
      body: JSON.stringify({ password: savedKey }),
      skipAuth: true,
    })
      .then((res) => {
        if (res.status === 'first_login') {
          setStatus('first_login')
        } else if (res.status === 'success') {
          setStatus('authenticated')
        } else {
          setStatus('need_password')
        }
      })
      .catch(() => {
        setStatus('need_password')
      })
  }, [])

  useEffect(() => {
    const handler = () => {
      setStatus('need_password')
      setError(i18n.t('auth.sessionExpired'))
    }

    window.addEventListener('aurogen:auth-failed', handler)
    return () => window.removeEventListener('aurogen:auth-failed', handler)
  }, [])

  const login = useCallback(async (password: string) => {
    setError(null)
    try {
      const res = await fetchJson<CheckAuthResponse>('/check-auth', {
        method: 'POST',
        body: JSON.stringify({ password }),
        skipAuth: true,
      })

      if (res.status === 'success') {
        localStorage.setItem(AUTH_STORAGE_KEY, password)
        setStatus('authenticated')
      } else if (res.status === 'first_login') {
        setStatus('first_login')
      } else {
        setError(i18n.t('auth.wrongPassword'))
      }
    } catch {
      setError(i18n.t('auth.networkError'))
    }
  }, [])

  const setPasswordFn = useCallback(async (password: string) => {
    setError(null)
    try {
      await fetchJson<SetPasswordResponse>('/set-password', {
        method: 'POST',
        body: JSON.stringify({ password }),
        skipAuth: true,
      })

      localStorage.setItem(AUTH_STORAGE_KEY, password)
      setStatus('authenticated')
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('auth.setPasswordFailed'))
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setStatus('need_password')
    setError(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, error, login, setPassword: setPasswordFn, logout }),
    [status, error, login, setPasswordFn, logout],
  )

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
