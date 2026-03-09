import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import i18n from '@/lib/i18n'

export type ShellChannelStatus = {
  name: string
  type: string
  running: boolean
}

export type SystemStatus = {
  app: string
  agent_loop_running: boolean
  heartbeat: {
    running: boolean
    agent_name: string
    interval_s: number
    enabled: boolean
  }
  cron: {
    running: boolean
    agent_name: string
    enabled: boolean
  }
  channels: ShellChannelStatus[]
  mcp: {
    configured: number
    loaded_count: number
    loaded_tools: string[]
  }
}

export type ResourceSummary = {
  agents_count: number
  channels_count: number
  providers_count: number
  sessions_count: number
}

export function useShellOverview() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [summary, setSummary] = useState<ResourceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function loadOverview() {
      try {
        const [nextStatus, nextSummary] = await Promise.all([
          fetchJson<SystemStatus>('/system/status'),
          fetchJson<ResourceSummary>('/resources/summary'),
        ])

        if (!alive) {
          return
        }

        setStatus(nextStatus)
        setSummary(nextSummary)
        setError(null)
      } catch (loadError) {
        if (!alive) {
          return
        }

        const message =
          loadError instanceof Error ? loadError.message : i18n.t('system.loadFailed')
        setError(message)
      }
    }

    void loadOverview()

    return () => {
      alive = false
    }
  }, [])

  return { status, summary, error }
}
