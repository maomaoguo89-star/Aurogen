import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Bot,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Package,
  Search,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { fetchJson, uploadFile } from '@/lib/api'
import { cn } from '@/lib/utils'

type SkillInfo = {
  name: string
  description: string
  source: 'builtin' | 'workspace'
  agent_name: string | null
  available: boolean
  missing_requirements: string | null
  metadata: Record<string, unknown> | null
}

type SkillDetail = SkillInfo & {
  content: string
}

type AgentEntry = { name: string }

type ViewMode = { kind: 'builtin' } | { kind: 'agent'; name: string }

/* ── API helpers ────────────────────────────────────────────────────────────── */

async function fetchAgents() {
  return fetchJson<{ agents: AgentEntry[] }>('/agents')
}

async function fetchSkillsByAgent(agentName: string) {
  const params = new URLSearchParams({ scope: 'workspace', agent_name: agentName })
  return fetchJson<{ skills: SkillInfo[] }>(`/skills?${params}`)
}

async function fetchBuiltinSkills() {
  const params = new URLSearchParams({ scope: 'builtin' })
  return fetchJson<{ skills: SkillInfo[] }>(`/skills?${params}`)
}

async function fetchSkillDetail(name: string, source: string, agentName: string) {
  const params = new URLSearchParams({ scope: source, agent_name: agentName })
  return fetchJson<SkillDetail>(`/skills/${encodeURIComponent(name)}?${params}`)
}

async function uploadSkillZip(file: File, scope: 'builtin' | 'workspace', agentName: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('scope', scope)
  formData.append('agent_name', agentName)
  return uploadFile<{ message: string; name: string }>('/skills/upload', formData)
}

async function deleteSkill(name: string, scope: string, agentName: string) {
  const params = new URLSearchParams({ scope, agent_name: agentName })
  return fetchJson<{ message: string }>(`/skills/${encodeURIComponent(name)}?${params}`, {
    method: 'DELETE',
  })
}

/* ── Controller hook ────────────────────────────────────────────────────────── */

