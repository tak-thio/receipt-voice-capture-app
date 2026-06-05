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

export interface ClientDetail extends ClientRow {
  status: string
  entity_type: string | null
  t_number: string | null
  address: string | null
  phone: string | null
  contact_name: string | null
  fiscal_month: number | null
  industry: string | null
  memo: string | null
  staff_user_id: string | null
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
  sub_account_id?: string | null
}

export interface QueueItem {
  id: string
  vendor: string | null
  amount_jpy: number | null
  date: string | null
  source: string
  t_number: string | null
  image_file_id: string | null
  account_title_id: string | null
  partner_id: string | null
  suggestion: Suggestion
}
export interface JournalQueue {
  items: QueueItem[]
  total: number
  held_count: number
}

export const api = {
  me: () => req<Me>('/auth/me'),
  login: (email: string, password: string) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => req('/auth/logout', { method: 'POST' }),

  clients: () => req<ClientRow[]>('/clients'),
  createClient: (name: string, code?: string) =>
    req<{ id: string }>('/clients', { method: 'POST', body: JSON.stringify({ name, code }) }),
  client: (id: string) => req<ClientDetail>(`/clients/${id}`),
  patchClient: (id: string, patch: Partial<ClientDetail>) =>
    req<ClientDetail>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createClientUser: (clientId: string, body: { name: string; email?: string; phone?: string; role?: string }) =>
    req<{ user_id: string; email: string }>(`/clients/${clientId}/users`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  receipts: (clientId?: string, q?: string) => {
    const params = new URLSearchParams()
    if (clientId) params.set('client_id', clientId)
    if (q) params.set('q', q)
    const qs = params.toString()
    return req<ReceiptRow[]>(`/receipts${qs ? `?${qs}` : ''}`)
  },
  patchReceipt: (id: string, patch: Partial<ReceiptRow>) =>
    req<ReceiptRow>(`/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  journalQueue: (clientId?: string, view: 'queue' | 'held' = 'queue') => {
    const params = new URLSearchParams({ view })
    if (clientId) params.set('client_id', clientId)
    return req<JournalQueue>(`/journal/queue?${params.toString()}`)
  },
  suggest: (receiptId: string) => req<Suggestion>(`/journal/suggest/${receiptId}`),
  journalize: (
    receiptId: string,
    body: { account_title_id?: string | null; sub_account_id?: string | null; partner_id?: string | null },
  ) => req(`/journal/receipts/${receiptId}`, { method: 'POST', body: JSON.stringify(body) }),
  hold: (receiptId: string) => req(`/journal/receipts/${receiptId}/hold`, { method: 'POST' }),
  unhold: (receiptId: string) => req(`/journal/receipts/${receiptId}/unhold`, { method: 'POST' }),
  setApproval: (receiptId: string, status: string) =>
    req(`/receipts/${receiptId}`, { method: 'PATCH', body: JSON.stringify({ approval_status: status }) }),

  fileUrl: (fileId: string) => `${BASE}/files/${fileId}`,

  accountTitles: (clientId?: string) =>
    req<MasterRow[]>(`/masters/account-titles${clientId ? `?client_id=${clientId}` : ''}`),
  createAccountTitle: (body: { firm_id: string; client_id?: string | null; code: string; name: string }) =>
    req<{ id: string }>('/masters/account-titles', { method: 'POST', body: JSON.stringify(body) }),
  partners: (clientId?: string) =>
    req<MasterRow[]>(`/masters/partners${clientId ? `?client_id=${clientId}` : ''}`),
  createPartner: (body: { firm_id: string; client_id: string; name: string; domain?: string }) =>
    req<{ id: string }>('/masters/partners', { method: 'POST', body: JSON.stringify(body) }),

  issuePairing: (clientId: string, userId?: string) =>
    req<{ token: string; qr_png_base64: string; expires_in_min: number }>('/pairing/issue', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, user_id: userId }),
    }),

  // --- firm settings / AI config ---
  firm: () => req<FirmInfo>('/firm'),
  patchFirm: (name: string) =>
    req('/firm', { method: 'PATCH', body: JSON.stringify({ name }) }),
  setAiConfig: (cfg: AiConfigPatch) =>
    req<{ ai_config: FirmInfo['ai_config'] }>('/firm/ai-config', {
      method: 'PATCH',
      body: JSON.stringify(cfg),
    }),

  // --- firm staff / members ---
  members: () => req<MemberRow[]>('/members'),
  setMemberRole: (userId: string, role: string) =>
    req(`/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (userId: string) => req(`/members/${userId}`, { method: 'DELETE' }),

  // --- client users ---
  clientUsers: (clientId: string) => req<MemberRow[]>(`/clients/${clientId}/users`),
  setClientUserRole: (clientId: string, userId: string, role: string) =>
    req(`/clients/${clientId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeClientUser: (clientId: string, userId: string) =>
    req(`/clients/${clientId}/users/${userId}`, { method: 'DELETE' }),

  // --- invites ---
  invites: () => req<InviteRow[]>('/invites'),
  createInvite: (body: { role: string; client_id?: string; email?: string }) =>
    req<{ token: string; redeem_path: string }>('/invites', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeInvite: (id: string) => req(`/invites/${id}`, { method: 'DELETE' }),
  redeemInvite: (body: { token: string; email: string; password: string; name: string }) =>
    req<{ user_id: string }>('/invites/redeem', { method: 'POST', body: JSON.stringify(body) }),

  exportUrl: (clientId: string, format: string) =>
    `${BASE}/export?client_id=${clientId}&format=${format}`,
}

export interface FirmInfo {
  id: string
  name: string
  plan: string
  ai_config: Record<string, { provider: string; model: string | null; key_set: boolean }>
}
export interface MemberRow {
  user_id: string
  email: string
  name: string
  role: string
}
export interface InviteRow {
  id: string
  role: string
  client_id: string | null
  email: string | null
  expires_at: string
}
export interface AiConfigPatch {
  stt?: { provider: string; key?: string; model?: string }
  ocr?: { provider: string; key?: string; model?: string }
  format?: { provider: string; key?: string; model?: string }
}
