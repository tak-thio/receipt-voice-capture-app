import { describe, expect, it } from 'vitest'
import { buildExportPreview } from '../../src/services/export/build-export-preview'
import type { Session } from '../../src/types/domain'
import type { AppSettings } from '../../src/types/settings'

const settingsSnapshot: AppSettings = {
  appMode: 'standalone',
  serverUrl: '',
  serverDeviceToken: '',
  serverClientId: '',
  storageRoot: '/tmp/receipt-app',
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
}

function buildSession(): Session {
  return {
    id: 'session-1',
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
    settingsSnapshot,
    records: [
      {
        id: 'record-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
        imagePath: '/tmp/capture.jpg',
        capturedAt: '2026-03-25T00:00:00.000Z',
        imageWidth: 1200,
        imageHeight: 800,
        stt: {
          rawText: '3月24日 セブンイレブン 税込1158円 現金 文具代',
          normalizedText: '3月24日 セブンイレブン 税込1158円 現金 文具代',
          tokens: ['3月24日', 'セブンイレブン', '税込1158円', '現金', '文具代'],
          segmentStartMs: 0,
          segmentEndMs: 1200,
          sourceEvents: [],
          parsedFields: {
            date: '2026-03-24',
            vendor: 'セブンイレブン',
            taxMode: 'inclusive',
            amount: 1158,
            paymentMethod: '現金',
            descriptionRaw: '文具代',
            accountCategoryCandidate: '消耗品費',
            accountCategoryFinal: '消耗品費',
            summary: '文具購入',
            invoiceNumber: 'T1234567890123',
            memo: '',
          },
          parserWarnings: [],
        },
        ocr: {
          rawText: '2026-03-24 セブンイレブン 1158円 T1234567890123',
          extractedCandidates: {
            dates: ['2026-03-24'],
            vendors: ['セブンイレブン'],
            amounts: [1158],
            invoiceNumbers: ['T1234567890123'],
          },
          source: 'mock',
        },
        final: {
          date: '2026-03-24',
          vendor: 'セブンイレブン',
          taxMode: 'inclusive',
          amount: 1158,
          paymentMethod: '現金',
          descriptionRaw: '文具代',
          accountCategoryCandidate: '消耗品費',
          accountCategoryFinal: '消耗品費',
          summary: '文具購入',
          invoiceNumber: 'T1234567890123',
          memo: 'レシートあり',
          manualEditedFields: [],
        },
        review: {
          matchStatus: 'ok',
          reviewRequired: false,
          mismatchReasons: [],
          confidence: 1,
        },
      },
    ],
  }
}

describe('buildExportPreview', () => {
  it('builds generic export rows', () => {
    const preview = buildExportPreview(buildSession(), 'generic')

    expect(preview.headers).toEqual([
      'date',
      'vendor',
      'tax_mode',
      'amount',
      'payment_method',
      'description_raw',
      'account_category_candidate',
      'account_category_final',
      'summary',
      'invoice_number',
      'memo',
      'status',
    ])
    expect(preview.rows[0]).toEqual([
      '2026-03-24',
      'セブンイレブン',
      'inclusive',
      '1158',
      '現金',
      '文具代',
      '消耗品費',
      '消耗品費',
      '文具購入',
      'T1234567890123',
      'レシートあり',
      'ok',
    ])
  })

  it('builds freee export rows', () => {
    const preview = buildExportPreview(buildSession(), 'freee')

    expect(preview.headers).toEqual(['発生日', '取引先', '金額', '税区分', '勘定科目', '摘要'])
    expect(preview.rows[0]).toEqual([
      '2026-03-24',
      'セブンイレブン',
      '1158',
      '税込',
      '消耗品費',
      '文具購入',
    ])
  })

  it('builds yayoi export rows', () => {
    const preview = buildExportPreview(buildSession(), 'yayoi')

    expect(preview.headers).toEqual(['日付', '支払先', '金額', '税区分', '勘定科目', 'メモ'])
    expect(preview.rows[0]).toEqual([
      '2026-03-24',
      'セブンイレブン',
      '1158',
      '税込',
      '消耗品費',
      'レシートあり',
    ])
  })

  it('builds MJS/MAS import pattern rows', () => {
    const preview = buildExportPreview(buildSession(), 'mas')

    expect(preview.headers).toHaveLength(44)
    expect(preview.headers.slice(0, 6)).toEqual([
      '伝票日付',
      '内部月',
      '伝票ＮＯ',
      '証憑ＮＯ',
      'データ種別',
      '仕訳入力形式',
    ])
    expect(preview.headers[28]).toBe('金額(入力金額)')
    expect(preview.headers[35]).toBe('摘要')
    expect(preview.headers[43]).toBe('付箋コメント')
    expect(preview.rows[0]).toHaveLength(44)
    expect(preview.rows[0][0]).toBe('2026-03-24')
    expect(preview.rows[0][12]).toBe('1')
    expect(preview.rows[0][23]).toBe('1')
    expect(preview.rows[0][28]).toBe('1158')
    expect(preview.rows[0][35]).toBe('セブンイレブン 文具購入 T1234567890123 レシートあり')
  })

  it('does not duplicate the vendor in MJS/MAS description when the summary already contains it', () => {
    const session = buildSession()
    session.records[0].final.summary = 'セブンイレブンでの文具代'

    const preview = buildExportPreview(session, 'mas')

    expect(preview.rows[0][35]).toBe('セブンイレブンでの文具代 T1234567890123 レシートあり')
  })

  it('escapes CSV cells with quotes and carriage returns', () => {
    const session = buildSession()
    session.records[0].final.summary = '文具"購入"\r領収書'

    const preview = buildExportPreview(session, 'mas')

    expect(preview.csvContent).toContain('"セブンイレブン 文具""購入""\r領収書 T1234567890123 レシートあり"')
  })
})
