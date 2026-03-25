import { describe, expect, it } from 'vitest'
import { buildExportPreview } from '../../src/services/export/build-export-preview'
import type { Session } from '../../src/types/domain'
import type { AppSettings } from '../../src/types/settings'

const settingsSnapshot: AppSettings = {
  storageRoot: '/tmp/receipt-app',
  preferredCameraId: '',
  preferredMicrophoneId: '',
  sttMode: 'mock',
  sttModel: 'small',
  sttDevice: 'cpu',
  sttComputeType: 'int8',
  sttLanguage: 'ja',
  sttBeamSize: 5,
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
})
