import { extractOcrCandidates } from '../../src/services/ocr/candidate-extractor'
import { MockOcrAdapter } from '../../src/services/adapters/mock-ocr-adapter'

describe('ocr candidate extractor', () => {
  it('extracts date, amount, vendor, and invoice number from raw text', () => {
    const result = extractOcrCandidates(
      '2026年3月20日 タクシー福岡 1640円 T1234567890123',
      new Date('2026-03-25T00:00:00+09:00'),
    )

    expect(result.dates).toEqual(['2026-03-20'])
    expect(result.amounts).toEqual([1640])
    expect(result.invoiceNumbers).toEqual(['T1234567890123'])
    expect(result.vendors).toEqual(['タクシー福岡'])
  })

  it('fills candidates through the mock adapter interface', async () => {
    const adapter = new MockOcrAdapter()
    const result = await adapter.extractFromImage({
      imagePath: '/tmp/receipt.jpg',
      finalBlock: {
        date: '2026-03-24',
        vendor: 'セブンイレブン',
        taxMode: 'inclusive',
        amount: 1158,
        paymentMethod: '現金',
        descriptionRaw: '文具代',
        accountCategoryCandidate: '消耗品費',
        accountCategoryFinal: '消耗品費',
        summary: '',
        invoiceNumber: '',
        memo: '',
        manualEditedFields: [],
      },
    })

    expect(result.source).toBe('mock')
    expect(result.rawText).toContain('セブンイレブン')
    expect(result.extractedCandidates.vendors).toEqual(['セブンイレブン'])
    expect(result.extractedCandidates.amounts).toEqual([1158])
  })
})
