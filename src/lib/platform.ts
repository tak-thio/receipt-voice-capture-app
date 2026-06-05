import { platform } from '@tauri-apps/plugin-os'
import { isTauriRuntime } from '../api/tauri'

export type RuntimePlatform =
  | 'linux'
  | 'macos'
  | 'windows'
  | 'ios'
  | 'android'
  | 'web'

let cachedPlatform: RuntimePlatform | null = null

/**
 * Returns the runtime platform. In a browser (no Tauri) this resolves to `web`.
 * `platform()` from `@tauri-apps/plugin-os` is synchronous in Tauri 2 (the value
 * is injected at startup), so this is safe to call during React render.
 */
export function getRuntimePlatform(): RuntimePlatform {
  if (cachedPlatform) {
    return cachedPlatform
  }

  if (!isTauriRuntime()) {
    cachedPlatform = 'web'
    return cachedPlatform
  }

  try {
    cachedPlatform = platform() as RuntimePlatform
  } catch {
    cachedPlatform = 'web'
  }

  return cachedPlatform
}

/** True when running inside the Android or iOS WebView. */
export function isMobilePlatform(): boolean {
  const current = getRuntimePlatform()
  return current === 'android' || current === 'ios'
}
