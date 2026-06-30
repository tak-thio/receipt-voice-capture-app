import { useEffect, useState } from 'react'
import {
  deleteReceipt,
  fetchPreviewObjectUrl,
  patchReceipt,
  type ServerReceipt,
} from '../api/server-api'
import { useAppStore } from '../store/app-store'

export function statusOf(r: ServerReceipt): { text: string; cls: string } {
  if (r.journalized_at) return { text: '仕分済', cls: 'ok' }
  if (r.approval_status === 'rejected') return { text: '否認', cls: 'bad' }
  if (r.approval_status === 'mistake') return { text: '間違い', cls: 'neutral' }
  if (r.approval_status === 'deleted') return { text: '削除済', cls: 'neutral' }
  if (r.parse_failed) return { text: '解析失敗', cls: 'bad' }
  return { text: '未仕分', cls: 'warn' }
}

// 承認(仕分け)前の未確定レコードだけ、登録者が中身を修正できる。
export function isEditable(r: ServerReceipt): boolean {
  return !r.journalized_at && r.approval_status === 'pending'
}

/** 領収書1件の詳細/修正。承認前なら登録者が AI の読み取り内容を修正できる。
 *  経費精算(purposeMode)では摘要を「用途・目的」として強調する。受信箱・経費精算で共用。 */
export function ReceiptDetailScreen({
  receipt,
  onBack,
  onSaved,
  onDeleted,
  purposeMode = false,
  editableOverride,
  notice,
}: {
  receipt: ServerReceipt
  onBack: () => void
  onSaved: (updated: ServerReceipt) => void
  onDeleted: (id: string) => void
  purposeMode?: boolean
  // 申請中/承認/否認などで明示的に編集ロックしたいとき false を渡す(省略時は isEditable)。
  editableOverride?: boolean
  // 上部に出す通知(例: 否認理由)。
  notice?: string
}) {
  const connection = useAppStore((state) => state.connection)!
  const editable = editableOverride ?? isEditable(receipt)
  const [vendor, setVendor] = useState(receipt.vendor ?? '')
  const [date, setDate] = useState(receipt.captured_at ? receipt.captured_at.slice(0, 10) : '')
  const [amount, setAmount] = useState(receipt.amount_jpy != null ? String(receipt.amount_jpy) : '')
  const [payment, setPayment] = useState(receipt.payment_method ?? '')
  const [tnumber, setTnumber] = useState(receipt.t_number ?? '')
  const [description, setDescription] = useState(receipt.description ?? '')
  const [memo, setMemo] = useState(receipt.memo ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let revoke: string | null = null
    if (receipt.image_file_id) {
      fetchPreviewObjectUrl(connection.serverUrl, connection.deviceToken, receipt.image_file_id, receipt.page)
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
        memo: memo.trim() || null,
      })
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setError('')
    try {
      await deleteReceipt(connection.serverUrl, connection.deviceToken, receipt.id)
      onDeleted(receipt.id) // 成功時は親が一覧から除外＆画面を閉じる
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  const descMissing = purposeMode && editable && !description.trim()

  return (
    <div className="inbox-screen">
      <div className="inbox-head">
        <button className="ghost-button" onClick={onBack}>← 戻る</button>
        <h1>{editable ? '修正' : '詳細'}</h1>
        <span style={{ width: 64 }} />
      </div>

      {notice && <p className="detail-notice">{notice}</p>}
      {imgUrl && <img className="detail-img" src={imgUrl} alt="領収書" />}
      {receipt.page != null && <p className="muted small">ページ {receipt.page}</p>}
      {receipt.parse_failed && editable && (
        <p className="detail-failed">請求書として認識できませんでした。内容を入力して保存してください。</p>
      )}
      {!editable && <p className="muted small">確定済み/処理済みのため修正できません。</p>}

      {purposeMode && (
        <label className="field">
          <span>用途・目的{descMissing && <em className="req"> ※申請前に記入</em>}</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
            disabled={!editable || saving} placeholder="例: ◯◯社との打合せ交通費" />
        </label>
      )}

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
      {!purposeMode && (
        <label className="field">
          <span>摘要</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable || saving} placeholder="用途・メモ" />
        </label>
      )}
      <label className="field">
        <span>メモ</span>
        <textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} disabled={!editable || saving} placeholder="ファイル名・ページ・音声などの控え" />
      </label>

      {error && <p className="muted small">{error}</p>}

      {editable && (
        <button className="accent-button send detail-save" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      )}

      {/* 承認(仕分け)前の自分の領収書は削除できる。 */}
      {editable &&
        (confirmingDelete ? (
          <div className="detail-delete-confirm">
            <span>この領収書を削除しますか?</span>
            <div className="detail-delete-actions">
              <button className="danger-button" onClick={() => void remove()} disabled={deleting}>
                {deleting ? '削除中…' : '削除する'}
              </button>
              <button className="ghost-button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button className="detail-delete-link" onClick={() => setConfirmingDelete(true)} disabled={saving}>
            この領収書を削除
          </button>
        ))}
    </div>
  )
}
