import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, type NoteRow, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Input, PageHeader,
  Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { useToast } from '../ui/toast'

const APPROVAL_LABEL: Record<string, { label: string; tone: 'danger' | 'neutral' }> = {
  rejected: { label: '否認', tone: 'danger' },
  mistake: { label: '間違い', tone: 'neutral' },
  deleted: { label: '削除済', tone: 'neutral' },
}
function statusBadge(r: ReceiptRow) {
  if (r.journalized_at) return <Badge tone="success">仕分済</Badge>
  const a = APPROVAL_LABEL[r.approval_status]
  return a ? <Badge tone={a.tone}>{a.label}</Badge> : <Badge tone="warning">未仕分</Badge>
}

// 取込元(source): メール / アップロード / アプリ。
const SOURCE_LABEL: Record<string, { label: string; tone: 'info' | 'neutral' }> = {
  email: { label: 'メール', tone: 'info' },
  manual: { label: 'アップロード', tone: 'neutral' },
  mobile: { label: 'アプリ', tone: 'neutral' },
}
function sourceBadge(source: string | null) {
  const s = SOURCE_LABEL[source ?? '']
  return s ? <Badge tone={s.tone}>{s.label}</Badge> : <Badge tone="neutral">{source ?? '—'}</Badge>
}

export function ReceiptsView({ clientId, showCreator }: { clientId: string; showCreator?: boolean }) {
  const toast = useToast()
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState<ReceiptRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
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
    if (!window.confirm('この領収書を削除しますか?（受信箱に「削除済」として残ります）')) return
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
              <Th className="w-16">画像</Th>
              <Th className="w-12"></Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-slate-500">{r.captured_at?.slice(0, 10) ?? '—'}</Td>
                <Td>{sourceBadge(r.source)}</Td>
                <Td className="font-medium text-slate-800">{r.vendor ?? '—'}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}
                </Td>
                {showCreator && <Td className="text-slate-500">{r.created_by_name ?? '—'}</Td>}
                <Td>
                  <DescCell
                    row={r}
                    onSaved={(v) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, description: v } : x)))}
                  />
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
                  {r.image_file_id ? (
                    <a
                      href={api.fileUrl(r.image_file_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      表示
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </Td>
                <Td className="text-right">
                  {r.approval_status === 'pending' && !r.journalized_at && (
                    <IconButton label="削除" className="h-7 w-7 hover:!text-red-600" onClick={() => void handleDelete(r)}>
                      <Icon.Trash />
                    </IconButton>
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
    </>
  )
}

// 摘要のインライン編集セル。AIが入れた値を表示し、フォーカスを外した時に変更があれば保存。
function DescCell({ row, onSaved }: { row: ReceiptRow; onSaved: (v: string) => void }) {
  const toast = useToast()
  const [v, setV] = useState(row.description ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setV(row.description ?? '')
  }, [row.id, row.description])

  async function commit() {
    const next = v.trim()
    if (next === (row.description ?? '')) return
    setSaving(true)
    try {
      await api.patchReceipt(row.id, { description: next || null })
      onSaved(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setV(row.description ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Input
      value={v}
      disabled={saving}
      placeholder="摘要"
      className="min-w-[12rem] text-sm"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void commit()}
    />
  )
}
