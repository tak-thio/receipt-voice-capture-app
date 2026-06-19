import { useEffect, useState } from 'react'
import {
  createExpenseClaim,
  listExpenseClaims,
  listReceipts,
  submitExpenseClaim,
  updateExpenseClaim,
  withdrawExpenseClaim,
  type ServerExpenseClaim,
  type ServerReceipt,
} from '../api/server-api'
import { useAppStore } from '../store/app-store'

const STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: '下書き', cls: 'neutral' },
  submitted: { text: '申請中', cls: 'warn' },
  approved: { text: '承認', cls: 'ok' },
  rejected: { text: '否認', cls: 'bad' },
  withdrawn: { text: '取下げ', cls: 'neutral' },
}
const EDITABLE = new Set(['draft', 'rejected'])
const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

/** 経費精算(申請): 立替の領収書を束ねて申請→提出/取下げ。承認は web 専用。 */
export function ExpenseScreen() {
  const connection = useAppStore((s) => s.connection)!
  const showToast = useAppStore((s) => s.showToast)
  const [claims, setClaims] = useState<ServerExpenseClaim[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ServerExpenseClaim | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setClaims(await listExpenseClaims(connection.serverUrl, connection.deviceToken, connection.clientId))
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

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      showToast(msg)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <ClaimEditor
        claim={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />
    )
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <h1>経費精算</h1>
        <button className="ghost-button" onClick={() => void load()} disabled={loading}>
          {loading ? '更新中…' : '更新'}
        </button>
      </div>
      <button className="accent-button send" onClick={() => setEditing('new')} disabled={busy}>＋ 新規申請</button>
      {error && <p className="muted small">{error}</p>}
      {claims.length === 0 && !loading && <p className="muted center inbox-empty">申請はありません</p>}
      <ul className="inbox-list">
        {claims.map((c) => {
          const s = STATUS[c.status] ?? { text: c.status, cls: 'neutral' }
          return (
            <li key={c.id} className="inbox-row">
              <div className="inbox-main">
                <span className="v">{c.title || '(無題)'}</span>
                <span className="amt">{yen(c.total_jpy)}</span>
              </div>
              <div className="inbox-sub">
                <span>{c.item_count}件</span>
                <span>{c.created_at ? c.created_at.slice(0, 10) : '—'}</span>
                <span className={`st ${s.cls}`}>{s.text}</span>
              </div>
              {c.status === 'rejected' && c.reject_reason && (
                <p className="muted small">否認理由: {c.reject_reason}</p>
              )}
              {EDITABLE.has(c.status) && (
                <div className="detail-delete-actions">
                  <button
                    className="accent-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => submitExpenseClaim(connection.serverUrl, connection.deviceToken, c.id),
                        c.status === 'rejected' ? '再提出しました' : '提出しました',
                      )
                    }
                  >
                    {c.status === 'rejected' ? '再提出' : '提出'}
                  </button>
                  <button className="ghost-button" disabled={busy} onClick={() => setEditing(c)}>編集</button>
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => withdrawExpenseClaim(connection.serverUrl, connection.deviceToken, c.id),
                        '取り下げました',
                      )
                    }
                  >
                    取下げ
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 申請の新規作成/編集: 件名 ＋ 立替トレイから領収書を選ぶ。 */
function ClaimEditor({
  claim,
  onBack,
  onSaved,
}: {
  claim: ServerExpenseClaim | null
  onBack: () => void
  onSaved: () => void
}) {
  const connection = useAppStore((s) => s.connection)!
  const showToast = useAppStore((s) => s.showToast)
  const [title, setTitle] = useState(claim?.title ?? '')
  const [receipts, setReceipts] = useState<ServerReceipt[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(claim?.items.map((i) => i.receipt_id) ?? []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // 立替(expense)レーンの未申請領収書のみが候補(サーバ RLS で自分の分だけ)。
    listReceipts(connection.serverUrl, connection.deviceToken, connection.clientId, 'expense')
      .then(setReceipts)
      .catch(() => setReceipts([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function save(thenSubmit: boolean) {
    if (selected.size === 0) {
      setError('領収書を1件以上選んでください')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = { title: title.trim() || null, receipt_ids: [...selected] }
      const saved = claim
        ? await updateExpenseClaim(connection.serverUrl, connection.deviceToken, claim.id, body)
        : await createExpenseClaim(connection.serverUrl, connection.deviceToken, connection.clientId, body)
      if (thenSubmit) {
        await submitExpenseClaim(connection.serverUrl, connection.deviceToken, saved.id)
        showToast('提出しました')
      } else {
        showToast('保存しました')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <button className="ghost-button" onClick={onBack}>← 戻る</button>
        <h1>{claim ? '申請を編集' : '新規申請'}</h1>
        <span style={{ width: 64 }} />
      </div>
      <label className="field">
        <span>件名</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 2026年6月 交通費" disabled={busy} />
      </label>
      <p className="muted small">束ねる領収書を選択（{selected.size}件）</p>
      {receipts.length === 0 && (
        <p className="muted center inbox-empty">選べる領収書がありません。撮影タブで取り込んでください。</p>
      )}
      <ul className="inbox-list">
        {receipts.map((r) => (
          <li key={r.id} className="inbox-row tappable" onClick={() => toggle(r.id)}>
            <div className="inbox-main">
              <span className="v">{selected.has(r.id) ? '☑ ' : '☐ '}{r.vendor || '未解析'}</span>
              <span className="amt">{yen(r.amount_jpy)}</span>
            </div>
            <div className="inbox-sub">
              <span>{r.captured_at ? r.captured_at.slice(0, 10) : '—'}</span>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="muted small">{error}</p>}
      <button className="accent-button send" onClick={() => void save(true)} disabled={busy || selected.size === 0}>
        {busy ? '処理中…' : '保存して提出'}
      </button>
      <button className="ghost-button" onClick={() => void save(false)} disabled={busy || selected.size === 0}>
        下書き保存
      </button>
    </div>
  )
}
