import { useState } from 'react'
import {
  demoConnect, individualLogin, individualSignup, pairDevice, type PairResult,
} from '../api/server-api'
import { isQrScanSupported } from '../lib/qr-scan'
import { QrScannerOverlay } from '../components/QrScannerOverlay'
import { useAppStore } from '../store/app-store'

const DEFAULT_SERVER = 'https://receipt.billpo.jp/api'

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

type View = 'landing' | 'firm' | 'signup' | 'login'

/** 連携/オンボーディング画面。未接続時に表示。個人(登録/ログイン)・会社(QR連携)・デモを選ぶ。 */
export function ConnectScreen() {
  const setConnection = useAppStore((state) => state.setConnection)
  const [view, setView] = useState<View>('landing')
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER)
  const [token, setToken] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // 個人 登録/ログイン フォーム
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const qrSupported = isQrScanSupported()

  function apply(result: PairResult, demo = false) {
    setConnection({
      serverUrl,
      deviceToken: result.access_token,
      clientId: result.client_id,
      firmName: result.firm_name,
      clientName: result.client_name,
      userName: result.user_name,
      jobTitle: result.job_title,
      role: result.role,
      demo,
      individual: result.individual,
      plan: result.plan,
    })
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

  // --- 個人: 新規登録 ---
  if (view === 'signup') {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="inbox-head">{back}<h1>個人で始める</h1><span style={{ width: 64 }} /></div>
          <p className="muted">無料で月30枚まで解析できます。</p>
          <label className="field"><span>お名前(任意)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 山田太郎" /></label>
          <label className="field"><span>メールアドレス</span>
            <input type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>パスワード(8文字以上)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="accent-button big" disabled={busy}
            onClick={() => void run(async () => apply(await individualSignup(serverUrl, { email, password, name })))}>
            {busy ? '登録中...' : '無料で登録'}
          </button>
          {message && <p className="muted small">{message}</p>}
          <button className="ghost-button" onClick={() => { setView('login'); setMessage('') }}>
            アカウントをお持ちの方はログイン
          </button>
        </div>
      </div>
    )
  }

  // --- 個人: ログイン ---
  if (view === 'login') {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="inbox-head">{back}<h1>ログイン</h1><span style={{ width: 64 }} /></div>
          <label className="field"><span>メールアドレス</span>
            <input type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>パスワード</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="accent-button big" disabled={busy}
            onClick={() => void run(async () => apply(await individualLogin(serverUrl, { email, password })))}>
            {busy ? 'ログイン中...' : 'ログイン'}
          </button>
          {message && <p className="muted small">{message}</p>}
          <button className="ghost-button" onClick={() => { setView('signup'); setMessage('') }}>
            初めての方は新規登録
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
          <div className="inbox-head">{back}<h1>会社と連携</h1><span style={{ width: 64 }} /></div>
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
              apply(await pairDevice(serverUrl, token))
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
        <h1>領収ボックス</h1>
        <p className="muted">領収書を撮るだけ。AIが読み取ります。</p>
        <button className="accent-button big" onClick={() => { setView('signup'); setMessage('') }}>
          個人で使う（無料で始める）
        </button>
        <button className="primary-button big" onClick={() => { setView('login'); setMessage('') }}>
          ログイン
        </button>
        <p className="muted small center" style={{ marginTop: 14 }}>会社・事務所の方</p>
        <button className="ghost-button" onClick={() => { setView('firm'); setMessage('') }}>
          会社で連携（QRコード）
        </button>
        <button className="ghost-button" disabled={busy}
          onClick={() => void run(async () => apply(await demoConnect(serverUrl), true))}>
          ログイン不要でデモを試す
        </button>
        {message && <p className="muted small">{message}</p>}
      </div>
    </div>
  )
}
