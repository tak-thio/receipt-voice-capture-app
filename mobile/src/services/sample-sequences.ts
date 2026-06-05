import type { MockTranscriptSequence } from './adapters/mock-stt-adapter'

export const MOCK_TRANSCRIPT_SEQUENCES: MockTranscriptSequence[] = [
  {
    id: 'stationery-basic',
    label: '文具の基本形',
    events: [
      { id: 'evt-1', text: '3月24日 セブンイレブン', startMs: 0, endMs: 1200 },
      { id: 'evt-2', text: '税込1158円 現金', startMs: 1201, endMs: 2400 },
      { id: 'evt-3', text: '文具代 次へ', startMs: 2401, endMs: 3200 },
    ],
  },
  {
    id: 'meeting-with-invoice',
    label: '摘要とインボイスあり',
    events: [
      { id: 'evt-4', text: '3月20日 タクシー福岡', startMs: 0, endMs: 1000 },
      { id: 'evt-5', text: '税込1640円 現金 タクシー代', startMs: 1001, endMs: 2200 },
      { id: 'evt-6', text: '交通費 客先訪問 T1234567890123 次へ', startMs: 2201, endMs: 3400 },
    ],
  },
  {
    id: 'tax-unknown',
    label: '税区分未指定',
    events: [
      { id: 'evt-7', text: '3月26日 ファミリーマート', startMs: 0, endMs: 1000 },
      { id: 'evt-8', text: '680円 現金', startMs: 1001, endMs: 1800 },
      { id: 'evt-9', text: '消耗品費 次へ', startMs: 1801, endMs: 2500 },
    ],
  },
]
