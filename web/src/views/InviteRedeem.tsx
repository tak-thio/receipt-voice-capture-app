import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Button, Card, Icon, Input } from '../ui'

export function InviteRedeem({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.redeemInvite({ token, email, password, name })
      window.history.replaceState({}, '', '/')
      onDone()
    } catch {
      setError('招待の受諾に失敗しました(期限切れ、またはメール重複の可能性)。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-2xl text-white shadow-lg shadow-brand-600/30">
            <Icon.User />
          </div>
          <h1 className="text-lg font-bold text-slate-900">アカウント作成</h1>
          <p className="text-sm text-slate-500">招待リンクからアカウントを作成します。</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && <Alert>{error}</Alert>}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">氏名</span>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">メールアドレス</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">パスワード</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </label>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? '作成中…' : '作成して開始'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
