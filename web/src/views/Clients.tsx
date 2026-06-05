import { useEffect, useState } from 'react'
import { api, type ClientRow, type MemberRow } from '../api'

export function ClientsView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [users, setUsers] = useState<MemberRow[]>([])
  const [qr, setQr] = useState<{ png: string; token: string } | null>(null)
  const [invite, setInvite] = useState('')

  async function load() {
    setClients(await api.clients())
  }
  useEffect(() => {
    void load()
  }, [])

  async function select(c: ClientRow) {
    setSelected(c)
    setQr(null)
    setInvite('')
    setUsers(await api.clientUsers(c.id).catch(() => []))
  }

  async function addClient() {
    if (!name) return
    await api.createClient(name, code || undefined)
    setName('')
    setCode('')
    await load()
    await onChanged()
  }

  async function issueQr() {
    if (!selected) return
    const r = await api.issuePairing(selected.id)
    setQr({ png: r.qr_png_base64, token: r.token })
  }

  async function inviteUser(role: string) {
    if (!selected) return
    const r = await api.createInvite({ role, client_id: selected.id })
    setInvite(`${window.location.origin}${r.redeem_path}`)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">顧問先</h3>
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded-lg border px-2 py-1.5 text-sm" placeholder="顧問先名"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-24 rounded-lg border px-2 py-1.5 text-sm" placeholder="コード"
            value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addClient()}>
            追加
          </button>
        </div>
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id}
              onClick={() => void select(c)}
              className={`flex cursor-pointer items-center justify-between py-2 ${selected?.id === c.id ? 'bg-blue-50' : 'hover:bg-stone-50'}`}>
              <span>{c.name} <span className="text-stone-400">{c.code ?? ''}</span></span>
            </li>
          ))}
          {clients.length === 0 && <li className="py-3 text-stone-400">顧問先がありません。</li>}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        {!selected ? (
          <p className="text-stone-400">顧問先を選ぶと、ユーザー・ペアリングQRを管理できます。</p>
        ) : (
          <div className="space-y-4">
            <h3 className="font-semibold">{selected.name}</h3>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">ユーザー(PC事務員・入力者)</span>
                <div className="flex gap-2">
                  <button className="rounded border px-2 py-1 text-xs hover:bg-stone-100" onClick={() => void inviteUser('client_admin')}>管理者を招待</button>
                  <button className="rounded border px-2 py-1 text-xs hover:bg-stone-100" onClick={() => void inviteUser('client_user')}>入力者を招待</button>
                </div>
              </div>
              {invite && (
                <div className="mb-2 break-all rounded border border-blue-200 bg-blue-50 p-2 font-mono text-xs">{invite}</div>
              )}
              <ul className="divide-y text-sm">
                {users.map((u) => (
                  <li key={u.user_id} className="flex items-center justify-between py-1.5">
                    <span>{u.email}</span>
                    <div className="flex items-center gap-2">
                      <select className="rounded border px-1.5 py-0.5 text-xs" value={u.role}
                        onChange={async (e) => { await api.setClientUserRole(selected.id, u.user_id, e.target.value); setUsers(await api.clientUsers(selected.id)) }}>
                        <option value="client_admin">管理者</option>
                        <option value="client_user">入力者</option>
                      </select>
                      <button className="text-xs text-red-600 hover:underline"
                        onClick={async () => { await api.removeClientUser(selected.id, u.user_id); setUsers(await api.clientUsers(selected.id)) }}>削除</button>
                    </div>
                  </li>
                ))}
                {users.length === 0 && <li className="py-2 text-stone-400">ユーザーなし</li>}
              </ul>
            </div>

            <div className="border-t pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">スマホ ペアリングQR</span>
                <button className="rounded border px-2 py-1 text-xs hover:bg-stone-100" onClick={() => void issueQr()}>QR発行</button>
              </div>
              {qr && (
                <div className="space-y-1 text-xs">
                  <img alt="pairing qr" className="h-40 w-40 border" src={`data:image/png;base64,${qr.png}`} />
                  <p className="break-all text-stone-400">token: {qr.token}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
