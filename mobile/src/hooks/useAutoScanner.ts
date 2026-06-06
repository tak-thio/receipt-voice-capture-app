import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  DETECTION_CONFIG,
  createDetector,
  playShutterSound,
} from '../services/detection'
import type { Detection, DetectionBox, ObjectDetector } from '../services/detection'

export interface ScannerCapture {
  imageDataUrl: string
  width: number
  height: number
  /**
   * シャッターを切った時刻(壁時計 ISO)。
   * 音声タイムライン(audioClip.startedAt + STT events)と同じ時間軸で突き合わせるため、
   * performance.now ではなく Date ベースの絶対時刻を持つ。
   */
  capturedAt: string
  /** このキャプチャを発火させた検出(bbox/score/label)。メタデータに使う。 */
  detection: Detection
}

export interface UseAutoScannerOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  enabled: boolean
  onCapture: (capture: ScannerCapture) => void
  detectionIntervalMs?: number
  /** 連続で安定検出したら発火するフレーム数 */
  stabilityFrames?: number
  /** 連続発火を抑えるクールダウン(重複はOKなので短め) */
  cooldownMs?: number
  /** 連続フレームの枠 IoU がこれ以上なら「動いていない=安定」とみなす */
  settleIou?: number
  /** 見切れ(枠が画面端に接触)時に必要な安定フレーム数 */
  partialStabilityFrames?: number
}

export interface AutoScannerState {
  /** 表示用の検出ボックス(video の intrinsic 座標) */
  detections: Detection[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  captureCount: number
  /** 枠が安定し、シャッター直前まで来ている(=ロックオン中) */
  settled: boolean
}

const DETECT_WIDTH = 320

export function useAutoScanner(options: UseAutoScannerOptions): AutoScannerState {
  const { videoRef, enabled } = options
  const intervalMs = options.detectionIntervalMs ?? 180
  const stabilityFrames = options.stabilityFrames ?? 4
  const cooldownMs = options.cooldownMs ?? 1400
  const settleIou = options.settleIou ?? 0.78
  const partialStabilityFrames = options.partialStabilityFrames ?? stabilityFrames * 2

  const [detections, setDetections] = useState<Detection[]>([])
  const [status, setStatus] = useState<AutoScannerState['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const [captureCount, setCaptureCount] = useState(0)
  const [settled, setSettled] = useState(false)

  const detectorRef = useRef<ObjectDetector | null>(null)
  const detCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const stableCountRef = useRef(0)
  const lastCaptureRef = useRef(0)
  const prevBoxRef = useRef<DetectionBox | null>(null)
  const onCaptureRef = useRef(options.onCapture)
  onCaptureRef.current = options.onCapture

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setDetections([])
      setSettled(false)
      stableCountRef.current = 0
      prevBoxRef.current = null
      return
    }

    let cancelled = false
    let timer: number | null = null
    setStatus('loading')
    setError(null)

    function captureCrop(video: HTMLVideoElement, best: Detection): void {
      // シャッター瞬間の壁時計時刻を確定(以降の処理時間に左右されない)。
      const capturedAt = new Date().toISOString()
      const vw = video.videoWidth
      const vh = video.videoHeight
      const margin = 0.06
      let bx = best.box.x - best.box.width * margin
      let by = best.box.y - best.box.height * margin
      let bw = best.box.width * (1 + margin * 2)
      let bh = best.box.height * (1 + margin * 2)
      bx = Math.max(0, bx)
      by = Math.max(0, by)
      bw = Math.min(vw - bx, bw)
      bh = Math.min(vh - by, bh)
      if (bw < 8 || bh < 8) {
        return
      }

      if (!cropCanvasRef.current) {
        cropCanvasRef.current = document.createElement('canvas')
      }
      const canvas = cropCanvasRef.current
      canvas.width = Math.round(bw)
      canvas.height = Math.round(bh)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return
      }
      ctx.drawImage(video, bx, by, bw, bh, 0, 0, canvas.width, canvas.height)
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)

