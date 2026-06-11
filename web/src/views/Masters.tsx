import { useEffect, useState } from 'react'
import { api, type MasterRow, type NoteRow, type SubAccountRow } from '../api'
import {
  Badge, Button, Card, cn, EmptyState, Field, Icon, IconButton, Input, Modal,
  PageHeader, Section, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { NOTE_COLOR_KEYS, NOTE_COLORS, NoteChip } from '../notes'
import { useToast } from '../ui/toast'

type TitleModal = { mode: 'add' } | { mode: 'edit'; row: MasterRow } | null
type PartnerModal = { mode: 'add' } | { mode: 'edit'; row: MasterRow } | null

export function MastersView({ clientId, firmId }: { clientId: string; firmId: string }) {
  const toast = useToast()
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [titleModal, setTitleModal] = useState<TitleModal>(null)
  const [partnerModal, setPartnerModal] = useState<PartnerModal>(null)
  const [subFor, setSubFor] = useState<MasterRow | null>(null)

  async function load() {
    if (!clientId) return
    setTitles(await api.accountTitles(clientId))
    setPartners(await api.partners(clientId))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function delTitle(t: MasterRow) {
    if (!window.confirm(`勘定科目「${t.name}」を削除しますか?`)) return
    if (await toast.run(() => api.deleteAccountTitle(t.id), '勘定科目を削除しました')) await load()
  }
  async function togglePin(t: MasterRow, side: 'debit' | 'credit') {
    const patch =
      side === 'debit' ? { pinned_debit: !t.pinned_debit } : { pinned_credit: !t.pinned_credit }
    if (await toast.run(() => api.patchAccountTitle(t.id, patch))) await load()
  }
  async function delPartner(p: MasterRow) {
    if (!window.confirm(`取引先「${p.name}」を削除しますか?`)) return
    if (await toast.run(() => api.deletePartner(p.id), '取引先を削除しました')) await load()
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="マスタ" description="勘定科目・取引先を管理します。" />
        <Card><EmptyState icon={<Icon.Database />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="マスタ" description="勘定科目・補助科目・取引先を管理します。" />

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          title="勘定科目"
          description="新規顧問先には標準チャートが複製されます。科目ごとに補助科目を設定できます。"
          actions={<Button variant="primary" size="sm" onClick={() => setTitleModal({ mode: 'add' })}><Icon.Plus /> 追加</Button>}
          bodyClassName="p-0"
        >
          <Table>
            <Thead>
              <tr>
                <Th className="w-20">コード</Th>
                <Th>科目名</Th>
                <Th className="w-36">よく使う</Th>
                <Th className="w-28">補助科目</Th>
                <Th className="w-px text-right">操作</Th>
              </tr>
            </Thead>
            <Tbody>
              {titles.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-mono text-xs text-slate-500">{t.code}</Td>
                  <Td className="font-medium text-slate-800">
                    {t.name}
                    {t.scope !== 'client' && <Badge className="ml-2">テンプレ</Badge>}
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="sm" variant={t.pinned_debit ? 'primary' : 'ghost'} onClick={() => void togglePin(t, 'debit')}>
                        {t.pinned_debit ? '★借方' : '借方'}
                      </Button>
                      <Button size="sm" variant={t.pinned_credit ? 'primary' : 'ghost'} onClick={() => void togglePin(t, 'credit')}>
                        {t.pinned_credit ? '★貸方' : '貸方'}
                      </Button>
                    </div>
                  </Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => setSubFor(t)}>
                      補助科目{t.sub_account_count ? ` ${t.sub_account_count}` : ''}
                    </Button>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton label="編集" onClick={() => setTitleModal({ mode: 'edit', row: t })}><Icon.Pencil /></IconButton>
                      <IconButton label="削除" className="hover:!text-red-600" onClick={() => void delTitle(t)}><Icon.Trash /></IconButton>
                    </div>
                  </Td>
                </Tr>
              ))}
              {titles.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">勘定科目がありません</td></tr>
              )}
            </Tbody>
          </Table>
        </Section>

        <div className="space-y-5">
        <Section
          title="取引先"
          actions={<Button variant="primary" size="sm" onClick={() => setPartnerModal({ mode: 'add' })}><Icon.Plus /> 追加</Button>}
          bodyClassName="p-0"
        >
          <Table>
            <Thead>
              <tr>
                <Th className="w-24">取引先ID</Th>
                <Th>取引先名</Th>
                <Th className="w-40">T番号</Th>
                <Th className="w-40">ドメイン</Th>
                <Th className="w-px text-right">操作</Th>
              </tr>
            </Thead>
            <Tbody>
              {partners.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs text-slate-500">{p.code || '—'}</Td>
                  <Td className="font-medium text-slate-800">{p.name}</Td>
                  <Td className="font-mono text-xs text-slate-500">{p.t_number || <span className="text-slate-300">—</span>}</Td>
                  <Td className="text-slate-500">{p.domain ?? <span className="text-slate-300">—</span>}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton label="編集" onClick={() => setPartnerModal({ mode: 'edit', row: p })}><Icon.Pencil /></IconButton>
                      <IconButton label="削除" className="hover:!text-red-600" onClick={() => void delPartner(p)}><Icon.Trash /></IconButton>
                    </div>
                  </Td>
                </Tr>
              ))}
              {partners.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">取引先がありません</td></tr>
              )}
            </Tbody>
          </Table>
        </Section>
        <NotesSection clientId={clientId} firmId={firmId} />
        </div>
      </div>

      {titleModal && (
        <TitleEditor firmId={firmId} clientId={clientId} modal={titleModal}
          onClose={() => setTitleModal(null)} onSaved={async () => { setTitleModal(null); await load() }} />
      )}
      {partnerModal && (
        <PartnerEditor firmId={firmId} clientId={clientId} modal={partnerModal}
          onClose={() => setPartnerModal(null)} onSaved={async () => { setPartnerModal(null); await load() }} />
      )}
      {subFor && (
        <SubAccountsModal title={subFor}
          onClose={() => setSubFor(null)}
          onChanged={load} />
      )}
    </>
  )
}

