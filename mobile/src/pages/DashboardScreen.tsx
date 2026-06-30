import { useEffect, useState } from 'react'
import { listReceipts, type ServerReceipt } from '../api/server-api'
import { useAppStore } from '../store/app-store'

const SRC_LABEL: Record<string, string> = { email: 'メール', mobile: 'アプリ', manual: 'アップロード' }

function yen(n: number): string {
  return `¥${n.toLocaleString()}`
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(5, 10).replace('-', '/') // MM/DD
}

/** ホーム: 顧問先名・当月の集計・取込元・最近の領収書。業務向けの落ち着いた表示。 */
export function DashboardScreen({
  onGoCapture,
  onGoInbox,
  onGoExpense,
}: {
  onGoCapture: () => void
  onGoInbox: () => void
  onGoExpense?: () => void
}) {
  const connection = useAppStore((state) => state.connection)!
  const individual = !!connection.individual // 個人(アプリのみ)は仕分け/経費精算の概念が無い
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      // 受信箱と同じく両レーン(会社経費+経費精算)を取得。経費精算も「最近の領収書」に出す。
      setRows(await listReceipts(connection.serverUrl, connection.deviceToken, connection.clientId, 'all'))
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
  // 仕訳(未処理/処理済)は会社経費レーンの概念。経費精算(立替)は仕訳対象外なので除外する。
  const companyRows = rows.filter((r) => r.lane !== 'expense')
  const unsorted = companyRows.filter((r) => !r.journalized_at).length
  const sorted = companyRows.filter((r) => r.journalized_at).length
  const bySource = (s: string) => rows.filter((r) => r.source === s).length
  // 最近の領収書は「領収書の日付(captured_at)」の新しい順。日付なし(未読取等)は末尾へ。
  // 同日内は元の取込順(created_at降順)を保つ(Array.sort は安定)。
  const recent = [...rows]
    .sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''))
    .slice(0, 6)

  return (
    <div className="dash">
      <header className="dash-top">
        <div>
          <h1 className="dash-client">
            {individual ? connection.userName || 'マイアカウント' : connection.clientName || '顧問先'}
          </h1>
          {!individual && (
          <p className="dash-meta">
            {[connection.firmName, connection.userName].filter(Boolean).join(' / ') || ' '}
          </p>
          )}
        </div>
        <span className="dash-period">
          {now.getFullYear()}年{now.getMonth() + 1}月
        </span>
      </header>

      <section className="dash-summary">
        <div className="sum-card">
          <span className="sum-label">今月の件数</span>
          <span className="sum-value">
            {monthCount}
            <small>件</small>
          </span>
        </div>
        <div className="sum-card">
          <span className="sum-label">今月の合計</span>
          <span className="sum-value">{yen(monthSum)}</span>
        </div>
      </section>

      {!individual && (
        <section className="dash-status">
          <div className="st-item">
            <span className="dot amber" />
            未処理 <b>{unsorted}</b>
          </div>
          <div className="st-item">
            <span className="dot green" />
            処理済 <b>{sorted}</b>
          </div>
          <div className="st-src">
            取込元 {SRC_LABEL.email} {bySource('email')} ・ {SRC_LABEL.mobile} {bySource('mobile')} ・{' '}
            {SRC_LABEL.manual} {bySource('manual')}
          </div>
        </section>
      )}

      <section className="dash-recent">
        <div className="sec-head">
          <h2>最近の領収書</h2>
          <button className="link" onClick={onGoInbox}>
            すべて見る
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="dash-empty">{loading ? '読み込み中…' : 'まだ領収書がありません。'}</p>
        ) : (
          <ul className="rlist">
            {recent.map((r) => (
              <li key={r.id} className="ritem"
                onClick={() => (r.lane === 'expense' ? (onGoExpense ?? onGoInbox)() : onGoInbox())}>
                <span className="rdate">{shortDate(r.captured_at)}</span>
                <span className={`rvendor${r.parse_failed ? ' failed' : ''}`}>
                  {r.parse_failed ? '認識できませんでした' : r.vendor || '未解析'}
                </span>
                <span className="ramount">{r.amount_jpy != null ? yen(r.amount_jpy) : '—'}</span>
                {!individual && (r.lane === 'expense' ? (
                  <span className="rbadge expense">経費精算</span>
                ) : (
                  <span className={`rbadge ${r.journalized_at ? 'done' : 'todo'}`}>
                    {r.journalized_at ? '仕分済' : '未仕分け'}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="dash-shoot" onClick={onGoCapture}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        領収書を撮影
      </button>
    </div>
  )
}
