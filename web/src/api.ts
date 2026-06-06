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
  status?: string
  entity_type?: string | null
  fiscal_month?: number | null
  industry?: string | null
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
  note_ids: string[]
}

export interface NoteRow {
  id: string
  text: string
  color: string
}

export interface MasterRow {
  id: string
  code: string | null
  name: string
  scope?: string
  domain?: string | null
  sub_account_count?: number
}

export interface SubAccountRow {
  id: string
  code: string | null
  name: string
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
  note_ids: string[]
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

  clients: (q?: string, includeArchived = false) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (includeArchived) params.set('include_archived', 'true')
    const qs = params.toString()
    return req<ClientRow[]>(`/clients${qs ? `?${qs}` : ''}`)
  },
  createClient: (body: Partial<ClientDetail> & { name: string }) =>
    req<{ id: string }>('/clients', { method: 'POST', body: JSON.stringify(body) }),
  client: (id: string) => req<ClientDetail>(`/clients/${id}`),
  patchClient: (id: string, patch: Partial<ClientDetail>) =>
    req<ClientDetail>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteClient: (id: string) => req(`/clients/${id}`, { method: 'DELETE' }),
  createClientUser: (
    clientId: string,
    body: { name: string; email?: string; phone?: string; job_title?: string; role?: string; password?: string },
  ) =>
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
  patchAccountTitle: (id: string, patch: { code?: string; name?: string; sort_order?: number }) =>
    req(`/masters/account-titles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAccountTitle: (id: string) =>
    req(`/masters/account-titles/${id}`, { method: 'DELETE' }),
  subAccounts: (titleId: string) =>
    req<SubAccountRow[]>(`/masters/account-titles/${titleId}/sub-accounts`),
  createSubAccount: (titleId: string, body: { code: string; name: string }) =>
    req<{ id: string }>(`/masters/account-titles/${titleId}/sub-accounts`, { method: 'POST', body: JSON.stringify(body) }),
  patchSubAccount: (id: string, patch: { code?: string; name?: string }) =>
    req(`/masters/sub-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSubAccount: (id: string) =>
    req(`/masters/sub-accounts/${id}`, { method: 'DELETE' }),
  partners: (clientId?: string) =>
    req<MasterRow[]>(`/masters/partners${clientId ? `?client_id=${clientId}` : ''}`),
  createPartner: (body: { firm_id: string; client_id: string; name: string; domain?: string }) =>
    req<{ id: string }>('/masters/partners', { method: 'POST', body: JSON.stringify(body) }),
  patchPartner: (id: string, patch: { name?: string; code?: string; domain?: string }) =>
    req(`/masters/partners/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePartner: (id: string) => req(`/masters/partners/${id}`, { method: 'DELETE' }),

  // --- 付箋 (notes) ---
  notes: (clientId?: string) =>
    req<NoteRow[]>(`/masters/notes${clientId ? `?client_id=${clientId}` : ''}`),
  createNote: (body: { firm_id: string; client_id: string; text: string; color: string }) =>
    req<{ id: string }>('/masters/notes', { method: 'POST', body: JSON.stringify(body) }),
  patchNote: (id: string, patch: { text?: string; color?: string }) =>
    req(`/masters/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteNote: (id: string) => req(`/masters/notes/${id}`, { method: 'DELETE' }),
  setReceiptNotes: (receiptId: string, noteIds: string[]) =>
    req(`/receipts/${receiptId}`, { method: 'PATCH', body: JSON.stringify({ note_ids: noteIds }) }),

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
  createMember: (body: { name: string; email: string; password: string; role: string }) =>
    req<{ user_id: string }>('/members', { method: 'POST', body: JSON.stringify(body) }),
  patchMember: (
    userId: string,
    patch: { role?: string; name?: string; email?: string; password?: string },
  ) => req(`/members/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  setMemberRole: (userId: string, role: string) =>
    req(`/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (userId: string) => req(`/members/${userId}`, { method: 'DELETE' }),
  assignedClients: (userId: string) =>
    req<{ client_ids: string[] }>(`/members/${userId}/clients`),
  setAssignedClients: (userId: string, clientIds: string[]) =>
    req(`/members/${userId}/clients`, { method: 'PUT', body: JSON.stringify({ client_ids: clientIds }) }),

  // --- client users ---
  clientUsers: (clientId: string) => req<MemberRow[]>(`/clients/${clientId}/users`),
  setClientUserRole: (clientId: string, userId: string, role: string) =>
    req(`/clients/${clientId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  patchClientUser: (
    clientId: string,
    userId: string,
    patch: { role?: string; status?: string; name?: string; phone?: string; job_title?: string; email?: string; password?: string },
  ) => req(`/clients/${clientId}/users/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
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
  ledgerUrl: (clientId: string, from?: string, to?: string) => {
    const p = new URLSearchParams({ client_id: clientId })
    if (from) p.set('date_from', from)
    if (to) p.set('date_to', to)
    return `${BASE}/export/ledger?${p.toString()}`
  },
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
  phone?: string | null
  job_title?: string | null
  status?: string
  login_id?: string | null
  password_set?: boolean
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
