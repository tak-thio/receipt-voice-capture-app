import { useEffect, useState } from 'react'
import {
  listReceipts, mergeReceipts, unmergeReceipts, type ServerReceipt,
} from '../api/server-api'
import { ReceiptDetailScreen, isEditable, statusOf } from '../components/receipt-detail'
import { toUserMessage } from '../lib/errors'
import { useAppStore } from '../store/app-store'

const SOURCE_LABEL: Record<string, string> = {
  email: 'メール',
  manual: 'アップロード',
  mobile: 'アプリ',
}

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

/** 受信箱: 会社経費(請求書)レーンの領収書一覧。行タップで詳細/修正。
 *  「選択」で複数選び、明細+鏡などを統合伝票にマージ。統合伝票は詳細で「ばらす」→元に戻せる。 */
export function InboxScreen() {
  const connection = useAppStore((state) => state.connection)!
  const showToast = useAppStore((state) => state.showToast)
  const individual = !!connection.individual // 個人(アプリのみ)は仕分け/レーン/マージの概念が無い
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ServerReceipt | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [picks, setPicks] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false) // 基準選択オーバーレイ
  const [basePick, setBasePick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  function togglePick(id: string) {
    setPicks((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function cancelSelect() {
    setSelecting(false)
    setPicks(new Set())
    setMerging(false)
    setBasePick(null)
  }
  function openMerge() {
    const chosen = rows.filter((r) => picks.has(r.id))
    if (chosen.length < 2) {
      showToast('マージには2件以上選んでください')
      return
    }
    setBasePick([...chosen].sort((a, b) => (b.amount_jpy ?? 0) - (a.amount_jpy ?? 0))[0].id)
    setMerging(true)
  }
  async function doMerge() {
    if (!basePick) return
    const ids = [...picks].filter((id) => id !== basePick)
    setBusy(true)
    try {
      await mergeReceipts(connection.serverUrl, connection.deviceToken, basePick, ids)
      showToast(`${ids.length + 1}件を統合伝票にまとめました`)
      cancelSelect()
      await load()
    } catch (e) {
      showToast(toUserMessage(e, 'マージに失敗しました', 'receipts.merge'))
    } finally {
      setBusy(false)
    }
  }
  async function handleUnmerge(r: ServerReceipt) {
    if (!window.confirm('この統合伝票をばらして、元の領収書に戻しますか?')) return
    setBusy(true)
    try {
      await unmergeReceipts(connection.serverUrl, connection.deviceToken, r.id)
      showToast('ばらしました（元の領収書に戻しました）')
      setSelected(null)
      await load()
    } catch (e) {
      showToast(toUserMessage(e, 'ばらすのに失敗しました', 'receipts.unmerge'))
    } finally {
      setBusy(false)
    }
  }

  if (selected) {
    const isMerged = (selected.images?.length ?? 0) > 1
    return (
      <ReceiptDetailScreen
        receipt={selected}
        onBack={() => setSelected(null)}
        onSaved={(u) => {
          setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
          setSelected(null)
        }}
        onDeleted={(id) => {
          setRows((rs) => rs.filter((x) => x.id !== id))
          setSelected(null)
        }}
        onUnmerge={isMerged && !individual ? () => void handleUnmerge(selected) : undefined}
      />
    )
  }

  if (merging) {
    const chosen = rows.filter((r) => picks.has(r.id))
    return (
      <div className="inbox-screen">
        <div className="inbox-head">
          <button className="ghost-button" onClick={() => setMerging(false)}>← 戻る</button>
          <h1>統合伝票にまとめる</h1>
          <span style={{ width: 64 }} />
        </div>
        <p className="muted small">
          {chosen.length}件を1つの統合伝票にまとめます。基準（金額・T番号などを優先する方）を選んでください。
          金額は合算しません。あとで「ばらす」で戻せます。
        </p>
        <ul className="inbox-list">
          {chosen.map((r) => (
            <li key={r.id} className="inbox-row tappable" onClick={() => setBasePick(r.id)}>
              <div className="inbox-main">
                <span className="v">{basePick === r.id ? '◉ ' : '○ '}{r.vendor || '未解析'}</span>
                <span className="amt">{yen(r.amount_jpy)}</span>
              </div>
              <div className="inbox-sub"><span>{r.captured_at ? r.captured_at.slice(0, 10) : '—'}</span></div>
            </li>
          ))}
        </ul>
        <button className="accent-button send" disabled={busy || !basePick} onClick={() => void doMerge()}>
          {busy ? 'マージ中…' : `${chosen.length}件をまとめる`}
        </button>
      </div>
    )
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <h1>受信箱</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {!individual && (
            <button className="ghost-button" onClick={() => (selecting ? cancelSelect() : setSelecting(true))}>
              {selecting ? 'キャンセル' : '選択'}
            </button>
          )}
          <button className="ghost-button" onClick={() => void load()} disabled={loading}>
            {loading ? '更新中…' : '更新'}
          </button>
        </div>
      </div>
      {selecting && <p className="muted small">明細+鏡など「1支払いに複数」を選んでマージ（修正可のものだけ選べます）。</p>}
      {error && <p className="muted small">{error}</p>}
      {rows.length === 0 && !loading && !error && (
        <p className="muted center inbox-empty">領収書がありません</p>
      )}
      <ul className="inbox-list">
        {rows.map((r) => {
          const s = statusOf(r)
          const hasImage = !!r.image_file_id
          const imgCount = r.images?.length ?? (hasImage ? 1 : 0)
          const canPick = selecting && (r.approval_status === 'pending' || r.approval_status === 'duplicate') && !r.journalized_at
          return (
            <li
              key={r.id}
              className="inbox-row tappable"
              onClick={() => (selecting ? (canPick ? togglePick(r.id) : undefined) : setSelected(r))}
            >
              <div className="inbox-main">
                <span className={`v${r.parse_failed ? ' failed' : ''}`}>
                  {selecting && (canPick ? (picks.has(r.id) ? '☑ ' : '☐ ') : '　')}
                  {r.parse_failed ? '請求書として認識できませんでした' : r.vendor || '未解析'}
                </span>
                <span className="amt">{yen(r.amount_jpy)}</span>
              </div>
              <div className="inbox-sub">
                <span>{r.captured_at ? r.captured_at.slice(0, 10) : '—'}</span>
                <span className="src">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {imgCount > 1 && <span className="img-mark">画像{imgCount}</span>}
                {imgCount === 1 && <span className="img-mark">画像</span>}
                {r.page != null && <span className="img-mark">P.{r.page}</span>}
                {isEditable(r) && <span className="img-mark">修正可</span>}
                {(!individual || r.parse_failed) && <span className={`st ${s.cls}`}>{s.text}</span>}
              </div>
            </li>
          )
        })}
      </ul>
      {selecting && picks.size >= 2 && (
        <div className="apply-bar">
          <button className="accent-button" onClick={openMerge} disabled={busy}>
            選択した{picks.size}件をマージ
          </button>
        </div>
      )}
    </div>
  )
}
