import { maybeInvoke } from './tauri'

export interface SaveAudioClipInput {
  sessionId: string
  audioDataUrl: string
  mimeType: string
  size: number
  startedAt: string
  endedAt: string
  storageRoot?: string
  suggestedFileName?: string
}

export interface SaveAudioClipResult {
  audioPath: string
  mimeType: string
  size: number
  startedAt: string
  endedAt: string
}

export async function saveAudioClip(input: SaveAudioClipInput): Promise<SaveAudioClipResult> {
  const tauriResult = await maybeInvoke<SaveAudioClipResult>('save_audio_clip', input)
  if (tauriResult) {
    return tauriResult
  }

  return {
    audioPath: input.audioDataUrl,
    mimeType: input.mimeType,
    size: input.size,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  }
}
