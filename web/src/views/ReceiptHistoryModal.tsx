import { useEffect, useState } from 'react'
import { api, type AuditEntry } from '../api'
import { formatDate, formatDateTime } from '../format'
import { Alert, Badge, Modal, Spinner } from '../ui'

const ACTION_LABEL: Record<string, { label: string; tone: 'neutral' | 'danger' | 'success' }> = {
  updated: { label: '修正', tone: 'neutral' },
  deleted: { label: '削除', tone: 'danger' },
  journalized: { label: '仕訳確定', tone: 'success' },
  unjournalized: { label: '仕訳取消', tone: 'danger' },
  merged: { label: '統合', tone: 'neutral' },
  unmerged: { label: 'ばらし', tone: 'danger' },
  approved: { label: '承認', tone: 'success' },
  rejected: { label: '否認', tone: 'danger' },
  created: { label: '作成', tone: 'neutral' },
}

const FIELD_LABEL: Record<string, string> = {
  vendor: '店舗名', date: '日付', amount_jpy: '金額', tax_mode: '税区分',
  tax_lines: '税内訳', currency: '通貨', foreign_amount: '現地金額',
  payment_method: '支払方法', t_number: '登録番号', description: '摘要', memo: 'メモ',
  account_title_id: '借方科目', sub_account_id: '補助科目', credit_account_title_id: '貸方科目',
  partner_id: '取引先', approval_status: '状態', note_ids: '付箋',
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? `${v.length}件` : '—'
  const s = String(v)
  // 日付/日時のISO文字列は「日付のみ・スラッシュ表記」で。履歴に載る日付フィールド
  // (captured_at等)は日付として保存されており、時刻部分(00:00固定)に意味は無い。
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return formatDate(s)
  return s
}

// 領収書の監査ログ(訂正削除・承認・仕訳の履歴)を表示。電子帳簿保存法の訂正削除履歴。
export function ReceiptHistoryModal({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.receiptHistory(receiptId)
      .then(setItems)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [receiptId])

  return (
    <Modal
      open
      onClose={onClose}
      title="変更履歴"
      size="md"
      description="この領収書の訂正・削除・承認・仕訳の記録(電子帳簿保存法の訂正削除履歴)。"
    >
      {err ? (
        <Alert>{err}</Alert>
      ) : items === null ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">変更履歴はまだありません。</div>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const act = ACTION_LABEL[a.action] ?? { label: a.action, tone: 'neutral' as const }
            return (
              <li key={a.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <Badge tone={act.tone}>{act.label}</Badge>
                  <span className="text-sm text-slate-700">{a.actor ?? 'システム'}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {formatDateTime(a.at)}
                  </span>
                </div>
                {a.summary && <div className="mt-1 text-xs text-slate-500">{a.summary}</div>}
                {a.changes && Object.keys(a.changes).length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {Object.entries(a.changes).map(([f, c]) => (
                      <li key={f} className="text-xs text-slate-600">
                        <span className="font-medium">{FIELD_LABEL[f] ?? f}</span>:{' '}
                        <span className="text-slate-400 line-through">{fmt(c.before)}</span>
                        {' → '}
                        <span className="text-slate-800">{fmt(c.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
