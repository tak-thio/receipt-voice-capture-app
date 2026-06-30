// ネイティブ録音(Android の MediaRecorder)ブリッジ。Android WebView でのみ使い、
// それ以外(iOS/デスクトップ)は従来の WebView MediaRecorder にフォールバックする。
import { invoke } from '@tauri-apps/api/core'

// Tauri Android WebView の UserAgent には "Android" が含まれる(同期判定でOK)。
export function isNativeAudioAvailable(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

export async function nativeStartRecording(): Promise<void> {
  await invoke('native_start_recording')
}

export interface NativeClip {
  blob: Blob
  mime: string
}

export async function nativeStopRecording(): Promise<NativeClip> {
  const r = await invoke<{ base64: string; mime: string; size: number }>('native_stop_recording')
  const bin = atob(r.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const mime = r.mime || 'audio/mp4'
  return { blob: new Blob([bytes], { type: mime }), mime }
}
