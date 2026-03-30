import { maybeInvoke } from './tauri'

export interface ExtractOcrTextInput {
  imagePath: string
  mockRawText?: string
}

export interface ExtractOcrTextResult {
  rawText: string
  source: 'local'
}

export interface OcrDiagnostics {
  ready: boolean
  tesseractExecutable: string | null
  error: string | null
}

export async function extractOcrText(input: ExtractOcrTextInput): Promise<ExtractOcrTextResult> {
  const result = await maybeInvoke<ExtractOcrTextResult>('extract_ocr_from_image', input)
  if (!result) {
    throw new Error('Tauri runtime is not available for local OCR extraction.')
  }

  return result
}

export async function getOcrDiagnostics(): Promise<OcrDiagnostics | null> {
  const result = await maybeInvoke<OcrDiagnostics>('get_ocr_diagnostics')
  return result ?? null
}
