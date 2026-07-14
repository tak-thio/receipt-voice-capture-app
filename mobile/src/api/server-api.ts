// Client for the SaaS backend (linked mode). `serverUrl` is the API base
// (e.g. https://receipt.example.com/api). Standalone mode never calls this.

export interface PairResult {
  access_token: string
  client_id: string
  user_id: string
  // 接続確認の表示用(サーバ権威。古いサーバでは欠ける場合があるので任意)。
  user_name?: string
  job_title?: string
  role?: string
  client_name?: string
  firm_name?: string
  individual?: boolean // 個人プラン(サインアップ/ログイン)で接続したとき true
  plan?: string // 'free' | 'pro' | 'business'
  email?: string | null // 個人アカウントの登録メール。匿名スタート(未登録)なら null/空。
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

// 受信箱(サーバの領収書一覧)。RLSにより端末の利用者が見える分だけ返る。
export interface ServerReceipt {
  id: string
  source: string
  lane?: string // 'company'(請求書) | 'expense'(経費精算)
  captured_at: string | null
  vendor: string | null
  amount_jpy: number | null
  tax_mode: string | null
  payment_method: string | null
  t_number: string | null
  approval_status: string
  journalized_at: string | null
  description: string | null
  memo?: string | null // 自由メモ(ファイル名/ページ/音声を初期値、編集可)
  image_file_id?: string | null // 代表画像(images の先頭)
  image_mime?: string | null
  images?: { file_id: string; mime: string | null }[] // capture画像(複数=マージで束ねた明細+鏡)
  page?: number | null // PDFの何ページ目由来か
  parse_failed?: boolean // AIが請求書として認識できなかった(店舗名も金額も取れず)
  // クレジット明細の取込バッチ(塊)の要約行。id は領収書IDではないため編集PATCH不可(閲覧のみ)。
  card_batch?: { count: number; short_id: string; label: string } | null
}

// 登録者が AI の読み取り内容を直すための項目（科目・仕訳には触れない）。
export interface ReceiptPatch {
  vendor?: string | null
  date?: string | null // YYYY-MM-DD（領収書の日付）
  amount_jpy?: number | null
  tax_mode?: string | null
  payment_method?: string | null
  t_number?: string | null
  description?: string | null // 摘要
  memo?: string | null // 自由メモ
}

/** 明細+鏡などを1つの統合伝票にまとめる。基準(primaryId)を優先し統合伝票を作成、元は紐付けて隠す。 */
export async function mergeReceipts(
  serverUrl: string,
  deviceToken: string,
  primaryId: string,
  mergeIds: string[],
): Promise<void> {
  const res = await fetch(`${base(serverUrl)}/receipts/merge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ primary_id: primaryId, merge_ids: mergeIds }),
  })
  if (!res.ok) {
    let msg = `マージに失敗しました (${res.status})`
    try { const b = JSON.parse(await res.text()) as { detail?: string }; if (b?.detail) msg = b.detail } catch { /* */ }
    throw new ApiError(res.status, msg, msg)
  }
}

/** 統合伝票をばらす: 束ねた元を復元して統合伝票を削除。 */
export async function unmergeReceipts(
  serverUrl: string,
  deviceToken: string,
  voucherId: string,
): Promise<void> {
  const res = await fetch(`${base(serverUrl)}/receipts/unmerge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ voucher_id: voucherId }),
  })
  if (!res.ok) {
    let msg = `ばらすのに失敗しました (${res.status})`
    try { const b = JSON.parse(await res.text()) as { detail?: string }; if (b?.detail) msg = b.detail } catch { /* */ }
    throw new ApiError(res.status, msg, msg)
  }
}

/** 領収書の中身を修正する（承認前の自分の領収書のみ。権限/状態はサーバが判定）。 */
export async function patchReceipt(
  serverUrl: string,
  deviceToken: string,
  receiptId: string,
  patch: ReceiptPatch,
): Promise<ServerReceipt> {
  const res = await fetch(`${base(serverUrl)}/receipts/${receiptId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    let msg = `保存に失敗しました (${res.status})`
    try {
      const body = JSON.parse(await res.text()) as { detail?: string }
      if (body?.detail) msg = body.detail
    } catch {
      /* 本文が JSON でなければ既定メッセージのまま */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<ServerReceipt>
}

/** 自分がアップした領収書を削除する（承認前=未仕分のみ。論理削除＝受信箱から消える）。 */
export async function deleteReceipt(
  serverUrl: string,
  deviceToken: string,
  receiptId: string,
): Promise<void> {
  const res = await fetch(`${base(serverUrl)}/receipts/${receiptId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ approval_status: 'deleted' }),
  })
  if (!res.ok) {
    let msg = `削除に失敗しました (${res.status})`
    try {
      const body = JSON.parse(await res.text()) as { detail?: string }
      if (body?.detail) msg = body.detail
    } catch {
      /* 本文が JSON でなければ既定メッセージのまま */
    }
    throw new Error(msg)
  }
}

