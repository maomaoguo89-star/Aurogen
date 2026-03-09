const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'

export const AUTH_STORAGE_KEY = 'aurogen_auth_key'

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL !== undefined
    ? import.meta.env.VITE_API_BASE_URL
    : DEFAULT_API_BASE_URL
).replace(/\/$/, '')

function extractErrorMessage(payload: unknown, status: number) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload
  }

  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = payload.detail

    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }

    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = detail.message
      if (typeof message === 'string' && message.trim()) {
        return message
      }
    }
  }

  return `请求失败（${status}）`
}

export function createApiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

export function getAuthKey(): string {
  return localStorage.getItem(AUTH_STORAGE_KEY) || ''
}

export type FetchOptions = RequestInit & { skipAuth?: boolean }

export async function fetchJson<T>(path: string, init?: FetchOptions): Promise<T> {
  const headers = new Headers(init?.headers)

  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (!init?.skipAuth) {
    headers.set('X-Auth-Key', getAuthKey())
  }

  const response = await fetch(createApiUrl(path), {
    ...init,
    headers,
  })

  let payload: unknown = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('aurogen:auth-failed'))
    }
    throw new Error(extractErrorMessage(payload, response.status))
  }

  return payload as T
}

export async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(createApiUrl(path), {
    method: 'POST',
    headers: { 'X-Auth-Key': getAuthKey() },
    body: formData,
  })

  let payload: unknown = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('aurogen:auth-failed'))
    }
    throw new Error(extractErrorMessage(payload, response.status))
  }

  return payload as T
}
