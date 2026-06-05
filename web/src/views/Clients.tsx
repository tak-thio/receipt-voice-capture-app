import { useEffect, useState } from 'react'
import { api, type ClientRow } from '../api'

export function ClientsView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [qr, setQr] = useState<{ clientName: string; png: string; token: string } | null>(null)

  async function load() {
    setClients(await api.clients())
  }
  useEffect(() => {
    void load()
  }, [])

  async function addClient() {
    if (!name) return
    await api.createClient(name, code || undefined)
    setName('')
    setCode('')
    await load()
    await onChanged()
  }

  async function issue(c: ClientRow) {
    const r = await api.issuePairing(c.id)
    setQr({ clientName: c.name, png: r.qr_png_base64, token: r.token })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">顧問先</h3>
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded-lg border px-2 py-1.5 text-sm" placeholder="顧問先名"
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-28 rounded-lg border px-2 py-1.5 text-sm" placeholder="コード"
            value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addClient()}>
            追加
          </button>
        </div>
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span>{c.name} <span className="text-stone-400">{c.code ?? ''}</span></span>
              <button className="rounded-lg border px-3 py-1 text-sm hover:bg-stone-100" onClick={() => void issue(c)}>
                QR発行
              </button>
            </li>
          ))}
          {clients.length === 0 && <li className="py-3 text-stone-400">顧問先がありません。</li>}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">ペアリングQR</h3>
        {qr ? (
          <div className="space-y-2 text-sm">
            <p>{qr.clientName} 用(15分有効)。スマホアプリの「設定 → 動作モード → サーバ連携 → QRスキャン」で読み取ってください。</p>
            <img alt="pairing qr" className="h-48 w-48 border" src={`data:image/png;base64,${qr.png}`} />
            <p className="break-all text-xs text-stone-400">token: {qr.token}</p>
          </div>
        ) : (
          <p className="text-stone-400">顧問先の「QR発行」を押すと表示されます。</p>
        )}
      </section>
    </div>
  )
}
