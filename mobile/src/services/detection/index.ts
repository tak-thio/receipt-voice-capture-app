import { YoloOnnxDetector } from './yolo-onnx-detector'
import type { ObjectDetector } from './types'

export type { Detection, DetectionBox, DetectorFrame, ObjectDetector } from './types'
export { playShutterSound, unlockShutterAudio } from './shutter-sound'

export interface DetectionConfig {
  modelUrl: string
  classNames: string[]
  /** 自動シャッターの対象ラベル。null なら全クラス対象。 */
  targetLabels: string[] | null
  scoreThreshold: number
  iouThreshold: number
}

// 領収書検出モデル(YOLO11n, 1クラス '領収書' / train_624e29de.pt を ONNX export)。
// public/models/detector.onnx に配置(gitignore・APK同梱)。差し替え時は
// classNames / targetLabels をそのモデルの model.names に合わせる。
export const DETECTION_CONFIG: DetectionConfig = {
  modelUrl: '/models/detector.onnx',
  classNames: ['領収書'],
  targetLabels: ['領収書'],
  // モデルがほぼ未学習なのでデモ用に低め。枠に信頼度%が出るので実機を見て調整する。
  scoreThreshold: 0.15,
  iouThreshold: 0.45,
}

export async function createDetector(config: DetectionConfig = DETECTION_CONFIG): Promise<ObjectDetector> {
  // メインスレッドで実行(実機リリースで確実に動く構成)。Web Worker 版
  // (worker-detector.ts)は WebView で読込が不安定だったため一旦不使用。
  const detector = new YoloOnnxDetector({
    modelUrl: config.modelUrl,
    classNames: config.classNames,
    scoreThreshold: config.scoreThreshold,
    iouThreshold: config.iouThreshold,
  })
  await detector.load()
  return detector
}
