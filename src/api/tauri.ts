import { invoke } from '@tauri-apps/api/core'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function maybeInvoke<T>(
  command: string,
  args?: unknown,
): Promise<T | undefined> {
  if (!isTauriRuntime()) {
    return undefined
  }

  return invoke<T>(command, args as never)
}
