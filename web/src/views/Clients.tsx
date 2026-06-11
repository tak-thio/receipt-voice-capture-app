import { useEffect, useState } from 'react'
import { api, type ClientDetail, type ClientRow, type MemberRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Field, Icon, IconButton, Input, Modal,
  PageHeader, Section, Select, Table, Tbody, Td, Th, Thead, Textarea, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const FORMATS = ['generic', 'mas', 'freee', 'yayoi']
const ROLE_LABEL: Record<string, string> = {
  client_admin: '管理者', client_accountant: '経理担当者', client_user: '一般社員',
}
const ROLE_TONE: Record<string, 'brand' | 'info' | 'neutral'> = {
  client_admin: 'brand', client_accountant: 'info', client_user: 'neutral',
}
// 役職 (organizational title) suggestions — free text; these are just hints.
const JOB_TITLES = [
  '代表取締役', '取締役', '監査役', '執行役員', '部長', '次長',
  '課長', '係長', '主任', '経理担当', '総務担当', '担当',
]
const ENTITY_LABEL: Record<string, string> = { corporation: '法人', individual: '個人' }

function blankClient(): ClientDetail {
  return {
    id: '', name: '', code: null, export_default: 'generic', status: 'active',
    entity_type: null, t_number: null, address: null, phone: null,
    contact_name: null, fiscal_month: null, industry: null, memo: null,
    staff_user_id: null,
  }
}

type Screen = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: string }

// 顧問先マスタ: 会計事務所向けに「一覧 / 新規 / 編集」を別画面に分離(1画面に詰め込まない)。
// canManage(管理者のみ): 新規登録・削除を許可。一般社員は担当顧問先の閲覧・編集のみ。
// selfClientId: 利用者(管理者)が自社を管理するモード — 同じ編集画面を自社に固定して流用。
export function ClientsView({
  onChanged, canManage, selfClientId,
}: {
  onChanged: () => Promise<void> | void
  canManage: boolean
  selfClientId?: string
}) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })

  // 利用者(管理者)は自社の編集画面に直結(一覧・新規なし)。
  if (selfClientId) {
    return <EditScreen id={selfClientId} canManage={false} selfMode onChanged={onChanged} onBack={() => {}} />
  }

  if (screen.kind === 'create' && canManage) {
    return (
      <CreateScreen
        onCancel={() => setScreen({ kind: 'list' })}
        onCreated={async (id) => { await onChanged(); setScreen({ kind: 'edit', id }) }}
      />
    )
  }
  if (screen.kind === 'edit') {
    return (
      <EditScreen
        id={screen.id}
        canManage={canManage}
        onBack={() => setScreen({ kind: 'list' })}
        onChanged={onChanged}
      />
    )
  }
  return (
    <ListScreen
      canManage={canManage}
      onNew={() => setScreen({ kind: 'create' })}
      onOpen={(id) => setScreen({ kind: 'edit', id })}
      onChanged={onChanged}
    />
  )
}

/* ----------------------------------------------------------------- 一覧 */

