import type { RecordedAudioClip } from '../../types/audio'

export interface MediaRecordingSupport {
  supported: boolean
  reason: string | null
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export function getMediaRecordingSupport(): MediaRecordingSupport {
  if (typeof navigator === 'undefined') {
    return {
      supported: false,
      reason: 'この環境では navigator が利用できないため、録音機能を開始できません。',
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason:
        'この実行環境ではマイク API (`navigator.mediaDevices.getUserMedia`) が利用できません。',
    }
  }

  if (typeof MediaRecorder === 'undefined') {
    return {
      supported: false,
      reason: 'この実行環境では MediaRecorder が利用できません。',
    }
  }

  return {
    supported: true,
    reason: null,
  }
}

export class MediaRecorderService {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAtMs = 0

  async start(preferredDeviceId?: string): Promise<void> {
    if (this.mediaRecorder?.state === 'recording') {
      return
    }

    const support = getMediaRecordingSupport()
    if (!support.supported) {
      throw new Error(support.reason ?? '録音機能を利用できません。')
    }

    const constraints: MediaStreamConstraints = {
      audio: preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : true,
      video: false,
    }

    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.chunks = []
    this.startedAtMs = Date.now()

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: pickMimeType(),
    })

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data)
      }
    }

    this.mediaRecorder.start(250)
  }

  async stop(): Promise<RecordedAudioClip | null> {
    if (!this.mediaRecorder) {
      return null
    }

    const recorder = this.mediaRecorder
    const endedAtMs = Date.now()

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.mediaRecorder = null

    const blob = new Blob(this.chunks, {
      type: recorder.mimeType || 'audio/webm',
    })

    this.chunks = []

    return {
      blob,
      objectUrl: URL.createObjectURL(blob),
      mimeType: blob.type || 'audio/webm',
      size: blob.size,
      durationMs: endedAtMs - this.startedAtMs,
      startedAt: new Date(this.startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
    }
  }
}
