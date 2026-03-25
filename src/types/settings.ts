export type AdapterMode = 'mock' | 'local'

export interface AppSettings {
  storageRoot: string
  preferredCameraId: string
  preferredMicrophoneId: string
  sttMode: AdapterMode
  sttModel: string
  sttDevice: string
  sttComputeType: string
  sttLanguage: string
  sttBeamSize: number
  ocrEnabled: boolean
  ocrMode: AdapterMode
  exportTargetDefault: 'freee' | 'yayoi' | 'generic'
}