function useSkillsController() {
  const [agents, setAgents] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [view, setView] = useState<ViewMode>({ kind: 'builtin' })
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const currentAgent = view.kind === 'agent' ? view.name : 'main'

  const loadSkills = useCallback(async (v: ViewMode) => {
    try {
      const res = v.kind === 'builtin'
        ? await fetchBuiltinSkills()
        : await fetchSkillsByAgent(v.name)
      setSkills(res.skills)
      return res.skills
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载技能列表失败'
      setError(msg)
      return []
    }
  }, [])

  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      try {
        const [agentRes, skillList] = await Promise.all([
          fetchAgents(),
          loadSkills({ kind: 'builtin' }),
        ])
        if (!active) return
        setAgents(agentRes.agents.map((a) => a.name))
        if (skillList.length > 0) setSelectedName(skillList[0].name)
      } catch {
        /* errors handled in loadSkills */
      } finally {
        if (active) setLoading(false)
      }
    }
    void init()
    return () => { active = false }
  }, [loadSkills])

  useEffect(() => {
    if (!selectedName) {
      setDetail(null)
      return
    }
    const skill = skills.find((s) => s.name === selectedName)
    if (!skill) {
      setDetail(null)
      return
    }
    let active = true
    async function load() {
      setDetailLoading(true)
      try {
        const d = await fetchSkillDetail(
          selectedName!,
          skill!.source,
          skill!.agent_name ?? currentAgent,
        )
        if (active) setDetail(d)
      } catch (err) {
        if (active) {
          const msg = err instanceof Error ? err.message : '加载技能详情失败'
          setError(msg)
        }
      } finally {
        if (active) setDetailLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [selectedName, skills, currentAgent])

  const handleUpload = useCallback(
    async (file: File, uploadScope: 'builtin' | 'workspace', uploadAgent: string) => {
      setUploading(true)
      setError(null)
      try {
        const res = await uploadSkillZip(file, uploadScope, uploadAgent)
        const list = await loadSkills(view)
        if (list.find((s) => s.name === res.name)) {
          setSelectedName(res.name)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传技能失败'
        setError(msg)
        throw err
      } finally {
        setUploading(false)
      }
    },
    [loadSkills, view],
  )

  const handleDelete = useCallback(
    async (name: string, source: string, agent: string) => {
      setDeleting(true)
      setError(null)
      try {
        await deleteSkill(name, source, agent)
        const list = await loadSkills(view)
        if (selectedName === name) {
          setSelectedName(list.length > 0 ? list[0].name : null)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '删除技能失败'
        setError(msg)
        throw err
      } finally {
        setDeleting(false)
      }
    },
    [loadSkills, view, selectedName],
  )

  const changeView = useCallback(
    async (newView: ViewMode) => {
      setView(newView)
      setSelectedName(null)
      setDetail(null)
      setLoading(true)
      const list = await loadSkills(newView)
      if (list.length > 0) setSelectedName(list[0].name)
      setLoading(false)
    },
    [loadSkills],
  )

  return {
    agents,
    skills,
    selectedName,
    detail,
    view,
    currentAgent,
    loading,
    detailLoading,
    error,
    uploading,
    deleting,
    setSelectedName,
    setError,
    handleUpload,
    handleDelete,
    changeView,
  }
}

/* ── Page ───────────────────────────────────────────────────────────────────── */

export function SkillsPage() {
  const { t } = useTranslation()
  const {
    agents,
    skills,
    selectedName,
    detail,
    view,
    currentAgent,
    loading,
    detailLoading,
    error,
    uploading,
    deleting,
    setSelectedName,
    setError,
    handleUpload,
    handleDelete,
    changeView,
  } = useSkillsController()

  const [searchValue, setSearchValue] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<SkillInfo | null>(null)

  const filteredSkills = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw),
    )
  }, [searchValue, skills])

  const selectedSkill = useMemo(
    () => skills.find((s) => s.name === selectedName) ?? null,
    [skills, selectedName],
  )

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {error ? (
        <div className="panel-surface flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-5 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('common.operationError')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 transition hover:opacity-70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* Left: Skill List */}
        <section className="panel-surface flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                Skills
              </h2>
              <p className="mt-1 text-[11px] tertiary-text">
                {t('skills.viewByAgent')}
              </p>
            </div>
            <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              {skills.length} total
            </div>
          </div>

          {/* View selector: Public button + Agent dropdown */}
          <ViewSelector
            view={view}
            agents={agents}
            onChange={(v) => { void changeView(v) }}
          />

          <button
            type="button"
            onClick={() => setShowUploadModal(true)}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
          >
            <Upload className="h-4 w-4" />
            Upload Skill
          </button>

          <a
            href="https://clawhub.ai/"
            target="_blank"
            rel="noreferrer"
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]"
          >
            <ExternalLink className="h-4 w-4" />
            {t('skills.openClawHub')}
          </a>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('skills.search')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
          </div>

          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
            {loading ? (
              <ListSkeleton />
            ) : filteredSkills.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {filteredSkills.map((skill, index) => {
                  const selected = selectedName === skill.name
                  return (
                    <motion.button
                      key={`${skill.source}-${skill.name}`}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      onClick={() => setSelectedName(skill.name)}
                      className={cn(
                        'group w-full rounded-[var(--radius-md)] border px-4 py-3.5 text-left transition-all duration-150',
                        selected
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50 hover:shadow-[var(--shadow-sm)]',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                              {skill.name}
                            </p>
                            {skill.available ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-[var(--color-success)]" />
                            ) : (
                              <XCircle className="h-3 w-3 shrink-0 text-[var(--color-warning)]" />
                            )}
                          </div>
                          <p className="mt-1 truncate text-[11px] tertiary-text">
                            {skill.description}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                            skill.source === 'builtin'
                              ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 tertiary-text'
                              : 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
                          )}
                        >
                          {skill.source === 'builtin' ? 'public' : 'private'}
                        </span>
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-center text-sm subtle-text">
                {skills.length === 0
                  ? view.kind === 'builtin'
                    ? t('skills.emptyPublic')
                    : t('skills.emptyAgent', { name: view.name })
                  : t('skills.emptyNoMatch')}
              </div>
            )}
          </div>
        </section>

        {/* Right: Detail */}
        <section className="panel-surface min-h-0 flex-1 overflow-y-auto p-6">
          {selectedSkill && detail ? (
            <SkillDetailView
              skill={selectedSkill}
              detail={detail}
              detailLoading={detailLoading}
              currentAgent={currentAgent}
              onDelete={() => setPendingDelete(selectedSkill)}
            />
          ) : (
            <EmptyDetail loading={loading || detailLoading} />
          )}
        </section>
      </div>

      <UploadSkillModal
        open={showUploadModal}
        uploading={uploading}
        agents={agents}
        defaultAgent={view.kind === 'agent' ? view.name : agents[0] ?? 'main'}
        defaultScope={view.kind === 'agent' ? 'workspace' : 'builtin'}
        onClose={() => setShowUploadModal(false)}
        onSubmit={async (file, uploadScope, agent) => {
          await handleUpload(file, uploadScope, agent)
          setShowUploadModal(false)
        }}
      />

      <ConfirmDeleteModal
        skill={pendingDelete}
        isBusy={deleting}
        currentAgent={currentAgent}
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={async () => {
          if (!pendingDelete) return
          try {
            await handleDelete(
              pendingDelete.name,
              pendingDelete.source,
              pendingDelete.agent_name ?? currentAgent,
            )
            setPendingDelete(null)
          } catch {
            /* error already set in controller */
          }
        }}
      />
    </section>
  )
}

/* ── View Selector ──────────────────────────────────────────────────────────── */

function ViewSelector({
  view,
  agents,
  onChange,
}: {
  view: ViewMode
  agents: string[]
  onChange: (v: ViewMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="mb-3 flex gap-2">
      <button
        type="button"
        onClick={() => { onChange({ kind: 'builtin' }); setOpen(false) }}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3.5 py-2 text-[12px] font-medium transition',
          view.kind === 'builtin'
            ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
            : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
        )}
      >
        <Sparkles className="h-3 w-3" />
        Public
      </button>

      <div ref={ref} className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3.5 py-2 text-[12px] font-medium transition',
            view.kind === 'agent'
              ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
          )}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Bot className="h-3 w-3 shrink-0" />
            {view.kind === 'agent' ? view.name : 'Agent'}
          </span>
          <ChevronDown className={cn(
            'h-3 w-3 shrink-0 transition-transform',
            open && 'rotate-180',
          )} />
        </button>
        <AnimatePresence>
          {open ? (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] shadow-[var(--shadow-md)]"
            >
              {agents.length > 0 ? (
                agents.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      onChange({ kind: 'agent', name: a })
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3.5 py-2.5 text-[12px] transition',
                      view.kind === 'agent' && view.name === a
                        ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
                    )}
                  >
                    <Bot className="h-3 w-3 shrink-0" />
                    {a}
                  </button>
                ))
              ) : (
                          <div className="px-3.5 py-3 text-[12px] subtle-text">
                              {t('skills.noAgents')}
                            </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── Detail View ────────────────────────────────────────────────────────────── */

function SkillDetailView({
  skill,
  detail,
  detailLoading,
  currentAgent,
  onDelete,
}: {
  skill: SkillInfo
  detail: SkillDetail
  detailLoading: boolean
  currentAgent: string
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <motion.div
      key={skill.name}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">Skill Detail</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            {skill.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
        >
          {t('common.delete')}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailField label="Name" value={skill.name} />
        <DetailField
          label="Source"
          value={
            skill.source === 'builtin'
              ? t('skills.public')
              : t('skills.private', { agent: skill.agent_name ?? currentAgent })
          }
        />
        <DetailField label="Description" value={skill.description} span={2} />
        <DetailField
          label="Available"
          value={skill.available ? t('skills.available') : t('skills.unavailable')}
        />
        {skill.missing_requirements ? (
          <DetailField label="Missing Requirements" value={skill.missing_requirements} />
        ) : null}
      </div>

      {skill.metadata && Object.keys(skill.metadata).length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
            Metadata
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {Object.entries(skill.metadata).map(([k, v]) => (
              <div
                key={k}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3"
              >
                <p className="text-[11px] tracking-[0.06em] tertiary-text">{k}</p>
                <p className="mt-1.5 break-all font-mono text-[13px] text-[var(--color-text-primary)]">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="my-5 h-px bg-[var(--color-bg-active)]" />

      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
        SKILL.md
      </h3>

      {detailLoading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] subtle-text">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t('skills.loadingMd')}
        </div>
      ) : (
        <div className="markdown-content rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {detail.content}
          </ReactMarkdown>
        </div>
      )}
    </motion.div>
  )
}

/* ── Upload Modal ───────────────────────────────────────────────────────────── */

function UploadSkillModal({
  open,
  uploading,
  agents,
  defaultAgent,
  defaultScope,
  onClose,
  onSubmit,
}: {
  open: boolean
  uploading: boolean
  agents: string[]
  defaultAgent: string
  defaultScope: 'builtin' | 'workspace'
  onClose: () => void
  onSubmit: (file: File, scope: 'builtin' | 'workspace', agentName: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [uploadScope, setUploadScope] = useState<'builtin' | 'workspace'>(defaultScope)
  const [agent, setAgent] = useState(defaultAgent)
  const [dragOver, setDragOver] = useState(false)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
      setUploadScope(defaultScope)
      setAgent(defaultAgent)
      setDragOver(false)
      setAgentDropdownOpen(false)
    }
  }, [open, defaultScope, defaultAgent])

  useEffect(() => {
    if (!agentDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [agentDropdownOpen])

  const handleFile = (f: File | undefined) => {
    if (!f) return
    if (!f.name.endsWith('.zip')) return
    setFile(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    await onSubmit(file, uploadScope, agent)
  }

  const MAX_SIZE = 50 * 1024 * 1024

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="upload-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => { if (!uploading) onClose() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 shadow-[var(--shadow-lg)]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => { void handleSubmit(e) }}
              className="space-y-5"
            >
              <div>
                <p className="text-[11px] tracking-[0.06em] tertiary-text">Upload Skill</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('skills.uploadTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('skills.uploadDesc')}
                </p>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  handleFile(e.dataTransfer.files[0])
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed px-6 py-8 text-center transition',
                  dragOver
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : file
                      ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/5'
                      : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/30',
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {file ? (
                  <>
                    <Archive className="h-8 w-8 text-[var(--color-success)]" />
                    <div>
                      <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
                        {file.name}
                      </p>
                      <p className="mt-1 text-[11px] tertiary-text">
                        {(file.size / 1024).toFixed(1)} KB
                        {file.size > MAX_SIZE ? (
                          <span className="ml-2 text-[var(--color-danger)]">
                            {t('skills.fileTooLarge')}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFile(null)
                      }}
                      className="text-[12px] text-[var(--color-text-secondary)] transition hover:text-[var(--color-danger)]"
                    >
                      {t('skills.reselect')}
                    </button>
                  </>
                ) : (
                  <>
                    <Package className="h-8 w-8 text-[var(--color-text-tertiary)]" />
                    <div>
                      <p className="text-[13px] text-[var(--color-text-primary)]">
                        {t('skills.dropzone')}
                      </p>
                      <p className="mt-1 text-[11px] tertiary-text">
                        {t('skills.dropzoneHint')}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Scope selector */}
              <div>
                <p className="mb-2 text-[11px] tracking-[0.06em] tertiary-text">
                  {t('skills.installTarget')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadScope('builtin')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-[13px] font-medium transition',
                      uploadScope === 'builtin'
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    Public
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadScope('workspace')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-[13px] font-medium transition',
                      uploadScope === 'workspace'
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
                    )}
                  >
                    <Bot className="h-4 w-4" />
                    Private
                  </button>
                </div>
              </div>

              {/* Agent selector for workspace scope */}
              {uploadScope === 'workspace' ? (
                <div>
                  <p className="mb-1.5 text-[11px] tracking-[0.06em] tertiary-text">
                    {t('skills.targetAgent')}
                  </p>
                  <div ref={dropdownRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setAgentDropdownOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    >
                      <span className="flex items-center gap-2">
                        <Bot className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
                        {agent}
                      </span>
                      <ChevronDown className={cn(
                        'h-3.5 w-3.5 text-[var(--color-text-tertiary)] transition-transform',
                        agentDropdownOpen && 'rotate-180',
                      )} />
                    </button>
                    <AnimatePresence>
                      {agentDropdownOpen ? (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] shadow-[var(--shadow-md)]"
                        >
                          {agents.map((a) => (
                            <button
                              key={a}
                              type="button"
                              onClick={() => {
                                setAgent(a)
                                setAgentDropdownOpen(false)
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 px-4 py-2 text-[13px] transition',
                                a === agent
                                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
                              )}
                            >
                              <Bot className="h-3.5 w-3.5" />
                              {a}
                            </button>
                          ))}
                          {agents.length === 0 ? (
                            <div className="px-4 py-3 text-[13px] subtle-text">
                              暂无 agent
                            </div>
                          ) : null}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={uploading}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={uploading || !file || file.size > MAX_SIZE}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t('skills.upload')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ── Confirm Delete ─────────────────────────────────────────────────────────── */

function ConfirmDeleteModal({
  skill,
  isBusy,
  currentAgent,
  onCancel,
  onConfirm,
}: {
  skill: SkillInfo | null
  isBusy: boolean
  currentAgent: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!skill || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [skill, isBusy, onCancel])

  return (
    <AnimatePresence>
      {skill ? (
        <motion.div
          key="delete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => { if (!isBusy) onCancel() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-md p-5 shadow-[var(--shadow-lg)]"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Skill</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('skills.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('skills.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Skill Name</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                {skill.name}
              </p>
              <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Source</p>
              <p className="mt-1 text-sm subtle-text">
                {skill.source === 'builtin'
                  ? t('skills.public')
                  : t('skills.private', { agent: skill.agent_name ?? currentAgent })}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
              onClick={onCancel}
              disabled={isBusy}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => { void onConfirm() }}
              disabled={isBusy}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {t('skills.deleteSkill')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ── Shared Components ──────────────────────────────────────────────────────── */

function DetailField({
  label,
  value,
  span = 1,
}: {
  label: string
  value: string
  span?: 1 | 2
}) {
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

function EmptyDetail({ loading }: { loading: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]">
        <Sparkles className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {loading ? t('skills.loadingSkill') : t('skills.selectSkill')}
        </h3>
        <p className="max-w-lg text-sm subtle-text">
          {loading ? t('skills.loadingSkillDesc') : t('skills.selectSkillDesc')}
        </p>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-4"
        >
          <div className="h-4 w-24 rounded bg-[var(--color-bg-active)]" />
          <div className="mt-3 h-3 w-36 rounded bg-[var(--color-bg-hover)]/60" />
        </div>
      ))}
    </div>
  )
}
