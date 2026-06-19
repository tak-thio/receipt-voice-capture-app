// FCM(Phase D)ブリッジ。Android のネイティブプラグイン(FcmPlugin)から登録トークンを取得する。
// Android 以外(iOS/デスクトップ)では利用不可。
import { invoke } from '@tauri-apps/api/core'

export function isNativeFcmAvailable(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** FCM 登録トークンを取得。取得できなければ null(権限未許可・Play開発者サービス無し等)。 */
export async function getFcmToken(): Promise<string | null> {
  try {
    const r = await invoke<{ token: string }>('get_fcm_token')
    return r.token || null
  } catch {
    return null
  }
}
