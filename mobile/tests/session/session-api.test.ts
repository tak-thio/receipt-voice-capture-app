import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const maybeInvokeMock = vi.fn()

vi.mock('../../src/api/tauri', () => ({
  maybeInvoke: maybeInvokeMock,
}))

describe('session api recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    maybeInvokeMock.mockReset()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('falls back to latest local session when load_current_session throws', async () => {
    const latestSession = {
      id: 'session-latest',
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:01:00.000Z',
      settingsSnapshot: {
        storageRoot: 'receipt-sessions',
        preferredCameraId: '',
        preferredMicrophoneId: '',
        sttMode: 'mock',
        sttModel: 'small',
        sttDevice: 'cpu',
        sttComputeType: 'int8',
        sttLanguage: 'ja',
        sttBeamSize: 5,
        aiProvider: 'openai',
        openaiApiKey: '',
        geminiApiKey: '',
        openaiSttModel: 'gpt-4o-mini-transcribe',
        geminiModel: 'gemini-2.5-flash',
        aiFormatMode: 'rule',
        aiFormatterModel: 'gpt-4o-mini',
        ocrEnabled: true,
        ocrMode: 'mock',
        exportTargetDefault: 'generic',
      },
      records: [],
    }

    localStorage.setItem('receipt-app:session:session-latest', JSON.stringify(latestSession))
    maybeInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'load_current_session') {
        throw new Error('broken pointer')
      }
      return undefined
    })

    const { loadCurrentSession } = await import('../../src/api/session-api')
    const loaded = await loadCurrentSession('receipt-sessions')

    expect(loaded?.id).toBe('session-latest')
  })

  it('lists local sessions sorted by updatedAt descending', async () => {
    localStorage.setItem(
      'receipt-app:session:session-older',
      JSON.stringify({
        id: 'session-older',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
        settingsSnapshot: {},
        records: [],
      }),
    )
    localStorage.setItem(
      'receipt-app:session:session-newer',
      JSON.stringify({
        id: 'session-newer',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:05:00.000Z',
        settingsSnapshot: {},
        records: [{ id: 'record-1' }],
      }),
    )
    maybeInvokeMock.mockResolvedValue(undefined)

    const { listSessions } = await import('../../src/api/session-api')
    const summaries = await listSessions('receipt-sessions')

    expect(summaries.map((item) => item.id)).toEqual(['session-newer', 'session-older'])
    expect(summaries[0]?.recordCount).toBe(1)
  })
})
