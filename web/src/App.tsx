import { useEffect, useState } from 'react'
import { api, type Me, type ReceiptRow } from './api'

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-stone-500">読み込み中...</div>
  return me ? <Dashboard me={me} onLogout={() => setMe(null)} /> : <Login onLogin={setMe} />
}

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.login(email, password)
      onLogin(await api.me())
    } catch {
      setError('ログインに失敗しました')
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-stone-100">
      <form onSubmit={submit} className="w-80 space-y-3 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-lg font-bold text-stone-800">領収書SaaS ログイン</h1>
        <input
          className="w-full rounded-lg border px-3 py-2"
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-lg border px-3 py-2"
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-stone-800 py-2 text-white">ログイン</button>
      </form>
    </div>
  )
}

function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [rows, setRows] = useState<ReceiptRow[]>([])

  useEffect(() => {
    api.receipts().then(setRows).catch(() => setRows([]))
  }, [])

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <h1 className="font-bold text-stone-800">領収書SaaS</h1>
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span>{me.user.email}</span>
          <button
            className="rounded-lg border px-3 py-1"
            onClick={async () => {
              await api.logout()
              onLogout()
            }}
          >
            ログアウト
          </button>
        </div>
      </header>
      <main className="p-6">
        <h2 className="mb-3 font-semibold text-stone-700">領収書</h2>
        <table className="w-full overflow-hidden rounded-xl bg-white text-sm shadow">
          <thead className="bg-stone-100 text-stone-600">
            <tr>
              <th className="px-3 py-2 text-left">支払先</th>
              <th className="px-3 py-2 text-right">金額</th>
              <th className="px-3 py-2 text-left">状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.vendor ?? '—'}</td>
                <td className="px-3 py-2 text-right">{r.amount_jpy ?? '—'}</td>
                <td className="px-3 py-2">{r.approval_status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-stone-400">
                  領収書がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  )
}
