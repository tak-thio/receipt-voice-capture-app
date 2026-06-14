import { useEffect, useRef, useState } from 'react'
import { uploadCapture } from '../api/server-api'
import { MediaRecorderService, getMediaRecordingSupport } from '../services/audio/media-recorder-service'
import { createDetector, playShutterSound, unlockShutterAudio } from '../services/detection'
import type { Detection, ObjectDetector } from '../services/detection'
import type { RecordedAudioClip } from '../types/audio'
import { useAppStore } from '../store/app-store'

type AutoStatus = 'off' | 'loading' | 'on' | 'unavailable'

// 動きの収束判定: 主検出の中心+サイズが連続でほぼ動かなければ「収束」。
const STABLE_FRAMES = 3
const MOTION_THRESH = 0.03 // 画像幅に対する移動量の許容
const DETECT_INTERVAL_MS = 350

/** 撮影画面: 自動シャッター(検出→赤枠、収束→緑枠+音+連続撮影) ＋ 手動シャッター。
 * 各撮影は撮影時刻(metadata)付きでサーバへ送る(音声との突き合わせ用)。 */
export function CaptureScreen() {
  const connection = useAppStore((state) => state.connection)!
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const detectorRef = useRef<ObjectDetector | null>(null)

  const [camError, setCamError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [captured, setCaptured] = useState<string | null>(null) // 手動レビュー用
  const [recording, setRecording] = useState(false)
  const [audioClip, setAudioClip] = useState<RecordedAudioClip | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('off')

  // 連続自動撮影の制御(ref: ループから参照)
  const capturedRef = useRef<string | null>(null)
  const armedRef = useRef(true) // 撮ったら一旦disarm、対象が消えたら再arm
  const lastBoxRef = useRef<{ cx: number; cy: number; size: number } | null>(null)
  const stableRef = useRef(0)
  const captureBusyRef = useRef(false)

  useEffect(() => {
    capturedRef.current = captured
  }, [captured])

  // カメラ起動(前/背面切替で再起動)
  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('この端末ではカメラを利用できません。')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })
      } catch {
        setCamError('カメラを起動できませんでした。アプリのカメラ権限を確認してください。')
        return
      }
      setCamError('')
      const video = videoRef.current
      if (!video || stopped) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      try {
        await video.play()
      } catch {
        /* ignore */
      }
    }
    void start()
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  useEffect(
    () => () => {
      detectorRef.current?.dispose()
      detectorRef.current = null
    },
    [],
  )

  function grabFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  }

  function triggerFlash() {
    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)
  }

  // 手動シャッター → レビュー(captured)
  function shoot() {
    const url = grabFrame()
    if (!url) {
      setMessage('カメラの準備ができていません。')
      return
    }
    triggerFlash()
    setCaptured(url)
    setMessage('')
  }

  // 自動撮影: その場でアップロード(レビューせず連続)。撮影時刻メタデータ付き。
  async function autoCaptureAndUpload(primary: Detection) {
    const url = grabFrame()
    if (!url) return
    const ms = Date.now()
    try {
      await uploadCapture(connection.serverUrl, connection.deviceToken, {
        imageDataUrl: url,
        capturedAt: new Date(ms).toISOString(),
        metadata: {
          captured_at_ms: ms, // 音声との突き合わせ用の高精度タイムスタンプ
          source: 'auto',
          detector: 'yolo',
          score: Math.round(primary.score * 100) / 100,
          label: primary.label,
        },
      })
      setSentCount((n) => n + 1)
      setMessage('自動で撮影・送信しました')
    } catch (e) {
      setMessage(e instanceof Error ? `送信失敗: ${e.message}` : '送信に失敗しました')
    }
  }
  const autoUploadRef = useRef(autoCaptureAndUpload)
  autoUploadRef.current = autoCaptureAndUpload

  // セッション音声トラック: 撮影と並行して録った音声を単体で送る。
  // 各写真は captured_at_ms 付きで送られているので、サーバが音声の
  // 開始〜終了区間と撮影時刻を突き合わせて写真に紐付ける。
  async function uploadAudioSession(clip: RecordedAudioClip) {
    setMessage('音声を送信中…')
    const startMs = Date.parse(clip.startedAt) || undefined
    const endMs = Date.parse(clip.endedAt) || undefined
    try {
      await uploadCapture(connection.serverUrl, connection.deviceToken, {
        audio: clip.blob,
        capturedAt: clip.startedAt,
        metadata: {
          voice_session: true, // サーバが「写真に紐付ける音声トラック」と識別する印
          source: 'auto',
          captured_at_ms: startMs,
          audio_started_at: clip.startedAt,
          audio_ended_at: clip.endedAt,
          audio_started_at_ms: startMs,
          audio_ended_at_ms: endMs,
          duration_ms: clip.durationMs,
        },
      })
      setMessage(`音声メモを送信しました(${Math.round(clip.durationMs / 1000)}秒)。撮影時刻で各写真に紐付きます。`)
    } catch (e) {
      setMessage(e instanceof Error ? `音声送信失敗: ${e.message}` : '音声の送信に失敗しました')
    }
  }

  // 自動シャッター 検出ループ
  useEffect(() => {
    if (autoStatus !== 'on') return
    let cancelled = false
    let busy = false
    const id = window.setInterval(async () => {
      if (cancelled || busy) return
      const det = detectorRef.current
      const video = videoRef.current
      const overlay = overlayRef.current
      if (!det || !video || !video.videoWidth || capturedRef.current) return
      busy = true
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dets = await det.detect({ canvas, width: canvas.width, height: canvas.height })
        const primary = dets.length
          ? dets.reduce((a, b) => (b.score > a.score ? b : a))
          : null

        // 収束判定
        let converged = false
        if (primary) {
          const cx = primary.box.x + primary.box.width / 2
          const cy = primary.box.y + primary.box.height / 2
          const size = (primary.box.width + primary.box.height) / 2
          const last = lastBoxRef.current
          if (last) {
            const move =
              (Math.abs(cx - last.cx) + Math.abs(cy - last.cy) + Math.abs(size - last.size)) /
              canvas.width
            stableRef.current = move < MOTION_THRESH ? stableRef.current + 1 : 0
          } else {
            stableRef.current = 0
          }
          lastBoxRef.current = { cx, cy, size }
          converged = stableRef.current >= STABLE_FRAMES
        } else {
          // 対象が消えたら再arm(次の領収書に備える)
          stableRef.current = 0
          lastBoxRef.current = null
          armedRef.current = true
        }

        // 枠描画: 検出のみ=赤、収束=緑
        if (overlay) {
          overlay.width = canvas.width
          overlay.height = canvas.height
          const octx = overlay.getContext('2d')
          if (octx) {
            octx.clearRect(0, 0, overlay.width, overlay.height)
            const color = converged ? '#34d399' : '#f87171'
            octx.lineWidth = Math.max(3, canvas.width / 180)
            octx.strokeStyle = color
            octx.fillStyle = color
            octx.font = `${Math.max(16, Math.round(canvas.width / 36))}px sans-serif`
            for (const d of dets) {
              octx.strokeRect(d.box.x, d.box.y, d.box.width, d.box.height)
              octx.fillText(`${Math.round(d.score * 100)}%`, d.box.x, Math.max(d.box.y - 6, 16))
            }
          }
        }

        // 収束 & arm 済み → 連続撮影
        if (primary && converged && armedRef.current && !captureBusyRef.current) {
          armedRef.current = false
          stableRef.current = 0
          captureBusyRef.current = true
          playShutterSound()
          triggerFlash()
          try {
            await autoUploadRef.current(primary)
          } finally {
            captureBusyRef.current = false
          }
        }
      } catch {
        /* per-frame error は無視 */
      } finally {
        busy = false
      }
    }, DETECT_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
      const overlay = overlayRef.current
      overlay?.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height)
    }
  }, [autoStatus])

  async function toggleAuto() {
    unlockShutterAudio()
    if (autoStatus === 'on' || autoStatus === 'loading') {
      setAutoStatus('off')
      return
    }
    setAutoStatus('loading')
    try {
      if (!detectorRef.current) detectorRef.current = await createDetector()
      stableRef.current = 0
      lastBoxRef.current = null
      armedRef.current = true
      setAutoStatus('on')
    } catch {
      detectorRef.current = null
      setAutoStatus('unavailable')
    }
  }

  async function toggleRecord() {
    if (recording) {
      const clip = (await recorderRef.current?.stop()) ?? null
      recorderRef.current = null
      setRecording(false)
      if (!clip) return
      // レビュー中(手動)はその写真へ添付。メイン画面での録音は
      // 連続撮影と並行した「セッション音声」として単体送信する。
      if (capturedRef.current) {
        setAudioClip(clip)
      } else {
        await uploadAudioSession(clip)
      }
      return
    }
    const support = getMediaRecordingSupport()
    if (!support.supported) {
      setMessage(support.reason ?? '録音を利用できません。')
      return
    }
    const service = new MediaRecorderService()
    try {
      await service.start()
      recorderRef.current = service
      setRecording(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '録音を開始できませんでした。')
    }
  }

  function retake() {
    setCaptured(null)
    setAudioClip(null)
    setMessage('')
  }

  async function upload() {
    if (!captured) return
    setUploading(true)
    setMessage('')
    const ms = Date.now()
    try {
      await uploadCapture(connection.serverUrl, connection.deviceToken, {
        imageDataUrl: captured,
        audio: audioClip?.blob,
        capturedAt: new Date(ms).toISOString(),
        metadata: {
          captured_at_ms: ms,
          source: 'manual',
          ...(audioClip
            ? { audio_started_at: audioClip.startedAt, audio_ended_at: audioClip.endedAt }
            : {}),
        },
      })
      setSentCount((n) => n + 1)
      setCaptured(null)
      setAudioClip(null)
      setMessage('送信しました。Webの受信箱で確認できます。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '送信に失敗しました。')
    } finally {
      setUploading(false)
    }
  }

  const autoLabel =
    autoStatus === 'loading' ? '自動: 起動中…'
    : autoStatus === 'on' ? '🟢 自動シャッター ON'
    : autoStatus === 'unavailable' ? '自動: モデル未配置'
    : '自動シャッター OFF'
  const audioSecs = audioClip ? Math.round(audioClip.durationMs / 1000) : 0

  return (
    <div className="capture-screen">
      <div className="cam-area">
        <video ref={videoRef} className="cam-video" style={{ display: captured ? 'none' : 'block' }} />
        {!captured && autoStatus === 'on' && <canvas ref={overlayRef} className="cam-overlay" />}
        {captured && <img className="cam-shot" src={captured} alt="撮影画像" />}
        {flash && <div className="cam-flash" />}
        {!captured && (
          <button
            className={`auto-toggle${autoStatus === 'on' ? ' on' : ''}${autoStatus === 'unavailable' ? ' off' : ''}`}
            onClick={() => void toggleAuto()}
          >
            {autoLabel}
          </button>
        )}
        {!captured && !camError && (
          <button
            className="cam-flip"
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            aria-label="カメラ切替"
            title={facing === 'environment' ? '前面カメラに切替' : '背面カメラに切替'}
          >
            🔄
          </button>
        )}
        {camError && <div className="cam-error">{camError}</div>}
      </div>

      {!captured ? (
        <div className="capture-controls">
          <button className={`rec-button${recording ? ' on' : ''}`} onClick={() => void toggleRecord()}>
            {recording ? '■ 録音停止して送信' : '● 音声メモ'}
          </button>
          <button className="shutter" onClick={shoot} aria-label="撮影" />
          <div className="rec-status">
            {recording ? '録音中…撮影しながら話す' : autoStatus === 'on' ? '自動検出中…' : '　'}
          </div>
        </div>
      ) : (
        <div className="capture-controls review">
          <button className="ghost-button" onClick={retake}>取り直し</button>
          <div className="audio-chip">
            {audioClip ? (
              <span>音声メモ {audioSecs}秒</span>
            ) : (
              <button className={`rec-button small${recording ? ' on' : ''}`} onClick={() => void toggleRecord()}>
                {recording ? '■ 停止' : '● 音声メモ追加'}
              </button>
            )}
          </div>
          <button className="accent-button big" disabled={uploading} onClick={() => void upload()}>
            {uploading ? '送信中…' : 'アップロード'}
          </button>
        </div>
      )}

      <p className="muted small center">
        {message ||
          (recording && !captured
            ? '録音中…領収書を撮りながら声でメモ。停止すると音声を送信し、撮影時刻で各写真に紐付きます。'
            : autoStatus === 'on'
              ? `自動撮影中（収束で自動・対象を替えると次へ）／送信 ${sentCount}件`
              : sentCount > 0
                ? `この端末から送信: ${sentCount}件`
                : `${connection.clientName ?? '顧問先'} に送信します`)}
      </p>
    </div>
  )
}
