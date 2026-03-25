import { TAX_MODE_LABELS } from '../lib/constants'
import { useSessionStore } from '../store/session-store'

const editableFields = [
  { key: 'date', label: '日付' },
  { key: 'vendor', label: '支払先' },
  { key: 'amount', label: '金額' },
  { key: 'paymentMethod', label: '支払方法' },
  { key: 'descriptionRaw', label: '但書' },
  { key: 'accountCategoryCandidate', label: '勘定候補' },
  { key: 'accountCategoryFinal', label: '勘定確定' },
  { key: 'summary', label: '摘要' },
  { key: 'invoiceNumber', label: 'インボイス番号' },
  { key: 'memo', label: 'メモ' },
] as const

export function ReviewPage() {
  const session = useSessionStore((state) => state.session)
  const selectedRecordId = useSessionStore((state) => state.selectedRecordId)
  const reviewMode = useSessionStore((state) => state.reviewMode)
  const setSelectedRecordId = useSessionStore((state) => state.setSelectedRecordId)
  const setReviewMode = useSessionStore((state) => state.setReviewMode)
  const updateFinalField = useSessionStore((state) => state.updateFinalField)
  const deleteRecord = useSessionStore((state) => state.deleteRecord)

  const selectedRecord =
    session?.records.find((record) => record.id === selectedRecordId) ?? session?.records[0] ?? null

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 1</p>
          <h2>Review / Edit</h2>
          <p className="muted">表編集モードと詳細確認モードを切り替えながら、`final` ブロックにユーザー修正を反映します。</p>
        </div>
        <div className="header-actions">
          <button className={`ghost-button${reviewMode === 'table' ? ' selected' : ''}`} onClick={() => setReviewMode('table')}>
            表編集
          </button>
          <button className={`ghost-button${reviewMode === 'detail' ? ' selected' : ''}`} onClick={() => setReviewMode('detail')}>
            詳細確認
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              if (selectedRecord) {
                void deleteRecord(selectedRecord.id)
              }
            }}
            disabled={!selectedRecord}
          >
            レコード削除
          </button>
        </div>
      </header>

      <div className="review-grid">
        <article className="panel">
          <div className="panel-title-row">
            <h3>Record List</h3>
            <span className="status-chip ready">{session?.records.length ?? 0} rows</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>支払先</th>
                  <th>金額</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {session?.records.map((record) => (
                  <tr key={record.id} onClick={() => setSelectedRecordId(record.id)}>
                    <td>{record.final.vendor || '未入力'}</td>
                    <td>{record.final.amount?.toLocaleString('ja-JP') ?? '未入力'}</td>
                    <td>{record.review.matchStatus}</td>
                  </tr>
                ))}
                {!session?.records.length && (
                  <tr>
                    <td colSpan={3} className="empty-cell">
                      Capture 画面でレコードを作成するとここに表示されます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-title-row">
            <h3>{reviewMode === 'table' ? 'Quick Edit' : 'Detail View'}</h3>
            <span className={`status-chip ${selectedRecord?.review.matchStatus ?? 'warning'}`}>
              {selectedRecord?.review.matchStatus ?? 'waiting'}
            </span>
          </div>
          {selectedRecord ? (
            <>
              <img src={selectedRecord.imagePath} alt="Receipt capture" className="capture-preview compact" />
              <div className="field-grid">
                <label className="field">
                  <span>税区分</span>
                  <select
                    value={selectedRecord.final.taxMode}
                    onChange={(event) =>
                      void updateFinalField(
                        selectedRecord.id,
                        'taxMode',
                        event.target.value as typeof selectedRecord.final.taxMode,
                      )
                    }
                  >
                    <option value="inclusive">税込</option>
                    <option value="exclusive">税抜</option>
                    <option value="unknown">未指定</option>
                  </select>
                </label>
                {editableFields.map((field) => (
                  <label key={field.key} className="field">
                    <span>{field.label}</span>
                    <input
                      value={
                        field.key === 'amount'
                          ? String(selectedRecord.final.amount ?? '')
                          : String(selectedRecord.final[field.key] ?? '')
                      }
                      onChange={(event) =>
                        void updateFinalField(
                          selectedRecord.id,
                          field.key,
                          field.key === 'amount'
                            ? (event.target.value ? Number(event.target.value) : null)
                            : event.target.value,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="detail-columns">
                <div>
                  <h4>STT</h4>
                  <p>{selectedRecord.stt.rawText}</p>
                  <p className="muted small">tokens: {selectedRecord.stt.tokens.join(' / ')}</p>
                </div>
                <div>
                  <h4>OCR</h4>
                  <p>{selectedRecord.ocr.rawText || '未取得'}</p>
                  <p className="muted small">
                    dates: {selectedRecord.ocr.extractedCandidates.dates.join(', ') || 'none'}
                  </p>
                </div>
                <div>
                  <h4>Review</h4>
                  <p>{selectedRecord.review.mismatchReasons.join(' / ') || '一致しています。'}</p>
                  <p className="muted small">
                    manual edits: {selectedRecord.final.manualEditedFields.join(', ') || 'none'}
                  </p>
                  <p className="muted small">tax label: {TAX_MODE_LABELS[selectedRecord.final.taxMode]}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">編集対象のレコードがありません。</div>
          )}
        </article>
      </div>
    </section>
  )
}