export async function listReceipts(
  serverUrl: string,
  deviceToken: string,
  clientId: string,
  lane?: string, // company=会社経費 / expense=立替経費(一般社員のトレイ)
): Promise<ServerReceipt[]> {
  const laneQs = lane ? `&lane=${encodeURIComponent(lane)}` : ''
  const res = await fetch(`${base(serverUrl)}/receipts?client_id=${encodeURIComponent(clientId)}${laneQs}`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  })
  if (!res.ok) {
    throw new Error(`受信箱の取得に失敗しました (${res.status})`)
  }
  return res.json() as Promise<ServerReceipt[]>
}

// --- 経費精算(申請=モバイル/web 両方。承認は web 専用) ---
export interface ServerExpenseClaimItem {
  receipt_id: string
  vendor: string | null
  amount_jpy: number | null
  date: string | null
}
export interface ServerExpenseClaim {
  id: string
  title: string | null
  status: string // draft | submitted | approved | rejected | withdrawn
  applicant: string | null
  applicant_user_id: string | null
  reject_reason: string | null
  created_at: string | null
  item_count: number
  total_jpy: number
  items: ServerExpenseClaimItem[]
}

/** API がエラー応答(非2xx)を返したときに投げる型付きエラー。status と server detail を持つので、
 *  呼び出し側が種別(401/403/409/5xx 等)で分岐できる。 */
export class ApiError extends Error {
  readonly status: number
  readonly detail?: string
  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function expenseReq<T>(serverUrl: string, deviceToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base(serverUrl)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    let detail: string | undefined
    try {
      const body = JSON.parse(await res.text()) as { detail?: string }
      if (body?.detail) detail = body.detail
    } catch {
      /* 本文が JSON でなければ detail なし */
    }
    throw new ApiError(res.status, detail ?? `操作に失敗しました (${res.status})`, detail)
  }
  return res.json() as Promise<T>
}

export function listExpenseClaims(serverUrl: string, deviceToken: string, clientId: string, statusFilter?: string) {
  const q = statusFilter ? `&status_filter=${encodeURIComponent(statusFilter)}` : ''
  return expenseReq<ServerExpenseClaim[]>(
    serverUrl, deviceToken, `/expense/claims?client_id=${encodeURIComponent(clientId)}${q}`,
  )
}
export function createExpenseClaim(
  serverUrl: string, deviceToken: string, clientId: string, body: { title?: string | null; receipt_ids: string[] },
) {
  return expenseReq<ServerExpenseClaim>(
    serverUrl, deviceToken, `/expense/claims?client_id=${encodeURIComponent(clientId)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}
export function updateExpenseClaim(
  serverUrl: string, deviceToken: string, claimId: string, body: { title?: string | null; receipt_ids: string[] },
) {
  return expenseReq<ServerExpenseClaim>(
    serverUrl, deviceToken, `/expense/claims/${claimId}`, { method: 'PATCH', body: JSON.stringify(body) },
  )
}
export function submitExpenseClaim(serverUrl: string, deviceToken: string, claimId: string) {
  return expenseReq<{ status: string }>(serverUrl, deviceToken, `/expense/claims/${claimId}/submit`, { method: 'POST' })
}
export function withdrawExpenseClaim(serverUrl: string, deviceToken: string, claimId: string) {
  return expenseReq<{ status: string }>(serverUrl, deviceToken, `/expense/claims/${claimId}/withdraw`, { method: 'POST' })
}

/** FCM 登録トークンをサーバに登録(端末の利用者に紐づく)。Phase D のプッシュ通知用。 */
export async function registerFcmToken(
  serverUrl: string, deviceToken: string, token: string, platform = 'android',
): Promise<void> {
  const res = await fetch(`${base(serverUrl)}/devices/fcm-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ token, platform }),
  })
  if (!res.ok) throw new Error(`FCMトークン登録に失敗 (${res.status})`)
}

