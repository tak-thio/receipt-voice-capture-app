// Android / iOS のネイティブ課金を起動し、ストアごとのサーバ検証まで行う。
import { invoke, isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  getApplePurchaseContext,
  verifyStorePurchase,
  type BillingPlatform,
  type StorePurchasePayload,
  type VerifyPurchaseResult,
} from '../../api/server-api'
import type { Connection } from '../../types/connection'

const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const APPLE_RECOVERY_INTERVAL_MS = 60_000
const processingAppleTransactions = new Map<string, Promise<VerifyPurchaseResult>>()
export const BILLING_SUBSCRIPTION_UPDATED_EVENT = 'billing-subscription-updated'

type NativeSubscribeResult = Omit<StorePurchasePayload, 'platform'> & {
  platform?: BillingPlatform
}

type IosBillingDiagnosticEvent =
  | 'upgrade.started'
  | 'purchase-context.started'
  | 'purchase-context.completed'
  | 'native-subscribe.started'
  | 'native-subscribe.completed'
  | 'verify.started'
  | 'verify.completed'
  | 'upgrade.failed'

async function recordIosBillingDiagnostic(
  enabled: boolean, event: IosBillingDiagnosticEvent,
): Promise<void> {
  if (!enabled) return
  try {
    await invoke('native_billing_diagnostic', { event })
  } catch {
    // 診断記録の失敗で購入フローを止めない。
  }
}

/** 実行中のネイティブストアを返す。ブラウザ/デスクトップでは null。 */
export function currentBillingPlatform(): BillingPlatform | null {
  if (!isTauri() || typeof navigator === 'undefined') return null

  const userAgent = navigator.userAgent
  if (/Android/i.test(userAgent)) return 'google'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'apple'
  if (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1) return 'apple'
  return null
}

/** 現在の端末でネイティブ課金を利用できるか。 */
export function isBillingAvailable(): boolean {
  return currentBillingPlatform() !== null
}

export function currentStoreLabel(): 'Google Play' | 'App Store' | 'ストア' {
  const platform = currentBillingPlatform()
  if (platform === 'apple') return 'App Store'
  if (platform === 'google') return 'Google Play'
  return 'ストア'
}

/** 退会前に表示するストア別の確認文言。 */
export function accountDeletionConfirmation(managementPlatforms: BillingPlatform[]): string {
  const deletion = '退会すると、取り込んだ領収書データはすべて削除され、元に戻せません。'
  const appleActive = managementPlatforms.includes('apple')
  const googleActive = managementPlatforms.includes('google')
  if (appleActive) {
    const googleMessage = googleActive
      ? '\nGoogle Play のサブスクリプションは自動的に解約されます。'
      : ''
    return `${deletion}\n\nApp Store のサブスクリプションは退会後も Apple アカウント側で管理されます。\n請求を停止するには、退会前に「サブスクリプションを管理」から解約してください。${googleMessage}\n\n退会しますか？`
  }
  if (googleActive) {
    return `${deletion}\n\nPro サブスクをご契約中の場合は自動的に解約されます。\n\n退会しますか？`
  }
  return `${deletion}\n\nPro サブスクをご契約中の場合は、退会前にストア側の解約状況をご確認ください。\n\n退会しますか？`
}

async function verifyAndFinishAppleTransaction(
  serverUrl: string,
  deviceToken: string,
  purchase: StorePurchasePayload,
): Promise<VerifyPurchaseResult> {
  const transactionId = purchase.transactionId
  if (!transactionId) {
    throw new Error('App Store の取引IDが必要です')
  }
  const processingKey = `${serverUrl}\n${deviceToken}\n${transactionId}`
  const inFlight = processingAppleTransactions.get(processingKey)
  if (inFlight) return inFlight

  const verification = (async () => {
    const verified = await verifyStorePurchase(serverUrl, deviceToken, purchase)
    await invoke('native_finish_transaction', { transactionId })
    window.dispatchEvent(new Event(BILLING_SUBSCRIPTION_UPDATED_EVENT))
    return verified
  })()
  processingAppleTransactions.set(processingKey, verification)
  try {
    return await verification
  } finally {
    if (processingAppleTransactions.get(processingKey) === verification) {
      processingAppleTransactions.delete(processingKey)
    }
  }
}

export function connectionAfterBillingVerification(
  expectedConnection: Pick<Connection, 'serverUrl' | 'deviceToken'>,
  currentConnection: Connection | null,
  result: VerifyPurchaseResult,
): Connection | null {
  if (
    !currentConnection
    || currentConnection.serverUrl !== expectedConnection.serverUrl
    || currentConnection.deviceToken !== expectedConnection.deviceToken
  ) {
    return null
  }
  return currentConnection.plan === result.plan
    ? currentConnection
    : { ...currentConnection, plan: result.plan }
}

export function canRecoverAppleTransactions(
  connection: Connection | null,
): connection is Connection {
  return Boolean(
    connection?.individual
    && connection.email
    && !connection.demo,
  )
}

