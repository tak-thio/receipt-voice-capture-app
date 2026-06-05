import { useEffect, useState } from 'react'
import { api, type ClientDetail, type ClientRow, type MemberRow } from '../api'

const FORMATS = ['generic', 'mas', 'freee', 'yayoi']

export function ClientsView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [newName, setNewName] = useState('')
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [users, setUsers] = useState<MemberRow[]>([])
  const [qr, setQr] = useState<{ userId: string; png: string } | null>(null)
  const [nu, setNu] = useState({ name: '', email: '', phone: '' })
  const [msg, setMsg] = useState('')

  async function loadClients() {
    setClients(await api.clients())
  }
  useEffect(() => {
    void loadClients()
  }, [])

  async function select(id: string) {
    setQr(null)
    setMsg('')
    setDetail(await api.client(id))
    setUsers(await api.clientUsers(id).catch(() => []))
  }

  async function addClient() {
    if (!newName) return
    const r = await api.createClient(newName)
    setNewName('')
    await loadClients()
    await onChanged()
    await select(r.id)
  }

  function set<K extends keyof ClientDetail>(k: K, v: ClientDetail[K]) {
    setDetail((d) => (d ? { ...d, [k]: v } : d))
  }
  async function saveDetail() {
    if (!detail) return
    await api.patchClient(detail.id, detail)
    setMsg('顧問先情報を保存しました。')
    await loadClients()
    await onChanged()
  }

  async function addUser() {
    if (!detail || !nu.name) return
    await api.createClientUser(detail.id, {
      name: nu.name,
      email: nu.email || undefined,
      phone: nu.phone || undefined,
    })
    setNu({ name: '', email: '', phone: '' })
    setUsers(await api.clientUsers(detail.id))
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
        <h3 className="mb-2 font-semibold">顧問先</h3>
        <div className="mb-3 flex gap-2">
          <input className={`flex-1 ${F}`} placeholder="新規顧問先名" value={newName}
            onChange={(e) => setNewName(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addClient()}>追加</button>
        </div>
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id} onClick={() => void select(c.id)}
              className={`cursor-pointer py-2 ${detail?.id === c.id ? 'font-semibold text-blue-700' : 'hover:bg-stone-50'}`}>
              {c.name} <span className="text-stone-400">{c.code ?? ''}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 lg:col-span-2">
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
              <h3 className="mb-3 font-semibold">利用者</h3>
              <div className="mb-3 flex flex-wrap gap-2">
                <input className={F} placeholder="氏名" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
                <input className={F} placeholder="メール(任意)" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
                <input className={F} placeholder="電話(任意)" value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} />
                <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addUser()}>利用者を追加</button>
              </div>
              <ul className="divide-y text-sm">
                {users.map((u) => (
                  <li key={u.user_id} className="py-2">
                    <div className="flex items-center justify-between">
                      <span>
                        {u.name || u.email}
                        {u.phone && <span className="ml-1 text-xs text-stone-400">{u.phone}</span>}
                        {u.status === 'disabled' && (
                          <span className="ml-1 rounded bg-stone-200 px-1.5 text-xs text-stone-600">無効</span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <button className="rounded border px-2 py-1 text-xs hover:bg-stone-100" onClick={() => void issueQr(u.user_id)}>QR発行</button>
                        <select className="rounded border px-1.5 py-0.5 text-xs" value={u.role}
                          onChange={async (e) => { await api.setClientUserRole(detail.id, u.user_id, e.target.value); setUsers(await api.clientUsers(detail.id)) }}>
                          <option value="client_admin">管理者</option>
                          <option value="client_accountant">経理担当者</option>
                          <option value="client_user">一般社員</option>
                        </select>
                        <button className="text-xs text-stone-600 hover:underline"
                          onClick={async () => { await api.patchClientUser(detail.id, u.user_id, { status: u.status === 'disabled' ? 'active' : 'disabled' }); setUsers(await api.clientUsers(detail.id)) }}>
                          {u.status === 'disabled' ? '有効化' : '無効化'}
                        </button>
                        <button className="text-xs text-red-600 hover:underline"
                          onClick={async () => { await api.removeClientUser(detail.id, u.user_id); setUsers(await api.clientUsers(detail.id)) }}>削除</button>
                      </div>
                    </div>
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
