import { useEffect, useState } from 'react'
import { api, type ExpenseClaim, type ExpenseClaimItem, type MasterRow, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, cn, EmptyState, Icon, Input, Modal,
  PageHeader, Select, Table, Tbody, Td, Textarea, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  draft: { label: '下書き', tone: 'neutral' },
  submitted: { label: '申請中', tone: 'warning' },
  approved: { label: '承認', tone: 'success' },
  rejected: { label: '否認', tone: 'danger' },
  withdrawn: { label: '取下げ', tone: 'neutral' },
}
const FILTERS = [
  { key: '', label: 'すべて' },
  { key: 'submitted', label: '申請中' },
  { key: 'approved', label: '承認' },
  { key: 'rejected', label: '否認' },
  { key: 'draft', label: '下書き' },
  { key: 'withdrawn', label: '取下げ' },
]

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

// 経費精算: 領収書を束ねて申請→承認/否認。一覧は RLS で 一般社員=自分の分 / 管理者・経理=全件。
export function ExpenseView({ clientId, canApprove, userId }: { clientId: string; canApprove?: boolean; userId: string }) {
  const toast = useToast()
  const [claims, setClaims] = useState<ExpenseClaim[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ExpenseClaim | 'new' | null>(null)
  const [approving, setApproving] = useState<ExpenseClaim | null>(null)
  const [rejecting, setRejecting] = useState<ExpenseClaim | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!clientId) { setClaims([]); return }
    setLoading(true)
    try {
      setClaims(await api.expenseClaims(clientId, filter || undefined))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, filter])

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true)
    try { await fn(); toast.success(msg); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="経費精算" description="社員の経費申請を承認/否認します。" />
        <Card><EmptyState icon={<Icon.FileText />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="経費精算" description="領収書を束ねて申請→承認/否認。支払いは行いません。" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('rounded-md px-3 py-1 font-medium', filter === f.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => setEditing('new')}><Icon.Plus /> 新規申請</Button>
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>件名</Th>
              <Th className="w-28">申請者</Th>
              <Th className="w-14 text-right">件数</Th>
              <Th className="w-28 text-right">合計</Th>
              <Th className="w-24">状態</Th>
              <Th className="w-24">申請日</Th>
              <Th></Th>
            </tr>
          </Thead>
          <Tbody>
            {claims.map((c) => {
              const mine = c.applicant_user_id === userId
              const st = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }
              return (
                <Tr key={c.id}>
                  <Td className="font-medium text-slate-800">
                    {c.title || '(無題)'}
                    {c.status === 'rejected' && c.reject_reason && (
                      <div className="mt-0.5 text-xs text-rose-600">否認理由: {c.reject_reason}</div>
                    )}
                  </Td>
                  <Td className="text-slate-500">{c.applicant ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{c.item_count}</Td>
                  <Td className="text-right tabular-nums">{yen(c.total_jpy)}</Td>
                  <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                  <Td className="whitespace-nowrap text-xs text-slate-400">{c.created_at?.slice(0, 10) ?? '—'}</Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {mine && (c.status === 'draft' || c.status === 'rejected') && (
                        <>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(c)}>編集</Button>
                          <Button size="sm" variant="primary" disabled={busy}
                            onClick={() => void act(() => api.submitExpenseClaim(c.id), c.status === 'rejected' ? '再提出しました' : '提出しました')}>
                            {c.status === 'rejected' ? '再提出' : '提出'}
                          </Button>
                        </>
                      )}
                      {mine && (c.status === 'draft' || c.status === 'submitted' || c.status === 'rejected') && (
                        <Button size="sm" variant="ghost" disabled={busy}
                          onClick={() => void act(() => api.withdrawExpenseClaim(c.id), '取り下げました')}>取下げ</Button>
                      )}
                      {canApprove && !mine && c.status === 'submitted' && (
                        <>
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => setApproving(c)}>承認</Button>
                          <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => setRejecting(c)}>否認</Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
            {claims.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">{loading ? '読み込み中…' : '申請はありません'}</td></tr>
            )}
          </Tbody>
        </Table>
      </Card>

      {editing && (
        <ClaimEditModal
          clientId={clientId}
          claim={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
      {approving && <ApproveModal claim={approving} clientId={clientId} onClose={() => setApproving(null)} onDone={() => { setApproving(null); void load() }} />}
      {rejecting && <RejectModal claim={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); void load() }} />}
    </>
  )
}

function ClaimEditModal({
  clientId, claim, onClose, onSaved,
}: { clientId: string; claim: ExpenseClaim | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState(claim?.title ?? '')
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(claim?.items.map((i) => i.receipt_id) ?? []))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // 立替(expense)レーンの未申請領収書のみを候補にする(RLSで一般社員は自分の分だけ)。
    api.receipts(clientId, undefined, { lane: 'expense' }).then(setReceipts).catch(() => setReceipts([]))
  }, [clientId])
  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  async function save() {
    setBusy(true)
    try {
      const body = { title: title.trim() || null, receipt_ids: [...selected] }
      if (claim) await api.updateExpenseClaim(claim.id, body)
      else await api.createExpenseClaim(clientId, body)
      toast.success('保存しました'); onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open onClose={onClose} size="lg"
      title={claim ? '申請を編集' : '新規申請'}
      description="件名を入力し、束ねる領収書を選びます。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy || selected.size === 0}>{busy ? '保存中…' : '保存'}</Button>
      </>}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">件名</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 2026年6月 交通費" />
      </label>
      <div className="mt-3 text-xs font-medium text-slate-500">領収書を選択（{selected.size}件）</div>
      <div className="mt-1 max-h-80 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
        {receipts.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">選べる領収書がありません</div>
        ) : (
          receipts.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="w-24 text-xs text-slate-400">{r.captured_at?.slice(0, 10) ?? '—'}</span>
              <span className="flex-1 truncate text-sm text-slate-700">{r.vendor || '(未解析)'}</span>
              <span className="tabular-nums text-sm text-slate-700">{r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}</span>
            </label>
          ))
        )}
      </div>
    </Modal>
  )
}

