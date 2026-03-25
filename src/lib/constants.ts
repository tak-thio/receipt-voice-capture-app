import type { AppSettings } from '../types/settings'
import type { TaxMode } from '../types/domain'

export const APP_TITLE = 'Receipt Voice Capture'

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  inclusive: '税込',
  exclusive: '税抜',
  unknown: '未指定',
}

export const DEFAULT_SETTINGS: AppSettings = {
  storageRoot: 'receipt-sessions',
  preferredCameraId: '',
  preferredMicrophoneId: '',
  sttMode: 'mock',
  sttModel: 'small',
  sttDevice: 'cpu',
  sttComputeType: 'int8',
  sttLanguage: 'ja',
  sttBeamSize: 5,
  ocrEnabled: true,
  ocrMode: 'mock',
  exportTargetDefault: 'generic',
}

export const BOUNDARY_KEYWORDS = ['次', '次へ']
