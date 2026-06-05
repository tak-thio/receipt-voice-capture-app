// Single-origin API client. Caddy serves the SPA and proxies /api -> FastAPI.
const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`)
  }
  // Some endpoints (logout) return no JSON body.
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export interface Membership {
  firm_id: string
  client_id: string | null
  role: string
}
export interface Me {
  user: { id: string; email: string; name: string }
  memberships: Membership[]
}

export interface ClientRow {
  id: string
  name: string
  code: string | null
  export_default: string
}

export interface ReceiptRow {
  id: string
  client_id: string
  source: string
  captured_at: string | null
  vendor: string | null
  amount_jpy: number | null
  tax_mode: string | null
  payment_method: string | null
  t_number: string | null
  account_title_id: string | null
  approval_status: string
  journalized_at: string | null
}

export interface MasterRow {
  id: string
  code: string | null
  name: string
  scope?: string
  domain?: string | null
}

export interface Suggestion {
  partner_id: string | null
  account_title_id: string | null
  sub_account_id: string | null
}

export const api = {
  me: () => req<Me>('/auth/me'),
  login: (email: string, password: string) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req('/auth/logout', { method: 'POST' }),

  clients: () => req<ClientRow[]>('/clients'),
  createClient: (name: string, code?: string) =>
    req<{ id: string }>('/clients', { method: 'POST', body: JSON.stringify({ name, code }) }),

  receipts: (clientId?: string, q?: string) => {
    const params = new URLSearchParams()
    if (clientId) params.set('client_id', clientId)
    if (q) params.set('q', q)
    const qs = params.toString()
    return req<ReceiptRow[]>(`/receipts${qs ? `?${qs}` : ''}`)
  },
  patchReceipt: (id: string, patch: Partial<ReceiptRow>) =>
    req<ReceiptRow>(`/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  journalQueue: (clientId?: string) =>
    req<{ id: string; vendor: string | null; amount_jpy: number | null }[]>(
      `/journal/queue${clientId ? `?client_id=${clientId}` : ''}`,
    ),
  suggest: (receiptId: string) => req<Suggestion>(`/journal/suggest/${receiptId}`),
  journalize: (
    receiptId: string,
    body: { account_title_id?: string | null; sub_account_id?: string | null; partner_id?: string | null },
  ) => req(`/journal/receipts/${receiptId}`, { method: 'POST', body: JSON.stringify(body) }),
  hold: (receiptId: string) => req(`/journal/receipts/${receiptId}/hold`, { method: 'POST' }),

  accountTitles: (clientId?: string) =>
    req<MasterRow[]>(`/masters/account-titles${clientId ? `?client_id=${clientId}` : ''}`),
  createAccountTitle: (body: { firm_id: string; client_id?: string | null; code: string; name: string }) =>
    req<{ id: string }>('/masters/account-titles', { method: 'POST', body: JSON.stringify(body) }),
  partners: (clientId?: string) =>
    req<MasterRow[]>(`/masters/partners${clientId ? `?client_id=${clientId}` : ''}`),
  createPartner: (body: { firm_id: string; client_id: string; name: string; domain?: string }) =>
    req<{ id: string }>('/masters/partners', { method: 'POST', body: JSON.stringify(body) }),

  issuePairing: (clientId: string, name?: string) =>
    req<{ token: string; qr_png_base64: string; expires_in_min: number }>('/pairing/issue', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, name }),
    }),

  exportUrl: (clientId: string, format: string) =>
    `${BASE}/export?client_id=${clientId}&format=${format}`,
}
