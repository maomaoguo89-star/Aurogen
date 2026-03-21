import { useState } from 'react'
import { Activity, Blocks, Brain, BrainCircuit, CalendarClock, Cat, History, MessageSquareText, Package, Radio, Settings, PanelLeftClose } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const navItemDefs = [
  { to: '/chat', label: 'Chat', descKey: 'nav.chatDesc', icon: MessageSquareText },
  { to: '/groups', label: 'Groups', descKey: 'nav.groupsDesc', icon: BrainCircuit },
  { to: '/brains', label: 'Brains', descKey: 'nav.brainsDesc', icon: Brain },
  { to: '/claws', label: 'Claws', descKey: 'nav.clawsDesc', icon: Cat },
  { to: '/channels', label: 'Channels', descKey: 'nav.channelsDesc', icon: Radio },
  { to: '/skills', label: 'Skills', descKey: 'nav.skillsDesc', icon: Package },
  { to: '/cron', label: 'Cron', descKey: 'nav.cronDesc', icon: CalendarClock },
  { to: '/mcp', label: 'MCP', descKey: 'nav.mcpDesc', icon: Blocks },
  { to: '/sessions', label: 'Sessions', descKey: 'nav.sessionsDesc', icon: History },
  { to: '/status', label: 'Status', descKey: 'nav.statusDesc', icon: Activity },
  { to: '/settings', label: 'Settings', descKey: 'nav.settingsDesc', icon: Settings },
] as const

const futureItems: string[] = []

export function AppShell() {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent px-3 py-3 text-[var(--color-text-primary)]">
      <div
        className={cn(
          'grid h-[calc(100dvh-1.5rem)] min-h-0 gap-3 overflow-hidden transition-[grid-template-columns] duration-300 ease-[var(--ease-emphasis)]',
          collapsed
            ? 'grid-cols-[56px_minmax(0,1fr)]'
            : 'grid-cols-[220px_minmax(0,1fr)]',
        )}
      >
        <aside className="glass-surface flex min-h-0 overflow-hidden flex-col px-2.5 py-3">
          {/* Logo row with collapse toggle */}
          <div className="border-b border-[var(--color-border-subtle)] pb-2 mb-2 shrink-0">
            <div className="flex items-center gap-2 overflow-hidden">
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-accent-soft)] transition hover:bg-[var(--color-bg-hover)] cursor-pointer"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <span className="text-base leading-none">🍊</span>
              </button>
              <div className={cn(
                'min-w-0 flex-1 overflow-hidden transition-opacity duration-300',
                collapsed ? 'opacity-0' : 'opacity-100',
              )}>
                <p className="text-sm font-semibold text-[var(--color-text-primary)] whitespace-nowrap">Aurogen</p>
                <p className="text-[10px] tracking-[0.06em] tertiary-text whitespace-nowrap">
                  Agent Ops Console
                </p>
              </div>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                  'shrink-0 flex items-center justify-center rounded-[var(--radius-sm)] transition tertiary-text hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer h-7 w-7',
                  collapsed ? 'opacity-0 pointer-events-none w-0 overflow-hidden' : 'opacity-100',
                )}
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Nav */}
          <div className="flex-1 min-h-0 overflow-y-auto scroll-area">
            <div>
              <p className={cn(
                'compact-eyebrow-text text-[10px] uppercase tertiary-text overflow-hidden whitespace-nowrap transition-all duration-300',
                collapsed ? 'h-0 mb-0 opacity-0' : 'h-4 mb-1.5 opacity-100',
              )}>
                Main
              </p>
              <nav className={cn('space-y-1', collapsed && 'flex flex-col items-center')}>
                {navItemDefs.map((item) => {
                  const Icon = item.icon

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center overflow-hidden rounded-[var(--radius-sm)] border transition-all duration-200',
                          collapsed
                            ? cn(
                                'h-9 w-9 justify-center p-0',
                                isActive
                                  ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                                  : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]',
                              )
                            : cn(
                                'gap-2.5 px-2.5 py-2',
                                isActive
                                  ? 'border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]'
                                  : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]',
                              ),
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div
                            className={cn(
                              'flex shrink-0 items-center justify-center rounded-[var(--radius-xs)] border transition',
                              collapsed ? 'h-auto w-auto border-transparent' : 'h-7 w-7',
                              !collapsed && (isActive
                                ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                                : 'border-[var(--color-border-subtle)]/50 bg-[var(--color-bg-hover)]/50 text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'),
                            )}
                          >
                            <Icon className={cn('transition-transform duration-150 group-hover:scale-110', collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5')} />
                          </div>
                          <div className={cn(
                            'min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-300',
                            collapsed ? 'w-0 opacity-0' : 'opacity-100',
                          )}>
                            <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{item.label}</p>
                            <p className="text-[11px] subtle-text">{t(item.descKey)}</p>
                          </div>
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </nav>
            </div>

            {futureItems.length > 0 ? (
              <div className={cn('mt-3', collapsed && 'hidden')}>
                <p className="compact-eyebrow-text mb-1.5 text-[10px] uppercase tertiary-text">
                  Later
                </p>
                <div className="space-y-0.5">
                  {futureItems.map((item) => (
                    <div
                      key={item}
                      className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border-subtle)] px-2 py-1.5 text-[13px] subtle-text"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
