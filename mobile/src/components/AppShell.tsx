import { NavLink, Outlet } from 'react-router-dom'
import { APP_TITLE } from '../lib/constants'
import { useSessionStore } from '../store/session-store'

const navItems = [
  { to: '/', label: '入力' },
  { to: '/review', label: '確認・編集' },
  { to: '/export', label: '出力' },
  { to: '/settings', label: '設定' },
]

export function AppShell() {
  const session = useSessionStore((state) => state.session)
  const isProcessing = useSessionStore((state) => state.isProcessing)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel">
          <p className="eyebrow">領収書入力アプリ</p>
          <h1>{APP_TITLE}</h1>
          <p className="muted">音声入力を中心に、領収書データを作成します。</p>
        </div>
        <nav className="nav-list" aria-label="メインナビゲーション">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="session-meta">
          <div>
            <span className="label">セッション</span>
            <strong>{session?.id ?? '読み込み中...'}</strong>
          </div>
          <div>
            <span className="label">件数</span>
            <strong>{session?.records.length ?? 0}</strong>
          </div>
          <div>
            <span className="label">処理状態</span>
            <strong>{isProcessing ? '処理中' : '待機中'}</strong>
          </div>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
