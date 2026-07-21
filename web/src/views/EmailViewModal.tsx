import { useEffect, useState } from 'react'
import { api, type ReceiptEmail } from '../api'
import { Button, Modal } from '../ui'

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
}

// メール本文を「印刷したような」体裁の自己完結HTMLにする。サンドボックス iframe で
// 表示するためスクリプトは実行されない(XSS無害化)。
function buildSrcDoc(e: ReceiptEmail): string {
  const body = e.html
    ? e.html
    : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${esc(e.text)}</pre>`
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:#fff;color:#1e293b}
  body{font-family:system-ui,-apple-system,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;padding:28px 32px}
  .hdr{border-bottom:2px solid #e2e8f0;padding-bottom:14px;margin-bottom:18px}
  .hdr .subj{font-size:18px;font-weight:700;margin-bottom:8px;color:#0f172a}
  .hdr .row{font-size:13px;color:#64748b;line-height:1.7}
  .hdr .row b{color:#334155;font-weight:600}
  .body{font-size:14px;line-height:1.7;word-break:break-word}
  .body img{max-width:100%;height:auto}
  .body table{max-width:100%}
</style></head>
<body>
  <div class="hdr">
    <div class="subj">${esc(e.subject) || '(件名なし)'}</div>
    <div class="row"><b>差出人</b>: ${esc(e.from_addr) || '—'}</div>
    <div class="row"><b>宛先</b>: ${esc(e.account) || '—'}</div>
    <div class="row"><b>日付</b>: ${esc(e.date ? e.date.slice(0, 10).replaceAll('-', '/') : '') || '—'}</div>
  </div>
  <div class="body">${body}</div>
</body></html>`
}

export function EmailViewModal({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const [email, setEmail] = useState<ReceiptEmail | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.receiptEmail(receiptId).then(setEmail).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [receiptId])

  const hasBody = !!(email && (email.html || email.text))
  return (
    <Modal open onClose={onClose} title="メール本文" size="lg" footer={<Button onClick={onClose}>閉じる</Button>}>
      {err ? (
        <div className="p-4 text-sm text-red-600">{err}</div>
      ) : !email ? (
        <div className="p-8 text-center text-sm text-slate-400">読み込み中…</div>
      ) : !hasBody ? (
        <div className="p-8 text-center text-sm text-slate-400">
          このメールの本文は保存されていません（この機能の追加前に取り込まれた領収書です。再取込で取得できます）。
        </div>
      ) : (
        <iframe
          sandbox=""
          title="メール本文"
          srcDoc={buildSrcDoc(email)}
          className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
        />
      )}
    </Modal>
  )
}
