import { DEFAULT_SETTINGS } from '../lib/constants'
import { maybeInvoke } from './tauri'
import type { AppSettings } from '../types/settings'

const SETTINGS_KEY = 'receipt-app:settings'

export async function loadSettings(): Promise<AppSettings> {
  const tauriSettings = await maybeInvoke<AppSettings>('load_settings')
  if (tauriSettings) {
    return tauriSettings
  }

  const raw = localStorage.getItem(SETTINGS_KEY)
  return raw ? (JSON.parse(raw) as AppSettings) : DEFAULT_SETTINGS
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const tauriSettings = await maybeInvoke<AppSettings>('save_settings', { settings })
  if (tauriSettings) {
    return tauriSettings
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  return settings
}
