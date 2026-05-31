import { useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { exportCsv } from '../api/export-api'
import { isTauriRuntime } from '../api/tauri'
import { buildExportPreview } from '../services/export/build-export-preview'
import { useSessionStore } from '../store/session-store'
import type { ExportScope, ExportTarget } from '../types/export'
import type { Session } from '../types/domain'

function filterSessionForExport(session: Session, scope: ExportScope): Session {
  if (scope === 'confirmed') {
    return {
      ...session,
      records: session.records.filter((record) => record.review.confirmedAt),
    }
  }

  if (scope === 'unconfirmed') {
    return {
      ...session,
      records: session.records.filter((record) => !record.review.confirmedAt),
    }
  }

  return session
}

export function ExportPage() {
  const session = useSessionStore((state) => state.session)
  const settings = useSessionStore((state) => state.settings)
  const [target, setTarget] = useState<ExportTarget>(settings.exportTargetDefault)
  const [scope, setScope] = useState<ExportScope>('all')
  const [lastExportMessage, setLastExportMessage] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const exportSession = useMemo(() => (session ? filterSessionForExport(session, scope) : null), [scope, session])
  const unconfirmedCount = session?.records.filter((record) => !record.review.confirmedAt).length ?? 0

  const preview = useMemo(() => {
    if (!exportSession) {
      return null
    }

    return buildExportPreview(exportSession, target)
  }, [exportSession, target])

  async function handleExport() {
    if (!exportSession || isExporting) {
      return
    }

    setIsExporting(true)

    try {
      if (isTauriRuntime()) {
        const destinationPath = await save({
          title: 'CSVの保存先を選択',
          defaultPath: resultFileName(exportSession, target),
          filters: [
            {
              name: 'CSV',
              extensions: ['csv'],
            },
          ],
        })

        if (!destinationPath) {
          setLastExportMessage('CSV書き出しをキャンセルしました。')
          return
        }

        const result = await exportCsv(exportSession, target, destinationPath)
        setLastExportMessage(result.savedTo ? `CSVを保存しました: ${result.savedTo}` : `${result.fileName} を保存しました。`)
        return
      }

      const result = await exportCsv(exportSession, target)
      const blob = new Blob([result.csvContent], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setLastExportMessage(`${result.fileName} を生成しました。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'CSV書き出しに失敗しました。')
      setLastExportMessage(message || 'CSV書き出しに失敗しました。')
    } finally {
      setIsExporting(false)
    }
  }

  function resultFileName(currentSession: Session, exportTarget: ExportTarget): string {
    return buildExportPreview(currentSession, exportTarget).fileName
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">出力</p>
          <h2>CSV出力</h2>
          <p className="muted">入力済みデータを会計ソフト取込用のCSVとして確認・書き出しします。</p>
        </div>
      </header>

      <article className="panel">
        <div className="export-toolbar">
          <label className="field narrow">
            <span>出力形式</span>
            <select value={target} onChange={(event) => setTarget(event.target.value as ExportTarget)}>
              <option value="generic">汎用CSV</option>
              <option value="mas">MJS/MAS</option>
              <option value="freee">freee</option>
              <option value="yayoi">弥生</option>
            </select>
          </label>
          <label className="field narrow">
            <span>出力対象</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as ExportScope)}>
              <option value="all">すべて</option>
              <option value="confirmed">確認済みのみ</option>
              <option value="unconfirmed">未確認のみ</option>
            </select>
          </label>
          <button className="accent-button" onClick={() => void handleExport()} disabled={!preview?.rows.length || isExporting}>
            {isExporting ? '書き出し中...' : 'CSVを書き出す'}
          </button>
        </div>
        <p className="muted small">
          {lastExportMessage ||
            (unconfirmedCount > 0
              ? `未確認レコードが ${unconfirmedCount}件あります。出力対象を選択して書き出してください。`
              : 'Tauri 実行時はネイティブ保存ダイアログ、ブラウザではダウンロードで書き出します。')}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>プレビュー</h3>
          <span className="status-chip ready">{preview?.rows.length ?? 0}件</span>
        </div>
        {preview ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {preview.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  <tr key={`${preview.target}-${rowIndex}`}>
                    {row.map((cell, columnIndex) => (
                      <td key={`${rowIndex}-${columnIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">レコードが作成されるとプレビューが表示されます。</div>
        )}
      </article>
    </section>
  )
}
