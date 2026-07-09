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
  org_name?: string | null // 自分の組織名（事務所メンバーは事務所名、顧問先メンバーは自社名）
}

export interface ClientRow {
  id: string
  name: string
  code: string | null
  export_default: string
  status?: string
  entity_type?: string | null
  fiscal_month?: number | null
  closing_date?: string | null // 締め日(YYYY-MM-DD): この日付以前の領収書は期間外警告
  expense_enabled?: boolean // 経費精算機能のON/OFF
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
  closing_date: string | null
  expense_enabled: boolean
  expense_credit_account_title_id: string | null
  industry: string | null
  memo: string | null
  staff_user_id: string | null
  ai_config?: FirmInfo['ai_config'] // masked (key_set only); per-client AI provider override
}

export interface ReceiptRow {
  id: string
  client_id: string
  source: string
  lane?: string // 'company'(会社経費) | 'expense'(立替経費)
  match_id?: string | null // 突き合わせ(重複)グループID。同一なら受信箱でグルーピング表示
  captured_at: string | null
  vendor: string | null
  amount_jpy: number | null
  tax_mode: string | null
  payment_method: string | null
  t_number: string | null
  description: string | null // 摘要
  memo?: string | null // 自由メモ(ファイル名/ページ/音声を初期値、編集可)
  account_title_id: string | null
  approval_status: string
  journalized_at: string | null
  note_ids: string[]
  image_file_id?: string | null // 代表画像(images の先頭)
  image_mime?: string | null
  images?: { file_id: string; mime: string | null }[] // capture画像(複数=マージで束ねた明細+鏡)
  page?: number | null // PDFの何ページ目由来か(プレビューを ?page=N で出す)
  created_by_name?: string | null
  parse_failed?: boolean // AIが請求書として認識できなかった(店舗名も金額も取れず)
  card_batch?: { count: number; short_id: string } | null // クレジット明細の取込バッチ(塊)。あれば行はバッチ要約
}

// 登録者向け: AI が読み取った「領収書の中身」だけを修正する（科目・仕訳には触れない）。
export interface ReceiptContentPatch {
  vendor?: string | null
  date?: string | null // YYYY-MM-DD（領収書の日付 = captured_at）
  amount_jpy?: number | null
  tax_mode?: string | null
  payment_method?: string | null
  t_number?: string | null
  description?: string | null // 摘要
  memo?: string | null // 自由メモ
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
  t_number?: string | null // 取引先のインボイス登録番号
  sub_account_count?: number
  pinned_debit?: boolean
  pinned_credit?: boolean
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
  parse_failed?: boolean // AIが請求書として認識できなかった(店舗名も金額も取れず)
  created_by_name: string | null
  amount_jpy: number | null
  subtotal_jpy: number | null
  tax_jpy: number | null
  tax_10_jpy: number | null
  tax_8_jpy: number | null
  date: string | null
  source: string
  t_number: string | null
  description: string | null // 摘要
  memo?: string | null // 自由メモ
  image_file_id: string | null
  image_mime: string | null
  images?: { file_id: string; mime: string | null }[] // 統合伝票=束ねた明細+鏡の全画像
  page?: number | null // PDFの何ページ目由来か
  tax_mode: string | null
  payment_method: string | null
  account_title_id: string | null
  credit_account_title_id: string | null
  sub_account_id: string | null
  partner_id: string | null
  partner_name: string | null // 取引先(自由入力)
  note_ids: string[]
  suggestion: Suggestion
}
export interface JournalQueue {
  items: QueueItem[]
  total: number
  held_count: number
}

// 監査ログ(訂正削除・承認・仕訳の履歴)の1件。電子帳簿保存法の訂正削除履歴。
export interface AuditEntry {
  id: string
  action: string // updated | deleted | journalized | ...
  actor: string | null
  summary: string | null
  changes: Record<string, { before: unknown; after: unknown }> | null
  at: string | null
}

