import { useEffect, useState } from 'react'
import { CaptureScreen } from './pages/CaptureScreen'
import { ConnectScreen } from './pages/ConnectScreen'
import { DashboardScreen } from './pages/DashboardScreen'
import { InboxScreen } from './pages/InboxScreen'
import { SettingsScreen } from './pages/SettingsScreen'
import { prewarmDetector } from './services/detection'
import { useAppStore } from './store/app-store'

type Tab = 'home' | 'capture' | 'inbox' | 'settings'

export default function App() {
  const ready = useAppStore((state) => state.ready)
  const connection = useAppStore((state) => state.connection)
  const init = useAppStore((state) => state.init)
  const toast = useAppStore((state) => state.toast)
  const hideToast = useAppStore((state) => state.hideToast)
  const autoCapture = useAppStore((state) => state.autoCapture)
  const [tab, setTab] = useState<Tab>('home')

  useEffect(() => {
    init()
  }, [init])

  // 起動直後(ダッシュボード表示中)に検出モデルを裏でロード＆ウォームアップしておく。
  // 撮影タブを開く頃には温まっているので、最初からスムーズに検出できる。
  useEffect(() => {
    if (ready && connection && autoCapture) prewarmDetector()
  }, [ready, connection, autoCapture])

  // トーストは数秒で自動的に消す。
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(hideToast, 3500)
    return () => window.clearTimeout(t)
  }, [toast, hideToast])

  if (!ready) {
    return <div className="boot-screen">アプリを読み込んでいます...</div>
  }

  // 未接続なら最初に連携(ペアリング)画面。
  if (!connection) {
    return <ConnectScreen />
  }

  return (
    <div className="app">
      <main className="screen">
        {tab === 'home' && <DashboardScreen onGoCapture={() => setTab('capture')} onGoInbox={() => setTab('inbox')} />}
        {tab === 'capture' && <CaptureScreen onSent={() => setTab('home')} />}
        {tab === 'inbox' && <InboxScreen />}
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
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>設定</button>
      </nav>
    </div>
  )
}
