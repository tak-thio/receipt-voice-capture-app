import { useEffect, useMemo, useState } from 'react'
import {
  createExpenseClaim,
  listExpenseClaims,
  listReceipts,
  patchReceipt,
  submitExpenseClaim,
  withdrawExpenseClaim,
  type ServerExpenseClaim,
  type ServerReceipt,
} from '../api/server-api'
import { ReceiptDetailScreen, isEditable } from '../components/receipt-detail'
import { useAppStore } from '../store/app-store'

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

const CLAIM_STATUS: Record<string, { text: string; cls: string }> = {
  draft: { text: '下書き', cls: 'neutral' },
  submitted: { text: '申請中', cls: 'warn' },
  approved: { text: '承認', cls: 'ok' },
  rejected: { text: '否認', cls: 'bad' },
  withdrawn: { text: '取下げ', cls: 'neutral' },
}

/** 経費精算(立替): expense レーンの領収書を一覧(処理済も残す)。未申請は行タップで修正(用途・目的)
 *  →選んで「申請」→確認画面で件名・摘要を手修正して提出(claim束ね)。申請中/承認/否認はロック。
 *  申請履歴タブで提出/再提出/取下げ、否認理由の確認。承認は web 専用。 */
export function ExpenseScreen() {
  const connection = useAppStore((s) => s.connection)!
  const showToast = useAppStore((s) => s.showToast)
  const [view, setView] = useState<'tray' | 'claims'>('tray')
  const [receipts, setReceipts] = useState<ServerReceipt[]>([])
  const [claims, setClaims] = useState<ServerExpenseClaim[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<ServerReceipt | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [rs, cs] = await Promise.all([
        listReceipts(connection.serverUrl, connection.deviceToken, connection.clientId, 'expense'),
        listExpenseClaims(connection.serverUrl, connection.deviceToken, connection.clientId),
      ])
      setReceipts(rs)
      setClaims(cs)
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

  // 取下げ以外の申請が掴んでいる領収書 → その申請(claim)を引く。状態/否認理由/ロック判定に使う。
  const claimByReceipt = useMemo(() => {
    const m = new Map<string, ServerExpenseClaim>()
    for (const c of claims) {
      if (c.status === 'withdrawn') continue
      for (const it of c.items) m.set(it.receipt_id, c)
    }
    return m
  }, [claims])

  // 未申請(=申請に組める・編集可能): 編集可 かつ どの申請にも属していない。
  // → 申請中/承認/否認の領収書は composable=false なので選択も修正もできない(ロック)。
  const composable = (r: ServerReceipt) => isEditable(r) && !claimByReceipt.has(r.id)

  function statusFor(r: ServerReceipt): { text: string; cls: string } {
    if (r.journalized_at) return { text: '精算済', cls: 'ok' }
    const c = claimByReceipt.get(r.id)
    if (c) return CLAIM_STATUS[c.status] ?? { text: c.status, cls: 'neutral' }
    if (r.approval_status === 'rejected') return { text: '否認', cls: 'bad' }
    if (r.parse_failed) return { text: '解析失敗', cls: 'bad' }
    return { text: '未申請', cls: 'warn' }
  }

  // 否認された申請に属する領収書なら、その否認理由を返す(一覧・明細で表示)。
  function rejectReasonFor(r: ServerReceipt): string | undefined {
    const c = claimByReceipt.get(r.id)
    return c && c.status === 'rejected' && c.reject_reason ? `否認理由: ${c.reject_reason}` : undefined
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // 申請確認画面で件名・各領収書の用途(摘要)を手修正 → 摘要を保存 → 1申請に束ねて即提出。
  async function doApply(title: string, descs: Record<string, string>) {
    const picked = receipts.filter((r) => selected.has(r.id))
    if (picked.length === 0) return
    const missing = picked.filter((r) => !(descs[r.id] ?? '').trim())
    if (missing.length > 0
      && !window.confirm(`用途・目的が未記入の領収書が${missing.length}件あります。このまま申請しますか?`)) return
    setBusy(true)
    setError('')
    try {
      // 手修正した用途・目的(摘要)を保存(変更分のみ)。
      for (const r of picked) {
        const next = (descs[r.id] ?? '').trim()
        if (next !== (r.description ?? '').trim()) {
          await patchReceipt(connection.serverUrl, connection.deviceToken, r.id, { description: next || null })
        }
      }
      const claim = await createExpenseClaim(connection.serverUrl, connection.deviceToken, connection.clientId, {
        title: title.trim() || null,
        receipt_ids: picked.map((r) => r.id),
      })
      await submitExpenseClaim(connection.serverUrl, connection.deviceToken, claim.id)
      showToast(`${picked.length}件を申請しました`)
      setSelected(new Set())
      setReviewing(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function claimAct(fn: () => Promise<unknown>, msg: string) {
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
      <ReceiptDetailScreen
        receipt={editing}
        purposeMode
        editableOverride={composable(editing)}
        notice={rejectReasonFor(editing)}
        onBack={() => setEditing(null)}
        onSaved={(u) => {
          setReceipts((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
          setEditing(null)
        }}
        onDeleted={(id) => {
          setReceipts((rs) => rs.filter((x) => x.id !== id))
          setSelected((p) => {
            const n = new Set(p)
            n.delete(id)
            return n
          })
          setEditing(null)
        }}
      />
    )
  }

  if (reviewing) {
    return (
      <ClaimReviewScreen
        receipts={receipts.filter((r) => selected.has(r.id))}
        busy={busy}
        error={error}
        onBack={() => setReviewing(false)}
        onSubmit={doApply}
      />
    )
  }

  const selectedCount = selected.size

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <h1>経費精算</h1>
        <button className="ghost-button" onClick={() => void load()} disabled={loading}>
          {loading ? '更新中…' : '更新'}
        </button>
      </div>

      <div className="seg">
        <button className={view === 'tray' ? 'active' : ''} onClick={() => setView('tray')}>立替トレイ</button>
        <button className={view === 'claims' ? 'active' : ''} onClick={() => setView('claims')}>申請履歴</button>
      </div>

      {error && <p className="muted small">{error}</p>}

      {view === 'tray' ? (
        <>
          {receipts.length === 0 && !loading && (
            <p className="muted center inbox-empty">立替の領収書がありません。撮影タブの「経費精算」で取り込んでください。</p>
          )}
          <ul className="inbox-list">
            {receipts.map((r) => {
              const s = statusFor(r)
              const canPick = composable(r)
              const noPurpose = canPick && !(r.description ?? '').trim()
              const reject = rejectReasonFor(r)
              return (
                <li key={r.id} className="inbox-row tappable" onClick={() => setEditing(r)}>
                  <div className="inbox-main">
                    <span className={`v${r.parse_failed ? ' failed' : ''}`}>
                      {canPick && (
                        <button
                          className="pick"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle(r.id)
                          }}
                          aria-label="申請に選択"
                        >
                          {selected.has(r.id) ? '☑' : '☐'}
                        </button>
                      )}
                      {r.parse_failed ? '認識できませんでした' : r.vendor || '未解析'}
                    </span>
                    <span className="amt">{yen(r.amount_jpy)}</span>
                  </div>
                  <div className="inbox-sub">
                    <span>{r.captured_at ? r.captured_at.slice(0, 10).replaceAll('-', '/') : '—'}</span>
                    {noPurpose && <span className="img-mark warnmark">用途未記入</span>}
                    <span className={`st ${s.cls}`}>{s.text}</span>
                  </div>
                  {reject && <p className="muted small reject-line">{reject}</p>}
                </li>
              )
            })}
          </ul>
          {selectedCount > 0 && (
            <div className="apply-bar">
              <button className="accent-button" onClick={() => setReviewing(true)} disabled={busy}>
                {`${selectedCount}件を申請`}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {claims.length === 0 && !loading && <p className="muted center inbox-empty">申請はありません</p>}
          <ul className="inbox-list">
            {claims.map((c) => {
              const s = CLAIM_STATUS[c.status] ?? { text: c.status, cls: 'neutral' }
              const canSubmit = c.status === 'draft' || c.status === 'rejected'
              const canWithdraw = c.status === 'draft' || c.status === 'submitted' || c.status === 'rejected'
              return (
                <li key={c.id} className="inbox-row">
                  <div className="inbox-main">
                    <span className="v">{c.title || '(無題)'}</span>
                    <span className="amt">{yen(c.total_jpy)}</span>
                  </div>
                  <div className="inbox-sub">
                    <span>{c.item_count}件</span>
                    <span>{c.created_at ? c.created_at.slice(0, 10).replaceAll('-', '/') : '—'}</span>
                    <span className={`st ${s.cls}`}>{s.text}</span>
                  </div>
                  {c.status === 'rejected' && c.reject_reason && (
                    <p className="muted small reject-line">否認理由: {c.reject_reason}</p>
                  )}
                  {(canSubmit || canWithdraw) && (
                    <div className="detail-delete-actions">
                      {canSubmit && (
                        <button
                          className="accent-button"
                          disabled={busy}
                          onClick={() =>
                            void claimAct(
                              () => submitExpenseClaim(connection.serverUrl, connection.deviceToken, c.id),
                              c.status === 'rejected' ? '再提出しました' : '提出しました',
                            )
                          }
                        >
                          {c.status === 'rejected' ? '再提出' : '提出'}
                        </button>
                      )}
                      {canWithdraw && (
                        <button
                          className="ghost-button"
                          disabled={busy}
                          onClick={() =>
                            void claimAct(
                              () => withdrawExpenseClaim(connection.serverUrl, connection.deviceToken, c.id),
                              '取り下げました（領収書はトレイに戻ります）',
                            )
                          }
                        >
                          取下げ
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** 申請内容の確認: 件名 + 各領収書の用途・目的(摘要)をその場で手修正してから申請する。 */
function ClaimReviewScreen({
  receipts,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  receipts: ServerReceipt[]
  busy: boolean
  error: string
  onBack: () => void
  onSubmit: (title: string, descs: Record<string, string>) => void
}) {
  const [title, setTitle] = useState('')
  const [descs, setDescs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const r of receipts) o[r.id] = r.description ?? ''
    return o
  })
  const total = receipts.reduce((sum, r) => sum + (r.amount_jpy ?? 0), 0)
  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <button className="ghost-button" onClick={onBack}>← 戻る</button>
        <h1>申請内容の確認</h1>
        <span style={{ width: 64 }} />
      </div>
      <label className="field">
        <span>件名(任意)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 6月 交通費" disabled={busy} />
      </label>
      <p className="muted small">{receipts.length}件 ・ 合計 {yen(total)}</p>
      <ul className="inbox-list">
        {receipts.map((r) => (
          <li key={r.id} className="inbox-row">
            <div className="inbox-main">
              <span className="v">{r.vendor || '未解析'}</span>
              <span className="amt">{yen(r.amount_jpy)}</span>
            </div>
            <div className="inbox-sub">
              <span>{r.captured_at ? r.captured_at.slice(0, 10).replaceAll('-', '/') : '—'}</span>
            </div>
            <label className="field claim-desc">
              <span>用途・目的</span>
              <textarea
                rows={2}
                value={descs[r.id] ?? ''}
                onChange={(e) => setDescs((p) => ({ ...p, [r.id]: e.target.value }))}
                disabled={busy}
                placeholder="例: ◯◯社との打合せ交通費"
              />
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="muted small">{error}</p>}
      <button className="accent-button send" onClick={() => onSubmit(title, descs)} disabled={busy}>
        {busy ? '申請中…' : `${receipts.length}件を申請`}
      </button>
    </div>
  )
}
