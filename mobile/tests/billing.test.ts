import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

import {
  getApplePurchaseContext,
  getBillingSubscription,
  verifyStorePurchase,
} from '../src/api/server-api'
import {
  accountDeletionConfirmation,
  currentBillingPlatform,
  currentStoreLabel,
  isBillingAvailable,
  restoreProSubscription,
  upgradeToPro,
} from '../src/services/billing/native-billing'

describe('billing subscription API', () => {
  afterEach(() => {
    clearMocks()
    vi.unstubAllGlobals()
  })

  it('loads the current store subscription with bearer authentication', async () => {
    const summary = {
      active: true,
      platform: 'apple' as const,
      productId: 'pro_monthly',
      currentPeriodEnd: '2026-08-10T00:00:00+00:00',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getBillingSubscription('https://api.example.test/', 'device-token'),
    ).resolves.toEqual(summary)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/billing/subscription',
      {
        headers: {
          Authorization: 'Bearer device-token',
          'content-type': 'application/json',
        },
      },
    )
  })

  it('verifies an Android purchase through the Google endpoint', async () => {
    const result = { active: true, plan: 'pro', used: 3, cap: 500 }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyStorePurchase('https://api.example.test/', 'device-token', {
      platform: 'google',
      productId: 'pro_monthly',
      purchaseToken: 'play-token',
    })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/billing/google/verify',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer device-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ purchase_token: 'play-token', product_id: 'pro_monthly' }),
      },
    )
  })

  it('verifies an iOS purchase through the Apple endpoint', async () => {
    const result = { active: true, plan: 'pro', used: 3, cap: 500 }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyStorePurchase('https://api.example.test/', 'device-token', {
      platform: 'apple',
      productId: 'pro_monthly',
      transactionId: 'transaction-id',
      originalTransactionId: 'original-transaction-id',
      signedTransactionInfo: 'signed-transaction',
    })).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/billing/apple/verify',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer device-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          signed_transaction_info: 'signed-transaction',
          transaction_id: 'transaction-id',
          original_transaction_id: 'original-transaction-id',
          product_id: 'pro_monthly',
        }),
      },
    )
  })

  it('loads the server-issued Apple purchase context', async () => {
    const context = { appAccountToken: '5b6a4a62-caf8-4bc1-821f-3a26ef2afc87' }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(context), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      getApplePurchaseContext('https://api.example.test/', 'device-token'),
    ).resolves.toEqual(context)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/billing/apple/purchase-context',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
      }),
    )
  })

  it('rejects a Google purchase without a purchase token before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyStorePurchase('https://api.example.test', 'device-token', {
      platform: 'google',
      productId: 'pro_monthly',
    })).rejects.toThrow('Google Play の購入トークンが必要です')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an Apple purchase without signed transaction data or a transaction ID before fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyStorePurchase('https://api.example.test', 'device-token', {
      platform: 'apple',
      productId: 'pro_monthly',
    })).rejects.toThrow('App Store の取引情報が必要です')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('detects App Store billing only in the iOS Tauri runtime', () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })

    expect(currentBillingPlatform()).toBe('apple')
    expect(currentStoreLabel()).toBe('App Store')
    expect(isBillingAvailable()).toBe(true)
  })

  it('detects Google Play billing in the Android Tauri runtime', () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' })

    expect(currentBillingPlatform()).toBe('google')
    expect(currentStoreLabel()).toBe('Google Play')
    expect(isBillingAvailable()).toBe(true)
  })

  it('does not expose native billing in a desktop browser', () => {
    vi.stubGlobal('isTauri', false)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })

    expect(currentBillingPlatform()).toBeNull()
    expect(currentStoreLabel()).toBe('ストア')
    expect(isBillingAvailable()).toBe(false)
  })

  it('uses the Apple verification path after an iOS native purchase', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const accountToken = '5b6a4a62-caf8-4bc1-821f-3a26ef2afc87'
    const diagnosticEvents: string[] = []
    mockIPC((command, args) => {
      if (command === 'native_billing_diagnostic') {
        diagnosticEvents.push((args as { event: string }).event)
        return null
      }
      expect(command).toBe('native_subscribe')
      expect(args).toEqual({ appAccountToken: accountToken })
      return {
        platform: 'apple',
        productId: 'pro_monthly',
        transactionId: 'transaction-id',
        originalTransactionId: 'original-transaction-id',
        signedTransactionInfo: 'signed-transaction',
      }
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ appAccountToken: accountToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ active: true, plan: 'pro', used: 3, cap: 500 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await upgradeToPro('https://api.example.test', 'device-token')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.test/billing/apple/purchase-context',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/billing/apple/verify',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(diagnosticEvents).toEqual([
      'upgrade.started',
      'purchase-context.started',
      'purchase-context.completed',
      'native-subscribe.started',
      'native-subscribe.completed',
      'verify.started',
      'verify.completed',
    ])
  })

  it('rejects a native purchase whose platform does not match the current store', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const diagnosticEvents: string[] = []
    mockIPC((command, args) => {
      if (command === 'native_billing_diagnostic') {
        diagnosticEvents.push((args as { event: string }).event)
        return null
      }
      return {
        platform: 'google',
        productId: 'pro_monthly',
        purchaseToken: 'play-token',
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        appAccountToken: '5b6a4a62-caf8-4bc1-821f-3a26ef2afc87',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      upgradeToPro('https://api.example.test', 'device-token'),
    ).rejects.toThrow('購入情報のストアが実行中の端末と一致しません')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(diagnosticEvents.at(-1)).toBe('upgrade.failed')
  })

  it('restores an iOS subscription and verifies the restored transaction', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })
    mockIPC((command) => {
      expect(command).toBe('native_restore_subscription')
      return {
        platform: 'apple',
        productId: 'pro_monthly',
        transactionId: 'restored-transaction-id',
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, plan: 'pro', used: 3, cap: 500 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await restoreProSubscription('https://api.example.test', 'device-token')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/billing/apple/verify',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('warns that Apple subscriptions remain managed by the Apple account after deletion', () => {
    expect(accountDeletionConfirmation('apple')).toContain(
      'App Store のサブスクリプションは退会後も Apple アカウント側で管理されます。',
    )
    expect(accountDeletionConfirmation('apple')).toContain(
      '請求を停止するには、退会前に「サブスクリプションを管理」から解約してください。',
    )
  })
})
