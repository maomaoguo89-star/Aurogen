import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Blocks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  Globe,
  X,
  Wrench,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fetchJson } from '@/lib/api'
import { cn } from '@/lib/utils'

type McpServer = {
  key: string
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  tool_timeout: number
  loaded_tools: string[]
  loaded_count: number
}

type McpFormData = {
  key: string
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  tool_timeout: number
}

async function fetchMcpServers() {
  return fetchJson<{ servers: McpServer[] }>('/mcp/config')
}

async function addMcpServer(data: McpFormData) {
  return fetchJson<{ message: string }>('/mcp', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

async function updateMcpServer(
  key: string,
  data: Partial<Omit<McpFormData, 'key'>>,
) {
  return fetchJson<{ message: string }>(`/mcp/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

async function deleteMcpServer(key: string) {
  return fetchJson<{ message: string }>(`/mcp/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

async function reloadMcpServers() {
  return fetchJson<{ message: string }>('/mcp/reload', { method: 'POST' })
}

function getConnectionType(server: McpServer): 'stdio' | 'sse' | 'unknown' {
  if (server.command) return 'stdio'
  if (server.url) return 'sse'
  return 'unknown'
}

function useMcpController() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)

  const selectedServer = useMemo(
    () => servers.find((s) => s.key === selectedKey) ?? null,
    [servers, selectedKey],
  )

  const reload = useCallback(async () => {
    try {
      const res = await fetchMcpServers()
      setServers(res.servers)
      return res.servers
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 MCP servers 失败'
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
    return () => {
      active = false
    }
  }, [reload, selectedKey])

  const handleAdd = useCallback(
    async (data: McpFormData) => {
      setSaving(true)
      setError(null)
      try {
        await addMcpServer(data)
        const list = await reload()
        setSelectedKey(data.key)
        return list
      } catch (err) {
        const msg = err instanceof Error ? err.message : '添加 MCP server 失败'
        setError(msg)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [reload],
  )

  const handleUpdate = useCallback(
    async (key: string, data: Partial<Omit<McpFormData, 'key'>>) => {
      setSaving(true)
      setError(null)
      try {
        await updateMcpServer(key, data)
        await reload()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '更新 MCP server 失败'
        setError(msg)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [reload],
  )

  const handleDelete = useCallback(
    async (key: string) => {
      setDeleting(true)
      setError(null)
      try {
        await deleteMcpServer(key)
        const list = await reload()
        if (selectedKey === key) {
          setSelectedKey(list.length > 0 ? list[0].key : null)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '删除 MCP server 失败'
        setError(msg)
        throw err
      } finally {
        setDeleting(false)
      }
    },
    [reload, selectedKey],
  )

  const handleReloadAll = useCallback(async () => {
    setReloading(true)
    setError(null)
    try {
      await reloadMcpServers()
      await reload()
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '重新加载 MCP servers 失败'
      setError(msg)
    } finally {
      setReloading(false)
    }
  }, [reload])

  return {
    servers,
    selectedKey,
    selectedServer,
    loading,
    error,
    saving,
    deleting,
    reloading,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
    handleReloadAll,
  }
}

export function McpPage() {
  const { t } = useTranslation()
  const {
    servers,
    selectedKey,
    selectedServer,
    loading,
    error,
    saving,
    deleting,
    reloading,
    setSelectedKey,
    setError,
    handleAdd,
    handleUpdate,
    handleDelete,
    handleReloadAll,
  } = useMcpController()

  const [searchValue, setSearchValue] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const filteredServers = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    if (!kw) return servers
    return servers.filter(
      (s) =>
        s.key.toLowerCase().includes(kw) ||
        s.command.toLowerCase().includes(kw) ||
        s.url.toLowerCase().includes(kw),
    )
  }, [searchValue, servers])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      {error ? (
        <div className="panel-surface flex items-start gap-3 border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">{t('common.operationError')}</p>
            <p className="mt-1 text-[13px] text-[var(--color-danger)]/90">
              {error}
            </p>
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

      <div className="grid min-h-0 flex-1 gap-2 grid-cols-[360px_minmax(0,1fr)]">
        {/* Left: Server List */}
        <section className="panel-surface flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                MCP Servers
              </h2>
              <p className="mt-1 text-[11px] tertiary-text">
                {t('mcp.description')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleReloadAll()
                }}
                disabled={reloading}
                title={t('mcp.reloadAllTitle')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    reloading && 'animate-spin',
                  )}
                />
              </button>
              <div className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
                {servers.length} total
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] py-2 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_2px_12px_var(--color-accent-soft)]"
          >
            <Plus className="h-4 w-4" />
            New Server
          </button>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('mcp.search')}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] py-2 pl-9 pr-4 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
            />
          </div>

          <div className="scroll-area flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
            {loading ? (
              <ListSkeleton />
            ) : filteredServers.length > 0 ? (
              <AnimatePresence mode="popLayout">
                {filteredServers.map((server, index) => {
                  const selected = selectedKey === server.key
                  const connType = getConnectionType(server)
                  return (
                    <motion.button
                      key={server.key}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      onClick={() => {
                        setSelectedKey(server.key)
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
                            {server.key}
                          </p>
                          <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] tertiary-text">
                            {connType === 'stdio' ? (
                              <Terminal className="inline h-3 w-3 shrink-0" />
                            ) : (
                              <Globe className="inline h-3 w-3 shrink-0" />
                            )}
                            <span className="truncate">
                              {connType === 'stdio'
                                ? server.command
                                : server.url || t('mcp.unconfig')}
                            </span>
                          </p>
                        </div>
                        {server.loaded_count > 0 ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-2.5 py-1 text-[10px] tertiary-text">
                            <Wrench className="h-2.5 w-2.5" />
                            {server.loaded_count}
                          </span>
                        ) : null}
                      </div>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 py-6 text-center text-sm subtle-text">
                {servers.length === 0
                  ? t('mcp.emptyNoConfig')
                  : t('mcp.emptyNoMatch')}
              </div>
            )}
          </div>
        </section>

        {/* Right: Detail / Editor */}
        <section className="panel-surface min-h-0 flex-1 overflow-y-auto p-4">
          {selectedServer ? (
            editMode ? (
              <McpServerEditor
                server={selectedServer}
                saving={saving}
                onSave={async (data) => {
                  await handleUpdate(selectedServer.key, data)
                  setEditMode(false)
                }}
                onCancel={() => setEditMode(false)}
              />
            ) : (
              <McpServerDetail
                server={selectedServer}
                onEdit={() => setEditMode(true)}
                onDelete={() => setPendingDeleteKey(selectedServer.key)}
              />
            )
          ) : (
            <EmptyDetail loading={loading} />
          )}
        </section>
      </div>

      <AddMcpServerModal
        open={showAddModal}
        saving={saving}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (data) => {
          await handleAdd(data)
          setShowAddModal(false)
        }}
      />

      <ConfirmDeleteModal
        serverKey={pendingDeleteKey}
        server={
          pendingDeleteKey
            ? (servers.find((s) => s.key === pendingDeleteKey) ?? null)
            : null
        }
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

/* ── Detail ─────────────────────────────────────────────────────────────────── */

function McpServerDetail({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServer
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const connType = getConnectionType(server)

  return (
    <motion.div
      key={server.key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">
            Server Detail
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            {server.key}
          </h2>
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
        <DetailField label="Key" value={server.key} />
        <DetailField
          label="Connection Type"
          value={
            connType === 'stdio'
              ? 'Stdio (command)'
              : connType === 'sse'
                ? 'SSE (url)'
                : t('mcp.unconfig')
          }
        />
        {server.command ? (
          <DetailField label="Command" value={server.command} />
        ) : null}
        {server.args.length > 0 ? (
          <DetailField label="Args" value={server.args.join(' ')} />
        ) : null}
        {server.url ? (
          <DetailField label="URL" value={server.url} span={2} />
        ) : null}
        <DetailField
          label="Tool Timeout"
          value={`${server.tool_timeout}s`}
        />
      </div>

      {Object.keys(server.env).length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
            Environment Variables
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {Object.entries(server.env).map(([k, v]) => (
              <div
                key={k}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3"
              >
                <p className="text-[11px] tracking-[0.06em] tertiary-text">
                  {k}
                </p>
                <p className="mt-1.5 break-all font-mono text-[13px] text-[var(--color-text-primary)]">
                  {v}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {Object.keys(server.headers).length > 0 ? (
        <>
          <div className="my-5 h-px bg-[var(--color-bg-active)]" />
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">
            Headers
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {Object.entries(server.headers).map(([k, v]) => (
              <div
                key={k}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3"
              >
                <p className="text-[11px] tracking-[0.06em] tertiary-text">
                  {k}
                </p>
                <p className="mt-1.5 break-all font-mono text-[13px] text-[var(--color-text-primary)]">
                  {v}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="my-5 h-px bg-[var(--color-bg-active)]" />
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          Loaded Tools
        </h3>
        <span className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-0.5 text-[10px] tertiary-text">
          {server.loaded_count} loaded
        </span>
      </div>
      {server.loaded_tools.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {server.loaded_tools.map((tool) => (
            <span
              key={tool}
              className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60 px-2.5 py-1 text-[11px] text-[var(--color-text-primary)]"
            >
              {tool}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] subtle-text">
          {t('mcp.noToolsLoaded')}
        </p>
      )}
    </motion.div>
  )
}

/* ── Editor ─────────────────────────────────────────────────────────────────── */

function McpServerEditor({
  server,
  saving,
  onSave,
  onCancel,
}: {
  server: McpServer
  saving: boolean
  onSave: (data: Partial<Omit<McpFormData, 'key'>>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [command, setCommand] = useState(server.command)
  const [argsText, setArgsText] = useState(server.args.join('\n'))
  const [url, setUrl] = useState(server.url)
  const [toolTimeout, setToolTimeout] = useState(String(server.tool_timeout))
  const [envPairs, setEnvPairs] = useState<[string, string][]>(() =>
    Object.entries(server.env).length > 0
      ? Object.entries(server.env)
      : [],
  )
  const [headerPairs, setHeaderPairs] = useState<[string, string][]>(() =>
    Object.entries(server.headers).length > 0
      ? Object.entries(server.headers)
      : [],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Partial<Omit<McpFormData, 'key'>> = {}

    if (command !== server.command) payload.command = command
    const newArgs = argsText
      .split('\n')
      .map((a) => a.trim())
      .filter(Boolean)
    if (JSON.stringify(newArgs) !== JSON.stringify(server.args))
      payload.args = newArgs
    if (url !== server.url) payload.url = url

    const newEnv: Record<string, string> = {}
    for (const [k, v] of envPairs) {
      if (k.trim()) newEnv[k.trim()] = v
    }
    if (JSON.stringify(newEnv) !== JSON.stringify(server.env))
      payload.env = newEnv

    const newHeaders: Record<string, string> = {}
    for (const [k, v] of headerPairs) {
      if (k.trim()) newHeaders[k.trim()] = v
    }
    if (JSON.stringify(newHeaders) !== JSON.stringify(server.headers))
      payload.headers = newHeaders

    const newTimeout = parseInt(toolTimeout, 10)
    if (!isNaN(newTimeout) && newTimeout !== server.tool_timeout)
      payload.tool_timeout = newTimeout

    if (Object.keys(payload).length === 0) {
      onCancel()
      return
    }

    await onSave(payload)
  }

  return (
    <motion.form
      key={`edit-${server.key}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(e) => {
        void handleSubmit(e)
      }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.06em] tertiary-text">
            {t('mcp.editServer')}
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            {server.key}
          </h2>
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
            {saving ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Command">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如 npx, python, node"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
        <FormField label="URL">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="SSE endpoint URL"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
          />
        </FormField>
      </div>

      <FormField label={t('mcp.argsLabel')}>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
          rows={3}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
        />
      </FormField>

      <FormField label="Tool Timeout (seconds)">
        <input
          type="number"
          min={1}
          value={toolTimeout}
          onChange={(e) => setToolTimeout(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
        />
      </FormField>

      <div className="h-px bg-[var(--color-bg-active)]" />

      <KeyValueEditor
        title="Environment Variables"
        pairs={envPairs}
        onChange={setEnvPairs}
        keyPlaceholder="VAR_NAME"
        valuePlaceholder="value"
      />

      <div className="h-px bg-[var(--color-bg-active)]" />

      <KeyValueEditor
        title="Headers"
        pairs={headerPairs}
        onChange={setHeaderPairs}
        keyPlaceholder="Header-Name"
        valuePlaceholder="value"
      />
    </motion.form>
  )
}

/* ── Add Modal ──────────────────────────────────────────────────────────────── */

function AddMcpServerModal({
  open,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  saving: boolean
  onClose: () => void
  onSubmit: (data: McpFormData) => Promise<void>
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [mode, setMode] = useState<'stdio' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [url, setUrl] = useState('')
  const [toolTimeout, setToolTimeout] = useState('30')
  const [envPairs, setEnvPairs] = useState<[string, string][]>([])
  const [headerPairs, setHeaderPairs] = useState<[string, string][]>([])

  useEffect(() => {
    if (!open) {
      setKey('')
      setMode('stdio')
      setCommand('')
      setArgsText('')
      setUrl('')
      setToolTimeout('30')
      setEnvPairs([])
      setHeaderPairs([])
    }
  }, [open])

  const canSubmit =
    key.trim() && (mode === 'stdio' ? command.trim() : url.trim())

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const env: Record<string, string> = {}
    for (const [k, v] of envPairs) {
      if (k.trim()) env[k.trim()] = v
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of headerPairs) {
      if (k.trim()) headers[k.trim()] = v
    }
    const args = argsText
      .split('\n')
      .map((a) => a.trim())
      .filter(Boolean)
    const timeout = parseInt(toolTimeout, 10)

    await onSubmit({
      key: key.trim(),
      command: mode === 'stdio' ? command.trim() : '',
      args: mode === 'stdio' ? args : [],
      env,
      url: mode === 'sse' ? url.trim() : '',
      headers: mode === 'sse' ? headers : {},
      tool_timeout: isNaN(timeout) ? 30 : timeout,
    })
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
          onClick={() => {
            if (!saving) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 shadow-[var(--shadow-lg)]"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              onSubmit={(e) => {
                void handleSubmit(e)
              }}
              className="space-y-5"
            >
              <div>
                <p className="text-[11px] tracking-[0.06em] tertiary-text">
                  New MCP Server
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('mcp.addServerTitle')}
                </h3>
                <p className="mt-1 text-[13px] subtle-text">
                  {t('mcp.addServerDesc')}
                </p>
              </div>

              <FormField label="Key *">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                    placeholder={t('mcp.keyPlaceholder')}
                  autoFocus
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              <div>
                <p className="mb-2 text-[11px] tracking-[0.06em] tertiary-text">
                  {t('mcp.connectionMode')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('stdio')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-[13px] font-medium transition',
                      mode === 'stdio'
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
                    )}
                  >
                    <Terminal className="h-4 w-4" />
                    Stdio
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('sse')}
                    className={cn(
                      'inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-[13px] font-medium transition',
                      mode === 'sse'
                        ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]',
                    )}
                  >
                    <Globe className="h-4 w-4" />
                    SSE
                  </button>
                </div>
              </div>

              {mode === 'stdio' ? (
                <>
                  <FormField label="Command *">
                    <input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="例如 npx, python, node"
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    />
                  </FormField>
                  <FormField label={t('mcp.argsLabel')}>
                    <textarea
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                      rows={3}
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField label="URL *">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://localhost:3000/sse"
                      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                    />
                  </FormField>
                  <KeyValueEditor
                    title="Headers"
                    pairs={headerPairs}
                    onChange={setHeaderPairs}
                    keyPlaceholder="Header-Name"
                    valuePlaceholder="value"
                  />
                </>
              )}

              <FormField label="Tool Timeout (seconds)">
                <input
                  type="number"
                  min={1}
                  value={toolTimeout}
                  onChange={(e) => setToolTimeout(e.target.value)}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-4 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
                />
              </FormField>

              <KeyValueEditor
                title="Environment Variables"
                pairs={envPairs}
                onChange={setEnvPairs}
                keyPlaceholder="VAR_NAME"
                valuePlaceholder="value"
              />

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
                  {saving ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
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

/* ── Confirm Delete ─────────────────────────────────────────────────────────── */

function ConfirmDeleteModal({
  serverKey,
  server,
  isBusy,
  onCancel,
  onConfirm,
}: {
  serverKey: string | null
  server: McpServer | null
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!serverKey || isBusy) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [serverKey, isBusy, onCancel])

  return (
    <AnimatePresence>
      {serverKey ? (
        <motion.div
          key="delete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => {
            if (!isBusy) onCancel()
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="panel-surface w-full max-w-md p-4 shadow-[var(--shadow-lg)]"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">
                Delete MCP Server
              </p>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('mcp.deleteConfirmTitle')}
              </h3>
              <p className="text-sm subtle-text">
                {t('mcp.deleteConfirmDesc')}
              </p>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-4 py-3">
              <p className="text-[11px] tracking-[0.06em] tertiary-text">
                Server Key
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                {serverKey}
              </p>
              {server && server.loaded_count > 0 ? (
                <>
                  <p className="mt-3 text-[11px] tracking-[0.06em] tertiary-text">
                    Loaded Tools
                  </p>
                  <p className="mt-1 text-sm subtle-text">
                    {t('mcp.toolsWillUnload', { count: server.loaded_count })}
                  </p>
                </>
              ) : null}
            </div>

            {server && server.loaded_count > 0 ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--color-warning)]">
                  {t('mcp.toolsWillUnloadWarning', { count: server.loaded_count })}
                </p>
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
                onClick={() => {
                  void onConfirm()
                }}
                disabled={isBusy}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/15 px-4 py-2 text-[13px] font-medium text-[var(--color-danger)] transition hover:bg-[color:var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBusy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {t('common.delete')} Server
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ── Shared Components ──────────────────────────────────────────────────────── */

function KeyValueEditor({
  title,
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  title: string
  pairs: [string, string][]
  onChange: (pairs: [string, string][]) => void
  keyPlaceholder: string
  valuePlaceholder: string
}) {
  const { t } = useTranslation()
  const addRow = () => onChange([...pairs, ['', '']])
  const removeRow = (index: number) =>
    onChange(pairs.filter((_, i) => i !== index))
  const updateRow = (
    index: number,
    field: 0 | 1,
    value: string,
  ) => {
    const next = pairs.map((pair, i) => {
      if (i !== index) return pair
      const clone: [string, string] = [...pair]
      clone[field] = value
      return clone
    })
    onChange(next)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {title}
        </h3>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] tertiary-text transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] hover:text-[var(--color-text-primary)]"
        >
          <Plus className="h-3 w-3" />
          {t('mcp.kvAdd')}
        </button>
      </div>
      {pairs.length > 0 ? (
        <div className="space-y-2">
          {pairs.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={k}
                onChange={(e) => updateRow(i, 0, e.target.value)}
                placeholder={keyPlaceholder}
                className="w-2/5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
              />
              <input
                value={v}
                onChange={(e) => updateRow(i, 1, e.target.value)}
                placeholder={valuePlaceholder}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3 py-2 font-mono text-[13px] text-[var(--color-text-primary)] outline-none transition placeholder:font-sans placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-strong)] focus:shadow-[var(--shadow-focus)]"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-tertiary)] transition hover:bg-[color:var(--color-danger)]/10 hover:text-[var(--color-danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] subtle-text">{t('mcp.kvEmpty')}</p>
      )}
    </div>
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
      <p className="mt-1 break-all text-sm text-[var(--color-text-primary)]">
        {value}
      </p>
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
      <span className="text-[11px] tracking-[0.06em] tertiary-text">
        {label}
      </span>
      {children}
    </label>
  )
}

function EmptyDetail({ loading }: { loading: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/30 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]">
        <Blocks className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {loading ? t('mcp.loadingServer') : t('mcp.selectServer')}
        </h3>
        <p className="max-w-lg text-sm subtle-text">
          {loading ? t('mcp.loadingServerDesc') : t('mcp.selectServerDesc')}
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
