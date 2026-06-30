import { useEffect, useRef, useState } from 'react'

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

/**
 * 全画面のライブカメラプレビューを出しながらQRを検出するオーバーレイ。
 * 検出したら onResult(値)、閉じる時は onCancel()。背面カメラを使う。
 */
export function QrScannerOverlay({
  onResult,
  onCancel,
}: {
  onResult: (value: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('この端末ではカメラを使用できません。')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setError('カメラを起動できませんでした。アプリのカメラ権限を確認してください。')
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      try {
        await video.play()
      } catch {
        /* autoplay の差異は無視 */
      }
      const Detector = detectorCtor()
      if (!Detector) {
        setError('この端末はQRの自動検出に未対応です。トークンを手入力してください。')
        return
      }
      const detector = new Detector({ formats: ['qr_code'] })
      const tick = async () => {
        if (stopped) return
        try {
          const codes = await detector.detect(video)
          if (codes.length > 0 && codes[0].rawValue) {
            onResult(codes[0].rawValue)
            return
          }
        } catch {
          /* 1フレームの検出失敗は無視して続行 */
        }
        timer = setTimeout(() => void tick(), 200)
      }
      void tick()
    }
    void start()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onResult])

  return (
    <div className="qr-overlay" role="dialog" aria-label="QRスキャン">
      <video ref={videoRef} className="qr-video" />
      <div className="qr-mask">
        <div className="qr-frame" />
        <p className="qr-hint">{error || 'QRコードを枠に合わせてください'}</p>
        <button type="button" className="qr-cancel" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  )
}
