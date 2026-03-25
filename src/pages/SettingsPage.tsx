import { useEffect, useState } from 'react'
import {
  listAudioInputDevices,
  listVideoInputDevices,
} from '../services/audio/media-recorder-service'
import { useSessionStore } from '../store/session-store'
import type { RecordingDeviceOption } from '../types/audio'
import type { AppSettings } from '../types/settings'

export function SettingsPage() {
  const settings = useSessionStore((state) => state.settings)
  const dictionaries = useSessionStore((state) => state.dictionaries)
  const lastDictionaryReloadAt = useSessionStore((state) => state.lastDictionaryReloadAt)
  const lastDictionaryError = useSessionStore((state) => state.lastDictionaryError)
  const persistSettings = useSessionStore((state) => state.persistSettings)
  const reloadDictionaries = useSessionStore((state) => state.reloadDictionaries)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [cameraDevices, setCameraDevices] = useState<RecordingDeviceOption[]>([])
  const [audioDevices, setAudioDevices] = useState<RecordingDeviceOption[]>([])
  const [message, setMessage] = useState('')
  const [isReloading, setIsReloading] = useState(false)

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

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 1</p>
          <h2>Settings</h2>
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
              <option value="mock">mock</option>
              <option value="local">local</option>
            </select>
          </label>
          <label className="field">
            <span>OCRモード</span>
            <select value={draft.ocrMode} onChange={(event) => setDraft({ ...draft, ocrMode: event.target.value as AppSettings['ocrMode'] })}>
              <option value="mock">mock</option>
              <option value="local">local</option>
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
              <option value="generic">generic</option>
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
          <h3>Dictionary Status</h3>
          <span className={`status-chip ${lastDictionaryError ? 'warning' : 'ready'}`}>
            {lastDictionaryError ? 'error' : 'loaded'}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>payment methods</dt>
            <dd>{dictionaries?.paymentMethods.length ?? 0}</dd>
          </div>
          <div>
            <dt>account categories</dt>
            <dd>{dictionaries?.accountCategories.length ?? 0}</dd>
          </div>
          <div>
            <dt>description mappings</dt>
            <dd>{dictionaries?.descriptionMappings.length ?? 0}</dd>
          </div>
          <div>
            <dt>last reload</dt>
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
    </section>
  )
}
