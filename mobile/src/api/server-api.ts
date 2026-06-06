// Client for the SaaS backend (linked mode). `serverUrl` is the API base
// (e.g. https://receipt.example.com/api). Standalone mode never calls this.

export interface PairResult {
  access_token: string
  client_id: string
  user_id: string
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Redeem a QR pairing token for a long-lived device token. */
export async function pairDevice(serverUrl: string, token: string): Promise<PairResult> {
  const res = await fetch(`${base(serverUrl)}/pairing/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) {
    throw new Error(`ペアリングに失敗しました (${res.status})`)
  }
  return res.json() as Promise<PairResult>
}

export interface CaptureUpload {
  imageDataUrl?: string
  audio?: Blob
  capturedAt?: string
  /** 端末のキャプチャ時メタデータ(撮影時刻・画像寸法・検出情報・プラットフォーム等)。JSON で送る。 */
  metadata?: Record<string, unknown>
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/** Upload a captured image (+ optional audio) to the server, which runs the AI. */
export async function uploadCapture(
  serverUrl: string,
  deviceToken: string,
  capture: CaptureUpload,
): Promise<{ receipt_id: string }> {
  const form = new FormData()
  if (capture.imageDataUrl) {
    form.append('image', dataUrlToBlob(capture.imageDataUrl), 'capture.jpg')
  }
  if (capture.audio) {
    form.append('audio', capture.audio, 'audio.webm')
  }
  if (capture.capturedAt) {
    form.append('captured_at', capture.capturedAt)
  }
  if (capture.metadata) {
    form.append('metadata', JSON.stringify(capture.metadata))
  }
  const res = await fetch(`${base(serverUrl)}/captures`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`アップロードに失敗しました (${res.status})`)
  }
  return res.json() as Promise<{ receipt_id: string }>
}
