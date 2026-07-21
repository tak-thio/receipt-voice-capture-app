import { useEffect, useState } from 'react'
import { formatDate } from '../format'
import { api, type LedgerRow, type MasterRow, type NoteRow } from '../api'
import {
  Button, Card, EmptyState, Icon, IconButton, Input, PageHeader,
  Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'
import { ReceiptEditFields } from './ReceiptEditFields'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

// 元帳: 仕分け済み(journalized)の仕訳データ一覧。行を選ぶと「仕分けと同じ編集画面」で
// 直接編集できる（仕訳日時 journalized_at は維持）。
export function LedgerView({ clientId, showCreator }: { clientId: string; showCreator?: boolean }) {
  const toast = useToast()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<LedgerRow | null>(null)
  const [editNoteIds, setEditNoteIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!clientId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      setRows(await api.ledger(clientId))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    if (clientId) {
      api.accountTitles(clientId).then(setTitles).catch(() => setTitles([]))
      api.partners(clientId).then(setPartners).catch(() => setPartners([]))
      api.notes(clientId).then(setNotes).catch(() => setNotes([]))
    }
    setEditing(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  function openEdit(r: LedgerRow) {
    setError('')
    setEditNoteIds(r.note_ids ?? [])
    setEditing(r)
  }
  async function toggleNote(noteId: string) {
    if (!editing) return
    const has = editNoteIds.includes(noteId)
    const next = has ? editNoteIds.filter((x) => x !== noteId) : [...editNoteIds, noteId]
    setEditNoteIds(next)
    try {
      await api.setReceiptNotes(editing.id, next)
    } catch (e) {
      setError(String(e))
    }
  }
  async function save(values: Parameters<typeof api.updateLedger>[1]) {
    if (!editing) return
    setBusy(true)
    setError('')
    const ok = await toast.run(() => api.updateLedger(editing.id, values), '仕訳を更新しました')
    setBusy(false)
    if (ok) {
      setEditing(null)
      await load()
    }
  }

  // 仕訳の取消: 元帳から仕訳キューへ戻す(入力値は残る)。明細から起票した行なら紐付けロックも解除。
  async function unjournalize() {
    if (!editing) return
    if (!window.confirm('この仕訳を取り消して「仕訳」キューに戻しますか？\n（入力した科目・金額などは残ります。取消は履歴に記録されます）')) return
    setBusy(true)
    const ok = await toast.run(() => api.unjournalize(editing.id), '仕訳を取り消しました（仕訳キューに戻りました）')
    setBusy(false)
    if (ok) {
      setEditing(null)
      await load()
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="元帳" description="仕分け済みの仕訳データ一覧です。" />
        <Card><EmptyState icon={<Icon.Book />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  // ---- 編集画面（仕分けと同じ左右レイアウト） ----
  if (editing) {
    return (
      <>
        <button onClick={() => setEditing(null)}
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <Icon.ChevronDown className="rotate-90 text-base" /> 元帳一覧へ戻る
        </button>
        <PageHeader title="仕訳の編集" description="内容を修正して保存します。仕訳日時は変わりません。" />
        {error && <div className="mb-4"><Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</Card></div>}
        <Card className="ring-2 ring-brand-500/60">
          <ReceiptEditFields
            key={editing.id}
            item={editing}
            titles={titles}
            partners={partners}
            notes={notes}
            noteIds={editNoteIds}
            showCreator={showCreator}
            onToggleNote={(id) => void toggleNote(id)}
            renderActions={(getValues) => (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>キャンセル</Button>
                <Button variant="danger-ghost" disabled={busy} onClick={() => void unjournalize()}>
                  仕訳を取り消す
                </Button>
                <div className="flex-1" />
                <Button variant="primary" disabled={busy} onClick={() => void save(getValues())}>
                  {busy ? '保存中…' : '保存'}
                </Button>
              </>
            )}
          />
        </Card>
      </>
    )
  }

  // ---- 一覧 ----
  const term = q.trim()
  const shown = term
    ? rows.filter((r) =>
        [r.vendor, r.partner, r.debit, r.credit, r.t_number].some((v) => v?.includes(term)),
      )
    : rows

  return (
    <>
      <PageHeader title="元帳" description="仕分け済みの仕訳データ一覧です。行を選ぶと仕分けと同じ画面で編集できます。" />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="支払先 / 科目 / T番号で検索" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="ml-1 text-sm text-slate-500">{shown.length}件</span>
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-28">取引日</Th>
              <Th>支払先</Th>
              <Th>取引先</Th>
              <Th>借方</Th>
              <Th>貸方</Th>
              <Th className="text-right">税込金額</Th>
              <Th className="text-right">消費税</Th>
              <Th>インボイス番号</Th>
              <Th className="w-px text-right">操作</Th>
            </tr>
          </Thead>
          <Tbody>
            {shown.map((r) => (
              <Tr key={r.id} onClick={() => openEdit(r)}>
                <Td className="whitespace-nowrap text-slate-500">{formatDate(r.date)}</Td>
                <Td className="font-medium text-slate-800">{r.vendor ?? '—'}</Td>
                <Td className="text-slate-600">{r.partner ?? '—'}</Td>
                <Td className="text-slate-600">{r.debit ?? '—'}</Td>
                <Td className="text-slate-600">{r.credit ?? '—'}</Td>
                <Td className="whitespace-nowrap text-right font-medium tabular-nums">{yen(r.amount_jpy)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums text-slate-500">{yen(r.tax_jpy)}</Td>
                <Td className="text-xs text-slate-500">{r.t_number ?? '—'}</Td>
                <Td className="text-right">
                  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <IconButton label="編集" onClick={() => openEdit(r)}><Icon.Pencil /></IconButton>
                  </div>
                </Td>
              </Tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '仕分け済みのデータがありません'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>
    </>
  )
}
