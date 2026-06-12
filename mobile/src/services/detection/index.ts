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

// 仮モデルは yolov8n-face(顔検出、1クラス 'face')。「枠+パシャッ」の体感&座標確認用。
// レシート学習モデル(YOLOv8 export)を public/models/detector.onnx に置いたら、
// classNames を ['receipt'] 等に、targetLabels をそのラベルに更新する。
export const DETECTION_CONFIG: DetectionConfig = {
  modelUrl: '/models/detector.onnx',
  classNames: ['face'],
  targetLabels: ['face'],
  scoreThreshold: 0.5,
  iouThreshold: 0.45,
}

export async function createDetector(config: DetectionConfig = DETECTION_CONFIG): Promise<ObjectDetector> {
  const detector = new YoloOnnxDetector({
    modelUrl: config.modelUrl,
    classNames: config.classNames,
    scoreThreshold: config.scoreThreshold,
    iouThreshold: config.iouThreshold,
  })
  await detector.load()
  return detector
}
