import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  LoaderCircle,
  Plus,
  Search,
  Shield,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type ThinkingLevel = 'none' | 'low' | 'medium' | 'high'

type AgentInstance = {
  key: string
  builtin: boolean
  name: string
  description: string
  model_settings: {
    model: string
    provider: string
    memory_window: number
    thinking: ThinkingLevel
  }
}

type ProviderOption = {
  key: string
  type: string
  description: string
}

type ChannelRef = {
  key: string
  agent_name: string
}

type AgentFormData = {
  name: string
  display_name: string
  description: string
  model: string
  provider: string
  memory_window: number
  thinking: ThinkingLevel
}

async function fetchAgents() {
  return fetchJson<{ agents: AgentInstance[] }>('/agents')
}

async function fetchProviderOptions() {
  const res = await fetchJson<{ providers: { key: string; type: string; description: string }[] }>('/providers/config')
  return res.providers.map((p) => ({ key: p.key, type: p.type, description: p.description }))
}

async function fetchChannelRefs() {
  const res = await fetchJson<{ channels: { key: string; agent_name: string }[] }>('/channels/config')
  return res.channels
}

async function addAgent(data: AgentFormData) {
  return fetchJson<{ message: string }>('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateAgent(
  name: string,
  data: { display_name?: string; description?: string; model?: string; provider?: string; memory_window?: number; thinking?: ThinkingLevel },
) {
  return fetchJson<{ message: string }>(`/agents/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteAgent(name: string) {
  return fetchJson<{ message: string }>(`/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

function getAgentChannels(agentKey: string, channels: ChannelRef[]): string[] {
  return channels.filter((ch) => ch.agent_name === agentKey).map((ch) => ch.key)
}

function useAgentsController() {
  const [agents, setAgents] = useState<AgentInstance[]>([])
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([])
  const [channelRefs, setChannelRefs] = useState<ChannelRef[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectedAgent = useMemo(
    () => agents.find((a) => a.key === selectedKey) ?? null,
    [agents, selectedKey],
  )

  const reload = useCallback(async () => {
    try {
      const [agentsRes, providers, channels] = await Promise.all([
        fetchAgents(),
        fetchProviderOptions(),
        fetchChannelRefs(),
      ])
      setAgents(agentsRes.agents)
      setProviderOptions(providers)
      setChannelRefs(channels)
      return agentsRes.agents
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 agents 失败'
      setError(msg)
      return []
    }
  }, [])

  useEffect(() => {
    let active = true
    async function init() {
      setLoading(true)
      const list = await reload()
      if (!active) return
      if (list.length > 0 && !selectedKey) {
        setSelectedKey(list[0].key)
      }
      setLoading(false)
    }
    void init()
    return () => { active = false }
  }, [reload, selectedKey])

  const handleAdd = useCallback(async (data: AgentFormData) => {
    setSaving(true)
    setError(null)
    try {
      await addAgent(data)
      const list = await reload()
      setSelectedKey(data.name)
      return list
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加 agent 失败'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleUpdate = useCallback(async (
    name: string,
    data: { display_name?: string; description?: string; model?: string; provider?: string; memory_window?: number; thinking?: ThinkingLevel },
  ) => {
    setSaving(true)
    setError(null)
    try {
      await updateAgent(name, data)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新 agent 失败'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleDelete = useCallback(async (name: string) => {
    setDeleting(true)
    setError(null)
    try {
      await deleteAgent(name)
      const list = await reload()
      if (selectedKey === name) {
        setSelectedKey(list.length > 0 ? list[0].key : null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除 agent 失败'
      setError(msg)
      throw err
    } finally {
      setDeleting(false)
    }
  }, [reload, selectedKey])

  return {
    agents,
    providerOptions,
    channelRefs,
    selectedKey,
    selectedAgent,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  }
}

export function AgentsPage() {
  const { t } = useTranslation()
  const {
    agents,
    providerOptions,
    channelRefs,
    selectedKey,
    selectedAgent,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  } = useAgentsController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const filteredAgents = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return agents
    return agents.filter(
      (a) =>
        a.key.toLowerCase().includes(kw) ||
        a.name.toLowerCase().includes(kw) ||
        a.model_settings.provider.toLowerCase().includes(kw) ||
        a.model_settings.model.toLowerCase().includes(kw),
    )
  }, [searchValue, agents])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="panel-surface flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
            <Bot className="h-4.5 w-4.5 text-[var(--color-accent)]" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('agents.resourceConsole')}</p>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Agents</h1>
            <p className="max-w-3xl text-[13px] subtle-text">
              {t('agents.description')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </button>
      </header>

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

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="panel-surface flex min-h-0 flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('agents.agentList')}</h2>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] tertiary-text">
              {agents.length} total
            </span>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('agents.search')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
          </div>

          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
            {loading ? (
              <AgentListSkeleton />
            ) : filteredAgents.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {filteredAgents.map((agent, index) => {
                  const selected = selectedKey === agent.key
                  return (
                    <motion.button
                      key={agent.key}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      onClick={() => {
                        setSelectedKey(agent.key)
                        setEditMode(false)
                      }}
                      className={cn(
                        'group w-full rounded-[var(--radius-md)] border px-4 py-3.5 text-left transition-all duration-150',
                        selected
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                          : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]/50 hover:shadow-[var(--shadow-sm)]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                              {agent.key}
                            </p>
                            {agent.builtin ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                                <Shield className="h-2.5 w-2.5" />
                                builtin
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[11px] tertiary-text">
                            {agent.name} · {agent.model_settings.provider} · {agent.model_settings.model}
                          </p>
                        </div>
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-center text-sm subtle-text">
                {agents.length === 0
                  ? t('agents.emptyNoConfig')
                  : t('agents.emptyNoMatch')}
              </div>
            )}
          </div>
        </section>

        <section className="panel-surface min-h-[340px] flex-1 overflow-y-auto p-6">
          {selectedAgent ? (
            editMode ? (
              <AgentEditor
                agent={selectedAgent}
                providerOptions={providerOptions}
                saving={saving}
                onSave={async (data) => {
                  await handleUpdate(selectedAgent.key, data)
                  setEditMode(false)
                }}
                onCancel={() => setEditMode(false)}
              />
            ) : (
              <AgentDetail
                agent={selectedAgent}
                usedByChannels={getAgentChannels(selectedAgent.key, channelRefs)}
                onEdit={() => setEditMode(true)}
                onDelete={() => setPendingDeleteKey(selectedAgent.key)}
              />
            )
          ) : (
            <EmptyDetail loading={loading} />
          )}
        </section>
      </div>

      <AddAgentModal
        open={showAddModal}
        providerOptions={providerOptions}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        agentKey={pendingDeleteKey}
        agent={pendingDeleteKey ? agents.find((a) => a.key === pendingDeleteKey) ?? null : null}
        usedByChannels={pendingDeleteKey ? getAgentChannels(pendingDeleteKey, channelRefs) : []}
        isBusy={deleting}
        onCancel={() => {
          if (!deleting) setPendingDeleteKey(null)
        }}
        onConfirm={async () => {
          if (!pendingDeleteKey) return
          try {
            await handleDelete(pendingDeleteKey)
            setPendingDeleteKey(null)
          } catch {
            /* error already set in controller */
          }
        }}
      />
    </section>
  )
}

function AgentDetail({
  agent,
  usedByChannels,
  onEdit,
  onDelete,
}: {
  agent: AgentInstance
  usedByChannels: string[]
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <motion.div
      key={agent.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">Agent Detail</p>
          <div className="mt-1 flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{agent.key}</h2>
            {agent.builtin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                <Shield className="h-2.5 w-2.5" />
                builtin
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
          >
            {t('common.edit')}
          </button>
          {!agent.builtin ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
            >
              {t('common.delete')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailField label="Key" value={agent.key} />
        <DetailField label="Display Name" value={agent.name || '—'} />
        <DetailField label="Description" value={agent.description || '—'} span={2} />
      </div>

      <div className="my-5 h-px bg-[var(--color-bg-active)]" />

      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{t('agents.modelSettings')}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        <DetailField label="Model" value={agent.model_settings.model} />
        <DetailField label="Provider" value={agent.model_settings.provider} />
        <DetailField label="Memory Window" value={String(agent.model_settings.memory_window)} />
        <DetailField label="Thinking" value={agent.model_settings.thinking} />
      </div>

      {usedByChannels.length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">{t('agents.usedByChannels')}</h3>
          <div className="flex flex-wrap gap-2">
            {usedByChannels.map((ch) => (
              <span
                key={ch}
                className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]"
              >
                {ch}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </motion.div>
  )
}

function AgentEditor({
  agent,
  providerOptions,
  saving,
  onSave,
  onCancel,
}: {
  agent: AgentInstance
  providerOptions: ProviderOption[]
  saving: boolean
  onSave: (data: {
    display_name?: string
    description?: string
    model?: string
    provider?: string
    memory_window?: number
    thinking?: ThinkingLevel
  }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const ms = agent.model_settings
  const [displayName, setDisplayName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description)
  const [model, setModel] = useState(ms.model)
  const [provider, setProvider] = useState(ms.provider)
  const [memoryWindow, setMemoryWindow] = useState(String(ms.memory_window))
  const [thinking, setThinking] = useState<ThinkingLevel>(ms.thinking)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: {
      display_name?: string
      description?: string
      model?: string
      provider?: string
      memory_window?: number
      thinking?: ThinkingLevel
    } = {}

    if (displayName !== agent.name) payload.display_name = displayName
    if (description !== agent.description) payload.description = description
    if (model !== ms.model) payload.model = model
    if (provider !== ms.provider) payload.provider = provider
    const mw = parseInt(memoryWindow, 10)
    if (!isNaN(mw) && mw !== ms.memory_window) payload.memory_window = mw
    if (thinking !== ms.thinking) payload.thinking = thinking

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }

    await onSave(payload)
  }

  return (
    <motion.form
      key={`edit-${agent.key}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('agents.editAgent')}</p>
          <div className="mt-1 flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{agent.key}</h2>
            {agent.builtin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                <Shield className="h-2.5 w-2.5" />
                builtin
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Display Name *">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('agents.displayNamePlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('agents.descriptionPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="h-px bg-[var(--color-bg-active)]" />

      <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Model Settings</h3>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Model *">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('agents.modelPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Provider *">
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              {providerOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} ({p.type})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
        <FormField label="Memory Window *">
          <input
            type="number"
            min={1}
            value={memoryWindow}
            onChange={(e) => setMemoryWindow(e.target.value)}
            placeholder={t('agents.memoryWindowPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="Thinking">
          <div className="relative">
            <select
              value={thinking}
              onChange={(e) => setThinking(e.target.value as ThinkingLevel)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              <option value="none">none</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
      </div>
    </motion.form>
  )
}

function AddAgentModal({
  open,
  providerOptions,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  providerOptions: ProviderOption[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: AgentFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('')
  const [provider, setProvider] = useState('')
  const [memoryWindow, setMemoryWindow] = useState('100')
  const [thinking, setThinking] = useState<ThinkingLevel>('none')

  useEffect(() => {
    if (open && providerOptions.length > 0 && !provider) {
      setProvider(providerOptions[0].key)
    }
  }, [open, providerOptions, provider])

  useEffect(() => {
    if (!open) {
      setName('')
      setDisplayName('')
      setDescription('')
      setModel('')
      setProvider(providerOptions.length > 0 ? providerOptions[0].key : '')
      setMemoryWindow('100')
      setThinking('none')
    }
  }, [open, providerOptions])

  const canSubmit = name.trim() && displayName.trim() && model.trim() && provider

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const mw = parseInt(memoryWindow, 10)
    await onSubmit({
      name: name.trim(),
      display_name: displayName.trim(),
      description: description.trim(),
      model: model.trim(),
      provider,
      memory_window: isNaN(mw) || mw <= 0 ? 100 : mw,
      thinking,
    })
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-agent-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => { if (!saving) onClose() }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-lg p-6 shadow-[var(--shadow-lg)]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={(e) => { void handleSubmit(e) }} className="space-y-5">
              <div>
                <p className="text-[11px] tracking-[0.06em] tertiary-text">New Agent</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('agents.newAgentTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('agents.newAgentDesc')}
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Name (Key) *">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('agents.keyPlaceholder')}
                    autoFocus
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Display Name *">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('agents.displayNameNewPlaceholder')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
              </div>

              <FormField label="Description">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('agents.descNewPlaceholder')}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Model *">
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="如 gpt-4o"
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Provider *">
                  <div className="relative">
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    >
                      {providerOptions.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key} ({p.type})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  </div>
                </FormField>
                <FormField label="Memory Window">
                  <input
                    type="number"
                    min={1}
                    value={memoryWindow}
                    onChange={(e) => setMemoryWindow(e.target.value)}
                    placeholder={t('agents.defaultMemoryPlaceholder')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Thinking">
                  <div className="relative">
                    <select
                      value={thinking}
                      onChange={(e) => setThinking(e.target.value as ThinkingLevel)}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    >
                      <option value="none">none</option>
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  </div>
                </FormField>
              </div>

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !canSubmit}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg-app)] transition hover:bg-[var(--color-text-primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('common.create')}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function ConfirmDeleteModal({
  agentKey,
  agent,
  usedByChannels,
  isBusy,
  onCancel,
  onConfirm,
}: {
  agentKey: string | null
  agent: AgentInstance | null
  usedByChannels: string[]
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!agentKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [agentKey, isBusy, onCancel])

  const isBuiltin = agent?.builtin ?? false
  const hasChannels = usedByChannels.length > 0

  return (
    <AnimatePresence>
      {agentKey ? (
        <motion.div
          key="delete-agent-overlay"
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
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Agent</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('agents.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('agents.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Agent Key</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{agentKey}</p>
              {agent ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Display Name</p>
                  <p className="mt-1 text-sm subtle-text">{agent.name}</p>
                </>
              ) : null}
            </div>

            {isBuiltin ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('agents.builtinCannotDelete')}
                </p>
              </div>
            ) : null}

            {!isBuiltin && hasChannels ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('agents.usedByChannelsWarning')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {usedByChannels.map((ch) => (
                    <span key={ch} className="rounded-full border border-[color:var(--color-warning)]/30 px-2.5 py-1 text-[11px] text-[var(--color-warning)]">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={isBusy}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-2 text-[13px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              {!isBuiltin ? (
                <button
                  type="button"
                  onClick={() => { void onConfirm() }}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {t('common.delete')} Agent
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

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

function EmptyDetail({ loading }: { loading: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]">
        <Bot className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {loading ? t('agents.loadingAgent') : t('agents.selectAgent')}
        </h3>
        <p className="max-w-lg text-sm subtle-text">
          {loading ? t('agents.loadingAgentDesc') : t('agents.selectAgentDesc')}
        </p>
      </div>
    </div>
  )
}

function AgentListSkeleton() {
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
