import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock,
  Edit3,
  Loader,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { ThemedSelect } from '@/components/themed-select'

// ── 类型定义 ────────────────────────────────────────────────────────────────────

type ScheduleKind = 'at' | 'every' | 'cron'

type CronSchedule = {
  kind: ScheduleKind
  at_ms?: number
  every_ms?: number
  expr?: string
  tz?: string
}

type CronPayload = {
  kind: string
  message: string
  deliver: boolean
  channel?: string
  to?: string
}

type CronState = {
  next_run_at_ms?: number
  last_run_at_ms?: number
  last_status?: string
  last_error?: string
}

type CronJob = {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payload: CronPayload
  state: CronState
  created_at_ms: number
  updated_at_ms: number
  delete_after_run: boolean
}

type CronStatus = {
  running: boolean
  jobs_total?: number
  jobs_enabled?: number
  [key: string]: unknown
}

type JobFormData = {
  name: string
  scheduleKind: ScheduleKind
  atDatetime: string
  everyMs: string
  cronExpr: string
  tz: string
  message: string
  deliver: boolean
  channel: string
  to: string
  deleteAfterRun: boolean
}

// ── API 函数 ────────────────────────────────────────────────────────────────────

async function apiGetStatus() {
  return fetchJson<CronStatus>('/cron/status')
}

async function apiListJobs() {
  return fetchJson<{ jobs: CronJob[] }>('/cron/jobs?include_disabled=true')
}