function normalizeNativePurchase(
  purchase: NativeSubscribeResult, platform: BillingPlatform,
): StorePurchasePayload {
  if (purchase.platform && purchase.platform !== platform) {
    throw new Error('購入情報のストアが実行中の端末と一致しません。')
  }
  return { ...purchase, platform }
}

async function subscribePro(
  platform: BillingPlatform, appAccountToken?: string,
): Promise<StorePurchasePayload> {
  const args = appAccountToken ? { appAccountToken } : undefined
  const purchase = await invoke<NativeSubscribeResult>('native_subscribe', args)
  return normalizeNativePurchase(purchase, platform)
}

/** 購入からサーバ検証、pro 付与までを行う。 */
export async function upgradeToPro(serverUrl: string, deviceToken: string): Promise<VerifyPurchaseResult> {
  const platform = currentBillingPlatform()
  if (!platform) {
    throw new Error('アプリ内課金はこの端末では利用できません。')
  }
  const iosDiagnostics = platform === 'apple'
  await recordIosBillingDiagnostic(iosDiagnostics, 'upgrade.started')
  try {
    let appAccountToken: string | undefined
    if (platform === 'apple') {
      await recordIosBillingDiagnostic(true, 'purchase-context.started')
      appAccountToken = (await getApplePurchaseContext(serverUrl, deviceToken)).appAccountToken
      await recordIosBillingDiagnostic(true, 'purchase-context.completed')
    }
    await recordIosBillingDiagnostic(iosDiagnostics, 'native-subscribe.started')
    const purchase = await subscribePro(platform, appAccountToken)
    await recordIosBillingDiagnostic(iosDiagnostics, 'native-subscribe.completed')
    await recordIosBillingDiagnostic(iosDiagnostics, 'verify.started')
    const verified = platform === 'apple'
      ? await verifyAndFinishAppleTransaction(serverUrl, deviceToken, purchase)
      : await verifyStorePurchase(serverUrl, deviceToken, purchase)
    await recordIosBillingDiagnostic(iosDiagnostics, 'verify.completed')
    return verified
  } catch (error) {
    await recordIosBillingDiagnostic(iosDiagnostics, 'upgrade.failed')
    throw error
  }
}

/** iOS の過去の購入を復元し、サーバ側の購読状態を更新する。 */
export async function restoreProSubscription(
  serverUrl: string, deviceToken: string,
): Promise<VerifyPurchaseResult> {
  if (currentBillingPlatform() !== 'apple') {
    throw new Error('購入の復元は iOS アプリでのみ利用できます。')
  }
  const restored = await invoke<NativeSubscribeResult>('native_restore_subscription')
  const purchase = normalizeNativePurchase(restored, 'apple')
  return verifyAndFinishAppleTransaction(serverUrl, deviceToken, purchase)
}

/** StoreKit に残っている未完了取引をサーバ検証し、成功したものだけ完了する。 */
export async function recoverUnfinishedAppleTransactions(
  serverUrl: string,
  deviceToken: string,
  onVerified?: (result: VerifyPurchaseResult) => void,
): Promise<void> {
  if (currentBillingPlatform() !== 'apple') return
  const unfinished = await invoke<NativeSubscribeResult[]>('native_unfinished_transactions')
  for (const nativePurchase of unfinished) {
    try {
      const purchase = normalizeNativePurchase(nativePurchase, 'apple')
      const result = await verifyAndFinishAppleTransaction(serverUrl, deviceToken, purchase)
      onVerified?.(result)
    } catch {
      // 未完了のまま保持し、次回の定期回復で再試行する。
    }
  }
}

/** Ask to Buy 承認や一時的な通信失敗を、アプリ起動中も自動回復する。 */
export function startAppleTransactionRecovery(
  serverUrl: string,
  deviceToken: string,
  onVerified?: (result: VerifyPurchaseResult) => void,
): () => void {
  if (currentBillingPlatform() !== 'apple') return () => undefined

  let stopped = false
  let recoveryInFlight: Promise<void> | undefined
  const notifyVerified = (result: VerifyPurchaseResult) => {
    if (!stopped) onVerified?.(result)
  }
  const recover = () => {
    if (stopped || recoveryInFlight) return
    const recovery = recoverUnfinishedAppleTransactions(
      serverUrl, deviceToken, notifyVerified,
    )
    recoveryInFlight = recovery
    void recovery
      .catch((error) => console.error('[billing.recovery]', error))
      .finally(() => {
        if (recoveryInFlight === recovery) recoveryInFlight = undefined
      })
  }
  recover()
  const interval = window.setInterval(recover, APPLE_RECOVERY_INTERVAL_MS)
  window.addEventListener('online', recover)

  return () => {
    stopped = true
    window.clearInterval(interval)
    window.removeEventListener('online', recover)
  }
}

/** Apple の標準購読管理画面を開く。 */
export function manageAppleSubscription(): Promise<void> {
  return openUrl(APPLE_SUBSCRIPTIONS_URL)
}
