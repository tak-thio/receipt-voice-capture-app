import type { InferenceSession, Tensor } from 'onnxruntime-web'
import type { Detection, DetectionBox, DetectorFrame, ObjectDetector } from './types'

type OrtModule = typeof import('onnxruntime-web')

// iOS WKWebView は WebGPU 不可なので WASM(SIMD)で動かす。wasm 本体は Vite が
// バンドルし、onnxruntime-web が import.meta.url 経由で解決する(同梱=オフライン可)。

export interface YoloOnnxOptions {
  modelUrl: string
  classNames: string[]
  inputSize?: number
  scoreThreshold?: number
  iouThreshold?: number
}

/**
 * YOLOv8 系 ONNX を onnxruntime-web で動かす検出器。
 * 出力は [1, 4+numClasses, numAnchors] / [1, numAnchors, 4+numClasses] の両レイアウトに対応。
 * レシート学習モデル(同形式の YOLOv8 export)をそのまま差し替え可能。
 */
export class YoloOnnxDetector implements ObjectDetector {
  readonly name = 'yolo-onnx'
  private ort: OrtModule | null = null
  private session: InferenceSession | null = null
  private inputCanvas: HTMLCanvasElement | null = null
  private loggedShape = false
  private readonly opts: Required<YoloOnnxOptions>

  constructor(options: YoloOnnxOptions) {
    this.opts = {
      inputSize: 640,
      scoreThreshold: 0.45,
      iouThreshold: 0.45,
      ...options,
    }
  }

  isReady(): boolean {
    return this.session !== null
  }

  async load(): Promise<void> {
    const ort = await import('onnxruntime-web')
    this.ort = ort
    this.session = await ort.InferenceSession.create(this.opts.modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  }

  dispose(): void {
    void this.session?.release()
    this.session = null
    this.ort = null
    this.inputCanvas = null
  }

  async detect(frame: DetectorFrame): Promise<Detection[]> {
    const ort = this.ort
    const session = this.session
    if (!ort || !session) {
      return []
    }
    const size = this.opts.inputSize

    if (!this.inputCanvas) {
      this.inputCanvas = document.createElement('canvas')
      this.inputCanvas.width = size
      this.inputCanvas.height = size
    }
    const ictx = this.inputCanvas.getContext('2d', { willReadFrequently: true })
    if (!ictx) {
      return []
    }

    // letterbox(アスペクト維持で 640x640 にパディング)
    const srcW = frame.canvas.width
    const srcH = frame.canvas.height
    const scale = Math.min(size / srcW, size / srcH)
    const drawW = Math.round(srcW * scale)
    const drawH = Math.round(srcH * scale)
    const padX = Math.floor((size - drawW) / 2)
    const padY = Math.floor((size - drawH) / 2)
    ictx.fillStyle = '#727272'
    ictx.fillRect(0, 0, size, size)
    ictx.drawImage(frame.canvas, 0, 0, srcW, srcH, padX, padY, drawW, drawH)
    const pixels = ictx.getImageData(0, 0, size, size).data

    // NCHW float32, RGB /255
    const area = size * size
    const input = new Float32Array(3 * area)
    for (let i = 0, p = 0; i < area; i += 1, p += 4) {
      input[i] = pixels[p] / 255
      input[i + area] = pixels[p + 1] / 255
      input[i + 2 * area] = pixels[p + 2] / 255
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, size, size])
    const results = await session.run({ [session.inputNames[0]]: tensor })
    const output = results[session.outputNames[0]] as Tensor
    const dims = output.dims
    const data = output.data as Float32Array

    if (!this.loggedShape) {
      this.loggedShape = true
      // モデル差し替え時のデバッグ用に出力形状を一度だけ出す
      console.info('[yolo] output dims', Array.from(dims))
    }

    const d1 = Number(dims[1] ?? 0)
    const d2 = Number(dims[2] ?? 0)
    if (d1 === 0 || d2 === 0) {
      return []
    }
    const channelsFirst = d1 < d2 // [1, C, N] は C(=4+cls) < N(=anchors)
    const numChannels = channelsFirst ? d1 : d2
    const numAnchors = channelsFirst ? d2 : d1
    const numClasses = numChannels - 4
    if (numClasses <= 0) {
      return []
    }

    const at = (anchor: number, channel: number): number =>
      channelsFirst ? data[channel * numAnchors + anchor] : data[anchor * numChannels + channel]

    const detections: Detection[] = []
    for (let i = 0; i < numAnchors; i += 1) {
      let best = 0
      let bestClass = 0
      for (let c = 0; c < numClasses; c += 1) {
        const score = at(i, 4 + c)
        if (score > best) {
          best = score
          bestClass = c
        }
      }
      if (best < this.opts.scoreThreshold) {
        continue
      }
      const cx = at(i, 0)
      const cy = at(i, 1)
      const w = at(i, 2)
      const h = at(i, 3)
      detections.push({
        box: {
          x: (cx - w / 2 - padX) / scale,
          y: (cy - h / 2 - padY) / scale,
          width: w / scale,
          height: h / scale,
        },
        score: best,
        label: this.opts.classNames[bestClass] ?? String(bestClass),
      })
    }

    return nonMaxSuppression(detections, this.opts.iouThreshold)
  }
}

function nonMaxSuppression(detections: Detection[], iouThreshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const det of sorted) {
    if (kept.every((k) => intersectionOverUnion(k.box, det.box) < iouThreshold)) {
      kept.push(det)
    }
  }
  return kept
}

function intersectionOverUnion(a: DetectionBox, b: DetectionBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}