async function apiCreateJob(data: {
  name: string
  schedule: CronSchedule
  message: string
  deliver: boolean
  channel?: string
  to?: string
  delete_after_run: boolean
}) {
  return fetchJson<{ message: string; job: CronJob }>('/cron/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function apiUpdateJob(id: string, data: {
  name?: string
  enabled?: boolean
  schedule?: CronSchedule
  message?: string
  deliver?: boolean
  channel?: string | null
  to?: string | null
  delete_after_run?: boolean
}) {
  return fetchJson<{ message: string; job: CronJob }>(`/cron/jobs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function apiDeleteJob(id: string) {
  return fetchJson<{ message: string }>(`/cron/jobs/${id}`, { method: 'DELETE' })
}

async function apiEnableJob(id: string, enabled: boolean) {
  const path = enabled ? 'enable' : 'disable'
  return fetchJson<{ message: string; job: CronJob }>(`/cron/jobs/${id}/${path}`, { method: 'POST' })
}

async function apiRunJob(id: string) {
  return fetchJson<{ message: string }>(`/cron/jobs/${id}/run`, { method: 'POST' })
}

// ── 工具函数 ────────────────────────────────────────────────────────────────────

function formatMs(ms?: number): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleString()
}

function msToDatetimeLocal(ms?: number): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToMs(v: string): number {
  return new Date(v).getTime()
}

function scheduleLabel(s: CronSchedule, tFn: (key: string, opts?: Record<string, unknown>) => string): string {
  if (s.kind === 'at') return tFn('cron.onceAt', { time: formatMs(s.at_ms) })
  if (s.kind === 'every') {
    const ms = s.every_ms ?? 0
    if (ms >= 3600000) return tFn('cron.everyH', { n: (ms / 3600000).toFixed(1) })
    if (ms >= 60000) return tFn('cron.everyM', { n: (ms / 60000).toFixed(1) })
    return tFn('cron.everyS', { n: (ms / 1000).toFixed(1) })
  }
  return tFn('cron.cronPrefix', { expr: s.expr ?? '' })
}

function emptyForm(): JobFormData {
  return {
    name: '',
    scheduleKind: 'every',
    atDatetime: '',
    everyMs: '3600000',
    cronExpr: '0 9 * * *',
    tz: '',
    message: '',
    deliver: false,
    channel: '',
    to: '',
    deleteAfterRun: false,
  }
}

function jobToForm(job: CronJob): JobFormData {
  return {
    name: job.name,
    scheduleKind: job.schedule.kind,
    atDatetime: msToDatetimeLocal(job.schedule.at_ms),
    everyMs: String(job.schedule.every_ms ?? 3600000),
    cronExpr: job.schedule.expr ?? '',
    tz: job.schedule.tz ?? '',
    message: job.payload.message,
    deliver: job.payload.deliver,
    channel: job.payload.channel ?? '',
    to: job.payload.to ?? '',
    deleteAfterRun: job.delete_after_run,
  }
}

function formToApiData(form: JobFormData) {
  const schedule: CronSchedule = { kind: form.scheduleKind }
  if (form.scheduleKind === 'at') {
    schedule.at_ms = datetimeLocalToMs(form.atDatetime)
  } else if (form.scheduleKind === 'every') {
    schedule.every_ms = parseInt(form.everyMs, 10)
  } else {
    schedule.expr = form.cronExpr
    if (form.tz.trim()) schedule.tz = form.tz.trim()
  }

  return {
    name: form.name.trim(),
    schedule,
    message: form.message,
    deliver: form.deliver,
    channel: form.deliver && form.channel.trim() ? form.channel.trim() : undefined,
    to: form.deliver && form.to.trim() ? form.to.trim() : undefined,
    delete_after_run: form.deleteAfterRun,
  }
}

// ── 状态圆点 ────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status?: string }) {
  if (!status) return <CircleDashed className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
  if (status === 'ok' || status === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)]" />
  if (status === 'error' || status === 'failed') return <XCircle className="h-3.5 w-3.5 text-[var(--color-danger)]" />
  return <Clock className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
}

// ── DetailField ──────────────────────────────────────────────────────────────────

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
      <p className="mb-1 text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{label}</p>
      <div className="text-sm text-[var(--color-text-primary)]">{children}</div>
    </div>
  )
}

// ── 表单输入通用样式 ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]'

// ── ToggleButton ──────────────────────────────────────────────────────────────────

function ToggleButton({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-subtle)] px-3 py-1.5 text-[12px] transition hover:border-[var(--color-border-strong)]"
    >
      <span className={enabled ? 'h-2 w-2 rounded-full bg-[var(--color-success)]' : 'h-2 w-2 rounded-full bg-[var(--color-border-subtle)]'} />
      <span className={enabled ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}>
        {enabled ? t('common.enabled') : t('common.disabled')}
      </span>
    </button>
  )
}

// ── 表单主体（新增 & 编辑共用） ───────────────────────────────────────────────────

function JobForm({
  form,
  onChange,
}: {
  form: JobFormData
  onChange: (patch: Partial<JobFormData>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.name')}</span>
        <input
          className={inputCls}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('cron.jobNamePlaceholder')}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.scheduleType')}</span>
        <ThemedSelect
          value={form.scheduleKind}
          options={[
            { value: 'every', label: t('cron.scheduleEvery') },
            { value: 'cron', label: t('cron.scheduleCron') },
            { value: 'at', label: t('cron.scheduleAt') },
          ]}
          onChange={(value) => onChange({ scheduleKind: value as ScheduleKind })}
          buttonClassName={inputCls}
        />
      </label>

      {form.scheduleKind === 'at' && (
        <label className="block space-y-1.5">
          <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.executeTime')}</span>
          <input
            type="datetime-local"
            className={inputCls}
            value={form.atDatetime}
            onChange={(e) => onChange({ atDatetime: e.target.value })}
          />
        </label>
      )}

      {form.scheduleKind === 'every' && (
        <label className="block space-y-1.5">
          <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.interval')}</span>
          <input
            type="number"
            min={1000}
            step={1000}
            className={inputCls}
            value={form.everyMs}
            onChange={(e) => onChange({ everyMs: e.target.value })}
            placeholder="3600000"
          />
        </label>
      )}

      {form.scheduleKind === 'cron' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.cronExpr')}</span>
            <input
              className={inputCls}
              value={form.cronExpr}
              onChange={(e) => onChange({ cronExpr: e.target.value })}
              placeholder="0 9 * * *"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.timezone')}</span>
            <input
              className={inputCls}
              value={form.tz}
              onChange={(e) => onChange({ tz: e.target.value })}
              placeholder="Asia/Shanghai"
            />
          </label>
        </div>
      )}

      <label className="block space-y-1.5">
        <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.message')}</span>
        <textarea
          rows={3}
          className={`${inputCls} resize-none`}
          value={form.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder={t('cron.message')}
        />
      </label>

      <div className="flex items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/40 px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{t('cron.deliverMode')}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{t('cron.deliverModeDesc')}</p>
        </div>
        <ToggleButton enabled={form.deliver} onChange={(v) => onChange({ deliver: v })} />
      </div>

      {form.deliver && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">Channel</span>
            <input
              className={inputCls}
              value={form.channel}
              onChange={(e) => onChange({ channel: e.target.value })}
              placeholder="web"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] tracking-[0.06em] text-[var(--color-text-tertiary)]">To</span>
            <input
              className={inputCls}
              value={form.to}
              onChange={(e) => onChange({ to: e.target.value })}
              placeholder="chat_id"
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/40 px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{t('cron.deleteAfterRun')}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">{t('cron.deleteAfterRunDesc')}</p>
        </div>
        <ToggleButton enabled={form.deleteAfterRun} onChange={(v) => onChange({ deleteAfterRun: v })} />
      </div>
    </div>
  )
}

// ── 新增 Job Modal ───────────────────────────────────────────────────────────────

function AddJobModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (job: CronJob) => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<JobFormData>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = useCallback((patch: Partial<JobFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError(t('cron.nameRequired')); return }
    if (!form.message.trim()) { setError(t('cron.messageRequired')); return }
    if (form.scheduleKind === 'at' && !form.atDatetime) { setError(t('cron.timeRequired')); return }
    if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) { setError(t('cron.cronExprRequired')); return }

    setSaving(true)
    setError(null)
    try {
      const res = await apiCreateJob(formToApiData(form))
      onCreated(res.job)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className="panel-surface w-full max-w-lg p-4 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('cron.addJobTitle')}</h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">{t('cron.addJobDesc')}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e) }}>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <JobForm form={form} onChange={handleChange} />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[12px] transition hover:border-[var(--color-border-strong)]">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('cron.createJob')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ── Job 列表项 ──────────────────────────────────────────────────────────────────

function JobListItem({
  job,
  selected,
  onClick,
  index,
}: {
  job: CronJob
  selected: boolean
  onClick: () => void
  index: number
}) {
  const { t } = useTranslation()
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: index * 0.03 }}
      type="button"
      onClick={onClick}
      className={`w-full rounded-[var(--radius-md)] border px-3 py-3 text-left transition duration-[var(--duration-fast)] ${
        selected
          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
          : 'border-transparent hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-sm)]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border ${
          job.enabled
            ? 'border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'border-[var(--color-border-subtle)]/50 bg-[var(--color-bg-hover)]/50 text-[var(--color-text-tertiary)]'
        }`}>
          <CalendarClock className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{job.name}</p>
            {!job.enabled && (
              <span className="shrink-0 rounded-full border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                {t('common.disabled')}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{scheduleLabel(job.schedule, t)}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <StatusDot status={job.state.last_status} />
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {job.state.last_status ?? t('cron.neverRun')}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  )
}

// ── Job 详情面板 ──────────────────────────────────────────────────────────────────

function JobDetailPanel({
  job,
  onUpdated,
  onDeleted,
  onToggleEnable,
  onRun,
}: {
  job: CronJob
  onUpdated: (job: CronJob) => void
  onDeleted: (id: string) => void
  onToggleEnable: (id: string, enabled: boolean) => Promise<void>
  onRun: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<JobFormData>(jobToForm(job))
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setForm(jobToForm(job))
    setEditing(false)
    setError(null)
    setConfirmDelete(false)
  }, [job.id])

  const handleChange = useCallback((patch: Partial<JobFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('cron.nameRequired')); return }
    if (!form.message.trim()) { setError(t('cron.messageRequired')); return }
    setSaving(true)
    setError(null)
    try {
      const data = formToApiData(form)
      const res = await apiUpdateJob(job.id, data)
      onUpdated(res.job)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    setToggling(true)
    setError(null)
    try {
      await onToggleEnable(job.id, !job.enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败')
    } finally {
      setToggling(false)
    }
  }

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      await onRun(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发失败')
    } finally {
      setRunning(false)
    }
  }

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    void handleDeleteConfirm()
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    setError(null)
    try {
      await apiDeleteJob(job.id)
      onDeleted(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{job.name}</h2>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{job.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={toggling}
            onClick={() => { void handleToggle() }}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-1.5 text-[12px] transition hover:border-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {toggling ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : job.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {job.enabled ? t('cron.disable') : t('cron.enable')}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => { void handleRun() }}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3 py-1.5 text-[12px] text-[var(--color-accent)] transition hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {t('cron.runNow')}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => { setEditing(true); setError(null) }}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-1.5 text-[12px] transition hover:border-[var(--color-border-strong)]"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {t('common.edit')}
            </button>
          )}
          <button
            type="button"
            disabled={deleting}
            onClick={handleDeleteClick}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmDelete
                ? 'border-[color:var(--color-danger)] bg-[color:var(--color-danger)]/20 text-[var(--color-danger)]'
                : 'border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[color:var(--color-danger)]/20'
            }`}
          >
            {deleting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {confirmDelete ? t('cron.confirmDelete') : t('common.delete')}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {editing ? (
          <div className="space-y-5">
            <JobForm form={form} onChange={handleChange} />
            <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => { setForm(jobToForm(job)); setEditing(false); setError(null) }}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[12px] transition hover:border-[var(--color-border-strong)]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { void handleSave() }}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('common.save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.scheduleSection')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label={t('cron.type')}>
                  <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-active)] px-2 py-0.5 text-[12px]">
                    {job.schedule.kind}
                  </span>
                </DetailField>
                {job.schedule.kind === 'at' && (
                  <DetailField label={t('cron.executeTimeLabel')}>{formatMs(job.schedule.at_ms)}</DetailField>
                )}
                {job.schedule.kind === 'every' && (
                  <DetailField label={t('cron.intervalLabel')}>{scheduleLabel(job.schedule, t)}</DetailField>
                )}
                {job.schedule.kind === 'cron' && (
                  <>
                    <DetailField label={t('cron.exprLabel')}>
                      <code className="font-mono text-[13px]">{job.schedule.expr}</code>
                    </DetailField>
                    {job.schedule.tz && <DetailField label={t('cron.timezoneLabel')}>{job.schedule.tz}</DetailField>}
                  </>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.payloadSection')}</p>
              <div className="grid gap-3">
                <DetailField label={t('cron.messageLabel')}>
                  <p className="whitespace-pre-wrap break-words text-[13px]">{job.payload.message}</p>
                </DetailField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailField label={t('cron.deliverLabel')}>
                    <span className={`font-medium ${job.payload.deliver ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-tertiary)]'}`}>
                      {job.payload.deliver ? t('cron.on') : t('cron.off')}
                    </span>
                  </DetailField>
                  {job.payload.deliver && job.payload.channel && (
                    <DetailField label="Channel">{job.payload.channel}</DetailField>
                  )}
                  {job.payload.deliver && job.payload.to && (
                    <DetailField label="To">{job.payload.to}</DetailField>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.runStateSection')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label={t('cron.lastRun')}>
                  <span className="text-[13px]">{formatMs(job.state.last_run_at_ms)}</span>
                </DetailField>
                <DetailField label={t('cron.nextRun')}>
                  <span className="text-[13px]">{formatMs(job.state.next_run_at_ms)}</span>
                </DetailField>
                <DetailField label={t('cron.lastStatus')}>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={job.state.last_status} />
                    <span className="text-[13px]">{job.state.last_status ?? '—'}</span>
                  </div>
                </DetailField>
                <DetailField label={t('cron.deleteAfterRunLabel')}>
                  <span className={job.delete_after_run ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)]'}>
                    {job.delete_after_run ? t('common.yes') : t('common.no')}
                  </span>
                </DetailField>
              </div>
              {job.state.last_error && (
                <div className="mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-4 py-3">
                  <p className="mb-1 text-[11px] tracking-[0.06em] text-[var(--color-danger)]/70">{t('cron.lastError')}</p>
                  <p className="text-[12px] text-[var(--color-danger)]">{job.state.last_error}</p>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('cron.metaSection')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label={t('cron.createdAt')}>{formatMs(job.created_at_ms)}</DetailField>
                <DetailField label={t('cron.updatedAt')}>{formatMs(job.updated_at_ms)}</DetailField>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 空状态 ──────────────────────────────────────────────────────────────────────

function EmptyDetail() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] p-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]">
        <CalendarClock className="h-5 w-5 text-[var(--color-text-tertiary)]" />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('cron.selectJob')}</p>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{t('cron.selectJobHint')}</p>
      </div>
    </div>
  )
}

