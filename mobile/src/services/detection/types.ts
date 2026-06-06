// 自動スキャナの物体検出インターフェース。
// YOLO(onnxruntime-web)/ プレースホルダ等を差し替え可能にするための共通型。

export interface DetectionBox {
  /** ソース画像のピクセル座標(左上原点) */
  x: number
  y: number
  width: number
  height: number
}

export interface Detection {
  box: DetectionBox
  /** 0..1 の確信度 */
  score: number
  label: string
}

/** 検出対象フレーム。現在のプレビューを描画済みの canvas を渡す。 */
export interface DetectorFrame {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

export interface ObjectDetector {
  /** 表示・ログ用の名前(例: "yolo-onnx" / "placeholder") */
  readonly name: string
  /** モデル読み込み等の初期化。失敗時は例外。 */
  load(): Promise<void>
  isReady(): boolean
  /** 1 フレーム検出。box はソースピクセル座標で返す。 */
  detect(frame: DetectorFrame): Promise<Detection[]>
  dispose(): void
}
