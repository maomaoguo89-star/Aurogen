import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Cable,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type SupportedProviderType = {
  type: string
  description: string
  required_settings: string[]
  optional_settings: string[]
}

type ProviderInstance = {
  key: string
  type: string
  description: string
  settings: Record<string, unknown>
  used_by_agents: string[]
}

type ProviderFormData = {
  key: string
  type: string
  description: string
  settings: Record<string, string>
}

const SENSITIVE_KEYS = ['api_key', 'app_secret', 'secret', 'token', 'password']

function isSensitiveKey(key: string) {
  return SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))
}

function maskValue(value: unknown): string {
  const str = String(value ?? '')
  if (str.length <= 8) return '••••••••'
  return str.slice(0, 4) + '••••' + str.slice(-4)
}

async function fetchProviders() {
  return fetchJson<{ providers: ProviderInstance[] }>('/providers/config')
}

async function fetchSupportedTypes() {
  return fetchJson<{ supported: SupportedProviderType[] }>('/providers/supported')
}

async function addProvider(data: ProviderFormData) {
  return fetchJson<{ message: string }>('/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateProvider(key: string, data: { type?: string; description?: string; settings?: Record<string, string> }) {
  return fetchJson<{ message: string }>(`/providers/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteProvider(key: string) {
  return fetchJson<{ message: string }>(`/providers/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

function useProvidersController() {
  const [providers, setProviders] = useState<ProviderInstance[]>([])
  const [supportedTypes, setSupportedTypes] = useState<SupportedProviderType[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.key === selectedKey) ?? null,
    [providers, selectedKey],
  )

  const selectedTypeInfo = useMemo(() => {
    if (!selectedProvider) return null
    return supportedTypes.find((t) => t.type === selectedProvider.type) ?? null
  }, [selectedProvider, supportedTypes])

  const reload = useCallback(async () => {
    try {
      const [provRes, typeRes] = await Promise.all([fetchProviders(), fetchSupportedTypes()])
      setProviders(provRes.providers)
      setSupportedTypes(typeRes.supported)
      return provRes.providers
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 providers 失败'
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

  const handleAdd = useCallback(async (data: ProviderFormData) => {
    setSaving(true)
    setError(null)
    try {
      await addProvider(data)
      const list = await reload()
      setSelectedKey(data.key)
      return list
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加 provider 失败'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleUpdate = useCallback(async (key: string, data: { type?: string; description?: string; settings?: Record<string, string> }) => {
    setSaving(true)
    setError(null)
    try {
      await updateProvider(key, data)
      await reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新 provider 失败'
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [reload])

  const handleDelete = useCallback(async (key: string) => {
    setDeleting(true)
    setError(null)
    try {
      await deleteProvider(key)
      const list = await reload()
      if (selectedKey === key) {
        setSelectedKey(list.length > 0 ? list[0].key : null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除 provider 失败'
      setError(msg)
      throw err
    } finally {
      setDeleting(false)
    }
  }, [reload, selectedKey])

  return {
    providers,
    supportedTypes,
    selectedKey,
    selectedProvider,
    selectedTypeInfo,
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

export function ProvidersPage() {
  const { t } = useTranslation()
  const {
    providers,
    supportedTypes,
    selectedKey,
    selectedProvider,
    selectedTypeInfo,
    loading,
    error,
    saving,
    deleting,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
  } = useProvidersController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const filteredProviders = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return providers
    return providers.filter(
      (p) =>
        p.key.toLowerCase().includes(kw) ||
        p.type.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw),
    )
  }, [searchValue, providers])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
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
        {/* Left: Provider List */}
        <section className="panel-surface flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('providers.instancesTitle')}</h2>
              <p className="mt-1 text-[11px] tertiary-text">{t('providers.instancesDesc')}</p>
            </div>
            <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              {providers.length} total
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
          >
            <Plus className="h-4 w-4" />
            New Provider
          </button>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('providers.search')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
          </div>

          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
            {loading ? (
              <ProviderListSkeleton />
            ) : filteredProviders.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {filteredProviders.map((provider, index) => {
                  const selected = selectedKey === provider.key
                  return (
                    <motion.button
                      key={provider.key}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      onClick={() => {
                        setSelectedKey(provider.key)
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
                          <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                            {provider.key}
                          </p>
                          <p className="mt-1 truncate text-[11px] tertiary-text">
                            {provider.type} {provider.description ? `· ${provider.description}` : ''}
                          </p>
                        </div>
                        {provider.used_by_agents.length > 0 ? (
                          <span className="shrink-0 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-2.5 py-1 text-[10px] tertiary-text">
                            {provider.used_by_agents.length} agent{provider.used_by_agents.length > 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-center text-sm subtle-text">
                {providers.length === 0
                  ? t('providers.emptyNoConfig')
                  : t('providers.emptyNoMatch')}
              </div>
            )}
          </div>
        </section>

        {/* Right: Detail + Supported Types */}
        <section className="flex min-h-0 flex-col gap-4">
          <div className="panel-surface min-h-[340px] flex-1 overflow-y-auto p-6">
            {selectedProvider ? (
              editMode ? (
                <ProviderEditor
                  provider={selectedProvider}
                  typeInfo={selectedTypeInfo}
                  supportedTypes={supportedTypes}
                  saving={saving}
                  onSave={async (data) => {
                    await handleUpdate(selectedProvider.key, data)
                    setEditMode(false)
                  }}
                  onCancel={() => setEditMode(false)}
                />
              ) : (
                <ProviderDetail
                  provider={selectedProvider}
                  typeInfo={selectedTypeInfo}
                  onEdit={() => setEditMode(true)}
                  onDelete={() => setPendingDeleteKey(selectedProvider.key)}
                />
              )
            ) : (
              <EmptyDetail loading={loading} />
            )}
          </div>

          <div className="panel-surface flex max-h-[260px] min-h-0 flex-col p-5">
            <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Supported Provider Types</h3>
              <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
                {supportedTypes.length} types
              </span>
            </div>
            <div className="scroll-area min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {supportedTypes.map((st) => (
                <div
                  key={st.type}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3 transition hover:border-[var(--color-border-strong)]"
                >
                  <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{st.type}</p>
                  <p className="mt-1 text-[11px] tertiary-text">{st.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {st.required_settings.map((s) => (
                      <span key={s} className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                        {s} *
                      </span>
                    ))}
                    {st.optional_settings.map((s) => (
                      <span key={s} className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] tertiary-text">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        </section>
      </div>

      <AddProviderModal
        open={showAddModal}
        supportedTypes={supportedTypes}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        providerKey={pendingDeleteKey}
        provider={pendingDeleteKey ? providers.find((p) => p.key === pendingDeleteKey) ?? null : null}
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

function ProviderDetail({
  provider,
  typeInfo,
  onEdit,
  onDelete,
}: {
  provider: ProviderInstance
  typeInfo: SupportedProviderType | null
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allSettingKeys = useMemo(() => {
    const fromType = [...(typeInfo?.required_settings ?? []), ...(typeInfo?.optional_settings ?? [])]
    const fromData = Object.keys(provider.settings)
    return [...new Set([...fromType, ...fromData])]
  }, [typeInfo, provider.settings])

  return (
    <motion.div
      key={provider.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">Provider Detail</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">{provider.key}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)]"
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailField label="Key" value={provider.key} />
        <DetailField label="Type" value={provider.type} />
        <DetailField label="Description" value={provider.description || '—'} span={2} />
      </div>

      <div className="my-5 h-px bg-[var(--color-bg-active)]" />

      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
      {allSettingKeys.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {allSettingKeys.map((key) => {
            const value = provider.settings[key]
            const sensitive = isSensitiveKey(key)
            const revealed = revealedKeys.has(key)
            const isRequired = typeInfo?.required_settings.includes(key)

            return (
              <div
                key={key}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] tracking-[0.06em] tertiary-text">
                    {key}
                    {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                  </p>
                  {sensitive && value ? (
                    <button
                      type="button"
                      onClick={() => toggleReveal(key)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] tertiary-text transition hover:bg-[var(--color-bg-active)]"
                    >
                      {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {revealed ? t('providers.hide') : t('providers.show')}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1.5 break-all text-[13px] font-mono text-[var(--color-text-primary)]">
                  {value == null || value === '' ? (
                    <span className="tertiary-text">{t('providers.unset')}</span>
                  ) : sensitive && !revealed ? (
                    maskValue(value)
                  ) : (
                    String(value)
                  )}
                </p>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[13px] subtle-text">{t('providers.noSettings')}</p>
      )}

      {provider.used_by_agents.length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Used By Agents</h3>
          <div className="flex flex-wrap gap-2">
            {provider.used_by_agents.map((agent) => (
              <span
                key={agent}
                className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-3 py-1.5 text-[12px] text-[var(--color-text-primary)]"
              >
                {agent}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </motion.div>
  )
}

function ProviderEditor({
  provider,
  typeInfo,
  supportedTypes,
  saving,
  onSave,
  onCancel,
}: {
  provider: ProviderInstance
  typeInfo: SupportedProviderType | null
  supportedTypes: SupportedProviderType[]
  saving: boolean
  onSave: (data: { type?: string; description?: string; settings?: Record<string, string> }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState(provider.type)
  const [description, setDescription] = useState(provider.description)
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {}
    for (const [k, v] of Object.entries(provider.settings)) {
      s[k] = String(v ?? '')
    }
    return s
  })
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const currentTypeInfo = useMemo(
    () => supportedTypes.find((t) => t.type === type) ?? typeInfo,
    [type, supportedTypes, typeInfo],
  )

  const allSettingKeys = useMemo(() => {
    const fromType = [...(currentTypeInfo?.required_settings ?? []), ...(currentTypeInfo?.optional_settings ?? [])]
    const fromData = Object.keys(settings)
    return [...new Set([...fromType, ...fromData])]
  }, [currentTypeInfo, settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: { type?: string; description?: string; settings?: Record<string, string> } = {}
    if (type !== provider.type) payload.type = type
    if (description !== provider.description) payload.description = description

    const filteredSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (v !== '') filteredSettings[k] = v
    }
    const origSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(provider.settings)) {
      origSettings[k] = String(v ?? '')
    }
    if (JSON.stringify(filteredSettings) !== JSON.stringify(origSettings)) {
      payload.settings = filteredSettings
    }

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }

    await onSave(payload)
  }

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <motion.form
      key={`edit-${provider.key}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(e) => { void handleSubmit(e) }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">{t('providers.editProvider')}</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">{provider.key}</h2>
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
        <FormField label="Type">
          <div className="relative">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            >
              {supportedTypes.map((st) => (
                <option key={st.type} value={st.type}>{st.type}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          </div>
        </FormField>
        <FormField label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('providers.descriptionPlaceholder')}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <div className="h-px bg-[var(--color-bg-active)]" />

      <div>
        <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {allSettingKeys.map((key) => {
            const sensitive = isSensitiveKey(key)
            const revealed = revealedKeys.has(key)
            const isRequired = currentTypeInfo?.required_settings.includes(key)

            return (
              <FormField
                key={key}
                label={
                  <>
                    {key}
                    {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                  </>
                }
              >
                <div className="relative">
                  <input
                    type={sensitive && !revealed ? 'password' : 'text'}
                    value={settings[key] ?? ''}
                    onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={isRequired ? t('providers.required') : t('providers.optional')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                  {sensitive ? (
                    <button
                      type="button"
                      onClick={() => toggleReveal(key)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
                    >
                      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
              </FormField>
            )
          })}
        </div>
      </div>
    </motion.form>
  )
}

function AddProviderModal({
  open,
  supportedTypes,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  supportedTypes: SupportedProviderType[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: ProviderFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [type, setType] = useState('')
  const [description, setDescription] = useState('')
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open && supportedTypes.length > 0 && !type) {
      setType(supportedTypes[0].type)
    }
  }, [open, supportedTypes, type])

  useEffect(() => {
    if (!open) {
      setKey('')
      setType(supportedTypes.length > 0 ? supportedTypes[0].type : '')
      setDescription('')
      setSettings({})
      setRevealedKeys(new Set())
    }
  }, [open, supportedTypes])

  const currentTypeInfo = useMemo(
    () => supportedTypes.find((t) => t.type === type) ?? null,
    [type, supportedTypes],
  )

  const allSettingKeys = useMemo(() => {
    if (!currentTypeInfo) return []
    return [...currentTypeInfo.required_settings, ...currentTypeInfo.optional_settings]
  }, [currentTypeInfo])

  const toggleReveal = (settingKey: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(settingKey)) next.delete(settingKey)
      else next.add(settingKey)
      return next
    })
  }

  const canSubmit = key.trim() && type

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const filteredSettings: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (v.trim()) filteredSettings[k] = v.trim()
    }
    await onSubmit({ key: key.trim(), type, description: description.trim(), settings: filteredSettings })
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-overlay"
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
                <p className="text-[11px] tracking-[0.06em] tertiary-text">New Provider</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('providers.addProviderTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('providers.addProviderDesc')}
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Key *">
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={t('providers.keyPlaceholder')}
                    autoFocus
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                  />
                </FormField>
                <FormField label="Type *">
                  <div className="relative">
                    <select
                      value={type}
                      onChange={(e) => {
                        setType(e.target.value)
                        setSettings({})
                      }}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-9 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    >
                      {supportedTypes.map((st) => (
                        <option key={st.type} value={st.type}>{st.type} — {st.description}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  </div>
                </FormField>
              </div>

              <FormField label="Description">
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('providers.descriptionPlaceholder')}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              {allSettingKeys.length > 0 ? (
                <div>
                  <h4 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h4>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {allSettingKeys.map((settingKey) => {
                      const sensitive = isSensitiveKey(settingKey)
                      const revealed = revealedKeys.has(settingKey)
                      const isRequired = currentTypeInfo?.required_settings.includes(settingKey)

                      return (
                        <FormField
                          key={settingKey}
                          label={
                            <>
                              {settingKey}
                              {isRequired ? <span className="ml-1 text-[var(--color-accent)]">*</span> : null}
                            </>
                          }
                        >
                          <div className="relative">
                            <input
                              type={sensitive && !revealed ? 'password' : 'text'}
                              value={settings[settingKey] ?? ''}
                              onChange={(e) => setSettings((prev) => ({ ...prev, [settingKey]: e.target.value }))}
                              placeholder={isRequired ? t('providers.required') : t('providers.optional')}
                              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 pr-10 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                            />
                            {sensitive ? (
                              <button
                                type="button"
                                onClick={() => toggleReveal(settingKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] transition hover:text-[var(--color-text-primary)]"
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            ) : null}
                          </div>
                        </FormField>
                      )
                    })}
                  </div>
                </div>
              ) : null}

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
                  {t('common.add')}
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
  providerKey,
  provider,
  isBusy,
  onCancel,
  onConfirm,
}: {
  providerKey: string | null
  provider: ProviderInstance | null
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!providerKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [providerKey, isBusy, onCancel])

  const hasAgents = provider && provider.used_by_agents.length > 0

  return (
    <AnimatePresence>
      {providerKey ? (
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
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Delete Provider</p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('providers.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('providers.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">Provider Key</p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{providerKey}</p>
              {provider ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">Type</p>
                  <p className="mt-1 text-sm subtle-text">{provider.type}</p>
                </>
              ) : null}
            </div>

            {hasAgents ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('providers.usedByAgentsWarning')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {provider!.used_by_agents.map((a) => (
                    <span key={a} className="rounded-full border border-[color:var(--color-warning)]/30 px-2.5 py-1 text-[11px] text-[var(--color-warning)]">
                      {a}
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
              <button
                type="button"
                onClick={() => { void onConfirm() }}
                disabled={isBusy}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                  {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {t('common.delete')} Provider
              </button>
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
        <Cable className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {loading ? t('providers.loadingProvider') : t('providers.selectProvider')}
        </h3>
        <p className="max-w-lg text-sm subtle-text">
          {loading ? t('providers.loadingProviderDesc') : t('providers.selectProviderDesc')}
        </p>
      </div>
    </div>
  )
}

function ProviderListSkeleton() {
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
