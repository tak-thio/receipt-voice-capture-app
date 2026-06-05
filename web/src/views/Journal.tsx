import { useEffect, useState } from 'react'
import { api, type MasterRow, type QueueItem } from '../api'
import {
  Alert, Badge, Button, Card, cn, EmptyState, Icon, PageHeader,
  Section, Select, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'

type Mode = 'queue' | 'held'

function yen(n: number | null): string {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

// Single-item "拡大表示" journaling, ported from receipt-app's UX: focus the top
// item, pick the account title with a button, see the receipt image, 処理して次へ.
export function JournalView({ clientId }: { clientId: string }) {
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [heldCount, setHeldCount] = useState(0)
  const [mode, setMode] = useState<Mode>('queue')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [titleId, setTitleId] = useState('')
  const [partnerId, setPartnerId] = useState('')

  async function loadMasters() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
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

  useEffect(() => {
    if (!top) return
    setTitleId(top.account_title_id ?? top.suggestion.account_title_id ?? '')
    setPartnerId(top.partner_id ?? top.suggestion.partner_id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id])

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
  function handleProcess() {
    if (!top || !titleId) return
    void act(() => api.journalize(top.id, { account_title_id: titleId, partner_id: partnerId || null }))
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
      <PageHeader
        title="仕分け"
        description="領収書を1件ずつ確認して仕訳します。"
        actions={
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
        }
      />

      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{mode === 'queue' ? '未仕分け' : '保留'} 残り <span className="font-semibold text-slate-700">{total}</span> 件</span>
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
        <div className="space-y-4">
          <Card className="ring-2 ring-brand-500/60">
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold text-slate-900">{top.vendor || '(店舗名なし)'}</span>
                <span className="text-lg font-semibold tabular-nums text-slate-900">{yen(top.amount_jpy)}</span>
                <span className="text-xs text-slate-400">{top.date ?? '—'} · {top.source}</span>
                {top.t_number && <Badge>T{top.t_number}</Badge>}
              </div>

              <div className="flex h-80 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {top.image_file_id ? (
                  <img src={api.fileUrl(top.image_file_id)} alt="領収書" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-sm text-slate-400">画像なし</span>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <span className="text-xs font-medium text-slate-500">勘定科目</span>
                <div className="flex flex-wrap gap-2">
                  {titles.map((t) => (
                    <button key={t.id} onClick={() => setTitleId(t.id)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        titleId === t.id
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                      )}>
                      <span className="mr-1 text-xs opacity-70">{t.code}</span>{t.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block max-w-sm space-y-1">
                <span className="text-xs font-medium text-slate-500">
                  取引先{partnerId && <span className="ml-1 text-emerald-600">(自動引当)</span>}
                </span>
                <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">(なし)</option>
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </label>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <Button variant="danger-ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'rejected'))}>否認</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void act(() => api.setApproval(top.id, 'mistake'))}>間違い</Button>
                <div className="flex-1" />
                <Button variant="ghost" disabled={busy || items.length <= 1} onClick={handleSkip}>スキップ</Button>
                {mode === 'queue' ? (
                  <Button disabled={busy} onClick={() => void act(() => api.hold(top.id))}>保留</Button>
                ) : (
                  <Button disabled={busy} onClick={() => void act(() => api.unhold(top.id))}>保留を解除</Button>
                )}
                <Button variant="primary" disabled={busy || !titleId} onClick={handleProcess}>
                  {busy ? '処理中…' : '処理して次へ'}
                </Button>
              </div>
            </div>
          </Card>

          {items.length > 1 && (
            <Section title={`${mode === 'queue' ? '未仕分け' : '保留'}キュー`} bodyClassName="p-0">
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
                        <Td className="whitespace-nowrap text-slate-500">{r.date ?? '—'}</Td>
                        <Td className="font-medium text-slate-800">{r.vendor || '—'}</Td>
                        <Td className="whitespace-nowrap text-right tabular-nums">{yen(r.amount_jpy)}</Td>
                        <Td className="text-xs text-emerald-700">{sug ? `${sug.code} ${sug.name}` : '—'}</Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </Section>
          )}
        </div>
      )}
    </>
  )
}
