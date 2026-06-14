/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import type { Detection, DetectionBox } from './types'

// YOLO 推論をメインスレッドから切り離すためのワーカー。プレビューやタップを
// ブロックしないよう、ここで letterbox + 推論 + NMS を行い結果だけ返す。
// DOM が無いので OffscreenCanvas を使う。

type LoadMsg = {
  type: 'load'
  modelUrl: string
  inputSize: number
  scoreThreshold: number
  iouThreshold: number
  classNames: string[]
}
type DetectMsg = { type: 'detect'; reqId: number; bitmap: ImageBitmap }
type InMsg = LoadMsg | DetectMsg

let session: ort.InferenceSession | null = null
let canvas: OffscreenCanvas | null = null
let opts = { inputSize: 640, scoreThreshold: 0.45, iouThreshold: 0.45, classNames: ['face'] }
let loggedShape = false

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  if (msg.type === 'load') {
    opts = {
      inputSize: msg.inputSize,
      scoreThreshold: msg.scoreThreshold,
      iouThreshold: msg.iouThreshold,
      classNames: msg.classNames,
    }
    try {
      session = await ort.InferenceSession.create(msg.modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      ctx.postMessage({ type: 'loaded' })
    } catch (err) {
      ctx.postMessage({ type: 'load-error', error: String(err) })
    }
    return
  }
  if (msg.type === 'detect') {
    let dets: Detection[] = []
    try {
      dets = await detect(msg.bitmap)
    } catch {
      dets = []
    } finally {
      msg.bitmap.close()
    }
    ctx.postMessage({ type: 'result', reqId: msg.reqId, dets })
  }
}

async function detect(bitmap: ImageBitmap): Promise<Detection[]> {
  if (!session) return []
  const size = opts.inputSize
  if (!canvas) canvas = new OffscreenCanvas(size, size)
  const ictx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ictx) return []

  // letterbox(アスペクト維持で size x size にパディング)
  const srcW = bitmap.width
  const srcH = bitmap.height
  const scale = Math.min(size / srcW, size / srcH)
  const drawW = Math.round(srcW * scale)
  const drawH = Math.round(srcH * scale)
  const padX = Math.floor((size - drawW) / 2)
  const padY = Math.floor((size - drawH) / 2)
  ictx.fillStyle = '#727272'
  ictx.fillRect(0, 0, size, size)
  ictx.drawImage(bitmap, 0, 0, srcW, srcH, padX, padY, drawW, drawH)
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
  const output = results[session.outputNames[0]] as ort.Tensor
  const dims = output.dims
  const data = output.data as Float32Array

  if (!loggedShape) {
    loggedShape = true
    console.info('[yolo-worker] output dims', Array.from(dims))
  }

  const d1 = Number(dims[1] ?? 0)
  const d2 = Number(dims[2] ?? 0)
  if (d1 === 0 || d2 === 0) return []
  const channelsFirst = d1 < d2
  const numChannels = channelsFirst ? d1 : d2
  const numAnchors = channelsFirst ? d2 : d1
  // クラス数は box(4) を除いた残り。顔モデル等はランドマーク列が続くので classNames に丸める。
  const numClasses = Math.min(numChannels - 4, opts.classNames.length)
  if (numClasses <= 0) return []

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
    if (best < opts.scoreThreshold) continue
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
      label: opts.classNames[bestClass] ?? String(bestClass),
    })
  }

  return nonMaxSuppression(detections, opts.iouThreshold)
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
