import { DEFAULT_SETTINGS } from '../lib/constants'
import { appSettingsSchema } from '../lib/schemas'
import { maybeInvoke } from './tauri'
import type { AppSettings } from '../types/settings'

const SETTINGS_KEY = 'receipt-app:settings'

function normalizeSettings(input: unknown): AppSettings {
  return appSettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...(typeof input === 'object' && input ? input : {}),
  })
}

export async function loadSettings(): Promise<AppSettings> {
  const tauriSettings = await maybeInvoke<AppSettings>('load_settings')
  if (tauriSettings) {
    return normalizeSettings(tauriSettings)
  }

  const raw = localStorage.getItem(SETTINGS_KEY)
  return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings)
  const tauriSettings = await maybeInvoke<AppSettings>('save_settings', { settings: normalized })
  if (tauriSettings) {
    return normalizeSettings(tauriSettings)
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
  return normalized
}
