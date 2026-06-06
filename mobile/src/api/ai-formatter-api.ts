import { maybeInvoke } from './tauri'
import type { DictionaryBundle } from '../types/dictionaries'
import type { ParsedSpeechFields } from '../types/domain'
import type { AiProvider } from '../types/settings'

export interface FormatReceiptTextInput {
  rawText: string
  provider?: AiProvider
  model?: string
  referenceDate?: string
  dictionaries: DictionaryBundle
}

export interface FormatReceiptTextResult {
  records: ParsedSpeechFields[]
  warnings: string[]
  source: 'openai-structured-output' | 'gemini-structured-output' | 'gemini-image-voice'
}

export interface ExtractReceiptFromImageAndVoiceInput {
  imagePath: string
  transcript: string
  model?: string
  referenceDate?: string
  dictionaries: DictionaryBundle
}

export interface AiDiagnostics {
  openaiKeyConfigured: boolean
  geminiKeyConfigured: boolean
  openaiEnvVar: string
  geminiEnvVar: string
}

export async function formatReceiptText(
  input: FormatReceiptTextInput,
): Promise<FormatReceiptTextResult> {
  const result = await maybeInvoke<FormatReceiptTextResult>('format_receipt_text', input)
  if (!result) {
    throw new Error('Tauri runtime is not available for AI receipt formatting.')
  }

  return result
}

/**
 * 画像中心モデル: 領収書画像 + 補足の音声文字起こしを 1 回の Gemini vision 推論に渡し、
 * 構造化フィールドを抽出する。事実(金額/日付/店/インボイス番号)は画像優先、
 * 摘要/科目/支払方法と金額の合計特定は音声をヒントにする。
 */
export async function extractReceiptFromImageAndVoice(
  input: ExtractReceiptFromImageAndVoiceInput,
): Promise<FormatReceiptTextResult> {
  const result = await maybeInvoke<FormatReceiptTextResult>(
    'extract_receipt_from_image_and_voice',
    input,
  )
  if (!result) {
    throw new Error('Tauri runtime is not available for image+voice receipt extraction.')
  }

  return result
}

export async function getAiDiagnostics(): Promise<AiDiagnostics | null> {
  const result = await maybeInvoke<AiDiagnostics>('get_ai_diagnostics')
  return result ?? null
}
