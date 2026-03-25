import type { RecordedAudioClip, RecordingDeviceOption } from '../../types/audio'

function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

async function listInputDevices(kind: MediaDeviceKind): Promise<RecordingDeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return []
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label:
        device.label ||
        `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${index + 1}`,
    }))
}

export async function listAudioInputDevices(): Promise<RecordingDeviceOption[]> {
  return listInputDevices('audioinput')
}

export async function listVideoInputDevices(): Promise<RecordingDeviceOption[]> {
  return listInputDevices('videoinput')
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
