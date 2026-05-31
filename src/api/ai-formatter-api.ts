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
  source: 'openai-structured-output' | 'gemini-structured-output'
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

export async function getAiDiagnostics(): Promise<AiDiagnostics | null> {
  const result = await maybeInvoke<AiDiagnostics>('get_ai_diagnostics')
  return result ?? null
}
