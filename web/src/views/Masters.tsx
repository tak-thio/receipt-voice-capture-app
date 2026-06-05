import { useEffect, useState } from 'react'
import { api, type MasterRow } from '../api'

export function MastersView({ clientId, firmId }: { clientId: string; firmId: string }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [atCode, setAtCode] = useState('')
  const [atName, setAtName] = useState('')
  const [pName, setPName] = useState('')
  const [pDomain, setPDomain] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState({ code: '', name: '' })
  const [editPartner, setEditPartner] = useState({ name: '', domain: '' })
  const [err, setErr] = useState('')

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
  async function saveTitle(id: string) {
    try {
      await api.patchAccountTitle(id, { code: editTitle.code, name: editTitle.name })
      setEditId(null)
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }
  async function delTitle(t: MasterRow) {
    if (!window.confirm(`勘定科目「${t.name}」を削除しますか?`)) return
    await api.deleteAccountTitle(t.id)
    await load()
  }

  async function addPartner() {
    if (!pName) return
    await api.createPartner({ firm_id: firmId, client_id: clientId, name: pName, domain: pDomain || undefined })
    setPName('')
    setPDomain('')
    await load()
  }
  async function savePartner(id: string) {
    try {
      await api.patchPartner(id, { name: editPartner.name, domain: editPartner.domain || undefined })
      setEditId(null)
      await load()
    } catch (e) {
      setErr(String(e))
    }
  }
  async function delPartner(p: MasterRow) {
    if (!window.confirm(`取引先「${p.name}」を削除しますか?`)) return
    await api.deletePartner(p.id)
    await load()
  }

  const F = 'rounded-lg border px-2 py-1.5 text-sm'
  if (!clientId) return <p className="text-stone-400">顧問先を選択してください。</p>

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {err && <p className="text-sm text-red-600 lg:col-span-2">{err}</p>}
      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">勘定科目(テンプレ＋顧問先上書き)</h3>
        <div className="mb-3 flex gap-2">
          <input className={`w-24 ${F}`} placeholder="コード" value={atCode} onChange={(e) => setAtCode(e.target.value)} />
          <input className={`flex-1 ${F}`} placeholder="科目名" value={atName} onChange={(e) => setAtName(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addTitle()}>追加</button>
        </div>
        <ul className="divide-y text-sm">
          {titles.map((t) => (
            <li key={t.id} className="py-1.5">
              {editId === t.id ? (
                <div className="flex items-center gap-2">
                  <input className={`w-24 ${F}`} value={editTitle.code} onChange={(e) => setEditTitle({ ...editTitle, code: e.target.value })} />
                  <input className={`flex-1 ${F}`} value={editTitle.name} onChange={(e) => setEditTitle({ ...editTitle, name: e.target.value })} />
                  <button className="rounded bg-stone-800 px-2 py-1 text-xs text-white" onClick={() => void saveTitle(t.id)}>保存</button>
                  <button className="text-xs text-stone-500 hover:underline" onClick={() => setEditId(null)}>取消</button>
                </div>
              ) : (
                <div className="group flex items-center justify-between">
                  <span><span className="text-stone-400">{t.code}</span> {t.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">{t.scope === 'client' ? '顧問先' : 'テンプレ'}</span>
                    <button className="hidden text-xs text-stone-600 hover:underline group-hover:inline"
                      onClick={() => { setEditId(t.id); setEditTitle({ code: t.code ?? '', name: t.name }) }}>編集</button>
                    <button className="hidden text-xs text-red-600 hover:underline group-hover:inline" onClick={() => void delTitle(t)}>削除</button>
                  </span>
                </div>
              )}
            </li>
          ))}
          {titles.length === 0 && <li className="py-2 text-stone-400">なし</li>}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-2 font-semibold">取引先</h3>
        <div className="mb-3 flex gap-2">
          <input className={`flex-1 ${F}`} placeholder="取引先名" value={pName} onChange={(e) => setPName(e.target.value)} />
          <input className={`w-40 ${F}`} placeholder="ドメイン(任意)" value={pDomain} onChange={(e) => setPDomain(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void addPartner()}>追加</button>
        </div>
        <ul className="divide-y text-sm">
          {partners.map((p) => (
            <li key={p.id} className="py-1.5">
              {editId === p.id ? (
                <div className="flex items-center gap-2">
                  <input className={`flex-1 ${F}`} value={editPartner.name} onChange={(e) => setEditPartner({ ...editPartner, name: e.target.value })} />
                  <input className={`w-40 ${F}`} value={editPartner.domain} onChange={(e) => setEditPartner({ ...editPartner, domain: e.target.value })} />
                  <button className="rounded bg-stone-800 px-2 py-1 text-xs text-white" onClick={() => void savePartner(p.id)}>保存</button>
                  <button className="text-xs text-stone-500 hover:underline" onClick={() => setEditId(null)}>取消</button>
                </div>
              ) : (
                <div className="group flex items-center justify-between">
                  <span>{p.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">{p.domain ?? ''}</span>
                    <button className="hidden text-xs text-stone-600 hover:underline group-hover:inline"
                      onClick={() => { setEditId(p.id); setEditPartner({ name: p.name, domain: p.domain ?? '' }) }}>編集</button>
                    <button className="hidden text-xs text-red-600 hover:underline group-hover:inline" onClick={() => void delPartner(p)}>削除</button>
                  </span>
                </div>
              )}
            </li>
          ))}
          {partners.length === 0 && <li className="py-2 text-stone-400">なし</li>}
        </ul>
      </section>
    </div>
  )
}