// ── 骨架屏 ──────────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-3">
          <div className="flex items-start gap-2.5">
            <div className="h-7 w-7 rounded-[var(--radius-sm)] bg-[var(--color-bg-active)]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-[var(--color-bg-active)]" />
              <div className="h-2.5 w-24 rounded bg-[var(--color-bg-active)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 主页面控制器 ──────────────────────────────────────────────────────────────────

function useCronController() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [status, setStatus] = useState<CronStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [jobsRes, statusRes] = await Promise.all([apiListJobs(), apiGetStatus()])
      setJobs(jobsRes.jobs)
      setStatus(statusRes)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载失败'
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

  const handleJobCreated = useCallback((job: CronJob) => {
    setJobs((prev) => [...prev, job])
    setSelectedId(job.id)
    setShowAddModal(false)
  }, [])

  const handleJobUpdated = useCallback((job: CronJob) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)))
  }, [])

  const handleJobDeleted = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
    setSelectedId((prev) => (prev === id ? null : prev))
  }, [])

  const handleToggleEnable = useCallback(async (id: string, enabled: boolean) => {
    const res = await apiEnableJob(id, enabled)
    setJobs((prev) => prev.map((j) => (j.id === id ? res.job : j)))
  }, [])

  const handleRun = useCallback(async (id: string) => {
    await apiRunJob(id)
  }, [])

  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null

  return {
    jobs,
    status,
    loading,
    error,
    setError,
    selectedJob,
    setSelectedId,
    showAddModal,
    setShowAddModal,
    reload,
    handleJobCreated,
    handleJobUpdated,
    handleJobDeleted,
    handleToggleEnable,
    handleRun,
  }
}

