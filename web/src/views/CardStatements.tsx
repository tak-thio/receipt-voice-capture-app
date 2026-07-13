import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { api, type CardStatementLine, type ReceiptRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, IconButton, Input, Modal,
  PageHeader, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

// 受信箱と同じ既定ラベル: 「YYYY年MM月DD日アップロード」(JST)。
function defaultBatchLabel(importedAt?: string | null): string {
  if (!importedAt) return 'クレジット明細'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(importedAt))
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}年${g('month')}月${g('day')}日アップロード`
}

type Batch = {
  batchId: string | null
  label: string
  importedAt: string | null
  lines: CardStatementLine[]
  missing: number
  unresolved: number
  dup: number
}

// クレジット明細: 「取込(アップロード)単位の一覧 → その明細」の2段構成。
// 一覧で取込ごとに状況(領収書なし/重複)を把握し、行クリックでその取込の明細に入る。
export function CardStatementsView({ clientId, initialBatch, onBatchOpened }: { clientId: string; initialBatch?: string | null; onBatchOpened?: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<CardStatementLine[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<CardStatementLine | null>(null)
  const [linking, setLinking] = useState<CardStatementLine | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<string | null>(initialBatch ?? null) // null=一覧 / id=明細
  const [renaming, setRenaming] = useState<Batch | null>(null)
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    setSelectedBatch(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // 受信箱などから特定バッチを指定して来たら、そのバッチの明細を開く。
  useEffect(() => {
    if (initialBatch) {
      setSelectedBatch(initialBatch)
      onBatchOpened?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBatch])

  // 取込バッチ(card_batch_id)ごとにまとめる。取込日時の新しい順。
  const batches = useMemo<Batch[]>(() => {
    const byBatch = new Map<string, CardStatementLine[]>()
    for (const r of rows) {
      const k = r.card_batch_id ?? '_none'
      const a = byBatch.get(k) ?? []
      a.push(r)
      byBatch.set(k, a)
    }
    const out: Batch[] = [...byBatch.entries()].map(([k, lines]) => {
      const importedAt = lines.map((l) => l.imported_at).filter(Boolean).sort()[0] ?? null
      return {
        batchId: k === '_none' ? null : k,
        label: lines[0]?.card_batch_label || defaultBatchLabel(importedAt),
        importedAt,
        lines,
        missing: lines.filter((l) => !l.has_receipt).length,
        unresolved: lines.filter((l) => !l.has_receipt && !l.link_manual).length,
        dup: lines.filter((l) => l.is_dup).length,
      }
    })
    out.sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
    return out
  }, [rows])

  const detail = selectedBatch ? batches.find((b) => b.batchId === selectedBatch) ?? null : null

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
      toast.success(`${ok}件を取り込みました。解析後に一覧へ表示されます。`)
      window.setTimeout(() => void load(), 2500)
    }
  }

  async function handleDelete(r: CardStatementLine) {
    if (!window.confirm('この明細行を削除しますか?')) return
    if (await toast.run(() => api.setApproval(r.id, 'deleted'), '削除しました')) void load()
  }
  async function handleDeleteBatch(batchId: string, count: number) {
    if (!window.confirm(`この取込（${count}件）をまとめて削除しますか？`)) return
    if (await toast.run(() => api.deleteCardBatch(batchId), '取込をまとめて削除しました')) {
      setSelectedBatch(null)
      void load()
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="クレジット明細" description="カード明細を取り込み、領収書が揃っているか確認します。" />
        <Card><EmptyState icon={<Icon.Receipt />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  // ---- 明細ビュー(1取込の中身) ----
  function renderLineRow(r: CardStatementLine) {
    const isDup = r.is_dup
    return (
      <Tr key={r.id} className={isDup ? 'bg-amber-50/70' : undefined}>
        <Td className="whitespace-nowrap text-sm text-slate-600">{r.date ?? '—'}</Td>
        <Td className="text-sm text-slate-800">
          {isDup && <span className="mr-1 text-amber-600">↳</span>}
          {r.vendor || '(未解析)'}
        </Td>
        <Td className="text-right tabular-nums text-sm text-slate-800">
          {yen(r.amount_jpy)}
          {/* 外貨行のみ: 明細の印字値(通貨・現地ご利用額・換算レート)。照合はこの現地額で行う。 */}
          {r.currency && r.currency !== 'JPY' && r.foreign_amount != null && (
            <div className="whitespace-nowrap text-[11px] text-slate-400">
              {r.currency} {r.foreign_amount.toFixed(2)}{r.exchange_rate != null ? ` @${r.exchange_rate}` : ''}
            </div>
          )}
        </Td>
        <Td>
          {r.has_receipt ? (
            <Badge tone="success"><Icon.Check /> 領収書あり{r.link_manual ? '（手動）' : ''}</Badge>
          ) : r.link_manual ? (
            <Badge tone="neutral">領収書なし（確定）</Badge>
          ) : (
            <Badge tone="danger">領収書なし</Badge>
          )}
        </Td>
        <Td>{isDup ? <Badge tone="warning">重複の可能性</Badge> : null}</Td>
        <Td className="text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => setLinking(r)} className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50" title="領収書の紐付け">
              紐付け
            </button>
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

  if (selectedBatch && !detail && loading) {
    return (
      <>
        <PageHeader title="読み込み中…" />
        <Card><EmptyState icon={<Icon.Receipt />} title="読み込み中…" /></Card>
      </>
    )
  }
  if (detail) {
    return (
      <>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <button onClick={() => setSelectedBatch(null)} className="text-slate-400 hover:text-brand-600 hover:underline">クレジット明細</button>
              <span className="text-slate-300">›</span>
              <span>{detail.label}</span>
            </span>
          }
          description={`${detail.lines.length}件${detail.importedAt ? ` ・ ${detail.importedAt.slice(0, 10)} 取込` : ''}（明細は仕訳には入りません）`}
          actions={
            detail.batchId && (
              <Button variant="secondary" onClick={() => void handleDeleteBatch(detail.batchId!, detail.lines.length)}>
                <Icon.Trash /> この取込を削除
              </Button>
            )
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          {detail.unresolved > 0 ? <Badge tone="danger">要対応 {detail.unresolved} 件</Badge> : <Badge tone="success">照合OK</Badge>}
          {detail.dup > 0 && <Badge tone="warning">重複の可能性 {detail.dup} 件</Badge>}
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
            <Tbody>{detail.lines.map((r) => renderLineRow(r))}</Tbody>
          </Table>
        </Card>
        {editing && (
          <EditCardLineModal line={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
        )}
        {linking && (
          <LinkModal line={linking} clientId={clientId} onClose={() => setLinking(null)} onSaved={() => { setLinking(null); void load() }} />
        )}
      </>
    )
  }

  // ---- 取込一覧ビュー(アップロード単位) ----
  return (
    <>
      <PageHeader
        title="クレジット明細"
        description="取込(アップロード)ごとに一覧表示します。行を開くとその明細と領収書の照合が確認できます。明細は仕訳には入りません。"
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
      <div className="mb-3 text-sm text-slate-500">{batches.length} 取込 / 全 {rows.length} 件</div>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-28">取込日</Th>
              <Th>名前</Th>
              <Th className="w-20 text-right">件数</Th>
              <Th className="w-32">領収書</Th>
              <Th className="w-24">重複</Th>
              <Th className="w-40"></Th>
            </tr>
          </Thead>
          <Tbody>
            {batches.map((b) => (
              <Tr
                key={b.batchId ?? '_none'}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => b.batchId && setSelectedBatch(b.batchId)}
              >
                <Td className="whitespace-nowrap text-sm text-slate-600">{b.importedAt?.slice(0, 10) ?? '—'}</Td>
                <Td className="font-medium text-slate-800">
                  {b.label}
                  {b.batchId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming(b) }}
                      title="名前を変更"
                      className="ml-1 align-middle text-slate-400 hover:text-brand-600"
                    >
                      <Icon.Pencil className="inline text-sm" />
                    </button>
                  )}
                </Td>
                <Td className="text-right tabular-nums text-sm text-slate-700">{b.lines.length}件</Td>
                <Td>
                  {b.unresolved > 0 ? <Badge tone="danger">要対応 {b.unresolved}</Badge> : <Badge tone="success">揃</Badge>}
                </Td>
                <Td>{b.dup > 0 ? <Badge tone="warning">重複 {b.dup}</Badge> : null}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); if (b.batchId) setSelectedBatch(b.batchId) }}
                      className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                    >
                      明細を見る
                    </button>
                    {b.batchId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDeleteBatch(b.batchId!, b.lines.length) }}
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '取込はありません。「明細を取り込む」から取り込んでください。'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>

      {renaming && (
        <BatchRenameModal
          batch={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => { setRenaming(null); void load() }}
        />
      )}
    </>
  )
}

// 取込バッチの名前を変更(空=既定の取込日に戻る)。
function BatchRenameModal({
  batch, onClose, onSaved,
}: { batch: Batch; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(batch.lines[0]?.card_batch_label ?? '')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!batch.batchId) return
    setBusy(true)
    try {
      await api.renameCardBatch(batch.batchId, label.trim())
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
      open size="sm" onClose={onClose} title="取込の名前を変更"
      description="一覧・受信箱に表示する名前です。空にすると既定（アップロード日）に戻ります。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </>}
    >
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 2026年6月分 楽天カード" />
    </Modal>
  )
}

// 明細行に紐付ける領収書を選ぶ。手動で「領収書なし」確定・自動に戻すも可。
function LinkModal({
  line, clientId, onClose, onSaved,
}: { line: CardStatementLine; clientId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // 紐付け後の「カード請求額を計上額に採用」提案(自動では書かない=人が1クリックで確定)。
  const [adopt, setAdopt] = useState<ReceiptRow | null>(null)
  useEffect(() => {
    api.receipts(clientId).then(setReceipts).catch(() => setReceipts([]))
  }, [clientId])
  // 外貨行: 照合キーは (通貨, 現地額)。円は毎回レートが違い一致しない。
  const lineFx = Boolean(line.currency && line.currency !== 'JPY' && line.foreign_amount != null)
  const fxMatch = (r: ReceiptRow) =>
    lineFx && r.currency === line.currency && r.foreign_amount === line.foreign_amount
  async function set(mode: 'receipt' | 'none' | 'auto', receipt?: ReceiptRow) {
    setBusy(true)
    try {
      await api.setCardLineLink(line.id, mode, receipt?.id)
      if (mode === 'receipt' && receipt && line.amount_jpy != null && receipt.amount_jpy !== line.amount_jpy) {
        // 計上額が未確定 or カード請求額と不一致 → 採用を提案(書くのは人の1クリック)。
        toast.success('紐付けました')
        setAdopt(receipt)
      } else {
        toast.success('更新しました')
        onSaved()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function adoptAmount() {
    if (!adopt || line.amount_jpy == null) return
    setBusy(true)
    try {
      await api.editReceiptContent(adopt.id, { amount_jpy: line.amount_jpy })
      toast.success(`計上額を ${yen(line.amount_jpy)} にしました`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const ql = q.trim().toLowerCase()
  const list = receipts
    .filter((r) => !r.card_batch) // クレジット明細の「塊」行は除外(本物の領収書だけ)
    .filter((r) =>
      !ql ||
      (r.vendor ?? '').toLowerCase().includes(ql) ||
      String(r.amount_jpy ?? '').includes(ql) ||
      (r.captured_at ?? '').includes(ql),
    )
    // 外貨一致($220↔$220) > 円の同額 > その他 の順に表示。
    .sort((a, b) =>
      (Number(fxMatch(b)) - Number(fxMatch(a))) ||
      (Number(b.amount_jpy != null && b.amount_jpy === line.amount_jpy) -
        Number(a.amount_jpy != null && a.amount_jpy === line.amount_jpy)))
    .slice(0, 60)
  // 紐付け済みで開いた場合: 計上額がカード請求額と違えば採用を提案するバナー。
  const linked = line.receipt_id ? receipts.find((r) => r.id === line.receipt_id) : undefined
  const showAdoptBanner =
    !adopt && linked && line.amount_jpy != null && linked.amount_jpy !== line.amount_jpy
  return (
    <Modal
      open size="lg" onClose={adopt ? onSaved : onClose} title="領収書の紐付け"
      description={`${line.date ?? '—'} ・ ${line.vendor ?? '—'} ・ ${yen(line.amount_jpy)}${lineFx ? `（${line.currency} ${line.foreign_amount!.toFixed(2)}）` : ''} に紐付ける領収書を選びます（${lineFx ? '外貨一致' : '同額'}を上に表示）。`}
      footer={adopt ? (
        <Button variant="ghost" onClick={onSaved} disabled={busy}>閉じる</Button>
      ) : (<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>閉じる</Button>
        <Button variant="ghost" onClick={() => void set('auto')} disabled={busy}>自動に戻す</Button>
        <Button variant="secondary" onClick={() => void set('none')} disabled={busy}>領収書なしにする</Button>
      </>)}
    >
      {adopt ? (
        // 採用ステップ: 実際に引き落とされた円(カード請求額)を計上額にする(人が確定)。
        <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4">
          <p className="text-sm text-slate-700">
            紐付けました。この領収書の計上額（現在 {adopt.amount_jpy != null ? yen(adopt.amount_jpy) : '未確定'}）に、
            実際に引き落とされるカード請求額を採用しますか？
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void adoptAmount()} disabled={busy}>カード請求額 {yen(line.amount_jpy)} を採用</Button>
            <Button variant="ghost" onClick={onSaved} disabled={busy}>採用しない（このまま）</Button>
          </div>
          {adopt.currency && adopt.foreign_amount != null && (
            <p className="text-xs text-slate-500">
              外貨建て領収書（{adopt.currency} {adopt.foreign_amount.toFixed(2)}）: 円は毎回レートが違うため、実際の引落額＝カード請求額が確定値になります。
            </p>
          )}
        </div>
      ) : (<>
        {showAdoptBanner && linked && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-slate-700">
            <span>紐付け済み領収書の計上額（{linked.amount_jpy != null ? yen(linked.amount_jpy) : '未確定'}）がカード請求額と異なります。</span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAdopt(linked)}>
              {yen(line.amount_jpy)} を採用…
            </Button>
          </div>
        )}
        <Input placeholder="領収書を検索（店名・金額・日付）" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => void set('receipt', r)}
              disabled={busy}
              className={`flex w-full items-center justify-between gap-3 p-2.5 text-left hover:bg-brand-50 ${line.receipt_id === r.id ? 'bg-brand-50' : ''}`}
            >
              <span className="min-w-0">
                <span className="text-xs text-slate-500">{r.captured_at?.slice(0, 10) ?? '—'}</span>
                <span className="ml-2 font-medium text-slate-800">{r.vendor ?? '—'}</span>
                {fxMatch(r) && (
                  <span className="ml-2 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700">
                    {line.currency} {line.foreign_amount!.toFixed(2)} 一致
                  </span>
                )}
                {r.amount_jpy != null && r.amount_jpy === line.amount_jpy && (
                  <span className="ml-2 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700">同額</span>
                )}
                {line.receipt_id === r.id && (
                  <span className="ml-2 rounded bg-brand-100 px-1 text-[10px] font-medium text-brand-700">現在</span>
                )}
              </span>
              <span className="shrink-0 text-right tabular-nums text-slate-800">
                {yen(r.amount_jpy)}
                {r.currency && r.currency !== 'JPY' && r.foreign_amount != null && (
                  <div className="text-[11px] text-slate-400">{r.currency} {r.foreign_amount.toFixed(2)}</div>
                )}
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="p-4 text-center text-sm text-slate-400">該当する領収書がありません</p>}
        </div>
      </>)}
    </Modal>
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
