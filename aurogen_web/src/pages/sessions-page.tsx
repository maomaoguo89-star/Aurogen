import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  History,
  LoaderCircle,
  MessageSquare,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type GroupBy = 'channel' | 'agent'

type SessionInfo = {
  session_id: string
  channel: string
  chat_id: string
  agent_name: string
  title: string
  message_count: number
  updated_at: string | null
}

type SessionGroup = {
  key: string
  sessions: SessionInfo[]
}

type SessionsResponse = {
  group_by: GroupBy
  groups: SessionGroup[]
}

type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | { type: string; text?: string }[]
  [key: string]: unknown
}

type SessionDetailResponse = {
  agent_name: string
  session_id: string
  messages: ChatMessage[]
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchSessions(groupBy: GroupBy): Promise<SessionsResponse> {
  return fetchJson<SessionsResponse>(`/sessions?group_by=${groupBy}`)
}

async function fetchSessionDetail(channel: string, sessionId: string): Promise<SessionDetailResponse> {
  return fetchJson<SessionDetailResponse>(
    `/get-session?channel=${encodeURIComponent(channel)}&session_id=${encodeURIComponent(sessionId)}`,
  )
}

async function deleteSession(channel: string, sessionId: string): Promise<void> {
  await fetchJson(
    `/delete-session?channel=${encodeURIComponent(channel)}&session_id=${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  )
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useSessionsData(groupBy: GroupBy) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<SessionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchSessions(groupBy)
      setGroups(res.groups)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [groupBy, t])

  useEffect(() => { load() }, [load])

  return { groups, loading, error, refetch: load }
}

function useSessionDetail(selected: SessionInfo | null) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSessionDetail(selected.channel, selected.session_id)
      .then((res) => {
        if (!cancelled) setMessages(res.messages)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('common.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [selected, t])

  return { messages, loading, error }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function getMessageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text ?? '')
      .join('\n')
  }
  return ''
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailField({ label, value, span = 1 }: { label: string; value: string; span?: 1 | 2 }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3 transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50',
        span === 2 && 'lg:col-span-2',
      )}
    >
      <p className="text-[11px] tracking-[0.06em] tertiary-text">{label}</p>
      <p className="mt-1 break-all text-sm text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function GroupSection({
  group,
  selected,
  onSelect,
}: {
  group: SessionGroup
  selected: SessionInfo | null
  onSelect: (s: SessionInfo) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition hover:bg-[var(--color-bg-hover)]"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />}
        <span className="flex-1 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">
          {group.key}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-active)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
          {group.sessions.length}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="ml-1 space-y-0.5 py-0.5">
              {group.sessions.map((s) => (
                <SessionItem
                  key={s.session_id}
                  session={s}
                  active={selected?.session_id === s.session_id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SessionItem({
  session,
  active,
  onSelect,
}: {
  session: SessionInfo
  active: boolean
  onSelect: (s: SessionInfo) => void
}) {
  return (
    <motion.button
      type="button"
      layout
      onClick={() => onSelect(session)}
      className={cn(
        'group w-full rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition duration-[var(--duration-fast)]',
        active
          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
          : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
      )}
    >
      <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
        {session.title || session.chat_id}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <span className="flex items-center gap-1 text-[11px] subtle-text">
          <MessageSquare className="h-3 w-3" />
          {session.message_count}
        </span>
        <span className="text-[11px] subtle-text">{formatTime(session.updated_at)}</span>
      </div>
    </motion.button>
  )
}

function ConfirmDeleteModal({
  open,
  session,
  deleting,
  onConfirm,
  onClose,
}: {
  open: boolean
  session: SessionInfo | null
  deleting: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {open && session && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          onClick={() => { if (!deleting) onClose() }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="panel-surface w-full max-w-md p-6 shadow-[var(--shadow-lg)]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10">
                  <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                </div>
                <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('sessions.deleteTitle')}</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={deleting}
                className="rounded-full p-1 text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-[13px] text-[var(--color-text-secondary)]">
              {t('sessions.deleteConfirm', { name: session.title || session.chat_id })}
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-bg-active)] disabled:opacity-40"
              >
                {t('sessions.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[var(--color-danger)]/20 disabled:opacity-40"
              >
                {deleting
                  ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {t('sessions.deleting')}</>
                  : <><Trash2 className="h-3.5 w-3.5" /> {t('sessions.confirmDelete')}</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SessionDetail({
  session,
  messages,
  loading,
  error,
  onDelete,
}: {
  session: SessionInfo
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant')

  return (
    <div className="flex h-full flex-col gap-5">
      {/* Meta fields */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DetailField label="Channel" value={session.channel} />
        <DetailField label="Agent" value={session.agent_name || '—'} />
        <DetailField label="Messages" value={String(session.message_count)} />
        <DetailField label="Updated" value={formatTime(session.updated_at)} />
      </div>

      {/* Session ID */}
      <DetailField label="Session ID" value={session.session_id} span={2} />

      {/* Message list */}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-3 text-[11px] tracking-[0.06em] tertiary-text">{t('sessions.messages')}</p>

        {loading && (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] subtle-text">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t('sessions.loading')}
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-[var(--color-danger)]">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {visibleMessages.length === 0 && (
              <p className="text-center text-[13px] subtle-text">{t('sessions.noMessages')}</p>
            )}
            {visibleMessages.map((msg, i) => {
              const isUser = msg.role === 'user'
              const text = getMessageText(msg.content)
              if (!text) return null
              return (
                <div
                  key={i}
                  className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}
                >
                  <div
                    className={cn(
                      'max-w-[75%] rounded-[var(--radius-md)] px-3.5 py-2.5 text-[13px] leading-relaxed',
                      isUser
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 text-[var(--color-text-primary)]',
                    )}
                  >
                    <p className="mb-1 text-[10px] tracking-[0.06em] tertiary-text">
                      {isUser ? 'User' : 'Assistant'}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{text}</p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Delete zone */}
      <div className="shrink-0 border-t border-[var(--color-border-subtle)] pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/8 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:border-[var(--color-danger)]/60 hover:bg-[var(--color-danger)]/15"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('sessions.deleteSession')}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SessionsPage() {
  const { t } = useTranslation()
  const [groupBy, setGroupBy] = useState<GroupBy>('channel')
  const [selected, setSelected] = useState<SessionInfo | null>(null)
  const [search, setSearch] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { groups, loading, error, refetch } = useSessionsData(groupBy)
  const { messages, loading: detailLoading, error: detailError } = useSessionDetail(selected)

  // filter groups by search
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      sessions: g.sessions.filter((s) => {
        const q = search.toLowerCase()
        return (
          s.session_id.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          s.chat_id.toLowerCase().includes(q) ||
          s.channel.toLowerCase().includes(q) ||
          s.agent_name.toLowerCase().includes(q)
        )
      }),
    }))
    .filter((g) => g.sessions.length > 0)

  const totalCount = groups.reduce((sum, g) => sum + g.sessions.length, 0)

  const handleDelete = useCallback(async () => {
    if (!selected) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteSession(selected.channel, selected.session_id)
      setConfirmOpen(false)
      setSelected(null)
      refetch()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t('common.loadFailed'))
    } finally {
      setDeleting(false)
    }
  }, [selected, refetch, t])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="panel-surface flex items-center gap-3 px-5 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            placeholder={t('sessions.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </div>
        {!loading && (
          <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
            {totalCount} sessions
          </div>
        )}
        <div className="flex rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/40 p-0.5">
          {(['channel', 'agent'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGroupBy(g)
                setSelected(null)
              }}
              className={cn(
                'rounded-[calc(var(--radius-sm)-2px)] px-3.5 py-1.5 text-[12px] font-medium capitalize transition duration-[var(--duration-fast)]',
                groupBy === g
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {g === 'channel' ? 'Channel' : 'Agent'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left: grouped list */}
        <section className="panel-surface flex min-h-0 flex-col p-5">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] subtle-text">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t('sessions.loading')}
              </div>
            )}

            {!loading && error && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[var(--color-danger)]">
                <AlertCircle className="h-5 w-5" />
                <span>{error}</span>
                <button
                  type="button"
                  onClick={refetch}
                  className="mt-1 text-[12px] underline underline-offset-2"
                >
                  {t('sessions.retry')}
                </button>
              </div>
            )}

            {!loading && !error && filteredGroups.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] subtle-text">
                <History className="h-8 w-8 opacity-30" />
                <span>{search ? t('sessions.noMatch') : t('sessions.empty')}</span>
              </div>
            )}

            <AnimatePresence initial={false}>
              {!loading && !error && filteredGroups.map((group) => (
                <motion.div
                  key={group.key}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <GroupSection
                    group={group}
                    selected={selected}
                    onSelect={setSelected}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* Right: detail */}
        <section className="panel-surface min-h-[340px] flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
                <History className="h-5 w-5 text-[var(--color-text-secondary)]" />
              </div>
              <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{t('sessions.selectSession')}</p>
              <p className="max-w-[220px] text-[12px] subtle-text">
                {t('sessions.selectSessionHint')}
              </p>
            </div>
          ) : (
            <SessionDetail
              session={selected}
              messages={messages}
              loading={detailLoading}
              error={detailError}
              onDelete={() => {
                setDeleteError(null)
                setConfirmOpen(true)
              }}
            />
          )}

          {/* Delete error inline */}
          {deleteError && (
            <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/8 px-3 py-2 text-[12px] text-[var(--color-danger)]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {deleteError}
            </div>
          )}
        </section>
      </div>

      {/* Confirm delete modal */}
      <ConfirmDeleteModal
        open={confirmOpen}
        session={selected}
        deleting={deleting}
        onConfirm={handleDelete}
        onClose={() => { if (!deleting) setConfirmOpen(false) }}
      />
    </section>
  )
}
