export type AdapterMode = 'mock' | 'local'
export type AiProvider = 'openai' | 'gemini'
export type SttMode = AdapterMode | AiProvider
export type AiFormatMode = 'rule' | AiProvider | 'local'
export type OcrMode = AdapterMode | 'gemini'

/**
 * standalone の取り込み方式:
 * voice = 音声中心(現行。発話を主データに画像で照合)
 * image = 画像中心(画像から事実を抽出し、音声を摘要+合計の特定=精度向上に使う)
 */
export type CaptureStrategy = 'voice' | 'image'

/**
 * standalone = 端末完結(各自キーでAI、ローカル保存)
 * linked     = サーバ連携(QRペアリング、撮影はサーバへ、AIはサーバ=事務所キー)
 */
export type AppMode = 'standalone' | 'linked'

export interface AppSettings {
  appMode: AppMode
  serverUrl: string
  serverDeviceToken: string
  serverClientId: string
  storageRoot: string
  sttMode: SttMode
  sttModel: string
  sttDevice: string
  sttComputeType: string
  sttLanguage: string
  sttBeamSize: number
  aiProvider: AiProvider
  openaiApiKey: string
  geminiApiKey: string
  openaiSttModel: string
  geminiModel: string
  aiFormatMode: AiFormatMode
  aiFormatterModel: string
  ocrEnabled: boolean
  ocrMode: OcrMode
  captureStrategy: CaptureStrategy
  exportTargetDefault: 'freee' | 'yayoi' | 'generic' | 'mas'
}
