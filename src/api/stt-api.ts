import { maybeInvoke } from './tauri'
import type { SttInputEvent } from '../types/domain'

export interface TranscribeAudioInput {
  mode: 'mock' | 'local'
  audioPath?: string
  audioDurationMs?: number
  seedText?: string
  sttModel?: string
  sttDevice?: string
  sttComputeType?: string
  sttLanguage?: string
  sttBeamSize?: number
}

export interface TranscribeAudioResult {
  events: SttInputEvent[]
  source: 'mock-backend' | 'local' | 'local-python-sidecar'
}

export interface SttDiagnostics {
  ready: boolean
  pythonExecutable: string | null
  sidecarScript: string | null
  localVenvPython: string | null
  error: string | null
}

export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  const result = await maybeInvoke<TranscribeAudioResult>('transcribe_audio', input)
  if (!result) {
    throw new Error('Tauri runtime is not available for STT transcription.')
  }

  return result
}

export async function getSttDiagnostics(): Promise<SttDiagnostics | null> {
  const result = await maybeInvoke<SttDiagnostics>('get_stt_diagnostics')
  return result ?? null
}
