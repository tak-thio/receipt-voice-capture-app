import { useEffect, useState } from 'react'
import { api, type ReconcileItem, type ReconcileState } from '../api'
import { Badge, Button, Card, EmptyState, Icon, PageHeader, Spinner } from '../ui'
import { useToast } from '../ui/toast'

function yen(n: number | null) {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

function Thumb({ item }: { item: ReconcileItem }) {
  if (!item.image_file_id) return <span className="text-xs text-slate-300">画像なし</span>
  return (
    <a href={api.fileUrl(item.image_file_id)} target="_blank" rel="noreferrer" className="shrink-0">
      <img
        src={api.previewUrl(item.image_file_id)}
        alt=""
        className="h-12 w-12 rounded border border-slate-200 object-cover"
      />
    </a>
  )
}

function Line({ item, tag }: { item: ReconcileItem; tag?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Thumb item={item} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{item.vendor || '未解析'}</span>
          {tag && <Badge tone="neutral">{tag}</Badge>}
          {item.journalized_at && <Badge tone="success">仕訳済</Badge>}
        </div>
        <div className="text-xs text-slate-500">
          {item.date || '—'} ・ {yen(item.amount_jpy)}
          {item.t_number ? ` ・ ${item.t_number}` : ''}
        </div>
      </div>
    </div>
  )
}

/** 突き合わせ: カード利用明細の行と領収書を「同じ取引」としてひも付ける(人が確認)。 */
export function ReconcileView({ clientId }: { clientId?: string }) {
  const toast = useToast()
  const [state, setState] = useState<ReconcileState | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!clientId) return
    setLoading(true)
    try {
      setState(await api.reconcile(clientId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function link(cardId: string, receiptId: string) {
    const ok = await toast.run(() => api.linkMatch([cardId, receiptId]), 'ひも付けました')
    if (ok) await load()
  }
  async function unlink(matchId: string) {
    const ok = await toast.run(() => api.unlinkMatch({ match_id: matchId }), 'ひも付けを解除しました')
    if (ok) await load()
  }

  if (!clientId) {
    return (
      <div>
        <PageHeader title="突き合わせ" description="カード利用明細と領収書をひも付けます。" />
        <Card>
          <EmptyState icon={<Icon.Link />} title="顧問先を選択してください" />
        </Card>
      </div>
    )
  }

  const pending = state?.pending ?? []
  const withCand = pending.filter((p) => p.candidates.length > 0)
  const noReceipt = pending.filter((p) => p.candidates.length === 0)
  const groups = state?.groups ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        title="突き合わせ"
        description="カード利用明細の各行と、個人が上げた領収書を『同じ取引』としてまとめます。金額(税込)と利用日が一致する候補を提示するので、確認してひも付けてください。仕分け済みの領収書にも後から紐づけられます。"
      />
      <div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : <Icon.Search />}
          再スキャン
        </Button>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">要確認の候補 ({withCand.length})</h2>
        {withCand.length === 0 ? (
          <Card>
            <EmptyState icon={<Icon.Check />} title="確認待ちの候補はありません" />
          </Card>
        ) : (
          <div className="space-y-3">
            {withCand.map((p) => (
              <Card key={p.card.id} className="p-4">
                <Line item={p.card} tag="カード明細" />
                <div className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
                  {p.candidates.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3">
                      <Line item={r} tag="領収書" />
                      <Button onClick={() => void link(p.card.id, r.id)}>ひも付ける</Button>
                    </div>
                  ))}
                </div>
                {!p.unique && (
                  <p className="mt-2 text-xs text-amber-600">
                    候補が複数あります。正しい領収書を選んでひも付けてください。
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {noReceipt.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            領収書なしのカード利用 ({noReceipt.length})
          </h2>
          <Card className="space-y-2 p-4">
            <p className="text-xs text-amber-600">
              対応する領収書が見つかりません。本人に提出を依頼してください。
            </p>
            {noReceipt.map((p) => (
              <Line key={p.card.id} item={p.card} tag="カード明細" />
            ))}
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">ひも付け済み ({groups.length})</h2>
        {groups.length === 0 ? (
          <Card>
            <EmptyState icon={<Icon.Link />} title="まだありません" />
          </Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g.match_id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    {g.items.map((r) => (
                      <Line
                        key={r.id}
                        item={r}
                        tag={r.doc_type === 'card_statement' ? 'カード明細' : '領収書'}
                      />
                    ))}
                  </div>
                  <Button variant="ghost" onClick={() => void unlink(g.match_id)}>
                    解除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
