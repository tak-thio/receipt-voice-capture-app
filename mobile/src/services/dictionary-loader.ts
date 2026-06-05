import paymentMethodsJson from '../../dictionaries/payment-methods.json'
import accountCategoriesJson from '../../dictionaries/account-categories.json'
import descriptionMappingJson from '../../dictionaries/description-mapping.json'
import { dictionaryBundleSchema } from '../lib/schemas'
import type { DictionaryBundle } from '../types/dictionaries'

export async function loadDictionaries(): Promise<DictionaryBundle> {
  return dictionaryBundleSchema.parse({
    paymentMethods: paymentMethodsJson,
    accountCategories: accountCategoriesJson,
    descriptionMappings: descriptionMappingJson.map((entry) => ({
      pattern: entry.pattern,
      accountCategory: entry.account_category,
      confidence: entry.confidence,
      notes: entry.notes,
    })),
  })
}
