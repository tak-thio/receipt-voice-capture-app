import { useState } from 'react'
import { api } from '../api'

export function InviteRedeem({ token, onDone }: { token: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.redeemInvite({ token, email, password, name })
      window.history.replaceState({}, '', '/')
      onDone()
    } catch {
      setError('招待の受諾に失敗しました(期限切れ、またはメール重複の可能性)。')
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-stone-100">
      <form onSubmit={submit} className="w-96 space-y-3 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-lg font-bold text-stone-800">アカウント作成(招待)</h1>
        <p className="text-sm text-stone-500">招待リンクからアカウントを作成します。</p>
        <input className="w-full rounded-lg border px-3 py-2" placeholder="氏名"
          value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full rounded-lg border px-3 py-2" placeholder="メールアドレス"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-lg border px-3 py-2" type="password" placeholder="パスワード"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-stone-800 py-2 text-white">作成して開始</button>
      </form>
    </div>
  )
}
