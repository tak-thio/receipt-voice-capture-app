import { formatReceiptText, getAiDiagnostics } from '../api/ai-formatter-api'
import { getOcrDiagnostics } from '../api/ocr-api'
import { getSttDiagnostics } from '../api/stt-api'
import { useEffect, useState } from 'react'
import { LOCAL_STT_RECOMMENDED_SETTINGS } from '../lib/constants'
import {
  listAudioInputDevices,
  listVideoInputDevices,
} from '../services/audio/media-recorder-service'
import { useSessionStore } from '../store/session-store'
import type { RecordingDeviceOption } from '../types/audio'
import type { AppSettings } from '../types/settings'
import type { AiDiagnostics } from '../api/ai-formatter-api'
import type { SttDiagnostics } from '../api/stt-api'
import type { OcrDiagnostics } from '../api/ocr-api'

export function SettingsPage() {
  const settings = useSessionStore((state) => state.settings)
  const dictionaries = useSessionStore((state) => state.dictionaries)
  const session = useSessionStore((state) => state.session)
  const availableSessions = useSessionStore((state) => state.availableSessions)
  const lastDictionaryReloadAt = useSessionStore((state) => state.lastDictionaryReloadAt)
  const lastDictionaryError = useSessionStore((state) => state.lastDictionaryError)
  const lastSessionReloadAt = useSessionStore((state) => state.lastSessionReloadAt)
  const lastSessionReloadError = useSessionStore((state) => state.lastSessionReloadError)
  const persistSettings = useSessionStore((state) => state.persistSettings)
  const reloadDictionaries = useSessionStore((state) => state.reloadDictionaries)
  const refreshAvailableSessions = useSessionStore((state) => state.refreshAvailableSessions)
  const reloadCurrentSessionFromDisk = useSessionStore((state) => state.reloadCurrentSessionFromDisk)
  const restoreSessionById = useSessionStore((state) => state.restoreSessionById)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [cameraDevices, setCameraDevices] = useState<RecordingDeviceOption[]>([])
  const [audioDevices, setAudioDevices] = useState<RecordingDeviceOption[]>([])
  const [message, setMessage] = useState('')
  const [isReloading, setIsReloading] = useState(false)
  const [isReloadingSession, setIsReloadingSession] = useState(false)
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null)
  const [sttDiagnostics, setSttDiagnostics] = useState<SttDiagnostics | null>(null)
  const [isRefreshingSttDiagnostics, setIsRefreshingSttDiagnostics] = useState(false)
  const [ocrDiagnostics, setOcrDiagnostics] = useState<OcrDiagnostics | null>(null)
  const [isRefreshingOcrDiagnostics, setIsRefreshingOcrDiagnostics] = useState(false)
  const [aiDiagnostics, setAiDiagnostics] = useState<AiDiagnostics | null>(null)
  const [isRefreshingAiDiagnostics, setIsRefreshingAiDiagnostics] = useState(false)
  const [isTestingAiFormatter, setIsTestingAiFormatter] = useState(false)
  const [aiFormatterTestMessage, setAiFormatterTestMessage] = useState('')
  const selectedProviderKeyConfigured =
    draft.aiProvider === 'gemini'
      ? Boolean(aiDiagnostics?.geminiKeyConfigured)
      : Boolean(aiDiagnostics?.openaiKeyConfigured)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    async function refreshDevices() {
      const [cameras, microphones] = await Promise.all([
        listVideoInputDevices(),
        listAudioInputDevices(),
      ])

      setCameraDevices(cameras)
      setAudioDevices(microphones)
    }

    void refreshDevices()
  }, [])

  useEffect(() => {
    setIsRefreshingSttDiagnostics(true)
    void getSttDiagnostics()
      .then((result) => {
        setSttDiagnostics(result)
      })
      .finally(() => {
        setIsRefreshingSttDiagnostics(false)
      })
  }, [])

  useEffect(() => {
    setIsRefreshingOcrDiagnostics(true)
    void getOcrDiagnostics()
      .then((result) => {
        setOcrDiagnostics(result)
      })
      .finally(() => {
        setIsRefreshingOcrDiagnostics(false)
      })
  }, [])

  useEffect(() => {
    setIsRefreshingAiDiagnostics(true)
    void getAiDiagnostics()
      .then((result) => {
        setAiDiagnostics(result)
      })
      .finally(() => {
        setIsRefreshingAiDiagnostics(false)
      })
  }, [])

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">設定</p>
          <h2>アプリ設定</h2>
          <p className="muted">保存先、入力デバイス、STT/OCR モード、既定の出力形式を保持します。</p>
        </div>
      </header>

      <article className="panel">
        <div className="field-grid">
          <label className="field">
            <span>保存先ルート</span>
            <input value={draft.storageRoot} onChange={(event) => setDraft({ ...draft, storageRoot: event.target.value })} />
          </label>
          <label className="field">
            <span>カメラID</span>
            <select
              value={draft.preferredCameraId}
              onChange={(event) => setDraft({ ...draft, preferredCameraId: event.target.value })}
            >
              <option value="">既定のカメラ</option>
              {cameraDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>マイクID</span>
            <select
              value={draft.preferredMicrophoneId}
              onChange={(event) => setDraft({ ...draft, preferredMicrophoneId: event.target.value })}
            >
              <option value="">既定のマイク</option>
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>STTモード</span>
            <select value={draft.sttMode} onChange={(event) => setDraft({ ...draft, sttMode: event.target.value as AppSettings['sttMode'] })}>
              <option value="mock">テスト</option>
              <option value="local">ローカル</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="field">
            <span>AIプロバイダー</span>
            <select
              value={draft.aiProvider}
              onChange={(event) => {
                const aiProvider = event.target.value as AppSettings['aiProvider']
                setDraft({
                  ...draft,
                  aiProvider,
                  sttMode: draft.sttMode === 'openai' || draft.sttMode === 'gemini' ? aiProvider : draft.sttMode,
                  aiFormatMode:
                    draft.aiFormatMode === 'openai' || draft.aiFormatMode === 'gemini'
                      ? aiProvider
                      : draft.aiFormatMode,
                })
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="field">
            <span>OpenAI APIキー</span>
            <input
              type="password"
              value={draft.openaiApiKey}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, openaiApiKey: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Gemini APIキー</span>
            <input
              type="password"
              value={draft.geminiApiKey}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, geminiApiKey: event.target.value })}
            />
          </label>
          <label className="field">
            <span>STTモデル</span>
            <input value={draft.sttModel} onChange={(event) => setDraft({ ...draft, sttModel: event.target.value })} />
          </label>
          <label className="field">
            <span>STT実行デバイス</span>
            <input value={draft.sttDevice} onChange={(event) => setDraft({ ...draft, sttDevice: event.target.value })} />
          </label>
          <label className="field">
            <span>STT計算方式</span>
            <input value={draft.sttComputeType} onChange={(event) => setDraft({ ...draft, sttComputeType: event.target.value })} />
          </label>
          <label className="field">
            <span>STT言語</span>
            <input value={draft.sttLanguage} onChange={(event) => setDraft({ ...draft, sttLanguage: event.target.value })} />
          </label>
          <label className="field">
            <span>STT探索幅</span>
            <input
              type="number"
              min={1}
              value={draft.sttBeamSize}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sttBeamSize: Number(event.target.value || 1),
                })
              }
            />
          </label>
          <label className="field">
            <span>OpenAI STTモデル</span>
            <input value={draft.openaiSttModel} onChange={(event) => setDraft({ ...draft, openaiSttModel: event.target.value })} />
          </label>
          <label className="field">
            <span>Geminiモデル</span>
            <input value={draft.geminiModel} onChange={(event) => setDraft({ ...draft, geminiModel: event.target.value })} />
          </label>
          <label className="field">
            <span>AI整形モード</span>
            <select
              value={draft.aiFormatMode}
              onChange={(event) => setDraft({ ...draft, aiFormatMode: event.target.value as AppSettings['aiFormatMode'] })}
            >
              <option value="rule">ルールベース</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="local">ローカル</option>
            </select>
          </label>
          <label className="field">
            <span>AI整形モデル</span>
            <input value={draft.aiFormatterModel} onChange={(event) => setDraft({ ...draft, aiFormatterModel: event.target.value })} />
          </label>
          <label className="field">
            <span>OCRモード</span>
            <select value={draft.ocrMode} onChange={(event) => setDraft({ ...draft, ocrMode: event.target.value as AppSettings['ocrMode'] })}>
              <option value="mock">テスト</option>
              <option value="local">ローカル</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="field">
            <span>既定の出力形式</span>
            <select
              value={draft.exportTargetDefault}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  exportTargetDefault: event.target.value as AppSettings['exportTargetDefault'],
                })
              }
            >
              <option value="generic">汎用CSV</option>
              <option value="mas">MJS/MAS</option>
              <option value="freee">freee</option>
              <option value="yayoi">yayoi</option>
            </select>
          </label>
          <label className="checkbox-field">
            <span>
              <input
                type="checkbox"
                checked={draft.ocrEnabled}
                onChange={(event) => setDraft({ ...draft, ocrEnabled: event.target.checked })}
              />
              OCRを有効にする
            </span>
          </label>
        </div>
        <div className="header-actions">
          <button
            className="accent-button"
            onClick={() => {
              void persistSettings(draft)
              setMessage('設定を保存しました。')
            }}
          >
            保存
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              setDraft({
                ...draft,
                ...LOCAL_STT_RECOMMENDED_SETTINGS,
                sttMode: 'local',
              })
              setMessage('軽量 local STT 推奨値をフォームへ反映しました。')
            }}
          >
            ローカル推奨値を適用
          </button>
          <button
            className="ghost-button"
            onClick={() => {
              setDraft({
                ...draft,
                aiProvider: 'gemini',
                sttMode: 'gemini',
                aiFormatMode: 'gemini',
                ocrMode: 'gemini',
                geminiModel: draft.geminiModel || 'gemini-2.5-flash',
              })
              setMessage('Gemini 推奨値をフォームへ反映しました。')
            }}
          >
            Gemini 推奨値を適用
          </button>
          <button
            className="ghost-button"
            disabled={isReloading}
            onClick={() => {
              setIsReloading(true)
              void reloadDictionaries()
                .then(() => {
                  setMessage('辞書を再読込しました。')
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : '辞書の再読込に失敗しました。')
                })
                .finally(() => {
                  setIsReloading(false)
                })
            }}
          >
            {isReloading ? '再読込中...' : '辞書を再読込'}
          </button>
        </div>
        <p className="muted small">
          {message || '辞書ファイルは `dictionaries/` 配下を静的読込しています。デバイス名はブラウザ権限取得後に表示されます。'}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>AI接続診断</h3>
          <span className={`status-chip ${selectedProviderKeyConfigured ? 'ready' : 'warning'}`}>
            {selectedProviderKeyConfigured ? `${draft.aiProvider} 利用可能` : '要確認'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>プロバイダー</dt>
            <dd>{draft.aiProvider}</dd>
          </div>
          <div>
            <dt>Geminiキー</dt>
            <dd>{aiDiagnostics?.geminiKeyConfigured ? '設定済み' : '未設定'}</dd>
          </div>
          <div>
            <dt>OpenAIキー</dt>
            <dd>{aiDiagnostics?.openaiKeyConfigured ? '設定済み' : '未設定'}</dd>
          </div>
          <div>
            <dt>キー取得元</dt>
            <dd>{aiDiagnostics ? `${aiDiagnostics.geminiEnvVar} / ${aiDiagnostics.openaiEnvVar} / 設定ファイル` : 'Tauri runtime で確認'}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <button
            className="ghost-button"
            disabled={isRefreshingAiDiagnostics}
            onClick={() => {
              setIsRefreshingAiDiagnostics(true)
              void getAiDiagnostics()
                .then((result) => {
                  setAiDiagnostics(result)
                  const configured = draft.aiProvider === 'gemini' ? result?.geminiKeyConfigured : result?.openaiKeyConfigured
                  setMessage(configured ? `${draft.aiProvider} APIキー設定を確認しました。` : `${draft.aiProvider} APIキーが未設定です。`)
                })
                .finally(() => {
                  setIsRefreshingAiDiagnostics(false)
                })
            }}
          >
            {isRefreshingAiDiagnostics ? 'AI診断更新中...' : 'AI診断を更新'}
          </button>
          <button
            className="ghost-button"
            disabled={isTestingAiFormatter || !dictionaries}
            onClick={() => {
              if (!dictionaries) {
                const nextMessage = '辞書が未読込のためAI整形テストを実行できません。'
                setMessage(nextMessage)
                setAiFormatterTestMessage(nextMessage)
                return
              }

              setIsTestingAiFormatter(true)
              setAiFormatterTestMessage('')
              void formatReceiptText({
                rawText: '3月24日 セブンイレブン 税込1158円 現金 文具代 次へ',
                provider: draft.aiProvider,
                model: draft.aiProvider === 'gemini' ? draft.geminiModel : draft.aiFormatterModel,
                referenceDate: new Date().toISOString(),
                dictionaries,
              })
                .then((result) => {
                  const record = result.records[0]
                  const nextMessage = record
                    ? `AI整形テスト成功: ${record.vendor || '支払先未入力'} / ${record.amount ?? '金額未入力'}円`
                    : 'AI整形テストは成功しましたが、レコードが返りませんでした。'
                  setMessage(nextMessage)
                  setAiFormatterTestMessage(nextMessage)
                })
                .catch((error) => {
                  const nextMessage = error instanceof Error ? error.message : 'AI整形テストに失敗しました。'
                  setMessage(nextMessage)
                  setAiFormatterTestMessage(nextMessage)
                })
                .finally(() => {
                  setIsTestingAiFormatter(false)
                })
            }}
          >
            {isTestingAiFormatter ? 'AI整形テスト中...' : 'AI整形をテスト'}
          </button>
        </div>
        <p className="muted small">
          APIキーは環境変数を優先し、未設定なら保存済みのアプリ設定を使います。AI整形テストは選択中のプロバイダーへ短いサンプルを1回送信します。
        </p>
        {aiFormatterTestMessage ? (
          <p className="muted small">{aiFormatterTestMessage}</p>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>ローカル文字起こし診断</h3>
          <span className={`status-chip ${sttDiagnostics?.ready ? 'ready' : 'warning'}`}>
            {sttDiagnostics?.ready ? '利用可能' : '要確認'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>Python</dt>
            <dd>{sttDiagnostics?.pythonExecutable ?? 'Tauri runtime で確認'}</dd>
          </div>
          <div>
            <dt>補助スクリプト</dt>
            <dd>{sttDiagnostics?.sidecarScript ?? 'Tauri runtime で確認'}</dd>
          </div>
          <div>
            <dt>ローカル仮想環境</dt>
            <dd>{sttDiagnostics?.localVenvPython ?? '未検出'}</dd>
          </div>
          <div>
            <dt>モード</dt>
            <dd>{draft.sttMode}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <button
            className="ghost-button"
            disabled={isRefreshingSttDiagnostics}
            onClick={() => {
              setIsRefreshingSttDiagnostics(true)
              void getSttDiagnostics()
                .then((result) => {
                  setSttDiagnostics(result)
                  setMessage(result?.ready ? 'local STT 診断情報を更新しました。' : 'local STT 診断情報を再確認しました。')
                })
                .finally(() => {
                  setIsRefreshingSttDiagnostics(false)
                })
            }}
          >
            {isRefreshingSttDiagnostics ? '診断更新中...' : '診断を更新'}
          </button>
        </div>
        <p className="muted small">
          {sttDiagnostics?.error ||
            'ローカルモードでは .venv-stt 配下の Python を優先して補助スクリプトを探します。'}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>OCR診断</h3>
          <span className={`status-chip ${ocrDiagnostics?.ready ? 'ready' : 'warning'}`}>
            {ocrDiagnostics?.ready ? '利用可能' : '要確認'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>tesseract</dt>
            <dd>{ocrDiagnostics?.tesseractExecutable ?? 'Tauri runtime で確認'}</dd>
          </div>
          <div>
            <dt>モード</dt>
            <dd>{draft.ocrMode}</dd>
          </div>
          <div>
            <dt>有効</dt>
            <dd>{draft.ocrEnabled ? 'はい' : 'いいえ'}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <button
            className="ghost-button"
            disabled={isRefreshingOcrDiagnostics}
            onClick={() => {
              setIsRefreshingOcrDiagnostics(true)
              void getOcrDiagnostics()
                .then((result) => {
                  setOcrDiagnostics(result)
                  setMessage(result?.ready ? 'local OCR 診断情報を更新しました。' : 'local OCR 診断情報を再確認しました。')
                })
                .finally(() => {
                  setIsRefreshingOcrDiagnostics(false)
                })
            }}
          >
            {isRefreshingOcrDiagnostics ? '診断更新中...' : 'OCR 診断を更新'}
          </button>
        </div>
        <p className="muted small">
          {ocrDiagnostics?.error ||
            'Gemini OCR は設定画面または GEMINI_API_KEY のAPIキーを使い、ローカルOCRは Tesseract CLI を前提にします。OCR失敗時はエラーとして扱います。'}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>辞書データ</h3>
          <span className={`status-chip ${lastDictionaryError ? 'warning' : 'ready'}`}>
            {lastDictionaryError ? 'エラー' : '読込済み'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>支払方法</dt>
            <dd>{dictionaries?.paymentMethods.length ?? 0}</dd>
          </div>
          <div>
            <dt>勘定科目</dt>
            <dd>{dictionaries?.accountCategories.length ?? 0}</dd>
          </div>
          <div>
            <dt>摘要マッピング</dt>
            <dd>{dictionaries?.descriptionMappings.length ?? 0}</dd>
          </div>
          <div>
            <dt>最終読込</dt>
            <dd>
              {lastDictionaryReloadAt
                ? new Date(lastDictionaryReloadAt).toLocaleString('ja-JP')
                : '未読込'}
            </dd>
          </div>
        </dl>
        <p className="muted small">
          {lastDictionaryError || 'payment-methods.json / account-categories.json / description-mapping.json を利用しています。'}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>セッション状態</h3>
          <span className={`status-chip ${lastSessionReloadError ? 'warning' : 'ready'}`}>
            {lastSessionReloadError ? 'エラー' : '正常'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>セッションID</dt>
            <dd>{session?.id ?? 'なし'}</dd>
          </div>
          <div>
            <dt>レコード数</dt>
            <dd>{session?.records.length ?? 0}</dd>
          </div>
          <div>
            <dt>更新日時</dt>
            <dd>{session ? new Date(session.updatedAt).toLocaleString('ja-JP') : 'なし'}</dd>
          </div>
          <div>
            <dt>保存先ルート</dt>
            <dd>{settings.storageRoot}</dd>
          </div>
          <div>
            <dt>最終再読込</dt>
            <dd>
              {lastSessionReloadAt
                ? new Date(lastSessionReloadAt).toLocaleString('ja-JP')
                : '未実行'}
            </dd>
          </div>
        </dl>
        <div className="header-actions">
          <button
            className="ghost-button"
            disabled={isReloadingSession}
            onClick={() => {
              setIsReloadingSession(true)
              void reloadCurrentSessionFromDisk()
                .then(() => {
                  setMessage('現在セッションをディスクから再読込しました。')
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'セッション再読込に失敗しました。')
                })
                .finally(() => {
                  setIsReloadingSession(false)
                })
            }}
          >
            {isReloadingSession ? 'セッション再読込中...' : '現在セッションを再読込'}
          </button>
          <button
            className="ghost-button"
            disabled={isReloadingSession}
            onClick={() => {
              setIsReloadingSession(true)
              void refreshAvailableSessions()
                .then(() => {
                  setMessage('保存済みセッション一覧を更新しました。')
                })
                .catch((error) => {
                  setMessage(error instanceof Error ? error.message : 'セッション一覧の更新に失敗しました。')
                })
                .finally(() => {
                  setIsReloadingSession(false)
                })
            }}
          >
            一覧を更新
          </button>
        </div>
        <p className="muted small">
          {lastSessionReloadError || '保存先ルート配下の current-session.json と session.json を再読込します。'}
        </p>
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>保存済みセッション</h3>
          <span className="status-chip ready">{availableSessions.length}件</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>セッションID</th>
                <th>更新日時</th>
                <th>件数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {availableSessions.map((savedSession) => (
                <tr key={savedSession.id}>
                  <td>{savedSession.id}</td>
                  <td>{new Date(savedSession.updatedAt).toLocaleString('ja-JP')}</td>
                  <td>{savedSession.recordCount}</td>
                  <td>
                    <button
                      className="ghost-button"
                      disabled={restoringSessionId === savedSession.id}
                      onClick={() => {
                        setRestoringSessionId(savedSession.id)
                        void restoreSessionById(savedSession.id)
                          .then(() => {
                            setMessage(`セッション ${savedSession.id} を復元しました。`)
                          })
                          .catch((error) => {
                            setMessage(error instanceof Error ? error.message : 'セッション復元に失敗しました。')
                          })
                          .finally(() => {
                            setRestoringSessionId(null)
                          })
                      }}
                    >
                      {restoringSessionId === savedSession.id ? '復元中...' : '復元'}
                    </button>
                  </td>
                </tr>
              ))}
              {!availableSessions.length && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    保存済みセッションがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  )
}
