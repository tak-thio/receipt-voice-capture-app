import { useEffect, useRef, useState } from 'react'
import { uploadCapture } from '../api/server-api'
import { MediaRecorderService, getMediaRecordingSupport } from '../services/audio/media-recorder-service'
import { createDetector, playShutterSound, unlockShutterAudio } from '../services/detection'
import type { ObjectDetector } from '../services/detection'
import type { RecordedAudioClip } from '../types/audio'
import { useAppStore } from '../store/app-store'

type AutoStatus = 'off' | 'loading' | 'on' | 'unavailable'

/** 撮影画面: 写真(自動シャッター/手動)＋(任意)音声メモ → サーバへアップロード。 */
export function CaptureScreen() {
  const connection = useAppStore((state) => state.connection)!
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const [camError, setCamError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [captured, setCaptured] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [audioClip, setAudioClip] = useState<RecordedAudioClip | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)

  // 自動シャッター(YOLO)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('off')
  const detectorRef = useRef<ObjectDetector | null>(null)
  const capturedRef = useRef<string | null>(null)
  const stableRef = useRef(0)

  useEffect(() => {
    capturedRef.current = captured
  }, [captured])

  // カメラ起動(前/背面の切替で facing が変わると再起動)
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

  // 検出器はアンマウント時にだけ解放(カメラ切替では保持)
  useEffect(
    () => () => {
      detectorRef.current?.dispose()
      detectorRef.current = null
    },
    [],
  )

  function shoot() {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setMessage('カメラの準備ができていません。')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setCaptured(canvas.toDataURL('image/jpeg', 0.85))
    setMessage('')
  }
  const shootRef = useRef(shoot)
  shootRef.current = shoot

  // 自動シャッターの検出ループ(autoStatus が on の間だけ回す)
  useEffect(() => {
    if (autoStatus !== 'on') return
    let cancelled = false
    let busy = false
    const id = window.setInterval(async () => {
      if (cancelled || busy) return
      const det = detectorRef.current
      const video = videoRef.current
      if (!det || !video || !video.videoWidth || capturedRef.current) return
      busy = true
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dets = await det.detect({ canvas, width: canvas.width, height: canvas.height })
        // 検出枠を overlay に描画(ソース座標。video と同じ object-fit:contain で重なる)。
        const overlay = overlayRef.current
        if (overlay) {
          overlay.width = canvas.width
          overlay.height = canvas.height
          const octx = overlay.getContext('2d')
          if (octx) {
            octx.clearRect(0, 0, overlay.width, overlay.height)
            octx.lineWidth = Math.max(3, canvas.width / 180)
            octx.strokeStyle = '#34d399'
            octx.fillStyle = '#34d399'
            octx.font = `${Math.max(16, Math.round(canvas.width / 36))}px sans-serif`
            for (const d of dets) {
              octx.strokeRect(d.box.x, d.box.y, d.box.width, d.box.height)
              octx.fillText(`${d.label} ${Math.round(d.score * 100)}%`, d.box.x, Math.max(d.box.y - 6, 16))
            }
          }
        }
        if (dets.length > 0) {
          stableRef.current += 1
          if (stableRef.current >= 2) {
            stableRef.current = 0
            playShutterSound()
            shootRef.current()
          }
        } else {
          stableRef.current = 0
        }
      } catch {
        /* per-frame error は無視 */
      } finally {
        busy = false
      }
    }, 500)
    return () => {
      cancelled = true
      clearInterval(id)
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
      if (!detectorRef.current) {
        detectorRef.current = await createDetector()
      }
      stableRef.current = 0
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
      if (clip) setAudioClip(clip)
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
    stableRef.current = 0
  }

  async function upload() {
    if (!captured) {
      setMessage('先に撮影してください。')
      return
    }
    setUploading(true)
    setMessage('')
    try {
      await uploadCapture(connection.serverUrl, connection.deviceToken, {
        imageDataUrl: captured,
        audio: audioClip?.blob,
        capturedAt: new Date().toISOString(),
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
            {recording ? '■ 録音停止' : '● 音声メモ'}
          </button>
          <button className="shutter" onClick={shoot} aria-label="撮影" />
          <div className="rec-status">{recording ? '録音中…' : autoStatus === 'on' ? '検出中…' : '　'}</div>
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
          (sentCount > 0
            ? `この端末から送信: ${sentCount}件`
            : `${connection.clientName ?? '顧問先'} に送信します`)}
      </p>
    </div>
  )
}
