// One-shot QR scan using the native BarcodeDetector (Android Chromium WebView).
// On platforms without it (e.g. iOS WKWebView) callers fall back to manual entry.

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function ctor(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

export function isQrScanSupported(): boolean {
  return typeof ctor() !== 'undefined'
}

/** Open the rear camera briefly and return the first QR value, or null on timeout. */
export async function scanQrOnce(timeoutMs = 8000): Promise<string | null> {
  const Detector = ctor()
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    return null
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  })
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.playsInline = true
    video.muted = true
    await video.play()
    const detector = new Detector({ formats: ['qr_code'] })
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline) {
      const codes = await detector.detect(video)
      if (codes.length > 0) {
        return codes[0].rawValue
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return null
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
}
