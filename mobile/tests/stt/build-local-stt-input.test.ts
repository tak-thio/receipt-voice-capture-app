import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/lib/constants'
import { buildLocalSttExecutionPlan } from '../../src/services/stt/build-local-stt-input'
import type { RecordedAudioClip } from '../../src/types/audio'

function buildAudioClip(overrides: Partial<RecordedAudioClip> = {}): RecordedAudioClip {
  return {
    blob: new Blob(['audio']),
    objectUrl: 'blob:mock-audio',
    filePath: '/tmp/receipt-audio.wav',
    mimeType: 'audio/wav',
    size: 5,
    durationMs: 3200,
    startedAt: '2026-03-30T01:00:00.000Z',
    endedAt: '2026-03-30T01:00:03.200Z',
    ...overrides,
  }
}

describe('buildLocalSttExecutionPlan', () => {
  it('prefers recorded audio when a saved file path exists', () => {
    const plan = buildLocalSttExecutionPlan(
      {
        audioClip: buildAudioClip(),
        manualTranscript: 'これは無視される',
      },
      DEFAULT_SETTINGS,
      'fallback sequence',
    )

    expect(plan.strategy).toBe('recorded-audio')
    expect(plan.input.audioPath).toBe('/tmp/receipt-audio.wav')
    expect(plan.input.seedText).toBeUndefined()
  })

  it('falls back to manual transcript when no saved audio exists', () => {
    const plan = buildLocalSttExecutionPlan(
      {
        audioClip: buildAudioClip({ filePath: undefined }),
        manualTranscript: '3月24日 セブンイレブン',
      },
      DEFAULT_SETTINGS,
      'fallback sequence',
    )

    expect(plan.strategy).toBe('seed-fallback')
    expect(plan.input.audioPath).toBeUndefined()
    expect(plan.input.seedText).toBe('3月24日 セブンイレブン')
  })

  it('uses fallback seed text when neither audio nor manual transcript is available', () => {
    const plan = buildLocalSttExecutionPlan(
      {
        audioClip: buildAudioClip({ filePath: undefined }),
      },
      DEFAULT_SETTINGS,
      'fixture sequence text',
    )

    expect(plan.strategy).toBe('seed-fallback')
    expect(plan.input.seedText).toBe('fixture sequence text')
  })

  it('throws when no local STT input is available', () => {
    expect(() =>
      buildLocalSttExecutionPlan(
        {
          audioClip: buildAudioClip({ filePath: undefined }),
        },
        DEFAULT_SETTINGS,
        '',
      ),
    ).toThrow('local STT を実行するには保存済み録音または transcript 入力が必要です。')
  })
})
