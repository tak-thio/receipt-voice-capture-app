import { useState } from 'react'
import { demoConnect, pairDevice } from '../api/server-api'
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
        return {
          token: parsed.t,
          url: typeof parsed.url === 'string' && parsed.url ? parsed.url : undefined,
        }
      }
    } catch {
      /* JSON でなければ bare token として扱う */
    }
  }
  return { token: trimmed }
}

/** 連携(ペアリング)画面。未接続時に表示する。 */
export function ConnectScreen() {
  const setConnection = useAppStore((state) => state.setConnection)
  const [serverUrl, setServerUrl] = useState('https://receipt.billpo.jp/api')
  const [token, setToken] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const qrSupported = isQrScanSupported()

  function onQrResult(value: string) {
    setScanning(false)
    const parsed = parsePairingQr(value)
    setToken(parsed.token)
    if (parsed.url) setServerUrl(parsed.url)
    setMessage('QRを読み取りました。「接続」を押してください。')
  }

  async function connect() {
    if (!serverUrl || !token) {
      setMessage('サーバURLとトークン(QR)を入力してください。')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await pairDevice(serverUrl, token)
      setConnection({
        serverUrl,
        deviceToken: result.access_token,
        clientId: result.client_id,
        firmName: result.firm_name,
        clientName: result.client_name,
        userName: result.user_name,
        jobTitle: result.job_title,
        role: result.role,
      })
      // 接続成功で App が撮影画面へ自動遷移する。
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '接続に失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  // ログイン不要のデモ。サンドボックスの顧問先に接続して、撮影→AI解析→受信箱まで試せる。
  async function tryDemo() {
    setBusy(true)
    setMessage('')
    try {
      const result = await demoConnect(serverUrl)
      setConnection({
        serverUrl,
        deviceToken: result.access_token,
        clientId: result.client_id,
        firmName: result.firm_name,
        clientName: result.client_name,
        userName: result.user_name,
        jobTitle: result.job_title,
        role: result.role,
        demo: true,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'デモ接続に失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connect-screen">
      <div className="connect-card">
        <h1>事務所と連携</h1>
        <p className="muted">税理士事務所が発行したQRコードを読み取って接続します。</p>

        {qrSupported && (
          <button className="primary-button big" onClick={() => { setMessage(''); setScanning(true) }}>
            QRコードをスキャン
          </button>
        )}

        <details className="manual">
          <summary>手入力で接続</summary>
          <label className="field">
            <span>サーバURL</span>
            <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://example.com/api" />
          </label>
          <label className="field">
            <span>ペアリングトークン(QRの中身)</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
        </details>

        <button className="accent-button big" disabled={busy} onClick={() => void connect()}>
          {busy ? '接続中...' : '接続'}
        </button>
        {message && <p className="muted small">{message}</p>}

        <p className="muted small center" style={{ marginTop: 18 }}>または、アカウント不要で:</p>
        <button className="primary-button big" disabled={busy} onClick={() => void tryDemo()}>
          ログイン不要でデモを試す
        </button>
        <p className="muted small center">サンプルの顧問先で 撮影→AI読み取り→受信箱 を体験できます。</p>
      </div>

      {scanning && <QrScannerOverlay onResult={onQrResult} onCancel={() => setScanning(false)} />}
    </div>
  )
}
