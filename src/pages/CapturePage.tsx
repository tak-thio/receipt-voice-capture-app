import { useEffect, useMemo, useRef, useState } from 'react'
import { TAX_MODE_LABELS } from '../lib/constants'
import { revokeRecordedClip } from '../services/adapters/mock-stt-adapter'
import {
  MediaRecorderService,
  listAudioInputDevices,
  listVideoInputDevices,
} from '../services/audio/media-recorder-service'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../services/sample-sequences'
import { useSessionStore } from '../store/session-store'
import type { RecordedAudioClip, RecordingDeviceOption } from '../types/audio'

function buildFallbackCapture(): { imageDataUrl: string; width: number; height: number } {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640">
      <rect width="100%" height="100%" fill="#f5efe6" />
      <rect x="42" y="42" width="876" height="556" rx="24" fill="#fffaf2" stroke="#c9b59a" stroke-width="8" />
      <text x="80" y="140" font-size="46" fill="#734f28" font-family="Hiragino Sans, sans-serif">Camera preview unavailable</text>
      <text x="80" y="220" font-size="28" fill="#8e7253" font-family="Hiragino Sans, sans-serif">Fallback capture generated for session testing.</text>
    </svg>
  `)

  return {
    imageDataUrl: `data:image/svg+xml;charset=utf-8,${svg}`,
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

export function CapturePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const recordingTimerRef = useRef<number | null>(null)

  const [selectedSequenceId, setSelectedSequenceId] = useState(MOCK_TRANSCRIPT_SEQUENCES[0]?.id ?? '')
  const [manualTranscript, setManualTranscript] = useState(
    '3月24日 セブンイレブン\n税込1158円 現金\n文具代 次へ',
  )
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>('sequence')
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'ready' | 'fallback'>('idle')
  const [cameraDevices, setCameraDevices] = useState<RecordingDeviceOption[]>([])
  const [audioDevices, setAudioDevices] = useState<RecordingDeviceOption[]>([])
  const [latestAudioClip, setLatestAudioClip] = useState<RecordedAudioClip | null>(null)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [recordingError, setRecordingError] = useState('')

  const session = useSessionStore((state) => state.session)
  const settings = useSessionStore((state) => state.settings)
  const pendingEvents = useSessionStore((state) => state.pendingEvents)
  const isRecording = useSessionStore((state) => state.isRecording)
  const isProcessing = useSessionStore((state) => state.isProcessing)
  const lastTranscriptionSource = useSessionStore((state) => state.lastTranscriptionSource)
  const lastTranscriptionError = useSessionStore((state) => state.lastTranscriptionError)
  const lastCaptureError = useSessionStore((state) => state.lastCaptureError)
  const setRecording = useSessionStore((state) => state.setRecording)
  const processTranscriptSequence = useSessionStore((state) => state.processTranscriptSequence)
  const transcribeInput = useSessionStore((state) => state.transcribeInput)
  const persistRecordedAudioClip = useSessionStore((state) => state.persistRecordedAudioClip)
  const startNewSession = useSessionStore((state) => state.startNewSession)
  const setSelectedRecordId = useSessionStore((state) => state.setSelectedRecordId)
  const persistSettings = useSessionStore((state) => state.persistSettings)

  const latestRecord = session?.records.at(-1) ?? null
  const selectedSequence = useMemo(
    () => MOCK_TRANSCRIPT_SEQUENCES.find((sequence) => sequence.id === selectedSequenceId) ?? null,
    [selectedSequenceId],
  )
  const hasSavedAudioClip = Boolean(latestAudioClip?.filePath)
  const localSttWillUseRecordedAudio = settings.sttMode === 'local' && hasSavedAudioClip
  const localSttButtonLabel = localSttWillUseRecordedAudio
    ? '最新録音を local STT 実行'
    : settings.sttMode === 'local'
      ? 'seed fallback で local STT 実行'
      : latestAudioClip
        ? '最新録音からSTT生成'
        : '入力内容からSTT生成'

  useEffect(() => {
    recorderRef.current = new MediaRecorderService()
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
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
          video: settings.preferredCameraId
            ? { deviceId: { exact: settings.preferredCameraId } }
            : { facingMode: 'environment' },
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
  }, [settings.preferredCameraId])

  useEffect(() => {
    async function refreshAudioDevices() {
      const [microphones, cameras] = await Promise.all([
        listAudioInputDevices(),
        listVideoInputDevices(),
      ])
      setAudioDevices(microphones)
      setCameraDevices(cameras)
    }

    void refreshAudioDevices()
  }, [isRecording])

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

  async function handleStartRecording() {
    if (!recorderRef.current) {
      return
    }

    try {
      setRecordingError('')
      await recorderRef.current.start(settings.preferredMicrophoneId || undefined)
      setRecording(true)
      setRecordingElapsedMs(0)

      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
      }

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingElapsedMs((current) => current + 250)
      }, 250)
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
    const devices = await listAudioInputDevices()
    setAudioDevices(devices)
    setCameraDevices(await listVideoInputDevices())
  }

  async function handleProcessRecording() {
    const request =
      transcriptionMode === 'manual'
        ? { audioClip: latestAudioClip, manualTranscript }
        : { audioClip: latestAudioClip, sequenceId: selectedSequenceId }

    await transcribeInput(request, captureFrame())
  }

  async function handleInjectSequenceWithoutRecording() {
    if (!selectedSequence) {
      return
    }

    await processTranscriptSequence(selectedSequence.events, captureFrame())
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 4</p>
          <h2>Capture Workspace</h2>
          <p className="muted">録音、mock STT、セグメント確定を同じ画面で回せるようにしました。録音後はシナリオ適用か手入力トランスクリプトで segment 化できます。</p>
        </div>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => void startNewSession()}>
            新しいセッション
          </button>
          <button
            className={`accent-button${isRecording ? ' danger' : ''}`}
            onClick={() => void (isRecording ? handleStopRecording() : handleStartRecording())}
          >
            {isRecording ? '録音停止' : '録音開始'}
          </button>
        </div>
      </header>

      <div className="capture-grid">
        <article className="panel video-panel">
          <div className="panel-title-row">
            <h3>Camera + Audio</h3>
            <span className={`status-chip ${cameraStatus}`}>{cameraStatus === 'ready' ? 'live' : 'fallback'}</span>
          </div>
          <video ref={videoRef} className="camera-surface" autoPlay muted playsInline />
          <div className="field-grid compact-top">
            <label className="field">
              <span>入力カメラ</span>
              <select
                value={settings.preferredCameraId}
                onChange={(event) =>
                  void persistSettings({
                    ...settings,
                    preferredCameraId: event.target.value,
                  })
                }
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
              <span>入力マイク</span>
              <select
                value={settings.preferredMicrophoneId}
                onChange={(event) =>
                  void persistSettings({
                    ...settings,
                    preferredMicrophoneId: event.target.value,
                  })
                }
              >
                <option value="">既定のマイク</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="recording-summary">
              <span className={`status-chip ${isRecording ? 'warning' : 'ready'}`}>
                {isRecording ? `recording ${formatDuration(recordingElapsedMs)}` : 'idle'}
              </span>
              <p className="muted small">
                {recordingError ||
                  (settings.sttMode === 'local'
                    ? localSttWillUseRecordedAudio
                      ? '録音後は保存済み音声ファイルを優先して、Tauri backend から Python STT sidecar を呼び出します。'
                      : '保存済み録音がない場合は、入力 transcript を seed fallback として Python STT sidecar に渡します。'
                    : 'MediaRecorder で音声を収集し、mock STT の入力ソースとして使います。')}
              </p>
              {lastCaptureError ? <p className="muted small">{lastCaptureError}</p> : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-title-row">
            <h3>Latest Capture</h3>
            <span className={`status-chip ${latestRecord?.review.matchStatus ?? 'warning'}`}>
              {latestRecord?.review.matchStatus ?? 'waiting'}
            </span>
          </div>
          {latestRecord ? (
            <>
              <img src={latestRecord.imagePath} alt="Latest receipt capture" className="capture-preview" />
              <dl className="meta-grid">
                <div>
                  <dt>captured</dt>
                  <dd>{new Date(latestRecord.capturedAt).toLocaleString('ja-JP')}</dd>
                </div>
                <div>
                  <dt>size</dt>
                  <dd>
                    {latestRecord.imageWidth} x {latestRecord.imageHeight}
                  </dd>
                </div>
                <div>
                  <dt>vendor</dt>
                  <dd>{latestRecord.final.vendor || '未抽出'}</dd>
                </div>
                <div>
                  <dt>tax</dt>
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
              手入力 transcript
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
            pending events: {pendingEvents.length} / source: {lastTranscriptionSource ?? 'none'}
          </span>
          {settings.sttMode === 'local' ? (
            <span className="muted small">
              strategy: {localSttWillUseRecordedAudio ? 'recorded-audio' : 'seed-fallback'}
            </span>
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
          <h3>Latest Recording</h3>
          <span className="status-chip ready">{latestAudioClip ? formatDuration(latestAudioClip.durationMs) : 'none'}</span>
        </div>
        {latestAudioClip ? (
          <div className="recording-preview">
            <audio controls src={latestAudioClip.objectUrl} className="audio-player" />
            <dl className="meta-grid">
              <div>
                <dt>mime</dt>
                <dd>{latestAudioClip.mimeType}</dd>
              </div>
              <div>
                <dt>size</dt>
                <dd>{latestAudioClip.size.toLocaleString('ja-JP')} bytes</dd>
              </div>
              <div>
                <dt>started</dt>
                <dd>{new Date(latestAudioClip.startedAt).toLocaleTimeString('ja-JP')}</dd>
              </div>
              <div>
                <dt>ended</dt>
                <dd>{new Date(latestAudioClip.endedAt).toLocaleTimeString('ja-JP')}</dd>
              </div>
              <div>
                <dt>path</dt>
                <dd>{latestAudioClip.filePath ?? 'unsaved'}</dd>
              </div>
              <div>
                <dt>stt route</dt>
                <dd>
                  {settings.sttMode === 'local'
                    ? hasSavedAudioClip
                      ? 'recorded-audio'
                      : 'seed-fallback'
                    : 'mock'}
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
          <h3>Captured Records</h3>
          <span className="status-chip ready">{session?.records.length ?? 0} rows</span>
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
                  <td>{record.review.matchStatus}</td>
                </tr>
              ))}
              {!session?.records.length && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    録音後に mock STT を流すか、シナリオを直接投入すると一覧に追加されます。
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
