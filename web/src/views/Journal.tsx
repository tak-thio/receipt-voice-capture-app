import { useEffect, useState } from 'react'
import { formatDate } from '../format'
import { api, type MasterRow, type NoteRow, type QueueItem } from '../api'
import {
  Alert, Button, Card, cn, EmptyState, Icon, PageHeader,
  Section, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { ReceiptEditFields } from './ReceiptEditFields'

type Mode = 'queue' | 'held'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

// 領収書は縦長が多いので、左に画像プレビュー・右に入力（取引先/借方/貸方/消費税）の
// 左右レイアウト。1件ずつ確認して仕訳する。エディタ本体は ReceiptEditFields（元帳編集と共通）。
export function JournalView({ clientId, showCreator, lockDate }: { clientId: string; showCreator?: boolean; lockDate?: string | null }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [heldCount, setHeldCount] = useState(0)
  const [mode, setMode] = useState<Mode>('queue')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadMasters() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
    setNotes(await api.notes(clientId).catch(() => []))
  }
  async function loadQueue(m: Mode = mode) {
    if (!clientId) return
    const res = await api.journalQueue(clientId, m)
    setItems(res.items)
    setTotal(res.total)
    setHeldCount(res.held_count)
  }
  useEffect(() => {
    setActiveIndex(0)
    Promise.all([loadMasters(), loadQueue('queue')]).catch((e) => setError(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const activeIdx = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0
  const top = items[activeIdx] ?? null

  function switchMode(m: Mode) {
    if (m === mode) return
    setMode(m)
    setActiveIndex(0)
    loadQueue(m).catch((e) => setError(String(e)))
  }
  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await loadQueue()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  function handleSkip() {
    if (items.length > 1) setActiveIndex((activeIdx + 1) % items.length)
  }
  async function toggleNote(noteId: string) {
    if (!top) return
    const has = top.note_ids.includes(noteId)
    const next = has ? top.note_ids.filter((x) => x !== noteId) : [...top.note_ids, noteId]
    setItems((its) => its.map((it) => (it.id === top.id ? { ...it, note_ids: next } : it)))
    try {
      await api.setReceiptNotes(top.id, next)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="仕分け" description="領収書を1件ずつ確認して仕訳します。" />
        <Card><EmptyState icon={<Icon.Sort />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      {/* タイトル・残り件数・モード切替を1行に集約（縦の無駄を削減） */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">仕分け</h2>
          <span className="text-sm text-slate-500">
            {mode === 'queue' ? '未仕分け' : '保留'} 残り <span className="font-semibold text-slate-700">{total}</span> 件
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          <button onClick={() => switchMode('queue')}
            className={cn('rounded-md px-3 py-1 font-medium', mode === 'queue' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
            未仕分け
          </button>
          <button onClick={() => switchMode('held')}
            className={cn('rounded-md px-3 py-1 font-medium', mode === 'held' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
            保留 {heldCount > 0 && <span className="ml-0.5">{heldCount}</span>}
          </button>
        </div>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {titles.length === 0 && (
        <div className="mb-4"><Alert tone="warning">勘定科目が未登録です。「マスタ」タブで登録してください。</Alert></div>
      )}

      {!top ? (
        <Card>
          <EmptyState
            icon={<Icon.Check />}
            title={mode === 'queue' ? '未仕分けの領収書はありません 🎉' : '保留中の領収書はありません'}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <Card className="ring-2 ring-brand-500/60">
            <ReceiptEditFields
              key={top.id}
              item={top}
              titles={titles}
              partners={partners}
              notes={notes}
              noteIds={top.note_ids}
              showCreator={showCreator}
              lockDate={lockDate}
              fitViewport

              onToggleNote={(id) => void toggleNote(id)}
              renderActions={(getValues, debitSelected) => (
                <>
                  <Button variant="danger-ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'rejected'))}>否認</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'mistake'))}>間違い</Button>
                  <Button variant="danger-ghost" disabled={busy}
                    onClick={() => { if (window.confirm('この領収書を削除しますか?')) void act(() => api.setApproval(top.id, 'deleted')) }}>
                    削除
                  </Button>
                  <div className="flex-1" />
                  <Button variant="ghost" disabled={busy || items.length <= 1} onClick={handleSkip}>スキップ</Button>
                  {mode === 'queue' ? (
                    <Button disabled={busy} onClick={() => void act(() => api.hold(top.id))}>保留</Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void act(() => api.unhold(top.id))}>保留を解除</Button>
                  )}
                  <Button variant="primary" disabled={busy || !debitSelected}
                    onClick={() => { if (debitSelected) void act(() => api.journalize(top.id, getValues())) }}>
                    {busy ? '処理中…' : '処理して次へ'}
                  </Button>
                </>
              )}
            />
          </Card>

          {items.length > 1 && (
            <Section title={`${mode === 'queue' ? '未仕分け' : '保留'}キュー`} bodyClassName="p-0">
              <div className="max-h-44 overflow-auto">
              <Table>
                <Thead>
                  <tr>
                    <Th className="w-28">日付</Th>
                    <Th>店舗</Th>
                    <Th className="text-right">金額</Th>
                    <Th>提案</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {items.map((r, i) => {
                    const sug = titles.find((t) => t.id === r.suggestion.account_title_id)
                    return (
                      <Tr key={r.id} active={i === activeIdx} onClick={() => setActiveIndex(i)}>
                        <Td className="whitespace-nowrap text-slate-500">{formatDate(r.date)}</Td>
                        <Td className="font-medium text-slate-800">
                          {r.parse_failed ? <span className="text-rose-600">認識できませんでした</span> : (r.vendor || '—')}
                          {/* 「領収書なし(確定)」のクレジット明細から起票する行(証憑=明細画像・税内訳なし) */}
                          {r.doc_type === 'card_statement' && (
                            <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">明細から</span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">{yen(r.amount_jpy)}</Td>
                        <Td className="text-xs text-emerald-700">{sug ? `${sug.code} ${sug.name}` : '—'}</Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
              </div>
            </Section>
          )}
        </div>
      )}
    </>
  )
}
