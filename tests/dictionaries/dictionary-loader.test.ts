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

  it('merges custom dictionaries ahead of bundled entries', async () => {
    const dictionaries = await loadDictionaries({
      paymentMethods: [{ id: 'cash', label: 'テスト現金', aliases: ['テスト現金'] }],
      accountCategories: [{ id: 'custom_supplies', name: 'テスト備品費', aliases: ['テスト備品費'] }],
      descriptionMappings: [
        {
          pattern: 'テストコピー代',
          accountCategory: 'テスト備品費',
          confidence: 0.95,
        },
      ],
    })

    expect(dictionaries.paymentMethods[0]).toMatchObject({ id: 'cash', label: 'テスト現金' })
    expect(dictionaries.paymentMethods.filter((entry) => entry.id === 'cash')).toHaveLength(1)
    expect(dictionaries.accountCategories[0]).toMatchObject({
      id: 'custom_supplies',
      name: 'テスト備品費',
    })
    expect(dictionaries.descriptionMappings[0]).toMatchObject({
      pattern: 'テストコピー代',
      accountCategory: 'テスト備品費',
    })
  })
})