/** 領収書画像のプレビュー(PDFはサーバでPNG化)を取得し objectURL を返す。
 * Bearer ヘッダが要るので <img src> 直指定ではなく blob 取得→objectURL にする。 */
export async function fetchPreviewObjectUrl(
  serverUrl: string,
  deviceToken: string,
  fileId: string,
  page?: number | null,
): Promise<string> {
  const qs = page ? `?page=${page}` : ''
  const res = await fetch(`${base(serverUrl)}/files/${fileId}/preview${qs}`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  })
  if (!res.ok) {
    throw new Error(`画像の取得に失敗しました (${res.status})`)
  }
  return URL.createObjectURL(await res.blob())
}

/** Redeem a QR pairing token for a long-lived device token. */
export async function pairDevice(serverUrl: string, token: string): Promise<PairResult> {
  const res = await fetch(`${base(serverUrl)}/pairing/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) {
    throw new Error(`ペアリングに失敗しました (${res.status})`)
  }
  return res.json() as Promise<PairResult>
}

/** ログイン不要のデモ接続。デモ用顧問先(サンドボックス)の端末トークンを得る。 */
export async function demoConnect(serverUrl: string): Promise<PairResult> {
  const res = await fetch(`${base(serverUrl)}/pairing/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`デモ接続に失敗しました (${res.status})`)
  }
  return res.json() as Promise<PairResult>
}

