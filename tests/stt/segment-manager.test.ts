import { MockSttAdapter } from '../../src/services/adapters/mock-stt-adapter'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../../src/services/sample-sequences'
import { SegmentManager } from '../../src/services/stt/segment-manager'

describe('segment manager and mock stt adapter', () => {
  it('commits a segment when a boundary keyword arrives', () => {
    const manager = new SegmentManager()
    const segments = manager.append([
      { id: '1', text: '3月24日 セブンイレブン', startMs: 0, endMs: 1000 },
      { id: '2', text: '税込1158円 現金', startMs: 1001, endMs: 2000 },
      { id: '3', text: '文具代 次へ', startMs: 2001, endMs: 3000 },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0].rawText).toContain('文具代 次へ')
    expect(manager.snapshot()).toHaveLength(0)
  })

  it('creates transcript events from manual text lines', async () => {
    const adapter = new MockSttAdapter({ sequences: MOCK_TRANSCRIPT_SEQUENCES })
    const result = await adapter.transcribe({
      manualTranscript: '3月24日 セブンイレブン\n税込1158円 現金\n文具代 次へ',
    })

    expect(result.source).toBe('manual-transcript')
    expect(result.events).toHaveLength(3)
    expect(result.events[2].text).toBe('文具代 次へ')
  })

  it('scales sequence timing to a recording duration', async () => {
    const adapter = new MockSttAdapter({ sequences: MOCK_TRANSCRIPT_SEQUENCES })
    const sequence = MOCK_TRANSCRIPT_SEQUENCES[0]
    const result = await adapter.transcribe({
      sequenceId: sequence.id,
      audioClip: {
        blob: new Blob(['test'], { type: 'audio/webm' }),
        objectUrl: 'blob:test',
        mimeType: 'audio/webm',
        size: 4,
        durationMs: 6400,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
    })

    expect(result.source).toBe('recording')
    expect(result.events).toHaveLength(sequence.events.length)
    expect(result.events.at(-1)?.endMs).toBe(6400)
  })
})
