import { useEffect, useRef, useState } from 'react'
import { uploadBatch } from '../api/server-api'
import { MediaRecorderService, getMediaRecordingSupport } from '../services/audio/media-recorder-service'
import { getDetector, playShutterSound, unlockShutterAudio } from '../services/detection'
import type { Detection, ObjectDetector } from '../services/detection'
import type { RecordedAudioClip } from '../types/audio'
import { useAppStore } from '../store/app-store'

type AutoStatus = 'off' | 'loading' | 'on' | 'unavailable'
type TrayItem = { id: number; dataUrl: string; ms: number }

// 動きの収束判定: 主検出の中心+サイズが連続でほぼ動かなければ「収束」。
// デモ用にゆるめ(早く確定・手ブレに寛容)。
const STABLE_FRAMES = 2
const MOTION_THRESH = 0.05 // 画像幅に対する移動量の許容
// 推論はメインスレッド(WASM/CPU)で重い。間引いて体感負荷を下げる。
const DETECT_INTERVAL_MS = 500

/** 撮影画面: 撮った写真はトレイに溜め(自動シャッター=赤枠→収束で緑枠+音、手動も可)、
 * 録音(セットの説明音声)を添えて「送信」で全画像+音声を1リクエストで一括送信する。
 * サーバが1回のAI呼び出しで全件(1枚に複数・カード明細含む)を解析する。 */
