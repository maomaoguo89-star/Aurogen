import { type FormEvent, useState } from 'react'
import { AlertCircle, Eye, EyeOff, KeyRound, LoaderCircle, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/use-auth'

export function AuthScreen() {
  const { status, error, login, setPassword } = useAuth()
  const { t } = useTranslation()
  const [password, setPasswordValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const isFirstLogin = status === 'first_login'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!password.trim() || busy) return

    setBusy(true)
    try {
      if (isFirstLogin) {
        await setPassword(password.trim())
      } else {
        await login(password.trim())
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-transparent px-4 text-[var(--color-text-primary)]">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass-surface w-full max-w-sm px-8 py-10"
      >
        <div className="mb-8 flex flex-col items-center gap-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)]"
          >
            <Sparkles className="h-6 w-6 text-[var(--color-accent)]" />
          </motion.div>
          <div className="text-center">
            <h1 className="text-lg font-semibold">Aurogen</h1>
            <p className="mt-1 text-[13px] subtle-text">
              {isFirstLogin ? t('auth.firstTime') : t('auth.enterPassword')}
            </p>
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-4 py-3 text-[13px] text-[var(--color-danger)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="auth-password" className="text-[11px] tracking-[0.06em] tertiary-text">
              {isFirstLogin ? t('auth.setPasswordLabel') : t('auth.passwordLabel')}
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
                <KeyRound className="h-4 w-4" />
              </div>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPasswordValue(e.target.value)}
                placeholder={isFirstLogin ? t('auth.newPasswordPlaceholder') : t('auth.passwordPlaceholder')}
                autoFocus
                disabled={busy}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-3 pl-10 pr-11 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-secondary)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!password.trim() || busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] py-2.5 text-[13px] font-medium text-[var(--color-bg-app)] transition-all duration-150 hover:-translate-y-px hover:bg-[var(--color-text-primary)]/90 hover:shadow-[0_2px_8px_var(--color-border-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isFirstLogin ? t('auth.confirmSet') : t('auth.login')}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] tertiary-text">
          Agent Ops Console
        </p>
      </motion.div>
    </div>
  )
}

export function AuthLoadingScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-transparent text-[var(--color-text-primary)]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)]">
          <Sparkles className="h-6 w-6 text-[var(--color-accent)]" />
        </div>
        <div className="flex items-center gap-2 text-sm subtle-text">
          <LoaderCircle className="h-4 w-4 animate-spin text-[var(--color-accent)]" />
          {t('auth.verifying')}
        </div>
      </motion.div>
    </div>
  )
}
