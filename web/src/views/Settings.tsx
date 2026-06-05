import { useEffect, useState } from 'react'
import { api, type ClientRow, type FirmInfo, type MemberRow } from '../api'
import {
  Button, Field, Icon, Input, Modal, PageHeader, Section,
  Select, Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const PROVIDERS: Record<string, string[]> = {
  stt: ['openai', 'gemini', 'whisper', 'mock'],
  ocr: ['ollama', 'openai', 'gemini', 'mock'],
  format: ['ollama', 'openai', 'gemini', 'mock'],
}
const CAP_LABEL: Record<string, string> = { stt: '音声(STT)', ocr: '画像(OCR)', format: '整形' }
const SELF_HOSTED = new Set(['ollama', 'whisper', 'mock'])

type Cap = { provider: string; key: string; model: string }

export function SettingsView({ firmId }: { firmId: string }) {
  const toast = useToast()
  const [firm, setFirm] = useState<FirmInfo | null>(null)
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<Record<string, Cap>>({})
  const [members, setMembers] = useState<MemberRow[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [assignFor, setAssignFor] = useState<MemberRow | null>(null)
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [invite, setInvite] = useState<string | null>(null)
  void firmId

  async function load() {
    const f = await api.firm()
    setFirm(f)
    setName(f.name)
    const next: Record<string, Cap> = {}
    for (const cap of Object.keys(PROVIDERS)) {
      const c = f.ai_config[cap]
      next[cap] = { provider: c?.provider ?? 'mock', key: '', model: c?.model ?? '' }
    }
    setCaps(next)
    setMembers(await api.members())
    setClients(await api.clients())
  }
  useEffect(() => {
    load().catch((e) => toast.error(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openAssign(m: MemberRow) {
    const { client_ids } = await api.assignedClients(m.user_id)
    setAssigned(new Set(client_ids))
    setAssignFor(m)
  }
  async function toggleAssign(clientId: string) {
    if (!assignFor) return
    const next = new Set(assigned)
    if (next.has(clientId)) next.delete(clientId)
    else next.add(clientId)
    setAssigned(next)
    await toast.run(() => api.setAssignedClients(assignFor.user_id, [...next]))
  }

  async function saveName() {
    await toast.run(() => api.patchFirm(name), '事務所名を保存しました')
  }
  async function saveAi() {
    const body: Record<string, { provider: string; key?: string; model?: string }> = {}
    for (const [cap, c] of Object.entries(caps)) {
      body[cap] = { provider: c.provider }
      if (c.key) body[cap].key = c.key
      if (c.model) body[cap].model = c.model
    }
    if (await toast.run(() => api.setAiConfig(body), 'AI設定を保存しました')) await load()
  }
  async function inviteStaff() {
    try {
      const r = await api.createInvite({ role: 'firm_staff' })
      setInvite(`${window.location.origin}${r.redeem_path}`)
    } catch (e) {
      toast.error(String(e))
    }
  }
  function updateCap(cap: string, patch: Partial<Cap>) {
    setCaps((prev) => ({ ...prev, [cap]: { ...prev[cap], ...patch } }))
  }

  if (!firm) return <p className="text-slate-400">読み込み中…</p>

  return (
    <>
      <PageHeader title="設定" description="事務所・AIプロバイダ・職員を管理します。" />

      <div className="mx-auto max-w-4xl space-y-5">
        <Section title="事務所">
          <div className="flex items-end gap-2">
            <Field label="事務所名" className="flex-1">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => void saveName()}>保存</Button>
          </div>
        </Section>

        <Section
          title="AIプロバイダ"
          description="費用は事務所負担。ollama / whisper / mock は自前(キー不要)、openai / gemini はキーを暗号化保存します。"
          actions={<Button variant="primary" size="sm" onClick={() => void saveAi()}>AI設定を保存</Button>}
        >
          <div className="space-y-3">
            <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:grid">
              <span className="col-span-2">能力</span>
              <span className="col-span-3">プロバイダ</span>
              <span className="col-span-3">モデル</span>
              <span className="col-span-4">APIキー</span>
            </div>
            {Object.keys(PROVIDERS).map((cap) => {
              const c = caps[cap]
              const needsKey = c && !SELF_HOSTED.has(c.provider)
              const keySet = firm.ai_config[cap]?.key_set
              return (
                <div key={cap} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-12">
                  <span className="text-sm font-medium text-slate-600 sm:col-span-2">{CAP_LABEL[cap]}</span>
                  <div className="sm:col-span-3">
                    <Select value={c?.provider} onChange={(e) => updateCap(cap, { provider: e.target.value })}>
                      {PROVIDERS[cap].map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-3">
                    <Input placeholder="モデル(任意)" value={c?.model} onChange={(e) => updateCap(cap, { model: e.target.value })} />
                  </div>
                  <div className="sm:col-span-4">
                    <Input type="password" disabled={!needsKey}
                      placeholder={needsKey ? (keySet ? '設定済み(変更時のみ入力)' : 'APIキー') : 'キー不要'}
                      value={c?.key} onChange={(e) => updateCap(cap, { key: e.target.value })} />
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section
          title="職員"
          description="職員のロールと担当顧問先を管理します。"
          actions={<Button size="sm" onClick={() => void inviteStaff()}><Icon.Link /> 職員を招待</Button>}
          bodyClassName="p-0"
        >
          <Table>
            <Thead>
              <tr>
                <Th>職員</Th>
                <Th className="w-40">ロール</Th>
                <Th className="w-px text-right">操作</Th>
              </tr>
            </Thead>
            <Tbody>
              {members.map((m) => (
                <Tr key={m.user_id}>
                  <Td>
                    <div className="font-medium text-slate-800">{m.name || m.email}</div>
                    {m.name && <div className="text-xs text-slate-400">{m.email}</div>}
                  </Td>
                  <Td>
                    <Select value={m.role} className="h-8 text-xs"
                      onChange={async (e) => { if (await toast.run(() => api.setMemberRole(m.user_id, e.target.value), 'ロールを変更しました')) await load() }}>
                      <option value="firm_owner">管理者</option>
                      <option value="firm_staff">一般社員</option>
                    </Select>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {m.role === 'firm_staff' && (
                        <Button size="sm" variant="secondary" onClick={() => void openAssign(m)}>
                          <Icon.Building /> 担当顧問先
                        </Button>
                      )}
                      <IconBtnDelete onClick={async () => {
                        if (!window.confirm(`${m.name || m.email} を削除しますか?`)) return
                        if (await toast.run(() => api.removeMember(m.user_id), '職員を削除しました')) await load()
                      }} />
                    </div>
                  </Td>
                </Tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">職員がいません</td></tr>
              )}
            </Tbody>
          </Table>
        </Section>
      </div>

      {/* 担当顧問先 assignment */}
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="担当顧問先の割当"
        description={assignFor ? `${assignFor.name || assignFor.email} が担当する顧問先(チェックで即時保存)` : undefined}
        footer={<Button variant="primary" onClick={() => setAssignFor(null)}>完了</Button>}>
        <div className="space-y-1">
          {clients.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={assigned.has(c.id)} onChange={() => void toggleAssign(c.id)} />
              <span className="text-sm text-slate-700">{c.name}</span>
            </label>
          ))}
          {clients.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">顧問先がありません</p>}
        </div>
      </Modal>

      {/* invite link */}
      <Modal open={!!invite} onClose={() => setInvite(null)} title="職員の招待リンク" size="sm"
        description="72時間有効。このリンクを職員に共有してください。"
        footer={<>
          <Button onClick={() => { if (invite) void navigator.clipboard?.writeText(invite).then(() => toast.success('コピーしました')) }}>
            <Icon.Link /> コピー
          </Button>
          <Button variant="primary" onClick={() => setInvite(null)}>閉じる</Button>
        </>}>
        <div className="break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-700">
          {invite}
        </div>
      </Modal>
    </>
  )
}

function IconBtnDelete({ onClick }: { onClick: () => void }) {
  return (
    <button title="削除" aria-label="削除" onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600">
      <Icon.Trash />
    </button>
  )
}
