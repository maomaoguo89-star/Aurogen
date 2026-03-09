import { useMemo } from 'react'
import { Activity, Blocks, Bot, Cable, CalendarClock, History, MessageSquareText, Monitor, Moon, Package, Radio, Settings, Sparkles, Sun } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useShellOverview } from '@/features/system/use-shell-overview'
import { useTheme } from '@/features/theme/use-theme'
import { useLocale } from '@/features/locale/use-locale'
import { cn } from '@/lib/utils'

const navItemDefs = [
  { to: '/chat', label: 'Chat', descKey: 'nav.chatDesc', icon: MessageSquareText },
  { to: '/sessions', label: 'Sessions', descKey: 'nav.sessionsDesc', icon: History },
  { to: '/providers', label: 'Providers', descKey: 'nav.providersDesc', icon: Cable },
  { to: '/channels', label: 'Channels', descKey: 'nav.channelsDesc', icon: Radio },
  { to: '/agents', label: 'Agents', descKey: 'nav.agentsDesc', icon: Bot },
  { to: '/skills', label: 'Skills', descKey: 'nav.skillsDesc', icon: Package },
  { to: '/mcp', label: 'MCP', descKey: 'nav.mcpDesc', icon: Blocks },
  { to: '/cron', label: 'Cron', descKey: 'nav.cronDesc', icon: CalendarClock },
  { to: '/status', label: 'Status', descKey: 'nav.statusDesc', icon: Activity },
  { to: '/settings', label: 'Settings', descKey: 'nav.settingsDesc', icon: Settings },
] as const

const futureItems: string[] = []

const routeMetaKey: Record<string, string> = {
  '/chat': 'chat',
  '/sessions': 'sessions',
  '/agents': 'agents',
  '/channels': 'channels',
  '/providers': 'providers',
  '/mcp': 'mcp',
  '/skills': 'skills',
  '/status': 'status',
  '/cron': 'cron',
  '/settings': 'settings',
}

export function AppShell() {
  const location = useLocation()
  const { status, summary } = useShellOverview()
  const { preference, cycle } = useTheme()
  const { locale, toggle: toggleLocale } = useLocale()
  const { t } = useTranslation()

  const currentMeta = useMemo(() => {
    const key = routeMetaKey[location.pathname]
    if (key) {
      return {
        title: t(`pageMeta.${key}_title`),
        description: t(`pageMeta.${key}_desc`),
      }
    }
    return {
      title: t('pageMeta.default_title'),
      description: t('pageMeta.default_desc'),
    }
  }, [location.pathname, t])

  const themeIcon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor
  const ThemeIcon = themeIcon

  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent px-4 py-4 text-[var(--color-text-primary)]">
      <div className="grid h-[calc(100dvh-2rem)] min-h-0 gap-4 overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="glass-surface flex min-h-0 overflow-hidden flex-col px-3 py-4">
          <div className="border-b border-[var(--color-border-subtle)] px-2 pb-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)]">
                <Sparkles className="h-4.5 w-4.5 text-[var(--color-accent)]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Aurogen</p>
                <p className="text-[10px] tracking-[0.06em] tertiary-text">
                  Agent Ops Console
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mt-4 px-2">
            <p className="compact-eyebrow-text mb-2.5 text-[10px] uppercase tertiary-text">
              Main
            </p>
            <nav className="space-y-1.5">
              {navItemDefs.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition duration-[var(--duration-fast)]',
                        isActive
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                          : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div
                          className={cn(
                            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border transition',
                            isActive
                              ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                              : 'border-[var(--color-border-subtle)]/50 bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 transition-transform duration-150 group-hover:scale-110" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{item.label}</p>
                          <p className="mt-0.5 text-[11px] subtle-text">{t(item.descKey)}</p>
                        </div>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          {futureItems.length > 0 ? (
            <div className="mt-5 px-2">
              <p className="compact-eyebrow-text mb-2.5 text-[10px] uppercase tertiary-text">
                Later
              </p>
              <div className="space-y-1.5">
                {futureItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] px-4 py-2.5 text-[13px] subtle-text"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </div>
        </aside>

        <div className="flex min-h-0 overflow-hidden flex-col gap-4">
          <header className="glass-surface flex flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div>
              <p className="text-[11px] tracking-[0.06em] tertiary-text">
                {t('shell.currentWorkspace')}
              </p>
              <h1 className="mt-0.5 text-lg font-semibold text-[var(--color-text-primary)]">{currentMeta.title}</h1>
              <p className="mt-0.5 text-[13px] subtle-text">{currentMeta.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <HeaderBadge
                label="Channels"
                value={summary ? `${summary.channels_count} ${t('shell.configured')}` : t('shell.loading')}
              />
              <HeaderBadge
                label="App"
                value={status?.app ?? '...'}
              />
              <button
                type="button"
                onClick={toggleLocale}
                className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] transition-all duration-150 hover:scale-[1.08] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] hover:text-[var(--color-text-primary)]"
                aria-label={t('shell.switchLanguage')}
                title={t('shell.switchLanguage')}
              >
                {locale === 'en' ? '中' : 'EN'}
              </button>
              <button
                type="button"
                onClick={cycle}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-all duration-150 hover:scale-[1.08] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)] hover:text-[var(--color-text-primary)]"
                aria-label={t('shell.switchTheme')}
                title={t('shell.currentTheme', { preference })}
              >
                <ThemeIcon className="h-4 w-4" />
              </button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

function HeaderBadge({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-hover)] px-3.5 py-1.5 transition-all duration-150 hover:scale-[1.03] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-active)]">
      <span className="mr-2 text-[11px] tracking-[0.06em] tertiary-text">
        {label}
      </span>
      <span className="text-[12px] text-[var(--color-text-primary)]">{value}</span>
    </div>
  )
}
