import { maybeInvoke } from './tauri'
import type { CaptureImageMeta } from '../types/domain'

export interface SaveCaptureImageInput {
  sessionId: string
  imageDataUrl: string
  width: number
  height: number
  storageRoot?: string
  suggestedFileName?: string
}

export async function saveCaptureImage(input: SaveCaptureImageInput): Promise<CaptureImageMeta> {
  const tauriResult = await maybeInvoke<CaptureImageMeta>('save_capture_image', input)
  if (tauriResult) {
    return tauriResult
  }

  return {
    imagePath: input.imageDataUrl,
    capturedAt: new Date().toISOString(),
    width: input.width,
    height: input.height,
  }
}