export function CaptureScreen({ onSent }: { onSent?: () => void }) {
  const connection = useAppStore((state) => state.connection)!
  const autoPref = useAppStore((state) => state.autoCapture)
  const setAutoPref = useAppStore((state) => state.setAutoCapture)
  const showToast = useAppStore((state) => state.showToast)
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const detectorRef = useRef<ObjectDetector | null>(null)
  const loopCanvasRef = useRef<HTMLCanvasElement | null>(null) // 検出ループで使い回す(毎フレーム生成しない)

  const [camError, setCamError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [tray, setTray] = useState<TrayItem[]>([])
  const [recording, setRecording] = useState(false)
  const [audioClip, setAudioClip] = useState<RecordedAudioClip | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('off')

  // 自動連続撮影の制御(ref: 検出ループから参照)
  const idRef = useRef(1)
  const armedRef = useRef(true) // 撮ったら一旦disarm、対象が消えたら再arm
  const lastBoxRef = useRef<{ cx: number; cy: number; size: number } | null>(null)
  const stableRef = useRef(0)
  const captureBusyRef = useRef(false)
  const autoStartedRef = useRef(false) // マウント時の自動開始を1回だけにする

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

  // 連続撮影モード: 開いたら(保存設定が ON なら)自動でモデルをロードして開始。
  // 検出器は常駐するので unmount では破棄しない(タブ往復で再ロードしない)。
  useEffect(() => {
    if (autoStartedRef.current) return
    autoStartedRef.current = true
    if (autoPref) void startAuto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function addToTray(dataUrl: string, ms: number) {
    setTray((t) => [...t, { id: idRef.current++, dataUrl, ms }])
  }

  function removeFromTray(id: number) {
    setTray((t) => t.filter((x) => x.id !== id))
  }

  // 手動シャッター → トレイへ追加(送信は「送信」ボタンでまとめて)
  function shoot() {
    const url = grabFrame()
    if (!url) {
      setMessage('カメラの準備ができていません。')
      return
    }
    triggerFlash()
    addToTray(url, Date.now())
    setMessage('')
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
      if (!det || !video || !video.videoWidth) return
      busy = true
      try {
        const canvas = loopCanvasRef.current ?? (loopCanvasRef.current = document.createElement('canvas'))
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dets = await det.detect({ canvas, width: canvas.width, height: canvas.height })
        const primary: Detection | null = dets.length
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

        // 収束 & arm 済み → トレイへ追加(連続)
        if (primary && converged && armedRef.current && !captureBusyRef.current) {
          armedRef.current = false
          stableRef.current = 0
          captureBusyRef.current = true
          try {
            const url = grabFrame()
            if (url) {
              playShutterSound()
              triggerFlash()
              addToTray(url, Date.now())
            }
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

  // モデルをロードして連続撮影を開始(スピナー表示は autoStatus==='loading')。
  async function startAuto() {
    unlockShutterAudio()
    if (autoStatus === 'on' || autoStatus === 'loading') return
    setAutoStatus('loading')
    try {
      detectorRef.current = await getDetector()
      stableRef.current = 0
      lastBoxRef.current = null
      armedRef.current = true
      setAutoStatus('on')
    } catch {
      setAutoStatus('unavailable')
    }
  }

  // トグル: ON/OFF を localStorage に保存し、次回開いたときに適用する。
  function toggleAuto() {
    unlockShutterAudio()
    if (autoStatus === 'on' || autoStatus === 'loading') {
      setAutoPref(false)
      setAutoStatus('off')
    } else {
      setAutoPref(true)
      void startAuto()
    }
  }

  async function toggleRecord() {
    if (recording) {
      const clip = (await recorderRef.current?.stop()) ?? null
      recorderRef.current = null
      setRecording(false)
      if (clip) setAudioClip(clip) // セットの説明音声として保持(送信時に同梱)
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

  // セット送信: 全画像 + 音声(録音中なら止めて同梱)を1リクエストで一括アップロード
  async function uploadSet() {
    if (tray.length === 0 || uploading) return
    let clip = audioClip
    if (recording) {
      clip = (await recorderRef.current?.stop()) ?? clip
      recorderRef.current = null
      setRecording(false)
      setAudioClip(clip)
    }
    const count = tray.length
    setUploading(true)
    setMessage('')
    try {
      await uploadBatch(connection.serverUrl, connection.deviceToken, {
        images: tray.map((t) => ({ dataUrl: t.dataUrl })),
        audio: clip?.blob,
        metadata: { source: 'mobile', captured_at_ms: tray.map((t) => t.ms) },
      })
      setSentCount((n) => n + count)
      setTray([])
      setAudioClip(null)
      setMessage('')
      // 完了 → ダッシュボードへ遷移し、処理中であることをトーストで知らせる。
      showToast(`${count}枚を送信しました。サーバで現在処理しております。`)
      onSent?.()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '送信に失敗しました。')
    } finally {
      setUploading(false)
    }
  }

  const autoLabel =
    autoStatus === 'loading' ? 'AI準備中…'
    : autoStatus === 'on' ? '撮影中（タップで停止）'
    : autoStatus === 'unavailable' ? '読み込み失敗・再試行'
    : '自動撮影を開始'
  const audioSecs = audioClip ? Math.round(audioClip.durationMs / 1000) : 0

  return (
    <div className="capture-screen">
      <div className="cam-area">
        <video ref={videoRef} className="cam-video" autoPlay muted playsInline />
        {autoStatus === 'on' && <canvas ref={overlayRef} className="cam-overlay" />}
        {flash && <div className="cam-flash" />}
        {autoStatus === 'loading' && (
          <div className="cam-spinner">
            <span className="spinner lg" />
            <span>AIモデルを準備中…</span>
          </div>
        )}
        <button
          className={`auto-toggle${autoStatus === 'on' ? ' on' : ''}${autoStatus === 'unavailable' ? ' off' : ''}`}
          onClick={toggleAuto}
          disabled={autoStatus === 'loading'}
        >
          {autoLabel}
        </button>
        {!camError && (
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

      {tray.length > 0 && (
        <div className="tray" aria-label="撮影トレイ">
          {tray.map((item) => (
            <div className="tray-item" key={item.id}>
              <img src={item.dataUrl} alt="撮影" />
              <button className="tray-del" onClick={() => removeFromTray(item.id)} aria-label="削除">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="capture-controls">
        <button className={`rec-button${recording ? ' on' : ''}`} onClick={() => void toggleRecord()}>
          {recording ? '■ 録音停止' : audioClip ? `● 音声 ${audioSecs}秒` : '● 音声メモ'}
        </button>
        <button className="shutter" onClick={shoot} aria-label="撮影" />
        <button
          className="accent-button send"
          disabled={uploading || tray.length === 0}
          onClick={() => void uploadSet()}
        >
          {uploading ? (
            <>
              <span className="spinner" />
              送信中…
            </>
          ) : (
            `送信 (${tray.length})`
          )}
        </button>
      </div>

      <p className="muted small center">
        {message ||
          (autoStatus === 'loading'
            ? 'AIモデルを読み込んでいます…(初回は数秒)'
            : recording
              ? '録音中…領収書を撮りながら声で説明。送信時に画像とまとめて解析されます。'
              : tray.length > 0
                ? `${tray.length}枚をトレイに保持中。撮り終えたら「送信」。`
                : autoStatus === 'on'
                  ? '自動撮影中(収束で自動・対象を替えると次へ)。撮った写真はトレイに溜まります。'
                  : sentCount > 0
                    ? `この端末から送信: ${sentCount}枚`
                    : `${connection.clientName ?? '顧問先'} に送信します`)}
      </p>
    </div>
  )
}
