import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, type ClientRow, type Me } from './api'
import { ReceiptsView } from './views/Receipts'
import { JournalView } from './views/Journal'
import { LedgerView } from './views/LedgerView'
import { MastersView } from './views/Masters'
import { ClientsView, ClientUsers, ClientAiConfig } from './views/Clients'
import { GmailLink } from './views/GmailLink'
import { SettingsView } from './views/Settings'
import { ExportView } from './views/Export'
import { InviteRedeem } from './views/InviteRedeem'
import { Alert, Button, Card, cn, Icon, Input, PageHeader, Select } from './ui'
import type { IconComponent } from './ui/icons'
import { ToastProvider } from './ui/toast'

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

  return (
    <ToastProvider>
      {inviteToken ? (
        <InviteRedeem
          token={inviteToken}
          onDone={() => {
            setInviteToken(null)
            void refreshMe()
          }}
        />
      ) : loading ? (
        <div className="grid min-h-screen place-items-center text-slate-400">
          <Icon.Receipt className="animate-pulse text-4xl" />
        </div>
      ) : me ? (
        <Dashboard me={me} onLogout={() => setMe(null)} />
      ) : (
        <Login onLogin={setMe} />
      )}
    </ToastProvider>
  )
}

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.login(email, password)
      onLogin(await api.me())
    } catch {
      setError('メールアドレスまたはパスワードが正しくありません。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-2xl text-white shadow-lg shadow-brand-600/30">
            <Icon.Receipt />
          </div>
          <h1 className="text-lg font-bold text-slate-900">領収書SaaS</h1>
          <p className="text-sm text-slate-500">事務所アカウントでログイン</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && <Alert>{error}</Alert>}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">メールアドレス</span>
              <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">パスワード</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" />
            </label>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? '認証中…' : 'ログイン'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">税理士事務所向け 領収書クラウド</p>
      </div>
    </div>
  )
}

type Tab = 'receipts' | 'journal' | 'ledger' | 'export' | 'masters' | 'clients' | 'users' | 'settings'
// Capability context derived from the principal's memberships.
type Perms = {
  isFirm: boolean        // 職員 (firm_owner/firm_staff)
  isFirmOwner: boolean   // 管理者(職員)
  canJournal: boolean    // 仕分け/出力: 職員 + 利用者(管理者/経理担当者)
  canMasters: boolean    // マスタ: 職員 + 利用者(管理者)
  canClients: boolean    // 顧問先管理: 職員のみ
  canUsers: boolean      // 自社ユーザー管理: 顧客(client_admin)のみ
  canSettings: boolean   // 設定: 管理者(職員)のみ
}
type NavItem = { id: Tab; label: string; icon: IconComponent; needsClient: boolean; can: (p: Perms) => boolean }
const NAV: NavItem[] = [
  { id: 'receipts', label: '受信箱', icon: Icon.Inbox, needsClient: true, can: () => true },
  { id: 'journal', label: '仕分け', icon: Icon.Sort, needsClient: true, can: (p) => p.canJournal },
  { id: 'ledger', label: '元帳', icon: Icon.Book, needsClient: true, can: (p) => p.canJournal },
  { id: 'export', label: '出力', icon: Icon.Download, needsClient: true, can: (p) => p.canJournal },
  { id: 'masters', label: 'マスタ', icon: Icon.Database, needsClient: true, can: (p) => p.canMasters },
  { id: 'clients', label: '顧問先', icon: Icon.Building, needsClient: false, can: (p) => p.canClients },
  { id: 'users', label: 'ユーザー', icon: Icon.User, needsClient: false, can: (p) => p.canUsers },
  { id: 'settings', label: '設定', icon: Icon.Sliders, needsClient: false, can: (p) => p.canSettings || p.canUsers },
]

