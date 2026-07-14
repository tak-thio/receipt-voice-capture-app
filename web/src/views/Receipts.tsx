import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { api, type NoteRow, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, cn, EmptyState, Icon, IconButton, Input, Modal, PageHeader,
  Select, Table, Tbody, Td, Textarea, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { useToast } from '../ui/toast'
import { EmailViewModal } from './EmailViewModal'
import { ReceiptHistoryModal } from './ReceiptHistoryModal'
import { MergeReview, initialMergeValues } from './MergeReview'
import { ZoomableImage } from './ZoomableImage'

const APPROVAL_LABEL: Record<string, { label: string; tone: 'danger' | 'neutral' }> = {
  rejected: { label: '否認', tone: 'danger' },
  mistake: { label: '間違い', tone: 'neutral' },
  deleted: { label: '削除済', tone: 'neutral' },
}
function statusBadge(r: ReceiptRow) {
  if (r.journalized_at) return <Badge tone="success">仕分済</Badge>
  const a = APPROVAL_LABEL[r.approval_status]
  if (a) return <Badge tone={a.tone}>{a.label}</Badge>
  if (r.processing) return <Badge tone="neutral">解析中…</Badge>
  if (r.parse_failed) return <Badge tone="danger">解析失敗</Badge>
  return <Badge tone="warning">未仕分</Badge>
}

// 取込元(source)をアイコンで: メール / アップロード / アプリ(スマホ)。
function SourceIcon({ source }: { source: string | null }) {
  if (source === 'email')
    return <span title="メール取込" className="inline-flex text-slate-500"><Icon.Mail className="text-lg" /></span>
  if (source === 'manual')
    return <span title="アップロード" className="inline-flex text-slate-500"><Icon.Upload className="text-lg" /></span>
  if (source === 'mobile')
    return <span title="アプリ(スマホ)" className="inline-flex text-slate-500"><Icon.Phone className="text-lg" /></span>
  return <span className="text-slate-300">—</span>
}

export function ReceiptsView({
  clientId,
  showCreator,
  canPollGmail,
  lockDate,
  lane = 'company',
  onOpenCardBatch,
}: {
  clientId: string
  showCreator?: boolean
  canPollGmail?: boolean
  lockDate?: string | null // 締め日(YYYY-MM-DD)。取引日がこれ以前なら「期間外」警告
  lane?: string // company=会社の受信箱 / expense=一般社員の未申請トレイ
  onOpenCardBatch?: (batchId: string) => void // クレジット明細バッチ→クレジット明細画面(該当明細)へ遷移
}) {
  const toast = useToast()
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState<ReceiptRow | null>(null)
  const [emailView, setEmailView] = useState<ReceiptRow | null>(null)
  const [editing, setEditing] = useState<ReceiptRow | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [imageView, setImageView] = useState<ReceiptRow | null>(null) // 画像だけを大きく並列で見るビューア
  const [renamingBatch, setRenamingBatch] = useState<ReceiptRow | null>(null) // クレジット明細バッチの名前変更
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [polling, setPolling] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // マージ(明細+鏡→統合伝票): 複数選択 or 重複グループを束ね、項目ごとに採用値を選ぶ。
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState<ReceiptRow[] | null>(null)
  const [mergeValues, setMergeValues] = useState<Record<string, unknown>>({})
  const [mergeBusy, setMergeBusy] = useState(false)

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
    )
    if (!files.length || !clientId) return
    setUploading(true)
    let ok = 0
    for (const f of files) {
      try {
        await api.uploadReceipt(clientId, f)
        ok++
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setUploading(false)
    if (ok) {
      toast.success(`${ok}件アップロードしました`)
      void load()
    }
  }
  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    e.target.value = '' // allow re-selecting the same files
    if (files) void uploadFiles(files)
  }

  // 連携メールを今すぐ取り込む(定期実行=Cron相当の処理を手動でキック)。
  async function pollGmail() {
    if (!clientId) return
    setPolling(true)
    try {
      const r = await api.gmailPoll(clientId)
      toast.success(`メール取込: ${r.appended}件追加${r.failed ? ` / 失敗${r.failed}件` : ''}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setPolling(false)
    }
  }

  async function load() {
    if (!clientId) {
      setRows([])
      return
    }
    setLoading(true)
    setSelected(new Set()) // 再読込で選択はクリア(古いIDが残らないように)
    try {
      setRows(await api.receipts(clientId, q || undefined, { dateFrom, dateTo, amountMin, amountMax, lane }))
    } finally {
      setLoading(false)
    }
  }
  async function clearFilters() {
    setQ(''); setDateFrom(''); setDateTo(''); setAmountMin(''); setAmountMax('')
    setLoading(true)
    try {
      setRows(await api.receipts(clientId, undefined, { lane }))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    if (clientId) api.notes(clientId).then(setNotes).catch(() => setNotes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // 解析中(未処理)の受信物があるときは自動ポーリングで進捗を反映(ローディング表示なしの静かな更新)。
  const pollCountRef = useRef(0)
  async function refreshRows() {
    if (!clientId) return
    try {
      setRows(await api.receipts(clientId, q || undefined, { dateFrom, dateTo, amountMin, amountMax, lane }))
    } catch { /* ポーリングの失敗は無視 */ }
  }
  useEffect(() => {
    if (!rows.some((r) => r.processing)) { pollCountRef.current = 0; return }
    if (pollCountRef.current >= 60) return // ~5分(5s×60)で打ち切り(スタック対策)
    const t = setTimeout(() => { pollCountRef.current += 1; void refreshRows() }, 5000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  async function handleDelete(r: ReceiptRow) {
    if (!window.confirm('この領収書を削除しますか?')) return
    if (await toast.run(() => api.setApproval(r.id, 'deleted'), '削除しました')) void load()
  }

  // 「これは重複ではない」= グループから外す(突き合わせと同じ /reconcile/not-duplicate)。
  async function handleNotDuplicate(r: ReceiptRow) {
    if (await toast.run(() => api.notDuplicate(r.id), '重複ではないとして外しました')) void load()
  }

  function toggleSelect(id: string, on: boolean) {
    setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  }
  // 統合レビューを開く。初期値=金額の大きい順で最初の非null(基準優先)。項目ごとに後で調整可。
  function openMerge(list: ReceiptRow[]) {
    if (list.length < 2) { toast.error('マージには未仕訳の領収書が2件以上必要です'); return }
    setMergeValues(initialMergeValues(list))
    setMerging(list)
  }
  // 統合伝票を「ばらす」: 束ねた元の領収書に戻す(統合伝票は削除)。
  async function handleUnmerge(r: ReceiptRow) {
    if (!window.confirm('この統合伝票をばらして、元の領収書に戻しますか?')) return
    if (await toast.run(() => api.unmergeReceipts(r.id), 'ばらしました（元の領収書に戻しました）')) void load()
  }
  // クレジット明細の取込バッチ(塊)を一括削除(重複アップの片方を1クリックで消す)。
  async function handleDeleteBatch(r: ReceiptRow) {
    if (!window.confirm(`このクレジット明細の取込（${r.card_batch?.count ?? ''}件）をまとめて削除しますか？`)) return
    if (await toast.run(() => api.deleteCardBatch(r.id), 'クレジット明細の取込を削除しました')) void load()
  }
  async function handleMerge() {
    if (!merging) return
    setMergeBusy(true)
    const ok = await toast.run(
      () => api.mergeReceipts(merging.map((r) => r.id), mergeValues),
      `${merging.length}件を統合伝票にまとめました`,
    )
    setMergeBusy(false)
    if (ok) { setMerging(null); setSelected(new Set()); void load() }
  }

  // 重複の可能性があるもの(同一 match_id)を突き合わせ画面のようにグルーピングして表示する。
  const blocks = useMemo(() => {
    type Block = { kind: 'single'; row: ReceiptRow } | { kind: 'group'; primary: ReceiptRow; dups: ReceiptRow[] }
    const byMatch = new Map<string, ReceiptRow[]>()
    for (const r of rows) {
      if (!r.match_id) continue
      const arr = byMatch.get(r.match_id) ?? []
      arr.push(r)
      byMatch.set(r.match_id, arr)
    }
    const out: Block[] = []
    const done = new Set<string>()
    for (const r of rows) {
      if (done.has(r.id)) continue
      const grp = r.match_id ? byMatch.get(r.match_id) : undefined
      if (grp && grp.length >= 2) {
        grp.forEach((g) => done.add(g.id))
        const primary = grp.find((g) => g.approval_status === 'pending') ?? grp[0]
        out.push({ kind: 'group', primary, dups: grp.filter((g) => g.id !== primary.id) })
      } else {
        done.add(r.id)
        out.push({ kind: 'single', row: r })
      }
    }
    return out
  }, [rows])

  async function toggleNote(noteId: string) {
    if (!tagging) return
    const has = tagging.note_ids.includes(noteId)
    const next = has ? tagging.note_ids.filter((x) => x !== noteId) : [...tagging.note_ids, noteId]
    setTagging({ ...tagging, note_ids: next })
    setRows((rs) => rs.map((r) => (r.id === tagging.id ? { ...r, note_ids: next } : r)))
    await toast.run(() => api.setReceiptNotes(tagging.id, next))
  }

  // 1行の描画。variant: normal=通常 / primary=重複グループの本体 / dup=重複の可能性(インデント表示)。
  function renderRow(r: ReceiptRow, variant: 'normal' | 'primary' | 'dup', dupCount = 0) {
    if (r.card_batch) {
      // クレジット明細の取込バッチ(塊)。明細行は展開せず、画像アクセス＋一括削除だけを出す。
      return (
        <Tr key={r.id} className="bg-sky-50/60">
          <Td className="w-8"></Td>
          <Td className="text-slate-500">
            {r.captured_at?.slice(0, 10) ?? '—'}
            <span className="block text-[10px] text-slate-400">取込</span>
          </Td>
          <Td><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">明細</span></Td>
          <Td colSpan={showCreator ? 6 : 5}>
            <button
              onClick={() => onOpenCardBatch?.(r.id)}
              className="font-medium text-slate-800 hover:text-brand-600 hover:underline"
              title="この取込の明細を見る"
            >
              {r.card_batch.label}
            </button>
            <button onClick={() => setRenamingBatch(r)} title="名前を変更" className="ml-1 align-middle text-slate-400 hover:text-brand-600">
              <Icon.Pencil className="inline text-sm" />
            </button>
            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">クレジット明細 {r.card_batch.count}件</span>
            <span className="ml-2 text-xs text-slate-400">#{r.card_batch.short_id}</span>
            <button onClick={() => onOpenCardBatch?.(r.id)} className="ml-2 text-xs font-medium text-brand-600 hover:underline">明細を見る →</button>
          </Td>
          <Td>
            {r.image_file_id && (
              <button onClick={() => setImageView(r)} title="明細画像を表示" className="inline-flex text-slate-500 hover:text-brand-600">
                <Icon.Image className="text-lg" />
              </button>
            )}
          </Td>
          <Td className="text-right">
            <button
              onClick={() => void handleDeleteBatch(r)}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              title="この取込をまとめて削除"
            >
              削除
            </button>
          </Td>
        </Tr>
      )
    }
    const isDup = variant === 'dup'
    const grouped = variant !== 'normal'
    const canEdit = r.approval_status === 'pending' && !r.journalized_at
    // マージ対象に選べるのは未仕訳(pending)＋重複候補(duplicate)。仕訳済/削除等は不可。
    const canMerge = (r.approval_status === 'pending' || r.approval_status === 'duplicate') && !r.journalized_at
    return (
      <Tr key={r.id} className={isDup ? 'bg-amber-50/70' : undefined}>
        <Td className="w-8">
          {canMerge && (
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(r.id)}
              onChange={(e) => toggleSelect(r.id, e.target.checked)} title="マージ対象に選択" />
          )}
        </Td>
        <Td className={cn('text-slate-500', grouped && 'border-l-2 border-amber-300')}>
          {r.captured_at?.slice(0, 10) ?? '—'}
        </Td>
        <Td><SourceIcon source={r.source} /></Td>
        <Td className="font-medium text-slate-800">
          {isDup && <span className="mr-1 text-amber-600">↳</span>}
          {r.parse_failed ? (
            <span className="text-rose-600">請求書として認識できませんでした</span>
          ) : (
            r.vendor ?? '—'
          )}
        </Td>
        <Td className="text-right font-medium tabular-nums">
          {r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}
          {/* 外貨領収書のみ: 現地額(印字値)。円はカード明細と紐付けて確定するまで '—' が正しい状態。 */}
          {r.currency && r.currency !== 'JPY' && r.foreign_amount != null && (
            <div className="whitespace-nowrap text-[11px] font-normal text-slate-400">
              {r.currency} {r.foreign_amount.toFixed(2)}
            </div>
          )}
        </Td>
        {showCreator && <Td className="text-slate-500">{r.created_by_name ?? '—'}</Td>}
        <Td className="text-sm text-slate-600">
          <span className="block max-w-[14rem] truncate" title={r.description ?? ''}>{r.description || '—'}</span>
        </Td>
        <Td>
          <div className="flex items-center gap-1.5">
            <NoteChips ids={r.note_ids} notes={notes} />
            <IconButton label="付箋を付ける" className="h-7 w-7" onClick={() => setTagging(r)}><Icon.Plus /></IconButton>
          </div>
        </Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1">
            {isDup ? <Badge tone="warning">重複の可能性</Badge> : statusBadge(r)}
            {variant === 'primary' && dupCount > 0 && <Badge tone="warning">重複 {dupCount}件</Badge>}
            {lockDate && r.captured_at && r.captured_at.slice(0, 10) <= lockDate && <Badge tone="danger">期間外</Badge>}
          </div>
        </Td>
        <Td>
          <div className="flex items-center gap-2 text-slate-500">
            {r.image_file_id && (
              <button
                onClick={() => setImageView(r)}
                title={r.images && r.images.length > 1 ? `画像${r.images.length}枚を表示` : '画像を表示'}
                className="inline-flex hover:text-brand-600"
              >
                {(r.image_mime ?? '').includes('pdf') ? <Icon.FileText className="text-lg" /> : <Icon.Image className="text-lg" />}
              </button>
            )}
            {r.page != null && (
              <span className="text-[10px] tabular-nums text-slate-400" title="PDFのページ">P.{r.page}</span>
            )}
            {r.images && r.images.length > 1 && (
              <span className="rounded bg-brand-50 px-1 text-[10px] font-medium tabular-nums text-brand-600" title="マージ済み(明細+鏡など画像複数)">
                画像{r.images.length}
              </span>
            )}
            {r.source === 'email' && (
              <button onClick={() => setEmailView(r)} title="メール本文を表示" className="inline-flex hover:text-brand-600">
                <Icon.Mail className="text-lg" />
              </button>
            )}
            {!r.image_file_id && r.source !== 'email' && <span className="text-slate-300">—</span>}
          </div>
        </Td>
        <Td className="text-right">
          <div className="flex items-center justify-end gap-1">
            <IconButton label="変更履歴" className="h-7 w-7 hover:!text-brand-600" onClick={() => setHistoryId(r.id)}>
              <Icon.Clock />
            </IconButton>
            {isDup && (
              <button
                onClick={() => void handleNotDuplicate(r)}
                className="rounded-md px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                title="このグループから外す(重複ではない)"
              >
                重複でない
              </button>
            )}
            {variant === 'primary' && dupCount > 0 && (
              <button
                onClick={() => openMerge([r, ...rows.filter((x) => x.match_id === r.match_id && x.id !== r.id && (x.approval_status === 'pending' || x.approval_status === 'duplicate'))])}
                className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                title="明細+鏡として1件にまとめる"
              >
                まとめる
              </button>
            )}
            {r.images && r.images.length > 1 && (
              <button
                onClick={() => void handleUnmerge(r)}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                title="統合伝票をばらして元の領収書に戻す"
              >
                ばらす
              </button>
            )}
            {canEdit && (
              <IconButton label="修正" className="h-7 w-7 hover:!text-brand-600" onClick={() => setEditing(r)}>
                <Icon.Pencil />
              </IconButton>
            )}
            {(canEdit || isDup) && (
              <IconButton label="削除" className="h-7 w-7 hover:!text-red-600" onClick={() => void handleDelete(r)}>
                <Icon.Trash />
              </IconButton>
            )}
          </div>
        </Td>
      </Tr>
    )
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="受信箱" description="顧問先に届いた領収書の一覧です。" />
        <Card><EmptyState icon={<Icon.Inbox />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="受信箱"
        description="顧問先に届いた領収書の一覧です。"
      />

      <div
        className="relative"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(e.dataTransfer.files) }}
      >
      <div className="mb-2 text-xs text-slate-400">ファイルをここにドラッグ&ドロップ、または「アップロード」ボタン（複数選択可）</div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-60 max-w-full">
          <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="支払先 / 登録番号で検索" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          日付
          <Input type="date" className="w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span>〜</span>
          <Input type="date" className="w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          金額
          <Input inputMode="numeric" className="w-24 text-right tabular-nums" placeholder="下限" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
          <span>〜</span>
          <Input inputMode="numeric" className="w-24 text-right tabular-nums" placeholder="上限" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
        </label>
        <Button onClick={() => void load()}>検索</Button>
        <Button variant="ghost" onClick={() => void clearFilters()}>クリア</Button>
        <span className="ml-1 text-sm text-slate-500">{rows.length}件</span>
        {rows.some((r) => r.processing) && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
            解析中 {rows.filter((r) => r.processing).length}件…
          </span>
        )}
        {selected.size >= 2 && (
          <Button variant="secondary" onClick={() => openMerge(rows.filter((r) => selected.has(r.id)))}>
            選択した{selected.size}件をマージ
          </Button>
        )}
        <div className="flex-1" />
        {canPollGmail && (
          <Button variant="secondary" onClick={() => void pollGmail()} disabled={polling}>
            <Icon.Mail /> {polling ? '取込中…' : 'メール取込'}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={onPick}
        />
        <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Icon.Plus /> {uploading ? 'アップロード中…' : 'アップロード'}
        </Button>
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-8"></Th>
              <Th className="w-28">日付</Th>
              <Th className="w-24">取込元</Th>
              <Th>支払先</Th>
              <Th className="text-right">金額</Th>
              {showCreator && <Th className="w-28">登録者</Th>}
              <Th className="w-56">摘要</Th>
              <Th>付箋</Th>
              <Th className="w-24">状態</Th>
              <Th className="w-16">表示</Th>
              <Th className="w-24"></Th>
            </tr>
          </Thead>
          <Tbody>
            {blocks.map((b) =>
              b.kind === 'single'
                ? renderRow(b.row, 'normal')
                : [
                    renderRow(b.primary, 'primary', b.dups.length),
                    ...b.dups.map((d) => renderRow(d, 'dup')),
                  ],
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showCreator ? 11 : 10} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '領収書がありません'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/70 text-sm font-medium text-brand-700">
            ここにドロップしてアップロード
          </div>
        )}
      </div>

      {merging && (
        <Modal
          open
          size="lg"
          onClose={() => { setMerging(null); setMergeBusy(false) }}
          title="統合伝票を作成（1つの支払いにまとめる）"
          description="明細と鏡など「1つの支払いに画像が複数」あるものを統合伝票1件にまとめます。項目ごとに採用する値を選べます（食い違う項目は「要選択」）。金額は合算しません。元の領収書は残り、後で「ばらす」で戻せます。"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMerging(null)}>キャンセル</Button>
              <Button variant="primary" disabled={mergeBusy} onClick={() => void handleMerge()}>
                {mergeBusy ? '統合中…' : 'この内容で統合'}
              </Button>
            </div>
          }
        >
          <MergeReview sources={merging} values={mergeValues} onChange={setMergeValues} />
        </Modal>
      )}

      <NotePickerModal
        open={!!tagging}
        onClose={() => setTagging(null)}
        notes={notes}
        value={tagging?.note_ids ?? []}
        onToggle={(id) => void toggleNote(id)}
      />
      {emailView && <EmailViewModal receiptId={emailView.id} onClose={() => setEmailView(null)} />}
      {historyId && <ReceiptHistoryModal receiptId={historyId} onClose={() => setHistoryId(null)} />}
      {imageView && <ReceiptImagesModal row={imageView} onClose={() => setImageView(null)} />}
      {renamingBatch && <BatchRenameModal row={renamingBatch} onClose={() => setRenamingBatch(null)} onSaved={() => { setRenamingBatch(null); void load() }} />}
      {editing && (
        <ReceiptEditModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

// AIの読み取り内容を直す簡易エディタ（受信箱から呼ぶ）。科目・仕訳には触れず、領収書の
// 見たままの項目だけを修正する。承認(仕分け)前の領収書でのみ表示される。
// クレジット明細バッチ(塊)の受信箱ラベルを変更する。空で既定(アップロード日)に戻る。
function BatchRenameModal({
  row, onClose, onSaved,
}: { row: ReceiptRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(row.card_batch?.label ?? '')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await api.renameCardBatch(row.id, label.trim())
      toast.success('名前を変更しました')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open size="sm" onClose={onClose} title="クレジット明細の名前を変更"
      description="受信箱に表示する名前です。空にすると既定（アップロード日）に戻ります。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </>}
    >
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 2026年6月分 楽天カード" />
    </Modal>
  )
}

// 受信箱で画像だけを大きく見るビューア。統合伝票は明細+鏡を全部・縦に並べてズーム可、元画像リンク付き。
// 画像ビューア(全画像を並列表示・ズーム)。紐付けモーダル(CardStatements)からも再利用するため export。
export function ReceiptImagesModal({ row, onClose, title = '領収書の画像' }: {
  row: Pick<ReceiptRow, 'images' | 'image_file_id' | 'image_mime' | 'page'>
  onClose: () => void
  title?: string
}) {
  const imgs = row.images?.length
    ? row.images
    : row.image_file_id
      ? [{ file_id: row.image_file_id, mime: row.image_mime ?? null }]
      : []
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={title}
      description={imgs.length > 1 ? `${imgs.length}枚（明細＋鏡など）・ズームできます` : 'ズームできます'}
      footer={<Button variant="ghost" onClick={onClose}>閉じる</Button>}
    >
      <div className="space-y-3">
        {imgs.length === 0 && <p className="text-sm text-slate-400">画像がありません</p>}
        {imgs.map((im, i) => (
          <div key={im.file_id} className="relative">
            <ZoomableImage
              src={api.previewUrl(im.file_id, row.page)}
              alt="領収書"
              className="h-[26rem] rounded-xl border border-slate-200 lg:h-[34rem]"
            />
            {imgs.length > 1 && (
              <span className="absolute left-2 top-2 rounded bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium text-white">
                画像{i + 1}
              </span>
            )}
            <a
              href={api.fileUrl(im.file_id, row.page)}
              target="_blank"
              rel="noreferrer"
              className="absolute right-2 top-2 rounded bg-white/90 px-2 py-0.5 text-[11px] font-medium text-brand-600 shadow-sm hover:underline"
            >
              元画像を開く
            </a>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function ReceiptEditModal({
  row, onClose, onSaved,
}: {
  row: ReceiptRow
  onClose: () => void
  onSaved: (updated: ReceiptRow) => void
}) {
  const toast = useToast()
  const [vendor, setVendor] = useState(row.vendor ?? '')
  const [date, setDate] = useState(row.captured_at?.slice(0, 10) ?? '')
  const [amount, setAmount] = useState(row.amount_jpy != null ? String(row.amount_jpy) : '')
  const [taxMode, setTaxMode] = useState(row.tax_mode ?? '')
  const [payment, setPayment] = useState(row.payment_method ?? '')
  const [tnumber, setTnumber] = useState(row.t_number ?? '')
  const [description, setDescription] = useState(row.description ?? '')
  const [memo, setMemo] = useState(row.memo ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const digits = amount.replace(/[^\d-]/g, '')
      const amountJpy = digits === '' ? null : Number(digits)
      const updated = await api.editReceiptContent(row.id, {
        vendor: vendor.trim() || null,
        date: date || null,
        amount_jpy: amountJpy != null && Number.isNaN(amountJpy) ? null : amountJpy,
        tax_mode: taxMode || null,
        payment_method: payment.trim() || null,
        t_number: tnumber.trim() || null,
        description: description.trim() || null,
        memo: memo.trim() || null,
      })
      toast.success('修正しました')
      onSaved(updated)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="領収書の修正"
      description="AIが読み取った内容を修正できます。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左: 画像を大きく並列表示(統合伝票は明細+鏡を縦に並べる)。ズーム可。 */}
        <div>
          {(() => {
            const imgs = row.images?.length
              ? row.images
              : row.image_file_id
                ? [{ file_id: row.image_file_id, mime: row.image_mime ?? null }]
                : []
            if (!imgs.length) {
              return (
                <div className="flex h-[20rem] items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                  <span className="text-sm text-slate-400">画像なし</span>
                </div>
              )
            }
            return (
              <div className="space-y-2">
                {imgs.map((im, i) => (
                  <div key={im.file_id} className="relative">
                    <ZoomableImage
                      src={api.previewUrl(im.file_id, row.page)}
                      alt="領収書"
                      className="h-[22rem] rounded-xl border border-slate-200 lg:h-[26rem]"
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
        </div>

        {/* 右: AI読み取り項目の修正 */}
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">支払先(店名)</span>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="支払先" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-500">日付</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-500">金額(税込)</span>
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="text-right tabular-nums" />
              {/* 外貨領収書: 現地額(読み取り値)を表示。円はカード明細と紐付けて確定する運用。 */}
              {row.currency && row.currency !== 'JPY' && row.foreign_amount != null && (
                <span className="block text-[11px] text-slate-400">
                  外貨建て: {row.currency} {row.foreign_amount.toFixed(2)}（円はクレジット明細との紐付けで確定）
                </span>
              )}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-500">税区分</span>
              <Select value={taxMode} onChange={(e) => setTaxMode(e.target.value)}>
                <option value="">不明</option>
                <option value="inclusive">税込</option>
                <option value="exclusive">税抜</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-500">支払方法</span>
              <Input value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="現金 / クレジット 等" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">インボイス番号(T番号)</span>
            <Input value={tnumber} onChange={(e) => setTnumber(e.target.value)} placeholder="T1234567890123" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">摘要</span>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="用途・メモ" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">メモ</span>
            <Textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)}
              placeholder="ファイル名・ページ・音声などの控え（自由に編集できます）" />
          </label>
        </div>
      </div>
    </Modal>
  )
}

