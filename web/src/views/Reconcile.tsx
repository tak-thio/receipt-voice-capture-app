import { useEffect, useState } from 'react'
import { api, type ReconcileGroup, type ReconcileItem, type ReconcileState } from '../api'
import { Alert, Badge, Button, Card, EmptyState, Icon, PageHeader, Spinner } from '../ui'
import { useToast } from '../ui/toast'

function yen(n: number | null) {
  return n == null ? '—' : `¥${n.toLocaleString()}`
}

// 金額表示(外貨対応): 円が未確定の外貨領収書は現地額($220.00 USD)を主表示にする。
function money(item: ReconcileItem) {
  const fx = item.currency && item.currency !== 'JPY' && item.foreign_amount != null
    ? `${item.currency} ${item.foreign_amount.toFixed(2)}`
    : null
  if (item.amount_jpy == null) return fx ?? '—'
  return fx ? `${yen(item.amount_jpy)}（${fx}）` : yen(item.amount_jpy)
}

// このグループが「なぜ重複っぽいか」— 外貨は円が無くても現地額で束ねる。
function groupReason(g: ReconcileGroup): string {
  const all = [g.primary, ...g.duplicates]
  const fx = all[0].currency && all[0].currency !== 'JPY' && all[0].foreign_amount != null &&
    all.every((m) => m.currency === all[0].currency && m.foreign_amount === all[0].foreign_amount)
  if (fx) return `同日・同じ外貨額（${all[0].currency} ${all[0].foreign_amount!.toFixed(2)}）`
  return '同日・同額・同じ取引先'
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
          {item.date || '—'} ・ {money(item)}
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
        <PageHeader title="重複チェック" description="重複の可能性があるデータをあぶり出す補助画面です。" />
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
        title="重複チェック"
        description="同じ取引の可能性があるデータ（同日・同額。外貨は同じ現地額 — 円の金額が無くても束ねます）を自動でまとめて表示します。"
      />
      {/* ここに表示があってもエラーではない — 数字が合わない時の調査を助ける補助画面という位置づけ。 */}
      <Alert>
        ここにデータが表示されていても<strong>エラーではありません</strong>。
        集計が合わない時などに、二重登録・二重計上になりやすいデータや疑わしいデータを見つけるための補助画面です。
        重複（子）は仕訳・元帳から自動で除外されるので、通常はそのままで問題ありません。
        別々の取引だった場合のみ「重複ではない」で外してください。
      </Alert>
      <div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : <Icon.Search />}
          再計算
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon.Check />}
            title="重複らしきデータはありません"
            description="同日・同額（外貨は同じ現地額）で束ねられるデータが無い状態です。"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.match_id} className="p-4">
              {/* なぜ束ねたか(判定理由)を先頭に表示 */}
              <div className="mb-2">
                <Badge tone="info">{groupReason(g)}</Badge>
              </div>
              {/* 親（集計に使われる1件） */}
              <Line item={g.primary} />
              {/* 子（自動で重複扱い＝集計から除外中）。インデントして表示。 */}
              <div className="mt-2 space-y-2 border-l-2 border-amber-200 pl-3">
                {g.duplicates.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge tone="warning">重複の可能性</Badge>
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
