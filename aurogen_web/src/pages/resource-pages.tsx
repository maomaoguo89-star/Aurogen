import { Activity, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShellOverview } from '@/features/system/use-shell-overview'

export { AgentsPage } from './agents-page'

export { ChannelsPage } from './channels-page'

export { ProvidersPage } from './providers-page'

export function StatusPage() {
  const { status, summary, error } = useShellOverview()
  const { t } = useTranslation()
  const heartbeatInstances = status?.heartbeat?.instances
  const heartbeatTotal = heartbeatInstances ? Object.keys(heartbeatInstances).length : 0
  const heartbeatRunning = heartbeatInstances
    ? Object.values(heartbeatInstances).filter((instance) => instance.running).length
    : 0

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="panel-surface flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
            <Activity className="h-4.5 w-4.5 text-[var(--color-accent)]" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] tracking-[0.06em] tertiary-text">
              {t('status.runtimeConsole')}
            </p>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Status</h1>
            <p className="max-w-3xl text-[13px] subtle-text">
              {t('status.description')}
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="panel-surface border-[color:var(--color-danger)]/20 bg-[color:var(--color-danger)]/10 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="panel-surface min-h-0 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('status.runtimeHealth')}</h2>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              system/status
            </span>
          </div>

          <div className="grid gap-3">
            <StatusRow
              label="App"
              value={status?.app ?? 'loading'}
              active={Boolean(status?.app === 'ok')}
            />
            <StatusRow
              label="Agent Loop"
              value={status?.agent_loop_running ? 'running' : 'offline'}
              active={Boolean(status?.agent_loop_running)}
            />
            <StatusRow
              label="Heartbeat"
              value={
                heartbeatTotal
                  ? `${heartbeatRunning}/${heartbeatTotal} running`
                  : (status?.heartbeat?.running ? 'running' : 'offline')
              }
              active={Boolean(status?.heartbeat?.running)}
            />
          </div>

          <div className="mt-5">
            <p className="mb-3 text-[11px] tracking-[0.06em] tertiary-text">
              {t('status.channels')}
            </p>
            <div className="grid gap-3">
              {status?.channels?.length ? (
                status.channels.map((channel) => (
                  <StatusRow
                    key={channel.name}
                    label={channel.name}
                    value={channel.running ? 'online' : 'offline'}
                    active={channel.running}
                  />
                ))
              ) : (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-3 text-[13px] subtle-text">
                  {t('status.loadingChannels')}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-4 py-4">
            <p className="text-[11px] tracking-[0.06em] tertiary-text">MCP</p>
            <p className="mt-2 text-[13px] text-[var(--color-text-primary)]">
              {status
                ? `${status.mcp.loaded_count} loaded / ${status.mcp.configured} configured`
                : t('status.loadingMcp')}
            </p>
            {status?.mcp.loaded_tools?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {status.mcp.loaded_tools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-[var(--color-border-subtle)] px-2.5 py-1 text-[11px] subtle-text"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel-surface min-h-0 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('status.resourceSummary')}</h2>
            <span className="rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-[11px] subtle-text">
              resources/summary
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <OverviewTile label="Claws" value={summary?.agents_count} />
            <OverviewTile label="Channels" value={summary?.channels_count} />
            <OverviewTile label="Brains" value={summary?.providers_count} />
            <OverviewTile label="Sessions" value={summary?.sessions_count} />
          </div>
        </section>
      </div>
    </section>
  )
}

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <section className="panel-surface flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/60">
        <Sparkles className="h-6 w-6 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('notFound.title')}</h1>
        <p className="max-w-lg text-sm subtle-text">
          {t('notFound.description')}
        </p>
      </div>
    </section>
  )
}

function StatusRow({
  label,
  value,
  active,
}: {
  label: string
  value: string
  active: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] px-3 py-2.5">
      <span className="text-[13px] subtle-text">{label}</span>
      <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
        <span
          className={
            active ? 'h-2 w-2 rounded-full bg-[var(--color-success)]' : 'h-2 w-2 rounded-full bg-[var(--color-border-subtle)]'
          }
        />
        {value}
      </span>
    </div>
  )
}

function OverviewTile({
  label,
  value,
}: {
  label: string
  value: number | undefined
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)]/50 px-3 py-3">
      <p className="text-[11px] tracking-[0.06em] tertiary-text">{label}</p>
      <p className="mt-2 text-base font-semibold text-[var(--color-text-primary)]">{value ?? '...'}</p>
    </div>
  )
}
