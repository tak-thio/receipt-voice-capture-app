import type { RecordedAudioClip } from '../../types/audio'
import type { SttInputEvent } from '../../types/domain'
import type { SttAdapter, SttTranscriptionRequest, SttTranscriptionResult } from './stt-adapter'

export interface MockTranscriptSequence {
  id: string
  label: string
  events: SttInputEvent[]
}

interface MockSttAdapterOptions {
  sequences: MockTranscriptSequence[]
}

function scaleEventTimings(
  events: SttInputEvent[],
  durationMs?: number,
): SttInputEvent[] {
  if (!events.length) {
    return []
  }

  const originalDuration = Math.max(events.at(-1)?.endMs ?? 0, 1)
  const scale = durationMs && durationMs > 0 ? durationMs / originalDuration : 1

  return events.map((event) => ({
    ...event,
    id: `evt-${crypto.randomUUID()}`,
    startMs: Math.round(event.startMs * scale),
    endMs: Math.round(event.endMs * scale),
  }))
}

function buildEventsFromManualTranscript(manualTranscript: string): SttInputEvent[] {
  const lines = manualTranscript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.map((line, index) => ({
    id: `evt-${crypto.randomUUID()}`,
    text: line,
    startMs: index * 1200,
    endMs: index * 1200 + 1100,
  }))
}

export class MockSttAdapter implements SttAdapter {
  private readonly options: MockSttAdapterOptions

  constructor(options: MockSttAdapterOptions) {
    this.options = options
  }

  reset(): void {
    // no-op for now; the segment buffer moved into SegmentManager
  }

  private lookupSequence(sequenceId?: string): MockTranscriptSequence | null {
    if (!sequenceId) {
      return this.options.sequences[0] ?? null
    }

    return this.options.sequences.find((sequence) => sequence.id === sequenceId) ?? null
  }

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    if (request.manualTranscript?.trim()) {
      return {
        events: buildEventsFromManualTranscript(request.manualTranscript),
        source: 'manual-transcript',
      }
    }

    const sequence = this.lookupSequence(request.sequenceId)
    if (!sequence) {
      return {
        events: [],
        source: 'recording',
      }
    }

    return {
      events: scaleEventTimings(sequence.events, request.audioClip?.durationMs),
      source: request.audioClip ? 'recording' : 'mock-sequence',
    }
  }
}

export function revokeRecordedClip(audioClip: RecordedAudioClip | null): void {
  if (audioClip) {
    URL.revokeObjectURL(audioClip.objectUrl)
  }
}
