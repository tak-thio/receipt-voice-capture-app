import type { ReceiptRecordFinalBlock, ReceiptRecordOcrBlock, ReceiptRecordReviewBlock } from '../types/domain'

function includesValue<T>(items: T[], expected: T): boolean {
  return items.includes(expected)
}

export function buildReviewBlock(
  finalBlock: ReceiptRecordFinalBlock,
  ocrBlock: ReceiptRecordOcrBlock,
  parserWarnings: string[],
): ReceiptRecordReviewBlock {
  const mismatchReasons = [...parserWarnings]

  if (
    finalBlock.amount !== null &&
    ocrBlock.extractedCandidates.amounts.length > 0 &&
    !includesValue(ocrBlock.extractedCandidates.amounts, finalBlock.amount)
  ) {
    mismatchReasons.push('OCRの金額候補と一致しません。')
  }

  if (
    finalBlock.date &&
    ocrBlock.extractedCandidates.dates.length > 0 &&
    !includesValue(ocrBlock.extractedCandidates.dates, finalBlock.date)
  ) {
    mismatchReasons.push('OCRの日付候補と一致しません。')
  }

  if (
    finalBlock.vendor &&
    ocrBlock.extractedCandidates.vendors.length > 0 &&
    !includesValue(ocrBlock.extractedCandidates.vendors, finalBlock.vendor)
  ) {
    mismatchReasons.push('OCRの支払先候補と一致しません。')
  }

  if (
    finalBlock.invoiceNumber &&
    ocrBlock.extractedCandidates.invoiceNumbers.length > 0 &&
    !includesValue(ocrBlock.extractedCandidates.invoiceNumbers, finalBlock.invoiceNumber)
  ) {
    mismatchReasons.push('OCRのインボイス番号候補と一致しません。')
  }

  const reviewRequired = mismatchReasons.some((reason) => reason.includes('金額')) || mismatchReasons.length > 2
  const matchStatus = reviewRequired
    ? 'review_required'
    : mismatchReasons.length > 0
      ? 'warning'
      : 'ok'

  const confidence = Math.max(0, 1 - mismatchReasons.length * 0.2)

  return {
    matchStatus,
    reviewRequired,
    mismatchReasons,
    confidence,
  }
}