function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const firmId = useMemo(
    () => me.memberships.find((m) => m.client_id === null)?.firm_id ?? me.memberships[0]?.firm_id ?? '',
    [me],
  )
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientId, setClientId] = useState<string>('')
  const [tab, setTab] = useState<Tab>('receipts')
  const [navOpen, setNavOpen] = useState(false)

  // Role-aware capabilities. 職員=firm-level membership; 利用者=client-level.
  const firmRole = me.memberships.find((m) => m.client_id === null)?.role ?? null
  const clientMembership = me.memberships.find((m) => m.client_id !== null)
  const clientRole = clientMembership?.role ?? null
  const perms: Perms = {
    isFirm: firmRole !== null,
    isFirmOwner: firmRole === 'firm_owner',
    canJournal: firmRole !== null || clientRole === 'client_admin' || clientRole === 'client_accountant',
    canMasters: firmRole !== null || clientRole === 'client_admin',
    // 顧問先は「事務所が抱える顧客」の概念。顧客(client)自身のログインでは顧問先を持たない
    // ので表示しない（管理は事務所職員=firm_owner/firm_staff のみ）。
    canClients: firmRole !== null,
    // 顧客側(client_admin)は自社のユーザーのみ管理できる（顧問先一覧は出さない）。
    canUsers: clientRole === 'client_admin',
    canSettings: firmRole === 'firm_owner',
  }
  // client_admin が自社ユーザーを管理する対象 client_id。
  const selfClientId = clientMembership?.client_id ?? undefined
  // 管理者・経理・職員は他人の領収書も見えるので登録者を表示（一般社員は自分のみ）。
  const canSeeOthers = firmRole !== null || clientRole === 'client_admin' || clientRole === 'client_accountant'
  const nav = NAV.filter((t) => t.can(perms))
  const active = nav.find((t) => t.id === tab) ?? nav[0]

  async function reloadClients() {
    const rows = await api.clients()
    setClients(rows)
    setClientId((prev) => prev || rows[0]?.id || '')
  }
  useEffect(() => {
    reloadClients().catch(() => setClients([]))
  }, [])

  function go(id: Tab) {
    setTab(id)
    setNavOpen(false)
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar nav={nav} tab={tab} onGo={go} className="hidden lg:flex" />

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/40" onClick={() => setNavOpen(false)} />
          <Sidebar nav={nav} tab={tab} onGo={go} className="absolute left-0 top-0 h-full animate-slide-up" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setNavOpen(true)} aria-label="メニュー">
            <Icon.Menu className="text-xl" />
          </button>
          {active.needsClient && perms.isFirm && clients.length > 1 && (
            <div className="flex items-center gap-2">
              <Icon.Building className="text-slate-400" />
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-44 sm:w-56">
                {clients.length === 0 && <option value="">顧問先なし</option>}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex-1" />
          <UserMenu email={me.user.email} name={me.user.name} onLogout={onLogout} />
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-5 sm:p-6">
          {tab === 'receipts' && <ReceiptsView clientId={clientId} showCreator={canSeeOthers} />}
          {tab === 'journal' && <JournalView clientId={clientId} showCreator={canSeeOthers} />}
          {tab === 'ledger' && <LedgerView clientId={clientId} showCreator={canSeeOthers} />}
          {tab === 'export' && <ExportView clientId={clientId} />}
          {tab === 'masters' && <MastersView clientId={clientId} firmId={firmId} />}
          {tab === 'clients' && <ClientsView onChanged={reloadClients} canManage={perms.isFirmOwner} />}
          {tab === 'users' && selfClientId && (
            <>
              <PageHeader title="ユーザー" description="自社のユーザーを管理します。" />
              <ClientUsers clientId={selfClientId} />
            </>
          )}
          {tab === 'settings' &&
            (perms.isFirmOwner ? (
              <SettingsView firmId={firmId} />
            ) : selfClientId ? (
              <>
                <PageHeader title="設定" description="自社のAI設定・メール連携を管理します。" />
                <div className="space-y-5">
                  <ClientAiConfig clientId={selfClientId} />
                  <GmailLink clientId={selfClientId} />
                </div>
              </>
            ) : null)}
        </main>
      </div>
    </div>
  )
}

function Sidebar({
  nav,
  tab,
  onGo,
  className,
}: {
  nav: NavItem[]
  tab: Tab
  onGo: (id: Tab) => void
  className?: string
}) {
  return (
    <aside className={cn('flex w-60 flex-col border-r border-slate-200 bg-white', className)}>
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-lg text-white shadow-sm">
          <Icon.Receipt />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-slate-900">領収書SaaS</div>
          <div className="text-[11px] text-slate-400">税理士事務所向け</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {nav.map((t) => {
          const ActiveIcon = t.icon
          const on = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => onGo(t.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                on ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <ActiveIcon className={cn('text-lg', on ? 'text-brand-600' : 'text-slate-400')} />
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className="px-5 py-3 text-[11px] text-slate-400">v0.1 · LAN</div>
    </aside>
  )
}

function UserMenu({ email, name, onLogout }: { email: string; name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-slate-100"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {initial}
        </span>
        <span className="hidden max-w-[12rem] truncate text-slate-600 sm:block">{email}</span>
        <Icon.ChevronDown className="hidden text-slate-400 sm:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-56 animate-scale-in rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
            <div className="border-b border-slate-100 px-3 py-2">
              {name && <div className="truncate text-sm font-medium text-slate-800">{name}</div>}
              <div className="truncate text-xs text-slate-500">{email}</div>
            </div>
            <button
              onClick={async () => { setOpen(false); await api.logout(); onLogout() }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              <Icon.LogOut className="text-base text-slate-400" />
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  )
}
