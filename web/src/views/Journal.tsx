import { useEffect, useState } from 'react'
import { api, type MasterRow, type NoteRow, type QueueItem } from '../api'
import {
  Alert, Badge, Button, Card, cn, EmptyState, Icon, PageHeader,
  Section, Select, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'

type Mode = 'queue' | 'held'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

const TAX_LABEL: Record<string, string> = { inclusive: '税込', exclusive: '税抜', unknown: '不明' }

// Single-item "拡大表示" journaling, ported from receipt-app's UX: focus the top
// item, pick the account title with a button, see the receipt image, 処理して次へ.
export function JournalView({ clientId }: { clientId: string }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [tagging, setTagging] = useState(false)
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [heldCount, setHeldCount] = useState(0)
  const [mode, setMode] = useState<Mode>('queue')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [titleId, setTitleId] = useState('')          // 借方科目
  const [creditTitleId, setCreditTitleId] = useState('')  // 貸方科目
  const [partnerId, setPartnerId] = useState('')
  const [showAllDebit, setShowAllDebit] = useState(false)
  const [showAllCredit, setShowAllCredit] = useState(false)

  async function loadMasters() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
    setNotes(await api.notes(clientId).catch(() => []))
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
  // 「よく使う(借方/貸方)」だけを既定表示（多すぎる科目を絞る）。選択中の科目は常に出す。
  const pinnedDebit = titles.filter((t) => t.pinned_debit)
  const pinnedCredit = titles.filter((t) => t.pinned_credit)
  const shownDebit =
    showAllDebit || pinnedDebit.length === 0
      ? titles
      : titles.filter((t) => t.pinned_debit || t.id === titleId)
  const shownCredit =
    showAllCredit || pinnedCredit.length === 0
      ? titles
      : titles.filter((t) => t.pinned_credit || t.id === creditTitleId)
  // 消費税の内訳。欠けている値は税込から逆算して表示する。
  const taxJpy =
    top?.tax_jpy ?? (top?.amount_jpy != null && top?.subtotal_jpy != null ? top.amount_jpy - top.subtotal_jpy : null)
  const subJpy =
    top?.subtotal_jpy ?? (top?.amount_jpy != null && top?.tax_jpy != null ? top.amount_jpy - top.tax_jpy : null)

  useEffect(() => {
    if (!top) return
    setTitleId(top.account_title_id ?? top.suggestion.account_title_id ?? '')
    setCreditTitleId(top.credit_account_title_id ?? '')
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
      api.journalize(top.id, {
        account_title_id: titleId,
        credit_account_title_id: creditTitleId || null,
        partner_id: partnerId || null,
      }),
    )
  }
  async function toggleNote(noteId: string) {
    if (!top) return
    const has = top.note_ids.includes(noteId)
    const next = has ? top.note_ids.filter((x) => x !== noteId) : [...top.note_ids, noteId]
    setItems((its) => its.map((it) => (it.id === top.id ? { ...it, note_ids: next } : it)))
    try {
      await api.setReceiptNotes(top.id, next)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="仕分け" description="領収書を1件ずつ確認して仕訳します。" />
        <Card><EmptyState icon={<Icon.Sort />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="仕分け"
        description="領収書を1件ずつ確認して仕訳します。"
        actions={
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
            <button onClick={() => switchMode('queue')}
              className={cn('rounded-md px-3 py-1 font-medium', mode === 'queue' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              未仕分け
            </button>
            <button onClick={() => switchMode('held')}
              className={cn('rounded-md px-3 py-1 font-medium', mode === 'held' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              保留 {heldCount > 0 && <span className="ml-0.5">{heldCount}</span>}
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{mode === 'queue' ? '未仕分け' : '保留'} 残り <span className="font-semibold text-slate-700">{total}</span> 件</span>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {titles.length === 0 && (
        <div className="mb-4"><Alert tone="warning">勘定科目が未登録です。「マスタ」タブで登録してください。</Alert></div>
      )}

      {!top ? (
        <Card>
          <EmptyState
            icon={<Icon.Check />}
            title={mode === 'queue' ? '未仕分けの領収書はありません 🎉' : '保留中の領収書はありません'}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="ring-2 ring-brand-500/60">
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold text-slate-900">{top.vendor || '(店舗名なし)'}</span>
                <span className="text-lg font-semibold tabular-nums text-slate-900">{yen(top.amount_jpy)}</span>
                <span className="text-xs text-slate-400">{top.date ?? '—'} · {top.source}</span>
                {top.t_number && <Badge>T{top.t_number}</Badge>}
              </div>

              {/* 解析できた情報の詳細 */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {(subJpy != null || taxJpy != null) && (
                  <span>
                    内訳: 税抜 <span className="text-slate-700">{yen(subJpy)}</span>
                    {' / '}消費税 <span className="text-slate-700">{yen(taxJpy)}</span>
                    {' / '}税込 <span className="text-slate-700">{yen(top.amount_jpy)}</span>
                  </span>
                )}
                {top.tax_mode && <span>税区分: <span className="text-slate-700">{TAX_LABEL[top.tax_mode] ?? top.tax_mode}</span></span>}
                {top.payment_method && <span>支払方法: <span className="text-slate-700">{top.payment_method}</span></span>}
                {top.t_number && <span>インボイス: <span className="text-slate-700">T{top.t_number}</span></span>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <NoteChips ids={top.note_ids} notes={notes} empty={<span className="text-xs text-slate-400">付箋なし</span>} />
                <Button size="sm" variant="secondary" onClick={() => setTagging(true)}><Icon.Plus /> 付箋</Button>
              </div>

              <div className="flex h-80 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {top.image_file_id ? (
                  (top.image_mime ?? '').includes('pdf') ? (
                    <iframe src={api.fileUrl(top.image_file_id)} title="領収書PDF" className="h-full w-full" />
                  ) : (
                    <img src={api.fileUrl(top.image_file_id)} alt="領収書" className="max-h-full max-w-full object-contain" />
                  )
                ) : (
                  <span className="text-sm text-slate-400">画像なし</span>
                )}
              </div>

              {/* 借方科目 */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">借方科目</span>
                  {pinnedDebit.length > 0 && (
                    <button onClick={() => setShowAllDebit((v) => !v)} className="text-xs font-medium text-brand-600 hover:underline">
                      {showAllDebit ? 'よく使うのみ' : `すべて表示 (${titles.length})`}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {shownDebit.map((t) => (
                    <button key={t.id} onClick={() => setTitleId(t.id)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        titleId === t.id
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                      )}>
                      <span className="mr-1 text-xs opacity-70">{t.code}</span>{t.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 貸方科目 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">貸方科目</span>
                  {pinnedCredit.length > 0 && (
                    <button onClick={() => setShowAllCredit((v) => !v)} className="text-xs font-medium text-brand-600 hover:underline">
                      {showAllCredit ? 'よく使うのみ' : `すべて表示 (${titles.length})`}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setCreditTitleId('')}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      creditTitleId === ''
                        ? 'bg-slate-600 text-white shadow-sm'
                        : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100',
                    )}>
                    (なし)
                  </button>
                  {shownCredit.map((t) => (
                    <button key={t.id} onClick={() => setCreditTitleId(t.id)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        creditTitleId === t.id
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                      )}>
                      <span className="mr-1 text-xs opacity-70">{t.code}</span>{t.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block max-w-sm space-y-1">
                <span className="text-xs font-medium text-slate-500">
                  取引先{partnerId && <span className="ml-1 text-emerald-600">(自動引当)</span>}
                </span>
                <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">(なし)</option>
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </label>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <Button variant="danger-ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'rejected'))}>否認</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'mistake'))}>間違い</Button>
                <div className="flex-1" />
                <Button variant="ghost" disabled={busy || items.length <= 1} onClick={handleSkip}>スキップ</Button>
                {mode === 'queue' ? (
                  <Button disabled={busy} onClick={() => void act(() => api.hold(top.id))}>保留</Button>
                ) : (
                  <Button disabled={busy} onClick={() => void act(() => api.unhold(top.id))}>保留を解除</Button>
                )}
                <Button variant="primary" disabled={busy || !titleId} onClick={handleProcess}>
                  {busy ? '処理中…' : '処理して次へ'}
                </Button>
              </div>
            </div>
          </Card>

          {items.length > 1 && (
            <Section title={`${mode === 'queue' ? '未仕分け' : '保留'}キュー`} bodyClassName="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th className="w-28">日付</Th>
                    <Th>店舗</Th>
                    <Th className="text-right">金額</Th>
                    <Th>提案</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {items.map((r, i) => {
                    const sug = titles.find((t) => t.id === r.suggestion.account_title_id)
                    return (
                      <Tr key={r.id} active={i === activeIdx} onClick={() => setActiveIndex(i)}>
                        <Td className="whitespace-nowrap text-slate-500">{r.date ?? '—'}</Td>
                        <Td className="font-medium text-slate-800">{r.vendor || '—'}</Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">{yen(r.amount_jpy)}</Td>
                        <Td className="text-xs text-emerald-700">{sug ? `${sug.code} ${sug.name}` : '—'}</Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </Section>
          )}
        </div>
      )}

      <NotePickerModal
        open={tagging && !!top}
        onClose={() => setTagging(false)}
        notes={notes}
        value={top?.note_ids ?? []}
        onToggle={(id) => void toggleNote(id)}
      />
    </>
  )
}
