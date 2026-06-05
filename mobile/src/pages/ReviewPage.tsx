import { MATCH_STATUS_LABELS, TAX_MODE_LABELS } from '../lib/constants'
import { useMemo, useState } from 'react'
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

type ReviewFilter = 'priority' | 'unconfirmed' | 'confirmed' | 'all'

function isConfirmed(record: NonNullable<ReturnType<typeof useSessionStore.getState>['session']>['records'][number]): boolean {
  return Boolean(record.review.confirmedAt)
}

function sortByReviewPriority<T extends { review: { confirmedAt?: string | null; matchStatus: string }; updatedAt: string }>(
  records: T[],
): T[] {
  return [...records].sort((a, b) => {
    const aConfirmed = Boolean(a.review.confirmedAt)
    const bConfirmed = Boolean(b.review.confirmedAt)
    if (aConfirmed !== bConfirmed) {
      return aConfirmed ? 1 : -1
    }

    const score = (status: string) => (status === 'review_required' ? 0 : status === 'warning' ? 1 : 2)
    const statusDiff = score(a.review.matchStatus) - score(b.review.matchStatus)
    if (statusDiff !== 0) {
      return statusDiff
    }

    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function ReviewPage() {
  const session = useSessionStore((state) => state.session)
  const selectedRecordId = useSessionStore((state) => state.selectedRecordId)
  const reviewMode = useSessionStore((state) => state.reviewMode)
  const setSelectedRecordId = useSessionStore((state) => state.setSelectedRecordId)
  const setReviewMode = useSessionStore((state) => state.setReviewMode)
  const updateFinalField = useSessionStore((state) => state.updateFinalField)
  const markRecordConfirmed = useSessionStore((state) => state.markRecordConfirmed)
  const deleteRecord = useSessionStore((state) => state.deleteRecord)
  const [filter, setFilter] = useState<ReviewFilter>('priority')

  const visibleRecords = useMemo(() => {
    const records = session?.records ?? []
    if (filter === 'unconfirmed') {
      return sortByReviewPriority(records.filter((record) => !isConfirmed(record)))
    }
    if (filter === 'confirmed') {
      return sortByReviewPriority(records.filter(isConfirmed))
    }
    if (filter === 'all') {
      return records
    }
    return sortByReviewPriority(records)
  }, [filter, session?.records])

  const selectedRecord =
    visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null
  const selectedIndex = selectedRecord
    ? visibleRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1
  const previousRecord = selectedIndex > 0 ? visibleRecords[selectedIndex - 1] : null
  const nextRecord = selectedIndex >= 0 ? visibleRecords[selectedIndex + 1] ?? null : null
  const unconfirmedCount = session?.records.filter((record) => !isConfirmed(record)).length ?? 0

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">確認・編集</p>
          <h2>入力内容の確認</h2>
          <p className="muted">取り込んだ領収書データを確認し、必要に応じて修正します。</p>
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
            onClick={() => previousRecord && setSelectedRecordId(previousRecord.id)}
            disabled={!previousRecord}
          >
            前へ
          </button>
          <button
            className="ghost-button"
            onClick={() => nextRecord && setSelectedRecordId(nextRecord.id)}
            disabled={!nextRecord}
          >
            次へ
          </button>
          <button
            className="accent-button"
            onClick={() => {
              if (selectedRecord) {
                void markRecordConfirmed(selectedRecord.id).then(() => {
                  const nextUnconfirmed = visibleRecords.find((record) => record.id !== selectedRecord.id && !isConfirmed(record))
                  if (nextUnconfirmed) {
                    setSelectedRecordId(nextUnconfirmed.id)
                  }
                })
              }
            }}
            disabled={!selectedRecord}
          >
            確認済みにする
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
            <h3>レコード一覧</h3>
            <span className={`status-chip ${unconfirmedCount > 0 ? 'warning' : 'ready'}`}>
              未確認 {unconfirmedCount}件
            </span>
          </div>
          <div className="toolbar-group compact-top">
            <button className={`ghost-button${filter === 'priority' ? ' selected' : ''}`} onClick={() => setFilter('priority')}>
              要確認優先
            </button>
            <button className={`ghost-button${filter === 'unconfirmed' ? ' selected' : ''}`} onClick={() => setFilter('unconfirmed')}>
              未確認
            </button>
            <button className={`ghost-button${filter === 'confirmed' ? ' selected' : ''}`} onClick={() => setFilter('confirmed')}>
              確認済み
            </button>
            <button className={`ghost-button${filter === 'all' ? ' selected' : ''}`} onClick={() => setFilter('all')}>
              すべて
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>支払先</th>
                  <th>金額</th>
                  <th>状態</th>
                  <th>確認</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => (
                  <tr key={record.id} onClick={() => setSelectedRecordId(record.id)}>
                    <td>{record.final.vendor || '未入力'}</td>
                    <td>{record.final.amount?.toLocaleString('ja-JP') ?? '未入力'}</td>
                    <td>{MATCH_STATUS_LABELS[record.review.matchStatus]}</td>
                    <td>{isConfirmed(record) ? '確認済み' : '未確認'}</td>
                  </tr>
                ))}
                {!visibleRecords.length && (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      表示対象のレコードがありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-title-row">
            <h3>{reviewMode === 'table' ? 'かんたん編集' : '詳細確認'}</h3>
            <span className={`status-chip ${selectedRecord?.review.matchStatus ?? 'warning'}`}>
              {selectedRecord ? MATCH_STATUS_LABELS[selectedRecord.review.matchStatus] : '待機中'}
            </span>
          </div>
          {selectedRecord ? (
            <>
              <div className="empty-state">
                {selectedRecord.review.confirmedAt
                  ? `確認済み: ${new Date(selectedRecord.review.confirmedAt).toLocaleString('ja-JP')}`
                  : '未確認です。内容を確認したら「確認済みにする」を押してください。'}
              </div>
              {selectedRecord.review.mismatchReasons.length ? (
                <div className="empty-state">
                  {selectedRecord.review.mismatchReasons.join(' / ')}
                </div>
              ) : null}
              <img src={selectedRecord.imagePath} alt="領収書画像" className="capture-preview compact" />
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
                  <h4>音声文字起こし</h4>
                  <p>{selectedRecord.stt.rawText}</p>
                  <p className="muted small">トークン: {selectedRecord.stt.tokens.join(' / ')}</p>
                </div>
                <div>
                  <h4>画像OCR</h4>
                  <p>{selectedRecord.ocr.rawText || '未取得'}</p>
                  <p className="muted small">
                    日付候補: {selectedRecord.ocr.extractedCandidates.dates.join(', ') || 'なし'}
                  </p>
                </div>
                <div>
                  <h4>照合結果</h4>
                  <p>{selectedRecord.review.mismatchReasons.join(' / ') || '一致しています。'}</p>
                  <p className="muted small">
                    手動修正: {selectedRecord.final.manualEditedFields.join(', ') || 'なし'}
                  </p>
                  <p className="muted small">税区分: {TAX_MODE_LABELS[selectedRecord.final.taxMode]}</p>
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
