import type { Detection, DetectorFrame, ObjectDetector } from './types'

export interface WorkerDetectorOptions {
  modelUrl: string
  classNames: string[]
  inputSize?: number
  scoreThreshold?: number
  iouThreshold?: number
}

/**
 * YOLO 推論を Web Worker(detect.worker.ts)で実行する検出器。
 * 推論がメインスレッドを止めないので、自動シャッター中もプレビュー/操作が滑らか。
 * フレームは ImageBitmap にして transfer(ゼロコピー)で渡す。
 */
export class WorkerDetector implements ObjectDetector {
  readonly name = 'yolo-worker'
  private worker: Worker | null = null
  private ready = false
  private reqId = 0
  private pending = new Map<number, (d: Detection[]) => void>()
  private onLoaded: (() => void) | null = null
  private onLoadError: ((e: string) => void) | null = null
  private readonly opts: Required<WorkerDetectorOptions>

  constructor(options: WorkerDetectorOptions) {
    this.opts = {
      inputSize: 640,
      scoreThreshold: 0.45,
      iouThreshold: 0.45,
      ...options,
    }
  }

  isReady(): boolean {
    return this.ready
  }

  async load(): Promise<void> {
    const worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m?.type === 'loaded') {
        this.onLoaded?.()
      } else if (m?.type === 'load-error') {
        this.onLoadError?.(m.error ?? 'load failed')
      } else if (m?.type === 'result') {
        const cb = this.pending.get(m.reqId)
        if (cb) {
          this.pending.delete(m.reqId)
          cb((m.dets as Detection[]) ?? [])
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      this.onLoaded = resolve
      this.onLoadError = (msg) => reject(new Error(msg))
      worker.postMessage({
        type: 'load',
        modelUrl: this.opts.modelUrl,
        inputSize: this.opts.inputSize,
        scoreThreshold: this.opts.scoreThreshold,
        iouThreshold: this.opts.iouThreshold,
        classNames: this.opts.classNames,
      })
    })
    this.ready = true
  }

  async detect(frame: DetectorFrame): Promise<Detection[]> {
    const worker = this.worker
    if (!worker || !frame.width || !frame.height) return []
    const bitmap = await createImageBitmap(frame.canvas)
    const reqId = ++this.reqId
    return new Promise<Detection[]>((resolve) => {
      this.pending.set(reqId, resolve)
      worker.postMessage({ type: 'detect', reqId, bitmap }, [bitmap])
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.pending.clear()
  }
}
