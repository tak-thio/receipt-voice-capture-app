import utteranceFixtures from '../fixtures/utterances.json'
import { loadDictionaries } from '../../src/services/dictionary-loader'
import { normalizeSpeechText } from '../../src/parser/normalizers'
import { parseSpeech } from '../../src/parser/speech-parser'
import { tokenizeSpeech } from '../../src/parser/tokenize'

describe('speech parser fixture cases', () => {
  it('normalizes and tokenizes before parsing', () => {
    const normalized = normalizeSpeechText('  3月24日　セブンイレブン  税込み1158円  ')
    expect(normalized).toBe('3月24日 セブンイレブン 税込1158円')
    expect(tokenizeSpeech(normalized)).toEqual(['3月24日', 'セブンイレブン', '税込1158円'])
  })

  it('parses fixture expectations with a fixed reference year', async () => {
    const dictionaries = await loadDictionaries()
    const referenceDate = new Date('2026-03-25T00:00:00+09:00')

    for (const fixture of utteranceFixtures) {
      const result = parseSpeech({
        rawText: fixture.rawText,
        dictionaries,
        referenceDate,
      })

      expect(result.boundaryDetected, fixture.id).toBe(true)
      expect(result.fields.date, fixture.id).toBe(fixture.expected.date)
      expect(result.fields.vendor, fixture.id).toBe(fixture.expected.vendor)
      expect(result.fields.taxMode, fixture.id).toBe(fixture.expected.taxMode)
      expect(result.fields.amount, fixture.id).toBe(fixture.expected.amount)
      expect(result.fields.paymentMethod, fixture.id).toBe(fixture.expected.paymentMethod)
      expect(result.fields.descriptionRaw, fixture.id).toBe(fixture.expected.descriptionRaw)
      expect(result.fields.accountCategoryCandidate, fixture.id).toBe(
        fixture.expected.accountCategoryCandidate,
      )
      expect(result.fields.accountCategoryFinal, fixture.id).toBe(
        fixture.expected.accountCategoryFinal,
      )
      expect(result.fields.summary, fixture.id).toBe(fixture.expected.summary)
      expect(result.fields.invoiceNumber, fixture.id).toBe(fixture.expected.invoiceNumber)
    }
  })

  it('marks unknown tax mode as a warning', async () => {
    const dictionaries = await loadDictionaries()
    const result = parseSpeech({
      rawText: '3月26日 ファミリーマート 680円 現金 消耗品費 次へ',
      dictionaries,
      referenceDate: new Date('2026-03-25T00:00:00+09:00'),
    })

    expect(result.fields.taxMode).toBe('unknown')
    expect(result.warnings).toContain('税区分が未指定です。')
  })
})
