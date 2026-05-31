import { extractOcrText } from '../../api/ocr-api'
import { extractOcrCandidates } from '../ocr/candidate-extractor'
import type { OcrAdapter, OcrAdapterRequest, OcrAdapterResult } from './ocr-adapter'

export class GeminiOcrAdapter implements OcrAdapter {
  private readonly model: string

  constructor(model: string) {
    this.model = model
  }

  async extractFromImage(request: OcrAdapterRequest): Promise<OcrAdapterResult> {
    const response = await extractOcrText({
      imagePath: request.imagePath,
      provider: 'gemini',
      model: this.model,
    })

    return {
      rawText: response.rawText,
      extractedCandidates: extractOcrCandidates(response.rawText, request.referenceDate),
      source: response.source,
    }
  }
}
