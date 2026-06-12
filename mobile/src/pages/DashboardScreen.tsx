import { useEffect, useState } from 'react'
import { listReceipts, type ServerReceipt } from '../api/server-api'
import { useAppStore } from '../store/app-store'

const SRC = { email: '✉ メール', mobile: '📱 アプリ', manual: '⬆ アップロード' } as const

function yen(n: number): string {
  return `¥${n.toLocaleString()}`
}

/** ホーム/ダッシュボード: 今月の件数・合計・状態内訳・最近の領収書＋撮影CTA。 */
export function DashboardScreen({
  onGoCapture,
  onGoInbox,
}: {
  onGoCapture: () => void
  onGoInbox: () => void
}) {
  const connection = useAppStore((state) => state.connection)!
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setRows(await listReceipts(connection.serverUrl, connection.deviceToken, connection.clientId))
    } catch {
      /* 失敗時は0件表示 */
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonth = rows.filter((r) => (r.captured_at ?? '').slice(0, 7) === ym)
  const monthCount = thisMonth.length
  const monthSum = thisMonth.reduce((s, r) => s + (r.amount_jpy ?? 0), 0)
  const unsorted = rows.filter((r) => !r.journalized_at && r.approval_status === 'pending').length
  const sorted = rows.filter((r) => r.journalized_at).length
  const bySource = (s: string) => rows.filter((r) => r.source === s).length
  const recent = rows.slice(0, 5)

  return (
    <div className="dash">
      <header className="dash-hero">
        <p className="dash-eyebrow">{connection.clientName || '顧問先'}</p>
        <h1>領収書ダッシュボード</h1>
        <p className="dash-sub">
          {[connection.firmName, connection.userName].filter(Boolean).join(' ・ ') || '　'}
        </p>
      </header>

      <button className="dash-cta" onClick={onGoCapture}>
        <span className="dash-cta-icon">📷</span>
        <span>領収書を撮影する</span>
      </button>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-num">{monthCount}</span>
          <span className="stat-label">今月の件数</span>
        </div>
        <div className="stat">
          <span className="stat-num">{yen(monthSum)}</span>
          <span className="stat-label">今月の合計</span>
        </div>
        <div className="stat warn">
          <span className="stat-num">{unsorted}</span>
          <span className="stat-label">未仕分け</span>
        </div>
        <div className="stat ok">
          <span className="stat-num">{sorted}</span>
          <span className="stat-label">仕分済</span>
        </div>
      </div>

      <div className="src-chips">
        <span>{SRC.email} {bySource('email')}</span>
        <span>{SRC.mobile} {bySource('mobile')}</span>
        <span>{SRC.manual} {bySource('manual')}</span>
      </div>

      <div className="recent">
        <div className="recent-head">
          <h2>最近の領収書</h2>
          <button className="link" onClick={onGoInbox}>すべて見る</button>
        </div>
        {recent.length === 0 ? (
          <p className="muted small">{loading ? '読み込み中…' : 'まだ領収書がありません。撮影してみましょう。'}</p>
        ) : (
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.id} className="recent-row" onClick={onGoInbox}>
                <span className="rv">{r.vendor || '未解析'}</span>
                <span className="ra">{r.amount_jpy != null ? yen(r.amount_jpy) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
