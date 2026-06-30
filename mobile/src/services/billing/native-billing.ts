// アプリ内課金(IAP / ⑤)ブリッジ。Android のネイティブプラグイン(BillingPlugin)で
// サブスク(pro_monthly)を購入し、サーバの /billing/google/verify で検証→pro 付与まで一気に行う。
// Android 以外(iOS/デスクトップ)では利用不可。
import { invoke } from '@tauri-apps/api/core'
import { verifyPurchase, type VerifyPurchaseResult } from '../../api/server-api'

interface SubscribeResult {
  purchaseToken: string
  productId: string
}

/** Play Billing が使えるか(= Android ネイティブ)。ストア外/デスクトップでは false。 */
export function isBillingAvailable(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** Play の購入フローを起動し、完了したら購入トークンを返す。キャンセル/失敗は throw。 */
async function subscribePro(): Promise<SubscribeResult> {
  return invoke<SubscribeResult>('native_subscribe')
}

/** 購入 → サーバ検証 → pro 付与までの一連。成功時は最新の plan/used/cap/active を返す。
 * 購入キャンセル・課金未設定・検証失敗は throw(呼び出し側がトースト表示)。 */
export async function upgradeToPro(serverUrl: string, deviceToken: string): Promise<VerifyPurchaseResult> {
  if (!isBillingAvailable()) {
    throw new Error('アプリ内課金はこの端末では利用できません。')
  }
  const purchase = await subscribePro()
  return verifyPurchase(serverUrl, deviceToken, purchase.purchaseToken, purchase.productId)
}