async function _postNoAuth<T>(serverUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base(serverUrl)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `失敗しました (${res.status})`
    try {
      const b = JSON.parse(await res.text()) as { detail?: string }
      if (b?.detail) msg = b.detail
    } catch {
      /* 本文が JSON でなければ既定メッセージ */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

/** 個人プラン: 新規登録(1人用テナントを自動生成し device token を得る)。 */
export function individualSignup(
  serverUrl: string, body: { email: string; password: string; name?: string },
): Promise<PairResult> {
  return _postNoAuth<PairResult>(serverUrl, '/individual/signup', body)
}

/** 個人プラン: ログイン(再インストール/機種変更時)。 */
export function individualLogin(
  serverUrl: string, body: { email: string; password: string },
): Promise<PairResult> {
  return _postNoAuth<PairResult>(serverUrl, '/individual/login', body)
}

/** 個人プラン: 匿名スタート(メール/パスワード不要)。すぐ撮影でき、後で claim で登録する。 */
export function individualStart(serverUrl: string): Promise<PairResult> {
  return _postNoAuth<PairResult>(serverUrl, '/individual/start', {})
}

export interface ClaimResult {
  email: string
  user_name: string
  plan: string
  individual: boolean
}

/** 個人プラン: 匿名アカウントにメール/パスワードを登録(遅延サインアップ)。device token はそのまま有効。 */
export function individualClaim(
  serverUrl: string, deviceToken: string, body: { email: string; password: string; name?: string },
): Promise<ClaimResult> {
  return expenseReq<ClaimResult>(serverUrl, deviceToken, '/individual/claim', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// --- Google Drive エクスポート(個人) ---
/** Drive 連携済みか(エクスポートUIの出し分け用)。 */
/** 個人アカウントの表示名を変更する。 */
export function updateIndividualName(
  serverUrl: string, deviceToken: string, name: string,
): Promise<{ user_name: string }> {
  return expenseReq<{ user_name: string }>(serverUrl, deviceToken, '/individual/profile', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function driveStatus(serverUrl: string, deviceToken: string): Promise<{ connected: boolean }> {
  return expenseReq<{ connected: boolean }>(serverUrl, deviceToken, '/drive/status')
}
/** Drive 連携開始。Google 同意URLを返す(アプリが外部ブラウザで開く)。 */
export function driveConnectUrl(serverUrl: string, deviceToken: string): Promise<{ auth_url: string }> {
  return expenseReq<{ auth_url: string }>(serverUrl, deviceToken, '/drive/connect')
}
/** 全領収書をCSVにして本人のDriveへ書き出す。未連携は 409。 */
export function driveExport(
  serverUrl: string, deviceToken: string,
): Promise<{ count: number; link: string | null }> {
  return expenseReq<{ count: number; link: string | null }>(serverUrl, deviceToken, '/drive/export', {
    method: 'POST',
  })
}

/** 個人プラン: 退会(アカウント＋データを削除)。 */
export async function deleteIndividualAccount(serverUrl: string, deviceToken: string): Promise<void> {
  const res = await fetch(`${base(serverUrl)}/individual/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${deviceToken}` },
  })
  if (!res.ok) {
    throw new ApiError(res.status, `退会に失敗しました (${res.status})`)
  }
}

export interface UsageInfo {
  used: number
  cap: number | null // null=無制限(会社)
  plan: string
}

/** 当月の解析枚数・上限・プラン(メーター表示用)。 */
export function getUsage(serverUrl: string, deviceToken: string): Promise<UsageInfo> {
  return expenseReq<UsageInfo>(serverUrl, deviceToken, '/captures/usage')
}

export interface VerifyPurchaseResult extends UsageInfo {
  active: boolean // 購読が有効(active/猶予期間)なら true。false なら pro 付与されない。
}

/** アプリ内課金(IAP / ⑤): Play の購入トークンをサーバで検証し、有効なら pro を付与する。
 * 端末が Play Billing で購入した直後に呼ぶ。戻り値は最新の plan/used/cap と有効フラグ。 */
export function verifyPurchase(
  serverUrl: string, deviceToken: string, purchaseToken: string, productId?: string,
): Promise<VerifyPurchaseResult> {
  return expenseReq<VerifyPurchaseResult>(serverUrl, deviceToken, '/billing/google/verify', {
    method: 'POST',
    body: JSON.stringify({ purchase_token: purchaseToken, product_id: productId }),
  })
}

export interface CaptureUpload {
  imageDataUrl?: string
  audio?: Blob
  capturedAt?: string
  /** 端末のキャプチャ時メタデータ(撮影時刻・画像寸法・検出情報・プラットフォーム等)。JSON で送る。 */
  metadata?: Record<string, unknown>
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/** Upload a captured image (+ optional audio) to the server, which runs the AI. */
export async function uploadCapture(
  serverUrl: string,
  deviceToken: string,
  capture: CaptureUpload,
): Promise<{ receipt_id: string }> {
  const form = new FormData()
  if (capture.imageDataUrl) {
    form.append('image', dataUrlToBlob(capture.imageDataUrl), 'capture.jpg')
  }
  if (capture.audio) {
    form.append('audio', capture.audio, 'audio.webm')
  }
  if (capture.capturedAt) {
    form.append('captured_at', capture.capturedAt)
  }
  if (capture.metadata) {
    form.append('metadata', JSON.stringify(capture.metadata))
  }
  const res = await fetch(`${base(serverUrl)}/captures`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`アップロードに失敗しました (${res.status})`)
  }
  return res.json() as Promise<{ receipt_id: string }>
}

export interface BatchUpload {
  images: { dataUrl: string }[]
  audio?: Blob
  metadata?: Record<string, unknown>
  lane?: string // 'company'(請求書) | 'expense'(経費精算)。未指定はサーバが役割で判定
}

/** 撮影セットを一括送信: 複数画像(+任意の音声)を1リクエストで /captures/batch へ。
 * サーバが全画像+音声を1回のAI呼び出しで解析し、含まれる領収書/明細を全件起こす
 * (1画像から複数件あり)。画像は配列順=撮影順で送る。 */
export async function uploadBatch(
  serverUrl: string,
  deviceToken: string,
  batch: BatchUpload,
): Promise<{ status: string; images: number }> {
  const form = new FormData()
  batch.images.forEach((img, i) => {
    form.append('images', dataUrlToBlob(img.dataUrl), `capture_${i + 1}.jpg`)
  })
  if (batch.audio) {
    form.append('audio', batch.audio, 'audio.webm')
  }
  if (batch.metadata) {
    form.append('metadata', JSON.stringify(batch.metadata))
  }
  if (batch.lane) {
    form.append('lane', batch.lane)
  }
  const res = await fetch(`${base(serverUrl)}/captures/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}` },
    body: form,
  })
  if (!res.ok) {
    // 402(上限到達)など、サーバの詳細メッセージをそのまま見せる。
    let msg = `アップロードに失敗しました (${res.status})`
    try {
      const b = JSON.parse(await res.text()) as { detail?: string }
      if (b?.detail) msg = b.detail
    } catch {
      /* 本文が JSON でなければ既定メッセージ */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<{ status: string; images: number }>
}