// ── 主页面 ──────────────────────────────────────────────────────────────────────

export function CronPage() {
  const { t } = useTranslation()
  const {
    jobs,
    status,
    loading,
    error,
    setError,
    selectedJob,
    setSelectedId,
    showAddModal,
    setShowAddModal,
    reload,
    handleJobCreated,
    handleJobUpdated,
    handleJobDeleted,
    handleToggleEnable,
    handleRun,
  } = useCronController()

  const enabledCount = jobs.filter((j) => j.enabled).length

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 全局错误横幅 */}
      {error && (
        <div className="mb-2 flex items-start gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('common.operationError')}</p>
            <p className="mt-0.5 text-[12px] text-[var(--color-danger)]/90">{error}</p>
          </div>
          <button type="button" onClick={() => setError(null)} className="shrink-0 p-1 transition hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden grid-cols-[360px_minmax(0,1fr)]">
        {/* ── 左栏 ── */}
        <div className="panel-surface flex min-h-0 flex-col overflow-hidden p-4">
          {/* 服务状态摘要 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {status ? (
                status.running ? (
                  <span className="flex items-center gap-1.5 rounded-full border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1 text-[11px] text-[var(--color-success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                    Running
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-2.5 py-1 text-[11px] text-[var(--color-text-tertiary)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-border-subtle)]" />
                    Stopped
                  </span>
                )
              ) : (
                <span className="text-[11px] text-[var(--color-text-tertiary)]">
                  <Loader className="inline h-3 w-3 animate-spin" />
                </span>
              )}
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                {t('cron.enabledCount', { enabled: enabledCount, total: jobs.length })}
              </span>
            </div>
              <button
              type="button"
              onClick={() => { void reload() }}
              className="p-1.5 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
              title={t('cron.refresh')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {loading ? (
              <ListSkeleton />
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <CalendarClock className="h-8 w-8 text-[var(--color-text-tertiary)]" />
                <p className="text-[13px] text-[var(--color-text-tertiary)]">{t('cron.empty')}</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {jobs.map((job, i) => (
                  <JobListItem
                    key={job.id}
                    job={job}
                    selected={selectedJob?.id === job.id}
                    onClick={() => setSelectedId(job.id)}
                    index={i}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>

          {/* 新增按钮 */}
          <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-3">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-2.5 text-[13px] text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]"
            >
              <Plus className="h-4 w-4" />
              {t('cron.addJob')}
            </button>
          </div>
        </div>

        {/* ── 右栏 ── */}
        <div className="panel-surface min-h-0 overflow-hidden">
          {selectedJob ? (
            <JobDetailPanel
              key={selectedJob.id}
              job={selectedJob}
              onUpdated={handleJobUpdated}
              onDeleted={handleJobDeleted}
              onToggleEnable={handleToggleEnable}
              onRun={handleRun}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-5">
              <EmptyDetail />
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddJobModal
            onClose={() => setShowAddModal(false)}
            onCreated={handleJobCreated}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
