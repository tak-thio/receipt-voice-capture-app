import type { ReceiptRecordFinalBlock, OcrExtractedCandidates } from '../../types/domain'

export interface OcrAdapterRequest {
  imagePath: string
  finalBlock?: ReceiptRecordFinalBlock
  mockRawText?: string
  referenceDate?: Date
}

export interface OcrAdapterResult {
  rawText: string
  extractedCandidates: OcrExtractedCandidates
  source: 'mock' | 'local' | 'disabled' | 'error'
}

export interface OcrAdapter {
  extractFromImage(request: OcrAdapterRequest): Promise<OcrAdapterResult>
}