      playShutterSound()
      setCaptureCount((count) => count + 1)
      onCaptureRef.current({
        imageDataUrl,
        width: canvas.width,
        height: canvas.height,
        capturedAt,
        detection: best,
      })
    }

    async function tick(video: HTMLVideoElement, detector: ObjectDetector): Promise<void> {
      const vw = video.videoWidth
      const vh = video.videoHeight
      const detW = DETECT_WIDTH
      const detH = Math.max(1, Math.round((vh / vw) * detW))

      if (!detCanvasRef.current) {
        detCanvasRef.current = document.createElement('canvas')
      }
      const detCanvas = detCanvasRef.current
      detCanvas.width = detW
      detCanvas.height = detH
      const detCtx = detCanvas.getContext('2d', { willReadFrequently: true })
      if (!detCtx) {
        return
      }
      detCtx.drawImage(video, 0, 0, detW, detH)

      const raw = await detector.detect({ canvas: detCanvas, width: detW, height: detH })

      // 検出座標(detction canvas)→ video intrinsic 座標
      const sx = vw / detW
      const sy = vh / detH
      const scaled = raw.map((det) => ({
        ...det,
        box: {
          x: det.box.x * sx,
          y: det.box.y * sy,
          width: det.box.width * sx,
          height: det.box.height * sy,
        },
      }))
      const targets = DETECTION_CONFIG.targetLabels
      const visible = targets ? scaled.filter((det) => targets.includes(det.label)) : scaled
      setDetections(visible)

      const best = visible.reduce<Detection | null>(
        (acc, det) => (!acc || det.score > acc.score ? det : acc),
        null,
      )

      // 枠の「動きが収まったか(ブレ)」を連続フレームの IoU で見る。
      // 動いていない時だけカウントを積み、動いている間は減衰させて撮らない。
      let isPartial = false
      if (best && best.score >= DETECTION_CONFIG.scoreThreshold) {
        const prev = prevBoxRef.current
        const settledNow = prev ? boxIou(best.box, prev) >= settleIou : false
        prevBoxRef.current = best.box
        isPartial = isBoxPartial(best.box, vw, vh)
        if (settledNow) {
          stableCountRef.current += 1
        } else {
          stableCountRef.current = Math.max(0, stableCountRef.current - 2)
        }
      } else {
        stableCountRef.current = 0
        prevBoxRef.current = null
      }

      // 見切れ(枠が画面端に接触)時は必要フレーム数を多めにして、構えてから撮る。
      const needed = isPartial ? partialStabilityFrames : stabilityFrames
      setSettled(best != null && stableCountRef.current >= Math.max(2, Math.ceil(needed / 2)))

      const now = performance.now()
      if (
        best &&
        stableCountRef.current >= needed &&
        now - lastCaptureRef.current >= cooldownMs
      ) {
        lastCaptureRef.current = now
        stableCountRef.current = 0
        prevBoxRef.current = null
        captureCrop(video, best)
      }
    }

    async function loop(): Promise<void> {
      if (cancelled) {
        return
      }
      const video = videoRef.current
      const detector = detectorRef.current
      if (video && detector && video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          await tick(video, detector)
        } catch {
          // 1 フレームの失敗は無視して継続
        }
      }
      if (!cancelled) {
        timer = window.setTimeout(() => void loop(), intervalMs)
      }
    }

    async function init(): Promise<void> {
      try {
        if (!detectorRef.current) {
          detectorRef.current = await createDetector()
        }
        if (cancelled) {
          return
        }
        setStatus('ready')
        void loop()
      } catch (loadError) {
        if (cancelled) {
          return
        }
        setStatus('error')
        setError(
          loadError instanceof Error
            ? `検出モデルを読み込めませんでした: ${loadError.message}`
            : '検出モデルを読み込めませんでした。',
        )
      }
    }

    void init()

    return () => {
      cancelled = true
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [enabled, intervalMs, stabilityFrames, cooldownMs, videoRef])

  // アンマウント時のみ検出器を解放(有効/無効の往復では使い回す)
  useEffect(
    () => () => {
      detectorRef.current?.dispose()
      detectorRef.current = null
    },
    [],
  )

  return { detections, status, error, captureCount, settled }
}

function boxIou(a: DetectionBox, b: DetectionBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

function isBoxPartial(box: DetectionBox, frameWidth: number, frameHeight: number): boolean {
  const margin = Math.min(frameWidth, frameHeight) * 0.02
  return (
    box.x <= margin ||
    box.y <= margin ||
    box.x + box.width >= frameWidth - margin ||
    box.y + box.height >= frameHeight - margin
  )
}