// 経費精算
export interface ExpenseClaimItem {
  receipt_id: string
  vendor: string | null
  amount_jpy: number | null
  date: string | null
  account_title_id?: string | null // 借方(費用)科目の現在値
  suggested_account_title_id?: string | null // 承認画面プリフィル用のAIサジェスト
}
export interface ExpenseClaim {
  id: string
  title: string | null
  status: string // draft | submitted | approved | rejected | withdrawn
  applicant: string | null
  applicant_user_id: string | null
  approver: string | null
  reject_reason: string | null
  decided_at: string | null
  created_at: string | null
  item_count: number
  total_jpy: number
  items: ExpenseClaimItem[]
}

// クレジット明細の各行 + 紐づく領収書の有無(網羅チェック)。
export interface CardStatementLine {
  id: string
  date: string | null
  vendor: string | null
  amount_jpy: number | null
  has_receipt: boolean
  receipt_id: string | null
  image_file_id?: string | null
  image_mime?: string | null
  dup_key?: string | null // 同一なら重複グループ(本体のid)。null=単独
  is_dup?: boolean // true=重複候補(削除してよい)
}
export interface CardStatementList {
  items: CardStatementLine[]
  total: number
  missing: number // 領収書が見つからない明細の件数
  dup_total: number // 重複候補の件数
}

// 元帳 (ledger) = 仕分け済みの仕訳一覧。借方/貸方/取引先は解決済みの表示文字列。
export interface LedgerRow {
  id: string
  date: string | null // 取引日 (領収書の日付)
  journalized_at: string | null
  vendor: string | null
  partner: string | null
  partner_name: string | null // 取引先(自由入力)
  debit: string | null // 借方科目 "code name"
  credit: string | null // 貸方科目 "code name"
  amount_jpy: number | null
  tax_jpy: number | null
  t_number: string | null
  description: string | null // 摘要
  memo?: string | null // 自由メモ
  // 直接編集（仕分けと同じ画面）用の生の値。
  account_title_id: string | null
  credit_account_title_id: string | null
  sub_account_id: string | null
  partner_id: string | null
  subtotal_jpy: number | null
  tax_10_jpy: number | null
  tax_8_jpy: number | null
  tax_mode: string | null
  payment_method: string | null
  source: string | null
  image_file_id: string | null
  image_mime: string | null
  images?: { file_id: string; mime: string | null }[] // 統合伝票=束ねた明細+鏡の全画像
  page?: number | null // PDFの何ページ目由来か
  note_ids: string[]
}

// メール取込の領収書の元メール(本文表示用)。
export interface ReceiptEmail {
  subject: string | null
  from_addr: string | null
  account: string | null
  date: string | null
  html: string | null
  text: string | null
}

// メール連携(Gmail) — 顧問先に紐付いたメールボックス。
export interface GmailAccountRow {
  id: string
  email: string
  active: boolean
  auth_type: string
  scopes: string
  has_refresh_token: boolean
  last_synced_at: string | null
  connected_at: string | null
}

// 仕訳/元帳編集の共通ボディ。
export interface JournalizeBody {
  account_title_id?: string | null
  credit_account_title_id?: string | null
  sub_account_id?: string | null
  partner_id?: string | null
  partner_name?: string | null // 取引先(自由入力)。マスタ完全一致でサーバが自動引当
  vendor?: string | null
  date?: string | null // YYYY-MM-DD (領収書の日付)
  amount_jpy?: number | null
  subtotal_jpy?: number | null
  tax_jpy?: number | null
  tax_10_jpy?: number | null
  tax_8_jpy?: number | null
  tax_mode?: string | null
  payment_method?: string | null
  t_number?: string | null
  description?: string | null // 摘要
  memo?: string | null // 自由メモ
}

