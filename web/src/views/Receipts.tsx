import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, type NoteRow, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Input, PageHeader,
  Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { NoteChips, NotePickerModal } from '../notes'
import { useToast } from '../ui/toast'

export function ReceiptsView({ clientId }: { clientId: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState<ReceiptRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || !clientId) return
    setUploading(true)
    const ok = await toast.run(() => api.uploadReceipt(clientId, file), '領収書をアップロードしました')
    setUploading(false)
    if (ok) void load()
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
          className="hidden"
          onChange={(e) => void onUpload(e)}
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
              <Th>支払先</Th>
              <Th className="text-right">金額</Th>
              <Th>付箋</Th>
              <Th className="w-24">状態</Th>
              <Th className="w-16">画像</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-slate-500">{r.captured_at?.slice(0, 10) ?? '—'}</Td>
                <Td className="font-medium text-slate-800">{r.vendor ?? '—'}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <NoteChips ids={r.note_ids} notes={notes} />
                    <IconButton label="付箋を付ける" className="h-7 w-7" onClick={() => setTagging(r)}>
                      <Icon.Plus />
                    </IconButton>
                  </div>
                </Td>
                <Td>
                  {r.journalized_at
                    ? <Badge tone="success">仕分済</Badge>
                    : <Badge tone="warning">未仕分</Badge>}
                </Td>
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
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '領収書がありません'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>

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
