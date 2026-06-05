import type { AppSettings } from './settings'

export type TaxMode = 'inclusive' | 'exclusive' | 'unknown'
export type MatchStatus = 'ok' | 'warning' | 'review_required'

export type ManualEditedField =
  | 'date'
  | 'vendor'
  | 'taxMode'
  | 'amount'
  | 'paymentMethod'
  | 'descriptionRaw'
  | 'accountCategoryCandidate'
  | 'accountCategoryFinal'
  | 'summary'
  | 'invoiceNumber'
  | 'memo'

export interface CaptureImageMeta {
  imagePath: string
  capturedAt: string
  width: number
  height: number
}

export interface ParsedSpeechFields {
  date: string
  vendor: string
  taxMode: TaxMode
  amount: number | null
  paymentMethod: string
  descriptionRaw: string
  accountCategoryCandidate: string
  accountCategoryFinal: string
  summary: string
  invoiceNumber: string
  memo: string
}

export interface SpeechParseResult {
  normalizedText: string
  tokens: string[]
  fields: ParsedSpeechFields
  warnings: string[]
  boundaryDetected: boolean
}

export interface SttInputEvent {
  id: string
  text: string
  startMs: number
  endMs: number
}

export interface SttCommittedSegment {
  rawText: string
  segmentStartMs: number | null
  segmentEndMs: number | null
  sourceEvents: SttInputEvent[]
}

export interface ReceiptRecordSttBlock {
  rawText: string
  normalizedText: string
  tokens: string[]
  segmentStartMs: number | null
  segmentEndMs: number | null
  sourceEvents: SttInputEvent[]
  parsedFields: ParsedSpeechFields
  parserWarnings: string[]
}

export interface OcrExtractedCandidates {
  dates: string[]
  vendors: string[]
  amounts: number[]
  invoiceNumbers: string[]
}

export interface ReceiptRecordOcrBlock {
  rawText: string
  extractedCandidates: OcrExtractedCandidates
  source: 'mock' | 'local' | 'gemini' | 'disabled' | 'error'
}

export interface ReceiptRecordFinalBlock {
  date: string
  vendor: string
  taxMode: TaxMode
  amount: number | null
  paymentMethod: string
  descriptionRaw: string
  accountCategoryCandidate: string
  accountCategoryFinal: string
  summary: string
  invoiceNumber: string
  memo: string
  manualEditedFields: ManualEditedField[]
}

export interface ReceiptRecordReviewBlock {
  matchStatus: MatchStatus
  reviewRequired: boolean
  mismatchReasons: string[]
  confidence: number
  confirmedAt?: string | null
}

export interface ReceiptRecord {
  id: string
  createdAt: string
  updatedAt: string
  imagePath: string
  capturedAt: string
  imageWidth: number
  imageHeight: number
  stt: ReceiptRecordSttBlock
  ocr: ReceiptRecordOcrBlock
  final: ReceiptRecordFinalBlock
  review: ReceiptRecordReviewBlock
}

export interface Session {
  id: string
  createdAt: string
  updatedAt: string
  settingsSnapshot: AppSettings
  records: ReceiptRecord[]
}

export interface SessionSummary {
  id: string
  createdAt: string
  updatedAt: string
  recordCount: number
}
