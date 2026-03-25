import { useMemo, useState } from 'react'
import { exportCsv } from '../api/export-api'
import { buildExportPreview } from '../services/export/build-export-preview'
import { useSessionStore } from '../store/session-store'
import type { ExportTarget } from '../types/export'

export function ExportPage() {
  const session = useSessionStore((state) => state.session)
  const [target, setTarget] = useState<ExportTarget>('generic')
  const [lastExportMessage, setLastExportMessage] = useState('')

  const preview = useMemo(() => {
    if (!session) {
      return null
    }

    return buildExportPreview(session, target)
  }, [session, target])

  async function handleExport() {
    if (!session) {
      return
    }

    const result = await exportCsv(session, target)
    const blob = new Blob([result.csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.fileName
    anchor.click()
    URL.revokeObjectURL(url)
    setLastExportMessage(`${result.fileName} を生成しました。`)
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 1</p>
          <h2>Export Preview</h2>
          <p className="muted">内部共通モデルから CSV プレビューを生成し、formatter 差し替え前提で freee / 弥生 / 汎用を見比べられます。</p>
        </div>
      </header>

      <article className="panel">
        <div className="export-toolbar">
          <label className="field narrow">
            <span>出力形式</span>
            <select value={target} onChange={(event) => setTarget(event.target.value as ExportTarget)}>
              <option value="generic">汎用CSV</option>
              <option value="freee">freee</option>
              <option value="yayoi">弥生</option>
            </select>
          </label>
          <button className="accent-button" onClick={() => void handleExport()} disabled={!session?.records.length}>
            CSVを書き出す
          </button>
        </div>
        <p className="muted small">{lastExportMessage || '保存先ダイアログは Tauri 実接続時に backend command に寄せます。'}</p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>Preview</h3>
          <span className="status-chip ready">{preview?.rows.length ?? 0} rows</span>
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
