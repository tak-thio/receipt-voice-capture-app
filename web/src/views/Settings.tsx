import { useEffect, useState } from 'react'
import { api, type FirmInfo, type MemberRow } from '../api'

const PROVIDERS: Record<string, string[]> = {
  stt: ['openai', 'gemini', 'whisper', 'mock'],
  ocr: ['ollama', 'openai', 'gemini', 'mock'],
  format: ['ollama', 'openai', 'gemini', 'mock'],
}
const CAP_LABEL: Record<string, string> = { stt: '音声(STT)', ocr: '画像(OCR)', format: '整形' }
const SELF_HOSTED = new Set(['ollama', 'whisper', 'mock'])

type Cap = { provider: string; key: string; model: string }

export function SettingsView({ firmId }: { firmId: string }) {
  const [firm, setFirm] = useState<FirmInfo | null>(null)
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<Record<string, Cap>>({})
  const [members, setMembers] = useState<MemberRow[]>([])
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState('')

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
  }
  useEffect(() => {
    load().catch((e) => setMsg(String(e)))
  }, [])

  async function saveName() {
    await api.patchFirm(name)
    setMsg('事務所名を保存しました。')
  }

  async function saveAi() {
    const body: Record<string, { provider: string; key?: string; model?: string }> = {}
    for (const [cap, c] of Object.entries(caps)) {
      body[cap] = { provider: c.provider }
      if (c.key) body[cap].key = c.key
      if (c.model) body[cap].model = c.model
    }
    await api.setAiConfig(body)
    setMsg('AI設定を保存しました。')
    await load()
  }

  async function inviteStaff() {
    const r = await api.createInvite({ role: 'firm_staff' })
    setInvite(`${window.location.origin}${r.redeem_path}`)
  }

  function updateCap(cap: string, patch: Partial<Cap>) {
    setCaps((prev) => ({ ...prev, [cap]: { ...prev[cap], ...patch } }))
  }

  if (!firm) return <p className="text-stone-400">読み込み中...</p>
  void firmId

  return (
    <div className="max-w-3xl space-y-6">
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-3 font-semibold">事務所設定</h3>
        <div className="flex items-center gap-2">
          <input className="flex-1 rounded-lg border px-3 py-1.5 text-sm" value={name}
            onChange={(e) => setName(e.target.value)} />
          <button className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm text-white" onClick={() => void saveName()}>
            保存
          </button>
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <h3 className="mb-1 font-semibold">AIプロバイダ(事務所負担)</h3>
        <p className="mb-3 text-xs text-stone-500">
          能力ごとに選択。ollama/whisper/mock は自前(キー不要)、openai/gemini はキーを保存(暗号化)。
        </p>
        <div className="space-y-3">
          {Object.keys(PROVIDERS).map((cap) => {
            const c = caps[cap]
            const needsKey = c && !SELF_HOSTED.has(c.provider)
            const keySet = firm.ai_config[cap]?.key_set
            return (
              <div key={cap} className="grid grid-cols-12 items-center gap-2">
                <span className="col-span-2 text-sm text-stone-600">{CAP_LABEL[cap]}</span>
                <select className="col-span-3 rounded-lg border px-2 py-1.5 text-sm" value={c?.provider}
                  onChange={(e) => updateCap(cap, { provider: e.target.value })}>
                  {PROVIDERS[cap].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input className="col-span-3 rounded-lg border px-2 py-1.5 text-sm" placeholder="model(任意)"
                  value={c?.model} onChange={(e) => updateCap(cap, { model: e.target.value })} />
                <input className="col-span-4 rounded-lg border px-2 py-1.5 text-sm" type="password"
                  placeholder={needsKey ? (keySet ? '設定済み(変更時のみ入力)' : 'APIキー') : 'キー不要'}
                  disabled={!needsKey}
                  value={c?.key} onChange={(e) => updateCap(cap, { key: e.target.value })} />
              </div>
            )
          })}
        </div>
        <button className="mt-3 rounded-lg bg-stone-800 px-4 py-1.5 text-sm text-white" onClick={() => void saveAi()}>
          AI設定を保存
        </button>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">職員</h3>
          <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-stone-100" onClick={() => void inviteStaff()}>
            職員を招待
          </button>
        </div>
        {invite && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-2 text-xs">
            招待リンク(72時間有効・共有してください):<br />
            <span className="break-all font-mono">{invite}</span>
          </div>
        )}
        <ul className="divide-y text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between py-2">
              <span>{m.email} <span className="text-stone-400">{m.name}</span></span>
              <div className="flex items-center gap-2">
                <select className="rounded border px-2 py-1 text-sm" value={m.role}
                  onChange={async (e) => { await api.setMemberRole(m.user_id, e.target.value); await load() }}>
                  <option value="firm_owner">オーナー</option>
                  <option value="firm_staff">職員</option>
                </select>
                <button className="text-xs text-red-600 hover:underline"
                  onClick={async () => { await api.removeMember(m.user_id); await load() }}>
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
