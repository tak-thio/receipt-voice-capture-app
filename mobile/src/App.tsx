import { useEffect, useRef, useState } from 'react'
import { individualStart, registerFcmToken } from './api/server-api'
import { DEFAULT_SERVER } from './config'
import { toConnection } from './lib/pairing'
import { CaptureScreen } from './pages/CaptureScreen'
import { ConnectScreen } from './pages/ConnectScreen'
import { DashboardScreen } from './pages/DashboardScreen'
import { ExpenseScreen } from './pages/ExpenseScreen'
import { InboxScreen } from './pages/InboxScreen'
import { SettingsScreen } from './pages/SettingsScreen'
import { getFcmToken, isNativeFcmAvailable } from './services/fcm/native-fcm'
import { useAppStore } from './store/app-store'

type Tab = 'home' | 'capture' | 'inbox' | 'expense' | 'settings'

export default function App() {
  const ready = useAppStore((state) => state.ready)
  const connection = useAppStore((state) => state.connection)
  const started = useAppStore((state) => state.started)
  const authPrompt = useAppStore((state) => state.authPrompt)
  const setConnection = useAppStore((state) => state.setConnection)
  const setAuthPrompt = useAppStore((state) => state.setAuthPrompt)
  const init = useAppStore((state) => state.init)
  const toast = useAppStore((state) => state.toast)
  const hideToast = useAppStore((state) => state.hideToast)
  const [tab, setTab] = useState<Tab>('home')
  const [autoStartDone, setAutoStartDone] = useState(false)
  const startingRef = useRef(false)

  useEffect(() => {
    init()
  }, [init])

  // 初回起動(まだ一度も接続していない)は、登録不要で匿名アカウントを自動作成してすぐ使える状態にする。
  // ログアウト後(started=true)は作らない。オフライン等で失敗したら下の連携画面でログイン/再試行できる。
  useEffect(() => {
    if (!ready || connection || started || startingRef.current) return
    startingRef.current = true
    individualStart(DEFAULT_SERVER)
      .then((r) => setConnection(toConnection(DEFAULT_SERVER, r)))
      .catch(() => { /* オフライン等。連携画面にフォールバック。 */ })
      .finally(() => setAutoStartDone(true))
  }, [ready, connection, started, setConnection])

  // トーストは数秒で自動的に消す。
  useEffect(() => {
    if (!toast) return
    // 文字数に応じて表示時間を伸ばす(長文でも読み切れるように)。3.5〜7秒。
    const t = window.setTimeout(hideToast, Math.min(7000, Math.max(3500, toast.length * 130)))
    return () => window.clearTimeout(t)
  }, [toast, hideToast])

  // FCM(Phase D): 接続済み端末で登録トークンを取得し、サーバに登録(プッシュ通知の宛先)。失敗は無視。
  useEffect(() => {
    if (!connection || !isNativeFcmAvailable()) return
    void (async () => {
      const token = await getFcmToken()
      if (!token) return
      try {
        await registerFcmToken(connection.serverUrl, connection.deviceToken, token)
      } catch {
        /* best-effort */
      }
    })()
  }, [connection])

  if (!ready) {
    return <div className="boot-screen">アプリを読み込んでいます...</div>
  }

  // 初回起動: 匿名アカウントを自動作成中(登録不要)。
  if (!connection && !started && !autoStartDone) {
    return <div className="boot-screen">準備しています...</div>
  }

  // 未接続(自動作成に失敗 / ログアウト後 / 退会後)なら連携・ログイン画面。
  if (!connection) {
    return <ConnectScreen />
  }

  // 設定からの「ログイン」「会社と連携」は、現在の接続を保ったままオーバーレイ表示。
  if (authPrompt) {
    return (
      <ConnectScreen
        initialView={authPrompt}
        onClose={() => setAuthPrompt(null)}
        onConnected={() => setAuthPrompt(null)}
      />
    )
  }

  // 経費精算(申請)は一般社員(client_user)向け。撮ったものは立替レーンに入る。
  const canExpense = connection.role === 'client_user'

  return (
    <div className="app">
      {connection.demo && (
        <div style={{ background: '#fde68a', color: '#78350f', textAlign: 'center', padding: '4px 8px', fontSize: 12 }}>
          デモ中（サンプルデータ）・本番利用は事務所との連携が必要です
        </div>
      )}
      <main className="screen">
        {tab === 'home' && <DashboardScreen onGoCapture={() => setTab('capture')} onGoInbox={() => setTab('inbox')} onGoExpense={canExpense ? () => setTab('expense') : undefined} />}
        {tab === 'capture' && <CaptureScreen onSent={() => setTab('home')} />}
        {tab === 'inbox' && <InboxScreen />}
        {tab === 'expense' && <ExpenseScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      {toast && (
        <div className="toast" role="status" onClick={hideToast}>
          {toast}
        </div>
      )}
      <nav className="tabbar" aria-label="メインナビゲーション">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>ホーム</button>
        <button className={tab === 'capture' ? 'active' : ''} onClick={() => setTab('capture')}>撮影</button>
        <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>受信箱</button>
        {canExpense && (
          <button className={tab === 'expense' ? 'active' : ''} onClick={() => setTab('expense')}>経費精算</button>
        )}
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>設定</button>
      </nav>
    </div>
  )
}
