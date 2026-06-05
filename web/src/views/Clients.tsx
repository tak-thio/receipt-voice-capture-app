import { useEffect, useState } from 'react'
import { api, type ClientDetail, type ClientRow, type MemberRow } from '../api'
import {
  Badge, Button, Card, cn, EmptyState, Field, Icon, IconButton, Input, Modal,
  PageHeader, Section, Select, Table, Tbody, Td, Th, Thead, Textarea, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const FORMATS = ['generic', 'mas', 'freee', 'yayoi']
const ROLE_LABEL: Record<string, string> = {
  client_admin: '管理者', client_accountant: '経理担当者', client_user: '一般社員',
}

function blankClient(): ClientDetail {
  return {
    id: '', name: '', code: null, export_default: 'generic', status: 'active',
    entity_type: null, t_number: null, address: null, phone: null,
    contact_name: null, fiscal_month: null, industry: null, memo: null,
    staff_user_id: null,
  }
}

type UserModal =
  | { mode: 'add' }
  | { mode: 'edit'; user: MemberRow }
  | null

export function ClientsView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const toast = useToast()
  const [clients, setClients] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [users, setUsers] = useState<MemberRow[]>([])
  const [userModal, setUserModal] = useState<UserModal>(null)
  const [qr, setQr] = useState<{ user: MemberRow; png: string } | null>(null)

  async function loadClients() {
    setClients(await api.clients(search.trim() || undefined))
  }
  useEffect(() => {
    const t = setTimeout(() => void loadClients(), 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function select(id: string) {
    setCreating(false)
    setDetail(await api.client(id))
    setUsers(await api.clientUsers(id).catch(() => []))
  }
  function startCreate() {
    setCreating(true)
    setDetail(blankClient())
    setUsers([])
  }
  function cancel() {
    setCreating(false)
    setDetail(null)
  }

  async function removeClient(c: ClientRow) {
    if (!window.confirm(`顧問先「${c.name}」を削除(アーカイブ)しますか?`)) return
    if (await toast.run(() => api.deleteClient(c.id), `「${c.name}」を削除しました`)) {
      if (detail?.id === c.id) setDetail(null)
      await loadClients()
      await onChanged()
    }
  }

  function set<K extends keyof ClientDetail>(k: K, v: ClientDetail[K]) {
    setDetail((d) => (d ? { ...d, [k]: v } : d))
  }

  async function save() {
    if (!detail) return
    if (!detail.name.trim()) {
      toast.error('名称は必須です。')
      return
    }
    if (creating) {
      try {
        const r = await api.createClient({ ...detail, name: detail.name.trim() })
        setSearch('')
        setClients(await api.clients())
        await onChanged()
        await select(r.id)
        toast.success('顧問先を登録しました')
      } catch (e) {
        toast.error(String(e))
      }
    } else {
      if (await toast.run(() => api.patchClient(detail.id, detail), '顧問先情報を保存しました')) {
        await loadClients()
        await onChanged()
      }
    }
  }

  async function reloadUsers() {
    if (detail) setUsers(await api.clientUsers(detail.id))
  }
  async function toggleStatus(u: MemberRow) {
    const next = u.status === 'disabled' ? 'active' : 'disabled'
    if (await toast.run(() => api.patchClientUser(detail!.id, u.user_id, { status: next }),
      next === 'disabled' ? `${u.name} を無効化しました` : `${u.name} を有効化しました`)) {
      await reloadUsers()
    }
  }
  async function removeUser(u: MemberRow) {
    if (!window.confirm(`${u.name || u.email} を削除しますか?`)) return
    if (await toast.run(() => api.removeClientUser(detail!.id, u.user_id), '利用者を削除しました')) {
      await reloadUsers()
    }
  }
  async function issueQr(u: MemberRow) {
    try {
      const r = await api.issuePairing(detail!.id, u.user_id)
      setQr({ user: u, png: r.qr_png_base64 })
    } catch (e) {
      toast.error(String(e))
    }
  }

  return (
    <>
      <PageHeader
        title="顧問先"
        description="顧問先(クライアント企業)と、その利用者を管理します。"
        actions={
          <Button variant="primary" onClick={startCreate}>
            <Icon.Plus /> 新規登録
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        {/* list */}
        <Card className="h-fit">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="名称・コードで検索" value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <ul className="scroll-slim max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {clients.map((c) => {
              const on = !creating && detail?.id === c.id
              return (
                <li key={c.id}
                  className={cn('group flex items-center gap-2 px-4 py-2.5 text-sm', on ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => void select(c.id)}>
                    <div className={cn('truncate font-medium', on ? 'text-brand-700' : 'text-slate-800')}>{c.name}</div>
                    {c.code && <div className="truncate text-xs text-slate-400">{c.code}</div>}
                  </button>
                  <IconButton label="削除" className="opacity-0 hover:!text-red-600 group-hover:opacity-100"
                    onClick={() => void removeClient(c)}>
                    <Icon.Trash />
                  </IconButton>
                </li>
              )
            })}
            {clients.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-slate-400">該当する顧問先がありません</li>
            )}
          </ul>
        </Card>

        {/* detail */}
        <div className="min-w-0 space-y-5">
          {!detail ? (
            <Card>
              <EmptyState
                icon={<Icon.Building />}
                title="顧問先が選択されていません"
                description="左の一覧から選択するか、新規登録してください。"
                action={<Button variant="primary" onClick={startCreate}><Icon.Plus /> 新規登録</Button>}
              />
            </Card>
          ) : (
            <>
              <Section
                title={creating ? '新規顧問先の登録' : `${detail.name} の情報`}
                actions={creating ? <Badge tone="brand">新規</Badge> : undefined}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="名称" required>
                    <Input autoFocus value={detail.name} onChange={(e) => set('name', e.target.value)} />
                  </Field>
                  <Field label="コード">
                    <Input value={detail.code ?? ''} onChange={(e) => set('code', e.target.value)} />
                  </Field>
                  <Field label="区分">
                    <Select value={detail.entity_type ?? ''} onChange={(e) => set('entity_type', e.target.value)}>
                      <option value="">—</option>
                      <option value="corporation">法人</option>
                      <option value="individual">個人</option>
                    </Select>
                  </Field>
                  <Field label="インボイス登録番号">
                    <Input value={detail.t_number ?? ''} onChange={(e) => set('t_number', e.target.value)} placeholder="T1234567890123" />
                  </Field>
                  <Field label="決算月">
                    <Input type="number" min={1} max={12} value={detail.fiscal_month ?? ''}
                      onChange={(e) => set('fiscal_month', e.target.value ? Number(e.target.value) : null)} />
                  </Field>
                  <Field label="業種">
                    <Input value={detail.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
                  </Field>
                  <Field label="会計ソフト(既定出力)">
                    <Select value={detail.export_default} onChange={(e) => set('export_default', e.target.value)}>
                      {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </Select>
                  </Field>
                  <Field label="電話">
                    <Input value={detail.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
                  </Field>
                  <Field label="住所" className="sm:col-span-2">
                    <Input value={detail.address ?? ''} onChange={(e) => set('address', e.target.value)} />
                  </Field>
                  <Field label="先方担当者">
                    <Input value={detail.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} />
                  </Field>
                  <Field label="メモ" className="sm:col-span-2">
                    <Textarea rows={2} value={detail.memo ?? ''} onChange={(e) => set('memo', e.target.value)} />
                  </Field>
                </div>
                <div className="mt-5 flex gap-2">
                  <Button variant="primary" onClick={() => void save()}>
                    <Icon.Check /> {creating ? '登録' : '保存'}
                  </Button>
                  {creating && <Button onClick={cancel}>キャンセル</Button>}
                </div>
              </Section>

              {creating ? (
                <Card>
                  <div className="flex items-center gap-2 px-5 py-4 text-sm text-slate-400">
                    <Icon.User /> 利用者は顧問先の登録後に追加できます。
                  </div>
                </Card>
              ) : (
                <Section
                  title="利用者"
                  description="PCで確認する人はログインID(メール)+パスワードを設定。アプリのみ使う人はQRで連携します。"
                  actions={<Button variant="primary" size="sm" onClick={() => setUserModal({ mode: 'add' })}><Icon.Plus /> 利用者を追加</Button>}
                  bodyClassName="p-0"
                >
                  <Table>
                    <Thead>
                      <tr>
                        <Th>氏名</Th>
                        <Th>ログインID</Th>
                        <Th className="w-36">役割</Th>
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
                          <Td className="text-slate-600">
                            {u.login_id || <span className="text-slate-400">アプリ専用</span>}
                          </Td>
                          <Td>
                            <Select value={u.role} className="h-8 text-xs"
                              onChange={async (e) => {
                                if (await toast.run(() => api.setClientUserRole(detail.id, u.user_id, e.target.value), '役割を変更しました'))
                                  await reloadUsers()
                              }}>
                              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </Select>
                          </Td>
                          <Td>
                            {u.status === 'disabled'
                              ? <Badge tone="danger">無効</Badge>
                              : <Badge tone="success">有効</Badge>}
                          </Td>
                          <Td className="text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <IconButton label="QR発行" onClick={() => void issueQr(u)}><Icon.Qr /></IconButton>
                              <IconButton label="編集" onClick={() => setUserModal({ mode: 'edit', user: u })}><Icon.Pencil /></IconButton>
                              <Button size="sm" variant="ghost" onClick={() => void toggleStatus(u)}>
                                {u.status === 'disabled' ? '有効化' : '無効化'}
                              </Button>
                              <IconButton label="削除" className="hover:!text-red-600" onClick={() => void removeUser(u)}><Icon.Trash /></IconButton>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                      {users.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">利用者がいません</td></tr>
                      )}
                    </Tbody>
                  </Table>
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      {detail && userModal && (
        <UserModal
          clientId={detail.id}
          modal={userModal}
          onClose={() => setUserModal(null)}
          onSaved={async () => { setUserModal(null); await reloadUsers() }}
        />
      )}

      <Modal open={!!qr} onClose={() => setQr(null)} title="ペアリングQR" size="sm"
        description={qr ? `${qr.user.name || qr.user.email} のスマホアプリで読み取ってください(15分有効)` : undefined}>
        {qr && (
          <div className="flex flex-col items-center gap-3 py-2">
            <img alt="QR" className="h-56 w-56 rounded-lg border border-slate-200" src={`data:image/png;base64,${qr.png}`} />
          </div>
        )}
      </Modal>
    </>
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
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(u?.role ?? 'client_user')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) {
      toast.error('氏名は必須です。')
      return
    }
    setBusy(true)
    try {
      if (editing && u) {
        const patch: Record<string, string> = {}
        if (name !== (u.name || '')) patch.name = name.trim()
        if (email !== (u.login_id || '')) patch.email = email.trim()
        if (phone !== (u.phone || '')) patch.phone = phone.trim()
        if (password) patch.password = password
        await api.patchClientUser(clientId, u.user_id, patch)
        toast.success('利用者を更新しました')
      } else {
        await api.createClientUser(clientId, {
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password: password || undefined,
          role,
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
    <Modal
      open
      onClose={onClose}
      title={editing ? '利用者を編集' : '利用者を追加'}
      description="PCで確認する人はログインID(メール)とパスワードを設定してください。"
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '保存中…' : editing ? '保存' : '追加'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="氏名" required className="sm:col-span-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ログインID(メール)" hint="PC利用時のみ。未設定でQR連携可。" className="sm:col-span-2">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
        </Field>
        <Field label={editing ? '新パスワード(変更時のみ)' : 'パスワード(PC利用時)'}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="電話">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {!editing && (
          <Field label="役割" className="sm:col-span-2">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  )
}
