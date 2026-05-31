export type AdapterMode = 'mock' | 'local'
export type AiProvider = 'openai' | 'gemini'
export type SttMode = AdapterMode | AiProvider
export type AiFormatMode = 'rule' | AiProvider | 'local'
export type OcrMode = AdapterMode | 'gemini'

export interface AppSettings {
  storageRoot: string
  preferredCameraId: string
  preferredMicrophoneId: string
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
  exportTargetDefault: 'freee' | 'yayoi' | 'generic' | 'mas'
}
