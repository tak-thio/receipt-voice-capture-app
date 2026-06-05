import { useEffect, useState } from 'react'
import { api, type MasterRow } from '../api'
import {
  Badge, Button, Card, EmptyState, Field, Icon, IconButton, Input, Modal,
  PageHeader, Section, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

type TitleModal = { mode: 'add' } | { mode: 'edit'; row: MasterRow } | null
type PartnerModal = { mode: 'add' } | { mode: 'edit'; row: MasterRow } | null

export function MastersView({ clientId, firmId }: { clientId: string; firmId: string }) {
  const toast = useToast()
  const [titles, setTitles] = useState<MasterRow[]>([])
  const [partners, setPartners] = useState<MasterRow[]>([])
  const [titleModal, setTitleModal] = useState<TitleModal>(null)
  const [partnerModal, setPartnerModal] = useState<PartnerModal>(null)

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
      <PageHeader title="マスタ" description="勘定科目(テンプレ＋顧問先上書き)と取引先を管理します。" />

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          title="勘定科目"
          description="事務所テンプレートに顧問先固有の科目を上書き・追加できます。"
          actions={<Button variant="primary" size="sm" onClick={() => setTitleModal({ mode: 'add' })}><Icon.Plus /> 追加</Button>}
          bodyClassName="p-0"
        >
          <Table>
            <Thead>
              <tr>
                <Th className="w-24">コード</Th>
                <Th>科目名</Th>
                <Th className="w-24">区分</Th>
                <Th className="w-px text-right">操作</Th>
              </tr>
            </Thead>
            <Tbody>
              {titles.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-mono text-xs text-slate-500">{t.code}</Td>
                  <Td className="font-medium text-slate-800">{t.name}</Td>
                  <Td>{t.scope === 'client' ? <Badge tone="brand">顧問先</Badge> : <Badge>テンプレ</Badge>}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton label="編集" onClick={() => setTitleModal({ mode: 'edit', row: t })}><Icon.Pencil /></IconButton>
                      <IconButton label="削除" className="hover:!text-red-600" onClick={() => void delTitle(t)}><Icon.Trash /></IconButton>
                    </div>
                  </Td>
                </Tr>
              ))}
              {titles.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">勘定科目がありません</td></tr>
              )}
            </Tbody>
          </Table>
        </Section>

        <Section
          title="取引先"
          actions={<Button variant="primary" size="sm" onClick={() => setPartnerModal({ mode: 'add' })}><Icon.Plus /> 追加</Button>}
          bodyClassName="p-0"
        >
          <Table>
            <Thead>
              <tr>
                <Th>取引先名</Th>
                <Th className="w-48">ドメイン</Th>
                <Th className="w-px text-right">操作</Th>
              </tr>
            </Thead>
            <Tbody>
              {partners.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-slate-800">{p.name}</Td>
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
                <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">取引先がありません</td></tr>
              )}
            </Tbody>
          </Table>
        </Section>
      </div>

      {titleModal && (
        <TitleEditor firmId={firmId} clientId={clientId} modal={titleModal}
          onClose={() => setTitleModal(null)} onSaved={async () => { setTitleModal(null); await load() }} />
      )}
      {partnerModal && (
        <PartnerEditor firmId={firmId} clientId={clientId} modal={partnerModal}
          onClose={() => setPartnerModal(null)} onSaved={async () => { setPartnerModal(null); await load() }} />
      )}
    </>
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
  const [domain, setDomain] = useState(editing ? modal.row.domain ?? '' : '')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) {
      toast.error('取引先名は必須です。')
      return
    }
    setBusy(true)
    const ok = await toast.run(async () => {
      if (editing) await api.patchPartner(modal.row.id, { name: name.trim(), domain: domain.trim() || undefined })
      else await api.createPartner({ firm_id: firmId, client_id: clientId, name: name.trim(), domain: domain.trim() || undefined })
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
        <Field label="ドメイン" hint="メール取込時の自動引当に使用します。"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.co.jp" /></Field>
      </div>
    </Modal>
  )
}
