import { useEffect, useState } from 'react'
import { api, type MasterRow, type NoteRow, type QueueItem } from '../api'
import {
  Alert, Badge, Button, Card, cn, EmptyState, Icon, Input, PageHeader,
  Section, Select, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'

type Mode = 'queue' | 'held'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

const TAX_LABEL: Record<string, string> = { inclusive: '税込', exclusive: '税抜', unknown: '不明' }

function numOrNull(s: string): number | null {
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

// 領収書は縦長が多いので、左に画像プレビュー・右に入力（取引先/借方/貸方/消費税）の
// 左右レイアウト。1件ずつ確認して仕訳する。
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

  const [titleId, setTitleId] = useState('') // 借方科目
  const [creditTitleId, setCreditTitleId] = useState('') // 貸方科目
  const [partnerId, setPartnerId] = useState('')
  const [showAllDebit, setShowAllDebit] = useState(false)
  const [showAllCredit, setShowAllCredit] = useState(false)
  // 消費税（編集可能）: 10%分 / 8%分 / 消費税合計 / 合計金額。
  const [tax10Input, setTax10Input] = useState('')
  const [tax8Input, setTax8Input] = useState('')
  const [taxTotalInput, setTaxTotalInput] = useState('')
  const [amountInput, setAmountInput] = useState('')

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

  useEffect(() => {
    if (!top) return
    setTitleId(top.account_title_id ?? top.suggestion.account_title_id ?? '')
    setCreditTitleId(top.credit_account_title_id ?? '')
    setPartnerId(top.partner_id ?? top.suggestion.partner_id ?? '')
    // 消費税。合計が無ければ 10%+8% から補完。
    const t10 = top.tax_10_jpy
    const t8 = top.tax_8_jpy
    const total = top.tax_jpy ?? (t10 != null || t8 != null ? (t10 ?? 0) + (t8 ?? 0) : null)
    setTax10Input(t10 != null ? String(t10) : '')
    setTax8Input(t8 != null ? String(t8) : '')
    setTaxTotalInput(total != null ? String(total) : '')
    setAmountInput(top.amount_jpy != null ? String(top.amount_jpy) : '')
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
  // 10%/8% を編集したら消費税合計を自動更新（合計は手修正も可）。
  function recalcTaxTotal(t10s: string, t8s: string) {
    const a = numOrNull(t10s)
    const b = numOrNull(t8s)
    if (a == null && b == null) return
    setTaxTotalInput(String((a ?? 0) + (b ?? 0)))
  }
  function handleProcess() {
    if (!top || !titleId) return
    void act(() =>
      api.journalize(top.id, {
        account_title_id: titleId,
        credit_account_title_id: creditTitleId || null,
        partner_id: partnerId || null,
        amount_jpy: numOrNull(amountInput),
        tax_jpy: numOrNull(taxTotalInput),
        tax_10_jpy: numOrNull(tax10Input),
        tax_8_jpy: numOrNull(tax8Input),
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

  // 勘定科目ボタン群（借方/貸方共通）。
  const titleButtons = (
    list: MasterRow[],
    selected: string,
    onSelect: (id: string) => void,
  ) => (
    <div className="flex flex-wrap gap-2">
      {list.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            selected === t.id
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
          )}
        >
          <span className="mr-1 text-xs opacity-70">{t.code}</span>
          {t.name}
        </button>
      ))}
    </div>
  )

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
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
              {/* 左: 領収書イメージ（縦長対応で大きく） */}
              <div className="space-y-1">
                <div className="flex h-[28rem] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 lg:h-full lg:min-h-[32rem]">
                  {top.image_file_id ? (
                    // PDFはサーバーで1ページ目を画像化して返すので、常に <img> で表示。
                    <img src={api.previewUrl(top.image_file_id)} alt="領収書" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-sm text-slate-400">画像なし</span>
                  )}
                </div>
                {top.image_file_id && (top.image_mime ?? '').includes('pdf') && (
                  <a href={api.fileUrl(top.image_file_id)} target="_blank" rel="noreferrer"
                    className="inline-block text-xs text-brand-600 hover:underline">
                    元のPDFを開く
                  </a>
                )}
              </div>

              {/* 右: 上から 店舗 → 取引先 → 借方 → 貸方 → 消費税 → 操作 */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold text-slate-900">{top.vendor || '(店舗名なし)'}</span>
                  <span className="text-xs text-slate-400">{top.date ?? '—'} · {top.source}</span>
                  {top.t_number && <Badge>T{top.t_number}</Badge>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <NoteChips ids={top.note_ids} notes={notes} empty={<span className="text-xs text-slate-400">付箋なし</span>} />
                  <Button size="sm" variant="secondary" onClick={() => setTagging(true)}><Icon.Plus /> 付箋</Button>
                </div>

                {/* 取引先 */}
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-500">
                    取引先{partnerId && <span className="ml-1 text-emerald-600">(自動引当)</span>}
                  </span>
                  <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">(なし)</option>
                    {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </label>

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
                  {titleButtons(shownDebit, titleId, setTitleId)}
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

                {/* 消費税（編集可能）: 10% / 8% / 消費税合計 / 合計金額 */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <span className="text-xs font-medium text-slate-500">消費税</span>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">消費税(10%)</span>
                      <Input inputMode="numeric" value={tax10Input}
                        onChange={(e) => { setTax10Input(e.target.value); recalcTaxTotal(e.target.value, tax8Input) }}
                        className="text-right tabular-nums" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">消費税(8%)</span>
                      <Input inputMode="numeric" value={tax8Input}
                        onChange={(e) => { setTax8Input(e.target.value); recalcTaxTotal(tax10Input, e.target.value) }}
                        className="text-right tabular-nums" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">消費税合計</span>
                      <Input inputMode="numeric" value={taxTotalInput} onChange={(e) => setTaxTotalInput(e.target.value)} className="text-right tabular-nums" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">合計金額</span>
                      <Input inputMode="numeric" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className="text-right tabular-nums" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                    {top.tax_mode && <span>税区分: {TAX_LABEL[top.tax_mode] ?? top.tax_mode}</span>}
                    {top.payment_method && <span>支払方法: {top.payment_method}</span>}
                  </div>
                </div>

                {/* 操作 */}
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
