import { useEffect, useState } from 'react'
import { api, type ClientDetail, type ClientRow, type MemberRow } from '../api'

const FORMATS = ['generic', 'mas', 'freee', 'yayoi']

export function ClientsView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', code: '' })
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [users, setUsers] = useState<MemberRow[]>([])
  const [qr, setQr] = useState<{ userId: string; png: string } | null>(null)
  const [editUser, setEditUser] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', password: '' })
  const [nu, setNu] = useState({ name: '', email: '', phone: '', password: '', role: 'client_user' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function loadClients() {
    setClients(await api.clients(search.trim() || undefined))
  }
  useEffect(() => {
    const t = setTimeout(() => void loadClients(), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function select(id: string) {
    setQr(null)
    setMsg('')
    setErr('')
    setEditUser(null)
    setDetail(await api.client(id))
    setUsers(await api.clientUsers(id).catch(() => []))
  }

  async function addClient() {
    if (!newClient.name.trim()) return
    try {
      const r = await api.createClient(newClient.name.trim(), newClient.code.trim() || undefined)
      setNewClient({ name: '', code: '' })
      setShowNew(false)
      await loadClients()
      await onChanged()
      await select(r.id)
    } catch (e) {
      setErr(String(e))
    }
  }

  async function removeClient(c: ClientRow) {
    if (!window.confirm(`顧問先「${c.name}」を削除(アーカイブ)しますか?`)) return
    try {
      await api.deleteClient(c.id)
      if (detail?.id === c.id) setDetail(null)
      await loadClients()
      await onChanged()
    } catch (e) {
      setErr(String(e))
    }
  }

  function set<K extends keyof ClientDetail>(k: K, v: ClientDetail[K]) {
    setDetail((d) => (d ? { ...d, [k]: v } : d))
  }
  async function saveDetail() {
    if (!detail) return
    try {
      await api.patchClient(detail.id, detail)
      setMsg('顧問先情報を保存しました。')
      setErr('')
      await loadClients()
      await onChanged()
    } catch (e) {
      setErr(String(e))
    }
  }

  async function reloadUsers() {
    if (detail) setUsers(await api.clientUsers(detail.id))
  }

  async function addUser() {
    if (!detail || !nu.name.trim()) return
    try {
      await api.createClientUser(detail.id, {
        name: nu.name.trim(),
        email: nu.email.trim() || undefined,
        phone: nu.phone.trim() || undefined,
        password: nu.password || undefined,
        role: nu.role,
      })
      setNu({ name: '', email: '', phone: '', password: '', role: 'client_user' })
      setErr('')
      await reloadUsers()
    } catch (e) {
      setErr(String(e))
    }
  }

  function openEdit(u: MemberRow) {
    if (editUser === u.user_id) {
      setEditUser(null)
      return
    }
    setEditUser(u.user_id)
    setEditForm({ name: u.name || '', email: u.login_id || '', phone: u.phone || '', password: '' })
  }
  async function saveEdit(u: MemberRow) {
    if (!detail) return
    const patch: { name?: string; email?: string; phone?: string; password?: string } = {}
    if (editForm.name !== (u.name || '')) patch.name = editForm.name
    if (editForm.email !== (u.login_id || '')) patch.email = editForm.email.trim()
    if (editForm.phone !== (u.phone || '')) patch.phone = editForm.phone.trim()
    if (editForm.password) patch.password = editForm.password
    try {
      await api.patchClientUser(detail.id, u.user_id, patch)
      setEditUser(null)
      setErr('')
      await reloadUsers()
    } catch (e) {
      setErr(String(e))
    }
  }

  async function issueQr(userId: string) {
    if (!detail) return
    const r = await api.issuePairing(detail.id, userId)
    setQr({ userId, png: r.qr_png_base64 })
  }

  const F = 'rounded-lg border px-2 py-1.5 text-sm'

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-xl bg-white p-4 shadow">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">顧問先</h3>
          <button className="rounded-lg border px-2 py-1 text-xs hover:bg-stone-100"
            onClick={() => setShowNew((s) => !s)}>{showNew ? '閉じる' : '＋新規'}</button>
        </div>
        <input className={`mb-3 w-full ${F}`} placeholder="検索(名称・コード)" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        {showNew && (
          <div className="mb-3 space-y-2 rounded-lg border bg-stone-50 p-2">
            <input className={`w-full ${F}`} placeholder="顧問先名 *" value={newClient.name}
              onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
            <input className={`w-full ${F}`} placeholder="コード(任意)" value={newClient.code}
              onChange={(e) => setNewClient({ ...newClient, code: e.target.value })} />
            <button className="w-full rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white"
              onClick={() => void addClient()}>登録</button>
          </div>
        )}
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id}
              className={`group flex items-center justify-between py-2 ${detail?.id === c.id ? 'font-semibold text-blue-700' : ''}`}>
              <span className="flex-1 cursor-pointer hover:underline" onClick={() => void select(c.id)}>
                {c.name} <span className="text-stone-400">{c.code ?? ''}</span>
              </span>
              <button className="ml-2 hidden text-xs text-red-600 hover:underline group-hover:inline"
                onClick={() => void removeClient(c)}>削除</button>
            </li>
          ))}
          {clients.length === 0 && <li className="py-2 text-stone-400">該当なし</li>}
        </ul>
      </section>

      <section className="space-y-4 lg:col-span-2">
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!detail ? (
          <div className="rounded-xl bg-white p-6 text-stone-400 shadow">顧問先を選択してください。</div>
        ) : (
          <>
            {msg && <p className="text-sm text-green-700">{msg}</p>}
            <div className="rounded-xl bg-white p-4 shadow">
              <h3 className="mb-3 font-semibold">{detail.name} の情報</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="space-y-1"><span className="text-stone-500">名称</span>
                  <input className={`w-full ${F}`} value={detail.name} onChange={(e) => set('name', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-stone-500">コード</span>
                  <input className={`w-full ${F}`} value={detail.code ?? ''} onChange={(e) => set('code', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-stone-500">区分</span>
                  <select className={`w-full ${F}`} value={detail.entity_type ?? ''} onChange={(e) => set('entity_type', e.target.value)}>
                    <option value="">—</option><option value="corporation">法人</option><option value="individual">個人</option>
                  </select></label>
                <label className="space-y-1"><span className="text-stone-500">インボイス登録番号</span>
                  <input className={`w-full ${F}`} value={detail.t_number ?? ''} onChange={(e) => set('t_number', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-stone-500">決算月</span>
                  <input type="number" min={1} max={12} className={`w-full ${F}`} value={detail.fiscal_month ?? ''} onChange={(e) => set('fiscal_month', e.target.value ? Number(e.target.value) : null)} /></label>
                <label className="space-y-1"><span className="text-stone-500">業種</span>
                  <input className={`w-full ${F}`} value={detail.industry ?? ''} onChange={(e) => set('industry', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-stone-500">会計ソフト(既定出力)</span>
                  <select className={`w-full ${F}`} value={detail.export_default} onChange={(e) => set('export_default', e.target.value)}>
                    {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select></label>
                <label className="space-y-1"><span className="text-stone-500">電話</span>
                  <input className={`w-full ${F}`} value={detail.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
                <label className="col-span-2 space-y-1"><span className="text-stone-500">住所</span>
                  <input className={`w-full ${F}`} value={detail.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
                <label className="space-y-1"><span className="text-stone-500">先方担当者</span>
                  <input className={`w-full ${F}`} value={detail.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} /></label>
                <label className="col-span-2 space-y-1"><span className="text-stone-500">メモ</span>
                  <textarea className={`w-full ${F}`} rows={2} value={detail.memo ?? ''} onChange={(e) => set('memo', e.target.value)} /></label>
              </div>
              <button className="mt-3 rounded-lg bg-stone-800 px-4 py-1.5 text-sm text-white" onClick={() => void saveDetail()}>保存</button>
            </div>

            <div className="rounded-xl bg-white p-4 shadow">
              <h3 className="mb-1 font-semibold">利用者</h3>
              <p className="mb-3 text-xs text-stone-500">
                PCで確認する人は<strong>ログインID(メール)+パスワード</strong>を設定。スマホアプリだけ使う人はIDなしで作成しQRで連携。
              </p>
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border bg-stone-50 p-2 sm:grid-cols-3">
                <input className={F} placeholder="氏名 *" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
                <input className={F} placeholder="ログインID(メール・任意)" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
                <input className={F} type="password" placeholder="パスワード(PC利用時)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
                <input className={F} placeholder="電話(任意)" value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} />
                <select className={F} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
                  <option value="client_admin">管理者</option>
                  <option value="client_accountant">経理担当者</option>
                  <option value="client_user">一般社員</option>
                </select>
                <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addUser()}>利用者を追加</button>
              </div>
              <ul className="divide-y text-sm">
                {users.map((u) => (
                  <li key={u.user_id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{u.name || '(無名)'}</span>
                        <span className="ml-2 text-xs text-stone-400">
                          {u.login_id ? u.login_id : 'アプリ専用'}
                        </span>
                        {u.password_set && <span className="ml-1 rounded bg-blue-100 px-1 text-xs text-blue-700">PCログイン可</span>}
                        {u.phone && <span className="ml-1 text-xs text-stone-400">{u.phone}</span>}
                        {u.status === 'disabled' && (
                          <span className="ml-1 rounded bg-stone-200 px-1.5 text-xs text-stone-600">無効</span>
                        )}
                      </span>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <button className="rounded border px-2 py-1 text-xs hover:bg-stone-100" onClick={() => void issueQr(u.user_id)}>QR</button>
                        <select className="rounded border px-1.5 py-0.5 text-xs" value={u.role}
                          onChange={async (e) => { await api.setClientUserRole(detail.id, u.user_id, e.target.value); await reloadUsers() }}>
                          <option value="client_admin">管理者</option>
                          <option value="client_accountant">経理担当者</option>
                          <option value="client_user">一般社員</option>
                        </select>
                        <button className="text-xs text-stone-600 hover:underline" onClick={() => openEdit(u)}>
                          {editUser === u.user_id ? '取消' : '編集'}
                        </button>
                        <button className="text-xs text-stone-600 hover:underline"
                          onClick={async () => { await api.patchClientUser(detail.id, u.user_id, { status: u.status === 'disabled' ? 'active' : 'disabled' }); await reloadUsers() }}>
                          {u.status === 'disabled' ? '有効化' : '無効化'}
                        </button>
                        <button className="text-xs text-red-600 hover:underline"
                          onClick={async () => { if (window.confirm(`${u.name || u.email} を削除しますか?`)) { await api.removeClientUser(detail.id, u.user_id); await reloadUsers() } }}>削除</button>
                      </div>
                    </div>
                    {editUser === u.user_id && (
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border bg-stone-50 p-2 sm:grid-cols-4">
                        <input className={F} placeholder="氏名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        <input className={F} placeholder="ログインID(メール)" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                        <input className={F} placeholder="電話" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                        <input className={F} type="password" placeholder="新パスワード(変更時)" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
                        <button className="col-span-2 rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white sm:col-span-4" onClick={() => void saveEdit(u)}>保存</button>
                      </div>
                    )}
                    {qr?.userId === u.user_id && (
                      <img alt="qr" className="mt-2 h-40 w-40 border" src={`data:image/png;base64,${qr.png}`} />
                    )}
                  </li>
                ))}
                {users.length === 0 && <li className="py-2 text-stone-400">利用者なし</li>}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
