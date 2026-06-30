export interface RecordedAudioClip {
  blob: Blob
  objectUrl: string
  filePath?: string
  mimeType: string
  size: number
  durationMs: number
  startedAt: string
  endedAt: string
}
