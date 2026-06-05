import { extractOcrCandidates } from '../ocr/candidate-extractor'
import type { OcrAdapter, OcrAdapterRequest, OcrAdapterResult } from './ocr-adapter'

function buildRawText(request: OcrAdapterRequest): string {
  if (request.mockRawText?.trim()) {
    return request.mockRawText.trim()
  }

  const finalBlock = request.finalBlock
  if (!finalBlock) {
    return ''
  }

  return [
    finalBlock.date,
    finalBlock.vendor,
    finalBlock.amount !== null ? `${finalBlock.amount}円` : '',
    finalBlock.invoiceNumber,
  ]
    .filter(Boolean)
    .join(' ')
}

export class MockOcrAdapter implements OcrAdapter {
  async extractFromImage(request: OcrAdapterRequest): Promise<OcrAdapterResult> {
    const rawText = buildRawText(request)

    return {
      rawText,
      extractedCandidates: extractOcrCandidates(rawText, request.referenceDate),
      source: 'mock',
    }
  }
}
