import paymentMethodsJson from '../../dictionaries/payment-methods.json'
import accountCategoriesJson from '../../dictionaries/account-categories.json'
import descriptionMappingJson from '../../dictionaries/description-mapping.json'
import { dictionaryBundleSchema } from '../lib/schemas'
import type { DictionaryBundle } from '../types/dictionaries'

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = getKey(item)
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export async function loadDictionaries(customDictionaries?: DictionaryBundle): Promise<DictionaryBundle> {
  const standard = dictionaryBundleSchema.parse({
    paymentMethods: paymentMethodsJson,
    accountCategories: accountCategoriesJson,
    descriptionMappings: descriptionMappingJson.map((entry) => ({
      pattern: entry.pattern,
      accountCategory: entry.account_category,
      confidence: entry.confidence,
      notes: entry.notes,
    })),
  })

  const custom = dictionaryBundleSchema.parse(customDictionaries ?? {
    paymentMethods: [],
    accountCategories: [],
    descriptionMappings: [],
  })

  return {
    paymentMethods: uniqueBy([...custom.paymentMethods, ...standard.paymentMethods], (entry) => entry.id),
    accountCategories: uniqueBy([...custom.accountCategories, ...standard.accountCategories], (entry) => entry.id),
    descriptionMappings: uniqueBy(
      [...custom.descriptionMappings, ...standard.descriptionMappings],
      (entry) => `${entry.pattern}:${entry.accountCategory}`,
    ),
  }
}
