import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, type NoteRow, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Input, Modal, PageHeader,
  Select, Table, Tbody, Td, Textarea, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { useToast } from '../ui/toast'
import { EmailViewModal } from './EmailViewModal'

const APPROVAL_LABEL: Record<string, { label: string; tone: 'danger' | 'neutral' }> = {
  rejected: { label: '否認', tone: 'danger' },
  mistake: { label: '間違い', tone: 'neutral' },
  deleted: { label: '削除済', tone: 'neutral' },
}
function statusBadge(r: ReceiptRow) {
  if (r.journalized_at) return <Badge tone="success">仕分済</Badge>
  const a = APPROVAL_LABEL[r.approval_status]
  if (a) return <Badge tone={a.tone}>{a.label}</Badge>
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
}: {
  clientId: string
  showCreator?: boolean
  canPollGmail?: boolean
}) {
  const toast = useToast()
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState<ReceiptRow | null>(null)
  const [emailView, setEmailView] = useState<ReceiptRow | null>(null)
  const [editing, setEditing] = useState<ReceiptRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [polling, setPolling] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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
    try {
      setRows(await api.receipts(clientId, q || undefined))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    if (clientId) api.notes(clientId).then(setNotes).catch(() => setNotes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function handleDelete(r: ReceiptRow) {
    if (!window.confirm('この領収書を削除しますか?')) return
    if (await toast.run(() => api.setApproval(r.id, 'deleted'), '削除しました')) void load()
  }

  async function toggleNote(noteId: string) {
    if (!tagging) return
    const has = tagging.note_ids.includes(noteId)
    const next = has ? tagging.note_ids.filter((x) => x !== noteId) : [...tagging.note_ids, noteId]
    setTagging({ ...tagging, note_ids: next })
    setRows((rs) => rs.map((r) => (r.id === tagging.id ? { ...r, note_ids: next } : r)))
    await toast.run(() => api.setReceiptNotes(tagging.id, next))
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
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="支払先 / 登録番号で検索" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <Button onClick={() => void load()}>検索</Button>
        <span className="ml-1 text-sm text-slate-500">{rows.length}件</span>
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
              <Th className="w-28">日付</Th>
              <Th className="w-24">取込元</Th>
              <Th>支払先</Th>
              <Th className="text-right">金額</Th>
              {showCreator && <Th className="w-28">登録者</Th>}
              <Th className="w-56">摘要</Th>
              <Th>付箋</Th>
              <Th className="w-24">状態</Th>
              <Th className="w-16">表示</Th>
              <Th className="w-12"></Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-slate-500">{r.captured_at?.slice(0, 10) ?? '—'}</Td>
                <Td><SourceIcon source={r.source} /></Td>
                <Td className="font-medium text-slate-800">
                  {r.parse_failed ? (
                    <span className="text-rose-600">請求書として認識できませんでした</span>
                  ) : (
                    r.vendor ?? '—'
                  )}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}
                </Td>
                {showCreator && <Td className="text-slate-500">{r.created_by_name ?? '—'}</Td>}
                <Td className="text-sm text-slate-600">
                  <span className="block max-w-[14rem] truncate" title={r.description ?? ''}>
                    {r.description || '—'}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <NoteChips ids={r.note_ids} notes={notes} />
                    <IconButton label="付箋を付ける" className="h-7 w-7" onClick={() => setTagging(r)}>
                      <Icon.Plus />
                    </IconButton>
                  </div>
                </Td>
                <Td>{statusBadge(r)}</Td>
                <Td>
                  <div className="flex items-center gap-2 text-slate-500">
                    {r.image_file_id && (
                      <a
                        href={api.fileUrl(r.image_file_id, r.page)}
                        target="_blank"
                        rel="noreferrer"
                        title={r.page != null ? `このページ(P.${r.page})を開く` : (r.image_mime ?? '').includes('pdf') ? 'PDFを開く' : '画像を開く'}
                        className="inline-flex hover:text-brand-600"
                      >
                        {(r.image_mime ?? '').includes('pdf') ? <Icon.FileText className="text-lg" /> : <Icon.Image className="text-lg" />}
                      </a>
                    )}
                    {r.page != null && (
                      <span className="text-[10px] tabular-nums text-slate-400" title="PDFのページ">P.{r.page}</span>
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
                  {r.approval_status === 'pending' && !r.journalized_at && (
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label="修正" className="h-7 w-7 hover:!text-brand-600" onClick={() => setEditing(r)}>
                        <Icon.Pencil />
                      </IconButton>
                      <IconButton label="削除" className="h-7 w-7 hover:!text-red-600" onClick={() => void handleDelete(r)}>
                        <Icon.Trash />
                      </IconButton>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showCreator ? 10 : 9} className="px-4 py-12 text-center text-sm text-slate-400">
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

      <NotePickerModal
        open={!!tagging}
        onClose={() => setTagging(null)}
        notes={notes}
        value={tagging?.note_ids ?? []}
        onToggle={(id) => void toggleNote(id)}
      />
      {emailView && <EmailViewModal receiptId={emailView.id} onClose={() => setEmailView(null)} />}
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
      <div className="space-y-3">
        {row.image_file_id && (
          <a
            href={api.fileUrl(row.image_file_id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
          >
            {(row.image_mime ?? '').includes('pdf') ? <Icon.FileText /> : <Icon.Image />}
            領収書{(row.image_mime ?? '').includes('pdf') ? 'PDF' : '画像'}を開く
          </a>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-slate-500">支払先(店名)</span>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="支払先" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">日付</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">金額(税込)</span>
            <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="text-right tabular-nums" />
          </label>
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
    </Modal>
  )
}