export interface ReconcileItem {
  id: string
  doc_type: string // 'receipt' | 'card_statement'
  source: string
  date: string | null
  vendor: string | null
  partner: string | null // 取引先(表示)
  amount_jpy: number | null
  t_number: string | null
  journalized_at: string | null
  image_file_id: string | null
  image_mime: string | null
}
// 自動でまとめられた同一取引のグループ: primary=残す親, duplicates=自動重複の子。
export interface ReconcileGroup {
  match_id: string
  primary: ReconcileItem
  duplicates: ReconcileItem[]
}
export interface ReconcileState {
  groups: ReconcileGroup[]
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
  // Per-client AI provider keys (write-only; GET returns masked key_set only).
  setClientAiConfig: (clientId: string, cfg: AiConfigPatch) =>
    req<{ ai_config: FirmInfo['ai_config'] }>(`/clients/${clientId}/ai-config`, {
      method: 'PATCH',
      body: JSON.stringify(cfg),
    }),
  deleteClient: (id: string) => req(`/clients/${id}`, { method: 'DELETE' }),
  createClientUser: (
    clientId: string,
    body: { name: string; email?: string; phone?: string; job_title?: string; role?: string; password?: string },
  ) =>
    req<{ user_id: string; email: string }>(`/clients/${clientId}/users`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  receipts: (
    clientId?: string,
    q?: string,
    filters?: { dateFrom?: string; dateTo?: string; amountMin?: string; amountMax?: string; lane?: string },
  ) => {
    const params = new URLSearchParams()
    if (clientId) params.set('client_id', clientId)
    if (q) params.set('q', q)
    if (filters?.lane) params.set('lane', filters.lane) // company(受信箱) | expense(立替トレイ)
    if (filters?.dateFrom) params.set('date_from', filters.dateFrom)
    if (filters?.dateTo) params.set('date_to', filters.dateTo)
    if (filters?.amountMin) params.set('amount_min', filters.amountMin)
    if (filters?.amountMax) params.set('amount_max', filters.amountMax)
    const qs = params.toString()
    return req<ReceiptRow[]>(`/receipts${qs ? `?${qs}` : ''}`)
  },
  patchReceipt: (id: string, patch: Partial<ReceiptRow>) =>
    req<ReceiptRow>(`/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // 登録者が AI の読み取り内容を修正する（承認前の自分の領収書のみ。サーバ側で権限/状態を判定）。
  editReceiptContent: (id: string, patch: ReceiptContentPatch) =>
    req<ReceiptRow>(`/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteReceipt: (id: string) => req(`/receipts/${id}`, { method: 'DELETE' }),
  // 明細+鏡など「1支払いに画像複数」を統合伝票1件に束ねる。values=各項目の採用値(選択/編集)。
  mergeReceipts: (sourceIds: string[], values: Record<string, unknown>) =>
    req<ReceiptRow>('/receipts/merge', {
      method: 'POST',
      body: JSON.stringify({ source_ids: sourceIds, values }),
    }),
  // 統合伝票をばらす: 束ねた元を復元し、統合伝票を削除。
  unmergeReceipts: (voucherId: string) =>
    req<{ unmerged: number }>('/receipts/unmerge', {
      method: 'POST',
      body: JSON.stringify({ voucher_id: voucherId }),
    }),
  // メール取込の元メール本文(件名/差出人/本文)。
  receiptEmail: (id: string) => req<ReceiptEmail>(`/receipts/${id}/email`),
  // 監査ログ(訂正削除・承認・仕訳の履歴)。電子帳簿保存法の訂正削除履歴。
  receiptHistory: (id: string) => req<AuditEntry[]>(`/receipts/${id}/history`),
  // --- 経費精算 ---
  expenseClaims: (clientId: string, statusFilter?: string) =>
    req<ExpenseClaim[]>(`/expense/claims?client_id=${clientId}${statusFilter ? `&status_filter=${statusFilter}` : ''}`),
  expenseClaim: (id: string) => req<ExpenseClaim>(`/expense/claims/${id}`),
  createExpenseClaim: (clientId: string, body: { title?: string | null; receipt_ids: string[] }) =>
    req<ExpenseClaim>(`/expense/claims?client_id=${clientId}`, { method: 'POST', body: JSON.stringify(body) }),
  updateExpenseClaim: (id: string, body: { title?: string | null; receipt_ids: string[] }) =>
    req<ExpenseClaim>(`/expense/claims/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  submitExpenseClaim: (id: string) => req<{ status: string }>(`/expense/claims/${id}/submit`, { method: 'POST' }),
  withdrawExpenseClaim: (id: string) => req<{ status: string }>(`/expense/claims/${id}/withdraw`, { method: 'POST' }),
  // 承認=記帳: 各領収書の借方科目を確定して送る(貸方=未払金はサーバ側で既定付与)。
  approveExpenseClaim: (
    id: string,
    items: { receipt_id: string; account_title_id: string | null }[],
  ) =>
    req<{ status: string; journalized: number }>(`/expense/claims/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  rejectExpenseClaim: (id: string, reason: string) =>
    req<{ status: string }>(`/expense/claims/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  // Web upload (multipart) — a logged-in user adds a receipt image/PDF to a client.
  uploadReceipt: async (clientId: string, file: File, audio?: File) => {
    const fd = new FormData()
    fd.append('client_id', clientId)
    fd.append('image', file)
    if (audio) fd.append('audio', audio)
    const res = await fetch(`${BASE}/captures/web`, { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    return (await res.json()) as { receipt_id: string; status: string }
  },

  // --- クレジット明細(専用取込＋領収書の網羅チェック) ---
  cardStatements: (clientId: string) =>
    req<CardStatementList>(`/card-statements?client_id=${clientId}`),
  // クレジット明細の取込バッチ(塊)を一括削除。
  deleteCardBatch: (batchId: string) =>
    req<{ deleted: number }>(`/card-statements/batch/${batchId}`, { method: 'DELETE' }),
  importCardStatement: async (clientId: string, file: File) => {
    const fd = new FormData()
    fd.append('client_id', clientId)
    fd.append('file', file)
    const res = await fetch(`${BASE}/card-statements/import`, { method: 'POST', credentials: 'include', body: fd })
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    return (await res.json()) as { status: string }
  },

  journalQueue: (clientId?: string, view: 'queue' | 'held' = 'queue') => {
    const params = new URLSearchParams({ view })
    if (clientId) params.set('client_id', clientId)
    return req<JournalQueue>(`/journal/queue?${params.toString()}`)
  },
  ledger: (clientId?: string) =>
    req<LedgerRow[]>(`/journal/ledger${clientId ? `?client_id=${clientId}` : ''}`),
  // 元帳(仕分け済)の1件を直接修正。仕訳日時は維持される。
  updateLedger: (receiptId: string, body: JournalizeBody) =>
    req(`/journal/ledger/${receiptId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  suggest: (receiptId: string) => req<Suggestion>(`/journal/suggest/${receiptId}`),
  journalize: (receiptId: string, body: JournalizeBody) =>
    req(`/journal/receipts/${receiptId}`, { method: 'POST', body: JSON.stringify(body) }),
  hold: (receiptId: string) => req(`/journal/receipts/${receiptId}/hold`, { method: 'POST' }),
  unhold: (receiptId: string) => req(`/journal/receipts/${receiptId}/unhold`, { method: 'POST' }),
  setApproval: (receiptId: string, status: string) =>
    req(`/receipts/${receiptId}`, { method: 'PATCH', body: JSON.stringify({ approval_status: status }) }),

  // 突き合わせ (自動重複): 同じ取引を自動でまとめて表示。子を外す/戻すだけ人が操作。
  reconcile: (clientId: string) => req<ReconcileState>(`/reconcile?client_id=${clientId}`),
  notDuplicate: (receiptId: string) =>
    req<{ ok: boolean }>('/reconcile/not-duplicate', {
      method: 'POST',
      body: JSON.stringify({ receipt_id: receiptId }),
    }),
  remerge: (receiptId: string) =>
    req<{ ok: boolean }>('/reconcile/remerge', {
      method: 'POST',
      body: JSON.stringify({ receipt_id: receiptId }),
    }),

  fileUrl: (fileId: string, page?: number | null) =>
    `${BASE}/files/${fileId}${page ? `?page=${page}` : ''}`,
  // Renderable image for any file (images pass through; PDFs are rendered to PNG).
  previewUrl: (fileId: string, page?: number | null) =>
    `${BASE}/files/${fileId}/preview${page ? `?page=${page}` : ''}`,

  accountTitles: (clientId?: string) =>
    req<MasterRow[]>(`/masters/account-titles${clientId ? `?client_id=${clientId}` : ''}`),
  createAccountTitle: (body: { firm_id: string; client_id?: string | null; code: string; name: string }) =>
    req<{ id: string }>('/masters/account-titles', { method: 'POST', body: JSON.stringify(body) }),
  patchAccountTitle: (
    id: string,
    patch: {
      code?: string
      name?: string
      sort_order?: number
      pinned_debit?: boolean
      pinned_credit?: boolean
    },
  ) => req(`/masters/account-titles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
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
  createPartner: (body: { firm_id: string; client_id: string; name: string; code?: string; t_number?: string; domain?: string }) =>
    req<{ id: string }>('/masters/partners', { method: 'POST', body: JSON.stringify(body) }),
  patchPartner: (id: string, patch: { name?: string; code?: string; t_number?: string; domain?: string }) =>
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
  // 本人が自分のアカウントに端末(アプリ)を紐付けるQRを発行(顧問先メンバー向け)。
  selfPairing: () =>
    req<{ qr_png_base64: string; url: string | null; expires_in_min: number }>('/pairing/self', {
      method: 'POST',
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

  // --- メール連携 (Gmail) ---
  // 連携開始はGoogleへのリダイレクトなので fetch ではなくブラウザ遷移で使うURL。
  gmailConnectUrl: (clientId: string) => `${BASE}/gmail/connect?client_id=${clientId}`,
  gmailAccounts: (clientId: string) =>
    req<GmailAccountRow[]>(`/gmail/accounts?client_id=${clientId}`),
  gmailDisconnect: (accountId: string) =>
    req(`/gmail/accounts/${accountId}`, { method: 'DELETE' }),
  gmailSync: (accountId: string, days = 90) =>
    req<{ seen: number; appended: number }>(`/gmail/accounts/${accountId}/sync?days=${days}`, {
      method: 'POST',
    }),
  // 受信箱の「メール取込」ボタン: この顧問先の連携メールを今すぐまとめて取り込む(Cron相当)。
  gmailPoll: (clientId: string) =>
    req<{ accounts: number; seen: number; appended: number; failed: number }>(
      `/gmail/poll?client_id=${clientId}`,
      { method: 'POST' },
    ),
}

// --- platform operator (運営) -------------------------------------------------
// Separate client + cookie (op_session) from the tenant `api` above. An operator
// provisions and manages 税理士事務所; it never reads a firm's receipt data.

export interface OperatorInfo {
  id: string
  email: string
  name: string
  status: string
}
export interface OperatorFirm {
  id: string
  name: string
  plan: string
  status: string // active | suspended
  created_at: string | null
  owners: string[]
}

export const operatorApi = {
  me: () => req<OperatorInfo>('/operator/me'),
  login: (email: string, password: string) =>
    req<{ operator_id: string }>('/operator/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => req('/operator/logout', { method: 'POST' }),
  firms: (kind: 'firm' | 'individual' | 'all' = 'firm') =>
    req<OperatorFirm[]>(`/operator/firms?kind=${kind}`),
  createFirm: (body: {
    firm_name: string
    owner_email: string
    owner_password: string
    owner_name?: string
    plan?: string
  }) =>
    req<{ firm_id: string; owner_user_id: string }>('/operator/firms', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateFirm: (firmId: string, patch: { name?: string; plan?: string; status?: string }) =>
    req<OperatorFirm>(`/operator/firms/${firmId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
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
