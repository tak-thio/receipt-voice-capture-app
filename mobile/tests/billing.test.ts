import { afterEach, describe, expect, it, vi } from 'vitest'

import { getBillingSubscription } from '../src/api/server-api'

describe('billing subscription API', () => {
  afterEach(() => {
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
})
