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

function Line({ item }: { item: ReconcileItem }) {
  const tag = item.doc_type === 'card_statement' ? 'カード明細' : '領収書'
  return (
    <div className="flex items-center gap-3">
      <Thumb item={item} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{item.partner || item.vendor || '未解析'}</span>
          <Badge tone="neutral">{tag}</Badge>
          {item.journalized_at && <Badge tone="success">仕訳済</Badge>}
        </div>
        <div className="text-xs text-slate-500">
          {item.date || '—'} ・ {yen(item.amount_jpy)}
          {item.source ? ` ・ ${item.source}` : ''}
        </div>
      </div>
    </div>
  )
}

/** 突き合わせ: 同じ取引(同日+同金額、領収書は+取引先)を自動でまとめて表示。
 * 子(重複)は自動で仕訳/元帳から除外。違うものは「重複ではない」で外す。 */
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

  async function notDuplicate(receiptId: string) {
    const ok = await toast.run(() => api.notDuplicate(receiptId), '重複から外しました')
    if (ok) await load()
  }

  if (!clientId) {
    return (
      <div>
        <PageHeader title="突き合わせ" description="同じ取引を自動でまとめます。" />
        <Card>
          <EmptyState icon={<Icon.Link />} title="顧問先を選択してください" />
        </Card>
      </div>
    )
  }

  const groups = state?.groups ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="突き合わせ"
        description="同日・同金額（領収書は取引先も一致）の取引を『同じもの』として自動でまとめます。クレジット明細の行も同じ扱いです。子（重複）は自動で仕訳・元帳から除外されます。違うものは「重複ではない」で外してください。"
      />
      <div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : <Icon.Search />}
          再計算
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={<Icon.Check />} title="まとめられた重複はありません" />
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.match_id} className="p-4">
              {/* 親（残す1件） */}
              <Line item={g.primary} />
              {/* 子（自動で重複扱い）。インデントして表示。 */}
              <div className="mt-2 space-y-2 border-l-2 border-amber-200 pl-3">
                {g.duplicates.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">重複</Badge>
                      <Line item={d} />
                    </div>
                    <Button variant="secondary" onClick={() => void notDuplicate(d.id)}>
                      重複ではない
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
