import { useEffect, useState } from 'react'
import { api, type MasterRow, type QueueItem } from '../api'

type Mode = 'queue' | 'held'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

// Single-item "拡大表示" journaling, ported from receipt-app's UX: focus the top
// item, pick the account title with a button, see the receipt image, 処理して次へ.
export function JournalView({ clientId }: { clientId: string }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [heldCount, setHeldCount] = useState(0)
  const [mode, setMode] = useState<Mode>('queue')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [titleId, setTitleId] = useState('')
  const [partnerId, setPartnerId] = useState('')

  async function loadMasters() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
  }
  async function loadQueue(m: Mode = mode) {
    if (!clientId) return
    const res = await api.journalQueue(clientId, m)
    setItems(res.items)
    setTotal(res.total)
    setHeldCount(res.held_count)
  }
  useEffect(() => {
    setActiveIndex(0)
    Promise.all([loadMasters(), loadQueue('queue')]).catch((e) => setError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const activeIdx = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0
  const top = items[activeIdx] ?? null

  // When the focused item changes, prefill selectors from its suggestion.
  useEffect(() => {
    if (!top) return
    setTitleId(top.account_title_id ?? top.suggestion.account_title_id ?? '')
    setPartnerId(top.partner_id ?? top.suggestion.partner_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id])

  function switchMode(m: Mode) {
    if (m === mode) return
    setMode(m)
    setActiveIndex(0)
    loadQueue(m).catch((e) => setError(String(e)))
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await loadQueue()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function handleSkip() {
    if (items.length > 1) setActiveIndex((activeIdx + 1) % items.length)
  }
  function handleProcess() {
    if (!top || !titleId) return
    void act(() =>
      api.journalize(top.id, { account_title_id: titleId, partner_id: partnerId || null }),
    )
  }

  if (!clientId) return <p className="text-stone-400">顧問先を選択してください。</p>

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium">仕分け</h2>
          <div className="ml-2 flex gap-1">
            <button
              onClick={() => switchMode('queue')}
              className={`rounded px-3 py-1 text-sm ${mode === 'queue' ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              未仕分け
            </button>
            <button
              onClick={() => switchMode('held')}
              className={`rounded px-3 py-1 text-sm ${mode === 'held' ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              保留 {heldCount}
            </button>
          </div>
        </div>
        <span className="text-sm text-stone-500">
          {mode === 'queue' ? '未仕分け' : '保留'} 残り {total} 件
        </span>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {titles.length === 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          勘定科目が未登録です。「マスタ」タブで登録してください。
        </div>
      )}

      {!top ? (
        <div className="rounded-lg bg-white p-10 text-center text-stone-500 shadow">
          {mode === 'queue' ? '未仕分けの領収書はありません 🎉' : '保留中の領収書はありません'}
        </div>
      ) : (
        <>
          <div className="space-y-4 rounded-lg border-2 border-blue-500 bg-white p-6 shadow">
            <div className="flex items-baseline gap-3">
              <span className="text-lg font-semibold">{top.vendor || '(店舗名なし)'}</span>
              <span className="text-lg font-semibold">{yen(top.amount_jpy)}</span>
              <span className="text-xs text-stone-400">{top.date ?? '—'} · {top.source}</span>
              {top.t_number && <span className="rounded bg-stone-100 px-2 py-0.5 text-xs">T{top.t_number}</span>}
            </div>

            {/* receipt image (replaces receipt-app's email body) */}
            <div className="flex h-80 items-center justify-center overflow-hidden rounded border bg-stone-50">
              {top.image_file_id ? (
                <img
                  src={api.fileUrl(top.image_file_id)}
                  alt="領収書"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-sm text-stone-400">画像なし</span>
              )}
            </div>

            {/* account title — button selection */}
            <div className="space-y-1.5 border-t pt-2">
              <span className="text-sm text-stone-500">勘定科目</span>
              <div className="flex flex-wrap gap-2">
                {titles.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTitleId(t.id)}
                    className={`rounded px-3 py-1.5 text-sm ${titleId === t.id ? 'bg-blue-600 font-medium text-white' : 'border border-stone-200 bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                  >
                    <span className="mr-1 text-xs opacity-70">{t.code}</span>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <label className="block max-w-sm space-y-1 text-sm">
              <span className="text-stone-500">
                取引先{partnerId && <span className="ml-1 text-green-600">（自動引当）</span>}
              </span>
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              >
                <option value="">（なし）</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void act(() => api.setApproval(top.id, 'rejected'))}
                disabled={busy}
                className="rounded border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                否認
              </button>
              <button
                onClick={() => void act(() => api.setApproval(top.id, 'mistake'))}
                disabled={busy}
                className="rounded border border-orange-200 px-3 py-2 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-50"
              >
                間違い
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSkip}
                disabled={busy || items.length <= 1}
                className="rounded border px-3 py-2 text-sm text-stone-600 hover:text-stone-900 disabled:opacity-50"
              >
                スキップ
              </button>
              {mode === 'queue' ? (
                <button
                  onClick={() => void act(() => api.hold(top.id))}
                  disabled={busy}
                  className="rounded border border-amber-300 px-3 py-2 text-sm text-amber-700 disabled:opacity-50"
                >
                  保留
                </button>
              ) : (
                <button
                  onClick={() => void act(() => api.unhold(top.id))}
                  disabled={busy}
                  className="rounded border px-3 py-2 text-sm text-stone-600 disabled:opacity-50"
                >
                  保留を解除
                </button>
              )}
              <button
                onClick={handleProcess}
                disabled={busy || !titleId}
                className="rounded bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 disabled:bg-stone-300"
              >
                {busy ? '処理中…' : '処理して次へ'}
              </button>
            </div>
          </div>

          {/* queue list — click a row to focus it above */}
          {items.length > 1 && (
            <div className="overflow-hidden rounded-lg bg-white shadow">
              <table className="w-full text-sm">
                <thead className="border-b bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">日付</th>
                    <th className="px-3 py-2 font-medium">店舗</th>
                    <th className="px-3 py-2 text-right font-medium">金額</th>
                    <th className="px-3 py-2 font-medium">提案</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((r, i) => {
                    const sug = titles.find((t) => t.id === r.suggestion.account_title_id)
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setActiveIndex(i)}
                        className={`cursor-pointer ${i === activeIdx ? 'bg-blue-50' : 'text-stone-700 hover:bg-stone-50'}`}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5">{r.date ?? '—'}</td>
                        <td className="px-3 py-1.5">{r.vendor || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">{yen(r.amount_jpy)}</td>
                        <td className="px-3 py-1.5 text-xs text-green-700">
                          {sug ? `${sug.code} ${sug.name}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
