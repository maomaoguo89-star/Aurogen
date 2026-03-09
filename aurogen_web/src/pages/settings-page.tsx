import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Timer,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson, AUTH_STORAGE_KEY } from '@/lib/api'

type HeartbeatConfig = {
  agent_name: string
  interval_s: number
  enabled: boolean
}

type CronConfig = {
  agent_name: string
  enabled: boolean
}

type AgentOption = {
  key: string
  name: string
}

async function fetchHeartbeatConfig() {
  return fetchJson<HeartbeatConfig>('/heartbeat/config')
}

async function fetchCronConfig() {
  return fetchJson<CronConfig>('/cron/config')
}

async function fetchAgentOptions() {
  const res = await fetchJson<{ agents: { key: string; name: string }[] }>('/agents')
  return res.agents.map((a) => ({ key: a.key, name: a.name }))
}

async function updateHeartbeat(data: { agent_name?: string; interval_s?: number; enabled?: boolean }) {
  return fetchJson<{ message: string }>('/heartbeat/config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function updateCron(data: { agent_name?: string; enabled?: boolean }) {
  return fetchJson<{ message: string }>('/cron/config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function changePassword(newPassword: string) {
  return fetchJson<{ message: string }>('/set-config', {
    method: 'POST',
    body: JSON.stringify({ path: 'auth.password', value: newPassword }),
  })
}

function useSettingsController() {
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig | null>(null)
  const [cron, setCron] = useState<CronConfig | null>(null)
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [hb, cr, ag] = await Promise.all([
        fetchHeartbeatConfig(),
        fetchCronConfig(),
        fetchAgentOptions(),
      ])
      setHeartbeat(hb)
      setCron(cr)
      setAgents(ag)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载设置失败'
      setError(msg)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      await reload()
      if (active) setLoading(false)
    }
    void init()
    return () => { active = false }
  }, [reload])

  const showSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg)
    setTimeout(() => setSuccessMessage(null), 2500)
  }, [])

  const handleUpdateHeartbeat = useCallback(async (data: { agent_name?: string; interval_s?: number; enabled?: boolean }, tFn: (k: string) => string) => {
    setSavingSection('heartbeat')
    setError(null)
    try {
      await updateHeartbeat(data)
      await reload()
      showSuccess(tFn('settings.heartbeatSaved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [reload, showSuccess])

  const handleUpdateCron = useCallback(async (data: { agent_name?: string; enabled?: boolean }, tFn: (k: string) => string) => {
    setSavingSection('cron')
    setError(null)
    try {
      await updateCron(data)
      await reload()
      showSuccess(tFn('settings.cronSaved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [reload, showSuccess])

  const handleChangePassword = useCallback(async (newPassword: string, tFn: (k: string) => string) => {
    setSavingSection('password')
    setError(null)
    try {
      await changePassword(newPassword)
      localStorage.setItem(AUTH_STORAGE_KEY, newPassword)
      showSuccess(tFn('settings.passwordChanged'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : tFn('common.loadFailed')
      setError(msg)
    } finally {
      setSavingSection(null)
    }
  }, [showSuccess])

  return {
    heartbeat,
    cron,
    agents,
    loading,
    error,
    savingSection,
    successMessage,
    setError,
    handleUpdateHeartbeat,
    handleUpdateCron,
    handleChangePassword,
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const {
    heartbeat,
    cron,
    agents,
    loading,
    error,
    savingSection,
    successMessage,
    setError,
    handleUpdateHeartbeat,
    handleUpdateCron,
    handleChangePassword,
  } = useSettingsController()

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      {error ? (
        <div className="panel-surface flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-5 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('common.operationError')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">{error}</p>
          </div>
          <button type="button" onClick={() => setError(null)} className="shrink-0 p-1 transition hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {successMessage ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="panel-surface border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-5 py-3 text-[13px] font-medium text-[var(--color-success)]"
        >
          {successMessage}
        </motion.div>
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <LoaderCircle className="h-6 w-6 animate-spin text-[var(--color-accent)]" />
            <p className="text-[13px] subtle-text">{t('settings.loading')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <HeartbeatCard
            config={heartbeat}
            agents={agents}
            saving={savingSection === 'heartbeat'}
            onSave={(data) => handleUpdateHeartbeat(data, t)}
          />
          <CronCard
            config={cron}
            agents={agents}
            saving={savingSection === 'cron'}
            onSave={(data) => handleUpdateCron(data, t)}
          />
          <PasswordCard
            saving={savingSection === 'password'}
            onSave={(pw) => handleChangePassword(pw, t)}
          />
        </div>
      )}
    </section>
  )
}

function HeartbeatCard({
  config,
  agents,
  saving,
  onSave,
}: {
  config: HeartbeatConfig | null
  agents: AgentOption[]
  saving: boolean
  onSave: (data: { agent_name?: string; interval_s?: number; enabled?: boolean }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [agentName, setAgentName] = useState('')
  const [intervalS, setIntervalS] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (config) {
      setAgentName(config.agent_name)
      setIntervalS(String(config.interval_s))
      setEnabled(config.enabled)
    }
  }, [config])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return
    const payload: { agent_name?: string; interval_s?: number; enabled?: boolean } = {}
    if (agentName !== config.agent_name) payload.agent_name = agentName
    const iv = parseInt(intervalS, 10)
    if (!isNaN(iv) && iv !== config.interval_s) payload.interval_s = iv
    if (enabled !== config.enabled) payload.enabled = enabled
    if (Object.keys(payload).length === 0) return
    await onSave(payload)
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <Timer className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.heartbeatTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.heartbeatDesc')}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Agent">
          <AgentSelect value={agentName} agents={agents} onChange={setAgentName} />
        </FormField>
        <FormField label={t('settings.intervalLabel')}>
          <input
            type="number"
            min={1}
            value={intervalS}
            onChange={(e) => setIntervalS(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between gap-4">
        <EnableToggle enabled={enabled} onChange={setEnabled} />
        <SaveButton saving={saving} />
      </div>
    </motion.form>
  )
}

function CronCard({
  config,
  agents,
  saving,
  onSave,
}: {
  config: CronConfig | null
  agents: AgentOption[]
  saving: boolean
  onSave: (data: { agent_name?: string; enabled?: boolean }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [agentName, setAgentName] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (config) {
      setAgentName(config.agent_name)
      setEnabled(config.enabled)
    }
  }, [config])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return
    const payload: { agent_name?: string; enabled?: boolean } = {}
    if (agentName !== config.agent_name) payload.agent_name = agentName
    if (enabled !== config.enabled) payload.enabled = enabled
    if (Object.keys(payload).length === 0) return
    await onSave(payload)
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.06 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <Clock className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.cronTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.cronDesc')}</p>
        </div>
      </div>

      <FormField label="Agent">
        <AgentSelect value={agentName} agents={agents} onChange={setAgentName} />
      </FormField>

      <div className="flex items-center justify-between gap-4">
        <EnableToggle enabled={enabled} onChange={setEnabled} />
        <SaveButton saving={saving} />
      </div>
    </motion.form>
  )
}

function PasswordCard({
  saving,
  onSave,
}: {
  saving: boolean
  onSave: (newPassword: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    if (!newPassword.trim()) {
      setLocalError(t('settings.passwordEmpty'))
      return
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t('settings.passwordMismatch'))
      return
    }
    await onSave(newPassword)
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.12 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="panel-surface flex flex-col gap-5 p-5"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
          <KeyRound className="h-4 w-4 text-[var(--color-accent)]" />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.passwordTitle')}</h3>
          <p className="text-[11px] tertiary-text">{t('settings.passwordDesc')}</p>
        </div>
      </div>

      {localError ? (
        <p className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]">
          {localError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label={t('settings.newPassword')}>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('settings.newPasswordPlaceholder')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
            >
              {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </FormField>
        <FormField label={t('settings.confirmPassword')}>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('settings.confirmPasswordPlaceholder')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
            >
              {showConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </FormField>
      </div>

      <div className="flex justify-end">
        <SaveButton saving={saving} label={t('settings.changePassword')} />
      </div>
    </motion.form>
  )
}

function AgentSelect({
  value,
  agents,
  onChange,
}: {
  value: string
  agents: AgentOption[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
      >
        {agents.map((a) => (
          <option key={a.key} value={a.key}>
            {a.key} ({a.name})
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
    </div>
  )
}

function EnableToggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] px-3 py-1.5 text-[12px] transition hover:border-[var(--color-border-strong)]"
    >
      <span
        className={
          enabled
            ? 'h-2 w-2 rounded-full bg-[var(--color-success)]'
            : 'h-2 w-2 rounded-full bg-[var(--color-border-subtle)]'
        }
      />
      <span className={enabled ? 'text-[var(--color-text-primary)]' : 'tertiary-text'}>
        {enabled ? t('common.enabled') : t('common.disabled')}
      </span>
    </button>
  )
}

function SaveButton({ saving, label }: { saving: boolean; label?: string }) {
  const { t } = useTranslation()
  const displayLabel = label ?? t('common.save')
  return (
    <button
      type="submit"
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
      {displayLabel}
    </button>
  )
}

function FormField({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] tracking-[0.06em] tertiary-text">{label}</span>
      {children}
    </label>
  )
}
