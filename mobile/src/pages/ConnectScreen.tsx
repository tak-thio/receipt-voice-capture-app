import { useState } from 'react'
import {
  deleteIndividualAccount, individualLogin, individualStart, pairDevice, type PairResult,
} from '../api/server-api'
import { DEFAULT_SERVER } from '../config'
import { toConnection } from '../lib/pairing'
import { isQrScanSupported } from '../lib/qr-scan'
import { QrScannerOverlay } from '../components/QrScannerOverlay'
import { useAppStore } from '../store/app-store'

/** ペアリングQRの中身を解釈。{url,t} JSON なら接続先URLも取得、そうでなければ bare token。 */
function parsePairingQr(value: string): { token: string; url?: string } {
  const trimmed = value.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { url?: unknown; t?: unknown }
      if (typeof parsed.t === 'string' && parsed.t) {
        return { token: parsed.t, url: typeof parsed.url === 'string' && parsed.url ? parsed.url : undefined }
      }
    } catch {
      /* JSON でなければ bare token として扱う */
    }
  }
  return { token: trimmed }
}

type View = 'landing' | 'firm' | 'login'

/** 連携/オンボーディング画面。未接続時に表示。個人(登録/ログイン)・会社(QR連携)・デモを選ぶ。 */
export function ConnectScreen({ initialView, onClose, onConnected }: {
  initialView?: View
  onClose?: () => void
  onConnected?: () => void
} = {}) {
  const setConnection = useAppStore((state) => state.setConnection)
  const connection = useAppStore((state) => state.connection)
  const [view, setView] = useState<View>(initialView ?? 'landing')
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER)
  const [token, setToken] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // 個人 ログイン フォーム
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const qrSupported = isQrScanSupported()

  async function apply(result: PairResult, demo = false) {
    const next = toConnection(serverUrl, result, demo)
    // 個人 → 会社(顧問先)への切り替え: 旧・個人アカウントを削除(データ削除＋サブスク解約)。
    // データは引き継がれない設計なので、放置による孤立データ・二重課金を防ぐ。
    if (connection?.individual && !next.individual) {
      const ok = window.confirm(
        '会社（顧問先）に切り替えると、個人で取り込んだ領収書データはすべて削除され、'
        + 'Pro サブスクをご契約中の場合は自動的に解約されます。元に戻せません。切り替えますか？',
      )
      if (!ok) return
      try {
        await deleteIndividualAccount(connection.serverUrl, connection.deviceToken)
      } catch {
        /* 削除失敗でも切替は続行(best-effort)。サーバ側に7日掃除のフォールバックあり。 */
      }
    }
    setConnection(next)
    onConnected?.()
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  function onQrResult(value: string) {
    setScanning(false)
    const parsed = parsePairingQr(value)
    setToken(parsed.token)
    if (parsed.url) setServerUrl(parsed.url)
    setMessage('QRを読み取りました。「接続」を押してください。')
  }

  const back = (
    <button className="ghost-button" onClick={() => { setView('landing'); setMessage('') }}>← 戻る</button>
  )
  // 設定からオーバーレイ表示している時だけ「閉じる」を出す(現在の接続に戻る)。
  const closeSlot = onClose
    ? <button className="ghost-button" onClick={onClose}>閉じる</button>
    : <span style={{ width: 64 }} />

  // --- 個人: ログイン ---
  if (view === 'login') {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="inbox-head">{back}<h1>ログイン</h1>{closeSlot}</div>
          <label className="field"><span>メールアドレス</span>
            <input type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>パスワード</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="accent-button big" disabled={busy}
            onClick={() => void run(async () => { await apply(await individualLogin(serverUrl, { email, password })) })}>
            {busy ? 'ログイン中...' : 'ログイン'}
          </button>
          {message && <p className="muted small">{message}</p>}
          <button className="ghost-button" onClick={() => { setView('firm'); setMessage('') }}>
            会社・事務所のQRコードで連携
          </button>
          <button className="ghost-button" onClick={() => { setView('landing'); setMessage('') }}>
            初めての方は「個人で始める」から
          </button>
        </div>
      </div>
    )
  }

  // --- 会社: QR連携 ---
  if (view === 'firm') {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="inbox-head">{back}<h1>会社と連携</h1>{closeSlot}</div>
          <p className="muted">税理士事務所/会社が発行したQRコードを読み取って接続します。</p>
          {qrSupported && (
            <button className="primary-button big" onClick={() => { setMessage(''); setScanning(true) }}>
              QRコードをスキャン
            </button>
          )}
          <details className="manual">
            <summary>手入力で接続</summary>
            <label className="field"><span>サーバURL</span>
              <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://example.com/api" /></label>
            <label className="field"><span>ペアリングトークン(QRの中身)</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} /></label>
          </details>
          <button className="accent-button big" disabled={busy}
            onClick={() => void run(async () => {
              if (!serverUrl || !token) { setMessage('サーバURLとトークン(QR)を入力してください。'); return }
              await apply(await pairDevice(serverUrl, token))
            })}>
            {busy ? '接続中...' : '接続'}
          </button>
          {message && <p className="muted small">{message}</p>}
        </div>
        {scanning && <QrScannerOverlay onResult={onQrResult} onCancel={() => setScanning(false)} />}
      </div>
    )
  }

  // --- ランディング ---
  return (
    <div className="connect-screen">
      <div className="connect-card">
        {onClose && (
          <div style={{ textAlign: 'right' }}>
            <button className="ghost-button" onClick={onClose}>閉じる</button>
          </div>
        )}
        <h1>領収ボックス</h1>
        <p className="muted">領収書を撮るだけ。AIが読み取ります。</p>
        <button className="accent-button big" disabled={busy}
          onClick={() => void run(async () => { await apply(await individualStart(serverUrl)) })}>
          {busy ? '準備中…' : '個人で始める（無料・登録不要）'}
        </button>
        <button className="primary-button big" onClick={() => { setView('login'); setMessage('') }}>
          ログイン
        </button>
        <p className="muted small center" style={{ marginTop: 14 }}>会社・事務所の方</p>
        <button className="ghost-button" onClick={() => { setView('firm'); setMessage('') }}>
          会社で連携（QRコード）
        </button>
        {message && <p className="muted small">{message}</p>}
      </div>
    </div>
  )
}
