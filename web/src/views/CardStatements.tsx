import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { api, type CardStatementLine } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Input, Modal,
  PageHeader, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

type Batch = {
  batchId: string | null
  short: string
  importedAt: string | null
  lines: CardStatementLine[]
}

// クレジット明細: 専用取込＋各行に「領収書があるか」のチェック。取込は「バッチ(塊)」単位でまとめて表示・一括削除。
// 重複アップロードは行ごとに重複候補として色づけしつつ、バッチ丸ごと削除でまとめて掃除できる。
export function CardStatementsView({ clientId }: { clientId: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<CardStatementLine[]>([])
  const [missing, setMissing] = useState(0)
  const [dupTotal, setDupTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<CardStatementLine | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!clientId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const r = await api.cardStatements(clientId)
      setRows(r.items)
      setMissing(r.missing)
      setDupTotal(r.dup_total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // 取込バッチ(card_batch_id)ごとにまとめる。取込日時の新しい順。
  const batches = useMemo<Batch[]>(() => {
    const byBatch = new Map<string, CardStatementLine[]>()
    for (const r of rows) {
      const k = r.card_batch_id ?? '_none'
      const a = byBatch.get(k) ?? []
      a.push(r)
      byBatch.set(k, a)
    }
    const out: Batch[] = [...byBatch.entries()].map(([k, lines]) => ({
      batchId: k === '_none' ? null : k,
      short: k === '_none' ? '—' : k.slice(0, 6),
      importedAt: lines.map((l) => l.imported_at).filter(Boolean).sort()[0] ?? null,
      lines,
    }))
    out.sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
    return out
  }, [rows])

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    e.target.value = ''
    if (!files || !files.length || !clientId) return
    setUploading(true)
    let ok = 0
    for (const f of Array.from(files)) {
      try {
        await api.importCardStatement(clientId, f)
        ok++
      } catch (err) {
        toast.error(`${f.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setUploading(false)
    if (ok) {
      toast.success(`${ok}件を取り込みました。解析後に明細が表示されます。`)
      window.setTimeout(() => void load(), 2500)
    }
  }

  async function handleDelete(r: CardStatementLine) {
    if (!window.confirm('この明細行を削除しますか?')) return
    if (await toast.run(() => api.setApproval(r.id, 'deleted'), '削除しました')) void load()
  }
  // 取込バッチ(塊)を一括削除(重複アップロードを丸ごと消す)。
  async function handleDeleteBatch(batchId: string, count: number) {
    if (!window.confirm(`この取込（${count}件）をまとめて削除しますか？`)) return
    if (await toast.run(() => api.deleteCardBatch(batchId), '取込をまとめて削除しました')) void load()
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="クレジット明細" description="カード明細を取り込み、領収書が揃っているか確認します。" />
        <Card><EmptyState icon={<Icon.Receipt />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  function renderRow(r: CardStatementLine) {
    const isDup = r.is_dup
    return (
      <Tr key={r.id} className={isDup ? 'bg-amber-50/70' : undefined}>
        <Td className="whitespace-nowrap text-sm text-slate-600">{r.date ?? '—'}</Td>
        <Td className="text-sm text-slate-800">
          {isDup && <span className="mr-1 text-amber-600">↳</span>}
          {r.vendor || '(未解析)'}
        </Td>
        <Td className="text-right tabular-nums text-sm text-slate-800">{yen(r.amount_jpy)}</Td>
        <Td>
          {r.has_receipt ? (
            <Badge tone="success"><Icon.Check /> 領収書あり</Badge>
          ) : (
            <Badge tone="danger">領収書なし</Badge>
          )}
        </Td>
        <Td>{isDup ? <Badge tone="warning">重複の可能性</Badge> : null}</Td>
        <Td className="text-right">
          <div className="flex items-center justify-end gap-1">
            {r.image_file_id && (
              <a className="inline-flex text-slate-500 hover:text-brand-600" href={api.fileUrl(r.image_file_id)} target="_blank" rel="noreferrer" title="明細を開く">
                <Icon.Image className="text-lg" />
              </a>
            )}
            <IconButton label="修正" className="h-7 w-7 hover:!text-brand-600" onClick={() => setEditing(r)}>
              <Icon.Pencil />
            </IconButton>
            <IconButton label="削除" className="h-7 w-7 hover:!text-red-600" onClick={() => void handleDelete(r)}>
              <Icon.Trash />
            </IconButton>
          </div>
        </Td>
      </Tr>
    )
  }

  return (
    <>
      <PageHeader
        title="クレジット明細"
        description="明細を取り込み、各行に紐づく領収書があるかを確認します（明細は仕訳には入りません）。取込は「バッチ」単位でまとめて削除できます。"
        actions={
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => void onPick(e)} />
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>更新</Button>
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? '取込中…' : <><Icon.Upload /> 明細を取り込む</>}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">全 {rows.length} 件 / {batches.filter((b) => b.batchId).length} 取込</span>
        {missing > 0 && <Badge tone="danger">領収書なし {missing} 件</Badge>}
        {dupTotal > 0 && <Badge tone="warning">重複の可能性 {dupTotal} 件</Badge>}
        {missing === 0 && dupTotal === 0 && rows.length > 0 && <Badge tone="success">領収書あり・重複なし</Badge>}
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-28">取引日</Th>
              <Th>利用先</Th>
              <Th className="w-28 text-right">金額</Th>
              <Th className="w-32">領収書</Th>
              <Th className="w-28">重複</Th>
              <Th className="w-28"></Th>
            </tr>
          </Thead>
          <Tbody>
            {batches.map((b) => (
              <Fragment key={b.batchId ?? '_none'}>
                {b.batchId && (
                  <Tr className="bg-sky-50/60">
                    <Td colSpan={5} className="text-sm">
                      <span className="font-medium text-slate-700">取込 #{b.short}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {b.lines.length}件{b.importedAt ? ` ・ ${b.importedAt.slice(0, 10)} 取込` : ''}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <button
                        onClick={() => void handleDeleteBatch(b.batchId!, b.lines.length)}
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        title="この取込をまとめて削除"
                      >
                        取込を削除
                      </button>
                    </Td>
                  </Tr>
                )}
                {b.lines.map((r) => renderRow(r))}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '明細はありません。「明細を取り込む」から取り込んでください。'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>

      {editing && (
        <EditCardLineModal line={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </>
  )
}

// AI読取の修正: 取引日・利用先・金額を直す(明細行は receipt なので /receipts を再利用)。
function EditCardLineModal({
  line, onClose, onSaved,
}: { line: CardStatementLine; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [date, setDate] = useState(line.date ?? '')
  const [vendor, setVendor] = useState(line.vendor ?? '')
  const [amount, setAmount] = useState(line.amount_jpy != null ? String(line.amount_jpy) : '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const digits = amount.replace(/[^\d-]/g, '')
      await api.editReceiptContent(line.id, {
        date: date || null,
        vendor: vendor.trim() || null,
        amount_jpy: digits === '' ? null : Number(digits),
      })
      toast.success('修正しました')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open onClose={onClose} size="sm" title="明細の修正"
      description="AIの読み取り内容を修正します。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </>}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">取引日</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="mt-3 block space-y-1">
        <span className="text-xs font-medium text-slate-500">利用先</span>
        <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="利用先" />
      </label>
      <label className="mt-3 block space-y-1">
        <span className="text-xs font-medium text-slate-500">金額</span>
        <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
    </Modal>
  )
}
