import { useState } from 'react'
import { api } from '../api'
import { Card, EmptyState, Field, Icon, Input, PageHeader, Section } from '../ui'

const FORMATS: { key: string; label: string; hint: string }[] = [
  { key: 'generic', label: '汎用CSV', hint: '一般的な項目の汎用フォーマット' },
  { key: 'mas', label: 'MJS (MAS)', hint: 'ミロク MJS 向け' },
  { key: 'freee', label: 'freee', hint: 'freee 会計 取込用' },
  { key: 'yayoi', label: '弥生会計', hint: '弥生会計 取込用' },
]

export function ExportView({ clientId }: { clientId: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

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
    </>
  )
}
