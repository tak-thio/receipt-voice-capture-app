import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, type CardStatementLine } from '../api'
import {
  Badge, Button, Card, EmptyState, Icon, PageHeader,
  Table, Tbody, Td, Th, Thead, Tr,
} from '../ui'
import { useToast } from '../ui/toast'

const yen = (n: number | null) => (n == null ? '—' : `¥${n.toLocaleString()}`)

// クレジット明細: 専用取込(画像/PDF→AI抽出)＋各行に「領収書があるか」のチェック。
// 明細は仕訳/元帳には入らない(照合用)。
export function CardStatementsView({ clientId }: { clientId: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<CardStatementLine[]>([])
  const [missing, setMissing] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!clientId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const r = await api.cardStatements(clientId)
      setRows(r.items)
      setMissing(r.missing)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    e.target.value = ''
    if (!files || !files.length || !clientId) return
    setUploading(true)
    let ok = 0
    for (const f of Array.from(files)) {
      try {
        await api.importCardStatement(clientId, f)
        ok++
      } catch (err) {
        toast.error(`${f.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setUploading(false)
    if (ok) {
      toast.success(`${ok}件を取り込みました。解析後に明細が表示されます。`)
      window.setTimeout(() => void load(), 2500)
    }
  }

  if (!clientId) {
    return (
      <>
        <PageHeader title="クレジット明細" description="カード明細を取り込み、領収書が揃っているか確認します。" />
        <Card><EmptyState icon={<Icon.Receipt />} title="顧問先を選択してください" /></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="クレジット明細"
        description="明細を取り込み、各行に紐づく領収書があるかを確認します（明細は仕訳には入りません）。"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => void onPick(e)}
            />
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>更新</Button>
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? '取込中…' : <><Icon.Upload /> 明細を取り込む</>}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-500">全 {rows.length} 件</span>
        {missing > 0 ? (
          <Badge tone="danger">領収書なし {missing} 件</Badge>
        ) : rows.length > 0 ? (
          <Badge tone="success">すべて領収書あり</Badge>
        ) : null}
      </div>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th className="w-28">取引日</Th>
              <Th>利用先</Th>
              <Th className="w-32 text-right">金額</Th>
              <Th className="w-32">領収書</Th>
              <Th className="w-20">明細</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-sm text-slate-600">{r.date ?? '—'}</Td>
                <Td className="text-sm text-slate-800">{r.vendor || '(未解析)'}</Td>
                <Td className="text-right tabular-nums text-sm text-slate-800">{yen(r.amount_jpy)}</Td>
                <Td>
                  {r.has_receipt ? (
                    <Badge tone="success"><Icon.Check /> 領収書あり</Badge>
                  ) : (
                    <Badge tone="danger">領収書なし</Badge>
                  )}
                </Td>
                <Td>
                  {r.image_file_id && (
                    <a
                      className="text-brand-600 hover:underline"
                      href={api.fileUrl(r.image_file_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      開く
                    </a>
                  )}
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? '読み込み中…' : '明細はありません。「明細を取り込む」から取り込んでください。'}
                </td>
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>
    </>
  )
}
