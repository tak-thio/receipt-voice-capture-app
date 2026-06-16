import { useEffect, useState } from 'react'
import {
  fetchPreviewObjectUrl,
  listReceipts,
  patchReceipt,
  type ServerReceipt,
} from '../api/server-api'
import { useAppStore } from '../store/app-store'

const SOURCE_LABEL: Record<string, string> = {
  email: 'メール',
  manual: 'アップロード',
  mobile: 'アプリ',
}

function statusOf(r: ServerReceipt): { text: string; cls: string } {
  if (r.journalized_at) return { text: '仕分済', cls: 'ok' }
  if (r.approval_status === 'rejected') return { text: '否認', cls: 'bad' }
  if (r.approval_status === 'mistake') return { text: '間違い', cls: 'neutral' }
  if (r.approval_status === 'deleted') return { text: '削除済', cls: 'neutral' }
  if (r.parse_failed) return { text: '解析失敗', cls: 'bad' }
  return { text: '未仕分', cls: 'warn' }
}

// 承認(仕分け)前の未確定レコードだけ、登録者が中身を修正できる。
function isEditable(r: ServerReceipt): boolean {
  return !r.journalized_at && r.approval_status === 'pending'
}

/** 受信箱: サーバの領収書一覧(PCの受信箱に相当)。行タップで詳細/修正。 */
export function InboxScreen() {
  const connection = useAppStore((state) => state.connection)!
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ServerReceipt | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setRows(await listReceipts(connection.serverUrl, connection.deviceToken, connection.clientId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (selected) {
    return (
      <ReceiptDetailScreen
        receipt={selected}
        onBack={() => setSelected(null)}
        onSaved={(u) => {
          setRows((rs) => rs.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
          setSelected(null)
        }}
      />
    )
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <h1>受信箱</h1>
        <button className="ghost-button" onClick={() => void load()} disabled={loading}>
          {loading ? '更新中…' : '更新'}
        </button>
      </div>
      {error && <p className="muted small">{error}</p>}
      {rows.length === 0 && !loading && !error && (
        <p className="muted center inbox-empty">領収書がありません</p>
      )}
      <ul className="inbox-list">
        {rows.map((r) => {
          const s = statusOf(r)
          const hasImage = !!r.image_file_id
          return (
            <li key={r.id} className="inbox-row tappable" onClick={() => setSelected(r)}>
              <div className="inbox-main">
                <span className={`v${r.parse_failed ? ' failed' : ''}`}>
                  {r.parse_failed ? '請求書として認識できませんでした' : r.vendor || '未解析'}
                </span>
                <span className="amt">{r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}</span>
              </div>
              <div className="inbox-sub">
                <span>{r.captured_at ? r.captured_at.slice(0, 10) : '—'}</span>
                <span className="src">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {hasImage && <span className="img-mark">画像</span>}
                {isEditable(r) && <span className="img-mark">修正可</span>}
                <span className={`st ${s.cls}`}>{s.text}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 領収書1件の詳細。承認前なら登録者が AI の読み取り内容を修正できる。 */
function ReceiptDetailScreen({
  receipt,
  onBack,
  onSaved,
}: {
  receipt: ServerReceipt
  onBack: () => void
  onSaved: (updated: ServerReceipt) => void
}) {
  const connection = useAppStore((state) => state.connection)!
  const editable = isEditable(receipt)
  const [vendor, setVendor] = useState(receipt.vendor ?? '')
  const [date, setDate] = useState(receipt.captured_at ? receipt.captured_at.slice(0, 10) : '')
  const [amount, setAmount] = useState(receipt.amount_jpy != null ? String(receipt.amount_jpy) : '')
  const [payment, setPayment] = useState(receipt.payment_method ?? '')
  const [tnumber, setTnumber] = useState(receipt.t_number ?? '')
  const [description, setDescription] = useState(receipt.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoke: string | null = null
    if (receipt.image_file_id) {
      fetchPreviewObjectUrl(connection.serverUrl, connection.deviceToken, receipt.image_file_id)
        .then((u) => {
          revoke = u
          setImgUrl(u)
        })
        .catch(() => {})
    }
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.image_file_id])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const digits = amount.replace(/[^\d-]/g, '')
      const amountJpy = digits === '' ? null : Number(digits)
      const updated = await patchReceipt(connection.serverUrl, connection.deviceToken, receipt.id, {
        vendor: vendor.trim() || null,
        date: date || null,
        amount_jpy: amountJpy != null && Number.isNaN(amountJpy) ? null : amountJpy,
        payment_method: payment.trim() || null,
        t_number: tnumber.trim() || null,
        description: description.trim() || null,
      })
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <button className="ghost-button" onClick={onBack}>← 戻る</button>
        <h1>{editable ? '修正' : '詳細'}</h1>
        <span style={{ width: 64 }} />
      </div>

      {imgUrl && <img className="detail-img" src={imgUrl} alt="領収書" />}
      {receipt.parse_failed && editable && (
        <p className="detail-failed">請求書として認識できませんでした。内容を入力して保存してください。</p>
      )}
      {!editable && <p className="muted small">確定済み/処理済みのため修正できません。</p>}

      <label className="field">
        <span>支払先</span>
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={!editable || saving} placeholder="支払先" />
      </label>
      <label className="field">
        <span>日付</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!editable || saving} />
      </label>
      <label className="field">
        <span>金額(税込)</span>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editable || saving} />
      </label>
      <label className="field">
        <span>支払方法</span>
        <input value={payment} onChange={(e) => setPayment(e.target.value)} disabled={!editable || saving} placeholder="現金 / クレジット 等" />
      </label>
      <label className="field">
        <span>インボイス番号</span>
        <input value={tnumber} onChange={(e) => setTnumber(e.target.value)} disabled={!editable || saving} placeholder="T1234567890123" />
      </label>
      <label className="field">
        <span>摘要</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable || saving} placeholder="用途・メモ" />
      </label>

      {error && <p className="muted small">{error}</p>}

      {editable && (
        <button className="accent-button send detail-save" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      )}
    </div>
  )
}
