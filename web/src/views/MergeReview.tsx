import { api, type ReceiptRow } from '../api'
import { cn, Input } from '../ui'

// 統合伝票に採用する項目(ReceiptRow が持つもの)。取引先マスタ・税内訳はサーバ側で補完。
const MERGE_FIELDS: { key: keyof ReceiptRow; label: string; kind: 'date' | 'amount' | 'text' }[] = [
  { key: 'captured_at', label: '日付', kind: 'date' },
  { key: 'vendor', label: '店名・取引先', kind: 'text' },
  { key: 'amount_jpy', label: '金額（税込）', kind: 'amount' },
  { key: 't_number', label: '登録番号（T）', kind: 'text' },
  { key: 'description', label: '摘要', kind: 'text' },
  { key: 'payment_method', label: '支払方法', kind: 'text' },
  { key: 'tax_mode', label: '税区分', kind: 'text' },
  { key: 'memo', label: 'メモ', kind: 'text' },
]

const SRC_LABEL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function fmtVal(kind: string, v: unknown): string {
  if (v == null || v === '') return '（空欄）'
  if (kind === 'date') return String(v).slice(0, 10)
  if (kind === 'amount') return typeof v === 'number' ? `¥${v.toLocaleString()}` : String(v)
  return String(v)
}

// 統合伝票の初期値: 金額の大きい順で最初の非nullを採用(=基準優先)。全項目キーを持たせる。
export function initialMergeValues(sources: ReceiptRow[]): Record<string, unknown> {
  const ordered = [...sources].sort((a, b) => (b.amount_jpy ?? 0) - (a.amount_jpy ?? 0))
  const init: Record<string, unknown> = {}
  for (const f of MERGE_FIELDS) {
    let picked: unknown = null
    for (const r of ordered) {
      const v = r[f.key]
      if (v != null && v !== '') { picked = v; break }
    }
    init[f.key] = picked
  }
  return init
}

/** 統合レビュー: ソースの画像を並列表示し、項目ごとに採用する値を選択・編集する。 */
export function MergeReview({
  sources, values, onChange,
}: {
  sources: ReceiptRow[]
  values: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  // 全ソースの画像をフラット化(並列表示用)。どのソース由来かをラベルで示す。
  const images = sources.flatMap((s, si) => {
    const imgs = s.images?.length
      ? s.images
      : s.image_file_id
        ? [{ file_id: s.image_file_id, mime: s.image_mime ?? null }]
        : []
    return imgs.map((img) => ({ file_id: img.file_id, srcIdx: si, page: s.page ?? null }))
  })
  const setField = (key: string, v: unknown) => onChange({ ...values, [key]: v })

  return (
    <div className="space-y-4">
      {/* 画像: 並列表示(全ソースを横並び) */}
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">画像（{images.length}枚・クリックで拡大）</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <a
              key={i}
              href={api.fileUrl(img.file_id, img.page)}
              target="_blank"
              rel="noreferrer"
              className="relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
              title={`画像を開く（${SRC_LABEL[img.srcIdx]}）`}
            >
              <img src={api.previewUrl(img.file_id, img.page)} alt="" className="h-44 w-auto max-w-[220px] object-contain" />
              <span className="absolute left-1 top-1 rounded bg-slate-900/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {SRC_LABEL[img.srcIdx]}
              </span>
            </a>
          ))}
        </div>
      </div>

      {/* ソース凡例 */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>ソース:</span>
        {sources.map((s, si) => (
          <span key={s.id} className="rounded bg-slate-100 px-1.5 py-0.5">
            <span className="font-medium text-slate-600">{SRC_LABEL[si]}</span>{' '}
            {s.vendor ?? '—'} / {s.amount_jpy != null ? `¥${s.amount_jpy.toLocaleString()}` : '—'}
          </span>
        ))}
      </div>

      {/* 項目ごとに採用値を選択・編集 */}
      <div className="space-y-2.5">
        {MERGE_FIELDS.map((f) => {
          const distinct = [
            ...new Set(sources.map((s) => s[f.key]).filter((v) => v != null && v !== '').map((v) => String(v))),
          ]
          const conflict = distinct.length > 1
          const cur = values[f.key]
          return (
            <div key={f.key} className="grid grid-cols-[8rem_1fr] items-start gap-2">
              <label className="pt-2 text-sm text-slate-600">
                {f.label}
                {conflict && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700">要選択</span>}
              </label>
              <div className="space-y-1">
                {conflict && (
                  <div className="flex flex-wrap gap-1">
                    {sources.map((s, si) => {
                      const v = s[f.key]
                      if (v == null || v === '') return null
                      const active = String(cur) === String(v)
                      return (
                        <button
                          key={si}
                          type="button"
                          onClick={() => setField(f.key, v)}
                          className={cn(
                            'rounded-md border px-2 py-0.5 text-xs transition',
                            active
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                          )}
                        >
                          <span className="mr-1 opacity-50">{SRC_LABEL[si]}</span>
                          {fmtVal(f.kind, v)}
                        </button>
                      )
                    })}
                  </div>
                )}
                {f.kind === 'amount' ? (
                  <Input
                    type="number"
                    className="w-40 text-right tabular-nums"
                    value={cur == null ? '' : Number(cur)}
                    onChange={(e) => setField(f.key, e.target.value === '' ? null : Number(e.target.value))}
                  />
                ) : f.kind === 'date' ? (
                  <Input
                    type="date"
                    className="w-44"
                    value={cur ? String(cur).slice(0, 10) : ''}
                    onChange={(e) => setField(f.key, e.target.value || null)}
                  />
                ) : (
                  <Input
                    className="w-full"
                    value={cur == null ? '' : String(cur)}
                    onChange={(e) => setField(f.key, e.target.value || null)}
                  />
                )}
              </div>
            </div>
          )
        })}
        <p className="pt-1 text-xs text-slate-400">
          ※ 金額は合算しません（同一支払いのため）。取引先マスタ・税内訳は既存の値から自動で引き継ぎます。
        </p>
      </div>
    </div>
  )
}
