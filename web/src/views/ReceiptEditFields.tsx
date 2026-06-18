import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type JournalizeBody, type MasterRow, type NoteRow, type SubAccountRow, type Suggestion } from '../api'
import { Button, cn, Icon, Input, Select, Textarea } from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { ZoomableImage } from './ZoomableImage'
import { EmailViewModal } from './EmailViewModal'
import { ReceiptHistoryModal } from './ReceiptHistoryModal'

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
  sub_account_id?: string | null // 借方科目に紐づく補助科目
  partner_id: string | null
  partner_name?: string | null // 取引先(自由入力)
  image_file_id: string | null
  image_mime: string | null
  note_ids: string[]
  source?: string | null
  created_by_name?: string | null
  parse_failed?: boolean // AIが請求書として認識できなかった
  page?: number | null // PDFの何ページ目由来か
  memo?: string | null // 自由メモ
  suggestion?: Suggestion | null
}

function numOrNull(s: string): number | null {
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

export function ReceiptEditFields({
  item, titles, partners, notes, noteIds, showCreator, lockDate, onToggleNote, renderActions,
}: {
  item: EditableReceipt
  titles: MasterRow[]
  partners: MasterRow[]
  notes: NoteRow[]
  noteIds: string[]
  showCreator?: boolean
  lockDate?: string | null // 締め日(YYYY-MM-DD)。取引日がこれ以前なら「期間外」警告
  onToggleNote: (noteId: string) => void
  renderActions: (getValues: () => JournalizeBody, debitSelected: boolean) => ReactNode
}) {
  const [tagging, setTagging] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [titleId, setTitleId] = useState('') // 借方科目
  const [creditTitleId, setCreditTitleId] = useState('') // 貸方科目
  const [subTitleId, setSubTitleId] = useState('') // 補助科目(借方科目に紐づく)
  const [subAccounts, setSubAccounts] = useState<SubAccountRow[]>([]) // 選択中の借方科目の補助科目
  const [partnerNameInput, setPartnerNameInput] = useState('') // 取引先(自由入力)
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
  const [memoInput, setMemoInput] = useState('') // 自由メモ

  useEffect(() => {
    setTitleId(item.account_title_id ?? item.suggestion?.account_title_id ?? '')
    setCreditTitleId(item.credit_account_title_id ?? '')
    setSubTitleId(item.sub_account_id ?? item.suggestion?.sub_account_id ?? '')
    // 取引先(自由入力)の初期値: 保存済みの取引先名 > 引当マスタ名 > 店舗名。
    const linkedName = partners.find((p) => p.id === item.partner_id)?.name
    setPartnerNameInput(item.partner_name ?? linkedName ?? item.vendor ?? '')
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
    setMemoInput(item.memo ?? '')
    setShowAllDebit(false)
    setShowAllCredit(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // 借方/貸方どちらかの科目に補助科目があれば、その科目の補助科目を選べるようにする
  // (例: 貸方「普通預金」の銀行別補助)。補助科目を持つ科目を1つ特定(借方を優先)。
  const subParentId = useMemo(() => {
    const d = titles.find((x) => x.id === titleId)
    if ((d?.sub_account_count ?? 0) > 0) return titleId
    const c = titles.find((x) => x.id === creditTitleId)
    if ((c?.sub_account_count ?? 0) > 0) return creditTitleId
    return ''
  }, [titleId, creditTitleId, titles])
  const subParentName = titles.find((t) => t.id === subParentId)?.name ?? ''
  useEffect(() => {
    if (!subParentId) { setSubAccounts([]); return }
    let alive = true
    api.subAccounts(subParentId)
      .then((rows) => {
        if (!alive) return
        setSubAccounts(rows)
        // 科目が変わって今の補助科目がその科目に属さなくなったら選択を外す。
        setSubTitleId((prev) => (rows.some((r) => r.id === prev) ? prev : ''))
      })
      .catch(() => { if (alive) setSubAccounts([]) })
    return () => { alive = false }
  }, [subParentId])

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
      sub_account_id: subParentId ? subTitleId || null : null,
      // 取引先は自由入力テキストを送る。マスタ完全一致ならサーバが partner_id を引当。
      partner_name: partnerNameInput.trim() || null,
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
      memo: memoInput.trim() || null,
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
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {/* 左: 領収書イメージ（縦長対応で大きく） */}
      <div className="space-y-1">
        {item.image_file_id ? (
          // PDFはサーバーで1ページ目を画像化して返すので、常に <img>。ズーム/パン対応。
          <ZoomableImage
            key={item.image_file_id}
            src={api.previewUrl(item.image_file_id, item.page)}
            alt="領収書"
            className="h-[22rem] rounded-xl border border-slate-200 lg:h-full lg:min-h-[24rem] lg:max-h-[42rem]"
          />
        ) : (
          <div className="flex h-[22rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 lg:h-full lg:min-h-[24rem] lg:max-h-[42rem]">
            <span className="text-sm text-slate-400">画像なし</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {item.image_file_id && (item.image_mime ?? '').includes('pdf') && (
            item.page != null ? (
              <>
                <a href={api.fileUrl(item.image_file_id, item.page)} target="_blank" rel="noreferrer"
                  className="text-xs text-brand-600 hover:underline">
                  このページのPDFを開く
                </a>
                <a href={api.fileUrl(item.image_file_id)} target="_blank" rel="noreferrer"
                  className="text-xs text-slate-400 hover:underline">
                  （全体）
                </a>
              </>
            ) : (
              <a href={api.fileUrl(item.image_file_id)} target="_blank" rel="noreferrer"
                className="text-xs text-brand-600 hover:underline">
                元のPDFを開く
              </a>
            )
          )}
          {item.source === 'email' && (
            <button onClick={() => setShowEmail(true)} className="text-xs text-brand-600 hover:underline">
              メール本文を表示
            </button>
          )}
        </div>
      </div>

      {/* 右: 店舗名/日付 → 取引先+T番号 → 借方 → 貸方 → 金額・消費税 → 操作 */}
      <div className="space-y-3">
        {item.parse_failed && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            請求書として認識できませんでした。内容を手入力するか、「否認」「削除」してください。
          </div>
        )}
        {lockDate && item.date && item.date <= lockDate && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            期間外: 締め日({lockDate})以前の日付です。AIの読み取り誤りなら日付を修正、締め後のものなら取り下げ/訂正してください。
          </div>
        )}
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
          {item.page != null && <span className="font-medium text-slate-500">ページ {item.page}</span>}
          {showCreator && item.created_by_name && <span>登録: {item.created_by_name}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NoteChips ids={noteIds} notes={notes} empty={<span className="text-xs text-slate-400">付箋なし</span>} />
          <Button size="sm" variant="secondary" onClick={() => setTagging(true)}><Icon.Plus /> 付箋</Button>
          <Button size="sm" variant="secondary" onClick={() => setShowHistory(true)}><Icon.Clock /> 履歴</Button>
        </div>

        {/* 取引先 + インボイス番号（1行） */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">
              取引先
              {partners.some((p) => p.name === partnerNameInput.trim()) && (
                <span className="ml-1 text-emerald-600">(マスタ一致)</span>
              )}
            </span>
            <Input
              list="partner-master-list"
              value={partnerNameInput}
              onChange={(e) => setPartnerNameInput(e.target.value)}
              placeholder="取引先名(自由入力)"
            />
            <datalist id="partner-master-list">
              {partners.map((p) => <option key={p.id} value={p.name} />)}
            </datalist>
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

        {/* メモ（取込時にファイル名/ページ/音声を初期値。自由に編集・削除可） */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">メモ</span>
          <Textarea rows={3} value={memoInput} onChange={(e) => setMemoInput(e.target.value)}
            placeholder="ファイル名・ページ・音声などの控え（自由に編集できます）" />
        </label>

        {/* 借方科目 */}
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
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

        {/* 補助科目（選択中の借方科目に補助科目が登録されている場合だけ表示） */}
        {subAccounts.length > 0 && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">
              補助科目{subParentName && `（${subParentName}）`}
            </span>
            <Select value={subTitleId} onChange={(e) => setSubTitleId(e.target.value)}>
              <option value="">(なし)</option>
              {subAccounts.map((s) => (
                <option key={s.id} value={s.id}>{s.code ? `${s.code} ${s.name}` : s.name}</option>
              ))}
            </Select>
          </label>
        )}

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
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
          <span className="text-xs font-medium text-slate-500">金額・消費税</span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
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
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
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
      {showEmail && <EmailViewModal receiptId={item.id} onClose={() => setShowEmail(false)} />}
      {showHistory && <ReceiptHistoryModal receiptId={item.id} onClose={() => setShowHistory(false)} />}
    </div>
  )
}
