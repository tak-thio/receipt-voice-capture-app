import { extractOcrText } from '../../api/ocr-api'
import { extractOcrCandidates } from '../ocr/candidate-extractor'
import type { OcrAdapter, OcrAdapterRequest, OcrAdapterResult } from './ocr-adapter'

function buildFallbackRawText(request: OcrAdapterRequest): string {
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

export class LocalOcrAdapter implements OcrAdapter {
  async extractFromImage(request: OcrAdapterRequest): Promise<OcrAdapterResult> {
    const response = await extractOcrText({
      imagePath: request.imagePath,
      mockRawText: buildFallbackRawText(request),
    })

    return {
      rawText: response.rawText,
      extractedCandidates: extractOcrCandidates(response.rawText, request.referenceDate),
      source: response.source,
    }
  }
}
