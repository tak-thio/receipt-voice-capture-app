import { BOUNDARY_KEYWORDS } from '../../lib/constants'
import type { SttCommittedSegment, SttInputEvent } from '../../types/domain'

function hasBoundary(text: string): boolean {
  return BOUNDARY_KEYWORDS.some((keyword) => text.includes(keyword))
}

function findBoundaryEnd(text: string): number | null {
  const boundaries = [...BOUNDARY_KEYWORDS].sort((left, right) => right.length - left.length)
  let bestStart = -1
  let bestEnd = -1

  for (const boundary of boundaries) {
    const start = text.indexOf(boundary)
    if (start < 0) {
      continue
    }

    const end = start + boundary.length
    if (bestStart < 0 || start < bestStart || (start === bestStart && end > bestEnd)) {
      bestStart = start
      bestEnd = end
    }
  }

  return bestEnd >= 0 ? bestEnd : null
}

function splitEventByBoundary(event: SttInputEvent): SttInputEvent[] {
  const parts: string[] = []
  let remaining = event.text.trim()

  while (remaining) {
    const boundaryEnd = findBoundaryEnd(remaining)
    if (boundaryEnd === null) {
      parts.push(remaining)
      break
    }

    parts.push(remaining.slice(0, boundaryEnd).trim())
    remaining = remaining.slice(boundaryEnd).trim()
  }

  if (parts.length <= 1) {
    return [event]
  }

  const duration = Math.max(event.endMs - event.startMs, parts.length)
  const partDuration = Math.max(Math.floor(duration / parts.length), 1)

  return parts.map((text, index) => ({
    ...event,
    id: `${event.id}-${index}`,
    text,
    startMs: event.startMs + partDuration * index,
    endMs: index === parts.length - 1 ? event.endMs : event.startMs + partDuration * (index + 1),
  }))
}

export class SegmentManager {
  private buffer: SttInputEvent[] = []

  reset(): void {
    this.buffer = []
  }

  append(events: SttInputEvent[]): SttCommittedSegment[] {
    const committedSegments: SttCommittedSegment[] = []

    for (const event of events.flatMap(splitEventByBoundary)) {
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

  flush(): SttCommittedSegment[] {
    if (!this.buffer.length) {
      return []
    }

    const committedSegment = {
      rawText: this.buffer.map((item) => item.text).join(' ').trim(),
      segmentStartMs: this.buffer[0]?.startMs ?? null,
      segmentEndMs: this.buffer.at(-1)?.endMs ?? null,
      sourceEvents: [...this.buffer],
    }

    this.buffer = []
    return [committedSegment]
  }

  snapshot(): SttInputEvent[] {
    return [...this.buffer]
  }
}
