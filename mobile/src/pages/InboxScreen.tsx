import { useEffect, useState } from 'react'
import { fetchPreviewObjectUrl, listReceipts, type ServerReceipt } from '../api/server-api'
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
  return { text: '未仕分', cls: 'warn' }
}

/** 受信箱: サーバの領収書一覧(PCの受信箱に相当)。行タップで画像プレビュー。 */
export function InboxScreen() {
  const connection = useAppStore((state) => state.connection)!
  const [rows, setRows] = useState<ServerReceipt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 画像プレビュー
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')

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

  async function openPreview(r: ServerReceipt) {
    if (!r.image_file_id) return
    setPreviewOpen(true)
    setPreviewBusy(true)
    setPreviewError('')
    setPreviewUrl(null)
    try {
      const url = await fetchPreviewObjectUrl(connection.serverUrl, connection.deviceToken, r.image_file_id)
      setPreviewUrl(url)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewBusy(false)
    }
  }
  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewOpen(false)
    setPreviewError('')
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
            <li
              key={r.id}
              className={`inbox-row${hasImage ? ' tappable' : ''}`}
              onClick={() => void openPreview(r)}
            >
              <div className="inbox-main">
                <span className="v">{r.vendor || '未解析'}</span>
                <span className="amt">{r.amount_jpy != null ? `¥${r.amount_jpy.toLocaleString()}` : '—'}</span>
              </div>
              <div className="inbox-sub">
                <span>{r.captured_at ? r.captured_at.slice(0, 10) : '—'}</span>
                <span className="src">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {hasImage && <span className="img-mark">画像</span>}
                <span className={`st ${s.cls}`}>{s.text}</span>
              </div>
            </li>
          )
        })}
      </ul>

      {previewOpen && (
        <div className="preview-overlay" onClick={closePreview}>
          {previewBusy && <p className="muted">読み込み中…</p>}
          {previewError && <p className="muted">{previewError}</p>}
          {previewUrl && <img className="preview-img" src={previewUrl} alt="領収書" onClick={(e) => e.stopPropagation()} />}
          <button className="preview-close" onClick={closePreview}>閉じる</button>
        </div>
      )}
    </div>
  )
}
