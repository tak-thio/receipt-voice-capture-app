import { DEFAULT_SETTINGS } from '../lib/constants'
import { isMobilePlatform } from '../lib/platform'
import { appSettingsSchema } from '../lib/schemas'
import { maybeInvoke } from './tauri'
import type { AppSettings } from '../types/settings'

const SETTINGS_KEY = 'receipt-app:settings'

/**
 * Mobile (iOS/Android) cannot run the Python STT / Tesseract OCR sidecars and has
 * no user-writable cwd. Force cloud STT/OCR and clear storageRoot so the Rust side
 * resolves the app data dir. Applied at the single normalization choke point so it
 * also covers values baked into each session's settingsSnapshot.
 */
function applyMobileConstraints(settings: AppSettings): AppSettings {
  if (!isMobilePlatform()) {
    return settings
  }

  return {
    ...settings,
    storageRoot: '',
    sttMode: settings.sttMode === 'local' ? 'gemini' : settings.sttMode,
    ocrMode: settings.ocrMode === 'local' ? 'gemini' : settings.ocrMode,
    aiFormatMode: settings.aiFormatMode === 'local' ? 'gemini' : settings.aiFormatMode,
  }
}

function normalizeSettings(input: unknown): AppSettings {
  return applyMobileConstraints(
    appSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...(typeof input === 'object' && input ? input : {}),
    }),
  )
}

export async function loadSettings(): Promise<AppSettings> {
  const tauriSettings = await maybeInvoke<AppSettings>('load_settings')
  if (tauriSettings) {
    return normalizeSettings(tauriSettings)
  }

  const raw = localStorage.getItem(SETTINGS_KEY)
  return normalizeSettings(raw ? JSON.parse(raw) : {})
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
