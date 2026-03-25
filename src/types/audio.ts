export interface RecordedAudioClip {
  blob: Blob
  objectUrl: string
  mimeType: string
  size: number
  durationMs: number
  startedAt: string
  endedAt: string
}

export interface RecordingDeviceOption {
  deviceId: string
  label: string
}