function SubAccountsModal({
  title, onClose, onChanged,
}: {
  title: MasterRow
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const toast = useToast()
  const [rows, setRows] = useState<SubAccountRow[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ code: '', name: '' })
  const [busy, setBusy] = useState(false)

  async function reload() {
    setRows(await api.subAccounts(title.id).catch(() => []))
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title.id])

  async function add() {
    if (!code.trim() || !name.trim()) { toast.error('コードと補助科目名は必須です。'); return }
    setBusy(true)
    const ok = await toast.run(() => api.createSubAccount(title.id, { code: code.trim(), name: name.trim() }), '補助科目を追加しました')
    setBusy(false)
    if (ok) { setCode(''); setName(''); await reload(); await onChanged() }
  }
  async function save(id: string) {
    if (await toast.run(() => api.patchSubAccount(id, { code: edit.code.trim(), name: edit.name.trim() }), '補助科目を更新しました')) {
      setEditId(null); await reload()
    }
  }
  async function del(s: SubAccountRow) {
    if (!window.confirm(`補助科目「${s.name}」を削除しますか?`)) return
    if (await toast.run(() => api.deleteSubAccount(s.id), '補助科目を削除しました')) { await reload(); await onChanged() }
  }

  return (
    <Modal open onClose={onClose}
      title="補助科目"
      description={`${title.code ? `${title.code} ` : ''}${title.name} の補助科目`}
      footer={<Button variant="primary" onClick={onClose}>閉じる</Button>}>
      <div className="mb-3 flex items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <Field label="コード" className="w-24"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="001" /></Field>
        <Field label="補助科目名" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="みずほ銀行" onKeyDown={(e) => e.key === 'Enter' && void add()} /></Field>
        <Button variant="primary" disabled={busy} onClick={() => void add()}><Icon.Plus /> 追加</Button>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((s) => (
          <li key={s.id} className="py-2">
            {editId === s.id ? (
              <div className="flex items-center gap-2">
                <Input className="w-24" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
                <Input className="flex-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <Button size="sm" variant="primary" onClick={() => void save(s.id)}>保存</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>取消</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-16 font-mono text-xs text-slate-500">{s.code}</span>
                <span className="flex-1 text-sm text-slate-800">{s.name}</span>
                <IconButton label="編集" onClick={() => { setEditId(s.id); setEdit({ code: s.code ?? '', name: s.name }) }}><Icon.Pencil /></IconButton>
                <IconButton label="削除" className="hover:!text-red-600" onClick={() => void del(s)}><Icon.Trash /></IconButton>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-400">補助科目がありません</li>}
      </ul>
    </Modal>
  )
}

function TitleEditor({
  firmId, clientId, modal, onClose, onSaved,
}: {
  firmId: string; clientId: string
  modal: { mode: 'add' } | { mode: 'edit'; row: MasterRow }
  onClose: () => void; onSaved: () => void | Promise<void>
}) {
  const toast = useToast()
  const editing = modal.mode === 'edit'
  const [code, setCode] = useState(editing ? modal.row.code ?? '' : '')
  const [name, setName] = useState(editing ? modal.row.name : '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!code.trim() || !name.trim()) {
      toast.error('コードと科目名は必須です。')
      return
    }
    setBusy(true)
    const ok = await toast.run(async () => {
      if (editing) await api.patchAccountTitle(modal.row.id, { code: code.trim(), name: name.trim() })
      else await api.createAccountTitle({ firm_id: firmId, client_id: clientId, code: code.trim(), name: name.trim() })
    }, editing ? '勘定科目を更新しました' : '勘定科目を追加しました')
    setBusy(false)
    if (ok) await onSaved()
  }

  return (
    <Modal open onClose={onClose} title={editing ? '勘定科目を編集' : '勘定科目を追加'} size="sm"
      footer={<>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>{editing ? '保存' : '追加'}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="コード" required><Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="758" /></Field>
        <Field label="科目名" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="旅費交通費" /></Field>
      </div>
    </Modal>
  )
}

function PartnerEditor({
  firmId, clientId, modal, onClose, onSaved,
}: {
  firmId: string; clientId: string
  modal: { mode: 'add' } | { mode: 'edit'; row: MasterRow }
  onClose: () => void; onSaved: () => void | Promise<void>
}) {
  const toast = useToast()
  const editing = modal.mode === 'edit'
  const [name, setName] = useState(editing ? modal.row.name : '')
  const [code, setCode] = useState(editing ? modal.row.code ?? '' : '')
  const [tNumber, setTNumber] = useState(editing ? modal.row.t_number ?? '' : '')
  const [domain, setDomain] = useState(editing ? modal.row.domain ?? '' : '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) {
      toast.error('取引先名は必須です。')
      return
    }
    setBusy(true)
    const ok = await toast.run(async () => {
      if (editing) await api.patchPartner(modal.row.id, { name: name.trim(), code: code.trim(), t_number: tNumber.trim(), domain: domain.trim() || undefined })
      else await api.createPartner({ firm_id: firmId, client_id: clientId, name: name.trim(), code: code.trim() || undefined, t_number: tNumber.trim() || undefined, domain: domain.trim() || undefined })
    }, editing ? '取引先を更新しました' : '取引先を追加しました')
    setBusy(false)
    if (ok) await onSaved()
  }

  return (
    <Modal open onClose={onClose} title={editing ? '取引先を編集' : '取引先を追加'} size="sm"
      footer={<>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>{editing ? '保存' : '追加'}</Button>
      </>}>
      <div className="space-y-4">
        <Field label="取引先名" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="取引先ID" hint="会計ソフトの取引先コード等。任意。"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例: 1001" /></Field>
        <Field label="T番号(インボイス登録番号)" hint="領収書のT番号と完全一致したら自動で引き当てます。"><Input value={tNumber} onChange={(e) => setTNumber(e.target.value)} placeholder="T1234567890123" /></Field>
        <Field label="ドメイン" hint="メール取込時の自動引当に使用します。"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.co.jp" /></Field>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ 付箋 */

function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NOTE_COLOR_KEYS.map((k) => (
        <button key={k} type="button" title={NOTE_COLORS[k].label} onClick={() => onChange(k)}
          className={cn('h-6 w-6 rounded-full ring-2 ring-offset-1 transition',
            NOTE_COLORS[k].dot, value === k ? 'ring-slate-800' : 'ring-transparent hover:ring-slate-300')} />
      ))}
    </div>
  )
}

function NotesSection({ clientId, firmId }: { clientId: string; firmId: string }) {
  const toast = useToast()
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [text, setText] = useState('')
  const [color, setColor] = useState('amber')
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ text: '', color: 'amber' })
  const [busy, setBusy] = useState(false)

  async function load() {
    setNotes(await api.notes(clientId).catch(() => []))
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function add() {
    if (!text.trim()) { toast.error('付箋のテキストを入力してください。'); return }
    setBusy(true)
    const ok = await toast.run(() => api.createNote({ firm_id: firmId, client_id: clientId, text: text.trim(), color }), '付箋を追加しました')
    setBusy(false)
    if (ok) { setText(''); setColor('amber'); await load() }
  }
  async function save(id: string) {
    if (await toast.run(() => api.patchNote(id, { text: edit.text.trim(), color: edit.color }), '付箋を更新しました')) {
      setEditId(null); await load()
    }
  }
  async function del(n: NoteRow) {
    if (!window.confirm(`付箋「${n.text}」を削除しますか?`)) return
    if (await toast.run(() => api.deleteNote(n.id), '付箋を削除しました')) await load()
  }

  return (
    <Section title="付箋" description="「社長に確認」など、領収書に付ける目印。受信箱・仕分けで参照できます。" bodyClassName="p-4">
      <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="付箋のテキスト(例: 社長に確認)"
          onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <div className="flex items-center justify-between">
          <ColorSwatches value={color} onChange={setColor} />
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void add()}><Icon.Plus /> 追加</Button>
        </div>
      </div>
      <ul className="space-y-1.5">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg">
            {editId === n.id ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <Input value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
                <div className="flex items-center justify-between">
                  <ColorSwatches value={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} />
                  <div className="flex gap-1">
                    <Button size="sm" variant="primary" onClick={() => void save(n.id)}>保存</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>取消</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between py-1">
                <NoteChip note={n} />
                <div className="flex items-center gap-0.5">
                  <IconButton label="編集" onClick={() => { setEditId(n.id); setEdit({ text: n.text, color: n.color }) }}><Icon.Pencil /></IconButton>
                  <IconButton label="削除" className="hover:!text-red-600" onClick={() => void del(n)}><Icon.Trash /></IconButton>
                </div>
              </div>
            )}
          </li>
        ))}
        {notes.length === 0 && <li className="py-4 text-center text-sm text-slate-400">付箋がありません</li>}
      </ul>
    </Section>
  )
}
