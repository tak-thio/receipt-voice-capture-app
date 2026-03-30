import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMediaRecordingSupport } from '../../src/services/audio/media-recorder-service'

const originalNavigator = globalThis.navigator
const originalMediaRecorder = globalThis.MediaRecorder

function setNavigatorMediaDevices(mediaDevices: MediaDevices | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: mediaDevices
      ? {
          ...originalNavigator,
          mediaDevices,
        }
      : {},
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  })

  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: originalMediaRecorder,
  })

  vi.restoreAllMocks()
})

describe('getMediaRecordingSupport', () => {
  it('reports missing mediaDevices.getUserMedia', () => {
    setNavigatorMediaDevices(undefined)

    expect(getMediaRecordingSupport()).toEqual({
      supported: false,
      reason:
        'この実行環境ではマイク API (`navigator.mediaDevices.getUserMedia`) が利用できません。',
    })
  })

  it('reports missing MediaRecorder', () => {
    setNavigatorMediaDevices({
      getUserMedia: vi.fn(),
    } as unknown as MediaDevices)
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: undefined,
    })

    expect(getMediaRecordingSupport()).toEqual({
      supported: false,
      reason: 'この実行環境では MediaRecorder が利用できません。',
    })
  })
})
