import { useEffect, useRef, useState } from 'react'
import { uploadCapture } from '../api/server-api'
import { MediaRecorderService, getMediaRecordingSupport } from '../services/audio/media-recorder-service'
import type { RecordedAudioClip } from '../types/audio'
import { useAppStore } from '../store/app-store'

/** 撮影画面: 写真＋(任意)音声メモを撮ってサーバへアップロード。AI処理はサーバ側。 */
export function CaptureScreen() {
  const connection = useAppStore((state) => state.connection)!
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorderService | null>(null)
  const [camError, setCamError] = useState('')
  const [captured, setCaptured] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [audioClip, setAudioClip] = useState<RecordedAudioClip | null>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)

  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('この端末ではカメラを利用できません。')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setCamError('カメラを起動できませんでした。アプリのカメラ権限を確認してください。')
        return
      }
      const video = videoRef.current
      if (!video || stopped) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      try {
        await video.play()
      } catch {
        /* autoplay 差異は無視 */
      }
    }
    void start()
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

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

  const audioSecs = audioClip ? Math.round(audioClip.durationMs / 1000) : 0

  return (
    <div className="capture-screen">
      <div className="cam-area">
        <video ref={videoRef} className="cam-video" style={{ display: captured ? 'none' : 'block' }} />
        {captured && <img className="cam-shot" src={captured} alt="撮影画像" />}
        {camError && <div className="cam-error">{camError}</div>}
      </div>

      {!captured ? (
        <div className="capture-controls">
          <button className={`rec-button${recording ? ' on' : ''}`} onClick={() => void toggleRecord()}>
            {recording ? '■ 録音停止' : '● 音声メモ'}
          </button>
          <button className="shutter" onClick={shoot} aria-label="撮影" />
          <div className="rec-status">{recording ? '録音中…' : '　'}</div>
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
