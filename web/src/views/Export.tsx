import { useEffect, useState } from 'react'
import { api, type ExportMap, type MasterRow } from '../api'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Modal, PageHeader, Section, Select } from '../ui'
import { useToast } from '../ui/toast'

const FORMATS: { key: string; label: string; hint: string }[] = [
  { key: 'generic', label: '汎用CSV', hint: '一般的な項目の汎用フォーマット' },
  { key: 'mas', label: 'MJS (MAS)', hint: 'ミロク MJS 向け(科目コードで取込)' },
  { key: 'freee', label: 'freee', hint: 'freee 会計 取込用' },
  { key: 'yayoi', label: '弥生会計', hint: '弥生会計 取込用' },
]

/** 勘定科目の変換辞書エディタ。
 * 取込側ソフトの科目体系(名前/コード)に合わせて出力を変換する。
 * 層構造: 顧問先の手動変更 > 事務所の標準辞書(科目テンプレート) > 自社の科目名(素通し)。
 * 「事務所の標準辞書に保存」をONにすると、同じ形式を使う全顧問先に効く標準側へ書く。 */
function ExportDictModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<MasterRow[]>([])
  const [fmt, setFmt] = useState('generic')
  const [saveTemplate, setSaveTemplate] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { name: string; code: string }>>({})
  const [busy, setBusy] = useState(false)

  async function reload() {
    setRows(await api.accountTitles(clientId))
  }
  useEffect(() => {
    // 既定の形式 = 顧問先に設定された会計システム(export_default)。
    api.client(clientId).then((c) => setFmt(c.export_default || 'generic')).catch(() => {})
    reload().catch(() => setRows([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])
  useEffect(() => {
    // 形式・保存先の層を切り替えたら、その層の現在値で下書きを作り直す。
    const d: Record<string, { name: string; code: string }> = {}
    for (const r of rows) {
      const src = saveTemplate ? r.template_export_map : r.export_map
      const m = src?.[fmt] ?? {}
      d[r.id] = { name: m.name ?? '', code: m.code ?? '' }
    }
    setDrafts(d)
  }, [fmt, rows, saveTemplate])

  // この行を変換しなかった場合の出力(標準辞書の継承値 or 素通し)をplaceholderで見せる。
  function fallbackName(r: MasterRow): string {
    if (!saveTemplate) {
      const t = r.template_export_map?.[fmt]
      if (t?.name || t?.code) return `${t.name ?? t.code}（標準辞書）`
    }
    return `${r.name}（そのまま）`
  }

  async function save() {
    setBusy(true)
    try {
      let n = 0
      for (const r of rows) {
        const d = drafts[r.id]
        if (!d) continue
        const src = (saveTemplate ? r.template_export_map : r.export_map) ?? {}
        const cur = src[fmt] ?? {}
        if ((cur.name ?? '') === d.name.trim() && (cur.code ?? '') === d.code.trim()) continue
        const targetId = saveTemplate ? r.override_of : r.id
        if (!targetId) continue // テンプレを持たない行(顧問先の独自科目)は標準保存の対象外
        const next: ExportMap = { ...src }
        if (d.name.trim() || d.code.trim()) next[fmt] = { name: d.name.trim() || null, code: d.code.trim() || null }
        else delete next[fmt]
        await api.patchAccountTitle(targetId, { export_map: next })
        n++
      }
      toast.success(n ? `${n}件の変換を保存しました${saveTemplate ? '（事務所の標準辞書）' : ''}` : '変更はありません')
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const mapped = rows.filter((r) => {
    const m = r.export_map?.[fmt] ?? r.template_export_map?.[fmt]
    return m?.name || m?.code
  }).length

  return (
    <Modal
      open size="lg" onClose={onClose} title="勘定科目の変換辞書"
      description="取込先ソフトの科目名・科目コードに変換して出力します。空欄の科目は自社の科目名をそのまま出します（一致していれば設定不要）。"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>閉じる</Button>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Select value={fmt} onChange={(e) => setFmt(e.target.value)} className="w-44">
          {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <Badge tone="neutral">変換設定 {mapped} / {rows.length} 科目</Badge>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-700" title="ONにすると顧問先ごとの変更ではなく、事務所の標準辞書(同じ形式を使う全顧問先に適用)として保存します">
          <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600" />
          事務所の標準辞書に保存
        </label>
      </div>
      <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">自社の科目</th>
              <th className="px-3 py-2">出力する科目名</th>
              <th className="w-32 px-3 py-2">出力コード</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                  <span className="mr-1 text-xs text-slate-400">{r.code}</span>{r.name}
                </td>
                <td className="px-3 py-1.5">
                  <Input value={drafts[r.id]?.name ?? ''} placeholder={fallbackName(r)}
                    onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: { ...p[r.id], name: e.target.value } }))} />
                </td>
                <td className="px-3 py-1.5">
                  <Input value={drafts[r.id]?.code ?? ''} placeholder="—"
                    onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: { ...p[r.id], code: e.target.value } }))}
                    className="tabular-nums" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

export function ExportView({ clientId }: { clientId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [dictOpen, setDictOpen] = useState(false)

  if (!clientId) {
    return (
      <>
        <PageHeader title="出力" description="仕分け済みデータをCSVで出力します。" />
        <Card><EmptyState icon={<Icon.Download />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="出力" description="仕分け済みの領収書を各種CSVで出力します。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="元帳(CSV)" description="勘定科目ごとに集計した総勘定元帳。期間を指定できます(任意)。">
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="終了日"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <a className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700"
            href={api.ledgerUrl(clientId, from || undefined, to || undefined)}>
            <Icon.Download /> 元帳CSVをダウンロード
          </a>
          <p className="mt-2 text-xs text-slate-400">科目コード / 勘定科目 / 補助科目 / 取引先 / 摘要 / 税区分 / インボイス番号 / 金額。科目ごとに小計、末尾に合計。</p>
        </Section>

        <Section title="会計ソフト向けCSV" description="お使いの会計ソフトの取込フォーマットで出力します。">
          {/* 変換辞書: 取込側の科目体系に合わせる(顧問先の変更 > 事務所の標準 > そのまま) */}
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
            <span className="text-xs text-slate-500">科目名・コードが取込先と違う場合は変換辞書で合わせられます。</span>
            <Button size="sm" variant="secondary" onClick={() => setDictOpen(true)}>
              <Icon.Database /> 科目の変換辞書…
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {FORMATS.map((f) => (
              <li key={f.key} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium text-slate-800">{f.label}</div>
                  <div className="text-xs text-slate-400">{f.hint}</div>
                </div>
                <a className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  href={api.exportUrl(clientId, f.key)}>
                  <Icon.Download /> ダウンロード
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      {dictOpen && <ExportDictModal clientId={clientId} onClose={() => setDictOpen(false)} />}
    </>
  )
}
