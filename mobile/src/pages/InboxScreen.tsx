import { useEffect, useState } from 'react'
import { listReceipts, type ServerReceipt } from '../api/server-api'
import { ReceiptDetailScreen, isEditable, statusOf } from '../components/receipt-detail'
import { useAppStore } from '../store/app-store'

const SOURCE_LABEL: Record<string, string> = {
  email: 'メール',
  manual: 'アップロード',
  mobile: 'アプリ',
}

/** 受信箱: 会社経費(請求書)レーンの領収書一覧。行タップで詳細/修正(読み取り訂正・摘要)。
 *  ※ 統合伝票マージは web(経理)専用。アプリでは扱わない。 */
export function InboxScreen() {
  const connection = useAppStore((state) => state.connection)!
  const individual = !!connection.individual // 個人(アプリのみ)は仕分け/レーンの概念が無い
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ServerReceipt | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setRows(
        await listReceipts(
          connection.serverUrl, connection.deviceToken, connection.clientId,
          individual ? 'all' : 'company',
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (selected) {
    return (
      <ReceiptDetailScreen
        receipt={selected}
        // クレジット明細の塊行は領収書ではない(idが領収書IDでなく保存が404になる)。閲覧のみ。
        editableOverride={selected.card_batch ? false : undefined}
        notice={selected.card_batch
          ? `クレジット明細の取込（${selected.card_batch.count}件）です。行の照合・処理は Web の「クレジット明細」で行います。`
          : undefined}
        onBack={() => setSelected(null)}
        onSaved={(u) => {
          setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
          setSelected(null)
        }}
        onDeleted={(id) => {
          setRows((rs) => rs.filter((x) => x.id !== id))
          setSelected(null)
        }}
      />
    )
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <h1>受信箱</h1>
        <button className="ghost-button" onClick={() => void load()} disabled={loading}>
          {loading ? '更新中…' : '更新'}
        </button>
      </div>
      {error && <p className="muted small">{error}</p>}
      {rows.length === 0 && !loading && !error && (
        <p className="muted center inbox-empty">領収書がありません</p>
      )}
      <ul className="inbox-list">
        {rows.map((r) => {
          const s = statusOf(r)
          const hasImage = !!r.image_file_id
          return (
            <li key={r.id} className="inbox-row tappable" onClick={() => setSelected(r)}>
              <div className="inbox-main">
                <span className={`v${r.parse_failed ? ' failed' : ''}`}>
                  {r.parse_failed ? '請求書として認識できませんでした' : r.vendor || '未解析'}
                </span>
                <span className="amt">{r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}</span>
              </div>
              <div className="inbox-sub">
                <span>{r.captured_at ? r.captured_at.slice(0, 10).replaceAll('-', '/') : '—'}</span>
                <span className="src">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {hasImage && <span className="img-mark">画像</span>}
                {r.page != null && <span className="img-mark">P.{r.page}</span>}
                {/* 塊行は修正不可・状態バッジも出さない(仕分け対象外の要約行のため) */}
                {!r.card_batch && isEditable(r) && <span className="img-mark">修正可</span>}
                {(!individual || r.parse_failed) && !r.card_batch && <span className={`st ${s.cls}`}>{s.text}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
