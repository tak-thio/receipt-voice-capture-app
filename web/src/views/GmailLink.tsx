import { useEffect, useState } from 'react'
import { api, type GmailAccountRow } from '../api'
import { formatDateTime } from '../format'
import { Badge, Button, Icon, Section } from '../ui'
import { useToast } from '../ui/toast'

// メール連携(Gmail): 顧客のユーザーが自分のGmailを連携し、届いた領収書を取り込む。
// 連携開始は Google へのリダイレクトのため、ブラウザ遷移(window.location)で行う。
export function GmailLink({ clientId }: { clientId: string }) {
  const toast = useToast()
  const [accounts, setAccounts] = useState<GmailAccountRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setAccounts(await api.gmailAccounts(clientId).catch(() => []))
  }
  useEffect(() => {
    void load()
    // 連携コールバック(/?gmail=linked|error)のフィードバック。
    const params = new URLSearchParams(window.location.search)
    const g = params.get('gmail')
    if (g === 'linked') toast.success('Gmailを連携しました')
    else if (g === 'error') toast.error('Gmail連携がキャンセルされました')
    if (g) {
      params.delete('gmail')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  function connect() {
    window.location.href = api.gmailConnectUrl(clientId)
  }
  async function sync(a: GmailAccountRow) {
    setBusy(a.id)
    try {
      const r = await api.gmailSync(a.id)
      toast.success(`取り込み完了: ${r.appended}件追加 / ${r.seen}件確認`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  async function disconnect(a: GmailAccountRow) {
    if (!window.confirm(`${a.email} の連携を解除しますか?`)) return
    if (await toast.run(() => api.gmailDisconnect(a.id), '連携を解除しました')) await load()
  }

  return (
    <Section
      title="メール連携 (Gmail)"
      description="連携したGmailに届いた領収書(添付・本文)を自動で受信箱に取り込みます。"
      actions={<Button variant="primary" size="sm" onClick={connect}><Icon.Plus /> Gmailを連携</Button>}
      bodyClassName="p-0"
    >
      {accounts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          連携中のGmailはありません。「Gmailを連携」から追加してください。
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-800">{a.email}</span>
                  {a.active ? <Badge tone="success">有効</Badge> : <Badge tone="neutral">停止</Badge>}
                  {!a.has_refresh_token && <Badge tone="warning">再連携が必要</Badge>}
                </div>
                <div className="text-xs text-slate-400">
                  最終取込: {a.last_synced_at ? formatDateTime(a.last_synced_at) : '—'}
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void sync(a)}>
                {busy === a.id ? '取込中…' : '今すぐ取込'}
              </Button>
              <Button size="sm" variant="danger-ghost" onClick={() => void disconnect(a)}>解除</Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