// 承認=仕分け(1パス): 各領収書の借方科目を確認/修正 → 承認で仕訳(貸方=未払金 既定)。
function ApproveModal({
  claim, clientId, onClose, onDone,
}: { claim: ExpenseClaim; clientId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [items, setItems] = useState<ExpenseClaimItem[]>([])
  const [debit, setDebit] = useState<Record<string, string>>({}) // receipt_id -> account_title_id
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    Promise.all([api.expenseClaim(claim.id), api.accountTitles(clientId)])
      .then(([full, ts]) => {
        if (!alive) return
        setItems(full.items)
        setTitles(ts)
        const d: Record<string, string> = {}
        for (const it of full.items) d[it.receipt_id] = it.account_title_id ?? it.suggested_account_title_id ?? ''
        setDebit(d)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.id, clientId])

  async function go() {
    setBusy(true)
    try {
      const payload = items.map((it) => ({ receipt_id: it.receipt_id, account_title_id: debit[it.receipt_id] || null }))
      const r = await api.approveExpenseClaim(claim.id, payload)
      toast.success(`承認しました（仕訳${r.journalized}件）`)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open onClose={onClose} size="lg" title="承認して仕訳"
      description="各領収書の借方科目を確認し、承認すると仕訳されます（貸方=未払金）。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void go()} disabled={busy || loading}>{busy ? '処理中…' : '承認して仕訳'}</Button>
      </>}
    >
      <p className="mb-2 text-sm text-slate-700">
        「{claim.title || '(無題)'}」 {claim.applicant ?? ''} ・ {claim.item_count}件 / {yen(claim.total_jpy)}
      </p>
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">読み込み中…</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.receipt_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="w-20 shrink-0 text-xs text-slate-400">{it.date ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{it.vendor || '(未解析)'}</span>
              <span className="shrink-0 tabular-nums text-sm text-slate-700">{yen(it.amount_jpy)}</span>
              <span className="shrink-0 text-xs text-slate-400">借方</span>
              <Select
                value={debit[it.receipt_id] ?? ''}
                onChange={(e) => setDebit((d) => ({ ...d, [it.receipt_id]: e.target.value }))}
                className="w-44 shrink-0"
              >
                <option value="">(科目未選択)</option>
                {titles.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} ${t.name}` : t.name}</option>)}
              </Select>
            </div>
          ))}
          <p className="text-xs text-slate-500">貸方は顧問先の既定（未払金）で仕訳します。借方が未選択の行は後から元帳で設定できます。</p>
        </div>
      )}
    </Modal>
  )
}

function RejectModal({ claim, onClose, onDone }: { claim: ExpenseClaim; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      await api.rejectExpenseClaim(claim.id, reason.trim())
      toast.success('否認しました'); onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open onClose={onClose} size="sm" title="否認"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="danger" onClick={() => void go()} disabled={busy}>{busy ? '処理中…' : '否認する'}</Button>
      </>}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">否認理由（申請者に表示されます）</span>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="差し戻しの理由・修正してほしい点" />
      </label>
    </Modal>
  )
}
