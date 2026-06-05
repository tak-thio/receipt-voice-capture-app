import { useEffect, useState } from 'react'
import { api, type MasterRow } from '../api'

export function MastersView({ clientId, firmId }: { clientId: string; firmId: string }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [atCode, setAtCode] = useState('')
  const [atName, setAtName] = useState('')
  const [pName, setPName] = useState('')
  const [pDomain, setPDomain] = useState('')

  async function load() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function addTitle() {
    if (!atCode || !atName) return
    await api.createAccountTitle({ firm_id: firmId, client_id: clientId, code: atCode, name: atName })
    setAtCode('')
    setAtName('')
    await load()
  }
  async function addPartner() {
    if (!pName) return
    await api.createPartner({ firm_id: firmId, client_id: clientId, name: pName, domain: pDomain || undefined })
    setPName('')
    setPDomain('')
    await load()
  }

  if (!clientId) return <p className="text-stone-400">顧問先を選択してください。</p>

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">勘定科目(テンプレ＋顧問先上書き)</h3>
        <div className="mb-3 flex gap-2">
          <input className="w-24 rounded-lg border px-2 py-1.5 text-sm" placeholder="コード"
            value={atCode} onChange={(e) => setAtCode(e.target.value)} />
          <input className="flex-1 rounded-lg border px-2 py-1.5 text-sm" placeholder="科目名"
            value={atName} onChange={(e) => setAtName(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addTitle()}>
            追加
          </button>
        </div>
        <ul className="divide-y text-sm">
          {titles.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-1.5">
              <span><span className="text-stone-400">{t.code}</span> {t.name}</span>
              <span className="text-xs text-stone-400">{t.scope === 'client' ? '顧問先' : 'テンプレ'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">取引先</h3>
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded-lg border px-2 py-1.5 text-sm" placeholder="取引先名"
            value={pName} onChange={(e) => setPName(e.target.value)} />
          <input className="w-40 rounded-lg border px-2 py-1.5 text-sm" placeholder="ドメイン(任意)"
            value={pDomain} onChange={(e) => setPDomain(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addPartner()}>
            追加
          </button>
        </div>
        <ul className="divide-y text-sm">
          {partners.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5">
              <span>{p.name}</span>
              <span className="text-xs text-stone-400">{p.domain ?? ''}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
