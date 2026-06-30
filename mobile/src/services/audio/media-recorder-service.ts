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

  // マイクを事前取得して温める。録音開始(start)を即時化するため画面表示時に呼ぶ。
  // 既に live なストリームがあれば何もしない(毎回 getUserMedia しない=反応が速い)。
  async prepare(preferredDeviceId?: string): Promise<void> {
    if (this.stream?.getAudioTracks().some((t) => t.readyState === 'live')) return
    const support = getMediaRecordingSupport()
    if (!support.supported) {
      throw new Error(support.reason ?? '録音機能を利用できません。')
    }
    const constraints: MediaStreamConstraints = {
      audio: preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : true,
      video: false,
    }
    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
  }

  async start(preferredDeviceId?: string): Promise<void> {
    if (this.mediaRecorder?.state === 'recording') {
      return
    }
    await this.prepare(preferredDeviceId) // 温まっていれば即返る(毎回マイク取得しない)
    this.chunks = []
    this.startedAtMs = Date.now()

    this.mediaRecorder = new MediaRecorder(this.stream!, {
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

    this.mediaRecorder = null
    // ストリームは保持して次回の録音を即時化する(マイクは release() で解放)。

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

  // マイクを解放(撮影画面を離れるとき)。録音中なら止める。
  release(): void {
    if (this.mediaRecorder?.state === 'recording') {
      try {
        this.mediaRecorder.stop()
      } catch {
        /* ignore */
      }
    }
    this.mediaRecorder = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.chunks = []
  }
}
