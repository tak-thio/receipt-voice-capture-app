// Platform operator (運営) console — entirely separate from the tenant app:
// its own route (/operator), its own login screen, its own op_session cookie.
// It provisions and manages 税理士事務所 (create / suspend / reactivate). It does
// NOT show any firm's receipt/client data.
import { useEffect, useState, type FormEvent } from 'react'
import { operatorApi, type OperatorFirm, type OperatorInfo } from '../api'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui'
import { useToast } from '../ui/toast'

export function OperatorConsole() {
  const [me, setMe] = useState<OperatorInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    operatorApi
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        <Icon.Building className="animate-pulse text-4xl" />
      </div>
    )
  }
  if (!me) return <OperatorLogin onLogin={setMe} />
  return <OperatorDashboard me={me} onLogout={() => setMe(null)} />
}

/* ------------------------------------------------------------------ login */

function OperatorLogin({ onLogin }: { onLogin: (me: OperatorInfo) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await operatorApi.login(email, password)
      onLogin(await operatorApi.me())
    } catch {
      setError('メールアドレスまたはパスワードが正しくありません。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-2xl text-white ring-1 ring-white/20">
            <Icon.Building />
          </div>
          <h1 className="text-lg font-bold text-white">運営コンソール</h1>
          <p className="text-sm text-slate-300">税理士事務所の作成・管理</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && <Alert>{error}</Alert>}
            <Field label="メールアドレス">
              <Input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@example.com"
              />
            </Field>
            <Field label="パスワード">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? '認証中…' : 'ログイン'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">運営者専用 — 各事務所のデータには接続しません</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- dashboard */

function OperatorDashboard({ me, onLogout }: { me: OperatorInfo; onLogout: () => void }) {
  const toast = useToast()
  const [firms, setFirms] = useState<OperatorFirm[] | null>(null)
  const [kind, setKind] = useState<'firm' | 'individual'>('firm')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<OperatorFirm | null>(null)

  async function reload() {
    try {
      setFirms(await operatorApi.firms(kind))
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e))
      setFirms([])
    }
  }
  useEffect(() => {
    setFirms(null)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  async function logout() {
    await operatorApi.logout().catch(() => {})
    onLogout()
  }

  async function toggleStatus(f: OperatorFirm) {
    const next = f.status === 'active' ? 'suspended' : 'active'
    const ok = await toast.run(
      () => operatorApi.updateFirm(f.id, { status: next }),
      next === 'suspended' ? `${f.name} を停止しました` : `${f.name} を再開しました`,
    )
    if (ok) void reload()
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-800 text-lg text-white shadow-sm">
          <Icon.Building />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-slate-900">運営コンソール</div>
          <div className="text-[11px] text-slate-400">税理士事務所の作成・管理</div>
        </div>
        <div className="flex-1" />
        <span className="hidden text-sm text-slate-500 sm:inline">{me.email}</span>
        <Button variant="ghost" size="sm" onClick={logout}>
          <Icon.LogOut /> ログアウト
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-5 sm:p-6">
        <PageHeader
          title={kind === 'firm' ? '税理士事務所' : '個人ユーザー'}
          description={
            kind === 'firm'
              ? '新しい事務所の作成と、各事務所の停止・再開を管理します。事務所内の領収書データは表示しません。'
              : '個人(無料/サブスク)アカウントの一覧と、停止・再開を管理します。個人データは表示しません。'
          }
          actions={
            kind === 'firm' ? (
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                <Icon.Plus /> 新規事務所
              </Button>
            ) : null
          }
        />

        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {([['firm', '税理士事務所'], ['individual', '個人ユーザー']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={
                'rounded-md px-4 py-1.5 text-sm font-semibold transition ' +
                (kind === k ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800')
              }
            >
              {label}
            </button>
          ))}
        </div>

        <Card>
          {firms === null ? (
            <div className="grid place-items-center py-16 text-slate-400">
              <Spinner className="text-2xl" />
            </div>
          ) : firms.length === 0 ? (
            <EmptyState
              icon={<Icon.Building />}
              title={kind === 'firm' ? '事務所がありません' : '個人ユーザーがいません'}
              description={
                kind === 'firm'
                  ? '「新規事務所」から最初の税理士事務所を作成してください。'
                  : 'アプリから個人登録があると、ここに表示されます。'
              }
              action={
                kind === 'firm' ? (
                  <Button variant="primary" onClick={() => setShowCreate(true)}>
                    <Icon.Plus /> 新規事務所
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>{kind === 'firm' ? '事務所名' : 'アカウント'}</Th>
                  <Th>プラン</Th>
                  <Th>状態</Th>
                  <Th>{kind === 'firm' ? '管理者(owner)' : 'メール'}</Th>
                  <Th>作成日</Th>
                  <Th className="text-right">操作</Th>
                </Tr>
              </Thead>
              <Tbody>
                {firms.map((f) => (
                  <Tr key={f.id}>
                    <Td className="font-medium text-slate-800">{f.name}</Td>
                    <Td className="text-slate-600">{f.plan}</Td>
                    <Td>
                      {f.status === 'active' ? (
                        <Badge tone="success">稼働中</Badge>
                      ) : (
                        <Badge tone="danger">停止中</Badge>
                      )}
                    </Td>
                    <Td className="text-slate-600">{f.owners.join(', ') || '—'}</Td>
                    <Td className="text-slate-500">{f.created_at ? f.created_at.slice(0, 10).replaceAll('-', '/') : '—'}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
                          <Icon.Pencil /> 編集
                        </Button>
                        <Button
                          size="sm"
                          variant={f.status === 'active' ? 'danger-ghost' : 'secondary'}
                          onClick={() => toggleStatus(f)}
                        >
                          {f.status === 'active' ? '停止' : '再開'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Card>
      </main>

      <CreateFirmModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false)
          void reload()
        }}
      />

      <EditFirmModal
        firm={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void reload()
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------- edit firm */

function EditFirmModal({
  firm,
  onClose,
  onSaved,
}: {
  firm: OperatorFirm | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [plan, setPlan] = useState('')
  const [status, setStatus] = useState('active')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (firm) {
      setName(firm.name)
      setPlan(firm.plan)
      setStatus(firm.status)
    }
  }, [firm])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!firm || !name) return
    setBusy(true)
    const ok = await toast.run(
      () => operatorApi.updateFirm(firm.id, { name, plan, status }),
      `${name} を更新しました`,
    )
    setBusy(false)
    if (ok) onSaved()
  }

  return (
    <Modal
      open={!!firm}
      onClose={onClose}
      title="事務所の編集"
      description="事務所名・プラン・状態を変更します。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" type="submit" form="op-edit-firm" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id="op-edit-firm" onSubmit={submit} className="space-y-4">
        <Field label="事務所名" required>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="プラン">
          <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="free" />
        </Field>
        <Field label="状態">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">稼働中</option>
            <option value="suspended">停止中</option>
          </Select>
        </Field>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------ create firm */

function CreateFirmModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [firmName, setFirmName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setFirmName('')
    setOwnerName('')
    setOwnerEmail('')
    setOwnerPassword('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!firmName || !ownerEmail || !ownerPassword) return
    setBusy(true)
    const ok = await toast.run(
      () =>
        operatorApi.createFirm({
          firm_name: firmName,
          owner_email: ownerEmail,
          owner_password: ownerPassword,
          owner_name: ownerName,
        }),
      `${firmName} を作成しました`,
    )
    setBusy(false)
    if (ok) {
      reset()
      onCreated()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="税理士事務所の新規作成"
      description="事務所と、その管理者(owner)アカウントを作成します。owner は作成後にログインして顧客を登録できます。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" type="submit" form="op-create-firm" disabled={busy}>
            {busy ? '作成中…' : '作成'}
          </Button>
        </>
      }
    >
      <form id="op-create-firm" onSubmit={submit} className="space-y-4">
        <Field label="事務所名" required>
          <Input
            autoFocus
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
            placeholder="さくら税理士事務所"
          />
        </Field>
        <div className="h-px bg-slate-100" />
        <p className="text-xs font-semibold text-slate-500">管理者(owner)アカウント</p>
        <Field label="氏名">
          <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="山田 太郎" />
        </Field>
        <Field label="メールアドレス（ログインID）" required>
          <Input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
          />
        </Field>
        <Field label="初期パスワード" required hint="owner に共有するパスワード。ログイン後に変更できます。">
          <Input
            type="text"
            value={ownerPassword}
            onChange={(e) => setOwnerPassword(e.target.value)}
            placeholder="初期パスワード"
          />
        </Field>
      </form>
    </Modal>
  )
}
