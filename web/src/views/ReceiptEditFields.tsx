import { useEffect, useState, type ReactNode } from 'react'
import { api, type JournalizeBody, type MasterRow, type NoteRow, type Suggestion } from '../api'
import { Button, cn, Icon, Input, Select, Textarea } from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { ZoomableImage } from './ZoomableImage'

// 仕分け・元帳編集で共通の「左:領収書画像 / 右:入力欄」エディタ。
// 入力状態は内部で保持し、操作ボタンは renderActions(getValues, debitSelected) で親が差し込む。
export interface EditableReceipt {
  id: string
  vendor: string | null
  date: string | null
  amount_jpy: number | null
  subtotal_jpy: number | null
  tax_jpy: number | null
  tax_10_jpy: number | null
  tax_8_jpy: number | null
  tax_mode: string | null
  payment_method: string | null
  t_number: string | null
  description: string | null // 摘要
  account_title_id: string | null
  credit_account_title_id: string | null
  partner_id: string | null
  image_file_id: string | null
  image_mime: string | null
  note_ids: string[]
  source?: string | null
  created_by_name?: string | null
  suggestion?: Suggestion | null
}

function numOrNull(s: string): number | null {
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

export function ReceiptEditFields({
  item, titles, partners, notes, noteIds, showCreator, onToggleNote, renderActions,
}: {
  item: EditableReceipt
  titles: MasterRow[]
  partners: MasterRow[]
  notes: NoteRow[]
  noteIds: string[]
  showCreator?: boolean
  onToggleNote: (noteId: string) => void
  renderActions: (getValues: () => JournalizeBody, debitSelected: boolean) => ReactNode
}) {
  const [tagging, setTagging] = useState(false)
  const [titleId, setTitleId] = useState('') // 借方科目
  const [creditTitleId, setCreditTitleId] = useState('') // 貸方科目
  const [partnerId, setPartnerId] = useState('')
  const [showAllDebit, setShowAllDebit] = useState(false)
  const [showAllCredit, setShowAllCredit] = useState(false)
  const [vendorInput, setVendorInput] = useState('') // 店舗名(支払先)
  const [dateInput, setDateInput] = useState('') // 領収書の日付(YYYY-MM-DD)
  const [amountInput, setAmountInput] = useState('')
  const [subtotalInput, setSubtotalInput] = useState('')
  const [taxTotalInput, setTaxTotalInput] = useState('')
  const [tax10Input, setTax10Input] = useState('')
  const [tax8Input, setTax8Input] = useState('')
  const [taxModeInput, setTaxModeInput] = useState('') // 税区分
  const [paymentInput, setPaymentInput] = useState('') // 支払方法
  const [tnumberInput, setTnumberInput] = useState('') // インボイス番号(T番号)
  const [descriptionInput, setDescriptionInput] = useState('') // 摘要

  useEffect(() => {
    setTitleId(item.account_title_id ?? item.suggestion?.account_title_id ?? '')
    setCreditTitleId(item.credit_account_title_id ?? '')
    setPartnerId(item.partner_id ?? item.suggestion?.partner_id ?? '')
    setVendorInput(item.vendor ?? '')
    setDateInput(item.date ?? '')
    const t10 = item.tax_10_jpy
    const t8 = item.tax_8_jpy
    const total = item.tax_jpy ?? (t10 != null || t8 != null ? (t10 ?? 0) + (t8 ?? 0) : null)
    setTax10Input(t10 != null ? String(t10) : '')
    setTax8Input(t8 != null ? String(t8) : '')
    setTaxTotalInput(total != null ? String(total) : '')
    setAmountInput(item.amount_jpy != null ? String(item.amount_jpy) : '')
    setSubtotalInput(item.subtotal_jpy != null ? String(item.subtotal_jpy) : '')
    setTaxModeInput(item.tax_mode ?? '')
    setPaymentInput(item.payment_method ?? '')
    setTnumberInput(item.t_number ?? '')
    setDescriptionInput(item.description ?? '')
    setShowAllDebit(false)
    setShowAllCredit(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

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

  // 10%/8% を編集したら消費税合計を自動更新（合計は手修正も可）。
  function recalcTaxTotal(t10s: string, t8s: string) {
    const a = numOrNull(t10s)
    const b = numOrNull(t8s)
    if (a == null && b == null) return
    setTaxTotalInput(String((a ?? 0) + (b ?? 0)))
  }

  function getValues(): JournalizeBody {
    return {
      account_title_id: titleId || null,
      credit_account_title_id: creditTitleId || null,
      partner_id: partnerId || null,
      vendor: vendorInput.trim(),
      date: dateInput || null,
      amount_jpy: numOrNull(amountInput),
      subtotal_jpy: numOrNull(subtotalInput),
      tax_jpy: numOrNull(taxTotalInput),
      tax_10_jpy: numOrNull(tax10Input),
      tax_8_jpy: numOrNull(tax8Input),
      tax_mode: taxModeInput || null,
      payment_method: paymentInput.trim() || null,
      t_number: tnumberInput.trim(),
      description: descriptionInput.trim(),
    }
  }

  // 勘定科目ボタン群（借方/貸方共通）。
  const titleButtons = (list: MasterRow[], selected: string, onSelect: (id: string) => void) => (
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
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
      {/* 左: 領収書イメージ（縦長対応で大きく） */}
      <div className="space-y-1">
        {item.image_file_id ? (
          // PDFはサーバーで1ページ目を画像化して返すので、常に <img>。ズーム/パン対応。
          <ZoomableImage
            key={item.image_file_id}
            src={api.previewUrl(item.image_file_id)}
            alt="領収書"
            className="h-[28rem] rounded-xl border border-slate-200 lg:h-full lg:min-h-[32rem]"
          />
        ) : (
          <div className="flex h-[28rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 lg:h-full lg:min-h-[32rem]">
            <span className="text-sm text-slate-400">画像なし</span>
          </div>
        )}
        {item.image_file_id && (item.image_mime ?? '').includes('pdf') && (
          <a href={api.fileUrl(item.image_file_id)} target="_blank" rel="noreferrer"
            className="inline-block text-xs text-brand-600 hover:underline">
            元のPDFを開く
          </a>
        )}
      </div>

      {/* 右: 店舗名/日付 → 取引先+T番号 → 借方 → 貸方 → 金額・消費税 → 操作 */}
      <div className="space-y-4">
        {/* 店舗名 + 日付（編集可能） */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-slate-500">店舗名(支払先)</span>
            <Input value={vendorInput} onChange={(e) => setVendorInput(e.target.value)} placeholder="店舗名" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">日付</span>
            <Input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          {item.source && <span>{item.source}</span>}
          {showCreator && item.created_by_name && <span>登録: {item.created_by_name}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NoteChips ids={noteIds} notes={notes} empty={<span className="text-xs text-slate-400">付箋なし</span>} />
          <Button size="sm" variant="secondary" onClick={() => setTagging(true)}><Icon.Plus /> 付箋</Button>
        </div>

        {/* 取引先 + インボイス番号（1行） */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">
              取引先{partnerId && <span className="ml-1 text-emerald-600">(自動引当)</span>}
            </span>
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">(なし)</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">インボイス番号(T番号)</span>
            <Input value={tnumberInput} onChange={(e) => setTnumberInput(e.target.value)} placeholder="T1234567890123" />
          </label>
        </div>

        {/* 摘要（AIが自動入力。手修正可） */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">摘要</span>
          <Textarea rows={2} value={descriptionInput} onChange={(e) => setDescriptionInput(e.target.value)}
            placeholder="仕訳の摘要（AIが自動入力します。修正できます）" />
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

        {/* 金額・消費税（すべて編集可能）: 合計金額 / 税抜 / 消費税合計 / 10% / 8% */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-medium text-slate-500">金額・消費税</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">合計金額(税込)</span>
              <Input inputMode="numeric" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className="text-right tabular-nums" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">税抜金額</span>
              <Input inputMode="numeric" value={subtotalInput} onChange={(e) => setSubtotalInput(e.target.value)} className="text-right tabular-nums" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">消費税合計</span>
              <Input inputMode="numeric" value={taxTotalInput} onChange={(e) => setTaxTotalInput(e.target.value)} className="text-right tabular-nums" />
            </label>
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
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">税区分</span>
              <Select value={taxModeInput} onChange={(e) => setTaxModeInput(e.target.value)}>
                <option value="">不明</option>
                <option value="inclusive">税込</option>
                <option value="exclusive">税抜</option>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">支払方法</span>
              <Input value={paymentInput} onChange={(e) => setPaymentInput(e.target.value)} placeholder="現金 / クレジット 等" />
            </label>
          </div>
        </div>

        {/* 操作（呼び出し側が差し込む） */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {renderActions(getValues, !!titleId)}
        </div>
      </div>

      <NotePickerModal
        open={tagging}
        onClose={() => setTagging(false)}
        notes={notes}
        value={noteIds}
        onToggle={(id) => onToggleNote(id)}
      />
    </div>
  )
}
