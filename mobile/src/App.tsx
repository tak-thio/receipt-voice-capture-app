import { useEffect, useState } from 'react'
import { CaptureScreen } from './pages/CaptureScreen'
import { ConnectScreen } from './pages/ConnectScreen'
import { DashboardScreen } from './pages/DashboardScreen'
import { InboxScreen } from './pages/InboxScreen'
import { SettingsScreen } from './pages/SettingsScreen'
import { useAppStore } from './store/app-store'

type Tab = 'home' | 'capture' | 'inbox' | 'settings'

export default function App() {
  const ready = useAppStore((state) => state.ready)
  const connection = useAppStore((state) => state.connection)
  const init = useAppStore((state) => state.init)
  const [tab, setTab] = useState<Tab>('home')

  useEffect(() => {
    init()
  }, [init])

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
        {tab === 'capture' && <CaptureScreen />}
        {tab === 'inbox' && <InboxScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabbar" aria-label="メインナビゲーション">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>ホーム</button>
        <button className={tab === 'capture' ? 'active' : ''} onClick={() => setTab('capture')}>撮影</button>
        <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>受信箱</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>設定</button>
      </nav>
    </div>
  )
}
