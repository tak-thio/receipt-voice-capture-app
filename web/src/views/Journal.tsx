import { useEffect, useState } from 'react'
import { api, type MasterRow } from '../api'

interface QueueItem {
  id: string
  vendor: string | null
  amount_jpy: number | null
}
type Pick = { account?: string; partner?: string }

export function JournalView({ clientId }: { clientId: string }) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [msg, setMsg] = useState('')

  async function load() {
    if (!clientId) return
    const [q, t, p] = await Promise.all([
      api.journalQueue(clientId),
      api.accountTitles(clientId),
      api.partners(clientId),
    ])
    setQueue(q)
    setTitles(t)
    setPartners(p)
    const next: Record<string, Pick> = {}
    for (const item of q) {
      try {
        const s = await api.suggest(item.id)
        next[item.id] = { account: s.account_title_id ?? undefined, partner: s.partner_id ?? undefined }
      } catch {
        next[item.id] = {}
      }
    }
    setPicks(next)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  function update(id: string, patch: Pick) {
    setPicks((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function confirm(id: string) {
    const pick = picks[id] || {}
    await api.journalize(id, {
      account_title_id: pick.account ?? null,
      partner_id: pick.partner ?? null,
    })
    setMsg('仕分けを確定しました。')
    await load()
  }

  async function hold(id: string) {
    await api.hold(id)
    await load()
  }

  if (!clientId) return <p className="text-stone-400">顧問先を選択してください。</p>

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">
        未仕分け {queue.length}件{msg && ` · ${msg}`}
      </p>
      {queue.map((item) => {
        const pick = picks[item.id] || {}
        return (
          <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow">
            <div className="min-w-40">
              <div className="font-medium">{item.vendor ?? '(支払先なし)'}</div>
              <div className="text-sm text-stone-500">{item.amount_jpy?.toLocaleString() ?? '—'} 円</div>
            </div>
            <select
              className="rounded-lg border px-2 py-1.5 text-sm"
              value={pick.partner ?? ''}
              onChange={(e) => update(item.id, { partner: e.target.value || undefined })}
            >
              <option value="">取引先...</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              className="rounded-lg border px-2 py-1.5 text-sm"
              value={pick.account ?? ''}
              onChange={(e) => update(item.id, { account: e.target.value || undefined })}
            >
              <option value="">勘定科目...</option>
              {titles.map((t) => (
                <option key={t.id} value={t.id}>{t.code} {t.name}</option>
              ))}
            </select>
            <div className="ml-auto flex gap-2">
              <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void hold(item.id)}>
                保留
              </button>
              <button
                className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white"
                onClick={() => void confirm(item.id)}
              >
                確定
              </button>
            </div>
          </div>
        )
      })}
      {queue.length === 0 && <p className="text-stone-400">未仕分けの領収書はありません。</p>}
    </div>
  )
}
