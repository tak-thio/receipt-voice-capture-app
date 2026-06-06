import { useEffect, useMemo, useRef, useState } from 'react'
import { MATCH_STATUS_LABELS, TAX_MODE_LABELS } from '../lib/constants'
import { uploadCapture } from '../api/server-api'
import { revokeRecordedClip } from '../services/adapters/mock-stt-adapter'
import {
  MediaRecorderService,
  getMediaRecordingSupport,
} from '../services/audio/media-recorder-service'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../services/sample-sequences'
import { useSessionStore } from '../store/session-store'
import type { RecordedAudioClip } from '../types/audio'

function buildFallbackCapture(): { imageDataUrl: string; width: number; height: number } {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640">
      <rect width="100%" height="100%" fill="#f5efe6" />
      <rect x="42" y="42" width="876" height="556" rx="24" fill="#fffaf2" stroke="#c9b59a" stroke-width="8" />
      <text x="80" y="140" font-size="46" fill="#734f28" font-family="Hiragino Sans, sans-serif">カメラプレビューを利用できません</text>
      <text x="80" y="220" font-size="28" fill="#8e7253" font-family="Hiragino Sans, sans-serif">テスト用の代替画像を作成しました。</text>
    </svg>
  `
  const svgBytes = new TextEncoder().encode(svg)
  const svgBase64 = window.btoa(String.fromCharCode(...svgBytes))

  return {
    imageDataUrl: `data:image/svg+xml;base64,${svgBase64}`,
    width: 960,
    height: 640,
  }
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

type TranscriptionMode = 'sequence' | 'manual'

interface CaptureSnapshot {
  imageDataUrl: string
  width: number
  height: number
  capturedAtMs: number
}

function formatSttRoute(settingsMode: string, hasSavedAudioClip: boolean): string {
  if (settingsMode === 'local') {
    return hasSavedAudioClip ? '録音音声をローカル処理' : '入力テキストをローカル処理'
  }

  if (settingsMode === 'openai') {
    return hasSavedAudioClip ? '録音音声をOpenAI処理' : '入力テキストをOpenAI処理'
  }

  if (settingsMode === 'gemini') {
    return hasSavedAudioClip ? '録音音声をGemini処理' : '入力テキストをGemini処理'
  }

  return 'テスト処理'
}

export function CapturePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const captureSnapshotsRef = useRef<CaptureSnapshot[]>([])

  const [selectedSequenceId, setSelectedSequenceId] = useState(MOCK_TRANSCRIPT_SEQUENCES[0]?.id ?? '')
  const [manualTranscript, setManualTranscript] = useState(
    '3月24日 セブンイレブン\n税込1158円 現金\n文具代 次へ',
  )
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>('sequence')
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'ready' | 'fallback'>('idle')
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment')
  const [latestAudioClip, setLatestAudioClip] = useState<RecordedAudioClip | null>(null)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [captureSnapshotCount, setCaptureSnapshotCount] = useState(0)
  const [recordingError, setRecordingError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')

  const session = useSessionStore((state) => state.session)
  const settings = useSessionStore((state) => state.settings)
  const pendingEvents = useSessionStore((state) => state.pendingEvents)
  const isRecording = useSessionStore((state) => state.isRecording)
  const isProcessing = useSessionStore((state) => state.isProcessing)
  const lastTranscriptionSource = useSessionStore((state) => state.lastTranscriptionSource)
  const lastTranscriptionStrategy = useSessionStore((state) => state.lastTranscriptionStrategy)
  const lastDetectedLanguage = useSessionStore((state) => state.lastDetectedLanguage)
  const lastTranscriptionEventCount = useSessionStore((state) => state.lastTranscriptionEventCount)
  const lastTranscriptionError = useSessionStore((state) => state.lastTranscriptionError)
  const lastCaptureError = useSessionStore((state) => state.lastCaptureError)
  const setRecording = useSessionStore((state) => state.setRecording)
  const processTranscriptSequence = useSessionStore((state) => state.processTranscriptSequence)
  const transcribeInput = useSessionStore((state) => state.transcribeInput)
  const persistRecordedAudioClip = useSessionStore((state) => state.persistRecordedAudioClip)
  const startNewSession = useSessionStore((state) => state.startNewSession)
  const setSelectedRecordId = useSessionStore((state) => state.setSelectedRecordId)

  const latestRecord = session?.records.at(-1) ?? null
  const selectedSequence = useMemo(
    () => MOCK_TRANSCRIPT_SEQUENCES.find((sequence) => sequence.id === selectedSequenceId) ?? null,
    [selectedSequenceId],
  )
  const hasSavedAudioClip = Boolean(latestAudioClip?.filePath)
  const recordingSupport = getMediaRecordingSupport()
  const localSttWillUseRecordedAudio = settings.sttMode === 'local' && hasSavedAudioClip
  const localSttButtonLabel = localSttWillUseRecordedAudio
    ? '最新録音をローカル文字起こし'
    : settings.sttMode === 'local'
      ? '入力内容でローカル文字起こし'
      : settings.sttMode === 'openai'
        ? hasSavedAudioClip
          ? '最新録音をOpenAIで文字起こし'
          : '入力内容をOpenAIで文字起こし'
        : settings.sttMode === 'gemini'
          ? hasSavedAudioClip
            ? '最新録音をGeminiで文字起こし'
            : '入力内容をGeminiで文字起こし'
      : latestAudioClip
        ? '最新録音から文字起こし'
        : '入力内容から文字起こし'

  useEffect(() => {
    recorderRef.current = new MediaRecorderService()
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
      }
      if (snapshotTimerRef.current) {
        window.clearInterval(snapshotTimerRef.current)
      }
      revokeRecordedClip(latestAudioClip)
    }
  }, [latestAudioClip])

  useEffect(() => {
    let isMounted = true
    let currentStream: MediaStream | null = null

    async function startVideo() {
      if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
        if (isMounted) {
          setCameraStatus('fallback')
        }
        return
      }

      try {
        currentStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacing },
          audio: false,
        })
        if (!isMounted || !videoRef.current) {
          return
        }
        videoRef.current.srcObject = currentStream
        setCameraStatus('ready')
      } catch {
        if (isMounted) {
          setCameraStatus('fallback')
        }
      }
    }

    void startVideo()

    return () => {
      isMounted = false
      currentStream?.getTracks().forEach((track) => track.stop())
    }
  }, [cameraFacing])

  function captureFrame(): { imageDataUrl: string; width: number; height: number } {
    const videoElement = videoRef.current
    if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
      return buildFallbackCapture()
    }

    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight

    const context = canvas.getContext('2d')
    context?.drawImage(videoElement, 0, 0, canvas.width, canvas.height)

    return {
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
      width: canvas.width,
      height: canvas.height,
    }
  }

  async function handleServerUpload() {
    if (!settings.serverUrl || !settings.serverDeviceToken) {
      setUploadMessage('設定画面で「サーバ連携」を接続してください。')
      return
    }
    setIsUploading(true)
    setUploadMessage('サーバへアップロード中...')
    try {
      const frame = captureFrame()
      const result = await uploadCapture(settings.serverUrl, settings.serverDeviceToken, {
        imageDataUrl: frame.imageDataUrl,
        audio: latestAudioClip?.blob,
        capturedAt: new Date().toISOString(),
      })
      setUploadMessage(`サーバに送信しました(受領ID: ${result.receipt_id.slice(0, 8)}…)。事務所側で処理されます。`)
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'アップロードに失敗しました。')
    } finally {
      setIsUploading(false)
    }
  }

  function captureSnapshot(): CaptureSnapshot {
    const frame = captureFrame()
    const capturedAtMs = recordingStartedAtRef.current
      ? Math.max(0, Date.now() - recordingStartedAtRef.current)
      : 0

    return {
      ...frame,
      capturedAtMs,
    }
  }

  function appendCaptureSnapshot() {
    const snapshot = captureSnapshot()
    captureSnapshotsRef.current = [...captureSnapshotsRef.current, snapshot].slice(-240)
    setCaptureSnapshotCount(captureSnapshotsRef.current.length)
  }

  function buildCaptureFramesForProcessing(): CaptureSnapshot[] {
    const snapshots = captureSnapshotsRef.current
    if (snapshots.length) {
      return snapshots
    }

    return [captureSnapshot()]
  }

  async function handleStartRecording() {
    if (!recorderRef.current) {
      return
    }

    try {
      setRecordingError('')
      await recorderRef.current.start()
      setRecording(true)
      setRecordingElapsedMs(0)
      setCaptureSnapshotCount(0)
      captureSnapshotsRef.current = []
      recordingStartedAtRef.current = Date.now()
      appendCaptureSnapshot()

      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
      }
      if (snapshotTimerRef.current) {
        window.clearInterval(snapshotTimerRef.current)
      }

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingElapsedMs((current) => current + 250)
      }, 250)
      snapshotTimerRef.current = window.setInterval(() => {
        appendCaptureSnapshot()
      }, 1000)
    } catch (error) {
      setRecording(false)
      setRecordingError(error instanceof Error ? error.message : '録音の開始に失敗しました。')
    }
  }

  async function handleStopRecording() {
    if (!recorderRef.current) {
      return
    }

    let clip: RecordedAudioClip | null = null
    try {
      clip = await recorderRef.current.stop()
    } catch (error) {
      setRecording(false)
      setRecordingError(error instanceof Error ? error.message : '録音停止に失敗しました。')
      return
    }
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (snapshotTimerRef.current) {
      window.clearInterval(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
    appendCaptureSnapshot()

    setRecording(false)
    setRecordingElapsedMs(0)
    let persistedClip: RecordedAudioClip | null = null
    try {
      persistedClip = clip ? await persistRecordedAudioClip(clip) : null
      setRecordingError('')
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : '録音ファイルの保存に失敗しました。')
    }
    setLatestAudioClip((current) => {
      revokeRecordedClip(current)
      return persistedClip
    })
  }

  async function handleProcessRecording() {
    const request =
      transcriptionMode === 'manual'
        ? { audioClip: latestAudioClip, manualTranscript }
        : { audioClip: latestAudioClip, sequenceId: selectedSequenceId }

    await transcribeInput(request, buildCaptureFramesForProcessing())
  }

  async function handleInjectSequenceWithoutRecording() {
    if (!selectedSequence) {
      return
    }

    await processTranscriptSequence(selectedSequence.events, buildCaptureFramesForProcessing())
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">入力</p>
          <h2>領収書の入力</h2>
          <p className="muted">録音した内容を文字起こしし、領収書データとして取り込みます。</p>
          {settings.appMode === 'linked' && (
            <p className="muted small">
              {uploadMessage || 'サーバ連携モード:撮影してサーバへ送信すると、事務所側でAI処理されます。'}
            </p>
          )}
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => void startNewSession()}>
            新しいセッション
          </button>
          {settings.appMode === 'linked' && (
            <button
              className="accent-button"
              onClick={() => void handleServerUpload()}
              disabled={isUploading}
            >
              {isUploading ? '送信中...' : 'サーバへ送信'}
            </button>
          )}
          <button
            className={`accent-button${isRecording ? ' danger' : ''}`}
            onClick={() => void (isRecording ? handleStopRecording() : handleStartRecording())}
            disabled={!isRecording && !recordingSupport.supported}
          >
            {isRecording ? '録音停止' : '録音開始'}
          </button>
        </div>
      </header>

      <div className="capture-grid">
        <article className="panel video-panel">
          <div className="panel-title-row">
            <h3>カメラと音声</h3>
            <span className={`status-chip ${cameraStatus}`}>{cameraStatus === 'ready' ? '使用中' : '代替表示'}</span>
          </div>
          <div className="camera-stage">
            <video ref={videoRef} className="camera-surface" autoPlay muted playsInline />
            {cameraStatus === 'ready' && (
              <button
                type="button"
                className="camera-flip-button"
                onClick={() =>
                  setCameraFacing((current) => (current === 'environment' ? 'user' : 'environment'))
                }
                aria-label={cameraFacing === 'environment' ? 'インカメラに切り替え' : 'アウトカメラに切り替え'}
                title={cameraFacing === 'environment' ? 'インカメラに切り替え' : 'アウトカメラに切り替え'}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 8a9 9 0 0 1 14.5-2.5L21 8" />
                  <path d="M21 4v4h-4" />
                  <path d="M21 16a9 9 0 0 1-14.5 2.5L3 16" />
                  <path d="M3 20v-4h4" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              </button>
            )}
          </div>
          <div className="field-grid compact-top">
            <div className="recording-summary">
              <span className={`status-chip ${isRecording ? 'warning' : 'ready'}`}>
                {isRecording ? `録音中 ${formatDuration(recordingElapsedMs)}` : '待機中'}
              </span>
              <p className="muted small">
                {recordingError ||
                  recordingSupport.reason ||
                  (settings.sttMode === 'local'
                    ? localSttWillUseRecordedAudio
                      ? '録音後は保存済み音声ファイルを使ってローカル文字起こしを実行します。'
                      : '保存済み録音がない場合は、入力テキストを使ってローカル文字起こしを確認します。'
                    : settings.sttMode === 'openai'
                      ? '録音後はOpenAIで文字起こしします。APIキーは設定画面または OPENAI_API_KEY を使います。'
                      : settings.sttMode === 'gemini'
                        ? '録音後はGeminiで文字起こしします。APIキーは設定画面または GEMINI_API_KEY を使います。'
                    : '録音した音声をテスト用の文字起こしに使用します。')}
              </p>
              <p className="muted small">
                録音中は約1秒ごとに画像を自動保存し、各レコードの音声区間に近い画像をOCRに使います。保存候補: {captureSnapshotCount}枚
              </p>
              {lastCaptureError ? <p className="muted small">{lastCaptureError}</p> : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h3>最新の撮影画像</h3>
            <span className={`status-chip ${latestRecord?.review.matchStatus ?? 'warning'}`}>
              {latestRecord ? MATCH_STATUS_LABELS[latestRecord.review.matchStatus] : '待機中'}
            </span>
          </div>
          {latestRecord ? (
            <>
              <img src={latestRecord.imagePath} alt="最新の領収書画像" className="capture-preview" />
              <dl className="meta-grid">
                <div>
                  <dt>撮影日時</dt>
                  <dd>{new Date(latestRecord.capturedAt).toLocaleString('ja-JP')}</dd>
                </div>
                <div>
                  <dt>画像サイズ</dt>
                  <dd>
                    {latestRecord.imageWidth} x {latestRecord.imageHeight}
                  </dd>
                </div>
                <div>
                  <dt>支払先</dt>
                  <dd>{latestRecord.final.vendor || '未抽出'}</dd>
                </div>
                <div>
                  <dt>税区分</dt>
                  <dd>{TAX_MODE_LABELS[latestRecord.final.taxMode]}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="empty-state">セグメント確定後に最新キャプチャが表示されます。</div>
          )}
        </article>
      </div>

      <div className="capture-toolbar panel">
        <div className="toolbar-stack">
          <div className="toolbar-group">
            <button
              className={`ghost-button${transcriptionMode === 'sequence' ? ' selected' : ''}`}
              onClick={() => setTranscriptionMode('sequence')}
            >
              シナリオ適用
            </button>
            <button
              className={`ghost-button${transcriptionMode === 'manual' ? ' selected' : ''}`}
              onClick={() => setTranscriptionMode('manual')}
            >
              手入力テキスト
            </button>
          </div>

          {transcriptionMode === 'sequence' ? (
            <label className="field">
              <span>モック入力シナリオ</span>
              <select value={selectedSequenceId} onChange={(event) => setSelectedSequenceId(event.target.value)}>
                {MOCK_TRANSCRIPT_SEQUENCES.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>手入力トランスクリプト</span>
              <textarea
                rows={5}
                value={manualTranscript}
                onChange={(event) => setManualTranscript(event.target.value)}
              />
            </label>
          )}
        </div>

        <div className="toolbar-stack align-end">
          <div className="toolbar-group">
            <button
              className="accent-button"
              onClick={() => void handleProcessRecording()}
              disabled={isProcessing || (transcriptionMode === 'manual' ? !manualTranscript.trim() : !selectedSequence)}
            >
              {localSttButtonLabel}
            </button>
            <button
              className="ghost-button"
              onClick={() => void handleInjectSequenceWithoutRecording()}
              disabled={!selectedSequence || isProcessing}
            >
              録音なしでシナリオ投入
            </button>
          </div>
          <span className="muted small">
            未確定イベント: {pendingEvents.length} / 文字起こし元: {lastTranscriptionSource ?? 'なし'}
          </span>
          {lastTranscriptionStrategy ? (
            <span className="muted small">
              処理経路: {lastTranscriptionStrategy}
            </span>
          ) : null}
          <span className="muted small">イベント数: {lastTranscriptionEventCount}</span>
          {lastDetectedLanguage ? (
            <span className="muted small">検出言語: {lastDetectedLanguage}</span>
          ) : null}
          {lastTranscriptionError ? (
            <span className="muted small">{lastTranscriptionError}</span>
          ) : null}
          {lastCaptureError ? (
            <span className="muted small">{lastCaptureError}</span>
          ) : null}
        </div>
      </div>

      <article className="panel">
        <div className="panel-title-row">
          <h3>最新の録音</h3>
          <span className="status-chip ready">{latestAudioClip ? formatDuration(latestAudioClip.durationMs) : 'なし'}</span>
        </div>
        {latestAudioClip ? (
          <div className="recording-preview">
            <audio controls src={latestAudioClip.objectUrl} className="audio-player" />
            <dl className="meta-grid">
              <div>
                <dt>形式</dt>
                <dd>{latestAudioClip.mimeType}</dd>
              </div>
              <div>
                <dt>サイズ</dt>
                <dd>{latestAudioClip.size.toLocaleString('ja-JP')} バイト</dd>
              </div>
              <div>
                <dt>開始時刻</dt>
                <dd>{new Date(latestAudioClip.startedAt).toLocaleTimeString('ja-JP')}</dd>
              </div>
              <div>
                <dt>終了時刻</dt>
                <dd>{new Date(latestAudioClip.endedAt).toLocaleTimeString('ja-JP')}</dd>
              </div>
              <div>
                <dt>保存先</dt>
                <dd>{latestAudioClip.filePath ?? '未保存'}</dd>
              </div>
              <div>
                <dt>文字起こし経路</dt>
                <dd>
                  {formatSttRoute(settings.sttMode, hasSavedAudioClip)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="empty-state">録音するとここに最新クリップが表示されます。</div>
        )}
      </article>

      <article className="panel">
        <div className="panel-title-row">
          <h3>入力済みレコード</h3>
          <span className="status-chip ready">{session?.records.length ?? 0}件</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>支払先</th>
                <th>税区分</th>
                <th>金額</th>
                <th>勘定項目</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {session?.records.map((record) => (
                <tr key={record.id} onClick={() => setSelectedRecordId(record.id)}>
                  <td>{record.final.date || '未入力'}</td>
                  <td>{record.final.vendor || '未入力'}</td>
                  <td>{TAX_MODE_LABELS[record.final.taxMode]}</td>
                  <td>{record.final.amount?.toLocaleString('ja-JP') ?? '未入力'}</td>
                  <td>{record.final.accountCategoryFinal || record.final.accountCategoryCandidate || '未推定'}</td>
                  <td>{MATCH_STATUS_LABELS[record.review.matchStatus]}</td>
                </tr>
              ))}
              {!session?.records.length && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    録音後に文字起こしするか、シナリオを直接投入すると一覧に追加されます。
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
