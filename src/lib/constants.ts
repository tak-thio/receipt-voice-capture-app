import type { AppSettings } from '../types/settings'
import type { MatchStatus, TaxMode } from '../types/domain'

export const APP_TITLE = '領収書入力'

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  inclusive: '税込',
  exclusive: '税抜',
  unknown: '未指定',
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  ok: '確認済み',
  warning: '要確認',
  review_required: '修正が必要',
}

export const DEFAULT_SETTINGS: AppSettings = {
  storageRoot: 'receipt-sessions',
  preferredCameraId: '',
  preferredMicrophoneId: '',
  sttMode: 'gemini',
  sttModel: 'small',
  sttDevice: 'cpu',
  sttComputeType: 'int8',
  sttLanguage: 'ja',
  sttBeamSize: 5,
  aiProvider: 'gemini',
  openaiApiKey: '',
  geminiApiKey: '',
  openaiSttModel: 'gpt-4o-mini-transcribe',
  geminiModel: 'gemini-2.5-flash',
  aiFormatMode: 'gemini',
  aiFormatterModel: 'gpt-4o-mini',
  ocrEnabled: true,
  ocrMode: 'gemini',
  exportTargetDefault: 'mas',
}

export const LOCAL_STT_RECOMMENDED_SETTINGS = {
  sttModel: 'tiny',
  sttDevice: 'cpu',
  sttComputeType: 'int8',
  sttLanguage: 'ja',
  sttBeamSize: 1,
} as const

export const BOUNDARY_KEYWORDS = ['次', '次へ', '終了']
