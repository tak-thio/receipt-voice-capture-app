import { NavLink, Outlet } from 'react-router-dom'
import { APP_TITLE } from '../lib/constants'
import { useSessionStore } from '../store/session-store'

const navItems = [
  { to: '/', label: 'Capture' },
  { to: '/review', label: 'Review' },
  { to: '/export', label: 'Export' },
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  const session = useSessionStore((state) => state.session)
  const isProcessing = useSessionStore((state) => state.isProcessing)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-panel">
          <p className="eyebrow">MVP Workspace</p>
          <h1>{APP_TITLE}</h1>
          <p className="muted">音声優先で領収書を積み上げる、ローカル完結の capture workflow。</p>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
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
            <span className="label">Session</span>
            <strong>{session?.id ?? 'loading...'}</strong>
          </div>
          <div>
            <span className="label">Records</span>
            <strong>{session?.records.length ?? 0}</strong>
          </div>
          <div>
            <span className="label">Pipeline</span>
            <strong>{isProcessing ? 'processing' : 'ready'}</strong>
          </div>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
