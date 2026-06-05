import { useEffect, useMemo, useState } from 'react'
import { api, type ClientRow, type Me } from './api'
import { ReceiptsView } from './views/Receipts'
import { JournalView } from './views/Journal'
import { MastersView } from './views/Masters'
import { ClientsView } from './views/Clients'
import { SettingsView } from './views/Settings'
import { InviteRedeem } from './views/InviteRedeem'

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return window.location.pathname.includes('/invite') ? params.get('token') : null
  })

  function refreshMe() {
    return api.me().then(setMe).catch(() => setMe(null))
  }
  useEffect(() => {
    if (inviteToken) {
      setLoading(false)
      return
    }
    refreshMe().finally(() => setLoading(false))
  }, [inviteToken])

  if (inviteToken) {
    return (
      <InviteRedeem
        token={inviteToken}
        onDone={() => {
          setInviteToken(null)
          void refreshMe()
        }}
      />
    )
  }
  if (loading) return <div className="p-8 text-stone-500">読み込み中...</div>
  return me ? <Dashboard me={me} onLogout={() => setMe(null)} /> : <Login onLogin={setMe} />
}

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.login(email, password)
      onLogin(await api.me())
    } catch {
      setError('ログインに失敗しました')
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-stone-100">
      <form onSubmit={submit} className="w-80 space-y-3 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-lg font-bold text-stone-800">領収書SaaS ログイン</h1>
        <input className="w-full rounded-lg border px-3 py-2" placeholder="メールアドレス"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-lg border px-3 py-2" type="password" placeholder="パスワード"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-stone-800 py-2 text-white">ログイン</button>
      </form>
    </div>
  )
}

type Tab = 'receipts' | 'journal' | 'masters' | 'clients' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'receipts', label: '受信箱' },
  { id: 'journal', label: '仕分け' },
  { id: 'masters', label: 'マスタ' },
  { id: 'clients', label: '顧問先' },
  { id: 'settings', label: '設定' },
]

function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const firmId = useMemo(
    () => me.memberships.find((m) => m.client_id === null)?.firm_id ?? me.memberships[0]?.firm_id ?? '',
    [me],
  )
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientId, setClientId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('receipts')
  const isFirmStaff = me.memberships.some(
    (m) => m.client_id === null && (m.role === 'firm_owner' || m.role === 'firm_staff'),
  )
  const visibleTabs = TABS.filter((t) => t.id !== 'settings' || isFirmStaff)

  async function reloadClients() {
    const rows = await api.clients()
    setClients(rows)
    setClientId((prev) => prev || rows[0]?.id || '')
  }
  useEffect(() => {
    reloadClients().catch(() => setClients([]))
  }, [])

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-3">
        <h1 className="font-bold">領収書SaaS</h1>
        <div className="flex items-center gap-3 text-sm">
          {tab !== 'clients' && (
            <select className="rounded-lg border px-2 py-1" value={clientId}
              onChange={(e) => setClientId(e.target.value)}>
              {clients.length === 0 && <option value="">顧問先なし</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <span className="text-stone-500">{me.user.email}</span>
          <button className="rounded-lg border px-3 py-1"
            onClick={async () => { await api.logout(); onLogout() }}>ログアウト</button>
        </div>
      </header>

      <nav className="flex gap-1 border-b bg-white px-4">
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm ${tab === t.id ? 'border-b-2 border-stone-800 font-semibold' : 'text-stone-500'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === 'receipts' && <ReceiptsView clientId={clientId} />}
        {tab === 'journal' && <JournalView clientId={clientId} />}
        {tab === 'masters' && <MastersView clientId={clientId} firmId={firmId} />}
        {tab === 'clients' && <ClientsView onChanged={reloadClients} />}
        {tab === 'settings' && <SettingsView firmId={firmId} />}
      </main>
    </div>
  )
}
