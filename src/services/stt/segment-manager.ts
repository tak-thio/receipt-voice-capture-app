import { BOUNDARY_KEYWORDS } from '../../lib/constants'
import type { SttCommittedSegment, SttInputEvent } from '../../types/domain'

function hasBoundary(text: string): boolean {
  return BOUNDARY_KEYWORDS.some((keyword) => text.includes(keyword))
}

export class SegmentManager {
  private buffer: SttInputEvent[] = []

  reset(): void {
    this.buffer = []
  }

  append(events: SttInputEvent[]): SttCommittedSegment[] {
    const committedSegments: SttCommittedSegment[] = []

    for (const event of events) {
      this.buffer.push(event)

      if (!hasBoundary(event.text)) {
        continue
      }

      committedSegments.push({
        rawText: this.buffer.map((item) => item.text).join(' ').trim(),
        segmentStartMs: this.buffer[0]?.startMs ?? null,
        segmentEndMs: this.buffer.at(-1)?.endMs ?? null,
        sourceEvents: [...this.buffer],
      })

      this.buffer = []
    }

    return committedSegments
  }

  snapshot(): SttInputEvent[] {
    return [...this.buffer]
  }
}
