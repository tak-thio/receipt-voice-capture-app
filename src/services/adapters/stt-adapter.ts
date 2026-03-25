import type { RecordedAudioClip } from '../../types/audio'
import type { SttInputEvent } from '../../types/domain'

export interface SttTranscriptionRequest {
  audioClip?: RecordedAudioClip | null
  manualTranscript?: string
  sequenceId?: string
}

export interface SttTranscriptionResult {
  events: SttInputEvent[]
  source: 'mock-sequence' | 'manual-transcript' | 'recording'
}

export interface SttAdapter {
  transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult>
}
