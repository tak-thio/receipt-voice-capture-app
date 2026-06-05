// Single-origin API client. Caddy serves the SPA and proxies /api -> FastAPI.
const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface Me {
  user: { id: string; email: string; name: string }
  memberships: { firm_id: string; client_id: string | null; role: string }[]
}

export interface ReceiptRow {
  id: string
  vendor: string | null
  amount_jpy: number | null
  approval_status: string
}

export const api = {
  me: () => req<Me>('/auth/me'),
  login: (email: string, password: string) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req('/auth/logout', { method: 'POST' }),
  receipts: (clientId?: string) =>
    req<ReceiptRow[]>(`/receipts${clientId ? `?client_id=${clientId}` : ''}`),
}
