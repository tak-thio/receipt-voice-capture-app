import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

import {
  getApplePurchaseContext,
  getBillingSubscription,
  verifyStorePurchase,
} from '../src/api/server-api'
import {
  accountDeletionConfirmation,
  BILLING_SUBSCRIPTION_UPDATED_EVENT,
  canRecoverAppleTransactions,
  connectionAfterBillingVerification,
  currentBillingPlatform,
  currentStoreLabel,
  isBillingAvailable,
  recoverUnfinishedAppleTransactions,
  restoreProSubscription,
  startAppleTransactionRecovery,
  upgradeToPro,
} from '../src/services/billing/native-billing'
import type { Connection } from '../src/types/connection'

describe('billing subscription API', () => {
  afterEach(() => {
    clearMocks()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads the current store subscription with bearer authentication', async () => {
    const summary = {
      active: true,
      platform: 'apple' as const,
      activePlatforms: ['apple'] as const,
      managementPlatforms: ['apple'] as const,
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
    const finishedTransactions: string[] = []
    const subscriptionUpdated = vi.fn()
    window.addEventListener(BILLING_SUBSCRIPTION_UPDATED_EVENT, subscriptionUpdated)
    mockIPC((command, args) => {
      if (command === 'native_billing_diagnostic') {
        diagnosticEvents.push((args as { event: string }).event)
        return null
      }
      if (command === 'native_finish_transaction') {
        finishedTransactions.push((args as { transactionId: string }).transactionId)
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
    expect(finishedTransactions).toEqual(['transaction-id'])
    expect(subscriptionUpdated).toHaveBeenCalledOnce()
    window.removeEventListener(BILLING_SUBSCRIPTION_UPDATED_EVENT, subscriptionUpdated)
  })

  it('leaves an Apple transaction unfinished when server verification fails', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const finishedTransactions: string[] = []
    mockIPC((command, args) => {
      if (command === 'native_billing_diagnostic') return null
      if (command === 'native_finish_transaction') {
        finishedTransactions.push((args as { transactionId: string }).transactionId)
        return null
      }
      return {
        platform: 'apple',
        productId: 'pro_monthly',
        transactionId: 'transaction-id',
        signedTransactionInfo: 'signed-transaction',
      }
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          appAccountToken: '5b6a4a62-caf8-4bc1-821f-3a26ef2afc87',
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'temporary failure' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      upgradeToPro('https://api.example.test', 'device-token'),
    ).rejects.toThrow()
    expect(finishedTransactions).toEqual([])
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
    const commands: string[] = []
    mockIPC((command) => {
      commands.push(command)
      if (command === 'native_finish_transaction') return null
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
    expect(commands).toEqual(['native_restore_subscription', 'native_finish_transaction'])
  })

  it('recovers unfinished Apple transactions and finishes each only after verification', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const commands: string[] = []
    mockIPC((command) => {
      commands.push(command)
      if (command === 'native_unfinished_transactions') {
        return [{
          platform: 'apple',
          productId: 'pro_monthly',
          transactionId: 'approved-transaction-id',
          signedTransactionInfo: 'approved-signed-transaction',
        }]
      }
      if (command === 'native_finish_transaction') return null
      throw new Error(`unexpected command: ${command}`)
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, plan: 'pro', used: 0, cap: 500 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ))

    const onVerified = vi.fn()
    await recoverUnfinishedAppleTransactions(
      'https://api.example.test',
      'device-token',
      onVerified,
    )

    expect(commands).toEqual([
      'native_unfinished_transactions',
      'native_finish_transaction',
    ])
    expect(onVerified).toHaveBeenCalledWith(
      { active: true, plan: 'pro', used: 0, cap: 500 },
    )
  })

  it('does not share in-flight Apple verification across device accounts', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const commands: string[] = []
    mockIPC((command) => {
      commands.push(command)
      if (command === 'native_unfinished_transactions') {
        return [{
          platform: 'apple',
          productId: 'pro_monthly',
          transactionId: 'shared-transaction-id',
          signedTransactionInfo: 'shared-signed-transaction',
        }]
      }
      if (command === 'native_finish_transaction') return null
      throw new Error(`unexpected command: ${command}`)
    })
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolvers.push(resolve) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = recoverUnfinishedAppleTransactions(
      'https://api.example.test', 'device-token-a',
    )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const second = recoverUnfinishedAppleTransactions(
      'https://api.example.test', 'device-token-b',
    )
    await vi.waitFor(() => {
      expect(commands.filter((command) => command === 'native_unfinished_transactions')).toHaveLength(2)
    })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const verificationCalls = fetchMock.mock.calls.length
    for (const resolve of resolvers) {
      resolve(new Response(JSON.stringify({ active: true, plan: 'pro', used: 0, cap: 500 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    }
    await Promise.all([first, second])

    expect(verificationCalls).toBe(2)
  })

  it('ignores a verified plan after the active connection changes', () => {
    const expected: Connection = {
      serverUrl: 'https://api.example.test',
      deviceToken: 'old-device-token',
      clientId: 'old-client',
      plan: 'free',
    }
    const current: Connection = {
      ...expected,
      deviceToken: 'new-device-token',
      clientId: 'new-client',
    }

    expect(connectionAfterBillingVerification(
      expected,
      current,
      { active: true, plan: 'pro', used: 0, cap: 500 },
    )).toBeNull()
  })

  it('applies an inactive verified plan returned by the server', () => {
    const connection: Connection = {
      serverUrl: 'https://api.example.test',
      deviceToken: 'device-token',
      clientId: 'client',
      plan: 'pro',
    }

    expect(connectionAfterBillingVerification(
      connection,
      connection,
      { active: false, plan: 'free', used: 30, cap: 30 },
    )).toEqual({ ...connection, plan: 'free' })
  })

  it('returns the current connection unchanged when the verified plan already matches', () => {
    const connection: Connection = {
      serverUrl: 'https://api.example.test',
      deviceToken: 'device-token',
      clientId: 'client',
      plan: 'pro',
    }

    expect(connectionAfterBillingVerification(
      connection,
      connection,
      { active: true, plan: 'pro', used: 0, cap: 500 },
    )).toBe(connection)
  })

  it('only recovers Apple transactions for a registered personal account', () => {
    const eligible: Connection = {
      serverUrl: 'https://api.example.test',
      deviceToken: 'device-token',
      clientId: 'client',
      individual: true,
      email: 'user@example.test',
    }

    expect(canRecoverAppleTransactions(eligible)).toBe(true)
    expect(canRecoverAppleTransactions({ ...eligible, email: undefined })).toBe(false)
    expect(canRecoverAppleTransactions({ ...eligible, individual: false })).toBe(false)
    expect(canRecoverAppleTransactions({ ...eligible, demo: true })).toBe(false)
    expect(canRecoverAppleTransactions(null)).toBe(false)
  })

  it('does not notify after Apple transaction recovery is stopped', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const commands: string[] = []
    mockIPC((command) => {
      commands.push(command)
      if (command === 'native_unfinished_transactions') {
        return [{
          platform: 'apple',
          productId: 'pro_monthly',
          transactionId: 'stopped-transaction-id',
          signedTransactionInfo: 'stopped-signed-transaction',
        }]
      }
      if (command === 'native_finish_transaction') return null
      throw new Error(`unexpected command: ${command}`)
    })
    let resolveVerification: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveVerification = resolve }),
    ))
    const onVerified = vi.fn()

    const stop = await startAppleTransactionRecovery(
      'https://api.example.test', 'device-token', onVerified,
    )
    await vi.waitFor(() => expect(resolveVerification).toBeTypeOf('function'))
    stop()
    resolveVerification?.(new Response(
      JSON.stringify({ active: true, plan: 'pro', used: 0, cap: 500 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    await vi.waitFor(() => {
      expect(commands).toContain('native_finish_transaction')
    })
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('coalesces overlapping unfinished transaction polling', async () => {
    vi.stubGlobal('isTauri', true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    let unfinishedCalls = 0
    let resolveUnfinished: ((transactions: unknown[]) => void) | undefined
    mockIPC((command) => {
      if (command === 'native_unfinished_transactions') {
        unfinishedCalls += 1
        return new Promise<unknown[]>((resolve) => { resolveUnfinished = resolve })
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const stop = startAppleTransactionRecovery(
      'https://api.example.test', 'device-token',
    )
    await vi.waitFor(() => expect(unfinishedCalls).toBe(1))
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(unfinishedCalls).toBe(1)
    resolveUnfinished?.([])
    stop()
  })

  it('warns that Apple subscriptions remain managed by the Apple account after deletion', () => {
    expect(accountDeletionConfirmation(['apple'])).toContain(
      'App Store のサブスクリプションは退会後も Apple アカウント側で管理されます。',
    )
    expect(accountDeletionConfirmation(['apple'])).toContain(
      '請求を停止するには、退会前に「サブスクリプションを管理」から解約してください。',
    )
  })

  it('keeps the Apple cancellation warning when Google is also active', () => {
    const confirmation = accountDeletionConfirmation(['google', 'apple'])

    expect(confirmation).toContain('App Store のサブスクリプション')
    expect(confirmation).toContain('Google Play のサブスクリプションは自動的に解約されます。')
  })
})
