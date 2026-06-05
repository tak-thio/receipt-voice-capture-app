import { describe, expect, it } from 'vitest'
import { buildReviewBlock } from '../../src/matching/match-record'
import type { ReceiptRecordFinalBlock, ReceiptRecordOcrBlock } from '../../src/types/domain'

const finalBlock: ReceiptRecordFinalBlock = {
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
  manualEditedFields: [],
}

function buildOcrBlock(source: ReceiptRecordOcrBlock['source']): ReceiptRecordOcrBlock {
  return {
    rawText: '',
    extractedCandidates: {
      dates: [],
      vendors: [],
      amounts: [],
      invoiceNumbers: [],
    },
    source,
  }
}

describe('buildReviewBlock', () => {
  it('does not add OCR mismatch warnings when OCR is disabled', () => {
    const review = buildReviewBlock(finalBlock, buildOcrBlock('disabled'), [])

    expect(review.matchStatus).toBe('ok')
    expect(review.reviewRequired).toBe(false)
    expect(review.mismatchReasons).toEqual([])
  })

  it('keeps parser warnings even when OCR is unavailable', () => {
    const review = buildReviewBlock(finalBlock, buildOcrBlock('error'), ['税区分が未指定です。'])

    expect(review.matchStatus).toBe('warning')
    expect(review.mismatchReasons).toEqual(['税区分が未指定です。'])
  })
})