function ListScreen({
  canManage, onNew, onOpen, onChanged,
}: {
  canManage: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onChanged: () => Promise<void> | void
}) {
  const toast = useToast()
  const [rows, setRows] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(q = search) {
    setLoading(true)
    try {
      setRows(await api.clients(q.trim() || undefined))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const t = setTimeout(() => void load(search), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function remove(c: ClientRow) {
    if (!window.confirm(`顧問先「${c.name}」を削除(アーカイブ)しますか?`)) return
    if (await toast.run(() => api.deleteClient(c.id), `「${c.name}」を削除しました`)) {
      await load()
      await onChanged()
    }
  }

  return (
    <>
      <PageHeader
        title="顧問先マスタ"
        description={canManage ? '顧問先(クライアント企業)の一覧です。' : '担当している顧問先の一覧です。'}
        actions={canManage ? <Button variant="primary" onClick={onNew}><Icon.Plus /> 新規登録</Button> : undefined}
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-80 max-w-full">
          <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="名称・コードで検索" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="ml-1 text-sm text-slate-500">{rows.length}件</span>
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-24">コード</Th>
              <Th>名称</Th>
              <Th className="w-20">区分</Th>
              <Th className="w-20">決算月</Th>
              <Th>業種</Th>
              <Th className="w-px text-right">操作</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((c) => (
              <Tr key={c.id} onClick={() => onOpen(c.id)}>
                <Td className="font-mono text-xs text-slate-500">{c.code || '—'}</Td>
                <Td className="font-medium text-slate-800">{c.name}</Td>
                <Td>{c.entity_type ? <Badge tone={c.entity_type === 'corporation' ? 'brand' : 'neutral'}>{ENTITY_LABEL[c.entity_type]}</Badge> : <span className="text-slate-300">—</span>}</Td>
                <Td className="text-slate-600">{c.fiscal_month ? `${c.fiscal_month}月` : '—'}</Td>
                <Td className="text-slate-600">{c.industry || <span className="text-slate-300">—</span>}</Td>
                <Td className="text-right" >
                  <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="secondary" onClick={() => onOpen(c.id)}><Icon.Pencil /> 編集</Button>
                    {canManage && <IconButton label="削除" className="hover:!text-red-600" onClick={() => void remove(c)}><Icon.Trash /></IconButton>}
                  </div>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">{loading ? '読み込み中…' : '該当する顧問先がありません'}</td></tr>
            )}
          </Tbody>
        </Table>
      </Card>
    </>
  )
}

/* ----------------------------------------------------------------- 新規 */

function CreateScreen({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void | Promise<void> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function submit(values: ClientDetail) {
    if (!values.name.trim()) { toast.error('名称は必須です。'); return }
    setBusy(true)
    try {
      const r = await api.createClient({ ...values, name: values.name.trim() })
      toast.success('顧問先を登録しました')
      await onCreated(r.id)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Crumb onBack={onCancel} />
      <PageHeader title="顧問先の新規登録" description="基本情報を入力してください。利用者は登録後に追加できます。" />
      <div className="mx-auto max-w-3xl">
        <Section title="基本情報">
          <ClientForm initial={blankClient()} submitLabel="登録" busy={busy} onSubmit={submit} onCancel={onCancel} />
        </Section>
      </div>
    </>
  )
}

/* ----------------------------------------------------------------- 編集 */

function EditScreen({ id, canManage, onBack, onChanged, selfMode }: { id: string; canManage: boolean; onBack: () => void; onChanged: () => Promise<void> | void; selfMode?: boolean }) {
  const toast = useToast()
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.client(id).then(setDetail).catch((e) => toast.error(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function submit(values: ClientDetail) {
    if (!values.name.trim()) { toast.error('名称は必須です。'); return }
    setBusy(true)
    if (await toast.run(() => api.patchClient(id, values), '顧問先情報を保存しました')) {
      setDetail(values)
      await onChanged()
    }
    setBusy(false)
  }
  async function remove() {
    if (!detail) return
    if (!window.confirm(`顧問先「${detail.name}」を削除(アーカイブ)しますか?`)) return
    if (await toast.run(() => api.deleteClient(id), `「${detail.name}」を削除しました`)) {
      await onChanged()
      onBack()
    }
  }

  if (!detail) return <>{!selfMode && <Crumb onBack={onBack} />}<Card><EmptyState icon={<Icon.Building />} title="読み込み中…" /></Card></>

  return (
    <>
      {!selfMode && <Crumb onBack={onBack} />}
      <PageHeader
        title={selfMode ? '自社' : detail.name}
        description={selfMode ? '自社情報と利用者を管理します。' : `顧問先の編集${detail.code ? ` · コード ${detail.code}` : ''}`}
        actions={canManage ? <Button variant="danger-ghost" onClick={() => void remove()}><Icon.Trash /> 削除</Button> : undefined}
      />
      <div className="space-y-5">
        <Section title="基本情報">
          <ClientForm initial={detail} submitLabel="保存" busy={busy} onSubmit={submit} onCancel={onBack} />
        </Section>
        <ClientUsers clientId={id} />
      </div>
    </>
  )
}

function Crumb({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
      <Icon.ChevronDown className="rotate-90 text-base" /> 顧問先一覧へ戻る
    </button>
  )
}

/* ------------------------------------------------------ shared client form */

function ClientForm({
  initial, submitLabel, busy, onSubmit, onCancel,
}: {
  initial: ClientDetail
  submitLabel: string
  busy: boolean
  onSubmit: (values: ClientDetail) => void | Promise<void>
  onCancel: () => void
}) {
  const [d, setD] = useState<ClientDetail>(initial)
  function set<K extends keyof ClientDetail>(k: K, v: ClientDetail[K]) {
    setD((p) => ({ ...p, [k]: v }))
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="名称" required>
          <Input autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="コード">
          <Input value={d.code ?? ''} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="区分">
          <Select value={d.entity_type ?? ''} onChange={(e) => set('entity_type', e.target.value)}>
            <option value="">—</option>
            <option value="corporation">法人</option>
            <option value="individual">個人</option>
          </Select>
        </Field>
        <Field label="インボイス登録番号">
          <Input value={d.t_number ?? ''} onChange={(e) => set('t_number', e.target.value)} placeholder="T1234567890123" />
        </Field>
        <Field label="決算月">
          <Input type="number" min={1} max={12} value={d.fiscal_month ?? ''}
            onChange={(e) => set('fiscal_month', e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="業種">
          <Input value={d.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
        </Field>
        <Field label="会計ソフト(既定出力)">
          <Select value={d.export_default} onChange={(e) => set('export_default', e.target.value)}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
        <Field label="電話">
          <Input value={d.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="住所" className="sm:col-span-2">
          <Input value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="先方担当者">
          <Input value={d.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} />
        </Field>
        <Field label="メモ" className="sm:col-span-2">
          <Textarea rows={2} value={d.memo ?? ''} onChange={(e) => set('memo', e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void onSubmit(d)}>
          <Icon.Check /> {busy ? '保存中…' : submitLabel}
        </Button>
        <Button onClick={onCancel}>キャンセル</Button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------- client users */

type UserModalState = { mode: 'add' } | { mode: 'edit'; user: MemberRow } | null

export function ClientUsers({ clientId }: { clientId: string }) {
  const toast = useToast()
  const [users, setUsers] = useState<MemberRow[]>([])
  const [modal, setModal] = useState<UserModalState>(null)
  const [qr, setQr] = useState<{ user: MemberRow; png: string } | null>(null)

  async function reload() {
    setUsers(await api.clientUsers(clientId).catch(() => []))
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function toggleStatus(u: MemberRow) {
    const next = u.status === 'disabled' ? 'active' : 'disabled'
    if (await toast.run(() => api.patchClientUser(clientId, u.user_id, { status: next }),
      next === 'disabled' ? `${u.name} を無効化しました` : `${u.name} を有効化しました`)) await reload()
  }
  async function remove(u: MemberRow) {
    if (!window.confirm(`${u.name || u.email} を削除しますか?`)) return
    if (await toast.run(() => api.removeClientUser(clientId, u.user_id), '利用者を削除しました')) await reload()
  }
  async function issueQr(u: MemberRow) {
    try {
      const r = await api.issuePairing(clientId, u.user_id)
      setQr({ user: u, png: r.qr_png_base64 })
    } catch (e) { toast.error(String(e)) }
  }

  return (
    <Section
      title="利用者"
      description="PCで確認する人はログインID(メール)+パスワードを設定。アプリのみ使う人はQRで連携します。"
      actions={<Button variant="primary" size="sm" onClick={() => setModal({ mode: 'add' })}><Icon.Plus /> 利用者を追加</Button>}
      bodyClassName="p-0"
    >
      <Table>
        <Thead>
          <tr>
            <Th>氏名</Th>
            <Th className="w-36">役職</Th>
            <Th>ログインID</Th>
            <Th className="w-28">役割</Th>
            <Th className="w-20">状態</Th>
            <Th className="w-px text-right">操作</Th>
          </tr>
        </Thead>
        <Tbody>
          {users.map((u) => (
            <Tr key={u.user_id}>
              <Td>
                <div className="font-medium text-slate-800">{u.name || '(無名)'}</div>
                <div className="flex items-center gap-1.5">
                  {u.password_set && <Badge tone="info">PCログイン可</Badge>}
                  {u.phone && <span className="text-xs text-slate-400">{u.phone}</span>}
                </div>
              </Td>
              <Td className="text-slate-600">{u.job_title || <span className="text-slate-300">—</span>}</Td>
              <Td className="text-slate-600">{u.login_id || <span className="text-slate-400">アプリ専用</span>}</Td>
              <Td><Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>{ROLE_LABEL[u.role] ?? u.role}</Badge></Td>
              <Td>{u.status === 'disabled' ? <Badge tone="danger">無効</Badge> : <Badge tone="success">有効</Badge>}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <IconButton label="QR発行" onClick={() => void issueQr(u)}><Icon.Qr /></IconButton>
                  <IconButton label="編集" onClick={() => setModal({ mode: 'edit', user: u })}><Icon.Pencil /></IconButton>
                  <Button size="sm" variant="ghost" onClick={() => void toggleStatus(u)}>{u.status === 'disabled' ? '有効化' : '無効化'}</Button>
                  <IconButton label="削除" className="hover:!text-red-600" onClick={() => void remove(u)}><Icon.Trash /></IconButton>
                </div>
              </Td>
            </Tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">利用者がいません</td></tr>
          )}
        </Tbody>
      </Table>

      {modal && (
        <UserModal clientId={clientId} modal={modal} onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await reload() }} />
      )}
      <Modal open={!!qr} onClose={() => setQr(null)} title="ペアリングQR" size="sm"
        description={qr ? `${qr.user.name || qr.user.email} のスマホアプリで読み取ってください(15分有効)` : undefined}>
        {qr && (
          <div className="flex flex-col items-center gap-3 py-2">
            <img alt="QR" className="h-56 w-56 rounded-lg border border-slate-200" src={`data:image/png;base64,${qr.png}`} />
          </div>
        )}
      </Modal>
    </Section>
  )
}

function UserModal({
  clientId, modal, onClose, onSaved,
}: {
  clientId: string
  modal: { mode: 'add' } | { mode: 'edit'; user: MemberRow }
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const toast = useToast()
  const editing = modal.mode === 'edit'
  const u = editing ? modal.user : undefined
  const [name, setName] = useState(u?.name ?? '')
  const [email, setEmail] = useState(u?.login_id ?? '')
  const [phone, setPhone] = useState(u?.phone ?? '')
  const [jobTitle, setJobTitle] = useState(u?.job_title ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(u?.role ?? 'client_user')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) { toast.error('氏名は必須です。'); return }
    setBusy(true)
    try {
      if (editing && u) {
        const patch: Record<string, string> = {}
        if (name !== (u.name || '')) patch.name = name.trim()
        if (email !== (u.login_id || '')) patch.email = email.trim()
        if (phone !== (u.phone || '')) patch.phone = phone.trim()
        if (jobTitle !== (u.job_title || '')) patch.job_title = jobTitle.trim()
        if (role !== u.role) patch.role = role
        if (password) patch.password = password
        await api.patchClientUser(clientId, u.user_id, patch)
        toast.success('利用者を更新しました')
      } else {
        await api.createClientUser(clientId, {
          name: name.trim(), email: email.trim() || undefined,
          phone: phone.trim() || undefined, job_title: jobTitle.trim() || undefined,
          password: password || undefined, role,
        })
        toast.success('利用者を追加しました')
      }
      await onSaved()
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? '利用者を編集' : '利用者を追加'}
      description="PCで確認する人はログインID(メール)とパスワードを設定してください。"
      footer={<>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? '保存中…' : editing ? '保存' : '追加'}</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="氏名" required className="sm:col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ログインID(メール)" hint="PC利用時のみ。未設定でQR連携可。" className="sm:col-span-2">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </Field>
        <Field label="役職" hint="例: 代表取締役 / 部長">
          <Input list="client-user-titles" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="代表取締役" />
          <datalist id="client-user-titles">
            {JOB_TITLES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Field>
        <Field label="電話">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={editing ? '新パスワード(変更時のみ)' : 'パスワード(PC利用時)'}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="役割(システム権限)" hint="管理者 / 経理担当者 / 一般社員">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
