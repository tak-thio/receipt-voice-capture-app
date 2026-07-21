import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatDate } from '../format'
import { api, type JournalizeBody, type MasterRow, type NoteRow, type SubAccountRow, type Suggestion, type TaxLine } from '../api'
import { Button, cn, Icon, Input, Select, Textarea } from '../ui'
import { useToast } from '../ui/toast'
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
  tax_lines?: TaxLine[] // 消費税内訳(行リスト・請求書通り)
  tax_mode: string | null
  currency?: string | null // 外貨("USD"等)。円建ては null
  foreign_amount?: number | null // 現地支払総額
  // 照合済みカード明細の「ご利用額(円)」採用提案(円未確定の外貨領収書など)。
  card_line_suggestion?: { line_id: string; amount_jpy: number | null; vendor: string | null; date: string | null } | null
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
  images?: { file_id: string; mime: string | null }[] // capture画像(複数=マージで束ねた明細+鏡)
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
  item, titles, partners, notes, noteIds, showCreator, lockDate, fitViewport, onToggleNote, renderActions,
}: {
  item: EditableReceipt
  titles: MasterRow[]
  partners: MasterRow[]
  notes: NoteRow[]
  noteIds: string[]
  showCreator?: boolean
  lockDate?: string | null // 締め日(YYYY-MM-DD)。取引日がこれ以前なら「期間外」警告
  // 1080ディスプレイ対策(仕分け画面): エディタ全体をビューポート内に収め、左右カラムを
  // 内部スクロールにする(操作ボタン行は右カラム下部に固定表示)。下のキューが常に見える。
  fitViewport?: boolean
  onToggleNote: (noteId: string) => void
  renderActions: (getValues: () => JournalizeBody, debitSelected: boolean) => ReactNode
}) {
  const toast = useToast()
  const [tagging, setTagging] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [titleId, setTitleId] = useState('') // 借方科目
  const [creditTitleId, setCreditTitleId] = useState('') // 貸方科目
  const [creditFromPayment, setCreditFromPayment] = useState(false) // 支払方法から初期提案した印
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
  // 消費税内訳(行リスト)。区分ラベルは固定しない(10%/8%/その他/非課税/対象外/将来の新税率)。
  const [taxLines, setTaxLines] = useState<TaxLine[]>([])
  const [taxModeInput, setTaxModeInput] = useState('') // 税区分
  const [currencyInput, setCurrencyInput] = useState('') // 外貨コード(USD等)
  const [foreignInput, setForeignInput] = useState('') // 現地支払総額
  const [showFx, setShowFx] = useState(false) // 外貨入力欄を出す(国内行にはノイズを出さない)
  const [paymentInput, setPaymentInput] = useState('') // 支払方法
  const [tnumberInput, setTnumberInput] = useState('') // インボイス番号(T番号)
  const [tnumberFromMaster, setTnumberFromMaster] = useState(false) // 取引先マスタから補完した印
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
    setTaxLines((item.tax_lines ?? []).map((l) => ({ ...l })))
    setTaxTotalInput(item.tax_jpy != null ? String(item.tax_jpy) : '')
    setAmountInput(item.amount_jpy != null ? String(item.amount_jpy) : '')
    setSubtotalInput(item.subtotal_jpy != null ? String(item.subtotal_jpy) : '')
    setCurrencyInput(item.currency ?? '')
    setForeignInput(item.foreign_amount != null ? String(item.foreign_amount) : '')
    setShowFx(false)
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
  // 補助科目は「補助科目を持つ科目」(借方優先/なければ貸方)に紐づく。その科目の直下に描画するため、
  // 借方紐づきかどうかと、補助科目フィールド自体を用意しておく。
  const subIsDebit = subParentId !== '' && subParentId === titleId
  const subAccountField = subAccounts.length > 0 ? (
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
  ) : null
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

  // 貸方の初期提案(画面表示時): 貸方が未確定で、支払方法(AI読取)から推定できる場合だけ
  // 初期選択する(人が変えられる・保存で確定)。確信の持てない支払方法は未確定のまま。
  // 現金→現金 / クレジット・カード→未払金 / 口座振替・振込→普通預金。
  useEffect(() => {
    if (creditTitleId || item.credit_account_title_id) return
    const pm = item.payment_method ?? ''
    if (!pm.trim()) return
    const pick = (name: string) => titles.find((t) => t.name === name)?.id
    let id: string | undefined
    if (/現金/.test(pm)) id = pick('現金')
    else if (/クレジット|カード|credit|visa|master|jcb|amex/i.test(pm)) id = pick('未払金')
    else if (/口座振替|振替|振込|引き落/.test(pm)) id = pick('普通預金')
    if (id) {
      setCreditTitleId(id)
      setCreditFromPayment(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, titles])

  // T番号の補完(画面表示時): 領収書から読めていない時だけ、引当済み(or提案/名称一致)の
  // 取引先マスタのT番号を入力欄へ入れる。人が画面で確認して保存する=それが確定。
  // 既に値がある(AI読取/手入力/補完済み)場合は一切触らない。
  useEffect(() => {
    if (tnumberInput.trim()) return
    const pid = item.partner_id ?? item.suggestion?.partner_id ?? null
    const p = (pid ? partners.find((x) => x.id === pid) : undefined)
      ?? partners.find((x) => x.name === partnerNameInput.trim())
    if (p?.t_number) {
      setTnumberInput(p.t_number)
      setTnumberFromMaster(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, partners, partnerNameInput])

  // --- 空欄の導出(算術のみ・税率の仮定はしない) -------------------------------
  // 入っている値から一意に決まる空欄を連鎖的に導出する(空欄を埋めるボタン/活性判定で共用)。
  function deriveBlanks(a0: number | null, s0: number | null, t0: number | null, lines0: TaxLine[]) {
    let amount = a0, subtotal = s0, tax = t0, lines = lines0, changed = false
    for (let i = 0; i < 5; i++) {
      const lineTaxes = lines.map((l) => l.tax_jpy).filter((v): v is number => v != null)
      if (tax == null && lineTaxes.length > 0) { tax = lineTaxes.reduce((x, y) => x + y, 0); changed = true; continue }
      if (subtotal == null && lines.length > 0 && lines.every((l) => l.base_jpy != null)) {
        subtotal = lines.reduce((x, l) => x + (l.base_jpy as number), 0); changed = true; continue
      }
      if (amount == null && subtotal != null && tax != null) { amount = subtotal + tax; changed = true; continue }
      if (subtotal == null && amount != null && tax != null) { subtotal = amount - tax; changed = true; continue }
      if (tax == null && amount != null && subtotal != null) { tax = amount - subtotal; changed = true; continue }
      // 税内訳が1行だけなら、その対象額=税抜(全体)と一意に決まる。
      if (subtotal != null && lines.length === 1 && lines[0].base_jpy == null && (lines[0].tax_jpy != null || lines[0].label)) {
        lines = [{ ...lines[0], base_jpy: subtotal }]; changed = true; continue
      }
      break
    }
    return { amount, subtotal, tax, lines, changed }
  }
  const derived = deriveBlanks(numOrNull(amountInput), numOrNull(subtotalInput), numOrNull(taxTotalInput), taxLines)
  function fillBlanks() {
    if (!derived.changed) return
    if (derived.amount != null) setAmountInput(String(derived.amount))
    if (derived.subtotal != null) setSubtotalInput(String(derived.subtotal))
    if (derived.tax != null) setTaxTotalInput(String(derived.tax))
    setTaxLines(derived.lines)
  }

  // --- 金額の整合性チェック(表示のみ。入力済みの値だけを検算し、空欄は対象外) ----
  const consistency = (() => {
    const amount = numOrNull(amountInput)
    const subtotal = numOrNull(subtotalInput)
    const tax = numOrNull(taxTotalInput)
    const lineTaxes = taxLines.map((l) => l.tax_jpy).filter((v): v is number => v != null)
    const allBases = taxLines.length > 0 && taxLines.every((l) => l.base_jpy != null)
    const bad = new Set<string>()
    const msgs: string[] = []
    if (amount != null && subtotal != null && tax != null && subtotal + tax !== amount) {
      bad.add('amount'); bad.add('subtotal'); bad.add('tax')
      msgs.push(`合計 ≠ 税抜＋消費税（差 ¥${(amount - subtotal - tax).toLocaleString()}）`)
    }
    if (tax != null && lineTaxes.length > 0) {
      const sum = lineTaxes.reduce((x, y) => x + y, 0)
      if (sum !== tax) {
        bad.add('tax'); bad.add('lines')
        msgs.push(`消費税合計 ≠ 税内訳の税額計（差 ¥${(tax - sum).toLocaleString()}）`)
      }
    }
    if (subtotal != null && allBases) {
      const sum = taxLines.reduce((x, l) => x + (l.base_jpy as number), 0)
      if (sum !== subtotal) {
        bad.add('subtotal'); bad.add('lines')
        msgs.push(`税抜 ≠ 税内訳の対象額計（差 ¥${(subtotal - sum).toLocaleString()}）`)
      }
    }
    return { bad, msgs }
  })()
  // Input の基底クラス(border-slate-300/bg-white)に勝つため !important 修飾で上書きする。
  const errCls = (k: string) => (consistency.bad.has(k) ? '!border-rose-400 !bg-rose-50' : '')

  // 自動計算: 人が明示的に指示した時だけ計算する(既定は請求書の印字値をそのまま=計算しない)。
  // 内税r%: 合計(税込)から税額を切り出す。外税r%: 税抜(空なら合計欄の値)を本体に税を上乗せ。
  // 端数は切り捨て(実務慣行)。印字と合わない場合は手修正する。既存の値は上書きされる。
  function autoTax(mode: 'inclusive' | 'exclusive', rate: number) {
    // 計算結果が既存の入力と同一だと「押しても何も起きない」ように見えるため、
    // 何をどう計算したかを必ずトーストで返す(変化が無ければその旨も)。
    const before = `${numOrNull(amountInput)}/${numOrNull(subtotalInput)}/${numOrNull(taxTotalInput)}`
    let total: number, base: number, tax: number
    if (mode === 'inclusive') {
      const a = numOrNull(amountInput)
      if (a == null) return
      total = a
      tax = Math.floor((total * rate) / (100 + rate))
      base = total - tax
    } else {
      const s = numOrNull(subtotalInput) ?? numOrNull(amountInput)
      if (s == null) return
      base = s
      tax = Math.floor((base * rate) / 100)
      total = base + tax
    }
    setAmountInput(String(total))
    setSubtotalInput(String(base))
    setTaxTotalInput(String(tax))
    setTaxLines([{ label: `${rate}%`, tax_jpy: tax, base_jpy: base }])
    setTaxModeInput(mode)
    const same = before === `${total}/${base}/${tax}`
    toast.success(
      `${mode === 'inclusive' ? '内税' : '外税'}${rate}%で計算: 合計 ¥${total.toLocaleString()}・税抜 ¥${base.toLocaleString()}・消費税 ¥${tax.toLocaleString()}${same ? '（既にこの値でした）' : ''}`,
    )
  }

  // 税内訳を編集したら消費税合計を自動更新（確定値の集計。合計は手修正も可）。
  function syncTaxTotal(lines: TaxLine[]) {
    const vals = lines.map((l) => l.tax_jpy).filter((v): v is number => v != null)
    if (vals.length === 0) return
    setTaxTotalInput(String(vals.reduce((a, b) => a + b, 0)))
  }
  function updateTaxLine(i: number, patch: Partial<TaxLine>) {
    const next = taxLines.map((l, j) => (j === i ? { ...l, ...patch } : l))
    setTaxLines(next)
    syncTaxTotal(next)
  }
  function addTaxLine() {
    setTaxLines([...taxLines, { label: null, tax_jpy: null }])
  }
  function removeTaxLine(i: number) {
    const next = taxLines.filter((_, j) => j !== i)
    setTaxLines(next)
    syncTaxTotal(next)
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
      // 空行(区分も金額も無い)は送らない。値は請求書の表記・実額そのまま(計算しない)。
      tax_lines: taxLines
        .filter((l) => (l.label && l.label.trim()) || l.tax_jpy != null || l.base_jpy != null)
        .map((l) => ({ label: l.label?.trim() || null, tax_jpy: l.tax_jpy ?? null, base_jpy: l.base_jpy ?? null })),
      tax_mode: taxModeInput || null,
      currency: currencyInput.trim() ? currencyInput.trim().toUpperCase() : null,
      foreign_amount: foreignInput.trim() && !Number.isNaN(parseFloat(foreignInput)) ? parseFloat(foreignInput) : null,
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
    <div className={cn('grid gap-4 p-4 lg:grid-cols-2', fitViewport && 'lg:h-[calc(100vh-28rem)] lg:min-h-[30rem]')}>
      {/* 左: 領収書イメージ（縦長対応で大きく）。fitViewport時はカラム内スクロール。 */}
      <div className={cn('space-y-1', fitViewport && 'lg:min-h-0 lg:overflow-y-auto lg:pr-1')}>
        {(() => {
          // マージ済み(明細+鏡)は画像が複数。images があれば全部を並列(縦積み)で表示。無ければ1枚。
          const imgs = item.images?.length
            ? item.images
            : item.image_file_id
              ? [{ file_id: item.image_file_id, mime: item.image_mime }]
              : []
          if (!imgs.length) {
            return (
              <div className={cn('flex h-[24rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-50', fitViewport ? 'lg:h-[28rem]' : 'lg:h-[32rem]')}>
                <span className="text-sm text-slate-400">画像なし</span>
              </div>
            )
          }
          return (
            <div className="space-y-2">
              {imgs.map((im, i) => (
                <div key={im.file_id} className="relative">
                  {/* PDFはサーバーで1ページ目を画像化して返すので、常に <img>。ズーム/パン対応。 */}
                  <ZoomableImage
                    src={api.previewUrl(im.file_id, item.page)}
                    alt="領収書"
                    className={cn('h-[24rem] rounded-xl border border-slate-200', fitViewport ? 'lg:h-[28rem]' : 'lg:h-[32rem]')}
                  />
                  {imgs.length > 1 && (
                    <span className="absolute left-2 top-2 rounded bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-white">
                      画像{i + 1}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        })()}
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

      {/* 右: 店舗名/日付 → 取引先+T番号 → 借方 → 貸方 → 金額・消費税 → 操作。
          fitViewport時は入力部だけスクロールし、操作ボタン行は下に固定表示。 */}
      <div className={cn('space-y-3', fitViewport && 'lg:flex lg:min-h-0 lg:flex-col')}>
        <div className={cn('space-y-3', fitViewport && 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1')}>
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
            <Input value={tnumberInput}
              onChange={(e) => { setTnumberInput(e.target.value); setTnumberFromMaster(false) }}
              placeholder="T1234567890123" />
            {tnumberFromMaster && (
              <span className="block text-[11px] text-emerald-600">取引先マスタから補完（保存で確定）</span>
            )}
          </label>
        </div>

        {/* 摘要（AIが自動入力。手修正可） */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">摘要</span>
          <Textarea rows={2} value={descriptionInput} onChange={(e) => setDescriptionInput(e.target.value)}
            placeholder="仕訳の摘要（AIが自動入力します。修正できます）" />
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

        {/* 補助科目: 借方科目に補助科目がある場合は、その直下に表示 */}
        {subIsDebit && subAccountField}

        {/* 貸方科目 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              貸方科目
              {creditFromPayment && (
                <span className="ml-1.5 font-normal text-emerald-600">支払方法「{item.payment_method}」から提案</span>
              )}
            </span>
            {pinnedCredit.length > 0 && (
              <button onClick={() => setShowAllCredit((v) => !v)} className="text-xs font-medium text-brand-600 hover:underline">
                {showAllCredit ? 'よく使うのみ' : `すべて表示 (${titles.length})`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* 貸方は任意: 領収書からは支払手段の勘定が確定できないことがあるため、
                「未確定」のまま仕訳し、経理側/会計ソフト側で決める運用を許す。 */}
            <button onClick={() => { setCreditTitleId(''); setCreditFromPayment(false) }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                creditTitleId === ''
                  ? 'bg-slate-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100',
              )}>
              (未確定)
            </button>
            {shownCredit.map((t) => (
              <button key={t.id} onClick={() => { setCreditTitleId(t.id); setCreditFromPayment(false) }}
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

        {/* 補助科目: 貸方科目に補助科目がある場合は、その直下に表示 */}
        {!subIsDebit && subAccountField}

        {/* 金額・消費税（すべて編集可能・請求書の印字値をそのまま）。税率は固定しない。 */}
        <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
          <span className="text-xs font-medium text-slate-500">金額・消費税</span>
          {/* 外貨領収書など円未確定のとき: 照合済みカード明細の引落額(円)を1クリックで採用。
              書くのは人の操作(このボタン→保存=仕訳確定)。自動では書かない。 */}
          {item.card_line_suggestion && !amountInput.trim() && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-2.5">
              <span className="text-xs text-slate-600">
                クレジット明細と照合済み: {formatDate(item.card_line_suggestion.date)}・{item.card_line_suggestion.vendor ?? '—'}
                （実際の引落額 ¥{(item.card_line_suggestion.amount_jpy ?? 0).toLocaleString()}）
              </span>
              <Button size="sm" onClick={() => setAmountInput(String(item.card_line_suggestion?.amount_jpy ?? ''))}>
                合計金額に採用
              </Button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">合計金額(税込)</span>
              <Input inputMode="numeric" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className={cn('text-right tabular-nums', errCls('amount'))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">税抜金額</span>
              <Input inputMode="numeric" value={subtotalInput} onChange={(e) => setSubtotalInput(e.target.value)} className={cn('text-right tabular-nums', errCls('subtotal'))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">消費税合計</span>
              <Input inputMode="numeric" value={taxTotalInput} onChange={(e) => setTaxTotalInput(e.target.value)} className={cn('text-right tabular-nums', errCls('tax'))} />
            </label>
          </div>
          {/* 金額の不整合(入力済みの値だけを検算)。どこが合わないかを差額つきで示す。 */}
          {consistency.msgs.length > 0 && (
            <div className="space-y-0.5">
              {consistency.msgs.map((m) => (
                <p key={m} className="text-xs font-medium text-rose-600">⚠ {m}</p>
              ))}
            </div>
          )}
          {/* 補完(算術のみ) と 自動計算(税率の指示つき)。 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={fillBlanks}
              disabled={!derived.changed}
              className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent"
              title="入力済みの値から一意に決まる空欄を算術で埋めます(税率の仮定はしません)"
            >
              空欄を埋める
            </button>
            <span className="mx-0.5 h-3.5 w-px bg-slate-200" />
            <span className="text-xs text-slate-400">自動計算:</span>
            {([['inclusive', 10, '内税10%'], ['exclusive', 10, '外税10%'], ['inclusive', 8, '内税8%'], ['exclusive', 8, '外税8%']] as const).map(([m, r, label]) => (
              <button
                key={label}
                onClick={() => autoTax(m, r)}
                disabled={m === 'inclusive' ? !amountInput.trim() : !(subtotalInput.trim() || amountInput.trim())}
                className="rounded-md border border-brand-200 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent"
                title={m === 'inclusive' ? '合計金額(税込)から税額を切り出して埋めます' : '税抜金額(空なら合計欄の値)を本体として税を上乗せします'}
              >
                {label}
              </button>
            ))}
            <span className="text-[11px] text-slate-300">端数切捨て・入力済みの値は上書き</span>
          </div>
          {/* 消費税の内訳: 請求書通りに保存(計算しない)。複数税率の混在は行を足す。
              区分は自由入力＋サジェスト — 新税率(例: 食料品1%)が来てもここに足すだけ。 */}
          <div className={cn('space-y-1 rounded-lg border border-slate-100 bg-slate-50/50 p-2', consistency.bad.has('lines') && '!border-rose-300 !bg-rose-50/40')}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">消費税の内訳（請求書の表記のまま）</span>
              <button onClick={addTaxLine} className="text-xs font-medium text-brand-700 hover:underline">＋ 行を追加</button>
            </div>
            {taxLines.length === 0 && (
              <p className="text-xs text-slate-400">内訳なし — 「＋ 行を追加」で 10% / 8% / その他 等を入力</p>
            )}
            {taxLines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input list="tax-label-suggestions" value={l.label ?? ''} placeholder="区分（10% / その他…）"
                  onChange={(e) => updateTaxLine(i, { label: e.target.value })} className="w-40" />
                <Input inputMode="numeric" value={l.tax_jpy != null ? String(l.tax_jpy) : ''} placeholder="税額¥"
                  onChange={(e) => updateTaxLine(i, { tax_jpy: numOrNull(e.target.value) })} className="w-28 text-right tabular-nums" />
                <Input inputMode="numeric" value={l.base_jpy != null ? String(l.base_jpy) : ''} placeholder="対象額¥(任意)"
                  onChange={(e) => updateTaxLine(i, { base_jpy: numOrNull(e.target.value) })} className="w-32 text-right tabular-nums" />
                <button onClick={() => removeTaxLine(i)} className="px-1 text-slate-400 hover:text-red-600" title="行を削除">✕</button>
              </div>
            ))}
            <datalist id="tax-label-suggestions">
              <option value="10%" />
              <option value="8%" />
              <option value="その他" />
              <option value="非課税" />
              <option value="対象外" />
            </datalist>
          </div>
          {/* 外貨(書面の印字値)。外貨建てのみ表示 — 円の計上額はカード明細との紐付けで確定するまで空でよい。 */}
          {currencyInput || foreignInput || showFx ? (
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-slate-500">通貨（外貨のみ）</span>
                <Input value={currencyInput} onChange={(e) => setCurrencyInput(e.target.value)} placeholder="USD" className="uppercase" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500">現地支払額</span>
                <Input inputMode="decimal" value={foreignInput} onChange={(e) => setForeignInput(e.target.value)} placeholder="220.00" className="text-right tabular-nums" />
              </label>
              <span className="self-end pb-2 text-[11px] leading-tight text-slate-400">円の計上額はカード明細と紐付けて確定</span>
            </div>
          ) : (
            <button onClick={() => setShowFx(true)} className="text-xs text-slate-400 hover:text-brand-700 hover:underline">＋ 外貨（USD等）の情報を入力</button>
          )}
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

        {/* メモ（取込時にファイル名/ページ/音声を初期値。自由に編集・削除可）。参照頻度が低いので最下部。 */}
        <label className="block space-y-1 border-t border-slate-100 pt-2.5">
          <span className="text-xs font-medium text-slate-500">メモ</span>
          <Textarea rows={3} value={memoInput} onChange={(e) => setMemoInput(e.target.value)}
            placeholder="ファイル名・ページ・音声などの控え（自由に編集できます）" />
        </label>
        </div>
        {/* 操作（呼び出し側が差し込む）。fitViewport時もスクロールせず常に見える。 */}
        <div className={cn('flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3', fitViewport && 'lg:shrink-0')}>
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
