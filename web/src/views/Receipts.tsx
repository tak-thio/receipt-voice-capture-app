import { useEffect, useState } from 'react'
import { api, type ReceiptRow } from '../api'

const FORMATS = ['generic', 'mas', 'freee', 'yayoi']

export function ReceiptsView({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!clientId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      setRows(await api.receipts(clientId, q || undefined))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  if (!clientId) return <p className="text-stone-400">顧問先を選択してください。</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded-lg border px-3 py-1.5 text-sm"
          placeholder="検索(支払先 / 番号)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
        />
        <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void load()}>
          検索
        </button>
        <span className="text-sm text-stone-500">{rows.length}件</span>
        <span className="ml-auto text-sm text-stone-500">CSV出力:</span>
        {FORMATS.map((f) => (
          <a
            key={f}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-stone-100"
            href={api.exportUrl(clientId, f)}
          >
            {f}
          </a>
        ))}
      </div>

      <table className="w-full overflow-hidden rounded-xl bg-white text-sm shadow">
        <thead className="bg-stone-100 text-stone-600">
          <tr>
            <th className="px-3 py-2 text-left">日付</th>
            <th className="px-3 py-2 text-left">支払先</th>
            <th className="px-3 py-2 text-right">金額</th>
            <th className="px-3 py-2 text-left">区分</th>
            <th className="px-3 py-2 text-left">状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-2">{r.captured_at?.slice(0, 10) ?? '—'}</td>
              <td className="px-3 py-2">{r.vendor ?? '—'}</td>
              <td className="px-3 py-2 text-right">{r.amount_jpy?.toLocaleString() ?? '—'}</td>
              <td className="px-3 py-2 text-stone-500">{r.source}</td>
              <td className="px-3 py-2">
                {r.journalized_at ? (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">仕分済</span>
                ) : (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">未仕分</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-stone-400">
                {loading ? '読み込み中...' : '領収書がありません'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
