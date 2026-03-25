export type AdapterMode = 'mock' | 'local'

export interface AppSettings {
  storageRoot: string
  preferredCameraId: string
  preferredMicrophoneId: string
  sttMode: AdapterMode
  ocrEnabled: boolean
  ocrMode: AdapterMode
  exportTargetDefault: 'freee' | 'yayoi' | 'generic'
}
