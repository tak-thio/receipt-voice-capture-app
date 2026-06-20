import { useEffect, useRef, useState } from 'react'
import { uploadBatch } from '../api/server-api'
import { MediaRecorderService, getMediaRecordingSupport } from '../services/audio/media-recorder-service'
import { isNativeAudioAvailable, nativeStartRecording, nativeStopRecording } from '../services/audio/native-recorder'
import type { RecordedAudioClip } from '../types/audio'
import { useAppStore } from '../store/app-store'

type TrayItem = { id: number; dataUrl: string; ms: number }

/** 撮影画面: 手動シャッターで撮った写真をトレイに溜め、録音(セットの説明音声)を添えて
 * 「送信」で全画像+音声を1リクエストで一括送信する。サーバが1回のAI呼び出しで
 * 全件(1枚に複数・カード明細含む)を解析する。 */
export function CaptureScreen({ onSent }: { onSent?: () => void }) {
  const connection = useAppStore((state) => state.connection)!
  const showToast = useAppStore((state) => state.showToast)
  const uploadMode = useAppStore((state) => state.uploadMode)
  const setUploadMode = useAppStore((state) => state.setUploadMode)
  // 未設定なら役割で既定(一般社員=経費精算 / それ以外=請求書)。トグルで上書き・永続化。
  const mode = uploadMode ?? (connection.role === 'client_user' ? 'expense' : 'company')
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const idRef = useRef(1)
  const nativeAudio = isNativeAudioAvailable() // Android はネイティブ録音(反応が速い)
  const nativeStartRef = useRef(0)

  const [camError, setCamError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [tray, setTray] = useState<TrayItem[]>([])
  const [recording, setRecording] = useState(false)
  const [audioClip, setAudioClip] = useState<RecordedAudioClip | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)
  const [flash, setFlash] = useState(false)

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
        stream = await navigator.mediaDevices.getUserMedia({
          // 解像度上限のヒント(無駄に高画質な巨大フレームを避ける。端末が最も近い値を選ぶ)。
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        })
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

  // マイクを温めておく(WebView録音時のみ。ネイティブ録音は温め不要)。画面を離れたら解放。
  useEffect(() => {
    if (nativeAudio) return
    const rec = recorderRef.current ?? (recorderRef.current = new MediaRecorderService())
    rec.prepare().catch(() => {
      /* 権限未許可など。実際の録音時に再取得を試みる */
    })
    return () => rec.release()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function grabFrame(): string | null {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    // 撮影画像は長辺を抑えてからJPEG化(アップロード帯域とAIトークンの節約。原本も不要に大きくしない)。
    const MAX_EDGE = 1920
    const vw = video.videoWidth
    const vh = video.videoHeight
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vw * scale)
    canvas.height = Math.round(vh * scale)
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

  // 録音停止 → クリップ取得(ネイティブ/WebView 共通)。
  async function stopToClip(): Promise<RecordedAudioClip | null> {
    if (nativeAudio) {
      const r = await nativeStopRecording()
      const startedMs = nativeStartRef.current
      const endedMs = Date.now()
      return {
        blob: r.blob,
        objectUrl: URL.createObjectURL(r.blob),
        mimeType: r.mime,
        size: r.blob.size,
        durationMs: endedMs - startedMs,
        startedAt: new Date(startedMs).toISOString(),
        endedAt: new Date(endedMs).toISOString(),
      }
    }
    return (await recorderRef.current?.stop()) ?? null
  }

  async function toggleRecord() {
    if (recording) {
      setRecording(false) // タップ即反映
      try {
        const clip = await stopToClip()
        if (clip) setAudioClip(clip) // セットの説明音声として保持(送信時に同梱)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '録音の停止に失敗しました。')
      }
      return
    }
    if (nativeAudio) {
      setRecording(true) // 楽観的に即「録音中」
      nativeStartRef.current = Date.now()
      try {
        await nativeStartRecording()
      } catch (error) {
        setRecording(false)
        setMessage(error instanceof Error ? error.message : '録音を開始できませんでした。')
      }
      return
    }
    const support = getMediaRecordingSupport()
    if (!support.supported) {
      setMessage(support.reason ?? '録音を利用できません。')
      return
    }
    const recorder = recorderRef.current ?? (recorderRef.current = new MediaRecorderService())
    setRecording(true) // 楽観的に即「録音中」表示(マイクは温め済みなので即開始)
    try {
      await recorder.start()
    } catch (error) {
      setRecording(false)
      setMessage(error instanceof Error ? error.message : '録音を開始できませんでした。')
    }
  }

  // セット送信: 全画像 + 音声(録音中なら止めて同梱)を1リクエストで一括アップロード
  async function uploadSet() {
    if (tray.length === 0 || uploading) return
    let clip = audioClip
    if (recording) {
      setRecording(false)
      try {
        clip = (await stopToClip()) ?? clip
      } catch {
        /* 録音停止に失敗しても画像だけ送る */
      }
      setAudioClip(clip)
    }
    const count = tray.length
    setUploading(true)
    setMessage('')
    try {
      await uploadBatch(connection.serverUrl, connection.deviceToken, {
        images: tray.map((t) => ({ dataUrl: t.dataUrl })),
        audio: clip?.blob,
        lane: mode, // 請求書(company) / 経費精算(expense)
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

  const audioSecs = audioClip ? Math.round(audioClip.durationMs / 1000) : 0

  return (
    <div className="capture-screen">
      {/* アップロード先のモード(請求書=会社の受信箱 / 経費精算=立替トレイ)。選択は維持される。 */}
      <div
        style={{
          display: 'flex', margin: '8px auto 4px', borderRadius: 8, overflow: 'hidden',
          border: '1px solid #cbd5e1', maxWidth: 300, width: '100%',
        }}
      >
        {(['company', 'expense'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setUploadMode(m)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 14, border: 'none', cursor: 'pointer',
              background: mode === m ? '#2563eb' : '#fff',
              color: mode === m ? '#fff' : '#334155',
              fontWeight: mode === m ? 700 : 400,
            }}
          >
            {m === 'company' ? '請求書' : '経費精算'}
          </button>
        ))}
      </div>
      <div className="cam-area">
        <video ref={videoRef} className="cam-video" autoPlay muted playsInline />
        {flash && <div className="cam-flash" />}
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
          (recording
            ? '録音中…領収書を撮りながら声で説明。送信時に画像とまとめて解析されます。'
            : tray.length > 0
              ? `${tray.length}枚をトレイに保持中。撮り終えたら「送信」。`
              : sentCount > 0
                ? `この端末から送信: ${sentCount}枚`
                : `${connection.clientName ?? '顧問先'} に送信します`)}
      </p>
    </div>
  )
}
