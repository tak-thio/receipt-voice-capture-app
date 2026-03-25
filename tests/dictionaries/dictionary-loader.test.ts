import { describe, expect, it } from 'vitest'
import { loadDictionaries } from '../../src/services/dictionary-loader'

describe('loadDictionaries', () => {
  it('loads bundled dictionaries with expected entries', async () => {
    const dictionaries = await loadDictionaries()

    expect(dictionaries.paymentMethods.length).toBeGreaterThan(0)
    expect(dictionaries.accountCategories.length).toBeGreaterThan(0)
    expect(dictionaries.descriptionMappings.length).toBeGreaterThan(0)

    expect(dictionaries.paymentMethods.some((entry) => entry.label === '現金')).toBe(true)
    expect(dictionaries.accountCategories.some((entry) => entry.name === '消耗品費')).toBe(true)
    expect(
      dictionaries.descriptionMappings.some(
        (entry) => entry.pattern === '文具代' && entry.accountCategory === '消耗品費',
      ),
    ).toBe(true)
  })
})
